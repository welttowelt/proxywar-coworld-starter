#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [gatePath, modeFlag] = process.argv.slice(2);
const requiredAction = modeFlag === "--require-upload"
  ? "upload"
  : modeFlag === "--require-submit"
    ? "submit"
    : null;

if (!gatePath || !requiredAction || process.argv.length !== 4) {
  throw new Error(
    "usage: node validate-mickey-mutation-gate.mjs GATE " +
    "--require-upload|--require-submit",
  );
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAYER_ID = new RegExp(`^ply_${UUID.source.slice(1, -1)}$`, "i");
const LEAGUE_ID = new RegExp(`^league_${UUID.source.slice(1, -1)}$`, "i");
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const POLICY_NAME = "mickey-mouse-intent";
const POLICY_LABEL = /^mickey-mouse-intent:v[1-9][0-9]*$/;
const POLICY_REF = /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

const errors = [];
const receiptCache = new Map();
const gateBytes = await readFile(gatePath);
const gate = JSON.parse(gateBytes);

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label} keys must be exactly ${expected.join(",")}`);
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function zero(value) {
  return value === 0;
}

async function boundReceipt(binding, label) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    errors.push(`${label} binding is required`);
    return null;
  }
  requireExactKeys(binding, ["path", "sha256"], `${label} binding`);
  if (typeof binding.path !== "string" || !binding.path.startsWith("/")) {
    errors.push(`${label}.path must be absolute`);
    return null;
  }
  if (!SHA256.test(binding.sha256 ?? "")) {
    errors.push(`${label}.sha256 must be a full lowercase SHA-256`);
    return null;
  }
  if (receiptCache.has(binding.path)) {
    errors.push(`${label}.path duplicates another evidence receipt`);
    return null;
  }
  let bytes;
  try {
    bytes = await readFile(binding.path);
  } catch {
    errors.push(`${label}.path cannot be read`);
    return null;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== binding.sha256) {
    errors.push(`${label}.sha256 does not match the receipt bytes`);
    return null;
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes);
  } catch {
    errors.push(`${label} is not valid JSON`);
    return null;
  }
  receiptCache.set(binding.path, receipt);
  return receipt;
}

function exactCandidate(receipt, label, { policyVersion = false } = {}) {
  if (!receipt || typeof receipt !== "object") return;
  if (receipt.candidate_source_commit !== gate.candidate?.source_commit) {
    errors.push(`${label} candidate source commit does not match the gate`);
  }
  if (receipt.candidate_image_id !== gate.candidate?.image_id) {
    errors.push(`${label} candidate image ID does not match the gate`);
  }
  if (policyVersion && receipt.candidate_policy_version_id !== gate.candidate?.policy_version_id) {
    errors.push(`${label} candidate policy-version ID does not match the gate`);
  }
}

function exactZeroSafety(receipt, label) {
  for (const key of ["unexplained_holds", "rejections", "k1z_harm"]) {
    if (!zero(receipt?.[key])) errors.push(`${label}.${key} must be zero`);
  }
}

requireExactKeys(
  gate,
  ["schema_version", "lane", "action", "expected_player_id", "expected_league_id", "candidate", "gates", "evidence"],
  "gate",
);
if (gate.schema_version !== 1) errors.push("schema_version must be 1");
if (gate.lane !== "mickey") errors.push("lane must be mickey");
if (gate.action !== requiredAction) errors.push(`action must be ${requiredAction}`);
if (!PLAYER_ID.test(gate.expected_player_id ?? "")) {
  errors.push("expected_player_id must be a full ply_ UUID");
}
if (!LEAGUE_ID.test(gate.expected_league_id ?? "")) {
  errors.push("expected_league_id must be a full league_ UUID");
}

const candidateKeys = [
  "policy_name",
  "policy_ref",
  "source_commit",
  "parent_commit",
  "image_id",
  "entrypoint",
];
if (requiredAction === "submit") {
  candidateKeys.push("uploaded_label", "policy_version_id");
}
requireExactKeys(gate.candidate, candidateKeys, "candidate");
if (gate.candidate?.policy_name !== POLICY_NAME) {
  errors.push(`candidate.policy_name must be ${POLICY_NAME}`);
}
if (!POLICY_REF.test(gate.candidate?.policy_ref ?? "")) {
  errors.push("candidate.policy_ref must be one exact tagged image reference");
}
if (!COMMIT.test(gate.candidate?.source_commit ?? "")) {
  errors.push("candidate.source_commit must be a full lowercase commit");
}
if (!COMMIT.test(gate.candidate?.parent_commit ?? "")) {
  errors.push("candidate.parent_commit must be a full lowercase commit");
}
if (gate.candidate?.source_commit === gate.candidate?.parent_commit) {
  errors.push("candidate source and parent commits must differ");
}
if (!IMAGE_ID.test(gate.candidate?.image_id ?? "")) {
  errors.push("candidate.image_id must be an exact sha256 image ID");
}
if (gate.candidate?.entrypoint !== "/app/llm-player.mjs") {
  errors.push("candidate.entrypoint must be /app/llm-player.mjs");
}
if (requiredAction === "submit") {
  if (!POLICY_LABEL.test(gate.candidate?.uploaded_label ?? "")) {
    errors.push("candidate.uploaded_label must be mickey-mouse-intent:vN");
  }
  if (!UUID.test(gate.candidate?.policy_version_id ?? "")) {
    errors.push("candidate.policy_version_id must be a UUID");
  }
}

const uploadGateKeys = [
  "source_ready",
  "local_mechanism_verified",
  "mechanism_reach",
  "accepted_actions",
  "unexplained_holds",
  "rejections",
  "k1z_harm",
  "preupload_rci_passed",
];
const submitGateKeys = [
  ...uploadGateKeys,
  "diagnostic_uploaded",
  "hosted_passed",
  "hosted_episodes",
  "hosted_wins",
  "regression_passed",
  "regression_episodes",
  "regression_wins",
  "final_rci_passed",
];
requireExactKeys(
  gate.gates,
  requiredAction === "upload" ? uploadGateKeys : submitGateKeys,
  "gates",
);
for (const key of ["source_ready", "local_mechanism_verified", "preupload_rci_passed"]) {
  if (gate.gates?.[key] !== true) errors.push(`gates.${key} must be true`);
}
for (const key of ["mechanism_reach", "accepted_actions"]) {
  if (!positiveInteger(gate.gates?.[key])) errors.push(`gates.${key} must be positive`);
}
for (const key of ["unexplained_holds", "rejections", "k1z_harm"]) {
  if (!zero(gate.gates?.[key])) errors.push(`gates.${key} must be zero`);
}
if (requiredAction === "submit") {
  for (const key of ["diagnostic_uploaded", "hosted_passed", "regression_passed", "final_rci_passed"]) {
    if (gate.gates?.[key] !== true) errors.push(`gates.${key} must be true`);
  }
  if (gate.gates?.hosted_episodes !== 4 || gate.gates?.hosted_wins !== 4) {
    errors.push("hosted gate must be exactly 4/4");
  }
  if (gate.gates?.regression_episodes !== 20 || gate.gates?.regression_wins !== 20) {
    errors.push("regression gate must be exactly 20/20");
  }
}

const uploadEvidenceKeys = ["local_audit", "preupload_rci"];
const submitEvidenceKeys = [
  ...uploadEvidenceKeys,
  "upload_receipt",
  "hosted_regression_audit",
  "final_rci",
];
requireExactKeys(
  gate.evidence,
  requiredAction === "upload" ? uploadEvidenceKeys : submitEvidenceKeys,
  "evidence",
);

const localAudit = await boundReceipt(gate.evidence?.local_audit, "evidence.local_audit");
exactCandidate(localAudit, "local audit");
if (localAudit) {
  if (localAudit.status !== "passed" || localAudit.verdict !== "PASS_LOCAL_MECHANISM") {
    errors.push("local audit must be PASS_LOCAL_MECHANISM with passed status");
  }
  if (localAudit.mechanism_reach !== gate.gates?.mechanism_reach) {
    errors.push("local audit mechanism reach does not match the gate");
  }
  if (localAudit.accepted_actions !== gate.gates?.accepted_actions) {
    errors.push("local audit accepted actions do not match the gate");
  }
  exactZeroSafety(localAudit, "local audit");
}

const preuploadRci = await boundReceipt(gate.evidence?.preupload_rci, "evidence.preupload_rci");
exactCandidate(preuploadRci, "pre-upload RCI");
if (preuploadRci) {
  if (preuploadRci.status !== "passed" || preuploadRci.verdict !== "PASS_PREUPLOAD_RCI") {
    errors.push("pre-upload RCI must have a passed PASS_PREUPLOAD_RCI verdict");
  }
  if (!Array.isArray(preuploadRci.unresolved_violations) || preuploadRci.unresolved_violations.length !== 0) {
    errors.push("pre-upload RCI must have zero unresolved violations");
  }
}

if (requiredAction === "submit") {
  const uploadReceipt = await boundReceipt(gate.evidence?.upload_receipt, "evidence.upload_receipt");
  exactCandidate(uploadReceipt, "upload receipt");
  if (uploadReceipt) {
    if (
      uploadReceipt.lane !== "mickey" ||
      uploadReceipt.mode !== "upload" ||
      uploadReceipt.status !== "completed" ||
      uploadReceipt.active_player_id !== gate.expected_player_id ||
      uploadReceipt.expected_player_id !== gate.expected_player_id ||
      uploadReceipt.league_id !== gate.expected_league_id ||
      uploadReceipt.credential_isolated !== true ||
      uploadReceipt.exclusive_player_roster !== true ||
      uploadReceipt.candidate_policy_ref !== gate.candidate?.policy_ref ||
      uploadReceipt.uploaded_label !== gate.candidate?.uploaded_label ||
      uploadReceipt.policy_version_id !== gate.candidate?.policy_version_id
    ) {
      errors.push("upload receipt is not the completed Mickey upload bound by this gate");
    }
  }

  const hostedEvidence = await boundReceipt(
    gate.evidence?.hosted_regression_audit,
    "evidence.hosted_regression_audit",
  );
  if (hostedEvidence) {
    const candidate = hostedEvidence.candidate ?? {};
    const matched = hostedEvidence.matched_baseline ?? {};
    const hosted = hostedEvidence.hosted ?? {};
    const regression = hostedEvidence.regression ?? {};
    const confirmation = hostedEvidence.confirmation ?? {};
    const allTrue = (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.values(value).length > 0 && Object.values(value).every((item) => item === true);
    if (
      hostedEvidence.schema_version !== 1 ||
      hostedEvidence.kind !== "mickey_hosted_evidence_audit" ||
      hostedEvidence.evidence_scope !== "hosted_and_regression_only"
    ) {
      errors.push("hosted/regression receipt is not a Mickey hosted evidence audit");
    }
    if (
      candidate.policy_ref !== gate.candidate?.uploaded_label ||
      candidate.policy_version_id !== gate.candidate?.policy_version_id ||
      !["mm1g", "mm1c"].includes(candidate.marker)
    ) {
      errors.push("hosted/regression candidate identity does not match the gate");
    }
    if (matched.passed !== true || !allTrue(matched.checks)) {
      errors.push("hosted audit does not prove a matched baseline");
    }
    if (
      hosted.status !== "completed" || hosted.passed !== true ||
      hosted.episodes !== 4 || hosted.wins !== 4 ||
      !positiveInteger(hosted.decisions) || hosted.accepted !== hosted.decisions ||
      hosted.rejected !== 0 || hosted.unconfirmed_acceptance !== 0 ||
      hosted.illegal_selections !== 0 || hosted.unexplained_holds !== 0 ||
      hosted.k1z_harm_count !== 0 || hosted.unresolved_harmful_targets !== 0 ||
      !positiveInteger(hosted.marker_count) ||
      hosted.nondegraded_marker_count !== hosted.marker_count ||
      hosted.invalid_marker_count !== 0 || !allTrue(hosted.checks)
    ) {
      errors.push("hosted audit does not prove matched clean 4/4 evidence");
    }
    if (
      regression.status !== "completed" || regression.passed !== true ||
      regression.episodes !== 20 || regression.wins !== 20 ||
      !positiveInteger(regression.decisions) || regression.accepted !== regression.decisions ||
      regression.rejected !== 0 || regression.unconfirmed_acceptance !== 0 ||
      regression.illegal_selections !== 0 || regression.unexplained_holds !== 0 ||
      regression.k1z_harm_count !== 0 || regression.unresolved_harmful_targets !== 0 ||
      regression.invalid_marker_count !== 0 || !allTrue(regression.checks)
    ) {
      errors.push("regression audit does not prove separate clean 20/20 evidence");
    }
    if (
      confirmation.matched_hosted_4_of_4_passed !== true ||
      confirmation.separate_regression_20_of_20_passed !== true ||
      confirmation.hosted_and_regression_evidence_passed !== true ||
      confirmation.final_rci_still_required !== true ||
      confirmation.live_identity_submission_membership_still_required !== true ||
      confirmation.promotion_allowed !== false
    ) {
      errors.push("hosted/regression confirmation boundary is invalid");
    }
  }

  const finalRci = await boundReceipt(gate.evidence?.final_rci, "evidence.final_rci");
  exactCandidate(finalRci, "final RCI", { policyVersion: true });
  if (finalRci) {
    if (finalRci.status !== "passed" || finalRci.verdict !== "PASS_RCI") {
      errors.push("final RCI must have a passed PASS_RCI verdict");
    }
    if (!Array.isArray(finalRci.unresolved_violations) || finalRci.unresolved_violations.length !== 0) {
      errors.push("final RCI must have zero unresolved violations");
    }
  }
}

const report = {
  schema_version: 1,
  valid: errors.length === 0,
  action: requiredAction,
  lane: "mickey",
  gate_sha256: createHash("sha256").update(gateBytes).digest("hex"),
  expected_player_id: gate.expected_player_id ?? null,
  expected_league_id: gate.expected_league_id ?? null,
  candidate_source_commit: gate.candidate?.source_commit ?? null,
  candidate_image_id: gate.candidate?.image_id ?? null,
  errors,
};

process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.valid) process.exitCode = 1;
