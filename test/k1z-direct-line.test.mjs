import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  K1Z_CONTENT_CANONICALIZATION,
  K1Z_WIRE_ENCODING,
  sealK1ZPacket,
  serializeK1ZPacket,
  summarizeK1ZLearning,
  validateK1ZPacket,
  validateK1ZPacketLedger,
  verifyK1ZPacketBytes,
  verifyK1ZPacketFile,
} from "../k1z-direct-line.mjs";

const REPLAY_A = "a".repeat(64);
const REPLAY_B = "b".repeat(64);

function referenceCanonicalJSON(value) {
  if (Array.isArray(value)) {
    return `[${value.map(referenceCanonicalJSON).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) =>
        `${JSON.stringify(key)}:${referenceCanonicalJSON(value[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function referenceSHA256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

function formalApprovalDraft(overrides = {}) {
  return coordinationDraft({
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
    ...overrides,
  });
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
  assert.equal(
    first.integrity.content_canonicalization,
    K1Z_CONTENT_CANONICALIZATION,
  );
  assert.equal(first.integrity.wire_encoding, K1Z_WIRE_ENCODING);
  assert.match(first.integrity.content_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateK1ZPacket(first), { valid: true, errors: [] });
});

test("canonical content sorts integer-like keys by UTF-16 code units", () => {
  const packet = sealK1ZPacket(coordinationDraft({
    payload: {
      "2": "two",
      "10": "ten",
    },
  }));
  const unsigned = structuredClone(packet);
  delete unsigned.integrity;
  const canonical = referenceCanonicalJSON(unsigned);

  assert.ok(canonical.indexOf('"10":"ten"') < canonical.indexOf('"2":"two"'));
  assert.equal(
    packet.integrity.content_sha256,
    referenceSHA256(canonical),
  );
});

test("wire verification separates canonical content from exact file bytes", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const bytes = Buffer.from(serializeK1ZPacket(packet), "utf8");
  const first = verifyK1ZPacketBytes(bytes);

  assert.equal(first.valid, true);
  assert.equal(first.contract_declared, true);
  assert.equal(first.legacy, false);
  assert.equal(first.identity_action_eligible, false);
  assert.equal(first.content_sha256, packet.integrity.content_sha256);
  assert.match(first.file_sha256, /^[a-f0-9]{64}$/);

  const checked = verifyK1ZPacketBytes(bytes, {
    contentSHA256: first.content_sha256,
    fileSHA256: first.file_sha256,
  });
  assert.equal(checked.valid, true);
  assert.equal(checked.identity_action_eligible, false);
});

test("wire verification rejects whitespace drift and digest-label confusion", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const bytes = Buffer.from(serializeK1ZPacket(packet), "utf8");
  const report = verifyK1ZPacketBytes(bytes);
  const whitespaceDrift = Buffer.from(JSON.stringify(packet), "utf8");

  const drifted = verifyK1ZPacketBytes(whitespaceDrift, {
    contentSHA256: report.content_sha256,
    fileSHA256: report.file_sha256,
  });
  assert.equal(drifted.valid, false);
  assert.match(drifted.errors.join(" "), /wire encoding|file digest/);

  const mislabeled = verifyK1ZPacketBytes(bytes, {
    fileSHA256: report.content_sha256,
  });
  assert.equal(mislabeled.valid, false);
  assert.match(mislabeled.errors.join(" "), /file digest/);
});

test("committed packets retain exact legacy and declared hash pairs", () => {
  const fixtures = [
    {
      path: "experiments/k1z-direct-line-hrafn-000002.json",
      content: "9894366fac0e2cbb656db4dc55ed300b646afbccf8776f41672b6c86cc5b50b1",
      file: "64e8d278a63828c6e879c52a7e974419d50e8397cb63c0f028208a1b16e05f3e",
      declared: false,
    },
    {
      path: "experiments/k1z-direct-line-hrafn-000003.json",
      content: "7556509479410d949b33f7ca2325c29309eab8477d22b873206dd6d0c4289e80",
      file: "4623f4c58732978f761e2364a8d162d4148f4353d57dd8002b3ca699e84ef8a4",
      declared: true,
    },
  ];
  for (const fixture of fixtures) {
    const report = verifyK1ZPacketBytes(readFileSync(fixture.path), {
      contentSHA256: fixture.content,
      fileSHA256: fixture.file,
    });
    assert.equal(report.valid, true);
    assert.equal(report.content_sha256, fixture.content);
    assert.equal(report.file_sha256, fixture.file);
    assert.equal(report.contract_declared, fixture.declared);
    assert.equal(report.legacy, !fixture.declared);
    assert.equal(report.identity_action_eligible, false);
  }
});

test("legacy packets are valid evidence but ineligible for identity action", () => {
  const bytes = readFileSync(
    "experiments/k1z-direct-line-hrafn-000002.json",
  );
  const report = verifyK1ZPacketBytes(bytes);

  assert.equal(report.valid, true);
  assert.equal(report.legacy, true);
  assert.equal(report.identity_action_eligible, false);
  assert.deepEqual(report.errors, []);
});

test("raw verifier rejects byte and JSON ambiguity", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const text = serializeK1ZPacket(packet);
  const mutations = [
    text.replaceAll("\n", "\r\n"),
    `\uFEFF${text}`,
    text.slice(0, -1),
    `${text}\n`,
    text.replace("\n", " \n"),
    text.replace("{\n", '{\n  "protocol": "duplicate",\n'),
  ];
  for (const mutation of mutations) {
    assert.equal(verifyK1ZPacketBytes(Buffer.from(mutation)).valid, false);
  }
  const invalidUTF8 = Buffer.from(text);
  invalidUTF8[20] = 0xff;
  const invalidReport = verifyK1ZPacketBytes(invalidUTF8);
  assert.equal(invalidReport.valid, false);
  assert.match(invalidReport.errors.join(" "), /UTF-8/);
});

test("raw verifier distinguishes semantic, contract, and ordering drift", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const base = verifyK1ZPacketBytes(Buffer.from(serializeK1ZPacket(packet)));
  const reordered = Object.fromEntries(Object.entries(packet).reverse());
  const reorderReport = verifyK1ZPacketBytes(
    Buffer.from(serializeK1ZPacket(reordered)),
    {
      contentSHA256: base.content_sha256,
      fileSHA256: base.file_sha256,
    },
  );
  assert.equal(reorderReport.content_sha256, base.content_sha256);
  assert.equal(reorderReport.valid, false);
  assert.match(reorderReport.errors.join(" "), /file digest/);

  const contentTamper = structuredClone(packet);
  contentTamper.payload.objective = "tampered";
  assert.match(
    verifyK1ZPacketBytes(
      Buffer.from(serializeK1ZPacket(contentTamper)),
    ).errors.join(" "),
    /content digest/,
  );

  const contractTamper = structuredClone(packet);
  contractTamper.integrity.wire_encoding = "other";
  assert.match(
    verifyK1ZPacketBytes(
      Buffer.from(serializeK1ZPacket(contractTamper)),
    ).errors.join(" "),
    /wire encoding/,
  );
});

