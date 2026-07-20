import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  auditHrafnChassisReplay,
  parseHrafnChassisReason,
} from "./audit-hrafn-chassis-replay.mjs";

const COWORLD_PACKAGE = "coworld==0.1.28";
const DEFAULT_PLAYER_NAME = "K1Z Hrafn";
const DEFAULT_EXPECTED_EPISODES = 4;
const EXACT_HRAFN_PLAYER_ID =
  "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
const EXACT_HRAFN_POLICY_ID =
  "e483e9fe-7c3a-4e7b-9e67-3140b17a3de2";
const EXACT_C1_POLICY_VERSION_ID =
  "0b444466-abdd-422f-82e7-7652360a2015";
const EXACT_V5_POLICY_VERSION_ID =
  "10c32300-4593-408a-a17d-02e1d70e4a2e";
const ALLOWED_REPLAY_HOSTS = new Set([
  "softmax-public.s3.amazonaws.com",
]);
const MAX_REPLAY_BYTES = 128 * 1024 * 1024;
const REQUIRED_AUTHORITATIVE_CHECKS = [
  "hrafn_identity_verified",
  "decisions_present",
  "zero_foreign_tagged_decisions",
  "all_decisions_accepted",
  "zero_rejections",
  "fallback_evidence_complete",
  "zero_fallbacks",
  "zero_planner_degradation",
  "zero_unexplained_holds",
  "hold_evidence_complete",
  "zero_k1z_harm",
  "harmful_targets_resolved",
  "submitted_effects_consistent",
  "marker_semantics_valid",
  "selected_ids_were_legal",
  "public_text_valid",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalSHA256(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return sha256(`${JSON.stringify(canonicalize(value))}\n`);
}

function canonicalVariantIdentity(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function finiteNumber(value) {
  if (
    value === null ||
    value === "" ||
    typeof value === "boolean"
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function sum(audits, field) {
  return audits.reduce((total, episode) => {
    const value = finiteNumber(episode?.authoritative_audit?.[field]);
    return total + (value ?? 0);
  }, 0);
}

function sumArrayLengths(audits, field) {
  return audits.reduce(
    (total, episode) =>
      total + arrayLength(episode?.authoritative_audit?.[field]),
    0,
  );
}

function aggregateCounts(audits, field) {
  const totals = {};
  for (const episode of audits) {
    for (const [name, rawCount] of Object.entries(episode?.[field] ?? {})) {
      const count = finiteNumber(rawCount);
      if (count === null) continue;
      totals[name] = (totals[name] ?? 0) + count;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

function aggregateAuthoritativeMarkerCounts(audits) {
  return aggregateCounts(
    audits.map((episode) => ({
      marker_counts: episode?.authoritative_audit?.marker_counts ?? {},
    })),
    "marker_counts",
  );
}

function exactParticipantBinding(
  episode,
  expectedPlayerName,
  expectedPolicyVersionID,
  expectedPlayerID,
  expectedPolicyID,
) {
  const participants = Array.isArray(episode?.participants)
    ? episode.participants
    : [];
  const nameMatches = participants.filter((participant) =>
    participant?.player_name === expectedPlayerName
  );
  const policyMatches = participants.filter((participant) =>
    participant?.policy_version_id === expectedPolicyVersionID
  );
  const playerIDMatches = participants.filter((participant) =>
    participant?.player_id === expectedPlayerID
  );
  const policyIDMatches = participants.filter((participant) =>
    participant?.policy_id === expectedPolicyID
  );
  const jointMatches = participants.filter((participant) =>
    participant?.player_name === expectedPlayerName &&
    participant?.policy_version_id === expectedPolicyVersionID &&
    participant?.player_id === expectedPlayerID &&
    participant?.policy_id === expectedPolicyID
  );
  const participant = jointMatches.length === 1 ? jointMatches[0] : null;
  const participantIndex = participant === null
    ? null
    : participants.indexOf(participant);
  const participantPosition = Number.isInteger(participant?.position)
    ? participant.position
    : null;
  return {
    participants,
    participant,
    participantIndex,
    participantPosition,
    exactNameMatchCount: nameMatches.length,
    exactPolicyVersionMatchCount: policyMatches.length,
    exactPlayerIDMatchCount: playerIDMatches.length,
    exactPolicyIDMatchCount: policyIDMatches.length,
    exactJointMatchCount: jointMatches.length,
    participantPositionConsistent:
      participantPosition !== null &&
      participantPosition === participantIndex,
  };
}

function replayIsComplete(
  replay,
  participantCount,
  { allowNoOutrightWinner = false } = {},
) {
  const winnerSlot = replay?.results?.winner_slot;
  const finalWinnerSlot = replay?.finalState?.winnerSlot;
  const resultPlayers = replay?.results?.players;
  const finalPlayers = replay?.finalState?.players;
  const outrightWinnerIsComplete =
    Number.isInteger(winnerSlot) &&
    winnerSlot >= 0 &&
    winnerSlot < participantCount &&
    Number.isInteger(finalWinnerSlot) &&
    finalWinnerSlot === winnerSlot;
  const noOutrightWinnerIsComplete =
    allowNoOutrightWinner &&
    winnerSlot === null &&
    finalWinnerSlot === null;
  return (
    typeof replay?.gameID === "string" &&
    replay.gameID.length > 0 &&
    (outrightWinnerIsComplete || noOutrightWinnerIsComplete) &&
    Array.isArray(resultPlayers) &&
    resultPlayers.length === participantCount &&
    Array.isArray(finalPlayers) &&
    finalPlayers.length === participantCount &&
    typeof replay?.inlineRunArtifacts?.["decisions.jsonl"] === "string"
  );
}

function parseReplayDecisions(replay) {
  const raw = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof raw !== "string") {
    throw new Error("replay does not contain inline decisions.jsonl");
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function productiveHrafnC1MarkerCounts(
  replay,
  expectedPlayerName = DEFAULT_PLAYER_NAME,
) {
  const counts = {};
  for (const decision of parseReplayDecisions(replay)) {
    if (decision?.username !== expectedPlayerName) continue;
    if (
      decision?.externalActionCall === false &&
      decision?.actionSelectionSource === "deterministic-spawn"
    ) {
      continue;
    }
    const selectedKind = String(decision?.selectedActionKind ?? "");
    const selectedID = String(decision?.selectedLegalActionId ?? "");
    if (
      selectedKind === "spawn" ||
      selectedKind === "hold" ||
      selectedID === "hold" ||
      selectedID.startsWith("hold:")
    ) {
      continue;
    }
    const parsed = parseHrafnChassisReason(decision?.reason);
    if (
      !parsed.valid ||
      !parsed.primaryMarker ||
      decision?.result?.accepted !== true ||
      decision?.fallbackUsed !== false ||
      decision?.llmPlannerDegraded !== false
    ) {
      continue;
    }
    counts[parsed.primaryMarker] = (counts[parsed.primaryMarker] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function expectedDecisionAgentID(position) {
  return Number.isInteger(position) && position >= 0
    ? `opportunistic-agent-${position + 1}`
    : null;
}

function runtimePlayerID(player) {
  return String(
    player?.playerID ??
    player?.playerId ??
    player?.id ??
    "",
  ).trim();
}

function runtimePlayerName(player) {
  return player?.name ?? player?.username ?? null;
}

function runtimePlayerSlot(player, index, { requireExplicit = false } = {}) {
  if (Number.isInteger(player?.slot)) return player.slot;
  return requireExplicit ? null : index;
}

function resultRuntimeIDSchema(players) {
  if (players.length === 0) return "invalid";
  const identifiedRows = players.filter((player) =>
    runtimePlayerID(player).length > 0
  ).length;
  if (identifiedRows === 0) return "all_rows_idless";
  if (identifiedRows === players.length) return "all_rows_identified";
  return "mixed_or_partial";
}

function uniqueRuntimePlayerBinding(
  replay,
  expectedPlayerName,
  expectedParticipantPosition,
) {
  const resultPlayers = Array.isArray(replay?.results?.players)
    ? replay.results.players
    : [];
  const finalPlayers = Array.isArray(replay?.finalState?.players)
    ? replay.finalState.players
    : [];
  const resultNameMatches = resultPlayers.filter((player) =>
    runtimePlayerName(player) === expectedPlayerName
  );
  const finalNameMatches = finalPlayers.filter((player) =>
    runtimePlayerName(player) === expectedPlayerName
  );
  const resultExactMatches = resultPlayers.filter((player, index) =>
    runtimePlayerName(player) === expectedPlayerName &&
    runtimePlayerSlot(player, index, { requireExplicit: true }) ===
      expectedParticipantPosition
  );
  const finalExactMatches = finalPlayers.filter((player, index) =>
    runtimePlayerName(player) === expectedPlayerName &&
    runtimePlayerSlot(player, index) === expectedParticipantPosition
  );
  const resultPlayer = resultExactMatches.length === 1
    ? resultExactMatches[0]
    : null;
  const finalPlayer = finalExactMatches.length === 1
    ? finalExactMatches[0]
    : null;
  const resultRuntimeID = runtimePlayerID(resultPlayer);
  const finalRuntimeID = runtimePlayerID(finalPlayer);
  const resultIDSchema = resultRuntimeIDSchema(resultPlayers);
  const resultIDUnique = resultRuntimeID.length > 0 &&
    resultPlayers.filter((player) =>
      runtimePlayerID(player) === resultRuntimeID
    ).length === 1;
  const finalIDUnique = finalRuntimeID.length > 0 &&
    finalPlayers.filter((player) =>
      runtimePlayerID(player) === finalRuntimeID
    ).length === 1;
  const exactSurfacesBound = (
    Number.isInteger(expectedParticipantPosition) &&
    expectedParticipantPosition >= 0 &&
    resultNameMatches.length === 1 &&
    finalNameMatches.length === 1 &&
    resultExactMatches.length === 1 &&
    finalExactMatches.length === 1 &&
    finalIDUnique
  );
  const runtimeID = (
    exactSurfacesBound &&
    (
      resultIDSchema === "all_rows_idless" ||
      (
        resultIDSchema === "all_rows_identified" &&
        resultIDUnique &&
        resultRuntimeID === finalRuntimeID
      )
    )
  )
    ? finalRuntimeID
    : null;
  return {
    runtimeID,
    resultRuntimeID: resultRuntimeID || null,
    finalRuntimeID: finalRuntimeID || null,
    resultRuntimeIDSchema: resultIDSchema,
    resultNameMatchCount: resultNameMatches.length,
    finalNameMatchCount: finalNameMatches.length,
    resultExactMatchCount: resultExactMatches.length,
    finalExactMatchCount: finalExactMatches.length,
    complete: runtimeID !== null,
  };
}

function policyDecisionsForPlayer(replay, expectedPlayerName) {
  return parseReplayDecisions(replay).filter((decision) =>
    decision?.username === expectedPlayerName &&
    !(
      decision?.externalActionCall === false &&
      decision?.actionSelectionSource === "deterministic-spawn"
    )
  );
}

function plannerEvidence(decision) {
  if (typeof decision?.llmPlannerDegraded === "boolean") {
    return {
      complete: true,
      degraded: decision.llmPlannerDegraded,
    };
  }
  if (decision?.externalPlannerCall === false) {
    return { complete: true, degraded: false };
  }
  try {
    const parsed = JSON.parse(decision?.rawLlmOutput);
    if (typeof parsed?.llmPlannerDegraded === "boolean") {
      return {
        complete: true,
        degraded: parsed.llmPlannerDegraded,
      };
    }
  } catch {
    // The evidence failure is recorded below.
  }
  return { complete: false, degraded: null };
}

function genericDecisionEvidence(
  replay,
  expectedPlayerName,
  expectedParticipantPosition,
) {
  const decisions = policyDecisionsForPlayer(replay, expectedPlayerName);
  const expectedAgentID = expectedDecisionAgentID(
    expectedParticipantPosition,
  );
  const runtimeBinding = uniqueRuntimePlayerBinding(
    replay,
    expectedPlayerName,
    expectedParticipantPosition,
  );
  const resultEvidenceFailures = decisions
    .filter((decision) => typeof decision?.result?.accepted !== "boolean")
    .map((decision) => ({
      turn: decision?.turnNumber ?? null,
      value: decision?.result?.accepted ?? null,
    }));
  const fallbackEvidenceFailures = decisions
    .filter((decision) => typeof decision?.fallbackUsed !== "boolean")
    .map((decision) => ({
      turn: decision?.turnNumber ?? null,
      value: decision?.fallbackUsed ?? null,
    }));
  const plannerEvidenceFailures = [];
  let plannerDegradedDecisions = 0;
  for (const decision of decisions) {
    const evidence = plannerEvidence(decision);
    if (!evidence.complete) {
      plannerEvidenceFailures.push({
        turn: decision?.turnNumber ?? null,
        value: decision?.llmPlannerDegraded ?? null,
      });
    } else if (evidence.degraded) {
      plannerDegradedDecisions += 1;
    }
  }
  const decisionAgentIDs = [
    ...new Set(decisions.map((decision) =>
      String(decision?.agentID ?? "")
    )),
  ];
  const decisionAgentPositions = [
    ...new Set(decisions.map((decision) =>
      slotFromAgentID(decision?.agentID)
    )),
  ];
  const decisionRuntimeEvidenceFailures = [];
  for (const decision of decisions) {
    const states = [
      ["auditBefore", decision?.auditBefore],
      ["auditAfter", decision?.auditAfter],
    ];
    const presentStates = states.filter(([, state]) =>
      state !== null && typeof state === "object" && !Array.isArray(state)
    );
    const runtimeIDs = presentStates.map(([field, state]) => ({
      field,
      player_id: runtimePlayerID(state) || null,
    }));
    if (
      runtimeBinding.runtimeID === null ||
      runtimeIDs.length === 0 ||
      runtimeIDs.some(({ player_id: playerID }) =>
        playerID === null || playerID !== runtimeBinding.runtimeID
      )
    ) {
      decisionRuntimeEvidenceFailures.push({
        turn: decision?.turnNumber ?? null,
        expected_player_id: runtimeBinding.runtimeID,
        observed: runtimeIDs,
      });
    }
  }
  return {
    policy_decisions: decisions.length,
    accepted: decisions.filter((decision) =>
      decision?.result?.accepted === true
    ).length,
    rejected: decisions.filter((decision) =>
      decision?.result?.accepted === false
    ).length,
    holds: decisions.filter((decision) =>
      decision?.selectedActionKind === "hold" ||
      String(decision?.selectedLegalActionId ?? "") === "hold" ||
      String(decision?.selectedLegalActionId ?? "").startsWith("hold:")
    ).length,
    fallbacks: decisions.filter((decision) =>
      decision?.fallbackUsed === true
    ).length,
    planner_degraded_decisions: plannerDegradedDecisions,
    result_evidence_failures: resultEvidenceFailures,
    fallback_evidence_failures: fallbackEvidenceFailures,
    planner_evidence_failures: plannerEvidenceFailures,
    decision_agent_ids: decisionAgentIDs,
    decision_agent_positions: decisionAgentPositions,
    expected_decision_agent_id: expectedAgentID,
    decision_agent_binding_complete:
      decisions.length > 0 &&
      expectedAgentID !== null &&
      decisionAgentIDs.length === 1 &&
      decisionAgentIDs[0] === expectedAgentID &&
      decisionAgentPositions.length === 1 &&
      decisionAgentPositions[0] === expectedParticipantPosition,
    runtime_player_id: runtimeBinding.runtimeID,
    result_runtime_player_id: runtimeBinding.resultRuntimeID,
    final_runtime_player_id: runtimeBinding.finalRuntimeID,
    result_runtime_id_schema: runtimeBinding.resultRuntimeIDSchema,
    result_runtime_name_match_count:
      runtimeBinding.resultNameMatchCount,
    final_runtime_name_match_count:
      runtimeBinding.finalNameMatchCount,
    result_runtime_exact_match_count:
      runtimeBinding.resultExactMatchCount,
    final_runtime_exact_match_count:
      runtimeBinding.finalExactMatchCount,
    decision_runtime_evidence_failures: decisionRuntimeEvidenceFailures,
    decision_runtime_binding_complete:
      runtimeBinding.complete &&
      decisions.length > 0 &&
      decisionRuntimeEvidenceFailures.length === 0,
  };
}

function episodeOutcomeEvidence(
  episode,
  replay,
  binding,
  expectedPlayerName,
  expectedPolicyVersionID,
  { allowNoOutrightWinner = false } = {},
) {
  const scoreMatches = Array.isArray(episode?.scores)
    ? episode.scores.filter((entry) =>
        entry?.policy_version_id === expectedPolicyVersionID
      )
    : [];
  const score = scoreMatches.length === 1
    ? finiteNumber(scoreMatches[0]?.score)
    : null;
  const position = binding.participantPosition;
  const resultPlayer = position === null
    ? null
    : replay?.results?.players?.[position] ?? null;
  const resultScore = finiteNumber(resultPlayer?.score);
  const resultVectorScore = position === null
    ? null
    : finiteNumber(replay?.results?.scores?.[position]);
  const winnerSlot = replay?.results?.winner_slot;
  const finalWinnerSlot = replay?.finalState?.winnerSlot;
  const replayPlayerName = resultPlayer?.name ?? resultPlayer?.username ?? null;
  const finalPlayer = position === null
    ? null
    : replay?.finalState?.players?.[position] ?? null;
  const finalPlayerName = finalPlayer?.name ?? finalPlayer?.username ?? null;
  const resultPlayerSlot = Number.isInteger(resultPlayer?.slot)
    ? resultPlayer.slot
    : null;
  const outrightWinnerEvidence =
    Number.isInteger(winnerSlot) &&
    winnerSlot >= 0 &&
    winnerSlot < binding.participants.length &&
    winnerSlot === finalWinnerSlot;
  const noOutrightWinnerEvidence =
    allowNoOutrightWinner &&
    winnerSlot === null &&
    finalWinnerSlot === null;
  const outcomeEvidenceConsistent = (
    binding.exactJointMatchCount === 1 &&
    binding.participantPositionConsistent &&
    scoreMatches.length === 1 &&
    score !== null &&
    resultScore === score &&
    resultVectorScore === score &&
    (outrightWinnerEvidence || noOutrightWinnerEvidence) &&
    replayPlayerName === expectedPlayerName &&
    finalPlayerName === expectedPlayerName &&
    resultPlayerSlot === position
  );
  const won = outcomeEvidenceConsistent &&
    outrightWinnerEvidence &&
    score === 1 &&
    winnerSlot === position;
  return {
    scoreMatchCount: scoreMatches.length,
    score,
    resultScore,
    resultVectorScore,
    replayPlayerName,
    finalPlayerName,
    resultPlayerSlot,
    resultPlayerSlotBound: resultPlayerSlot === position,
    won,
    outcomeEvidenceConsistent,
    winEvidenceConsistent: outcomeEvidenceConsistent && won,
  };
}

export function auditHrafnC1XpEpisode(
  episode,
  replay,
  replayBytes,
  {
    expectedPlayerName = DEFAULT_PLAYER_NAME,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    replayPath = null,
  } = {},
) {
  if (!expectedPolicyVersionID) {
    throw new Error("expectedPolicyVersionID is required");
  }
  const binding = exactParticipantBinding(
    episode,
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
  );
  const replayComplete = replayIsComplete(
    replay,
    binding.participants.length,
  );
  const authoritative = auditHrafnChassisReplay(replay, replayBytes);
  const productiveMarkerCounts = productiveHrafnC1MarkerCounts(
    replay,
    expectedPlayerName,
  );
  const productiveMarkerCount = Object.values(productiveMarkerCounts)
    .reduce((total, count) => total + count, 0);
  const outcomeEvidence = episodeOutcomeEvidence(
    episode,
    replay,
    binding,
    expectedPlayerName,
    expectedPolicyVersionID,
  );
  const decisionEvidence = genericDecisionEvidence(
    replay,
    expectedPlayerName,
    binding.participantPosition,
  );
  const replayHash = sha256(replayBytes);

  return {
    episode_request_id: episode?.id ?? null,
    episode_id: episode?.episode_id ?? null,
    status: episode?.status ?? null,
    map: episode?.game_config?.map ?? null,
    participant_position: binding.participantPosition,
    exact_name_match_count: binding.exactNameMatchCount,
    exact_policy_version_match_count:
      binding.exactPolicyVersionMatchCount,
    exact_player_id_match_count: binding.exactPlayerIDMatchCount,
    exact_policy_id_match_count: binding.exactPolicyIDMatchCount,
    exact_joint_match_count: binding.exactJointMatchCount,
    participant_position_consistent:
      binding.participantPositionConsistent,
    bound_player_name: binding.participant?.player_name ?? null,
    bound_policy_version_id:
      binding.participant?.policy_version_id ?? null,
    bound_player_id: binding.participant?.player_id ?? null,
    bound_policy_id: binding.participant?.policy_id ?? null,
    score_match_count: outcomeEvidence.scoreMatchCount,
    score: outcomeEvidence.score,
    replay_result_score: outcomeEvidence.resultScore,
    replay_result_vector_score: outcomeEvidence.resultVectorScore,
    replay_player_name: outcomeEvidence.replayPlayerName,
    final_player_name: outcomeEvidence.finalPlayerName,
    result_player_slot: outcomeEvidence.resultPlayerSlot,
    result_player_slot_bound: outcomeEvidence.resultPlayerSlotBound,
    won: outcomeEvidence.won,
    outcome_evidence_consistent:
      outcomeEvidence.outcomeEvidenceConsistent,
    win_evidence_consistent: outcomeEvidence.winEvidenceConsistent,
    decision_agent_binding_complete:
      decisionEvidence.decision_agent_binding_complete,
    decision_agent_policy_decisions: decisionEvidence.policy_decisions,
    decision_agent_ids: decisionEvidence.decision_agent_ids,
    decision_agent_positions: decisionEvidence.decision_agent_positions,
    expected_decision_agent_id:
      decisionEvidence.expected_decision_agent_id,
    runtime_player_id: decisionEvidence.runtime_player_id,
    result_runtime_player_id:
      decisionEvidence.result_runtime_player_id,
    final_runtime_player_id:
      decisionEvidence.final_runtime_player_id,
    result_runtime_name_match_count:
      decisionEvidence.result_runtime_name_match_count,
    final_runtime_name_match_count:
      decisionEvidence.final_runtime_name_match_count,
    decision_runtime_evidence_failures:
      decisionEvidence.decision_runtime_evidence_failures,
    decision_runtime_binding_complete:
      decisionEvidence.decision_runtime_binding_complete,
    replay_complete: replayComplete,
    replay_url: episode?.replay_url ?? null,
    replay_path: replayPath,
    replay_sha256: replayHash,
    productive_marker_count: productiveMarkerCount,
    productive_marker_counts: productiveMarkerCounts,
    audit_error: null,
    authoritative_audit: authoritative,
  };
}

export function auditHrafnControlXpEpisode(
  episode,
  replay,
  replayBytes,
  {
    expectedPlayerName = DEFAULT_PLAYER_NAME,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    replayPath = null,
  } = {},
) {
  if (!expectedPolicyVersionID) {
    throw new Error("expectedPolicyVersionID is required");
  }
  const binding = exactParticipantBinding(
    episode,
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
  );
  const replayComplete = replayIsComplete(
    replay,
    binding.participants.length,
    { allowNoOutrightWinner: true },
  );
  const outcomeEvidence = episodeOutcomeEvidence(
    episode,
    replay,
    binding,
    expectedPlayerName,
    expectedPolicyVersionID,
    { allowNoOutrightWinner: true },
  );
  const decisionEvidence = genericDecisionEvidence(
    replay,
    expectedPlayerName,
    binding.participantPosition,
  );
  return {
    episode_request_id: episode?.id ?? null,
    episode_id: episode?.episode_id ?? null,
    status: episode?.status ?? null,
    map: episode?.game_config?.map ?? null,
    participant_position: binding.participantPosition,
    exact_name_match_count: binding.exactNameMatchCount,
    exact_policy_version_match_count:
      binding.exactPolicyVersionMatchCount,
    exact_player_id_match_count: binding.exactPlayerIDMatchCount,
    exact_policy_id_match_count: binding.exactPolicyIDMatchCount,
    exact_joint_match_count: binding.exactJointMatchCount,
    participant_position_consistent:
      binding.participantPositionConsistent,
    bound_player_name: binding.participant?.player_name ?? null,
    bound_policy_version_id:
      binding.participant?.policy_version_id ?? null,
    bound_player_id: binding.participant?.player_id ?? null,
    bound_policy_id: binding.participant?.policy_id ?? null,
    score_match_count: outcomeEvidence.scoreMatchCount,
    score: outcomeEvidence.score,
    replay_result_score: outcomeEvidence.resultScore,
    replay_result_vector_score: outcomeEvidence.resultVectorScore,
    replay_player_name: outcomeEvidence.replayPlayerName,
    final_player_name: outcomeEvidence.finalPlayerName,
    result_player_slot: outcomeEvidence.resultPlayerSlot,
    result_player_slot_bound: outcomeEvidence.resultPlayerSlotBound,
    won: outcomeEvidence.won,
    outcome_evidence_consistent:
      outcomeEvidence.outcomeEvidenceConsistent,
    replay_complete: replayComplete,
    replay_url: episode?.replay_url ?? null,
    replay_path: replayPath,
    replay_sha256: sha256(replayBytes),
    ...decisionEvidence,
    audit_error: null,
  };
}

function unavailableEpisodeAudit(
  episode,
  {
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    error,
    role = "candidate",
  },
) {
  const binding = exactParticipantBinding(
    episode,
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
  );
  return {
    episode_request_id: episode?.id ?? null,
    episode_id: episode?.episode_id ?? null,
    status: episode?.status ?? null,
    map: episode?.game_config?.map ?? null,
    participant_position: binding.participantPosition,
    exact_name_match_count: binding.exactNameMatchCount,
    exact_policy_version_match_count:
      binding.exactPolicyVersionMatchCount,
    exact_player_id_match_count: binding.exactPlayerIDMatchCount,
    exact_policy_id_match_count: binding.exactPolicyIDMatchCount,
    exact_joint_match_count: binding.exactJointMatchCount,
    participant_position_consistent:
      binding.participantPositionConsistent,
    bound_player_name: binding.participant?.player_name ?? null,
    bound_policy_version_id:
      binding.participant?.policy_version_id ?? null,
    bound_player_id: binding.participant?.player_id ?? null,
    bound_policy_id: binding.participant?.policy_id ?? null,
    score_match_count: 0,
    score: null,
    replay_result_score: null,
    replay_result_vector_score: null,
    replay_player_name: null,
    final_player_name: null,
    result_player_slot: null,
    result_player_slot_bound: false,
    won: false,
    outcome_evidence_consistent: false,
    win_evidence_consistent: false,
    replay_complete: false,
    replay_url: episode?.replay_url ?? null,
    replay_path: null,
    replay_sha256: null,
    productive_marker_count: 0,
    productive_marker_counts: {},
    decision_agent_binding_complete: false,
    decision_agent_policy_decisions: 0,
    decision_agent_ids: [],
    decision_agent_positions: [],
    expected_decision_agent_id: expectedDecisionAgentID(
      binding.participantPosition,
    ),
    runtime_player_id: null,
    result_runtime_player_id: null,
    final_runtime_player_id: null,
    result_runtime_id_schema: "invalid",
    result_runtime_name_match_count: 0,
    final_runtime_name_match_count: 0,
    result_runtime_exact_match_count: 0,
    final_runtime_exact_match_count: 0,
    decision_runtime_evidence_failures: [],
    decision_runtime_binding_complete: false,
    audit_error: String(error),
    ...(role === "candidate"
      ? { authoritative_audit: null }
      : {
          policy_decisions: 0,
          accepted: 0,
          rejected: 0,
          holds: 0,
          fallbacks: 0,
          planner_degraded_decisions: 0,
          result_evidence_failures: [],
          fallback_evidence_failures: [],
          planner_evidence_failures: [],
        }),
  };
}

export function buildHrafnC1XpGateReport(
  request,
  episodeAudits,
  {
    expectedEpisodeCount = DEFAULT_EXPECTED_EPISODES,
    expectedPlayerName = DEFAULT_PLAYER_NAME,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    expectedVariantID,
    expectedMap,
    expectedParticipantPosition,
  } = {},
) {
  if (
    !Number.isInteger(expectedEpisodeCount) ||
    expectedEpisodeCount < 1
  ) {
    throw new Error("expectedEpisodeCount must be a positive integer");
  }
  if (
    typeof expectedPlayerName !== "string" ||
    expectedPlayerName.length === 0
  ) {
    throw new Error("expectedPlayerName is required");
  }
  if (
    typeof expectedPolicyVersionID !== "string" ||
    expectedPolicyVersionID.length === 0
  ) {
    throw new Error("expectedPolicyVersionID is required");
  }
  if (
    typeof expectedPlayerID !== "string" ||
    expectedPlayerID.length === 0
  ) {
    throw new Error("expectedPlayerID is required");
  }
  if (
    typeof expectedPolicyID !== "string" ||
    expectedPolicyID.length === 0
  ) {
    throw new Error("expectedPolicyID is required");
  }
  if (
    typeof expectedVariantID !== "string" ||
    expectedVariantID.length === 0
  ) {
    throw new Error("expectedVariantID is required");
  }
  if (
    typeof expectedMap !== "string" ||
    expectedMap.length === 0
  ) {
    throw new Error("expectedMap is required");
  }
  if (
    !Number.isInteger(expectedParticipantPosition) ||
    expectedParticipantPosition < 0
  ) {
    throw new Error(
      "expectedParticipantPosition must be a non-negative integer",
    );
  }
  const audits = Array.isArray(episodeAudits) ? episodeAudits : [];
  const hasExactAuditCount = audits.length === expectedEpisodeCount;
  const each = (predicate) =>
    hasExactAuditCount && audits.every(predicate);
  const replayHashes = audits.map(
    (episode) => episode?.replay_sha256 ?? null,
  );
  const authoritative = (episode) => episode?.authoritative_audit;
  const hasAuthoritative = (episode) =>
    authoritative(episode) !== null &&
    typeof authoritative(episode) === "object";
  const requiredChecksPassed = (episode) => {
    const checks = authoritative(episode)?.checks;
    return checks !== null &&
      typeof checks === "object" &&
      Object.keys(checks).length >= REQUIRED_AUTHORITATIVE_CHECKS.length &&
      REQUIRED_AUTHORITATIVE_CHECKS.every((name) =>
        checks[name] === true
      ) &&
      Object.values(checks).every((value) => value === true);
  };
  const checks = {
    request_terminal_completed: request?.status === "completed",
    request_error_absent: request?.error === null,
    request_variant_exact: request?.variant_id === expectedVariantID,
    request_episode_count_exact:
      request?.episode_count === expectedEpisodeCount,
    request_all_episodes_completed:
      request?.completed_count === expectedEpisodeCount &&
      request?.pending_count === 0 &&
      request?.submitted_count === 0 &&
      request?.running_count === 0 &&
      request?.failed_count === 0,
    audited_episode_count_exact: hasExactAuditCount,
    all_episodes_terminal_completed: each((episode) =>
      episode?.status === "completed"
    ),
    exact_player_policy_binding_each_episode: each((episode) =>
      episode?.exact_name_match_count === 1 &&
      episode?.exact_policy_version_match_count === 1 &&
      episode?.exact_player_id_match_count === 1 &&
      episode?.exact_policy_id_match_count === 1 &&
      episode?.exact_joint_match_count === 1 &&
      episode?.participant_position_consistent === true &&
      episode?.participant_position === expectedParticipantPosition &&
      episode?.bound_player_name === expectedPlayerName &&
      episode?.bound_policy_version_id === expectedPolicyVersionID &&
      episode?.bound_player_id === expectedPlayerID &&
      episode?.bound_policy_id === expectedPolicyID
    ),
    expected_map_each_episode: each((episode) =>
      episode?.map === expectedMap
    ),
    all_replays_complete: each((episode) =>
      episode?.replay_complete === true
    ),
    all_replay_hashes_present: each((episode) =>
      /^[a-f0-9]{64}$/.test(String(episode?.replay_sha256 ?? ""))
    ),
    all_replay_hashes_unique:
      hasExactAuditCount &&
      replayHashes.every((hash) =>
        /^[a-f0-9]{64}$/.test(String(hash ?? ""))
      ) &&
      new Set(replayHashes).size === replayHashes.length,
    authoritative_replay_hashes_bound: each((episode) =>
      hasAuthoritative(episode) &&
      /^[a-f0-9]{64}$/.test(
        String(authoritative(episode).replay_sha256 ?? ""),
      ) &&
      episode?.replay_sha256 === authoritative(episode).replay_sha256
    ),
    every_episode_won: each((episode) => episode?.won === true),
    win_evidence_consistent_each_episode: each((episode) =>
      episode?.win_evidence_consistent === true
    ),
    result_player_slot_bound_each_episode: each((episode) =>
      episode?.result_player_slot_bound === true &&
      episode?.result_player_slot === expectedParticipantPosition
    ),
    decision_agent_bound_each_episode: each((episode) =>
      episode?.decision_agent_binding_complete === true &&
      episode?.decision_agent_policy_decisions ===
        authoritative(episode)?.policy_decisions &&
      episode?.expected_decision_agent_id ===
        expectedDecisionAgentID(expectedParticipantPosition) &&
      Array.isArray(episode?.decision_agent_ids) &&
      episode.decision_agent_ids.length === 1 &&
      episode.decision_agent_ids[0] ===
        expectedDecisionAgentID(expectedParticipantPosition) &&
      Array.isArray(episode?.decision_agent_positions) &&
      episode.decision_agent_positions.length === 1 &&
      episode.decision_agent_positions[0] === expectedParticipantPosition
    ),
    decisions_present_each_episode: each((episode) =>
      hasAuthoritative(episode) &&
      Number.isInteger(authoritative(episode)?.policy_decisions) &&
      authoritative(episode).policy_decisions > 0
    ),
    all_decisions_accepted: each((episode) =>
      hasAuthoritative(episode) &&
      Number.isInteger(authoritative(episode).accepted) &&
      Number.isInteger(authoritative(episode).policy_decisions) &&
      authoritative(episode).policy_decisions > 0 &&
      authoritative(episode)?.accepted ===
        authoritative(episode)?.policy_decisions
    ),
    zero_rejections: each((episode) =>
      hasAuthoritative(episode) &&
      Number.isInteger(authoritative(episode).rejected) &&
      authoritative(episode).rejected === 0
    ),
    fallback_evidence_complete: each((episode) =>
      hasAuthoritative(episode) &&
      Array.isArray(
        authoritative(episode).fallback_evidence_failures,
      ) &&
      authoritative(episode).fallback_evidence_failures.length === 0
    ),
    zero_fallbacks: each((episode) =>
      hasAuthoritative(episode) &&
      Number.isInteger(authoritative(episode).fallbacks) &&
      authoritative(episode).fallbacks === 0
    ),
    zero_planner_degradation: each((episode) =>
      hasAuthoritative(episode) &&
      Array.isArray(
        authoritative(episode).planner_degradation_failures,
      ) &&
      authoritative(episode).planner_degradation_failures.length === 0
    ),
    zero_unexplained_holds: each((episode) =>
      hasAuthoritative(episode) &&
      Array.isArray(authoritative(episode).unexplained_holds) &&
      authoritative(episode).unexplained_holds.length === 0
    ),
    zero_holds: each((episode) =>
      hasAuthoritative(episode) &&
      Number.isInteger(authoritative(episode).holds) &&
      authoritative(episode).holds === 0
    ),
    hold_evidence_complete: each((episode) =>
      hasAuthoritative(episode) &&
      Array.isArray(authoritative(episode).hold_evidence_gaps) &&
      authoritative(episode).hold_evidence_gaps.length === 0
    ),
    zero_k1z_harm: each((episode) =>
      hasAuthoritative(episode) &&
      Array.isArray(authoritative(episode).harmful_k1z_actions) &&
      authoritative(episode).harmful_k1z_actions.length === 0
    ),
    productive_marker_each_episode: each((episode) =>
      Number.isInteger(episode?.productive_marker_count) &&
      episode.productive_marker_count >= 1
    ),
    authoritative_schema_exact_each_episode: each((episode) =>
      hasAuthoritative(episode) &&
      authoritative(episode).schema_version === 2 &&
      authoritative(episode).record_type ===
        "hrafn_clean_chassis_replay_audit" &&
      authoritative(episode).audit_scope === "replay_safety_only"
    ),
    all_authoritative_checks_passed: each(requiredChecksPassed),
    all_episode_audits_error_free: each((episode) =>
      episode?.audit_error === null &&
      hasAuthoritative(episode)
    ),
  };
  const wins = audits.filter((episode) => episode?.won === true).length;
  const productiveMarkerCount = audits.reduce(
    (total, episode) =>
      total + (finiteNumber(episode?.productive_marker_count) ?? 0),
    0,
  );

  return {
    schema_version: 1,
    record_type: "hrafn_clean_chassis_c1_hosted_xp_gate",
    audit_scope: "exact_hosted_request_and_replay_gate",
    experience_request_id: request?.id ?? null,
    status: request?.status ?? null,
    request_error: request?.error ?? null,
    expected_player_name: expectedPlayerName,
    expected_player_id: expectedPlayerID,
    expected_policy_id: expectedPolicyID,
    expected_policy_version_id: expectedPolicyVersionID,
    expected_variant_id: expectedVariantID,
    expected_map: expectedMap,
    expected_participant_position: expectedParticipantPosition,
    expected_episodes: expectedEpisodeCount,
    requested_episodes: request?.episode_count ?? null,
    episodes: audits.length,
    wins,
    win_rate_pct: audits.length > 0
      ? Number((100 * wins / audits.length).toFixed(2))
      : 0,
    policy_decisions: sum(audits, "policy_decisions"),
    accepted: sum(audits, "accepted"),
    rejected: sum(audits, "rejected"),
    holds: sum(audits, "holds"),
    verified_holds: sumArrayLengths(audits, "verified_holds"),
    unexplained_holds: sumArrayLengths(audits, "unexplained_holds"),
    hold_evidence_gaps: sumArrayLengths(audits, "hold_evidence_gaps"),
    fallbacks: sum(audits, "fallbacks"),
    fallback_evidence_failures: sumArrayLengths(
      audits,
      "fallback_evidence_failures",
    ),
    planner_degradation_failures: sumArrayLengths(
      audits,
      "planner_degradation_failures",
    ),
    harmful_k1z_actions: sumArrayLengths(
      audits,
      "harmful_k1z_actions",
    ),
    marker_counts: aggregateAuthoritativeMarkerCounts(audits),
    productive_marker_count: productiveMarkerCount,
    productive_marker_counts: aggregateCounts(
      audits,
      "productive_marker_counts",
    ),
    replay_hashes: replayHashes,
    checks,
    evidence_passed: Object.values(checks).every(Boolean),
    episode_audits: audits,
  };
}

function normalizedParticipant(participant) {
  return {
    position: participant?.position ?? null,
    policy_version_id: participant?.policy_version_id ?? null,
    policy_id: participant?.policy_id ?? null,
    policy_name: participant?.policy_name ?? null,
    version: participant?.version ?? null,
    player_id: participant?.player_id ?? null,
    player_name: participant?.player_name ?? null,
    is_filler: participant?.is_filler ?? null,
    label: participant?.label ?? null,
  };
}

function rosterVector(episode) {
  return (Array.isArray(episode?.participants)
    ? episode.participants
    : [])
    .map(normalizedParticipant)
    .sort((left, right) => left.position - right.position);
}

function normalizedScores(episode) {
  return (Array.isArray(episode?.scores) ? episode.scores : [])
    .map((entry) => ({
      policy_version_id: entry?.policy_version_id ?? null,
      score: finiteNumber(entry?.score),
    }))
    .sort((left, right) =>
      String(left.policy_version_id).localeCompare(
        String(right.policy_version_id),
      )
    );
}

function normalizedEpisodeSnapshot(episode) {
  return {
    id: episode?.id ?? null,
    status: episode?.status ?? null,
    episode_id: episode?.episode_id ?? null,
    coworld_id: episode?.coworld_id ?? null,
    coworld_version: episode?.coworld_version ?? null,
    replay_url: episode?.replay_url ?? null,
    error_type: episode?.error_type ?? null,
    error: episode?.error ?? null,
    failed_policy_index: episode?.failed_policy_index ?? null,
    failed_agent_index: episode?.failed_agent_index ?? null,
    map: episode?.game_config?.map ?? null,
    game_config_sha256: canonicalSHA256(episode?.game_config),
    variant_name: episode?.variant_name ?? null,
    effective_variant_identity:
      canonicalVariantIdentity(episode?.variant_name),
    policy_version_ids: Array.isArray(episode?.policy_version_ids)
      ? [...episode.policy_version_ids]
      : null,
    participants: rosterVector(episode),
    scores: normalizedScores(episode),
  };
}

function sameJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizedBodyRoster(requestBody) {
  return (Array.isArray(requestBody?.roster) ? requestBody.roster : [])
    .map((entry) => ({
      slot: entry?.slot ?? null,
      policy_ref: entry?.player?.policy_ref ?? null,
    }))
    .sort((left, right) => left.slot - right.slot);
}

function bodyResolvesEpisode(requestBody, episode) {
  const bodyRoster = normalizedBodyRoster(requestBody);
  const participants = rosterVector(episode);
  if (bodyRoster.length === 0 || bodyRoster.length !== participants.length) {
    return false;
  }
  if (
    !bodyRoster.every((entry, index) =>
      entry.slot === index &&
      participants[index]?.position === index &&
      entry.policy_ref === participants[index]?.label
    )
  ) {
    return false;
  }
  return Array.isArray(episode?.policy_version_ids) &&
    sameJSON(
      episode.policy_version_ids,
      participants.map((participant) => participant.policy_version_id),
    );
}

function requestEpisodeSetsMatch(embeddedEpisodes, fetchedEpisodes) {
  if (
    !Array.isArray(embeddedEpisodes) ||
    !Array.isArray(fetchedEpisodes) ||
    embeddedEpisodes.length !== fetchedEpisodes.length
  ) {
    return false;
  }
  const normalizeSet = (episodes) =>
    episodes
      .map(normalizedEpisodeSnapshot)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return sameJSON(
    normalizeSet(embeddedEpisodes),
    normalizeSet(fetchedEpisodes),
  );
}

function buildRequestProvenance(
  {
    role,
    requestID,
    request,
    fetchedEpisodes,
    requestBody,
    requestBodyPath,
    requestBodySHA256,
  },
  {
    expectedEpisodeCount,
    expectedVariantID,
    expectedMap,
  },
) {
  const embeddedEpisodes = request?.episodes;
  const fetched = Array.isArray(fetchedEpisodes) ? fetchedEpisodes : [];
  const embedded = Array.isArray(embeddedEpisodes)
    ? embeddedEpisodes
    : [];
  const fetchedRosters = fetched.map(rosterVector);
  const embeddedRosters = embedded.map(rosterVector);
  const firstRoster = fetchedRosters[0] ?? [];
  const expectedEffectiveVariant =
    canonicalVariantIdentity(expectedVariantID);
  const fetchedEffectiveVariants = fetched.map((episode) =>
    canonicalVariantIdentity(episode?.variant_name)
  );
  const embeddedEffectiveVariants = embedded.map((episode) =>
    canonicalVariantIdentity(episode?.variant_name)
  );
  const fetchedGameConfigHashes = fetched.map((episode) =>
    canonicalSHA256(episode?.game_config)
  );
  const embeddedGameConfigHashes = embedded.map((episode) =>
    canonicalSHA256(episode?.game_config)
  );
  const requestBodyLoaded =
    requestBody !== null &&
    typeof requestBody === "object" &&
    !Array.isArray(requestBody);
  const checks = {
    request_id_exact:
      /^xreq_[a-zA-Z0-9-]+$/.test(String(requestID ?? "")) &&
      request?.id === requestID,
    request_coworld_identity_complete:
      typeof request?.coworld_id === "string" &&
      request.coworld_id.length > 0 &&
      typeof request?.coworld_version === "string" &&
      request.coworld_version.length > 0,
    request_effective_variant_exact:
      expectedEffectiveVariant !== null &&
      canonicalVariantIdentity(request?.variant_id) ===
        expectedEffectiveVariant,
    request_body_path_bound:
      typeof requestBodyPath === "string" &&
      requestBodyPath.length > 0 &&
      /^[a-f0-9]{64}$/.test(String(requestBodySHA256 ?? "")),
    request_body_loaded: requestBodyLoaded,
    request_body_coworld_exact:
      requestBodyLoaded &&
      requestBody?.coworld_id === request?.coworld_id,
    request_body_variant_exact:
      requestBodyLoaded &&
      requestBody?.variant_id === expectedVariantID &&
      request?.variant_id === expectedVariantID,
    request_body_episode_count_exact:
      requestBodyLoaded &&
      requestBody?.num_episodes === expectedEpisodeCount &&
      request?.episode_count === expectedEpisodeCount,
    embedded_episode_count_exact:
      embedded.length === expectedEpisodeCount,
    fetched_episode_count_exact:
      fetched.length === expectedEpisodeCount,
    embedded_and_fetched_episode_sets_exact:
      requestEpisodeSetsMatch(embedded, fetched),
    fetched_episode_coworld_identity_exact:
      fetched.length === expectedEpisodeCount &&
      fetched.every((episode) =>
        episode?.coworld_id === request?.coworld_id &&
        episode?.coworld_version === request?.coworld_version
      ),
    embedded_episode_coworld_identity_exact:
      embedded.length === expectedEpisodeCount &&
      embedded.every((episode) =>
        episode?.coworld_id === request?.coworld_id &&
        episode?.coworld_version === request?.coworld_version
      ),
    fetched_effective_variant_identity_exact:
      fetched.length === expectedEpisodeCount &&
      fetchedEffectiveVariants.every((identity) =>
        identity === expectedEffectiveVariant
      ),
    embedded_effective_variant_identity_exact:
      embedded.length === expectedEpisodeCount &&
      embeddedEffectiveVariants.every((identity) =>
        identity === expectedEffectiveVariant
      ),
    fetched_game_configs_canonical_hash_bound:
      fetched.length === expectedEpisodeCount &&
      fetchedGameConfigHashes.every((hash) =>
        /^[a-f0-9]{64}$/.test(String(hash ?? ""))
      ),
    embedded_game_configs_canonical_hash_bound:
      embedded.length === expectedEpisodeCount &&
      embeddedGameConfigHashes.every((hash) =>
        /^[a-f0-9]{64}$/.test(String(hash ?? ""))
      ),
    fetched_maps_exact:
      fetched.length === expectedEpisodeCount &&
      fetched.every((episode) => episode?.game_config?.map === expectedMap),
    embedded_maps_exact:
      embedded.length === expectedEpisodeCount &&
      embedded.every((episode) => episode?.game_config?.map === expectedMap),
    fetched_rosters_full_and_identical:
      firstRoster.length > 0 &&
      fetchedRosters.length === expectedEpisodeCount &&
      fetchedRosters.every((roster) => sameJSON(roster, firstRoster)),
    embedded_rosters_full_and_identical:
      firstRoster.length > 0 &&
      embeddedRosters.length === expectedEpisodeCount &&
      embeddedRosters.every((roster) => sameJSON(roster, firstRoster)),
    request_body_resolves_every_fetched_episode:
      requestBodyLoaded &&
      fetched.length === expectedEpisodeCount &&
      fetched.every((episode) => bodyResolvesEpisode(requestBody, episode)),
    request_body_resolves_every_embedded_episode:
      requestBodyLoaded &&
      embedded.length === expectedEpisodeCount &&
      embedded.every((episode) => bodyResolvesEpisode(requestBody, episode)),
  };
  return {
    role,
    request_id: requestID,
    coworld_id: request?.coworld_id ?? null,
    coworld_version: request?.coworld_version ?? null,
    variant_id: request?.variant_id ?? null,
    effective_variant_identity:
      canonicalVariantIdentity(request?.variant_id),
    episode_effective_variant_identities: [
      ...new Set(fetchedEffectiveVariants),
    ],
    episode_variant_names: [
      ...new Set(fetched.map((episode) => episode?.variant_name ?? null)),
    ],
    episode_coworld_ids: [
      ...new Set(fetched.map((episode) => episode?.coworld_id ?? null)),
    ],
    episode_coworld_versions: [
      ...new Set(fetched.map((episode) =>
        episode?.coworld_version ?? null
      )),
    ],
    game_config_sha256: fetchedGameConfigHashes,
    embedded_game_config_sha256: embeddedGameConfigHashes,
    maps: [
      ...new Set(fetched.map((episode) =>
        episode?.game_config?.map ?? null
      )),
    ],
    episode_count: request?.episode_count ?? null,
    request_body_path: requestBodyPath ?? null,
    request_body_sha256: requestBodySHA256 ?? null,
    request_body_roster: normalizedBodyRoster(requestBody),
    roster_vector: firstRoster,
    checks,
    evidence_passed: Object.values(checks).every(Boolean),
  };
}

export function buildHrafnControlEvidenceReport(
  request,
  episodeAudits,
  {
    expectedEpisodeCount = DEFAULT_EXPECTED_EPISODES,
    expectedPlayerName = DEFAULT_PLAYER_NAME,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    expectedVariantID,
    expectedMap,
    expectedParticipantPosition,
  } = {},
) {
  const requiredStrings = {
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    expectedVariantID,
    expectedMap,
  };
  for (const [name, value] of Object.entries(requiredStrings)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} is required`);
    }
  }
  if (
    !Number.isInteger(expectedEpisodeCount) ||
    expectedEpisodeCount < 1
  ) {
    throw new Error("expectedEpisodeCount must be a positive integer");
  }
  if (
    !Number.isInteger(expectedParticipantPosition) ||
    expectedParticipantPosition < 0
  ) {
    throw new Error(
      "expectedParticipantPosition must be a non-negative integer",
    );
  }
  const audits = Array.isArray(episodeAudits) ? episodeAudits : [];
  const exactCount = audits.length === expectedEpisodeCount;
  const each = (predicate) => exactCount && audits.every(predicate);
  const replayHashes = audits.map((episode) =>
    episode?.replay_sha256 ?? null
  );
  const checks = {
    request_terminal_completed: request?.status === "completed",
    request_error_absent: request?.error === null,
    request_variant_exact: request?.variant_id === expectedVariantID,
    request_episode_count_exact:
      request?.episode_count === expectedEpisodeCount,
    request_all_episodes_completed:
      request?.completed_count === expectedEpisodeCount &&
      request?.pending_count === 0 &&
      request?.submitted_count === 0 &&
      request?.running_count === 0 &&
      request?.failed_count === 0,
    audited_episode_count_exact: exactCount,
    all_episodes_terminal_completed: each((episode) =>
      episode?.status === "completed"
    ),
    exact_player_policy_binding_each_episode: each((episode) =>
      episode?.exact_name_match_count === 1 &&
      episode?.exact_policy_version_match_count === 1 &&
      episode?.exact_player_id_match_count === 1 &&
      episode?.exact_policy_id_match_count === 1 &&
      episode?.exact_joint_match_count === 1 &&
      episode?.participant_position_consistent === true &&
      episode?.participant_position === expectedParticipantPosition &&
      episode?.bound_player_name === expectedPlayerName &&
      episode?.bound_policy_version_id === expectedPolicyVersionID &&
      episode?.bound_player_id === expectedPlayerID &&
      episode?.bound_policy_id === expectedPolicyID
    ),
    expected_map_each_episode: each((episode) =>
      episode?.map === expectedMap
    ),
    all_replays_complete: each((episode) =>
      episode?.replay_complete === true
    ),
    all_replay_hashes_present: each((episode) =>
      /^[a-f0-9]{64}$/.test(String(episode?.replay_sha256 ?? ""))
    ),
    all_replay_hashes_unique:
      exactCount &&
      replayHashes.every((hash) =>
        /^[a-f0-9]{64}$/.test(String(hash ?? ""))
      ) &&
      new Set(replayHashes).size === replayHashes.length,
    result_player_slot_bound_each_episode: each((episode) =>
      episode?.result_player_slot_bound === true &&
      episode?.result_player_slot === expectedParticipantPosition
    ),
    decision_agent_bound_each_episode: each((episode) =>
      episode?.decision_agent_binding_complete === true &&
      episode?.expected_decision_agent_id ===
        expectedDecisionAgentID(expectedParticipantPosition) &&
      Array.isArray(episode?.decision_agent_ids) &&
      episode.decision_agent_ids.length === 1 &&
      episode.decision_agent_ids[0] ===
        expectedDecisionAgentID(expectedParticipantPosition) &&
      Array.isArray(episode?.decision_agent_positions) &&
      episode.decision_agent_positions.length === 1 &&
      episode.decision_agent_positions[0] === expectedParticipantPosition
    ),
    decision_runtime_bound_each_episode: each((episode) =>
      episode?.decision_runtime_binding_complete === true &&
      typeof episode?.runtime_player_id === "string" &&
      episode.runtime_player_id.length > 0 &&
      (
        (
          episode?.result_runtime_id_schema ===
            "all_rows_identified" &&
          episode?.result_runtime_player_id === episode.runtime_player_id
        ) ||
        (
          episode?.result_runtime_id_schema === "all_rows_idless" &&
          episode?.result_runtime_player_id === null
        )
      ) &&
      episode?.final_runtime_player_id === episode.runtime_player_id &&
      episode?.result_runtime_name_match_count === 1 &&
      episode?.final_runtime_name_match_count === 1 &&
      episode?.result_runtime_exact_match_count === 1 &&
      episode?.final_runtime_exact_match_count === 1 &&
      Array.isArray(episode?.decision_runtime_evidence_failures) &&
      episode.decision_runtime_evidence_failures.length === 0
    ),
    outcome_evidence_consistent_each_episode: each((episode) =>
      episode?.outcome_evidence_consistent === true
    ),
    decisions_present_each_episode: each((episode) =>
      Number.isInteger(episode?.policy_decisions) &&
      episode.policy_decisions > 0
    ),
    decision_result_evidence_complete: each((episode) =>
      Array.isArray(episode?.result_evidence_failures) &&
      episode.result_evidence_failures.length === 0 &&
      episode.accepted + episode.rejected === episode.policy_decisions
    ),
    fallback_evidence_complete: each((episode) =>
      Array.isArray(episode?.fallback_evidence_failures) &&
      episode.fallback_evidence_failures.length === 0
    ),
    planner_evidence_complete: each((episode) =>
      Array.isArray(episode?.planner_evidence_failures) &&
      episode.planner_evidence_failures.length === 0
    ),
    all_episode_audits_error_free: each((episode) =>
      episode?.audit_error === null
    ),
  };
  return {
    schema_version: 1,
    record_type: "hrafn_exact_v5_hosted_control_evidence",
    audit_scope: "matched_control_identity_decisions_and_outcomes",
    experience_request_id: request?.id ?? null,
    status: request?.status ?? null,
    expected_policy_version_id: expectedPolicyVersionID,
    expected_player_name: expectedPlayerName,
    expected_player_id: expectedPlayerID,
    expected_policy_id: expectedPolicyID,
    expected_variant_id: expectedVariantID,
    expected_map: expectedMap,
    expected_participant_position: expectedParticipantPosition,
    expected_episodes: expectedEpisodeCount,
    episodes: audits.length,
    wins: audits.filter((episode) => episode?.won === true).length,
    scores: audits.map((episode) => episode?.score ?? null),
    outcomes: audits.map((episode) => ({
      episode_request_id: episode?.episode_request_id ?? null,
      score: episode?.score ?? null,
      won: episode?.won === true,
      replay_result_score: episode?.replay_result_score ?? null,
    })),
    policy_decisions: audits.reduce(
      (total, episode) => total + (finiteNumber(episode?.policy_decisions) ?? 0),
      0,
    ),
    accepted: audits.reduce(
      (total, episode) => total + (finiteNumber(episode?.accepted) ?? 0),
      0,
    ),
    rejected: audits.reduce(
      (total, episode) => total + (finiteNumber(episode?.rejected) ?? 0),
      0,
    ),
    holds: audits.reduce(
      (total, episode) => total + (finiteNumber(episode?.holds) ?? 0),
      0,
    ),
    fallbacks: audits.reduce(
      (total, episode) => total + (finiteNumber(episode?.fallbacks) ?? 0),
      0,
    ),
    planner_degraded_decisions: audits.reduce(
      (total, episode) =>
        total + (finiteNumber(episode?.planner_degraded_decisions) ?? 0),
      0,
    ),
    replay_hashes: replayHashes,
    checks,
    evidence_passed: Object.values(checks).every(Boolean),
    episode_audits: audits,
  };
}

function requestBodiesDifferOnlyAtHrafn(
  candidateBodyRoster,
  controlBodyRoster,
  expectedParticipantPosition,
) {
  if (
    candidateBodyRoster.length === 0 ||
    candidateBodyRoster.length !== controlBodyRoster.length
  ) {
    return false;
  }
  let differences = 0;
  for (let index = 0; index < candidateBodyRoster.length; index += 1) {
    const candidate = candidateBodyRoster[index];
    const control = controlBodyRoster[index];
    if (candidate?.slot !== index || control?.slot !== index) return false;
    if (candidate.policy_ref === control.policy_ref) continue;
    differences += 1;
    if (index !== expectedParticipantPosition) return false;
  }
  return differences === 1;
}

function apiRostersDifferOnlyAtHrafn(
  candidateRoster,
  controlRoster,
  {
    expectedParticipantPosition,
    expectedCandidatePolicyVersionID,
    expectedControlPolicyVersionID,
    expectedPlayerName,
    expectedPlayerID,
    expectedPolicyID,
  },
) {
  if (
    candidateRoster.length === 0 ||
    candidateRoster.length !== controlRoster.length
  ) {
    return false;
  }
  for (let index = 0; index < candidateRoster.length; index += 1) {
    const candidate = candidateRoster[index];
    const control = controlRoster[index];
    if (candidate?.position !== index || control?.position !== index) {
      return false;
    }
    if (index !== expectedParticipantPosition) {
      if (!sameJSON(candidate, control)) return false;
      continue;
    }
    if (
      candidate.player_name !== expectedPlayerName ||
      control.player_name !== expectedPlayerName ||
      candidate.player_id !== expectedPlayerID ||
      control.player_id !== expectedPlayerID ||
      candidate.policy_id !== expectedPolicyID ||
      control.policy_id !== expectedPolicyID ||
      candidate.policy_version_id !== expectedCandidatePolicyVersionID ||
      control.policy_version_id !== expectedControlPolicyVersionID
    ) {
      return false;
    }
    const ignored = new Set(["policy_version_id", "version", "label"]);
    for (const key of Object.keys(candidate)) {
      if (!ignored.has(key) && candidate[key] !== control[key]) return false;
    }
    if (candidate.label === control.label) return false;
  }
  return true;
}

export function buildHrafnC1XpPairGateReport(
  candidate,
  control,
  {
    expectedEpisodeCount = DEFAULT_EXPECTED_EPISODES,
    expectedPlayerName = DEFAULT_PLAYER_NAME,
    expectedPlayerID,
    expectedPolicyID,
    expectedCandidatePolicyVersionID,
    expectedControlPolicyVersionID,
    expectedVariantID,
    expectedMap,
    expectedParticipantPosition,
  } = {},
) {
  const commonOptions = {
    expectedEpisodeCount,
    expectedPlayerName,
    expectedPlayerID,
    expectedPolicyID,
    expectedVariantID,
    expectedMap,
    expectedParticipantPosition,
  };
  const candidateEvidence = buildHrafnC1XpGateReport(
    candidate?.request,
    candidate?.episodeAudits,
    {
      ...commonOptions,
      expectedPolicyVersionID: expectedCandidatePolicyVersionID,
    },
  );
  const controlEvidence = buildHrafnControlEvidenceReport(
    control?.request,
    control?.episodeAudits,
    {
      ...commonOptions,
      expectedPolicyVersionID: expectedControlPolicyVersionID,
    },
  );
  const candidateProvenance = buildRequestProvenance(candidate, {
    expectedEpisodeCount,
    expectedVariantID,
    expectedMap,
  });
  const controlProvenance = buildRequestProvenance(control, {
    expectedEpisodeCount,
    expectedVariantID,
    expectedMap,
  });
  const allReplayHashes = [
    ...candidateEvidence.replay_hashes,
    ...controlEvidence.replay_hashes,
  ];
  const checks = {
    candidate_and_control_request_ids_exact_and_distinct:
      candidateProvenance.checks.request_id_exact &&
      controlProvenance.checks.request_id_exact &&
      candidate?.requestID !== control?.requestID,
    candidate_request_provenance_complete:
      candidateProvenance.evidence_passed,
    control_request_provenance_complete:
      controlProvenance.evidence_passed,
    candidate_strict_evidence_passed:
      candidateEvidence.evidence_passed,
    control_evidence_passed: controlEvidence.evidence_passed,
    pair_variant_identical:
      candidateProvenance.variant_id === controlProvenance.variant_id &&
      candidateProvenance.variant_id === expectedVariantID &&
      candidateProvenance.effective_variant_identity ===
        controlProvenance.effective_variant_identity &&
      candidateProvenance.effective_variant_identity ===
        canonicalVariantIdentity(expectedVariantID) &&
      sameJSON(
        candidateProvenance.episode_effective_variant_identities,
        controlProvenance.episode_effective_variant_identities,
      ) &&
      sameJSON(
        candidateProvenance.episode_variant_names,
        controlProvenance.episode_variant_names,
      ) &&
      candidate?.requestBody?.variant_id === control?.requestBody?.variant_id,
    pair_map_identical:
      sameJSON(candidateProvenance.maps, [expectedMap]) &&
      sameJSON(controlProvenance.maps, [expectedMap]),
    pair_seat_identical:
      candidateProvenance.roster_vector
        ?.find((participant) =>
          participant.player_id === expectedPlayerID &&
          participant.policy_id === expectedPolicyID
        )?.position === expectedParticipantPosition &&
      controlProvenance.roster_vector
        ?.find((participant) =>
          participant.player_id === expectedPlayerID &&
          participant.policy_id === expectedPolicyID
        )?.position === expectedParticipantPosition,
    pair_episode_count_identical:
      candidateProvenance.episode_count === controlProvenance.episode_count &&
      candidateProvenance.episode_count === expectedEpisodeCount &&
      candidate?.requestBody?.num_episodes ===
        control?.requestBody?.num_episodes,
    pair_coworld_identical:
      candidateProvenance.coworld_id === controlProvenance.coworld_id &&
      typeof candidateProvenance.coworld_id === "string" &&
      candidateProvenance.coworld_id.length > 0 &&
      sameJSON(
        candidateProvenance.episode_coworld_ids,
        controlProvenance.episode_coworld_ids,
      ),
    pair_coworld_version_identical:
      candidateProvenance.coworld_version ===
        controlProvenance.coworld_version &&
      typeof candidateProvenance.coworld_version === "string" &&
      candidateProvenance.coworld_version.length > 0 &&
      sameJSON(
        candidateProvenance.episode_coworld_versions,
        controlProvenance.episode_coworld_versions,
      ),
    pair_game_config_identical:
      candidateProvenance.game_config_sha256.length ===
        expectedEpisodeCount &&
      controlProvenance.game_config_sha256.length ===
        expectedEpisodeCount &&
      sameJSON(
        [...candidateProvenance.game_config_sha256].sort(),
        [...controlProvenance.game_config_sha256].sort(),
      ),
    request_bodies_differ_only_v5_to_candidate_at_hrafn:
      requestBodiesDifferOnlyAtHrafn(
        candidateProvenance.request_body_roster,
        controlProvenance.request_body_roster,
        expectedParticipantPosition,
      ),
    api_rosters_differ_only_v5_to_candidate_at_hrafn:
      apiRostersDifferOnlyAtHrafn(
        candidateProvenance.roster_vector,
        controlProvenance.roster_vector,
        {
          expectedParticipantPosition,
          expectedCandidatePolicyVersionID,
          expectedControlPolicyVersionID,
          expectedPlayerName,
          expectedPlayerID,
          expectedPolicyID,
        },
      ),
    all_pair_replay_hashes_unique:
      allReplayHashes.length === expectedEpisodeCount * 2 &&
      allReplayHashes.every((hash) =>
        /^[a-f0-9]{64}$/.test(String(hash ?? ""))
      ) &&
      new Set(allReplayHashes).size === allReplayHashes.length,
  };
  return {
    schema_version: 1,
    record_type: "hrafn_clean_chassis_c1_matched_hosted_xp_pair_gate",
    audit_scope: "candidate_4_of_4_plus_exact_v5_control",
    candidate_request_id: candidate?.requestID ?? null,
    control_request_id: control?.requestID ?? null,
    expected_candidate_policy_version_id:
      expectedCandidatePolicyVersionID ?? null,
    expected_control_policy_version_id:
      expectedControlPolicyVersionID ?? null,
    expected_player_name: expectedPlayerName,
    expected_player_id: expectedPlayerID ?? null,
    expected_policy_id: expectedPolicyID ?? null,
    candidate_request_provenance: candidateProvenance,
    control_request_provenance: controlProvenance,
    candidate_evidence: candidateEvidence,
    control_evidence: controlEvidence,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function coworldJson(args, cwd) {
  const result = spawnSync(
    "uvx",
    ["--from", COWORLD_PACKAGE, "coworld", ...args, "--json"],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `coworld ${args.join(" ")} failed: ${
        result.stderr || result.stdout
      }`,
    );
  }
  return JSON.parse(result.stdout);
}

function assertAllowedReplayURL(url, label) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_REPLAY_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      `refusing ${label} outside the replay allowlist: ${url}`,
    );
  }
  return parsed;
}

export async function downloadReplay(
  url,
  {
    fetchImpl = globalThis.fetch,
    maxBytes = MAX_REPLAY_BYTES,
  } = {},
) {
  assertAllowedReplayURL(url, "replay URL");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(120000),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `replay download failed (${response.status}): ${url}`,
    );
  }
  assertAllowedReplayURL(response.url, "final replay URL");
  const declaredHeader = response.headers.get("content-length");
  const declaredLength = declaredHeader === null
    ? null
    : Number(declaredHeader);
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    throw new Error(`replay exceeds byte limit ${maxBytes}: ${url}`);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error(`replay response has no readable body: ${url}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (totalBytes + chunk.length > maxBytes) {
        await reader.cancel("replay byte limit exceeded");
        throw new Error(`replay exceeds byte limit ${maxBytes}: ${url}`);
      }
      chunks.push(chunk);
      totalBytes += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function replayCacheName(episode) {
  const identifier = String(
    episode?.episode_id ?? episode?.id ?? "",
  );
  if (/^[a-zA-Z0-9_-]+$/.test(identifier)) {
    return `${identifier}.replay`;
  }
  const digest = sha256(Buffer.from(String(episode?.replay_url ?? "")));
  return `hrafn-c1-${digest}.replay`;
}

export async function freshReplayBytes(
  episode,
  cacheDir,
  { downloadReplayFn = downloadReplay } = {},
) {
  const destination = path.join(cacheDir, replayCacheName(episode));
  const bytes = await downloadReplayFn(episode.replay_url);
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("replay downloader did not return a Buffer");
  }
  if (bytes.length > MAX_REPLAY_BYTES) {
    throw new Error("replay downloader exceeded the hard 128 MiB limit");
  }
  await writeFile(destination, bytes);
  return { bytes, destination };
}

export function parseCliArguments(argv) {
  const requestID = argv[0];
  if (!/^xreq_[a-zA-Z0-9-]+$/.test(String(requestID ?? ""))) {
    throw new Error(
      "usage: node scripts/audit-hrafn-c1-xp-gate.mjs xreq_... " +
      "--control-request-id xreq_... " +
      "--candidate-request-body PATH --control-request-body PATH " +
      "--expected-policy-version-id UUID --control-policy-version-id UUID " +
      "--expected-player-id PLAYER_UUID --expected-policy-id POLICY_UUID " +
      "--expected-variant-id VARIANT --expected-map MAP " +
      "--expected-position N " +
      "[--player \"K1Z Hrafn\"] [--expected-episodes 4] " +
      "[--output PATH]",
    );
  }
  const values = new Map();
  const allowed = new Set([
    "control-request-id",
    "candidate-request-body",
    "control-request-body",
    "expected-policy-version-id",
    "control-policy-version-id",
    "expected-player-id",
    "expected-policy-id",
    "expected-variant-id",
    "expected-map",
    "expected-position",
    "player",
    "expected-episodes",
    "output",
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const name = separator >= 0
      ? argument.slice(2, separator)
      : argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error(`unknown option --${name}`);
    }
    const value = separator >= 0
      ? argument.slice(separator + 1)
      : argv[index + 1];
    if (!value || (separator < 0 && value.startsWith("--"))) {
      throw new Error(`--${name} requires a value`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} may only be provided once`);
    }
    values.set(name, value);
    if (separator < 0) index += 1;
  }
  const expectedPolicyVersionID = values.get(
    "expected-policy-version-id",
  );
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      String(expectedPolicyVersionID ?? ""),
    )
  ) {
    throw new Error(
      "--expected-policy-version-id must be an explicit UUID",
    );
  }
  if (expectedPolicyVersionID !== EXACT_C1_POLICY_VERSION_ID) {
    throw new Error(
      `--expected-policy-version-id must be exact C1 ${EXACT_C1_POLICY_VERSION_ID}`,
    );
  }
  const controlPolicyVersionID = values.get(
    "control-policy-version-id",
  );
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      String(controlPolicyVersionID ?? ""),
    )
  ) {
    throw new Error(
      "--control-policy-version-id must be an explicit UUID",
    );
  }
  if (controlPolicyVersionID !== EXACT_V5_POLICY_VERSION_ID) {
    throw new Error(
      `--control-policy-version-id must be exact v5 ${EXACT_V5_POLICY_VERSION_ID}`,
    );
  }
  const controlRequestID = values.get("control-request-id");
  if (!/^xreq_[a-zA-Z0-9-]+$/.test(String(controlRequestID ?? ""))) {
    throw new Error("--control-request-id must be an explicit xreq ID");
  }
  if (controlRequestID === requestID) {
    throw new Error("candidate and control request IDs must be distinct");
  }
  const candidateRequestBodyPath = values.get(
    "candidate-request-body",
  );
  const controlRequestBodyPath = values.get("control-request-body");
  if (!candidateRequestBodyPath || !controlRequestBodyPath) {
    throw new Error(
      "--candidate-request-body and --control-request-body are required",
    );
  }
  const expectedPlayerID = values.get("expected-player-id");
  if (expectedPlayerID !== EXACT_HRAFN_PLAYER_ID) {
    throw new Error(
      `--expected-player-id must be exact Hrafn ${EXACT_HRAFN_PLAYER_ID}`,
    );
  }
  const expectedPolicyID = values.get("expected-policy-id");
  if (expectedPolicyID !== EXACT_HRAFN_POLICY_ID) {
    throw new Error(
      `--expected-policy-id must be exact Hrafn ${EXACT_HRAFN_POLICY_ID}`,
    );
  }
  const expectedEpisodeCount = Number(
    values.get("expected-episodes") ?? DEFAULT_EXPECTED_EPISODES,
  );
  if (
    !Number.isInteger(expectedEpisodeCount) ||
    expectedEpisodeCount < 1
  ) {
    throw new Error("--expected-episodes must be a positive integer");
  }
  const expectedPlayerName = values.get("player") ??
    DEFAULT_PLAYER_NAME;
  if (expectedPlayerName.length === 0) {
    throw new Error("--player must not be empty");
  }
  const expectedVariantID = values.get("expected-variant-id");
  if (!expectedVariantID) {
    throw new Error("--expected-variant-id is required");
  }
  const expectedMap = values.get("expected-map");
  if (!expectedMap) {
    throw new Error("--expected-map is required");
  }
  const expectedParticipantPosition = Number(
    values.get("expected-position"),
  );
  if (
    !Number.isInteger(expectedParticipantPosition) ||
    expectedParticipantPosition < 0
  ) {
    throw new Error(
      "--expected-position must be a non-negative integer",
    );
  }
  return {
    requestID,
    controlRequestID,
    candidateRequestBodyPath,
    controlRequestBodyPath,
    expectedPolicyVersionID,
    controlPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
    expectedVariantID,
    expectedMap,
    expectedParticipantPosition,
    expectedEpisodeCount,
    expectedPlayerName,
    outputPath: values.get("output") ?? null,
  };
}

async function loadRequestBody(root, configuredPath) {
  const resolvedPath = path.resolve(root, configuredPath);
  const bytes = await readFile(resolvedPath);
  let body;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `request body is not valid JSON (${configuredPath}): ${error.message}`,
    );
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`request body must be an object: ${configuredPath}`);
  }
  return {
    body,
    path: path.relative(root, resolvedPath),
    sha256: sha256(bytes),
  };
}

async function auditRequestEpisodes(
  episodes,
  cacheDir,
  root,
  {
    role,
    expectedPlayerName,
    expectedPolicyVersionID,
    expectedPlayerID,
    expectedPolicyID,
  },
) {
  const audits = [];
  for (const episode of episodes) {
    if (episode?.status !== "completed" || !episode?.replay_url) {
      audits.push(unavailableEpisodeAudit(episode, {
        expectedPlayerName,
        expectedPolicyVersionID,
        expectedPlayerID,
        expectedPolicyID,
        role,
        error: episode?.status !== "completed"
          ? `episode status is ${episode?.status ?? "missing"}`
          : "completed episode is missing replay_url",
      }));
      continue;
    }
    try {
      const { bytes, destination } = await freshReplayBytes(
        episode,
        cacheDir,
      );
      const replay = JSON.parse(bytes.toString("utf8"));
      const auditOptions = {
        expectedPlayerName,
        expectedPolicyVersionID,
        expectedPlayerID,
        expectedPolicyID,
        replayPath: path.relative(root, destination),
      };
      audits.push(role === "candidate"
        ? auditHrafnC1XpEpisode(episode, replay, bytes, auditOptions)
        : auditHrafnControlXpEpisode(episode, replay, bytes, auditOptions));
    } catch (error) {
      audits.push(unavailableEpisodeAudit(episode, {
        expectedPlayerName,
        expectedPolicyVersionID,
        expectedPlayerID,
        expectedPolicyID,
        role,
        error: error?.message ?? error,
      }));
    }
  }
  return audits;
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const root = process.cwd();
  const candidateRequestBody = await loadRequestBody(
    root,
    options.candidateRequestBodyPath,
  );
  const controlRequestBody = await loadRequestBody(
    root,
    options.controlRequestBodyPath,
  );
  const candidateRequest = coworldJson(
    ["xp-request", "get", options.requestID],
    root,
  );
  const candidateEpisodes = coworldJson(
    ["xp-request", "episodes", options.requestID],
    root,
  );
  const controlRequest = coworldJson(
    ["xp-request", "get", options.controlRequestID],
    root,
  );
  const controlEpisodes = coworldJson(
    ["xp-request", "episodes", options.controlRequestID],
    root,
  );
  if (!Array.isArray(candidateEpisodes) || !Array.isArray(controlEpisodes)) {
    throw new Error(
      "coworld xp-request episodes did not return arrays for both requests",
    );
  }
  const cacheDir = path.join(root, "data", "cache", "replays");
  await mkdir(cacheDir, { recursive: true });
  const candidateAudits = await auditRequestEpisodes(
    candidateEpisodes,
    cacheDir,
    root,
    {
      role: "candidate",
      expectedPlayerName: options.expectedPlayerName,
      expectedPolicyVersionID: options.expectedPolicyVersionID,
      expectedPlayerID: options.expectedPlayerID,
      expectedPolicyID: options.expectedPolicyID,
    },
  );
  const controlAudits = await auditRequestEpisodes(
    controlEpisodes,
    cacheDir,
    root,
    {
      role: "control",
      expectedPlayerName: options.expectedPlayerName,
      expectedPolicyVersionID: options.controlPolicyVersionID,
      expectedPlayerID: options.expectedPlayerID,
      expectedPolicyID: options.expectedPolicyID,
    },
  );
  const report = buildHrafnC1XpPairGateReport({
    role: "candidate",
    requestID: options.requestID,
    request: candidateRequest,
    fetchedEpisodes: candidateEpisodes,
    requestBody: candidateRequestBody.body,
    requestBodyPath: candidateRequestBody.path,
    requestBodySHA256: candidateRequestBody.sha256,
    episodeAudits: candidateAudits,
  }, {
    role: "control",
    requestID: options.controlRequestID,
    request: controlRequest,
    fetchedEpisodes: controlEpisodes,
    requestBody: controlRequestBody.body,
    requestBodyPath: controlRequestBody.path,
    requestBodySHA256: controlRequestBody.sha256,
    episodeAudits: controlAudits,
  }, {
    expectedEpisodeCount: options.expectedEpisodeCount,
    expectedPlayerName: options.expectedPlayerName,
    expectedPlayerID: options.expectedPlayerID,
    expectedPolicyID: options.expectedPolicyID,
    expectedCandidatePolicyVersionID: options.expectedPolicyVersionID,
    expectedControlPolicyVersionID: options.controlPolicyVersionID,
    expectedVariantID: options.expectedVariantID,
    expectedMap: options.expectedMap,
    expectedParticipantPosition: options.expectedParticipantPosition,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized);
  }
  process.stdout.write(serialized);
  if (!report.passed) {
    process.exitCode =
      candidateRequest?.status === "completed" &&
        controlRequest?.status === "completed"
        ? 1
        : 2;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
