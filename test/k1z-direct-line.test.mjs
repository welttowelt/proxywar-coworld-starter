import assert from "node:assert/strict";
import test from "node:test";

import {
  sealK1ZPacket,
  summarizeK1ZLearning,
  validateK1ZPacket,
  validateK1ZPacketLedger,
} from "../k1z-direct-line.mjs";

const REPLAY_A = "a".repeat(64);
const REPLAY_B = "b".repeat(64);

function coordinationDraft(overrides = {}) {
  return {
    schema_version: 1,
    protocol: "k1z-direct-line",
    campaign_id: "hrafn-c3-conversion",
    message_id: "hrafn-000001",
    sequence: 1,
    created_at: "2026-07-20T17:30:00.000Z",
    from: "hrafn",
    to: "odin",
    kind: "coordination",
    in_reply_to: null,
    authority: {
      advisory: true,
      formal_approval: false,
      mutation_scope: "none",
    },
    payload: {
      objective: "measure sustained territory conversion",
      requested_reply: "RUNNER_READY",
    },
    evidence: {
      source_commit: "74c8bf79430aab92190fa24e3ce24d82347868ee",
      image_digest:
        "sha256:5d854d0661a3b55f39b8badf262628a02aaf50a12e3b9f9371168386c162289b",
      replay_sha256: [],
    },
    ...overrides,
  };
}

function learningRow({
  arm,
  role,
  runID,
  replay,
  won = false,
  finalTiles,
  markerCount,
  postCapGain,
  holds = 0,
  k1zHarm = 0,
}) {
  return {
    schema_version: 1,
    record_type: "k1z-game-learning",
    campaign_id: "hrafn-c3-conversion",
    run_id: runID,
    pair_id: "pair-1",
    arm,
    role,
    opponent_mix: "hrafn-only-current-field",
    map: "Pangaea",
    seat: 4,
    won,
    score: won ? 1 : 0,
    final_tiles: finalTiles,
    decision_count: 100,
    accepted_decisions: 100,
    holds,
    rejected_decisions: 0,
    fallbacks: 0,
    planner_degraded: 0,
    k1z_harm: k1zHarm,
    marker: role === "candidate" ? "hks1.hncap" : "hncap",
    marker_count: markerCount,
    replay_sha256: replay,
    checkpoints: {
      decision_20_tiles: 24000,
      frontier_exhaustion_turn: 2100,
      frontier_exhaustion_tiles: 48000,
      cap_escape_turn: 2300,
      cap_escape_tiles: 50000,
      post_cap_tiles: 50000 + postCapGain,
      post_cap_gain: postCapGain,
    },
  };
}

test("a sealed advisory packet is deterministic and validates", () => {
  const first = sealK1ZPacket(coordinationDraft());
  const second = sealK1ZPacket(coordinationDraft());

  assert.deepEqual(first, second);
  assert.match(first.integrity.content_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateK1ZPacket(first), { valid: true, errors: [] });
});

test("packet validation detects content drift after sealing", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  packet.payload.objective = "changed after sealing";

  const result = validateK1ZPacket(packet);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /content digest/);
});

test("advisory traffic cannot impersonate Odin's formal approval", () => {
  const packet = coordinationDraft({
    authority: {
      advisory: true,
      formal_approval: true,
      mutation_scope: "hrafn",
    },
  });

  assert.throws(() => sealK1ZPacket(packet), /formal approval/);
});

test("formal approval is exact-artifact, Odin-only, and conditional-gate only", () => {
  const draft = coordinationDraft({
    from: "odin",
    to: "hrafn",
    kind: "verdict",
    authority: {
      advisory: false,
      formal_approval: true,
      mutation_scope: "hrafn",
    },
    payload: {
      decision: "APPROVE",
      gates: {
        source_image_bound: true,
        local_matched: true,
        fail_closed_continuation: true,
        zero_k1z_harm: true,
      },
    },
  });
  const packet = sealK1ZPacket(draft);
  assert.equal(validateK1ZPacket(packet).valid, true);

  const duplicate = sealK1ZPacket({
    ...draft,
    message_id: "odin-000002",
    sequence: 2,
  });
  const ledger = validateK1ZPacketLedger([packet, duplicate]);
  assert.equal(ledger.valid, false);
  assert.match(ledger.errors.join(" "), /more than one formal APPROVE/);
});

test("matched game learning produces a machine directional verdict", () => {
  const rows = [
    learningRow({
      arm: "hrafn-c3",
      role: "candidate",
      runID: "candidate-1",
      replay: REPLAY_A,
      won: true,
      finalTiles: 180000,
      markerCount: 2,
      postCapGain: 90000,
    }),
    learningRow({
      arm: "hrafn-c2",
      role: "parent",
      runID: "parent-1",
      replay: REPLAY_B,
      finalTiles: 80000,
      markerCount: 0,
      postCapGain: 20000,
    }),
  ];

  const report = summarizeK1ZLearning(rows, {
    candidateArm: "hrafn-c3",
    parentArm: "hrafn-c2",
  });

  assert.equal(report.valid, true);
  assert.equal(report.verdict, "DIRECTIONAL_ADVANTAGE");
  assert.equal(report.promotion_eligible, false);
  assert.equal(report.candidate.marker_count, 2);
  assert.equal(report.delta.wins, 1);
  assert.equal(report.delta.mean_final_tiles, 100000);
  assert.equal(report.delta.mean_post_cap_gain, 70000);
  assert.equal(report.paired.candidate_win_pairs, 1);
  assert.equal(report.paired.median_final_tiles_delta, 100000);
  assert.equal(report.paired.median_post_cap_gain_delta, 70000);
});

test("game learning fails closed on incomplete pairs and execution defects", () => {
  const candidate = learningRow({
    arm: "hrafn-c3",
    role: "candidate",
    runID: "candidate-1",
    replay: REPLAY_A,
    finalTiles: 90000,
    markerCount: 1,
    postCapGain: 40000,
    holds: 1,
  });
  let report = summarizeK1ZLearning([candidate], {
    candidateArm: "hrafn-c3",
    parentArm: "hrafn-c2",
  });
  assert.equal(report.verdict, "INSUFFICIENT_MATCHED_DATA");

  const parent = learningRow({
    arm: "hrafn-c2",
    role: "parent",
    runID: "parent-1",
    replay: REPLAY_B,
    finalTiles: 70000,
    markerCount: 0,
    postCapGain: 10000,
  });
  report = summarizeK1ZLearning([candidate, parent], {
    candidateArm: "hrafn-c3",
    parentArm: "hrafn-c2",
  });
  assert.equal(report.verdict, "REJECT_EXECUTION");
  assert.equal(report.promotion_eligible, false);
});

test("candidate reach is required before outcome interpretation", () => {
  const rows = [
    learningRow({
      arm: "hrafn-c3",
      role: "candidate",
      runID: "candidate-1",
      replay: REPLAY_A,
      won: true,
      finalTiles: 180000,
      markerCount: 0,
      postCapGain: 90000,
    }),
    learningRow({
      arm: "hrafn-c2",
      role: "parent",
      runID: "parent-1",
      replay: REPLAY_B,
      finalTiles: 80000,
      markerCount: 0,
      postCapGain: 20000,
    }),
  ];
  const report = summarizeK1ZLearning(rows, {
    candidateArm: "hrafn-c3",
    parentArm: "hrafn-c2",
  });

  assert.equal(report.verdict, "REJECT_NO_REACH");
});
