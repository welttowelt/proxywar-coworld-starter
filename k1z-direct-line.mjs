import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const KINDS = new Set(["coordination", "evidence", "hypothesis", "ack", "verdict"]);
const DECISIONS = new Set(["APPROVE", "REVISE", "REJECT", "INSUFFICIENT"]);

export const K1Z_CONTENT_CANONICALIZATION =
  "k1z-json-v1:omit-integrity:recursive-key-sort:json-stringify:utf8";
export const K1Z_WIRE_ENCODING = "k1z-pretty-json-v1:utf8:2-space:lf";

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contentSHA256(packet) {
  const unsigned = structuredClone(packet);
  delete unsigned.integrity;
  return sha256(canonicalJSON(unsigned));
}

function packetErrors(packet, requireIntegrity) {
  const errors = [];
  if (!object(packet)) return ["packet must be an object"];
  if (packet.schema_version !== 1) errors.push("schema_version must be 1");
  if (packet.protocol !== "k1z-direct-line") {
    errors.push("protocol must be k1z-direct-line");
  }
  for (const field of ["campaign_id", "message_id"]) {
    if (
      typeof packet[field] !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(packet[field])
    ) {
      errors.push(`${field} is invalid`);
    }
  }
  if (!Number.isSafeInteger(packet.sequence) || packet.sequence < 1) {
    errors.push("sequence must be a positive safe integer");
  }
  if (
    typeof packet.created_at !== "string" ||
    !Number.isFinite(Date.parse(packet.created_at))
  ) {
    errors.push("created_at must be an ISO timestamp");
  }
  if (!["hrafn", "odin"].includes(packet.from)) errors.push("from is invalid");
  if (!["hrafn", "odin"].includes(packet.to) || packet.to === packet.from) {
    errors.push("to is invalid");
  }
  if (!KINDS.has(packet.kind)) errors.push("kind is invalid");
  if (
    packet.in_reply_to !== null &&
    (typeof packet.in_reply_to !== "string" || packet.in_reply_to.length === 0)
  ) {
    errors.push("in_reply_to must be null or a message ID");
  }
  if (!object(packet.authority)) {
    errors.push("authority is required");
  } else {
    if (typeof packet.authority.advisory !== "boolean") {
      errors.push("authority.advisory must be boolean");
    }
    if (typeof packet.authority.formal_approval !== "boolean") {
      errors.push("authority.formal_approval must be boolean");
    }
    if (!["none", "hrafn"].includes(packet.authority.mutation_scope)) {
      errors.push("authority.mutation_scope must be none or hrafn");
    }
  }
  if (!object(packet.payload)) errors.push("payload is required");
  if (!object(packet.evidence)) {
    errors.push("evidence is required");
  } else {
    if (
      packet.evidence.source_commit !== null &&
      !COMMIT.test(packet.evidence.source_commit ?? "")
    ) {
      errors.push("evidence.source_commit must be null or a full commit");
    }
    if (
      packet.evidence.image_digest !== null &&
      !IMAGE_SHA256.test(packet.evidence.image_digest ?? "")
    ) {
      errors.push("evidence.image_digest must be null or sha256:<64 hex>");
    }
    if (
      !Array.isArray(packet.evidence.replay_sha256) ||
      packet.evidence.replay_sha256.some((digest) => !SHA256.test(digest))
    ) {
      errors.push("evidence.replay_sha256 must contain only SHA-256 digests");
    }
  }

  const formal = packet.authority?.formal_approval === true;
  if (formal) {
    if (
      packet.from !== "odin" ||
      packet.to !== "hrafn" ||
      packet.kind !== "verdict" ||
      packet.authority?.advisory !== false ||
      packet.authority?.mutation_scope !== "hrafn"
    ) {
      errors.push("formal approval must be a non-advisory Odin verdict for Hrafn");
    }
    if (!DECISIONS.has(packet.payload?.decision)) {
      errors.push("formal verdict decision is invalid");
    }
    if (packet.payload?.decision === "APPROVE") {
      const gates = packet.payload?.gates;
      if (
        !object(gates) ||
        ![
          "source_image_bound",
          "local_matched",
          "fail_closed_continuation",
          "zero_k1z_harm",
        ].every((gate) => gates[gate] === true)
      ) {
        errors.push("formal APPROVE requires the conditional gate chain");
      }
      if (
        !COMMIT.test(packet.evidence?.source_commit ?? "") ||
        !IMAGE_SHA256.test(packet.evidence?.image_digest ?? "")
      ) {
        errors.push("formal APPROVE requires exact source and image");
      }
    }
  } else if (packet.authority?.advisory !== true) {
    errors.push("non-formal packets must be advisory");
  }

  if (requireIntegrity) {
    if (
      packet.integrity?.algorithm !== "sha256" ||
      !SHA256.test(packet.integrity?.content_sha256 ?? "")
    ) {
      errors.push("integrity digest is required");
    } else {
      if (contentSHA256(packet) !== packet.integrity.content_sha256) {
        errors.push("content digest does not match packet");
      }
    }
    const contractDeclared =
      packet.integrity?.content_canonicalization !== undefined ||
      packet.integrity?.wire_encoding !== undefined;
    if (
      contractDeclared &&
      packet.integrity?.content_canonicalization !==
        K1Z_CONTENT_CANONICALIZATION
    ) {
      errors.push("integrity content canonicalization is invalid");
    }
    if (
      contractDeclared &&
      packet.integrity?.wire_encoding !== K1Z_WIRE_ENCODING
    ) {
      errors.push("integrity wire encoding is invalid");
    }
  }
  return errors;
}

