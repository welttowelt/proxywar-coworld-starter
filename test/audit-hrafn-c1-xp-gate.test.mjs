import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditHrafnC1XpEpisode,
  auditHrafnControlXpEpisode,
  buildHrafnC1XpPairGateReport,
  buildHrafnC1XpGateReport,
  downloadReplay,
  freshReplayBytes,
  parseCliArguments,
  productiveHrafnC1MarkerCounts,
} from "../scripts/audit-hrafn-c1-xp-gate.mjs";

const EXPECTED_POLICY_VERSION_ID =
  "0b444466-abdd-422f-82e7-7652360a2015";
const CONTROL_POLICY_VERSION_ID =
  "10c32300-4593-408a-a17d-02e1d70e4a2e";
const EXPECTED_PLAYER_NAME = "K1Z Hrafn";
const EXPECTED_PLAYER_ID =
  "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
const EXPECTED_POLICY_ID =
  "e483e9fe-7c3a-4e7b-9e67-3140b17a3de2";
const EXPECTED_VARIANT_ID = "tournament-12p-world";
const EXPECTED_MAP = "World";
const EXPECTED_PARTICIPANT_POSITION = 5;

const AUTHORITATIVE_CHECK_NAMES = [
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

function passingAuthoritativeAudit(index) {
  return {
    schema_version: 2,
    record_type: "hrafn_clean_chassis_replay_audit",
    audit_scope: "replay_safety_only",
    replay_sha256: String(index).padStart(64, "a"),
    policy_decisions: 12,
    accepted: 12,
    rejected: 0,
    holds: 0,
    verified_holds: [],
    unexplained_holds: [],
    hold_evidence_gaps: [],
    fallbacks: 0,
    fallback_evidence_failures: [],
    planner_degradation_failures: [],
    harmful_k1z_actions: [],
    marker_counts: { hg35: 3, hec1: 1, hhfc: 1 },
    checks: Object.fromEntries(
      AUTHORITATIVE_CHECK_NAMES.map((name) => [name, true]),
    ),
  };
}

function passingEpisode(index) {
  return {
    episode_request_id: `ereq-${index}`,
    episode_id: `episode-${index}`,
    status: "completed",
    map: "World",
    participant_position: 5,
    exact_name_match_count: 1,
    exact_policy_version_match_count: 1,
    exact_player_id_match_count: 1,
    exact_policy_id_match_count: 1,
    exact_joint_match_count: 1,
    participant_position_consistent: true,
    bound_player_name: EXPECTED_PLAYER_NAME,
    bound_policy_version_id: EXPECTED_POLICY_VERSION_ID,
    bound_player_id: EXPECTED_PLAYER_ID,
    bound_policy_id: EXPECTED_POLICY_ID,
    result_player_slot: 5,
    result_player_slot_bound: true,
    outcome_evidence_consistent: true,
    decision_agent_binding_complete: true,
    decision_agent_policy_decisions: 12,
    decision_agent_ids: ["opportunistic-agent-6"],
    decision_agent_positions: [5],
    expected_decision_agent_id: "opportunistic-agent-6",
    replay_complete: true,
    replay_sha256: String(index).padStart(64, "a"),
    score: 1,
    won: true,
    win_evidence_consistent: true,
    productive_marker_count: 4,
    productive_marker_counts: { hg35: 3, hec1: 1 },
    audit_error: null,
    authoritative_audit: passingAuthoritativeAudit(index),
  };
}

function passingRequest() {
  return {
    id: "xreq-test",
    status: "completed",
    error: null,
    variant_id: EXPECTED_VARIANT_ID,
    episode_count: 4,
    pending_count: 0,
    submitted_count: 0,
    running_count: 0,
    completed_count: 4,
    failed_count: 0,
  };
}

function report(request = passingRequest(), episodes = [1, 2, 3, 4].map(
  passingEpisode,
)) {
  return buildHrafnC1XpGateReport(request, episodes, {
    expectedEpisodeCount: 4,
    expectedPlayerName: EXPECTED_PLAYER_NAME,
    expectedPolicyVersionID: EXPECTED_POLICY_VERSION_ID,
    expectedPlayerID: EXPECTED_PLAYER_ID,
    expectedPolicyID: EXPECTED_POLICY_ID,
    expectedVariantID: EXPECTED_VARIANT_ID,
    expectedMap: EXPECTED_MAP,
    expectedParticipantPosition: EXPECTED_PARTICIPANT_POSITION,
  });
}

function minimalCompletedEpisode() {
  return {
    id: "ereq-real-shape",
    episode_id: "episode-real-shape",
    status: "completed",
    replay_url:
      "https://softmax-public.s3.amazonaws.com/replays/test.replay",
    game_config: { map: "World" },
    participants: [
      {
        position: 0,
        player_name: EXPECTED_PLAYER_NAME,
        player_id: EXPECTED_PLAYER_ID,
        policy_id: EXPECTED_POLICY_ID,
        policy_version_id: EXPECTED_POLICY_VERSION_ID,
      },
      {
        position: 1,
        player_name: "Outsider",
        player_id: "ply-outsider",
        policy_id: "policy-outsider",
        policy_version_id: "11111111-1111-1111-1111-111111111111",
      },
    ],
    scores: [
      {
        policy_version_id: EXPECTED_POLICY_VERSION_ID,
        score: 1,
      },
      {
        policy_version_id: "11111111-1111-1111-1111-111111111111",
        score: 0,
      },
    ],
  };
}

function minimalWinningReplay() {
  const decision = {
    username: EXPECTED_PLAYER_NAME,
    agentID: "opportunistic-agent-1",
    turnNumber: 100,
    selectedLegalActionId: "expand:terra-nullius:35",
    selectedActionKind: "attack",
    selectedActionMetadata: {
      expansion: true,
      troopPercent: 35,
      troops: 35,
    },
    legalActionIDs: ["expand:terra-nullius:35"],
    legalActionIDsByKind: {
      attack: ["expand:terra-nullius:35"],
    },
    reason: "[K1Z] r4vn:atk:hg35",
    fallbackUsed: false,
    llmPlannerDegraded: false,
    auditBefore: { playerID: "runtime-hrafn" },
    result: {
      accepted: true,
      submittedIntent: {
        type: "attack",
        targetID: null,
        troops: 35,
      },
    },
  };
  return {
    gameID: "C1-XP-TEST",
    inlineRunArtifacts: {
      "decisions.jsonl": `${JSON.stringify(decision)}\n`,
    },
    results: {
      winner_slot: 0,
      scores: [1, 0],
      players: [
        {
          slot: 0,
          name: EXPECTED_PLAYER_NAME,
          playerID: "runtime-hrafn",
          score: 1,
        },
      {
          slot: 1,
          name: "Outsider",
          playerID: "runtime-outsider",
          score: 0,
        },
      ],
    },
    finalState: {
      winnerSlot: 0,
      players: [
        {
          username: EXPECTED_PLAYER_NAME,
          playerID: "runtime-hrafn",
        },
        {
          username: "Outsider",
          playerID: "runtime-outsider",
        },
      ],
    },
  };
}

const PAIR_POSITION = 1;

function pairParticipants(policyVersionID, label, version) {
  return [
    {
      position: 0,
      policy_version_id: "11111111-1111-1111-1111-111111111111",
      policy_id: "policy-auri",
      policy_name: "auri",
      version: 1,
      player_id: "ply-auri",
      player_name: "Auri",
      is_filler: false,
      label: "auri:v1",
    },
    {
      position: PAIR_POSITION,
      policy_version_id: policyVersionID,
      policy_id: EXPECTED_POLICY_ID,
      policy_name: "hrafn-fylking",
      version,
      player_id: EXPECTED_PLAYER_ID,
      player_name: EXPECTED_PLAYER_NAME,
      is_filler: false,
      label,
    },
    {
      position: 2,
      policy_version_id: "22222222-2222-2222-2222-222222222222",
      policy_id: "policy-ron",
      policy_name: "ron",
      version: 1,
      player_id: "ply-ron",
      player_name: "Ron",
      is_filler: false,
      label: "ron:v1",
    },
  ];
}

function pairApiEpisodes(role) {
  const candidate = role === "candidate";
  const policyVersionID = candidate
    ? EXPECTED_POLICY_VERSION_ID
    : CONTROL_POLICY_VERSION_ID;
  const label = candidate ? "hrafn-fylking:v8" : "hrafn-fylking:v5";
  const version = candidate ? 8 : 5;
  return [1, 2, 3, 4].map((index) => {
    const participants = pairParticipants(policyVersionID, label, version);
    return {
      id: `ereq_${role}_${index}`,
      coworld_id: "cow-test",
      coworld_version: "0.1.30",
      status: "completed",
      episode_id: `episode-${role}-${index}`,
      replay_url:
        `https://softmax-public.s3.amazonaws.com/replays/${role}-${index}.replay`,
      error_type: null,
      error: null,
      failed_policy_index: null,
      failed_agent_index: null,
      game_config: {
        map: EXPECTED_MAP,
        map_size: "Normal",
        num_agents: 3,
        max_decision_ms: 15000,
      },
      variant_name: "Tournament 12P - World",
      policy_version_ids: participants.map((entry) =>
        entry.policy_version_id
      ),
      participants,
      scores: participants.map((entry, participantIndex) => ({
        policy_version_id: entry.policy_version_id,
        score: candidate
          ? Number(participantIndex === PAIR_POSITION)
          : Number(participantIndex === 2),
      })),
    };
  });
}

function pairRequest(role, episodes) {
  return {
    id: `xreq_${role}`,
    coworld_id: "cow-test",
    coworld_version: "0.1.30",
    status: "completed",
    error: null,
    variant_id: EXPECTED_VARIANT_ID,
    episode_count: 4,
    pending_count: 0,
    submitted_count: 0,
    running_count: 0,
    completed_count: 4,
    failed_count: 0,
    episodes: structuredClone(episodes),
  };
}

function pairRequestBody(role) {
  return {
    coworld_id: "cow-test",
    variant_id: EXPECTED_VARIANT_ID,
    num_episodes: 4,
    roster: [
      { slot: 0, player: { policy_ref: "auri:v1" } },
      {
        slot: PAIR_POSITION,
        player: {
          policy_ref: role === "candidate"
            ? "hrafn-fylking:v8"
            : "hrafn-fylking:v5",
        },
      },
      { slot: 2, player: { policy_ref: "ron:v1" } },
    ],
  };
}

function pairCandidateAudit(index) {
  const audit = passingEpisode(index);
  audit.episode_request_id = `ereq_candidate_${index}`;
  audit.episode_id = `episode-candidate-${index}`;
  audit.participant_position = PAIR_POSITION;
  audit.result_player_slot = PAIR_POSITION;
  audit.decision_agent_ids = ["opportunistic-agent-2"];
  audit.decision_agent_positions = [PAIR_POSITION];
  audit.expected_decision_agent_id = "opportunistic-agent-2";
  return audit;
}

function pairControlAudit(index) {
  return {
    episode_request_id: `ereq_control_${index}`,
    episode_id: `episode-control-${index}`,
    status: "completed",
    map: EXPECTED_MAP,
    participant_position: PAIR_POSITION,
    exact_name_match_count: 1,
    exact_policy_version_match_count: 1,
    exact_player_id_match_count: 1,
    exact_policy_id_match_count: 1,
    exact_joint_match_count: 1,
    participant_position_consistent: true,
    bound_player_name: EXPECTED_PLAYER_NAME,
    bound_policy_version_id: CONTROL_POLICY_VERSION_ID,
    bound_player_id: EXPECTED_PLAYER_ID,
    bound_policy_id: EXPECTED_POLICY_ID,
    score_match_count: 1,
    score: 0,
    replay_result_score: 0,
    replay_result_vector_score: 0,
    replay_player_name: EXPECTED_PLAYER_NAME,
    final_player_name: EXPECTED_PLAYER_NAME,
    result_player_slot: PAIR_POSITION,
    result_player_slot_bound: true,
    won: false,
    outcome_evidence_consistent: true,
    replay_complete: true,
    replay_sha256: String(index).padStart(64, "b"),
    policy_decisions: 10,
    accepted: 8,
    rejected: 2,
    holds: 3,
    fallbacks: 1,
    planner_degraded_decisions: 2,
    result_evidence_failures: [],
    fallback_evidence_failures: [],
    planner_evidence_failures: [],
    decision_agent_ids: ["opportunistic-agent-2"],
    decision_agent_positions: [PAIR_POSITION],
    expected_decision_agent_id: "opportunistic-agent-2",
    decision_agent_binding_complete: true,
    runtime_player_id: "runtime-hrafn",
    result_runtime_player_id: "runtime-hrafn",
    final_runtime_player_id: "runtime-hrafn",
    result_runtime_name_match_count: 1,
    final_runtime_name_match_count: 1,
    decision_runtime_evidence_failures: [],
    decision_runtime_binding_complete: true,
    audit_error: null,
  };
}

function pairData(role) {
  const episodes = pairApiEpisodes(role);
  return {
    role,
    requestID: `xreq_${role}`,
    request: pairRequest(role, episodes),
    fetchedEpisodes: structuredClone(episodes),
    requestBody: pairRequestBody(role),
    requestBodyPath: `experiments/${role}.json`,
    requestBodySHA256: (role === "candidate" ? "c" : "d").repeat(64),
    episodeAudits: [1, 2, 3, 4].map(role === "candidate"
      ? pairCandidateAudit
      : pairControlAudit),
  };
}

function pairReport(
  candidate = pairData("candidate"),
  control = pairData("control"),
) {
  return buildHrafnC1XpPairGateReport(candidate, control, {
    expectedEpisodeCount: 4,
    expectedPlayerName: EXPECTED_PLAYER_NAME,
    expectedPlayerID: EXPECTED_PLAYER_ID,
    expectedPolicyID: EXPECTED_POLICY_ID,
    expectedCandidatePolicyVersionID: EXPECTED_POLICY_VERSION_ID,
    expectedControlPolicyVersionID: CONTROL_POLICY_VERSION_ID,
    expectedVariantID: EXPECTED_VARIANT_ID,
    expectedMap: EXPECTED_MAP,
    expectedParticipantPosition: PAIR_POSITION,
  });
}

function requiredCliArgs() {
  return [
    "xreq_candidate",
    "--control-request-id",
    "xreq_control",
    "--candidate-request-body",
    "experiments/candidate.json",
    "--control-request-body",
    "experiments/control.json",
    "--expected-policy-version-id",
    EXPECTED_POLICY_VERSION_ID,
    "--control-policy-version-id",
    CONTROL_POLICY_VERSION_ID,
    "--expected-player-id",
    EXPECTED_PLAYER_ID,
    "--expected-policy-id",
    EXPECTED_POLICY_ID,
    "--expected-variant-id",
    EXPECTED_VARIANT_ID,
    "--expected-map",
    EXPECTED_MAP,
    "--expected-position",
    String(PAIR_POSITION),
  ];
}

function withoutOption(args, option) {
  const index = args.indexOf(option);
  return [
    ...args.slice(0, index),
    ...args.slice(index + 2),
  ];
}

test("episode audit binds the API participant, replay winner, and productive marker", () => {
  const episode = minimalCompletedEpisode();
  const replay = minimalWinningReplay();
  const bytes = Buffer.from(JSON.stringify(replay));
  const result = auditHrafnC1XpEpisode(episode, replay, bytes, {
    expectedPlayerName: EXPECTED_PLAYER_NAME,
    expectedPolicyVersionID: EXPECTED_POLICY_VERSION_ID,
    expectedPlayerID: EXPECTED_PLAYER_ID,
    expectedPolicyID: EXPECTED_POLICY_ID,
  });
  assert.equal(result.exact_name_match_count, 1);
  assert.equal(result.exact_policy_version_match_count, 1);
  assert.equal(result.exact_joint_match_count, 1);
  assert.equal(result.participant_position_consistent, true);
  assert.equal(result.exact_player_id_match_count, 1);
  assert.equal(result.exact_policy_id_match_count, 1);
  assert.equal(result.decision_agent_binding_complete, true);
  assert.equal(result.result_player_slot_bound, true);
  assert.equal(result.replay_complete, true);
  assert.equal(result.win_evidence_consistent, true);
  assert.equal(result.won, true);
  assert.deepEqual(result.productive_marker_counts, { hg35: 1 });
  assert.equal(result.productive_marker_count, 1);
  assert.equal(
    Object.values(result.authoritative_audit.checks).every(Boolean),
    true,
  );
  assert.equal(
    result.replay_sha256,
    result.authoritative_audit.replay_sha256,
  );
});

test("productive marker count excludes holds, spawns, and rejected actions", () => {
  const replay = minimalWinningReplay();
  const base = JSON.parse(
    replay.inlineRunArtifacts["decisions.jsonl"].trim(),
  );
  const rows = [
    base,
    {
      ...structuredClone(base),
      selectedLegalActionId: "hold",
      selectedActionKind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
    },
    {
      ...structuredClone(base),
      selectedLegalActionId: "spawn:1",
      selectedActionKind: "spawn",
      reason: "[K1Z] r4vn:spn",
    },
    {
      ...structuredClone(base),
      turnNumber: 200,
      result: {
        ...structuredClone(base.result),
        accepted: false,
      },
    },
  ];
  replay.inlineRunArtifacts["decisions.jsonl"] =
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  assert.deepEqual(
    productiveHrafnC1MarkerCounts(replay, EXPECTED_PLAYER_NAME),
    { hg35: 1 },
  );
});

test("C1 XP report passes only a complete exact-identity 4/4 gate", () => {
  const result = report();
  assert.equal(result.evidence_passed, true);
  assert.equal(result.wins, 4);
  assert.equal(result.policy_decisions, 48);
  assert.equal(result.accepted, 48);
  assert.equal(result.verified_holds, 0);
  assert.equal(result.productive_marker_count, 16);
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test("request status and exact episode cardinality fail closed", () => {
  const running = passingRequest();
  running.status = "running";
  running.running_count = 4;
  running.completed_count = 0;
  assert.equal(report(running).checks.request_terminal_completed, false);
  assert.equal(report(running).evidence_passed, false);

  const wrongDeclaredCount = passingRequest();
  wrongDeclaredCount.episode_count = 5;
  assert.equal(
    report(wrongDeclaredCount).checks.request_episode_count_exact,
    false,
  );

  const missingEpisode = [1, 2, 3].map(passingEpisode);
  assert.equal(
    report(passingRequest(), missingEpisode).checks.audited_episode_count_exact,
    false,
  );

  const wrongVariant = passingRequest();
  wrongVariant.variant_id = "tournament-12p-pangaea";
  assert.equal(report(wrongVariant).checks.request_variant_exact, false);
});

test("player name and policy version must each bind exactly once and jointly", () => {
  for (const field of [
    "exact_name_match_count",
    "exact_policy_version_match_count",
    "exact_joint_match_count",
  ]) {
    const episodes = [1, 2, 3, 4].map(passingEpisode);
    episodes[0][field] = 0;
    const result = report(passingRequest(), episodes);
    assert.equal(result.checks.exact_player_policy_binding_each_episode, false);
    assert.equal(result.evidence_passed, false);
  }

  const positionMismatch = [1, 2, 3, 4].map(passingEpisode);
  positionMismatch[0].participant_position_consistent = false;
  assert.equal(
    report(passingRequest(), positionMismatch).checks
      .exact_player_policy_binding_each_episode,
    false,
  );

  const displaced = [1, 2, 3, 4].map(passingEpisode);
  displaced[0].participant_position = 6;
  assert.equal(
    report(passingRequest(), displaced).checks
      .exact_player_policy_binding_each_episode,
    false,
  );
});

test("each outcome, replay, decision, safety, and marker condition is mandatory", () => {
  const cases = [
    ["all_episodes_terminal_completed", (episode) => {
      episode.status = "running";
    }],
    ["all_replays_complete", (episode) => {
      episode.replay_complete = false;
    }],
    ["all_replay_hashes_present", (episode) => {
      episode.replay_sha256 = null;
    }],
    ["expected_map_each_episode", (episode) => {
      episode.map = "Pangaea";
    }],
    ["every_episode_won", (episode) => {
      episode.won = false;
    }],
    ["win_evidence_consistent_each_episode", (episode) => {
      episode.win_evidence_consistent = false;
    }],
    ["result_player_slot_bound_each_episode", (episode) => {
      episode.result_player_slot = 4;
      episode.result_player_slot_bound = false;
    }],
    ["decision_agent_bound_each_episode", (episode) => {
      episode.decision_agent_positions = [4];
      episode.decision_agent_binding_complete = false;
    }],
    ["decision_agent_bound_each_episode", (episode) => {
      episode.decision_agent_policy_decisions = 11;
    }],
    ["decisions_present_each_episode", (episode) => {
      episode.authoritative_audit.policy_decisions = 0;
    }],
    ["all_decisions_accepted", (episode) => {
      episode.authoritative_audit.accepted = 11;
    }],
    ["zero_rejections", (episode) => {
      episode.authoritative_audit.rejected = 1;
    }],
    ["fallback_evidence_complete", (episode) => {
      episode.authoritative_audit.fallback_evidence_failures = [{ turn: 1 }];
    }],
    ["zero_fallbacks", (episode) => {
      episode.authoritative_audit.fallbacks = 1;
    }],
    ["zero_planner_degradation", (episode) => {
      episode.authoritative_audit.planner_degradation_failures = [{ turn: 2 }];
    }],
    ["zero_unexplained_holds", (episode) => {
      episode.authoritative_audit.unexplained_holds = [{ turn: 3 }];
    }],
    ["zero_holds", (episode) => {
      episode.authoritative_audit.holds = 1;
      episode.authoritative_audit.verified_holds = [{ turn: 3 }];
    }],
    ["hold_evidence_complete", (episode) => {
      episode.authoritative_audit.hold_evidence_gaps = [{ turn: 4 }];
    }],
    ["zero_k1z_harm", (episode) => {
      episode.authoritative_audit.harmful_k1z_actions = [{ turn: 5 }];
    }],
    ["productive_marker_each_episode", (episode) => {
      episode.productive_marker_count = 0;
      episode.productive_marker_counts = {};
    }],
    ["all_authoritative_checks_passed", (episode) => {
      episode.authoritative_audit.checks.marker_semantics_valid = false;
    }],
    ["authoritative_schema_exact_each_episode", (episode) => {
      episode.authoritative_audit.schema_version = 1;
    }],
    ["all_episode_audits_error_free", (episode) => {
      episode.audit_error = "synthetic failure";
    }],
  ];

  for (const [checkName, mutate] of cases) {
    const episodes = [1, 2, 3, 4].map(passingEpisode);
    mutate(episodes[0]);
    const result = report(passingRequest(), episodes);
    assert.equal(result.checks[checkName], false, checkName);
    assert.equal(result.evidence_passed, false, checkName);
  }
});

test("duplicate replay payloads fail the independence check", () => {
  const episodes = [1, 2, 3, 4].map(passingEpisode);
  episodes[1].replay_sha256 = episodes[0].replay_sha256;
  episodes[1].authoritative_audit.replay_sha256 =
    episodes[0].replay_sha256;
  const result = report(passingRequest(), episodes);
  assert.equal(result.checks.all_replay_hashes_unique, false);
  assert.equal(result.evidence_passed, false);
});

test("missing authoritative audit cannot be interpreted as zero failures", () => {
  const episodes = [1, 2, 3, 4].map(passingEpisode);
  episodes[0].authoritative_audit = null;
  const result = report(passingRequest(), episodes);
  for (const checkName of [
    "authoritative_replay_hashes_bound",
    "decisions_present_each_episode",
    "all_decisions_accepted",
    "zero_rejections",
    "fallback_evidence_complete",
    "zero_fallbacks",
    "zero_planner_degradation",
    "zero_unexplained_holds",
    "zero_holds",
    "hold_evidence_complete",
    "zero_k1z_harm",
    "all_authoritative_checks_passed",
    "all_episode_audits_error_free",
  ]) {
    assert.equal(result.checks[checkName], false, checkName);
  }
  assert.equal(result.evidence_passed, false);
});

test("matched pair passes with a losing noisy v5 control", () => {
  const result = pairReport();
  assert.equal(result.passed, true);
  assert.equal(result.candidate_evidence.wins, 4);
  assert.equal(result.control_evidence.wins, 0);
  assert.equal(result.control_evidence.policy_decisions, 40);
  assert.equal(result.control_evidence.holds, 12);
  assert.equal(result.control_evidence.rejected, 8);
  assert.equal(result.control_evidence.fallbacks, 4);
  assert.equal(result.control_evidence.planner_degraded_decisions, 8);
  assert.equal(
    Object.values(result.control_evidence.checks).every(Boolean),
    true,
  );
});

test("candidate evidence cannot expose a standalone passed gate", () => {
  const result = report();
  assert.equal("passed" in result, false);
  assert.equal(result.evidence_passed, true);
});

test("CLI requires the pair bodies, requests, exact versions, player, and policy", () => {
  const parsed = parseCliArguments(requiredCliArgs());
  assert.equal(parsed.requestID, "xreq_candidate");
  assert.equal(parsed.controlRequestID, "xreq_control");
  assert.equal(parsed.expectedPolicyVersionID, EXPECTED_POLICY_VERSION_ID);
  assert.equal(parsed.controlPolicyVersionID, CONTROL_POLICY_VERSION_ID);
  assert.equal(parsed.expectedPlayerID, EXPECTED_PLAYER_ID);
  assert.equal(parsed.expectedPolicyID, EXPECTED_POLICY_ID);

  for (const option of [
    "--control-request-id",
    "--candidate-request-body",
    "--control-request-body",
    "--expected-policy-version-id",
    "--control-policy-version-id",
    "--expected-player-id",
    "--expected-policy-id",
  ]) {
    assert.throws(
      () => parseCliArguments(withoutOption(requiredCliArgs(), option)),
      undefined,
      option,
    );
  }
});

test("pair requires exact distinct candidate and control request IDs", () => {
  const controlMismatch = pairData("control");
  controlMismatch.request.id = "xreq_other";
  let result = pairReport(pairData("candidate"), controlMismatch);
  assert.equal(
    result.checks.candidate_and_control_request_ids_exact_and_distinct,
    false,
  );
  assert.equal(result.passed, false);

  const sameID = pairData("control");
  sameID.requestID = "xreq_candidate";
  sameID.request.id = "xreq_candidate";
  result = pairReport(pairData("candidate"), sameID);
  assert.equal(
    result.checks.candidate_and_control_request_ids_exact_and_distinct,
    false,
  );
});

test("both embedded episode sets must equal their separately fetched sets", () => {
  for (const role of ["candidate", "control"]) {
    const candidate = pairData("candidate");
    const control = pairData("control");
    const target = role === "candidate" ? candidate : control;
    target.request.episodes[0].status = "running";
    const result = pairReport(candidate, control);
    assert.equal(
      result[`${role}_request_provenance`].checks
        .embedded_and_fetched_episode_sets_exact,
      false,
      role,
    );
    assert.equal(result.passed, false);
  }
});

test("both request bodies must be path-bound and resolve every API roster slot", () => {
  const missingPath = pairData("candidate");
  missingPath.requestBodyPath = null;
  let result = pairReport(missingPath, pairData("control"));
  assert.equal(
    result.candidate_request_provenance.checks.request_body_path_bound,
    false,
  );

  const wrongResolution = pairData("control");
  wrongResolution.requestBody.roster[0].player.policy_ref = "wrong:v1";
  result = pairReport(pairData("candidate"), wrongResolution);
  assert.equal(
    result.control_request_provenance.checks
      .request_body_resolves_every_fetched_episode,
    false,
  );
  assert.equal(result.passed, false);
});

test("full API rosters may differ only by v5 to v8 at the Hrafn slot", () => {
  const control = pairData("control");
  for (const episode of [
    ...control.fetchedEpisodes,
    ...control.request.episodes,
  ]) {
    episode.participants[2].player_name = "Different Ron";
  }
  let result = pairReport(pairData("candidate"), control);
  assert.equal(
    result.checks.api_rosters_differ_only_v5_to_candidate_at_hrafn,
    false,
  );

  const bodyDifference = pairData("control");
  bodyDifference.requestBody.roster[2].player.policy_ref = "other:v1";
  result = pairReport(pairData("candidate"), bodyDifference);
  assert.equal(
    result.checks.request_bodies_differ_only_v5_to_candidate_at_hrafn,
    false,
  );
  assert.equal(result.passed, false);
});

test("pair binds identical coworld, variant, map, seat, and episode count", () => {
  const cases = [
    ["pair_coworld_identical", (control) => {
      control.request.coworld_id = "cow-other";
      control.requestBody.coworld_id = "cow-other";
    }],
    ["pair_variant_identical", (control) => {
      control.request.variant_id = "tournament-12p-pangaea";
      control.requestBody.variant_id = "tournament-12p-pangaea";
    }],
    ["pair_map_identical", (control) => {
      for (const episode of [
        ...control.fetchedEpisodes,
        ...control.request.episodes,
      ]) {
        episode.game_config.map = "Pangaea";
      }
    }],
    ["pair_seat_identical", (control) => {
      for (const episode of [
        ...control.fetchedEpisodes,
        ...control.request.episodes,
      ]) {
        episode.participants[1].position = 2;
        episode.participants[2].position = 1;
        episode.policy_version_ids = [
          episode.participants[0].policy_version_id,
          episode.participants[2].policy_version_id,
          episode.participants[1].policy_version_id,
        ];
      }
      control.requestBody.roster[1].slot = 2;
      control.requestBody.roster[2].slot = 1;
    }],
    ["pair_episode_count_identical", (control) => {
      control.request.episode_count = 3;
      control.requestBody.num_episodes = 3;
    }],
  ];
  for (const [checkName, mutate] of cases) {
    const control = pairData("control");
    mutate(control);
    const result = pairReport(pairData("candidate"), control);
    assert.equal(result.checks[checkName], false, checkName);
    assert.equal(result.passed, false, checkName);
  }
});

test("pair binds full canonical game config and Coworld version", () => {
  const configMismatch = pairData("control");
  for (const episode of [
    ...configMismatch.fetchedEpisodes,
    ...configMismatch.request.episodes,
  ]) {
    episode.game_config.max_decision_ms = 9000;
  }
  let result = pairReport(pairData("candidate"), configMismatch);
  assert.equal(
    result.control_request_provenance.evidence_passed,
    true,
  );
  assert.equal(result.checks.pair_game_config_identical, false);
  assert.equal(result.passed, false);

  const versionMismatch = pairData("control");
  versionMismatch.request.coworld_version = "0.1.31";
  for (const episode of [
    ...versionMismatch.fetchedEpisodes,
    ...versionMismatch.request.episodes,
  ]) {
    episode.coworld_version = "0.1.31";
  }
  result = pairReport(pairData("candidate"), versionMismatch);
  assert.equal(
    result.control_request_provenance.evidence_passed,
    true,
  );
  assert.equal(result.checks.pair_coworld_version_identical, false);
  assert.equal(result.passed, false);

  const episodeVersionMismatch = pairData("control");
  episodeVersionMismatch.fetchedEpisodes[0].coworld_version = "0.1.31";
  episodeVersionMismatch.request.episodes[0].coworld_version = "0.1.31";
  result = pairReport(pairData("candidate"), episodeVersionMismatch);
  assert.equal(
    result.control_request_provenance.checks
      .fetched_episode_coworld_identity_exact,
    false,
  );
  assert.equal(result.passed, false);
});

test("episode variant name must resolve to the request variant identity", () => {
  const control = pairData("control");
  for (const episode of [
    ...control.fetchedEpisodes,
    ...control.request.episodes,
  ]) {
    episode.variant_name = "Tournament 12P - Pangaea";
  }
  const result = pairReport(pairData("candidate"), control);
  assert.equal(
    result.control_request_provenance.checks
      .fetched_effective_variant_identity_exact,
    false,
  );
  assert.equal(result.checks.pair_variant_identical, false);
  assert.equal(result.passed, false);
});

test("canonical game config hashing ignores object key order", () => {
  const control = pairData("control");
  for (const episode of [
    ...control.fetchedEpisodes,
    ...control.request.episodes,
  ]) {
    episode.game_config = {
      max_decision_ms: 15000,
      num_agents: 3,
      map_size: "Normal",
      map: EXPECTED_MAP,
    };
  }
  const result = pairReport(pairData("candidate"), control);
  assert.equal(result.checks.pair_game_config_identical, true);
  assert.equal(result.passed, true);
});

test("exact Hrafn player and policy identities are pair-gating evidence", () => {
  for (const field of [
    "exact_player_id_match_count",
    "exact_policy_id_match_count",
    "bound_player_id",
    "bound_policy_id",
  ]) {
    const candidate = pairData("candidate");
    candidate.episodeAudits[0][field] = field.startsWith("exact_")
      ? 0
      : "wrong";
    const result = pairReport(candidate, pairData("control"));
    assert.equal(
      result.candidate_evidence.checks
        .exact_player_policy_binding_each_episode,
      false,
      field,
    );
    assert.equal(result.passed, false, field);
  }
});

test("candidate and control decisions bind agentID to the expected seat", () => {
  const candidate = pairData("candidate");
  candidate.episodeAudits[0].decision_agent_positions = [2];
  candidate.episodeAudits[0].decision_agent_binding_complete = false;
  let result = pairReport(candidate, pairData("control"));
  assert.equal(
    result.candidate_evidence.checks.decision_agent_bound_each_episode,
    false,
  );

  const control = pairData("control");
  control.episodeAudits[0].decision_agent_positions = [2];
  control.episodeAudits[0].decision_agent_binding_complete = false;
  result = pairReport(pairData("candidate"), control);
  assert.equal(
    result.control_evidence.checks.decision_agent_bound_each_episode,
    false,
  );
});

test("decision agent binding rejects arbitrary prefixes and multiple IDs", () => {
  for (const role of ["candidate", "control"]) {
    for (const ids of [
      ["arbitrary-agent-2"],
      ["opportunistic-agent-2", "arbitrary-agent-2"],
    ]) {
      const candidate = pairData("candidate");
      const control = pairData("control");
      const target = role === "candidate" ? candidate : control;
      target.episodeAudits[0].decision_agent_ids = ids;
      target.episodeAudits[0].decision_agent_positions = [PAIR_POSITION];
      target.episodeAudits[0].decision_agent_binding_complete = true;
      const result = pairReport(candidate, control);
      assert.equal(
        result[`${role}_evidence`].checks
          .decision_agent_bound_each_episode,
        false,
        `${role}: ${ids.join(",")}`,
      );
      assert.equal(result.passed, false);
    }
  }

  const episode = minimalCompletedEpisode();
  const replay = minimalWinningReplay();
  const decision = JSON.parse(
    replay.inlineRunArtifacts["decisions.jsonl"].trim(),
  );
  decision.agentID = "arbitrary-agent-1";
  replay.inlineRunArtifacts["decisions.jsonl"] =
    `${JSON.stringify(decision)}\n`;
  const result = auditHrafnC1XpEpisode(
    episode,
    replay,
    Buffer.from(JSON.stringify(replay)),
    {
      expectedPlayerName: EXPECTED_PLAYER_NAME,
      expectedPolicyVersionID: EXPECTED_POLICY_VERSION_ID,
      expectedPlayerID: EXPECTED_PLAYER_ID,
      expectedPolicyID: EXPECTED_POLICY_ID,
    },
  );
  assert.equal(result.decision_agent_binding_complete, false);
  assert.deepEqual(result.decision_agent_ids, ["arbitrary-agent-1"]);
});

test("control evidence gates the decision-to-runtime identity binding", () => {
  const control = pairData("control");
  control.episodeAudits[0].decision_runtime_binding_complete = false;
  control.episodeAudits[0].decision_runtime_evidence_failures = [{
    turn: 100,
    expected_player_id: "runtime-hrafn",
    observed: [{
      field: "auditBefore",
      player_id: "runtime-outsider",
    }],
  }];
  let result = pairReport(pairData("candidate"), control);
  assert.equal(
    result.control_evidence.checks.decision_runtime_bound_each_episode,
    false,
  );
  assert.equal(result.passed, false);

  const replayIdentityMismatch = pairData("control");
  replayIdentityMismatch.episodeAudits[0].final_runtime_player_id =
    "runtime-outsider";
  result = pairReport(pairData("candidate"), replayIdentityMismatch);
  assert.equal(
    result.control_evidence.checks.decision_runtime_bound_each_episode,
    false,
  );
  assert.equal(result.passed, false);
});

test("candidate and control replay result slots bind to participant position", () => {
  const candidate = pairData("candidate");
  candidate.episodeAudits[0].result_player_slot = 2;
  candidate.episodeAudits[0].result_player_slot_bound = false;
  let result = pairReport(candidate, pairData("control"));
  assert.equal(
    result.candidate_evidence.checks
      .result_player_slot_bound_each_episode,
    false,
  );

  const control = pairData("control");
  control.episodeAudits[0].result_player_slot = 2;
  control.episodeAudits[0].result_player_slot_bound = false;
  result = pairReport(pairData("candidate"), control);
  assert.equal(
    result.control_evidence.checks
      .result_player_slot_bound_each_episode,
    false,
  );
});

test("authoritative candidate schema and every returned check are mandatory", () => {
  for (const [field, value] of [
    ["schema_version", 1],
    ["record_type", "wrong"],
    ["audit_scope", "wrong"],
  ]) {
    const episodes = [1, 2, 3, 4].map(passingEpisode);
    episodes[0].authoritative_audit[field] = value;
    const result = report(passingRequest(), episodes);
    assert.equal(
      result.checks.authoritative_schema_exact_each_episode,
      false,
      field,
    );
  }

  const episodes = [1, 2, 3, 4].map(passingEpisode);
  episodes[0].authoritative_audit.checks.future_check = false;
  const result = report(passingRequest(), episodes);
  assert.equal(result.checks.all_authoritative_checks_passed, false);
  assert.equal(result.evidence_passed, false);
});

test("generic control audit records a loss and noisy decisions without C1 markers", () => {
  const episode = minimalCompletedEpisode();
  episode.participants[0].policy_version_id = CONTROL_POLICY_VERSION_ID;
  episode.scores[0].policy_version_id = CONTROL_POLICY_VERSION_ID;
  episode.scores[0].score = 0;
  episode.scores[1].score = 1;
  const replay = minimalWinningReplay();
  replay.results.winner_slot = 1;
  replay.finalState.winnerSlot = 1;
  replay.results.scores = [0, 1];
  replay.results.players[0].score = 0;
  replay.results.players[1].score = 1;
  const decision = JSON.parse(
    replay.inlineRunArtifacts["decisions.jsonl"].trim(),
  );
  decision.reason = "legacy v5 decision";
  decision.selectedActionKind = "hold";
  decision.selectedLegalActionId = "hold";
  decision.result.accepted = false;
  decision.fallbackUsed = true;
  decision.llmPlannerDegraded = true;
  replay.inlineRunArtifacts["decisions.jsonl"] =
    `${JSON.stringify(decision)}\n`;
  const bytes = Buffer.from(JSON.stringify(replay));
  const result = auditHrafnControlXpEpisode(episode, replay, bytes, {
    expectedPlayerName: EXPECTED_PLAYER_NAME,
    expectedPolicyVersionID: CONTROL_POLICY_VERSION_ID,
    expectedPlayerID: EXPECTED_PLAYER_ID,
    expectedPolicyID: EXPECTED_POLICY_ID,
  });
  assert.equal(result.won, false);
  assert.equal(result.outcome_evidence_consistent, true);
  assert.equal(result.policy_decisions, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.holds, 1);
  assert.equal(result.fallbacks, 1);
  assert.equal(result.planner_degraded_decisions, 1);
  assert.deepEqual(result.result_evidence_failures, []);
  assert.deepEqual(result.fallback_evidence_failures, []);
  assert.deepEqual(result.planner_evidence_failures, []);
  assert.equal(result.runtime_player_id, "runtime-hrafn");
  assert.equal(result.decision_runtime_binding_complete, true);
  assert.deepEqual(result.decision_runtime_evidence_failures, []);
});

test("generic control decisions must bind to the unique Hrafn runtime ID", () => {
  const episode = minimalCompletedEpisode();
  episode.participants[0].policy_version_id = CONTROL_POLICY_VERSION_ID;
  episode.scores[0].policy_version_id = CONTROL_POLICY_VERSION_ID;
  const replay = minimalWinningReplay();
  const decision = JSON.parse(
    replay.inlineRunArtifacts["decisions.jsonl"].trim(),
  );
  decision.auditBefore.playerID = "runtime-outsider";
  replay.inlineRunArtifacts["decisions.jsonl"] =
    `${JSON.stringify(decision)}\n`;
  let result = auditHrafnControlXpEpisode(
    episode,
    replay,
    Buffer.from(JSON.stringify(replay)),
    {
      expectedPlayerName: EXPECTED_PLAYER_NAME,
      expectedPolicyVersionID: CONTROL_POLICY_VERSION_ID,
      expectedPlayerID: EXPECTED_PLAYER_ID,
      expectedPolicyID: EXPECTED_POLICY_ID,
    },
  );
  assert.equal(result.decision_runtime_binding_complete, false);
  assert.equal(result.decision_runtime_evidence_failures.length, 1);

  const duplicateIdentityReplay = minimalWinningReplay();
  duplicateIdentityReplay.finalState.players[1].username =
    EXPECTED_PLAYER_NAME;
  result = auditHrafnControlXpEpisode(
    episode,
    duplicateIdentityReplay,
    Buffer.from(JSON.stringify(duplicateIdentityReplay)),
    {
      expectedPlayerName: EXPECTED_PLAYER_NAME,
      expectedPolicyVersionID: CONTROL_POLICY_VERSION_ID,
      expectedPlayerID: EXPECTED_PLAYER_ID,
      expectedPolicyID: EXPECTED_POLICY_ID,
    },
  );
  assert.equal(result.final_runtime_name_match_count, 2);
  assert.equal(result.runtime_player_id, null);
  assert.equal(result.decision_runtime_binding_complete, false);
});

test("control accepts a consistent fractional terminal draw but candidate does not", () => {
  const controlEpisode = minimalCompletedEpisode();
  controlEpisode.participants[0].policy_version_id =
    CONTROL_POLICY_VERSION_ID;
  controlEpisode.scores[0].policy_version_id =
    CONTROL_POLICY_VERSION_ID;
  controlEpisode.scores[0].score = 0.625;
  controlEpisode.scores[1].score = 0.375;
  const replay = minimalWinningReplay();
  replay.results.winner_slot = null;
  replay.finalState.winnerSlot = null;
  replay.results.scores = [0.625, 0.375];
  replay.results.players[0].score = 0.625;
  replay.results.players[1].score = 0.375;
  const bytes = Buffer.from(JSON.stringify(replay));
  const control = auditHrafnControlXpEpisode(
    controlEpisode,
    replay,
    bytes,
    {
      expectedPlayerName: EXPECTED_PLAYER_NAME,
      expectedPolicyVersionID: CONTROL_POLICY_VERSION_ID,
      expectedPlayerID: EXPECTED_PLAYER_ID,
      expectedPolicyID: EXPECTED_POLICY_ID,
    },
  );
  assert.equal(control.score, 0.625);
  assert.equal(control.replay_result_score, 0.625);
  assert.equal(control.replay_result_vector_score, 0.625);
  assert.equal(control.replay_complete, true);
  assert.equal(control.outcome_evidence_consistent, true);
  assert.equal(control.won, false);

  const candidateEpisode = minimalCompletedEpisode();
  candidateEpisode.scores[0].score = 0.625;
  candidateEpisode.scores[1].score = 0.375;
  const candidate = auditHrafnC1XpEpisode(
    candidateEpisode,
    replay,
    bytes,
    {
      expectedPlayerName: EXPECTED_PLAYER_NAME,
      expectedPolicyVersionID: EXPECTED_POLICY_VERSION_ID,
      expectedPlayerID: EXPECTED_PLAYER_ID,
      expectedPolicyID: EXPECTED_POLICY_ID,
    },
  );
  assert.equal(candidate.replay_complete, false);
  assert.equal(candidate.outcome_evidence_consistent, false);
  assert.equal(candidate.win_evidence_consistent, false);
  assert.equal(candidate.won, false);
});

test("fresh replay retrieval overwrites rather than trusts a cache file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hrafn-c1-"));
  try {
    const episode = {
      episode_id: "fresh-test",
      replay_url:
        "https://softmax-public.s3.amazonaws.com/replays/fresh.replay",
    };
    const destination = path.join(directory, "fresh-test.replay");
    await writeFile(destination, "stale");
    let calls = 0;
    const fresh = Buffer.from("fresh");
    const result = await freshReplayBytes(episode, directory, {
      downloadReplayFn: async () => {
        calls += 1;
        return fresh;
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.bytes, fresh);
    assert.deepEqual(await readFile(destination), fresh);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fakeReplayResponse({
  finalURL =
    "https://softmax-public.s3.amazonaws.com/replays/final.replay",
  chunks = [Buffer.from("{}")],
  contentLength = null,
} = {}) {
  return {
    ok: true,
    status: 200,
    url: finalURL,
    headers: new Headers(
      contentLength === null
        ? {}
        : { "content-length": String(contentLength) },
    ),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

test("replay retrieval validates the final redirect URL", async () => {
  await assert.rejects(
    downloadReplay(
      "https://softmax-public.s3.amazonaws.com/replays/start.replay",
      {
        fetchImpl: async () => fakeReplayResponse({
          finalURL: "https://example.com/redirected.replay",
        }),
      },
    ),
    /final replay URL outside the replay allowlist/,
  );
});

test("replay retrieval enforces a streaming hard byte cap", async () => {
  await assert.rejects(
    downloadReplay(
      "https://softmax-public.s3.amazonaws.com/replays/large.replay",
      {
        maxBytes: 5,
        fetchImpl: async () => fakeReplayResponse({
          chunks: [Buffer.from("123"), Buffer.from("456")],
        }),
      },
    ),
    /exceeds byte limit 5/,
  );
});