test("two-input verifier rejects packet and byte disagreement", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const other = sealK1ZPacket(coordinationDraft({
    message_id: "hrafn-000099",
    sequence: 99,
  }));
  const report = verifyK1ZPacketFile(
    packet,
    Buffer.from(serializeK1ZPacket(other)),
  );
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /packet argument/);
});

test("two-input verifier rejects packet values that JSON would discard", () => {
  const packet = sealK1ZPacket(coordinationDraft());
  const bytes = Buffer.from(serializeK1ZPacket(packet));
  packet.extra = undefined;

  const report = verifyK1ZPacketFile(packet, bytes);
  assert.equal(report.valid, false);
  assert.equal(report.content_sha256, null);
  assert.match(report.errors.join(" "), /lossless JSON/);
});

test("two-input verifier returns invalid for lossy values parsed from bytes", () => {
  const packet = sealK1ZPacket(coordinationDraft({
    payload: { value: 0 },
  }));
  const text = serializeK1ZPacket(packet).replace(
    '"value": 0',
    '"value": -0',
  );

  const report = verifyK1ZPacketFile(packet, Buffer.from(text));
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /negative zero|wire encoding/);
});

test("raw verifier is total for non-packet JSON and exact DataView bytes", () => {
  const invalid = verifyK1ZPacketBytes(Buffer.from("null\n"));
  assert.equal(invalid.valid, false);
  assert.equal(invalid.content_sha256, null);
  assert.match(invalid.errors.join(" "), /packet must be an object/);

  const packet = sealK1ZPacket(coordinationDraft());
  const bytes = Buffer.from(serializeK1ZPacket(packet));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const report = verifyK1ZPacketBytes(view);
  assert.equal(report.valid, true);
  assert.equal(report.file_sha256, referenceSHA256(bytes));
});

