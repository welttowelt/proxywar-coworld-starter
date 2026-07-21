#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^xreq_[a-zA-Z0-9_-]+$/;
const MARKERS = new Set(["mm1g", "mm1c"]);
const PLAYER_DIRECTED_KINDS = new Set([
  "attack",
  "boat",
  "break_alliance",
  "embargo",
  "nuke",
  "target_player",
]);
const OPTIONAL_PLAYER_DIRECTED_KINDS = new Set(["move_warship"]);
const KIND_CODES = Object.freeze({
  attack: "atk",
  boat: "b0t",
  break_alliance: "brk",
  build: "bld",
  hold: "h0d",
  spawn: "spn",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function string(value, label) {
  assert(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys must be exactly ${expected.join(", ")}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function parseReplay(record, label) {
  object(record, label);
  string(record.episode_request_id, `${label}.episode_request_id`);
  assert(Buffer.isBuffer(record.bytes), `${label}.bytes must be a Buffer`);
  const actualSha256 = sha256(record.bytes);
  if (record.sha256 !== undefined) {
    assert(SHA256.test(record.sha256), `${label}.sha256 is invalid`);
    assert(record.sha256 === actualSha256, `${label}.sha256 mismatch`);
  }
  let replay;
  try {
    replay = JSON.parse(record.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  object(replay, label);
  return { replay, sha256: actualSha256 };
}

function parseDecisions(replay, label) {
  const raw = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  assert(typeof raw === "string", `${label} is missing inline decisions.jsonl`);
  const rows = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (line === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${label} decisions.jsonl line ${index + 1} is invalid: ${error.message}`);
    }
  }
  assert(rows.length > 0, `${label} decisions.jsonl is empty`);
  return rows;
}

function participantFor(episode, playerName, policyVersionID, policyRef, label) {
  assert(Array.isArray(episode?.participants), `${label}.participants must be an array`);
  const matches = episode.participants.filter((participant) =>
    participant.player_name === playerName && participant.policy_version_id === policyVersionID
  );
  assert(matches.length === 1, `${label} must contain exactly one expected policy participant`);
  const participant = matches[0];
  assert(participant.label === policyRef, `${label} participant policy ref mismatch`);
  assert(Number.isInteger(participant.position) && participant.position >= 0, `${label} participant position is invalid`);
  return participant;
}

function requestChecks(request, expectedEpisodes) {
  const episodes = Array.isArray(request?.episodes) ? request.episodes : [];
  return {
    request_completed: request?.status === "completed",
    exact_episode_count:
      request?.episode_count === expectedEpisodes &&
      request?.completed_count === expectedEpisodes &&
      request?.failed_count === 0 &&
      episodes.length === expectedEpisodes,
    all_episode_records_completed: episodes.every((episode) => episode?.status === "completed"),
  };
}

function requestRosterSignatures(request, playerName, policyVersionID, policyRef, label) {
  assert(Array.isArray(request?.episodes), `${label}.episodes must be an array`);
  return request.episodes.map((episode, index) => {
    const tested = participantFor(
      episode,
      playerName,
      policyVersionID,
      policyRef,
      `${label}.episodes[${index}]`,
    );
    const opponents = episode.participants
      .filter((participant) => participant !== tested)
      .map((participant) => [
        participant.player_id ?? null,
        participant.player_name ?? null,
        participant.policy_version_id ?? null,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return JSON.stringify({
      map: episode.game_config?.map ?? null,
      map_size: episode.game_config?.map_size ?? null,
      difficulty: episode.game_config?.difficulty ?? null,
      num_agents: episode.game_config?.num_agents ?? null,
      opponents,
    });
  }).sort();
}

export function compareMatchedRequests(candidateRequest, baselineRequest, candidate, baseline) {
  object(candidateRequest, "hosted request");
  object(baselineRequest, "baseline request");
  const candidateChecks = requestChecks(candidateRequest, 4);
  const baselineChecks = requestChecks(baselineRequest, 4);
  const candidateRosters = requestRosterSignatures(
    candidateRequest,
    candidate.player_name,
    candidate.policy_version_id,
    candidate.policy_ref,
    "hosted request",
  );
  const baselineRosters = requestRosterSignatures(
    baselineRequest,
    baseline.player_name,
    baseline.policy_version_id,
    baseline.policy_ref,
    "baseline request",
  );
  const checks = {
    distinct_request_ids:
      REQUEST_ID.test(candidateRequest.id ?? "") &&
      REQUEST_ID.test(baselineRequest.id ?? "") &&
      candidateRequest.id !== baselineRequest.id,
    candidate_request_completed: Object.values(candidateChecks).every(Boolean),
    baseline_request_completed: Object.values(baselineChecks).every(Boolean),
    same_variant:
      typeof candidateRequest.variant_id === "string" &&
      candidateRequest.variant_id !== "" &&
      candidateRequest.variant_id === baselineRequest.variant_id,
    same_roster_and_game_config: JSON.stringify(candidateRosters) === JSON.stringify(baselineRosters),
  };
  return {
    candidate_request_id: candidateRequest.id ?? null,
    baseline_request_id: baselineRequest.id ?? null,
    candidate_policy_version_id: candidate.policy_version_id,
    baseline_policy_version_id: baseline.policy_version_id,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function legalActionIDs(row) {
  if (Array.isArray(row.legalActionIDs)) return row.legalActionIDs;
  if (row.legalActionIDsByKind && typeof row.legalActionIDsByKind === "object") {
    return Object.values(row.legalActionIDsByKind).flatMap((ids) => Array.isArray(ids) ? ids : []);
  }
  return null;
}

function isK1zName(name) {
  return /^\[?k1z\]?(?:\s|_|-)/i.test(String(name ?? "").trim());
}

function harmfulTarget(row, replayPlayers, testedPlayerID) {
  const kind = String(row.selectedActionKind ?? "").toLowerCase();
  const metadata = row.selectedActionMetadata ?? {};
  if (kind === "embargo_all") {
    const affected = [...replayPlayers.values()].filter((player) =>
      player.playerID !== testedPlayerID && isK1zName(player.username)
    ).length;
    return { k1z_harm: affected, unresolved: false };
  }
  if (!PLAYER_DIRECTED_KINDS.has(kind) && !OPTIONAL_PLAYER_DIRECTED_KINDS.has(kind)) {
    return { k1z_harm: 0, unresolved: false };
  }
  const targetID = metadata.targetID ?? metadata.recipientID ?? null;
  const targetName = metadata.targetName ?? metadata.recipientName ?? null;
  if (targetID === null) {
    const neutralExpansion =
      (kind === "attack" || kind === "boat") && metadata.expansion === true;
    return { k1z_harm: 0, unresolved: !neutralExpansion };
  }
  if (typeof targetID !== "string" || targetID === "" || typeof targetName !== "string" || targetName === "") {
    return { k1z_harm: 0, unresolved: true };
  }
  const target = replayPlayers.get(targetID);
  if (!target || target.username !== targetName) return { k1z_harm: 0, unresolved: true };
  return {
    k1z_harm: target.playerID !== testedPlayerID && isK1zName(target.username) ? 1 : 0,
    unresolved: false,
  };
}

function markerSemantics(row, marker) {
  const metadata = row.selectedActionMetadata ?? {};
  const kind = String(row.selectedActionKind ?? "").toLowerCase();
  if (marker === "mm1g") {
    return (kind === "attack" || kind === "boat") &&
      metadata.expansion === true &&
      (metadata.targetID ?? null) === null &&
      String(metadata.targetName ?? "Terra Nullius") === "Terra Nullius";
  }
  return (kind === "attack" || kind === "boat") &&
    typeof metadata.targetID === "string" && metadata.targetID !== "" &&
    typeof metadata.targetName === "string" && metadata.targetName !== "" &&
    !isK1zName(metadata.targetName);
}

export function auditMickeyHostedEpisode(episode, replayRecord, candidate, label = "hosted episode") {
  object(episode, label);
  assert(MARKERS.has(candidate.marker), "candidate.marker must be mm1g or mm1c");
  const { replay, sha256: replaySha256 } = parseReplay(replayRecord, `${label} replay`);
  const participant = participantFor(
    episode,
    candidate.player_name,
    candidate.policy_version_id,
    candidate.policy_ref,
    label,
  );
  const position = participant.position;
  const finalPlayers = replay?.finalState?.players;
  assert(Array.isArray(finalPlayers), `${label} replay is missing finalState.players`);
  assert(finalPlayers.length === episode.participants.length, `${label} replay roster length mismatch`);
  assert(finalPlayers[position]?.username === candidate.player_name, `${label} replay tested-player position mismatch`);
  const replayPlayers = new Map();
  for (const [index, player] of finalPlayers.entries()) {
    string(player?.playerID, `${label} replay player ${index} ID`);
    string(player?.username, `${label} replay player ${index} username`);
    assert(!replayPlayers.has(player.playerID), `${label} replay has duplicate player ID`);
    replayPlayers.set(player.playerID, player);
  }
  const testedPlayerID = finalPlayers[position].playerID;
  assert(replay?.config?.map === episode.game_config?.map, `${label} replay map mismatch`);

  const rows = parseDecisions(replay, label).filter((row) => slotFromAgentID(row.agentID) === position);
  assert(rows.length > 0, `${label} has no tested-player decisions`);
  assert(rows.every((row) => row.username === candidate.player_name), `${label} decision username mismatch`);
  const scoreRows = (episode.scores ?? []).filter((score) => score.policy_version_id === candidate.policy_version_id);
  assert(scoreRows.length === 1, `${label} must contain exactly one tested-policy score`);
  const score = Number(scoreRows[0].score);
  assert(Number.isFinite(score), `${label} tested-policy score is invalid`);
  const replayWon = replay?.results?.winner_slot === position;

  let accepted = 0;
  let rejected = 0;
  let unconfirmedAcceptance = 0;
  let illegalSelections = 0;
  let holds = 0;
  let unexplainedHolds = 0;
  let k1zHarm = 0;
  let unresolvedHarmfulTargets = 0;
  let markerCount = 0;
  let nondegradedMarkerCount = 0;
  let invalidMarkerCount = 0;
  let otherMm1MarkerCount = 0;
  const markerExecutions = [];

  for (const row of rows) {
    const acceptedDecision = row.result?.accepted === true;
    if (acceptedDecision) accepted += 1;
    else if (row.result?.accepted === false) rejected += 1;
    else unconfirmedAcceptance += 1;

    const ids = legalActionIDs(row);
    const selectedID = row.selectedLegalActionId;
    const legalSelection = Array.isArray(ids) &&
      typeof selectedID === "string" && ids.includes(selectedID);
    if (!legalSelection) illegalSelections += 1;

    if (String(row.selectedActionKind ?? "").toLowerCase() === "hold") {
      holds += 1;
      if (!Array.isArray(ids) || ids.some((id) => typeof id === "string" && id !== "hold")) {
        unexplainedHolds += 1;
      }
    }

    const target = harmfulTarget(row, replayPlayers, testedPlayerID);
    k1zHarm += target.k1z_harm;
    if (target.unresolved) unresolvedHarmfulTargets += 1;

    const reason = String(row.reason ?? "").toLowerCase();
    const reasonMatch = reason.match(/^(pln|rul|dgd):([a-z0-9]+):(mm1[gc])$/);
    if (!reasonMatch) continue;
    const marker = reasonMatch[3];
    const expectedKindCode = KIND_CODES[String(row.selectedActionKind ?? "").toLowerCase()] ?? null;
    const valid =
      reasonMatch[1] === "pln" &&
      reasonMatch[2] === expectedKindCode &&
      row.fallbackUsed === false &&
      row.llmPlannerDegraded === false &&
      acceptedDecision &&
      legalSelection &&
      markerSemantics(row, marker);
    if (marker === candidate.marker) {
      markerCount += 1;
      if (valid) nondegradedMarkerCount += 1;
    } else {
      otherMm1MarkerCount += 1;
    }
    if (!valid) invalidMarkerCount += 1;
    markerExecutions.push({
      turn: row.turnNumber ?? null,
      marker,
      reason,
      selected_action_id: selectedID ?? null,
      selected_action_kind: row.selectedActionKind ?? null,
      accepted: acceptedDecision,
      legal_selection: legalSelection,
      nondegraded: valid,
    });
  }

  return {
    episode_request_id: episode.id ?? null,
    episode_id: episode.episode_id ?? null,
    replay_sha256: replaySha256,
    map: episode.game_config?.map ?? null,
    seat: position,
    policy_version_id: candidate.policy_version_id,
    score,
    won: score === 1 && replayWon,
    decisions: rows.length,
    accepted,
    rejected,
    unconfirmed_acceptance: unconfirmedAcceptance,
    illegal_selections: illegalSelections,
    holds,
    unexplained_holds: unexplainedHolds,
    k1z_harm_count: k1zHarm,
    unresolved_harmful_targets: unresolvedHarmfulTargets,
    selected_marker: candidate.marker,
    marker_count: markerCount,
    nondegraded_marker_count: nondegradedMarkerCount,
    invalid_marker_count: invalidMarkerCount,
    other_mm1_marker_count: otherMm1MarkerCount,
    marker_executions: markerExecutions,
  };
}

function auditExperience(request, replayRecords, candidate, expectedEpisodes, { requireMarker }) {
  object(request, "experience request");
  assert(Array.isArray(request.episodes), "experience request episodes must be an array");
  assert(Array.isArray(replayRecords), "experience replay evidence must be an array");
  const byEpisodeRequestID = new Map();
  for (const [index, record] of replayRecords.entries()) {
    const id = string(record?.episode_request_id, `replays[${index}].episode_request_id`);
    assert(!byEpisodeRequestID.has(id), `duplicate replay evidence for ${id}`);
    byEpisodeRequestID.set(id, record);
  }
  const requestEpisodeIDs = request.episodes.map((episode) => episode.id);
  assert(new Set(requestEpisodeIDs).size === requestEpisodeIDs.length, "experience request has duplicate episode IDs");
  assert(
    replayRecords.length === request.episodes.length &&
    [...byEpisodeRequestID.keys()].every((id) => requestEpisodeIDs.includes(id)),
    "replay evidence set does not exactly match the experience request",
  );
  const episodes = request.episodes.map((episode, index) =>
    auditMickeyHostedEpisode(
      episode,
      byEpisodeRequestID.get(episode.id),
      candidate,
      `experience ${request.id ?? "unknown"} episode ${index + 1}`,
    )
  );
  const requestGateChecks = requestChecks(request, expectedEpisodes);
  const decisions = episodes.reduce((sum, episode) => sum + episode.decisions, 0);
  const accepted = episodes.reduce((sum, episode) => sum + episode.accepted, 0);
  const markerCount = episodes.reduce((sum, episode) => sum + episode.marker_count, 0);
  const nondegradedMarkerCount = episodes.reduce((sum, episode) => sum + episode.nondegraded_marker_count, 0);
  const checks = {
    ...requestGateChecks,
    exact_replay_evidence_count: episodes.length === expectedEpisodes,
    perfect_episode_wins: episodes.length === expectedEpisodes && episodes.every((episode) => episode.won),
    all_decisions_accepted:
      decisions > 0 && accepted === decisions &&
      episodes.every((episode) => episode.unconfirmed_acceptance === 0),
    all_selected_actions_legal: episodes.every((episode) => episode.illegal_selections === 0),
    zero_rejected_decisions: episodes.every((episode) => episode.rejected === 0),
    zero_unexplained_holds: episodes.every((episode) => episode.unexplained_holds === 0),
    zero_k1z_harm: episodes.every((episode) => episode.k1z_harm_count === 0),
    zero_unresolved_harmful_targets:
      episodes.every((episode) => episode.unresolved_harmful_targets === 0),
    selected_marker_reached: !requireMarker || markerCount >= 1,
    selected_marker_nondegraded:
      !requireMarker || (nondegradedMarkerCount === markerCount && markerCount >= 1),
    zero_invalid_marker_executions:
      episodes.every((episode) => episode.invalid_marker_count === 0),
  };
  return {
    request_id: request.id ?? null,
    status: request.status ?? null,
    expected_episodes: expectedEpisodes,
    episodes: episodes.length,
    wins: episodes.filter((episode) => episode.won).length,
    decisions,
    accepted,
    rejected: episodes.reduce((sum, episode) => sum + episode.rejected, 0),
    unconfirmed_acceptance: episodes.reduce((sum, episode) => sum + episode.unconfirmed_acceptance, 0),
    illegal_selections: episodes.reduce((sum, episode) => sum + episode.illegal_selections, 0),
    holds: episodes.reduce((sum, episode) => sum + episode.holds, 0),
    unexplained_holds: episodes.reduce((sum, episode) => sum + episode.unexplained_holds, 0),
    k1z_harm_count: episodes.reduce((sum, episode) => sum + episode.k1z_harm_count, 0),
    unresolved_harmful_targets:
      episodes.reduce((sum, episode) => sum + episode.unresolved_harmful_targets, 0),
    selected_marker: candidate.marker,
    marker_count: markerCount,
    nondegraded_marker_count: nondegradedMarkerCount,
    invalid_marker_count: episodes.reduce((sum, episode) => sum + episode.invalid_marker_count, 0),
    checks,
    passed: Object.values(checks).every(Boolean),
    episode_audits: episodes,
  };
}

function auditProbeExperience(request, replayRecords, candidate) {
  object(request, "hosted probe request");
  assert(Array.isArray(request.episodes), "hosted probe request episodes must be an array");
  assert(Array.isArray(replayRecords), "hosted probe replay evidence must be an array");
  const expectedEpisodes = Number(request.episode_count);
  assert(Number.isSafeInteger(expectedEpisodes) && expectedEpisodes > 0,
    "hosted probe request must contain at least one episode");
  const byEpisodeRequestID = new Map();
  for (const [index, record] of replayRecords.entries()) {
    const id = string(record?.episode_request_id, `probe replays[${index}].episode_request_id`);
    assert(!byEpisodeRequestID.has(id), `duplicate probe replay evidence for ${id}`);
    byEpisodeRequestID.set(id, record);
  }
  const requestEpisodeIDs = request.episodes.map((episode) => episode.id);
  assert(new Set(requestEpisodeIDs).size === requestEpisodeIDs.length,
    "hosted probe request has duplicate episode IDs");
  assert(
    replayRecords.length === request.episodes.length &&
      [...byEpisodeRequestID.keys()].every((id) => requestEpisodeIDs.includes(id)),
    "probe replay evidence set does not exactly match the request",
  );
  const episodeCandidate = {
    marker: candidate.marker,
    player_name: "K1Z Mickey Mouse",
    policy_ref: candidate.uploaded_label,
    policy_version_id: candidate.policy_version_id,
  };
  const episodes = request.episodes.map((episode, index) => {
    const participant = participantFor(
      episode,
      episodeCandidate.player_name,
      episodeCandidate.policy_version_id,
      episodeCandidate.policy_ref,
      `hosted probe ${request.id ?? "unknown"} episode ${index + 1}`,
    );
    assert(
      participant.player_id === candidate.player_id,
      `hosted probe ${request.id ?? "unknown"} episode ${index + 1} player ID mismatch`,
    );
    return auditMickeyHostedEpisode(
      episode,
      byEpisodeRequestID.get(episode.id),
      episodeCandidate,
      `hosted probe ${request.id ?? "unknown"} episode ${index + 1}`,
    );
  });
  const requestGateChecks = requestChecks(request, expectedEpisodes);
  const decisions = episodes.reduce((sum, episode) => sum + episode.decisions, 0);
  const accepted = episodes.reduce((sum, episode) => sum + episode.accepted, 0);
  const rejected = episodes.reduce((sum, episode) => sum + episode.rejected, 0);
  const unconfirmedAcceptance = episodes.reduce(
    (sum, episode) => sum + episode.unconfirmed_acceptance,
    0,
  );
  const illegalSelections = episodes.reduce((sum, episode) => sum + episode.illegal_selections, 0);
  const unexplainedHolds = episodes.reduce((sum, episode) => sum + episode.unexplained_holds, 0);
  const k1zHarm = episodes.reduce((sum, episode) => sum + episode.k1z_harm_count, 0);
  const unresolvedTargets = episodes.reduce(
    (sum, episode) => sum + episode.unresolved_harmful_targets,
    0,
  );
  const markerCount = episodes.reduce((sum, episode) => sum + episode.marker_count, 0);
  const nondegradedMarkerCount = episodes.reduce(
    (sum, episode) => sum + episode.nondegraded_marker_count,
    0,
  );
  const invalidMarkerCount = episodes.reduce(
    (sum, episode) => sum + episode.invalid_marker_count,
    0,
  );
  const checks = {
    ...requestGateChecks,
    at_least_one_completed_episode: episodes.length > 0,
    exact_replay_evidence_count: episodes.length === expectedEpisodes,
    all_decisions_accepted: decisions > 0 && accepted === decisions,
    zero_unconfirmed_acceptance: unconfirmedAcceptance === 0,
    all_selected_actions_legal: illegalSelections === 0,
    zero_rejected_decisions: rejected === 0,
    zero_unexplained_holds: unexplainedHolds === 0,
    zero_k1z_harm: k1zHarm === 0,
    zero_unresolved_harmful_targets: unresolvedTargets === 0,
    selected_marker_reached: markerCount >= 1,
    selected_marker_nondegraded:
      nondegradedMarkerCount === markerCount && markerCount >= 1,
    zero_invalid_marker_executions: invalidMarkerCount === 0,
  };
  return {
    request_id: request.id ?? null,
    status: request.status ?? null,
    passed: Object.values(checks).every(Boolean),
    episodes: episodes.length,
    completed_episodes: Number(request.completed_count ?? 0),
    wins: episodes.filter((episode) => episode.won).length,
    decisions,
    accepted,
    rejected,
    unconfirmed_acceptance: unconfirmedAcceptance,
    illegal_selections: illegalSelections,
    holds: episodes.reduce((sum, episode) => sum + episode.holds, 0),
    unexplained_holds: unexplainedHolds,
    k1z_harm_count: k1zHarm,
    unresolved_harmful_targets: unresolvedTargets,
    selected_marker: candidate.marker,
    marker_count: markerCount,
    nondegraded_marker_count: nondegradedMarkerCount,
    invalid_marker_count: invalidMarkerCount,
    checks,
    episode_audits: episodes,
  };
}

export function auditMickeyHostedProbe({ candidate, probeRequest, probeReplays }) {
  exactKeys(
    candidate,
    [
      "image_id",
      "league_id",
      "marker",
      "player_id",
      "policy_ref",
      "policy_version_id",
      "source_commit",
      "uploaded_label",
    ],
    "probe candidate",
  );
  assert(/^ply_[0-9a-f-]{36}$/i.test(candidate.player_id), "probe candidate.player_id is invalid");
  assert(/^league_[0-9a-f-]{36}$/i.test(candidate.league_id), "probe candidate.league_id is invalid");
  assert(/^[0-9a-f]{40}$/.test(candidate.source_commit), "probe candidate.source_commit is invalid");
  assert(/^sha256:[0-9a-f]{64}$/.test(candidate.image_id), "probe candidate.image_id is invalid");
  string(candidate.policy_ref, "probe candidate.policy_ref");
  string(candidate.uploaded_label, "probe candidate.uploaded_label");
  string(candidate.policy_version_id, "probe candidate.policy_version_id");
  assert(MARKERS.has(candidate.marker), "probe candidate.marker must be mm1g or mm1c");
  const probe = auditProbeExperience(probeRequest, probeReplays, candidate);
  return {
    schema_version: 1,
    kind: "mickey_hosted_probe_audit",
    evidence_scope: "hosted_probe_only",
    candidate: { ...candidate },
    probe,
    confirmation: {
      experimental_hosted_probe_passed: probe.passed,
      hosted_4_of_4_passed: false,
      regression_20_of_20_passed: false,
      promotion_allowed: false,
    },
  };
}

export function auditMickeyHostedEvidence({
  candidate,
  baseline,
  baselineRequest,
  hostedRequest,
  hostedReplays,
  regressionRequest = null,
  regressionReplays = null,
}) {
  exactKeys(candidate, ["marker", "player_name", "policy_ref", "policy_version_id"], "candidate");
  exactKeys(baseline, ["player_name", "policy_ref", "policy_version_id"], "baseline");
  string(candidate.player_name, "candidate.player_name");
  string(candidate.policy_ref, "candidate.policy_ref");
  string(candidate.policy_version_id, "candidate.policy_version_id");
  assert(MARKERS.has(candidate.marker), "candidate.marker must be mm1g or mm1c");
  string(baseline.player_name, "baseline.player_name");
  string(baseline.policy_ref, "baseline.policy_ref");
  string(baseline.policy_version_id, "baseline.policy_version_id");
  assert(candidate.policy_version_id !== baseline.policy_version_id, "candidate and baseline policy versions must differ");

  const matched = compareMatchedRequests(hostedRequest, baselineRequest, candidate, baseline);
  const hosted = auditExperience(hostedRequest, hostedReplays, candidate, 4, { requireMarker: true });
  let regression = {
    status: "not_provided",
    request_id: null,
    expected_episodes: 20,
    passed: false,
    checks: {
      separate_request_id: false,
      separate_replay_evidence: false,
      regression_evidence_provided: false,
    },
  };
  if (regressionRequest !== null || regressionReplays !== null) {
    assert(regressionRequest !== null && regressionReplays !== null, "regression request and replays must be provided together");
    const audited = auditExperience(regressionRequest, regressionReplays, candidate, 20, { requireMarker: false });
    const hostedHashes = new Set(hosted.episode_audits.map((episode) => episode.replay_sha256));
    const regressionHashes = audited.episode_audits.map((episode) => episode.replay_sha256);
    const separationChecks = {
      separate_request_id:
        REQUEST_ID.test(regressionRequest.id ?? "") && regressionRequest.id !== hostedRequest.id,
      separate_replay_evidence: regressionHashes.every((digest) => !hostedHashes.has(digest)),
      regression_evidence_provided: true,
    };
    regression = {
      ...audited,
      checks: { ...audited.checks, ...separationChecks },
      passed: audited.passed && Object.values(separationChecks).every(Boolean),
    };
  }
  const hostedFourOfFour = matched.passed && hosted.passed;
  const regressionTwentyOfTwenty = regression.passed;
  return {
    schema_version: 1,
    kind: "mickey_hosted_evidence_audit",
    evidence_scope: "hosted_and_regression_only",
    candidate: { ...candidate },
    baseline: { ...baseline },
    matched_baseline: matched,
    hosted,
    regression,
    confirmation: {
      matched_hosted_4_of_4_passed: hostedFourOfFour,
      separate_regression_20_of_20_passed: regressionTwentyOfTwenty,
      hosted_and_regression_evidence_passed: hostedFourOfFour && regressionTwentyOfTwenty,
      final_rci_still_required: true,
      live_identity_submission_membership_still_required: true,
      promotion_allowed: false,
    },
  };
}

async function readPinnedJson(reference, manifestDirectory, label) {
  exactKeys(reference, ["path", "sha256"], label);
  assert(SHA256.test(reference.sha256), `${label}.sha256 is invalid`);
  const resolved = path.isAbsolute(reference.path)
    ? reference.path
    : path.resolve(manifestDirectory, reference.path);
  const info = await lstat(resolved).catch(() => null);
  assert(info?.isFile() && !info.isSymbolicLink(), `${label}.path is missing or unsafe`);
  const bytes = await readFile(resolved);
  assert(sha256(bytes) === reference.sha256, `${label}.sha256 mismatch`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}.path is invalid JSON: ${error.message}`);
  }
  return { value: object(value, label), bytes, sha256: reference.sha256 };
}

async function loadExperience(section, manifestDirectory, label) {
  exactKeys(section, ["replays", "request"], label);
  assert(Array.isArray(section.replays), `${label}.replays must be an array`);
  const request = await readPinnedJson(section.request, manifestDirectory, `${label}.request`);
  const replays = [];
  for (const [index, reference] of section.replays.entries()) {
    exactKeys(reference, ["episode_request_id", "path", "sha256"], `${label}.replays[${index}]`);
    const replay = await readPinnedJson(
      { path: reference.path, sha256: reference.sha256 },
      manifestDirectory,
      `${label}.replays[${index}]`,
    );
    replays.push({
      episode_request_id: reference.episode_request_id,
      bytes: replay.bytes,
      sha256: replay.sha256,
    });
  }
  return { request: request.value, replays };
}

export async function auditMickeyHostedEvidenceManifest(manifestPath, manifestSha256) {
  assert(path.isAbsolute(manifestPath), "manifest path must be absolute");
  assert(SHA256.test(manifestSha256), "manifest SHA-256 is invalid");
  const manifestInfo = await lstat(manifestPath).catch(() => null);
  assert(manifestInfo?.isFile() && !manifestInfo.isSymbolicLink(), "manifest is missing or unsafe");
  const manifestBytes = await readFile(manifestPath);
  assert(sha256(manifestBytes) === manifestSha256, "manifest SHA-256 mismatch");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`manifest is invalid JSON: ${error.message}`);
  }
  exactKeys(
    manifest,
    ["baseline", "candidate", "hosted", "kind", "regression", "schema_version"],
    "manifest",
  );
  assert(manifest.schema_version === 1, "manifest.schema_version must be 1");
  assert(manifest.kind === "mickey_hosted_evidence_manifest", "manifest.kind is invalid");
  exactKeys(manifest.baseline, ["evidence", "player_name", "policy_ref", "policy_version_id"], "manifest.baseline");
  const directory = path.dirname(manifestPath);
  const baselineRequest = await readPinnedJson(
    manifest.baseline.evidence,
    directory,
    "manifest.baseline.evidence",
  );
  const hosted = await loadExperience(manifest.hosted, directory, "manifest.hosted");
  const regression = manifest.regression === null
    ? null
    : await loadExperience(manifest.regression, directory, "manifest.regression");
  return auditMickeyHostedEvidence({
    candidate: manifest.candidate,
    baseline: {
      player_name: manifest.baseline.player_name,
      policy_ref: manifest.baseline.policy_ref,
      policy_version_id: manifest.baseline.policy_version_id,
    },
    baselineRequest: baselineRequest.value,
    hostedRequest: hosted.request,
    hostedReplays: hosted.replays,
    regressionRequest: regression?.request ?? null,
    regressionReplays: regression?.replays ?? null,
  });
}

export async function auditMickeyHostedProbeManifest(manifestPath, manifestSha256) {
  assert(path.isAbsolute(manifestPath), "manifest path must be absolute");
  assert(SHA256.test(manifestSha256), "manifest SHA-256 is invalid");
  const manifestInfo = await lstat(manifestPath).catch(() => null);
  assert(manifestInfo?.isFile() && !manifestInfo.isSymbolicLink(), "manifest is missing or unsafe");
  const manifestBytes = await readFile(manifestPath);
  assert(sha256(manifestBytes) === manifestSha256, "manifest SHA-256 mismatch");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`manifest is invalid JSON: ${error.message}`);
  }
  exactKeys(manifest, ["candidate", "kind", "probe", "schema_version"], "manifest");
  assert(manifest.schema_version === 1, "manifest.schema_version must be 1");
  assert(manifest.kind === "mickey_hosted_probe_manifest", "manifest.kind is invalid");
  const directory = path.dirname(manifestPath);
  const probe = await loadExperience(manifest.probe, directory, "manifest.probe");
  return auditMickeyHostedProbe({
    candidate: manifest.candidate,
    probeRequest: probe.request,
    probeReplays: probe.replays,
  });
}

async function cli(argv) {
  const options = { manifest: null, manifestSha256: null, write: null };
  let requireComplete = false;
  let probeMode = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--require-complete") {
      assert(!requireComplete, "--require-complete is duplicated");
      requireComplete = true;
      continue;
    }
    if (argv[index] === "--probe") {
      assert(!probeMode, "--probe is duplicated");
      probeMode = true;
      continue;
    }
    const field = {
      "--manifest": "manifest",
      "--manifest-sha256": "manifestSha256",
      "--write": "write",
    }[argv[index]];
    assert(field && index + 1 < argv.length && options[field] === null, `unknown, duplicate, or incomplete option: ${argv[index]}`);
    options[field] = argv[++index];
  }
  assert(options.manifest && options.manifestSha256, "--manifest and --manifest-sha256 are required");
  const report = probeMode
    ? await auditMickeyHostedProbeManifest(path.resolve(options.manifest), options.manifestSha256)
    : await auditMickeyHostedEvidenceManifest(path.resolve(options.manifest), options.manifestSha256);
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (options.write) await writeFile(path.resolve(options.write), encoded, { flag: "wx", mode: 0o600 });
  process.stdout.write(encoded);
  const complete = probeMode
    ? report.confirmation.experimental_hosted_probe_passed
    : report.confirmation.hosted_and_regression_evidence_passed;
  if (requireComplete && !complete) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`MICKEY_HOSTED_EVIDENCE_AUDIT_FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