export function sealK1ZPacket(draft) {
  const packet = structuredClone(draft);
  delete packet.integrity;
  const errors = packetErrors(packet, false);
  if (errors.length > 0) throw new Error(errors.join("; "));
  packet.integrity = {
    algorithm: "sha256",
    content_canonicalization: K1Z_CONTENT_CANONICALIZATION,
    wire_encoding: K1Z_WIRE_ENCODING,
    content_sha256: contentSHA256(packet),
  };
  return packet;
}

export function serializeK1ZPacket(packet) {
  return `${JSON.stringify(packet, null, 2)}\n`;
}

export function verifyK1ZPacketFile(packet, bytes, expected = {}) {
  const packetReport = validateK1ZPacket(packet);
  const wireBytes =
    typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  const expectedWireBytes = Buffer.from(serializeK1ZPacket(packet), "utf8");
  const report = {
    valid: false,
    protocol: "k1z-direct-line",
    content_canonicalization: K1Z_CONTENT_CANONICALIZATION,
    wire_encoding: K1Z_WIRE_ENCODING,
    content_sha256: contentSHA256(packet),
    file_sha256: sha256(wireBytes),
    errors: [...packetReport.errors],
  };

  if (!wireBytes.equals(expectedWireBytes)) {
    report.errors.push("file bytes do not match declared wire encoding");
  }
  if (
    expected.contentSHA256 !== undefined &&
    (!SHA256.test(expected.contentSHA256) ||
      report.content_sha256 !== expected.contentSHA256)
  ) {
    report.errors.push("expected content digest does not match");
  }
  if (
    expected.fileSHA256 !== undefined &&
    (!SHA256.test(expected.fileSHA256) ||
      report.file_sha256 !== expected.fileSHA256)
  ) {
    report.errors.push("expected file digest does not match");
  }
  report.valid = report.errors.length === 0;
  return report;
}

export function validateK1ZPacket(packet) {
  const errors = packetErrors(packet, true);
  return { valid: errors.length === 0, errors };
}