test("CLI verifier returns zero only for both exact hashes", () => {
  const packetPath = "experiments/k1z-direct-line-hrafn-000003.json";
  const content = "7556509479410d949b33f7ca2325c29309eab8477d22b873206dd6d0c4289e80";
  const file = "4623f4c58732978f761e2364a8d162d4148f4353d57dd8002b3ca699e84ef8a4";
  const base = [
    "scripts/k1z-direct-line.mjs",
    "verify",
    packetPath,
    "--file-sha256",
    file,
    "--content-sha256",
  ];
  assert.equal(spawnSync(process.execPath, [...base, content]).status, 0);
  assert.notEqual(spawnSync(process.execPath, [...base, file]).status, 0);
});

test("sealing rejects values outside lossless JSON", () => {
  for (const invalid of [
    { extra: undefined },
    { extra: Number.NaN },
    { extra: Number.POSITIVE_INFINITY },
    { extra: -0 },
    { extra: () => true },
    { extra: Symbol("no") },
    { extra: 1n },
  ]) {
    assert.throws(
      () => sealK1ZPacket(coordinationDraft(invalid)),
      /lossless JSON/,
    );
  }
  const symbolKeyed = coordinationDraft();
  symbolKeyed[Symbol("hidden")] = "not on the wire";
  assert.throws(
    () => sealK1ZPacket(symbolKeyed),
    /symbol key/,
  );
  const hiddenArrayProperty = coordinationDraft({
    payload: { items: [] },
  });
  hiddenArrayProperty.payload.items["4294967295"] = "not on the wire";
  assert.throws(
    () => sealK1ZPacket(hiddenArrayProperty),
    /unsupported array property/,
  );
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
  const draft = formalApprovalDraft();
  const packet = sealK1ZPacket(draft);
  assert.equal(validateK1ZPacket(packet).valid, true);
  const bytes = Buffer.from(serializeK1ZPacket(packet));
  const wire = verifyK1ZPacketBytes(bytes);
  const externallyBound = verifyK1ZPacketBytes(bytes, {
    contentSHA256: wire.content_sha256,
    fileSHA256: wire.file_sha256,
  });
  assert.equal(wire.identity_action_eligible, false);
  assert.equal(externallyBound.identity_action_eligible, true);

  const duplicate = sealK1ZPacket({
    ...draft,
    message_id: "odin-000002",
    sequence: 2,
  });
  const ledger = validateK1ZPacketLedger([packet, duplicate]);
  assert.equal(ledger.valid, false);
  assert.match(ledger.errors.join(" "), /more than one formal APPROVE/);
});

test("legacy formal approval is invalid in packet, ledger, and CLI validation", () => {
  const packet = sealK1ZPacket(formalApprovalDraft());
  delete packet.integrity.content_canonicalization;
  delete packet.integrity.wire_encoding;

  const direct = validateK1ZPacket(packet);
  assert.equal(direct.valid, false);
  assert.match(direct.errors.join(" "), /formal verdict.*declared integrity/i);
  const ledger = validateK1ZPacketLedger([packet]);
  assert.equal(ledger.valid, false);
  assert.match(ledger.errors.join(" "), /formal verdict.*declared integrity/i);

  const directory = mkdtempSync(path.join(tmpdir(), "k1z-legacy-formal-"));
  const packetPath = path.join(directory, "packet.json");
  try {
    writeFileSync(packetPath, serializeK1ZPacket(packet));
    const result = spawnSync(process.execPath, [
      "scripts/k1z-direct-line.mjs",
      "validate",
      packetPath,
    ]);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