export function validateK1ZPacketLedger(packets) {
  const errors = [];
  const messageIDs = new Set();
  const lastSequence = new Map();
  const approvals = new Map();
  for (const [index, packet] of packets.entries()) {
    const result = validateK1ZPacket(packet);
    errors.push(...result.errors.map((error) => `packet ${index}: ${error}`));
    if (messageIDs.has(packet.message_id)) {
      errors.push(`duplicate message_id ${packet.message_id}`);
    }
    messageIDs.add(packet.message_id);
    const prior = lastSequence.get(packet.from) ?? 0;
    if (packet.sequence <= prior) {
      errors.push(`non-increasing ${packet.from} sequence ${packet.sequence}`);
    }
    lastSequence.set(packet.from, packet.sequence);
    if (
      packet.authority?.formal_approval === true &&
      packet.payload?.decision === "APPROVE"
    ) {
      const count = (approvals.get(packet.campaign_id) ?? 0) + 1;
      approvals.set(packet.campaign_id, count);
      if (count > 1) {
        errors.push(`campaign ${packet.campaign_id} has more than one formal APPROVE`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function learningErrors(row, index) {
  const errors = [];
  const prefix = `row ${index}`;
  if (!object(row)) return [`${prefix}: record must be an object`];
  if (row.schema_version !== 1) errors.push(`${prefix}: schema_version must be 1`);
  if (row.record_type !== "k1z-game-learning") {
    errors.push(`${prefix}: record_type must be k1z-game-learning`);
  }
  for (const field of [
    "campaign_id",
    "run_id",
    "pair_id",
    "arm",
    "opponent_mix",
    "map",
  ]) {
    if (typeof row[field] !== "string" || row[field].length === 0) {
      errors.push(`${prefix}: ${field} is required`);
    }
  }
  if (!["candidate", "parent"].includes(row.role)) {
    errors.push(`${prefix}: role is invalid`);
  }
  if (
    !(
      (typeof row.seat === "string" && row.seat.length > 0) ||
      nonnegativeInteger(row.seat)
    )
  ) {
    errors.push(`${prefix}: seat is invalid`);
  }
  if (typeof row.won !== "boolean") errors.push(`${prefix}: won must be boolean`);
  if (!Number.isFinite(row.score)) errors.push(`${prefix}: score must be finite`);
  for (const field of [
    "final_tiles",
    "decision_count",
    "accepted_decisions",
    "holds",
    "rejected_decisions",
    "fallbacks",
    "planner_degraded",
    "k1z_harm",
    "marker_count",
  ]) {
    if (!nonnegativeInteger(row[field])) {
      errors.push(`${prefix}: ${field} must be a nonnegative safe integer`);
    }
  }
  if (row.accepted_decisions > row.decision_count) {
    errors.push(`${prefix}: accepted_decisions exceeds decision_count`);
  }
  if (typeof row.marker !== "string" || row.marker.length === 0) {
    errors.push(`${prefix}: marker is required`);
  }
  if (!SHA256.test(row.replay_sha256 ?? "")) {
    errors.push(`${prefix}: replay_sha256 is invalid`);
  }
  if (!object(row.checkpoints)) {
    errors.push(`${prefix}: checkpoints are required`);
  } else {
    for (const field of [
      "decision_20_tiles",
      "frontier_exhaustion_turn",
      "frontier_exhaustion_tiles",
      "cap_escape_turn",
      "cap_escape_tiles",
      "post_cap_tiles",
      "post_cap_gain",
    ]) {
      const value = row.checkpoints[field];
      if (value !== null && !nonnegativeInteger(value)) {
        errors.push(`${prefix}: checkpoints.${field} is invalid`);
      }
    }
  }
  return errors;
}

function aggregate(rows) {
  const sum = (selector) => rows.reduce((total, row) => total + selector(row), 0);
  return {
    episodes: rows.length,
    wins: sum((row) => Number(row.won)),
    final_tiles: sum((row) => row.final_tiles),
    mean_final_tiles: rows.length === 0 ? 0 : sum((row) => row.final_tiles) / rows.length,
    mean_post_cap_gain:
      rows.length === 0
        ? 0
        : sum((row) => row.checkpoints.post_cap_gain ?? 0) / rows.length,
    marker_count: sum((row) => row.marker_count),
    decisions: sum((row) => row.decision_count),
    accepted: sum((row) => row.accepted_decisions),
    holds: sum((row) => row.holds),
    rejections: sum((row) => row.rejected_decisions),
    fallbacks: sum((row) => row.fallbacks),
    planner_degraded: sum((row) => row.planner_degraded),
    k1z_harm: sum((row) => row.k1z_harm),
  };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeK1ZLearning(rows, { candidateArm, parentArm }) {
  const errors = rows.flatMap(learningErrors);
  const campaigns = new Set(rows.map((row) => row?.campaign_id));
  if (campaigns.size !== 1) errors.push("records must share one campaign_id");
  const replayHashes = new Set();
  for (const row of rows) {
    if (replayHashes.has(row?.replay_sha256)) errors.push("replay hashes must be unique");
    replayHashes.add(row?.replay_sha256);
  }
  const candidateRows = rows.filter(
    (row) => row.arm === candidateArm && row.role === "candidate",
  );
  const parentRows = rows.filter(
    (row) => row.arm === parentArm && row.role === "parent",
  );
  const pairs = new Map();
  for (const row of [...candidateRows, ...parentRows]) {
    const roles = pairs.get(row.pair_id) ?? { candidate: 0, parent: 0 };
    roles[row.role] += 1;
    pairs.set(row.pair_id, roles);
  }
  const completePairs =
    pairs.size > 0 &&
    [...pairs.values()].every(
      (roles) => roles.candidate === 1 && roles.parent === 1,
    );
  const candidate = aggregate(candidateRows);
  const parent = aggregate(parentRows);
  const delta = {
    wins: candidate.wins - parent.wins,
    mean_final_tiles: candidate.mean_final_tiles - parent.mean_final_tiles,
    mean_post_cap_gain:
      candidate.mean_post_cap_gain - parent.mean_post_cap_gain,
  };
  const pairedDeltas = completePairs
    ? [...pairs.keys()].map((pairID) => {
      const candidateRow = candidateRows.find((row) => row.pair_id === pairID);
      const parentRow = parentRows.find((row) => row.pair_id === pairID);
      return {
        pair_id: pairID,
        win: Number(candidateRow.won) - Number(parentRow.won),
        final_tiles: candidateRow.final_tiles - parentRow.final_tiles,
        post_cap_gain:
          (candidateRow.checkpoints.post_cap_gain ?? 0) -
          (parentRow.checkpoints.post_cap_gain ?? 0),
      };
    })
    : [];
  const paired = {
    count: pairedDeltas.length,
    candidate_win_pairs: pairedDeltas.filter((item) => item.win > 0).length,
    parent_win_pairs: pairedDeltas.filter((item) => item.win < 0).length,
    win_ties: pairedDeltas.filter((item) => item.win === 0).length,
    candidate_higher_final_tiles: pairedDeltas.filter(
      (item) => item.final_tiles > 0,
    ).length,
    candidate_higher_post_cap_gain: pairedDeltas.filter(
      (item) => item.post_cap_gain > 0,
    ).length,
    median_final_tiles_delta: median(
      pairedDeltas.map((item) => item.final_tiles),
    ),
    median_post_cap_gain_delta: median(
      pairedDeltas.map((item) => item.post_cap_gain),
    ),
  };

  let verdict;
  if (errors.length > 0) verdict = "INVALID_EVIDENCE";
  else if (!completePairs) verdict = "INSUFFICIENT_MATCHED_DATA";
  else if (
    candidate.accepted !== candidate.decisions ||
    candidate.holds > 0 ||
    candidate.rejections > 0 ||
    candidate.fallbacks > 0 ||
    candidate.planner_degraded > 0 ||
    candidate.k1z_harm > 0
  ) {
    verdict = "REJECT_EXECUTION";
  } else if (candidate.marker_count === 0) {
    verdict = "REJECT_NO_REACH";
  } else if (
    delta.wins > 0 &&
    delta.mean_final_tiles > 0 &&
    delta.mean_post_cap_gain > 0
  ) {
    verdict = "DIRECTIONAL_ADVANTAGE";
  } else if (
    delta.wins === 0 &&
    delta.mean_final_tiles > 0 &&
    delta.mean_post_cap_gain > 0
  ) {
    verdict = "TERRITORY_SIGNAL_ONLY";
  } else {
    verdict = "REJECT_NO_MATCHED_LIFT";
  }

  return {
    schema_version: 1,
    record_type: "k1z-learning-summary",
    campaign_id: campaigns.size === 1 ? [...campaigns][0] : null,
    valid: errors.length === 0,
    errors,
    candidate_arm: candidateArm,
    parent_arm: parentArm,
    complete_pairs: completePairs ? pairs.size : 0,
    candidate,
    parent,
    delta,
    paired,
    replay_sha256: [...replayHashes].filter((value) => SHA256.test(value)),
    evidence_sha256: sha256(canonicalJSON(rows)),
    verdict,
    promotion_eligible: false,
  };
}
