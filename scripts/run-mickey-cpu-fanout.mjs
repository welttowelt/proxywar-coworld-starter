#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { auditMickeyCpuFanout } from "./audit-mickey-cpu-fanout.mjs";
import {
  ReaperIdentityRefusalError,
  ReaperLedgerLockedError,
  bindActivePodR9,
  blockPendingBeforeProviderPost,
  confirmOwnedPodAbsentR9,
  isStructuredProviderNotFound,
  preparePendingCreateR9,
  readReaperLedger,
  reaperLedgerDigest,
  reconcilePendingCreateR9,
  verifyPendingNameAbsentR9,
} from "./runpod-exact-id-reaper.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const REMOTE_VERIFIER = path.join(
  REPO_ROOT,
  "scripts",
  "verify-mickey-cpu-fanout-bundle.mjs",
);
const AUDIT_SCRIPT = path.join(REPO_ROOT, "scripts", "audit-mickey-cpu-fanout.mjs");
const REAPER_SCRIPT = path.join(REPO_ROOT, "scripts", "runpod-exact-id-reaper.mjs");
const REAPER_LAUNCHD_RENDERER = path.join(
  REPO_ROOT,
  "scripts",
  "render-runpod-exact-id-reaper-launchd.mjs",
);
const PRE_POST_RECOVERY_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "recover-mickey-r8-pre-post-create.mjs",
);
// The user transferred the Mac's former Hrafn operator slot to this
// incubator. Mickey is now both the policy identity and the machine-level
// foreground lease understood by the shared runner guard.
const RUNNER_OPERATOR_LANE = "mickey";
const RUNNER_STATE_ROOT = "/Users/olifreuler/.stormforge/proxywar-operators";
const DURABLE_REAPER_ROOT = `${RUNNER_STATE_ROOT}/mickey-runpod-reaper`;
const DURABLE_REAPER_BIN_ROOT = `${DURABLE_REAPER_ROOT}/bin`;
const DURABLE_REAPER_INSTALLATIONS_ROOT = `${DURABLE_REAPER_BIN_ROOT}/installations`;
const DURABLE_REAPER_PLIST =
  "/Users/olifreuler/Library/LaunchAgents/com.welttowelt.proxywar.mickey.runpod-reaper.plist";

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const ARCHIVE_PATH = /^[a-zA-Z0-9._/-]+$/;
const POLICY_ID = /^mickey-static-eval\/[a-z0-9][a-z0-9-]{0,39}$/;
const ALLOWED_MAPS = new Set(["World", "Asia", "Pangaea"]);
const RETAINED_ARMS = Object.freeze({
  "grow-opening": {
    mechanismClass: "grow",
    rosterClass: "all-k1z-grow",
    dockerTarget: "evaluation-grow-opening",
    entrypoint: "evaluation-grow-opening-player.mjs",
  },
  "grow-low-share": {
    mechanismClass: "grow",
    rosterClass: "all-k1z-grow",
    dockerTarget: "evaluation-grow-low-share",
    entrypoint: "evaluation-grow-low-share-player.mjs",
  },
  "convert-weakest": {
    mechanismClass: "convert",
    rosterClass: "mixed-outsider-convert",
    dockerTarget: "evaluation-convert-weakest",
    entrypoint: "evaluation-convert-weakest-player.mjs",
  },
  "convert-largest": {
    mechanismClass: "convert",
    rosterClass: "mixed-outsider-convert",
    dockerTarget: "evaluation-convert-largest",
    entrypoint: "evaluation-convert-largest-player.mjs",
  },
});
const M0_CONTRACT = Object.freeze({
  arm: "m0",
  dockerTarget: "evaluation-m0",
  entrypoint: "evaluation-m0-player.mjs",
});
const REQUIRED_SHARED_FILES = Object.freeze([
  "evaluation-static-intent-player.mjs",
  "evaluation-static-intent.mjs",
  "intent-controller.mjs",
  "strategy-engine.mjs",
]);
const FORBIDDEN_KEY = /(api.?key|secret|password|credential|access.?token|private.?key)/i;
const RUNPODCTL_SOURCE_REPOSITORY = "https://github.com/runpod/runpodctl";
const RUNPODCTL_UPSTREAM_BASE_COMMIT = "3928df943d67c89e66b4945bd5c8b38ffd512767";
const RUNPODCTL_CREATE_INTERFACE = "rest-cpu-pod-create-stdin-v3";
const RUNPODCTL_REQUEST_HASH_ALGORITHM = "sorted-json-sha256-v1";
const RUNPODCTL_REQUEST_HASH_SCOPE = "raw-request-before-redaction";
const RUNPODCTL_ENV_REDACTION_SCHEMA = "env-map-v2";
const RUNPODCTL_REDACTED_ENV_VALUE = "[REDACTED]";
const RUNPODCTL_RESPONSE_SCRUB_CONTRACT =
  "recursive-case-insensitive-string-leaves-and-map-keys";
const RUNPODCTL_IDENTITY_CONTAMINATION_CONTRACT =
  "redact-id-and-name-require-reconciliation";
const RUNPODCTL_SERIALIZED_OUTPUT_GUARD =
  "constant-value-free-failure-and-no-receipt";
const SSH_HOST_KEY_ATTESTATION_DOMAIN = "mickey-ssh-host-key-v1";
export const REMOTE_POST_RUN_ATTESTATION_STATUS = "stable";
const EXACT_ID_DELETE_RETRY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);
const HASH_FETCH_TRANSPORT_RETRY_DELAYS_MS = Object.freeze([
  0,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
  5_000,
]);
const R8_ACTIVATION_RUN_ID = "mickey-screen-g000-r8-20260721t031448z";
const R8_ACTIVATION_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "manifest-mickey-cpu-screen-g000-r8-20260721.json",
);
const R8_ACTIVATION_OUTPUT_PATH =
  "/private/tmp/mickey-cpu-screen-g000-r8-20260721t031448z";
const R8_ACTIVATION_MANIFEST_DIGEST =
  "5b53c76ef088cd3d929efc0ea72f73dfa103754804231dd6ef76a43bddcb96f2";
const R8_SOURCE_COMMIT = "0459f0f25b559dfa1869c90e89d3a6c5d14b4bee";
const R8_MANIFEST_SHA256 = "6d50207e6498e98fa36c88950188bf227b66011b977253f73aa6786c91e7bd6f";
const R8_FANOUT_SHA256 = "38d40cc44baf0a18fd87ae21bae278bdf23cd858efac86b9ce7ab9efd4667145";
const R8_PERSISTENT_REAPER_SHA256 =
  "6c63ec3dfe3356b0a6d9de6dc3edf013cbe84defd7a9a3d54b6d3808e3266408";
const R8_PERSISTENT_REAPER_INSTALLATION_ID =
  "784c8c7722130647142f91704c89d29387d3fc3f161ef4b1600b25020ba86a4f";
const R8_PERSISTENT_REAPER_SERVICE_RECEIPT_PATH =
  "/Users/olifreuler/.stormforge/proxywar-operators/mickey-runpod-reaper/service-receipt-mickey-screen-g000-r8-20260721t031448z.json";
const R8_PERSISTENT_REAPER_SERVICE_RECEIPT_SHA256 =
  "4f67420755f5695b25e36c62ce34763b9362f5093958f9f185f69540545a44d1";
const R8_PERSISTENT_REAPER_PLIST_SHA256 =
  "00b5e7e1e37263b0346f5757854d222fc650f79e0d94c5b2b8ac9afecb202240";
const R8_PERSISTENT_REAPER_HISTORICAL_RECEIPT_PID = 85289;
const R8_FAILURE_EVIDENCE_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "receipt-mickey-r8-pre-post-failure-20260721.json",
);
const R8_FAILURE_EVIDENCE_SHA256 = "799e4c547fb786e74680365b42fdf55d845e7a1ab7cf7df51e2f058a40d2d280";
const R8_RECOVERY_RECEIPT_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "expected-mickey-r8-pre-post-recovery-receipt-20260721.json",
);
const R8_RECOVERY_RECEIPT_PATH =
  "/Users/olifreuler/.stormforge/proxywar-operators/mickey-runpod-reaper/recovery-receipt-mickey-screen-g000-r8-20260721t031448z.json";
const R8_RECOVERY_RECEIPT_SHA256 = "67d4f2b5d04c2ae10b128eeae60eca6e1eeac0631206fca1271519a4d61515b8";
const R8_RECOVERY_RECORD_ID = "mickey-reaper:f6707829-6e5f-46e0-9071-5f3e91f91f35";
const R8_RECOVERY_RECORD_RUN_ID = `${R8_ACTIVATION_RUN_ID}:grow-opening-asia-s0-c`;
const R8_RECOVERY_EXPECTED_NAME =
  "proxywar-mickey-cpu-fanout-ba7e0411a40d16bb617a743c7a86966f";
const R8_RECOVERY_SNAPSHOT_SHA256 = "5609cad100d6b5477590bf42b531da42d11f29fd3aa7d62b2fb8edda26e61e56";
const R8_RECOVERY_PREEXISTING_IDS = Object.freeze([
  "0l7p9ke95cu6ms", "2g5whxhph9bwbz", "3649lnxlyhlf3n", "67yzvbbp54aizm",
  "76stn0v7q81d47", "825a2frvggm1k4", "877itccar33zdp", "a7dmwmcmh45a4b",
  "ctnggpz7t6nj6c", "l1evg0fagjmbgn", "lb4zz7jzgq9tr2", "lshjhv5avqjsaj",
  "ne262xferohtdi", "og13wgkfcmblx9", "rkm013fsjsf87c", "rwvsgeancauyug",
  "sxrtmdyd62n3ia", "szlrnk3ucex44f", "vbo7a33nlvsrtf", "zadju8y8p6d5r9",
]);
const R9_ACTIVATION_RUN_ID = "mickey-screen-g000-r9d-20260721t080619z";
const R9_ACTIVATION_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "manifest-mickey-cpu-screen-g000-r9d-20260721.json",
);
const R9_ACTIVATION_OUTPUT_PATH =
  "/private/tmp/mickey-screen-g000-r9d-20260721t080619z";
const R9_ACTIVATION_MANIFEST_DIGEST = "ff4f80c7bea4b09de19adc5a921b98e2ee3305b4969a16d5baf290e01d841582";
const R9_RELOCATED_BUNDLE_CANARY_PATH =
  "/private/tmp/mickey-r9-reloc-canary-b4nH5N/episode/receipt.json";
const R9_RELOCATED_BUNDLE_CANARY_SHA256 =
  "e197c7b99f2de67435fda763966360154f0e858fef49ea79bf3b256597ba66e5";
const R9_RELOCATED_BUNDLE_CANARY_RUN_ID = "mickey-r9-reloc-r2-canary-candidate";
const R9_RELOCATED_BUNDLE_SHA256 =
  "c959112ba3d63ceb72a266b7e8b3b2ec5a5576cc57592b97629cf7e99b75a729";
const R9_RELOCATED_BUNDLE_MANIFEST_SHA256 =
  "524aff8efd40559c4a0a5eab6801f1c0029688442bfe0386647b268bc77b4099";
const R9_RELOCATED_BUNDLE_BASE_IMAGE =
  "public.ecr.aws/q5f4m8t9/cogames@sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1";
const R7_ACTIVATION_BASE_COMMIT = "a9977d67d33630643a46117963cf1c08a503d21b";
const R7_CANARY_RUN_ID = "mickey-screen-g000-r7-20260721t025105z";
const R7_CANARY_MANIFEST_SHA256 =
  "fc30713c71b6b75f71c01b6f9f4f3dab572e3126ea21ddbd238a9255ba84f30f";
const R7_CANARY_SCRIPT_SHA256 =
  "924e16de8894120df929143266645c4b13382b18408d5795a69fd883d88a2f05";
const R7_CANARY_RECEIPT_PATH =
  "/private/tmp/mickey-cpu-transport-canary-r7-20260721t025105z/evidence/transport-canary-receipt.json";
const R7_CANARY_RECEIPT_SHA256 =
  "893a769892e0faa0fa29db357708f87c392672b3a7c7dbb2ed230244f8a028f7";
const R7_CANARY_KNOWN_HOSTS_PATH =
  "/private/tmp/mickey-cpu-transport-canary-r7-20260721t025105z/evidence/transport-canary-known-hosts";
const R7_CANARY_KNOWN_HOSTS_SHA256 =
  "403c4b6a8a9e959f06dad54b059bce73a43c73e47434d377a6ce5032796dbf7c";

function durableInstallationId(document) {
  return createHash("sha256").update([
    document.runpodctl.source_commit,
    document.runpodctl.source_tree,
    document.runpodctl.sha256,
    document.cleanup_watchdog.script.sha256,
    document.cleanup_watchdog.node_runtime.sha256,
  ].join("\n"), "utf8").digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`foreground reaper compatibility delta ${label} is not exact`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export function normalizeForegroundReaperForR8Persistence(source) {
  let normalized = replaceExactlyOnce(
    source,
    `export class ReaperLedgerLockedError extends ReaperValidationError {
  constructor(ownerPid) {
    super(\`reaper ledger is locked by live PID \${ownerPid}\`);
    this.name = "ReaperLedgerLockedError";
    this.ownerPid = ownerPid;
  }
}
`,
    "",
    "typed lock class",
  );
  normalized = replaceExactlyOnce(
    normalized,
    "        throw new ReaperLedgerLockedError(owner.pid);",
    "        throw new ReaperValidationError(`reaper ledger is locked by live PID ${owner.pid}`);",
    "typed live-owner throw",
  );
  const recoveryStart = normalized.indexOf("function equalSnapshot(left, right) {");
  const persistentResume = normalized.indexOf("async function withLedgerLock(ledgerPath, operation) {");
  if (
    recoveryStart < 0 ||
    persistentResume <= recoveryStart ||
    normalized.indexOf("function equalSnapshot(left, right) {", recoveryStart + 1) >= 0
  ) {
    throw new Error("foreground reaper exact recovery-only delta is not uniquely removable");
  }
  normalized = `${normalized.slice(0, recoveryStart)}${normalized.slice(persistentResume)}`;
  return normalized;
}

export function validateR8PersistentReaperCompatibility(persistentSource, foregroundSource) {
  const normalized = normalizeForegroundReaperForR8Persistence(foregroundSource);
  const persistentSha256 = createHash("sha256").update(persistentSource).digest("hex");
  const foregroundSha256 = createHash("sha256").update(foregroundSource).digest("hex");
  const normalizedForegroundSha256 = createHash("sha256").update(normalized).digest("hex");
  if (
    persistentSha256 !== R8_PERSISTENT_REAPER_SHA256 ||
    normalizedForegroundSha256 !== persistentSha256 ||
    foregroundSha256 === persistentSha256
  ) {
    throw new Error("r9 foreground additions changed the persistent r8 reaper behavior surface");
  }
  return {
    kind: "r8_cleanup_daemon_r9_foreground_additions_only_v1",
    persistent_sha256: persistentSha256,
    foreground_sha256: foregroundSha256,
    normalized_foreground_sha256: normalizedForegroundSha256,
    allowed_delta: "typed-live-lock-error-plus-foreground-r8-recovery-and-r9-short-lock-cas-only",
  };
}

function durableInstallationPaths(installationId) {
  const installationDirectory = `${DURABLE_REAPER_INSTALLATIONS_ROOT}/${installationId}`;
  return {
    root: DURABLE_REAPER_ROOT,
    binRoot: DURABLE_REAPER_BIN_ROOT,
    installationsRoot: DURABLE_REAPER_INSTALLATIONS_ROOT,
    installationDirectory,
    reaper: `${installationDirectory}/runpod-exact-id-reaper.mjs`,
    runpodctl: `${installationDirectory}/runpodctl-darwin-arm64`,
    plist: DURABLE_REAPER_PLIST,
  };
}

function durableServiceReceiptPaths(runId) {
  return new Set([
    `${DURABLE_REAPER_ROOT}/service-receipt.json`,
    `${DURABLE_REAPER_ROOT}/service-receipt-${runId}.json`,
  ]);
}

function usage() {
  return `Usage:
  node scripts/run-mickey-cpu-fanout.mjs \\
    --manifest /absolute/path/manifest.json \\
    --manifest-sha256 <64-hex> \\
    --output /private/tmp/new-run-output [--resume-from /absolute/clean-output]

Options:
  --dry-run       Validate every local preregistration and print the exact pod plan.
                  It never calls runpodctl, ssh, scp, launchctl, Docker, or Coworld.
  --resume-from   Reuse only hash-verified completed pairs from a clean prior output.
                  Aborted or quarantined evidence is always rejected.
  --help          Print this help.

Real execution must be the child of:
  scripts/proxywar-runner-lease.sh run mickey RUN_ID --output NEW_DIR -- <command>

Safety status:
  Full fanout live execution is enabled only for the exact hash-pinned r9 G000
  activation, r7 canary, r8 recovery receipt, and current durable reaper.
  Every other manifest and any resume attempt remains blocked before mutation.
`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing field ${key}`);
  }
}

function assertNoSecretKeys(value, label = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${label}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`${label} contains forbidden secret-bearing field ${key}`);
    }
    assertNoSecretKeys(child, `${label}.${key}`);
  }
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
}

function assertInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function assertFinite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}`);
  }
}

function assertAbsoluteFilePath(value, label) {
  assertString(value, label);
  if (!path.isAbsolute(value) || value.includes("\0") || value.includes("\n")) {
    throw new Error(`${label} must be an absolute local path without control characters`);
  }
}

function validateHashedFileReference(reference, label) {
  exactKeys(reference, ["path", "sha256"], label);
  assertAbsoluteFilePath(reference.path, `${label}.path`);
  assertString(reference.sha256, `${label}.sha256`, SHA256);
}

function validateArchiveSpec(reference, label) {
  exactKeys(reference, ["archive_path", "sha256"], label);
  assertString(reference.archive_path, `${label}.archive_path`, ARCHIVE_PATH);
  if (
    path.posix.isAbsolute(reference.archive_path) ||
    reference.archive_path.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !reference.archive_path.startsWith("specs/") ||
    !reference.archive_path.endsWith(".json")
  ) {
    throw new Error(`${label}.archive_path must be a canonical specs/*.json path`);
  }
  assertString(reference.sha256, `${label}.sha256`, SHA256);
}

function expectedPolicyContract(arm) {
  if (arm === "m0") return M0_CONTRACT;
  const contract = RETAINED_ARMS[arm];
  if (!contract) throw new Error(`unsupported or pruned Mickey arm: ${arm}`);
  return { arm, ...contract };
}

function validatePolicyIdentity(identity, expectedArm, label) {
  exactKeys(
    identity,
    [
      "policy_id",
      "policy_key",
      "arm",
      "docker_target",
      "surrogate_source",
      "source_commit",
      "image_id",
      "bundle_root",
      "run",
      "entrypoint_sha256",
      "upload_eligible",
    ],
    label,
  );
  const expected = expectedPolicyContract(expectedArm);
  assertString(identity.policy_id, `${label}.policy_id`, POLICY_ID);
  if (identity.policy_id !== `mickey-static-eval/${expectedArm}`) {
    throw new Error(`${label}.policy_id must identify ${expectedArm}`);
  }
  if (identity.policy_key !== `mickey-static-eval-${expectedArm}`) {
    throw new Error(`${label}.policy_key must be mickey-static-eval-${expectedArm}`);
  }
  if (identity.arm !== expectedArm) throw new Error(`${label}.arm must be ${expectedArm}`);
  if (identity.docker_target !== expected.dockerTarget) {
    throw new Error(`${label}.docker_target must be ${expected.dockerTarget}`);
  }
  if (identity.surrogate_source !== "static-eval-v1") {
    throw new Error(`${label}.surrogate_source must be static-eval-v1`);
  }
  assertString(identity.source_commit, `${label}.source_commit`, SOURCE_COMMIT);
  assertString(identity.image_id, `${label}.image_id`, IMAGE_ID);
  assertString(identity.bundle_root, `${label}.bundle_root`, ARCHIVE_PATH);
  if (
    path.posix.isAbsolute(identity.bundle_root) ||
    identity.bundle_root.split("/").some((part) => part === "" || part === "." || part === "..") ||
    identity.bundle_root !== `policies/${identity.policy_key}/app`
  ) {
    throw new Error(`${label}.bundle_root must be policies/${identity.policy_key}/app`);
  }
  if (
    !Array.isArray(identity.run) ||
    identity.run.length !== 2 ||
    identity.run[0] !== "node" ||
    identity.run[1] !== expected.entrypoint
  ) {
    throw new Error(`${label}.run must be exactly ["node","${expected.entrypoint}"]`);
  }
  assertString(identity.entrypoint_sha256, `${label}.entrypoint_sha256`, SHA256);
  if (identity.upload_eligible !== false) {
    throw new Error(`${label}.upload_eligible must be false`);
  }
}

function validateSharedFiles(files, label) {
  if (!Array.isArray(files) || files.length !== REQUIRED_SHARED_FILES.length) {
    throw new Error(`${label} must pin exactly ${REQUIRED_SHARED_FILES.join(", ")}`);
  }
  const seen = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    exactKeys(entry, ["path", "sha256"], `${label}[${index}]`);
    if (!REQUIRED_SHARED_FILES.includes(entry.path) || seen.has(entry.path)) {
      throw new Error(`${label} contains a missing, duplicate, or unapproved shared path`);
    }
    assertString(entry.sha256, `${label}[${index}].sha256`, SHA256);
    seen.add(entry.path);
  }
}

function validateGates(gates, armId, pairCount, label) {
  exactKeys(gates, ["mechanism", "outcome"], label);
  exactKeys(
    gates.mechanism,
    [
      "marker",
      "expected_reach",
      "minimum_marker_count",
      "minimum_accepted_replacements",
      "maximum_unexplained_holds",
      "maximum_rejected_decisions",
      "maximum_k1z_harm",
    ],
    `${label}.mechanism`,
  );
  assertString(gates.mechanism.marker, `${label}.mechanism.marker`, /^[a-z0-9._:-]{1,48}$/);
  if (gates.mechanism.expected_reach !== true) {
    throw new Error(`${label}.mechanism.expected_reach must be true for candidate ${armId}`);
  }
  assertInteger(gates.mechanism.minimum_marker_count, `${label}.mechanism.minimum_marker_count`, 1, 1_000_000);
  assertInteger(
    gates.mechanism.minimum_accepted_replacements,
    `${label}.mechanism.minimum_accepted_replacements`,
    1,
    1_000_000,
  );
  for (const key of ["maximum_unexplained_holds", "maximum_rejected_decisions", "maximum_k1z_harm"]) {
    if (gates.mechanism[key] !== 0) throw new Error(`${label}.mechanism.${key} must be zero`);
  }

  exactKeys(
    gates.outcome,
    [
      "primary_metric",
      "direction",
      "minimum_candidate_minus_m0",
      "secondary_metric",
      "minimum_secondary_delta",
      "minimum_pairs",
      "require_mirrored_seats",
    ],
    `${label}.outcome`,
  );
  if (gates.outcome.primary_metric !== "score" || gates.outcome.direction !== "candidate_minus_m0") {
    throw new Error(`${label}.outcome must rank candidate-minus-M0 score`);
  }
  assertFinite(gates.outcome.minimum_candidate_minus_m0, `${label}.outcome.minimum_candidate_minus_m0`, 0);
  if (gates.outcome.secondary_metric !== "final_tiles") {
    throw new Error(`${label}.outcome.secondary_metric must be final_tiles`);
  }
  assertFinite(gates.outcome.minimum_secondary_delta, `${label}.outcome.minimum_secondary_delta`, 0);
  assertInteger(gates.outcome.minimum_pairs, `${label}.outcome.minimum_pairs`, 1, 10_000);
  if (gates.outcome.minimum_pairs !== pairCount) {
    throw new Error(`${label}.outcome.minimum_pairs must equal the preregistered pair count`);
  }
  if (typeof gates.outcome.require_mirrored_seats !== "boolean") {
    throw new Error(`${label}.outcome.require_mirrored_seats must be boolean`);
  }
}

export function derivePairOrder(nonce, armId, pairId) {
  assertString(nonce, "randomization.nonce", SHA256);
  assertString(armId, "arm id", SAFE_ID);
  assertString(pairId, "pair id", SAFE_ID);
  const digest = createHash("sha256")
    .update(`${nonce}\n${armId}\n${pairId}\n`, "utf8")
    .digest("hex");
  const order = Number.parseInt(digest.slice(0, 2), 16) % 2 === 0
    ? ["m0", "candidate"]
    : ["candidate", "m0"];
  return { digest, order };
}

function validatePair(pair, arm, randomization, index) {
  const label = `arms[${arm.__index}].pairs[${index}]`;
  exactKeys(
    pair,
    [
      "id",
      "map",
      "seed",
      "seat",
      "max_decision_steps",
      "roster",
      "candidate_spec",
      "m0_spec",
      "order",
      "order_draw_sha256",
    ],
    label,
  );
  assertString(pair.id, `${label}.id`, SAFE_ID);
  if (!ALLOWED_MAPS.has(pair.map)) throw new Error(`${label}.map is unsupported`);
  assertInteger(pair.seed, `${label}.seed`, 0);
  assertInteger(pair.seat, `${label}.seat`, 0, 63);
  assertInteger(pair.max_decision_steps, `${label}.max_decision_steps`, 1, 600);
  if (!Array.isArray(pair.roster) || pair.roster.length < 2 || pair.roster.length > 64) {
    throw new Error(`${label}.roster must contain 2 to 64 seats`);
  }
  if (pair.seat >= pair.roster.length) throw new Error(`${label}.seat is outside the roster`);
  let outsiderCount = 0;
  const rosterNames = new Set();
  pair.roster.forEach((entry, rosterIndex) => {
    exactKeys(entry, ["seat", "name", "coalition"], `${label}.roster[${rosterIndex}]`);
    if (entry.seat !== rosterIndex) throw new Error(`${label}.roster seats must be contiguous and ordered`);
    assertString(entry.name, `${label}.roster[${rosterIndex}].name`);
    if (rosterNames.has(entry.name)) throw new Error(`${label}.roster player names must be unique`);
    rosterNames.add(entry.name);
    if (entry.coalition !== "k1z" && entry.coalition !== "outsider") {
      throw new Error(`${label}.roster[${rosterIndex}].coalition must be k1z or outsider`);
    }
    if (entry.coalition === "outsider") outsiderCount += 1;
  });
  if (pair.roster[pair.seat].coalition !== "k1z") {
    throw new Error(`${label} test seat must be K1Z Mickey`);
  }
  if (arm.roster_class === "all-k1z-grow" && outsiderCount !== 0) {
    throw new Error(`${label} grow fixtures must be all-K1Z`);
  }
  if (arm.roster_class === "mixed-outsider-convert" && outsiderCount < 1) {
    throw new Error(`${label} conversion fixtures require a visible outsider roster seat`);
  }
  validateArchiveSpec(pair.candidate_spec, `${label}.candidate_spec`);
  validateArchiveSpec(pair.m0_spec, `${label}.m0_spec`);
  if (pair.candidate_spec.sha256 === pair.m0_spec.sha256) {
    throw new Error(`${label} candidate and M0 specs must be distinct immutable files`);
  }
  if (
    !Array.isArray(pair.order) ||
    pair.order.length !== 2 ||
    !["candidate", "m0"].includes(pair.order[0]) ||
    pair.order[1] === pair.order[0] ||
    !["candidate", "m0"].includes(pair.order[1])
  ) {
    throw new Error(`${label}.order must contain candidate and m0 exactly once`);
  }
  assertString(pair.order_draw_sha256, `${label}.order_draw_sha256`, SHA256);
  const expected = derivePairOrder(randomization.nonce, arm.id, pair.id);
  if (pair.order_draw_sha256 !== expected.digest || pair.order.join(",") !== expected.order.join(",")) {
    throw new Error(`${label} order does not match the preregistered SHA-256 parity draw`);
  }
}

export function activationManifestDigest(document) {
  const normalized = structuredClone(document);
  if (!isObject(normalized.control_plane?.fanout_runner)) {
    throw new Error("activation manifest lacks a fanout runner binding");
  }
  normalized.control_plane.fanout_runner.sha256 = "0".repeat(64);
  return createHash("sha256")
    .update("mickey-r8-g000-live-activation-manifest-v1\n", "utf8")
    .update(JSON.stringify(sortedJsonValue(normalized)), "utf8")
    .digest("hex");
}

export function r9ActivationManifestDigest(document) {
  const normalized = structuredClone(document);
  if (!isObject(normalized.control_plane?.fanout_runner)) {
    throw new Error("r9 activation manifest lacks a fanout runner binding");
  }
  normalized.control_plane.fanout_runner.sha256 = "0".repeat(64);
  return createHash("sha256")
    .update("mickey-r9-g000-live-activation-manifest-v1\n", "utf8")
    .update(JSON.stringify(sortedJsonValue(normalized)), "utf8")
    .digest("hex");
}

function validateActivationContract(document) {
  if (document.schema_version === 5) {
    validateR9ActivationContract(document);
    return;
  }
  const activation = document.activation;
  exactKeys(
    activation,
    [
      "kind",
      "r7_base_commit",
      "canary_receipt",
      "canary_known_hosts",
      "canary_run_id",
      "canary_manifest_sha256",
      "canary_script_sha256",
      "screen_pair_count",
      "max_concurrency",
      "one_pod_per_pair",
      "nonce_input_channel",
      "exact_id_cleanup_required",
      "persistent_reaper_service_required",
      "preexisting_pod_deletion_allowed",
      "storm_pod_deletion_allowed",
      "resume_allowed",
      "output_path",
    ],
    "manifest.activation",
  );
  validateHashedFileReference(activation.canary_receipt, "manifest.activation.canary_receipt");
  validateHashedFileReference(
    activation.canary_known_hosts,
    "manifest.activation.canary_known_hosts",
  );
  if (
    document.run_id !== R8_ACTIVATION_RUN_ID ||
    activation.kind !== "r7_transport_canary_bound_g000_v1" ||
    activation.r7_base_commit !== R7_ACTIVATION_BASE_COMMIT ||
    activation.canary_receipt.path !== R7_CANARY_RECEIPT_PATH ||
    activation.canary_receipt.sha256 !== R7_CANARY_RECEIPT_SHA256 ||
    activation.canary_known_hosts.path !== R7_CANARY_KNOWN_HOSTS_PATH ||
    activation.canary_known_hosts.sha256 !== R7_CANARY_KNOWN_HOSTS_SHA256 ||
    activation.canary_run_id !== R7_CANARY_RUN_ID ||
    activation.canary_manifest_sha256 !== R7_CANARY_MANIFEST_SHA256 ||
    activation.canary_script_sha256 !== R7_CANARY_SCRIPT_SHA256 ||
    activation.screen_pair_count !== 16 ||
    activation.max_concurrency !== 4 ||
    activation.one_pod_per_pair !== true ||
    activation.nonce_input_channel !== "stdin" ||
    activation.exact_id_cleanup_required !== true ||
    activation.persistent_reaper_service_required !== true ||
    activation.preexisting_pod_deletion_allowed !== false ||
    activation.storm_pod_deletion_allowed !== false ||
    activation.resume_allowed !== false ||
    activation.output_path !== R8_ACTIVATION_OUTPUT_PATH
  ) {
    throw new Error("manifest activation does not match the exact r8 G000 boundary");
  }
}

function validateR9ActivationContract(document) {
  const activation = document.activation;
  exactKeys(
    activation,
    [
      "kind", "r8_source_commit", "r8_manifest_sha256", "r8_fanout_sha256",
      "r8_failure_evidence", "r8_recovery_tool", "r8_recovery_receipt_template",
      "r8_recovery_receipt", "r8_record_id", "r8_record_state", "r8_terminal_reason",
      "persistent_reaper", "relocated_bundle_canary",
      "r7_base_commit", "canary_receipt", "canary_known_hosts", "canary_run_id",
      "canary_manifest_sha256", "canary_script_sha256", "screen_pair_count",
      "max_concurrency", "one_pod_per_pair", "nonce_input_channel",
      "ledger_mutations_serialized", "exact_id_cleanup_required",
      "persistent_reaper_service_required", "preexisting_pod_deletion_allowed",
      "storm_pod_deletion_allowed", "resume_allowed", "output_path",
    ],
    "manifest.activation",
  );
  for (const [label, reference] of [
    ["r8_failure_evidence", activation.r8_failure_evidence],
    ["r8_recovery_tool", activation.r8_recovery_tool],
    ["r8_recovery_receipt_template", activation.r8_recovery_receipt_template],
    ["r8_recovery_receipt", activation.r8_recovery_receipt],
    ["relocated_bundle_canary", activation.relocated_bundle_canary],
    ["canary_receipt", activation.canary_receipt],
    ["canary_known_hosts", activation.canary_known_hosts],
  ]) validateHashedFileReference(reference, `manifest.activation.${label}`);
  exactKeys(
    activation.persistent_reaper,
    [
      "kind", "manifest", "service_receipt", "installation_id", "script_sha256",
      "plist_sha256", "historical_receipt_pid", "compatibility",
    ],
    "manifest.activation.persistent_reaper",
  );
  validateHashedFileReference(
    activation.persistent_reaper.manifest,
    "manifest.activation.persistent_reaper.manifest",
  );
  validateHashedFileReference(
    activation.persistent_reaper.service_receipt,
    "manifest.activation.persistent_reaper.service_receipt",
  );
  exactKeys(
    activation.persistent_reaper.compatibility,
    [
      "kind", "persistent_sha256", "foreground_sha256",
      "normalized_foreground_sha256", "allowed_delta",
    ],
    "manifest.activation.persistent_reaper.compatibility",
  );
  const persistent = activation.persistent_reaper;
  const compatibility = persistent.compatibility;
  if (
    document.run_id !== R9_ACTIVATION_RUN_ID ||
    activation.kind !== "r7_canary_r8_pre_post_recovery_r9d_reaper_activation_fix_bound_g000_v1" ||
    activation.r8_source_commit !== R8_SOURCE_COMMIT ||
    activation.r8_manifest_sha256 !== R8_MANIFEST_SHA256 ||
    activation.r8_fanout_sha256 !== R8_FANOUT_SHA256 ||
    activation.r8_failure_evidence.path !== R8_FAILURE_EVIDENCE_PATH ||
    activation.r8_failure_evidence.sha256 !== R8_FAILURE_EVIDENCE_SHA256 ||
    activation.r8_recovery_tool.path !== PRE_POST_RECOVERY_SCRIPT ||
    activation.r8_recovery_receipt_template.path !== R8_RECOVERY_RECEIPT_TEMPLATE_PATH ||
    activation.r8_recovery_receipt_template.sha256 !== R8_RECOVERY_RECEIPT_SHA256 ||
    activation.r8_recovery_receipt.path !== R8_RECOVERY_RECEIPT_PATH ||
    activation.r8_recovery_receipt.sha256 !== R8_RECOVERY_RECEIPT_SHA256 ||
    activation.r8_record_id !== R8_RECOVERY_RECORD_ID ||
    activation.r8_record_state !== "blocked" ||
    activation.r8_terminal_reason !== "pre_post_create_not_invoked" ||
    persistent.kind !== "adopt_existing_r8_immutable_cleanup_daemon_v1" ||
    persistent.manifest.path !== R8_ACTIVATION_MANIFEST_PATH ||
    persistent.manifest.sha256 !== R8_MANIFEST_SHA256 ||
    persistent.service_receipt.path !== R8_PERSISTENT_REAPER_SERVICE_RECEIPT_PATH ||
    persistent.service_receipt.sha256 !== R8_PERSISTENT_REAPER_SERVICE_RECEIPT_SHA256 ||
    persistent.installation_id !== R8_PERSISTENT_REAPER_INSTALLATION_ID ||
    persistent.script_sha256 !== R8_PERSISTENT_REAPER_SHA256 ||
    persistent.plist_sha256 !== R8_PERSISTENT_REAPER_PLIST_SHA256 ||
    persistent.historical_receipt_pid !== R8_PERSISTENT_REAPER_HISTORICAL_RECEIPT_PID ||
    compatibility.kind !== "r8_cleanup_daemon_r9_foreground_additions_only_v1" ||
    compatibility.persistent_sha256 !== R8_PERSISTENT_REAPER_SHA256 ||
    compatibility.foreground_sha256 !== document.control_plane.exact_id_reaper.sha256 ||
    compatibility.normalized_foreground_sha256 !== R8_PERSISTENT_REAPER_SHA256 ||
    compatibility.allowed_delta !==
      "typed-live-lock-error-plus-foreground-r8-recovery-and-r9-short-lock-cas-only" ||
    activation.relocated_bundle_canary.path !== R9_RELOCATED_BUNDLE_CANARY_PATH ||
    activation.relocated_bundle_canary.sha256 !== R9_RELOCATED_BUNDLE_CANARY_SHA256 ||
    activation.r7_base_commit !== R7_ACTIVATION_BASE_COMMIT ||
    activation.canary_receipt.path !== R7_CANARY_RECEIPT_PATH ||
    activation.canary_receipt.sha256 !== R7_CANARY_RECEIPT_SHA256 ||
    activation.canary_known_hosts.path !== R7_CANARY_KNOWN_HOSTS_PATH ||
    activation.canary_known_hosts.sha256 !== R7_CANARY_KNOWN_HOSTS_SHA256 ||
    activation.canary_run_id !== R7_CANARY_RUN_ID ||
    activation.canary_manifest_sha256 !== R7_CANARY_MANIFEST_SHA256 ||
    activation.canary_script_sha256 !== R7_CANARY_SCRIPT_SHA256 ||
    activation.screen_pair_count !== 16 || activation.max_concurrency !== 4 ||
    activation.one_pod_per_pair !== true || activation.nonce_input_channel !== "stdin" ||
    activation.ledger_mutations_serialized !== true || activation.exact_id_cleanup_required !== true ||
    activation.persistent_reaper_service_required !== true ||
    activation.preexisting_pod_deletion_allowed !== false ||
    activation.storm_pod_deletion_allowed !== false || activation.resume_allowed !== false ||
    activation.output_path !== R9_ACTIVATION_OUTPUT_PATH
  ) {
    throw new Error("manifest activation does not match the exact r9 recovery-bound G000 boundary");
  }
}

export function validateTransportCanaryActivationReceipt(receipt, activation) {
  exactKeys(
    receipt,
    [
      "schema_version",
      "kind",
      "run_id",
      "manifest_sha256",
      "canary_script_sha256",
      "evidence_scope",
      "evidence_eligible",
      "promotion_possible_from_this_run",
      "game_processes_started",
      "create_attempts",
      "secret_in_argv",
      "requested_contract",
      "reaper_record_id",
      "pod_name",
      "observed_new_pod_ids",
      "deleted_exact_pod_ids",
      "already_absent_exact_pod_ids",
      "external_deadline_cleanup_required",
      "create_request_attestation",
      "network_volume_attestation",
      "ssh_readiness_observations",
      "ssh_transport_attempts",
      "started_at",
      "completed_at",
      "status",
      "failure_reason",
      "preexisting_pod_count",
      "attested_pod",
      "ssh_transport",
      "cleanup",
    ],
    "r7 transport canary receipt",
  );
  if (
    receipt.schema_version !== 5 ||
    receipt.kind !== "mickey_cpu_transport_canary_receipt" ||
    receipt.run_id !== activation.canary_run_id ||
    receipt.manifest_sha256 !== activation.canary_manifest_sha256 ||
    receipt.canary_script_sha256 !== activation.canary_script_sha256 ||
    receipt.evidence_scope !== "transport_only" ||
    receipt.evidence_eligible !== false ||
    receipt.promotion_possible_from_this_run !== false ||
    receipt.game_processes_started !== 0 ||
    receipt.create_attempts !== 1 ||
    receipt.secret_in_argv !== false ||
    receipt.external_deadline_cleanup_required !== false ||
    receipt.status !== "passed" ||
    receipt.failure_reason !== null ||
    !Number.isInteger(receipt.preexisting_pod_count) ||
    receipt.preexisting_pod_count < 0
  ) {
    throw new Error("r7 transport canary did not pass the non-promotional one-create boundary");
  }
  exactKeys(
    receipt.requested_contract,
    [
      "transport",
      "compute_type",
      "cloud_type",
      "cpu_flavor_ids",
      "vcpu_count",
      "max_cost_per_hour",
      "container_disk_gb",
      "volume_gb",
      "network_volume_id",
      "public_ip",
      "ports",
      "requested_env",
      "control_secret_supplied",
      "provider_ttl",
      "client_cleanup_deadline_seconds",
    ],
    "r7 transport canary requested contract",
  );
  const expectedRequest = {
    transport: "rest-v1",
    compute_type: "CPU",
    cloud_type: "COMMUNITY",
    cpu_flavor_ids: ["cpu5c", "cpu3c"],
    vcpu_count: 2,
    max_cost_per_hour: 0.1,
    container_disk_gb: 20,
    volume_gb: 0,
    network_volume_id: null,
    public_ip: true,
    ports: ["22/tcp"],
    requested_env: false,
    control_secret_supplied: false,
    provider_ttl: null,
    client_cleanup_deadline_seconds: 7200,
  };
  if (!equalJson(receipt.requested_contract, expectedRequest)) {
    throw new Error("r7 transport canary requested contract is not the exact bounded CPU shape");
  }

  exactKeys(
    receipt.create_request_attestation,
    [
      "request_input_sha256",
      "request_input_hash_scope",
      "request_input_redaction_schema",
      "response_env_redacted",
      "response_control_secret_scrubbed",
      "provider_identity_contaminated",
      "reconciliation_required",
      "transport",
      "client_max_cost_per_hour",
      "provider_ttl",
      "requested_volume_gb",
      "network_volume_id_supplied",
      "network_volume_request",
    ],
    "r7 create request attestation",
  );
  const create = receipt.create_request_attestation;
  if (
    !SHA256.test(create.request_input_sha256 ?? "") ||
    create.request_input_hash_scope !== RUNPODCTL_REQUEST_HASH_SCOPE ||
    create.request_input_redaction_schema !== RUNPODCTL_ENV_REDACTION_SCHEMA ||
    create.response_env_redacted !== true ||
    create.response_control_secret_scrubbed !== true ||
    create.provider_identity_contaminated !== false ||
    create.reconciliation_required !== false ||
    create.transport !== "rest-v1" ||
    create.client_max_cost_per_hour !== 0.1 ||
    create.provider_ttl !== null ||
    create.requested_volume_gb !== 0 ||
    create.network_volume_id_supplied !== false ||
    create.network_volume_request !== "none"
  ) {
    throw new Error("r7 create request attestation does not prove zero-volume no-ID REST input");
  }

  exactKeys(
    receipt.network_volume_attestation,
    [
      "status",
      "include_network_volume_requested",
      "network_volume_id_present",
      "network_volume_present",
      "network_volume_attached",
      "request_input_sha256",
      "requested_volume_gb",
      "network_volume_id_supplied",
    ],
    "r7 network volume attestation",
  );
  const volume = receipt.network_volume_attestation;
  if (
    volume.status !== "omitted_when_none" ||
    volume.include_network_volume_requested !== true ||
    volume.network_volume_id_present !== false ||
    volume.network_volume_present !== false ||
    volume.network_volume_attached !== false ||
    volume.request_input_sha256 !== create.request_input_sha256 ||
    volume.requested_volume_gb !== 0 ||
    volume.network_volume_id_supplied !== false
  ) {
    throw new Error("r7 network-volume omission is not bound to the zero-volume request");
  }

  const observed = receipt.observed_new_pod_ids;
  const deleted = receipt.deleted_exact_pod_ids;
  if (
    !Array.isArray(observed) ||
    observed.length !== 1 ||
    !Array.isArray(deleted) ||
    deleted.length !== 1 ||
    deleted[0] !== observed[0] ||
    !Array.isArray(receipt.already_absent_exact_pod_ids) ||
    receipt.already_absent_exact_pod_ids.length !== 0
  ) {
    throw new Error("r7 canary did not delete exactly its sole observed new pod ID");
  }
  const podId = observed[0];
  assertString(podId, "r7 canary pod ID", SAFE_ID);
  assertString(receipt.pod_name, "r7 canary pod name", SAFE_ID);
  if (
    !receipt.pod_name.startsWith("proxywar-mickey-cpu-fanout-") ||
    receipt.pod_name.startsWith("storm-")
  ) {
    throw new Error("r7 canary pod name is outside the exact non-storm namespace");
  }

  exactKeys(
    receipt.attested_pod,
    [
      "id",
      "name",
      "cost_per_hour",
      "vcpu_count",
      "memory_gb",
      "gpu_count",
      "container_disk_gb",
      "volume_gb",
      "network_volume_attached",
    ],
    "r7 attested pod",
  );
  const pod = receipt.attested_pod;
  if (
    pod.id !== podId ||
    pod.name !== receipt.pod_name ||
    !Number.isFinite(pod.cost_per_hour) ||
    pod.cost_per_hour < 0 ||
    pod.cost_per_hour > 0.1 ||
    pod.vcpu_count !== 2 ||
    pod.memory_gb !== 4 ||
    pod.gpu_count !== 0 ||
    pod.container_disk_gb !== 20 ||
    pod.volume_gb !== 0 ||
    pod.network_volume_attached !== false
  ) {
    throw new Error("r7 attested pod does not match the exact bounded CPU contract");
  }

  if (
    !Array.isArray(receipt.ssh_readiness_observations) ||
    receipt.ssh_readiness_observations.length < 1 ||
    receipt.ssh_readiness_observations.length > 60
  ) {
    throw new Error("r7 SSH readiness evidence is missing or unbounded");
  }
  for (const [index, observation] of receipt.ssh_readiness_observations.entries()) {
    exactKeys(observation, ["attempt", "status", "category"], `r7 SSH readiness observation ${index + 1}`);
    const final = index === receipt.ssh_readiness_observations.length - 1;
    if (
      observation.attempt !== index + 1 ||
      (final
        ? observation.status !== "accepted" || observation.category !== "complete_exact_identity"
        : observation.status !== "rejected")
    ) {
      throw new Error("r7 SSH readiness observations do not end in one exact identity acceptance");
    }
  }
  if (
    !Array.isArray(receipt.ssh_transport_attempts) ||
    receipt.ssh_transport_attempts.length !== 1
  ) {
    throw new Error("r7 SSH transport did not succeed on exactly one attempt");
  }
  exactKeys(
    receipt.ssh_transport_attempts[0],
    ["attempt", "status", "category"],
    "r7 SSH transport attempt",
  );
  if (
    receipt.ssh_transport_attempts[0].attempt !== 1 ||
    receipt.ssh_transport_attempts[0].status !== "accepted" ||
    receipt.ssh_transport_attempts[0].category !== "challenge_exact_one_line"
  ) {
    throw new Error("r7 SSH transport attempt was not the exact first-attempt challenge acceptance");
  }

  exactKeys(
    receipt.ssh_transport,
    [
      "status",
      "pod_id",
      "pod_name",
      "public_endpoint",
      "account_ssh_key_fingerprint",
      "negotiated_host_key_fingerprint",
      "trust_scope",
      "command",
      "challenge",
      "transport_attempt_count",
    ],
    "r7 SSH transport",
  );
  exactKeys(receipt.ssh_transport.public_endpoint, ["ip", "port"], "r7 SSH public endpoint");
  const ssh = receipt.ssh_transport;
  const fingerprint = /^SHA256:[A-Za-z0-9+/]{43}$/;
  if (
    ssh.status !== "ready" ||
    ssh.pod_id !== podId ||
    ssh.pod_name !== receipt.pod_name ||
    typeof ssh.public_endpoint.ip !== "string" ||
    !/^[a-zA-Z0-9.:-]+$/.test(ssh.public_endpoint.ip) ||
    !Number.isInteger(ssh.public_endpoint.port) ||
    ssh.public_endpoint.port < 1 ||
    ssh.public_endpoint.port > 65535 ||
    !fingerprint.test(ssh.account_ssh_key_fingerprint ?? "") ||
    !fingerprint.test(ssh.negotiated_host_key_fingerprint ?? "") ||
    ssh.trust_scope !== "transport_canary_tofu_after_exact_control_plane_identity" ||
    ssh.command !== "random_one_line_readiness_challenge_only" ||
    ssh.challenge !== "random_128_bit_hex_suffix" ||
    ssh.transport_attempt_count !== 1
  ) {
    throw new Error("r7 SSH transport is not one exact ready ED25519-pinned challenge");
  }

  exactKeys(
    receipt.cleanup,
    ["status", "reaper_state", "exact_id_get_before_each_delete", "final_absence_confirmed"],
    "r7 cleanup",
  );
  if (
    receipt.cleanup.status !== "normal_cleanup_confirmed_absent" ||
    receipt.cleanup.reaper_state !== "retired" ||
    receipt.cleanup.exact_id_get_before_each_delete !== true ||
    receipt.cleanup.final_absence_confirmed !== true
  ) {
    throw new Error("r7 cleanup did not retire exact ownership after confirmed absence");
  }
  assertString(receipt.reaper_record_id, "r7 reaper record ID", /^mickey-reaper:[a-f0-9-]{36}$/);
  const started = Date.parse(receipt.started_at);
  const completed = Date.parse(receipt.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw new Error("r7 canary timestamps are invalid");
  }
  return { receipt, pod_id: podId, request_input_sha256: create.request_input_sha256 };
}

export function validateTransportCanaryKnownHosts(body, receipt) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  if (typeof text !== "string") throw new Error("r7 known_hosts evidence must be text");
  const match = text.match(/^(\S+) ssh-ed25519 ([A-Za-z0-9+/]+={0,2})\n$/);
  if (!match) throw new Error("r7 known_hosts must contain exactly one ED25519 key");
  const expectedHost = `[${receipt.ssh_transport.public_endpoint.ip}]:${receipt.ssh_transport.public_endpoint.port}`;
  if (match[1] !== expectedHost) {
    throw new Error("r7 known_hosts endpoint differs from the accepted SSH endpoint");
  }
  const key = Buffer.from(match[2], "base64");
  if (key.length < 32 || key.toString("base64") !== match[2]) {
    throw new Error("r7 known_hosts ED25519 key encoding is invalid");
  }
  const fingerprint = `SHA256:${createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/=+$/, "")}`;
  if (fingerprint !== receipt.ssh_transport.negotiated_host_key_fingerprint) {
    throw new Error("r7 known_hosts ED25519 fingerprint differs from the canary receipt");
  }
  return { algorithm: "ssh-ed25519", fingerprint, endpoint: expectedHost };
}

async function verifyR7ActivationEvidence(document) {
  await verifyHashedLocalFile(
    document.activation.canary_receipt,
    "pinned r7 transport canary receipt",
  );
  await verifyHashedLocalFile(
    document.activation.canary_known_hosts,
    "pinned r7 transport known_hosts",
  );
  const receipt = JSON.parse(await readFile(document.activation.canary_receipt.path, "utf8"));
  const validated = validateTransportCanaryActivationReceipt(receipt, document.activation);
  const knownHosts = validateTransportCanaryKnownHosts(
    await readFile(document.activation.canary_known_hosts.path),
    receipt,
  );
  const ledger = await readReaperLedger(document.cleanup_watchdog.ledger_path);
  const record = ledger.records.find((candidate) => candidate.record_id === receipt.reaper_record_id);
  if (
    !record ||
    record.state !== "retired" ||
    record.run_id !== `${receipt.run_id}:transport-canary` ||
    record.manifest_sha256 !== receipt.manifest_sha256 ||
    record.ownership_kind !== "generated-exact-name-v1" ||
    record.name_prefix !== document.pod.name_prefix ||
    record.expected_name !== receipt.pod_name ||
    record.pod_id !== validated.pod_id ||
    record.terminal_reason !== "normal_cleanup_confirmed_absent" ||
    record.last_error !== null ||
    !Array.isArray(record.preexisting_ids) ||
    record.preexisting_ids.length !== receipt.preexisting_pod_count ||
    record.preexisting_ids.includes(validated.pod_id) ||
    !Array.isArray(record.events) ||
    !record.events.some((event) => (
      event.type === "normal_cleanup_absence_confirmed" && event.pod_id === validated.pod_id
    ))
  ) {
    throw new Error("r7 exact-ID reaper ledger record is not retired with sole new-pod ownership");
  }
  return {
    receipt_sha256: document.activation.canary_receipt.sha256,
    known_hosts_sha256: document.activation.canary_known_hosts.sha256,
    canary_run_id: receipt.run_id,
    pod_id: validated.pod_id,
    request_input_sha256: validated.request_input_sha256,
    host_key: knownHosts,
    ledger_record_id: record.record_id,
    ledger_state: record.state,
    terminal_reason: record.terminal_reason,
  };
}

async function verifyR9ActivationEvidence(document, { requireRecoveryReceipt = false } = {}) {
  for (const [label, reference] of [
    ["r8 failure evidence", document.activation.r8_failure_evidence],
    ["r8 recovery tool", document.activation.r8_recovery_tool],
    ["r8 recovery receipt template", document.activation.r8_recovery_receipt_template],
    ["relocated bundle episode canary", document.activation.relocated_bundle_canary],
  ]) await verifyHashedLocalFile(reference, label);
  if (
    document.control_plane.pre_post_recovery.path !== document.activation.r8_recovery_tool.path ||
    document.control_plane.pre_post_recovery.sha256 !== document.activation.r8_recovery_tool.sha256
  ) {
    throw new Error("r9 control plane is not bound to the exact r8 recovery tool");
  }
  const failure = JSON.parse(await readFile(document.activation.r8_failure_evidence.path, "utf8"));
  const template = JSON.parse(await readFile(document.activation.r8_recovery_receipt_template.path, "utf8"));
  const relocatedCanary = JSON.parse(await readFile(document.activation.relocated_bundle_canary.path, "utf8"));
  const relocatedOutcomes = Object.values(relocatedCanary.process_outcomes ?? {});
  const manifestBundleHashes = new Set(document.arms.map((arm) => arm.bundle.sha256));
  if (
    failure.schema_version !== 1 || failure.kind !== "mickey_r8_pre_post_create_failure_evidence" ||
    failure.status !== "verified_failure_only" || failure.evidence_eligible !== false ||
    failure.activation?.run_id !== R8_ACTIVATION_RUN_ID ||
    failure.record?.record_id !== R8_RECOVERY_RECORD_ID ||
    failure.record?.terminal_reason !== "pre_post_create_not_invoked" ||
    failure.command_audit?.provider_create_count !== 0 ||
    failure.command_audit?.provider_delete_count !== 0 ||
    failure.quarantine?.content_inventory_sha256 !==
      "6bc3b013638153ca312823cfaa867ebfd11f5c0c459c4e6891ca0ad2ef042e1f" ||
    template.schema_version !== 1 || template.kind !== "mickey_r8_pre_post_create_recovery_receipt" ||
    template.status !== "passed" || template.failure_evidence_sha256 !== R8_FAILURE_EVIDENCE_SHA256 ||
    template.record_id !== R8_RECOVERY_RECORD_ID || template.state_after !== "blocked" ||
    template.terminal_reason !== "pre_post_create_not_invoked" ||
    template.create_calls !== 0 || template.delete_calls !== 0 ||
    template.evidence_eligible !== false || template.promotion_eligible !== false ||
    template.resume_allowed !== false || template.rerun_r8_allowed !== false ||
    relocatedCanary.schema_version !== 1 || relocatedCanary.status !== "passed" ||
    relocatedCanary.error !== null || relocatedCanary.run_id !== R9_RELOCATED_BUNDLE_CANARY_RUN_ID ||
    relocatedCanary.receipt_scope !== "transport_and_artifact_integrity_only" ||
    relocatedCanary.execution_class !== "transport_canary" ||
    relocatedCanary.evaluation_verdict !== "not_evaluated" ||
    relocatedCanary.base_image !== R9_RELOCATED_BUNDLE_BASE_IMAGE ||
    relocatedCanary.bundle_verification?.manifest_sha256 !== R9_RELOCATED_BUNDLE_MANIFEST_SHA256 ||
    relocatedCanary.post_run_attestation?.status !== REMOTE_POST_RUN_ATTESTATION_STATUS ||
    relocatedCanary.post_run_attestation?.bundle_verification?.status !== "verified" ||
    relocatedCanary.post_run_attestation?.bundle_verification?.manifest_sha256 !== R9_RELOCATED_BUNDLE_MANIFEST_SHA256 ||
    relocatedCanary.post_run_attestation?.runtime_fingerprint?.status !== "verified" ||
    relocatedCanary.run_spec?.relative_path !== "specs/canary-candidate-player-specs.json" ||
    relocatedCanary.run_spec?.manifest_label !== "transport-canary-candidate" ||
    relocatedCanary.run_spec?.manifest_role !== "candidate" ||
    relocatedCanary.results?.accepted_decision_count !== 24 ||
    relocatedOutcomes.length !== 5 ||
    relocatedOutcomes.some((outcome) => outcome?.code !== 0 || outcome?.signal !== null || outcome?.error !== null) ||
    manifestBundleHashes.size !== 1 || !manifestBundleHashes.has(R9_RELOCATED_BUNDLE_SHA256)
  ) {
    throw new Error("r9 r8-failure or recovery-receipt evidence is invalid");
  }
  const canary = await verifyR7ActivationEvidence(document);
  if (!requireRecoveryReceipt) {
    return {
      ...canary,
      failure_evidence_sha256: R8_FAILURE_EVIDENCE_SHA256,
      recovery_receipt_sha256: R8_RECOVERY_RECEIPT_SHA256,
      recovery_status: "expected_not_live_verified",
      recovery_record_state: "unverified",
      relocated_bundle_canary_sha256: R9_RELOCATED_BUNDLE_CANARY_SHA256,
    };
  }
  await verifyHashedLocalFile(document.activation.r8_recovery_receipt, "live r8 recovery receipt");
  const liveReceipt = JSON.parse(await readFile(document.activation.r8_recovery_receipt.path, "utf8"));
  if (!equalJson(liveReceipt, template)) {
    throw new Error("live r8 recovery receipt differs from the exact pinned template");
  }
  const ledger = await readReaperLedger(document.cleanup_watchdog.ledger_path);
  const boundary = validateR9RecoveryHistory(ledger);
  return {
    ...canary,
    failure_evidence_sha256: R8_FAILURE_EVIDENCE_SHA256,
    recovery_receipt_sha256: R8_RECOVERY_RECEIPT_SHA256,
    recovery_status: "passed",
    recovery_record_state: "blocked",
    recovery_terminal_reason: "pre_post_create_not_invoked",
    relocated_bundle_canary_sha256: R9_RELOCATED_BUNDLE_CANARY_SHA256,
    recovery_record_id: boundary.r8_recovery_record_id,
    ledger_revision: boundary.revision,
    pending_count: boundary.pending_count,
    active_count: boundary.active_count,
  };
}

export function validateManifest(document) {
  assertNoSecretKeys(document);
  const activationSchema = [4, 5].includes(document?.schema_version);
  exactKeys(
    document,
    [
      "schema_version",
      "kind",
      "run_id",
      "preregistered_at",
      "evidence_scope",
      "randomization",
      "control_plane",
      "runner_lease",
      "runpodctl",
      "pod",
      "cleanup_watchdog",
      "source_reach_receipt",
      "arms",
      "promotion_gates",
      ...(activationSchema ? ["activation"] : []),
    ],
    "manifest",
  );
  if (![3, 4, 5].includes(document.schema_version) || document.kind !== "mickey_cpu_fanout") {
    throw new Error("manifest schema_version/kind must be 3, 4, or 5/mickey_cpu_fanout");
  }
  if (activationSchema) validateActivationContract(document);
  assertString(document.run_id, "manifest.run_id", SAFE_ID);
  const preregistered = Date.parse(document.preregistered_at);
  if (!Number.isFinite(preregistered)) throw new Error("manifest.preregistered_at must be ISO-8601");
  if (preregistered > Date.now() + 300_000) throw new Error("manifest.preregistered_at cannot be in the future");
  if (document.evidence_scope !== "diagnostic_only") {
    throw new Error("manifest.evidence_scope must be diagnostic_only");
  }

  exactKeys(document.randomization, ["algorithm", "nonce"], "manifest.randomization");
  if (document.randomization.algorithm !== "sha256-parity-v1") {
    throw new Error("manifest.randomization.algorithm must be sha256-parity-v1");
  }
  assertString(document.randomization.nonce, "manifest.randomization.nonce", SHA256);

  exactKeys(
    document.control_plane,
    [
      "fanout_runner", "policy_auditor", "remote_verifier", "exact_id_reaper",
      "reaper_launchd_renderer", ...(document.schema_version === 5 ? ["pre_post_recovery"] : []),
    ],
    "manifest.control_plane",
  );
  const controlPlanePaths = {
    fanout_runner: SCRIPT_PATH,
    policy_auditor: AUDIT_SCRIPT,
    remote_verifier: REMOTE_VERIFIER,
    exact_id_reaper: REAPER_SCRIPT,
    reaper_launchd_renderer: REAPER_LAUNCHD_RENDERER,
    ...(document.schema_version === 5 ? { pre_post_recovery: PRE_POST_RECOVERY_SCRIPT } : {}),
  };
  for (const [key, expectedPath] of Object.entries(controlPlanePaths)) {
    validateHashedFileReference(document.control_plane[key], `manifest.control_plane.${key}`);
    if (document.control_plane[key].path !== expectedPath) {
      throw new Error(`manifest.control_plane.${key}.path must be the exact integration script`);
    }
  }

  exactKeys(document.runner_lease, ["path", "sha256", "operator_lane", "state_root"], "manifest.runner_lease");
  validateHashedFileReference(
    { path: document.runner_lease.path, sha256: document.runner_lease.sha256 },
    "manifest.runner_lease script",
  );
  if (document.runner_lease.operator_lane !== RUNNER_OPERATOR_LANE) {
    throw new Error(`manifest.runner_lease.operator_lane must be ${RUNNER_OPERATOR_LANE}`);
  }
  if (document.runner_lease.state_root !== RUNNER_STATE_ROOT) {
    throw new Error(`manifest.runner_lease.state_root must be ${RUNNER_STATE_ROOT}`);
  }

  exactKeys(
    document.runpodctl,
    [
      "path", "sha256", "install_source_path", "source_repository", "upstream_base_commit",
      "source_commit", "source_tree", "official_base_patch_series", "patch_path",
      "patch_sha256", "patch_id", "create_interface", "nonce_input_channel",
      "nonce_input_flag", "receipt_redaction_schema", "response_scrub_contract",
      "provider_identity_contamination", "serialized_output_guard",
    ],
    "manifest.runpodctl",
  );
  validateHashedFileReference(
    { path: document.runpodctl.path, sha256: document.runpodctl.sha256 },
    "manifest.runpodctl binary",
  );
  assertAbsoluteFilePath(document.runpodctl.install_source_path, "manifest.runpodctl.install_source_path");
  assertString(document.runpodctl.source_tree, "manifest.runpodctl.source_tree", SOURCE_COMMIT);
  if (
    document.runpodctl.source_repository !== RUNPODCTL_SOURCE_REPOSITORY ||
    document.runpodctl.upstream_base_commit !== RUNPODCTL_UPSTREAM_BASE_COMMIT ||
    !SOURCE_COMMIT.test(document.runpodctl.source_commit) ||
    !SAFE_ID.test(document.runpodctl.patch_id) ||
    document.runpodctl.create_interface !== RUNPODCTL_CREATE_INTERFACE ||
    document.runpodctl.nonce_input_channel !== "stdin" ||
    document.runpodctl.nonce_input_flag !== "--env-stdin" ||
    document.runpodctl.receipt_redaction_schema !== RUNPODCTL_ENV_REDACTION_SCHEMA ||
    document.runpodctl.response_scrub_contract !== RUNPODCTL_RESPONSE_SCRUB_CONTRACT ||
    document.runpodctl.provider_identity_contamination !==
      RUNPODCTL_IDENTITY_CONTAMINATION_CONTRACT ||
    document.runpodctl.serialized_output_guard !== RUNPODCTL_SERIALIZED_OUTPUT_GUARD
  ) {
    throw new Error("manifest.runpodctl must identify the hash-pinned response-scrubbed CPU REST stdin fork");
  }
  if (
    !Array.isArray(document.runpodctl.official_base_patch_series) ||
    document.runpodctl.official_base_patch_series.length !== 4
  ) {
    throw new Error("manifest.runpodctl must pin the complete ordered four-patch official-base series");
  }
  for (const [index, patch] of document.runpodctl.official_base_patch_series.entries()) {
    exactKeys(patch, ["sequence", "path", "sha256"], `manifest.runpodctl.official_base_patch_series[${index}]`);
    if (patch.sequence !== index + 1) throw new Error("manifest.runpodctl official-base patch order is invalid");
    validateHashedFileReference(
      { path: patch.path, sha256: patch.sha256 },
      `manifest.runpodctl.official_base_patch_series[${index}]`,
    );
  }
  validateHashedFileReference(
    { path: document.runpodctl.patch_path, sha256: document.runpodctl.patch_sha256 },
    "manifest.runpodctl patch",
  );

  exactKeys(
    document.pod,
    [
      "name_prefix",
      "image",
      "compute_type",
      "cloud_type",
      "gpu_count",
      "max_cost_per_hour",
      "max_total_cost_usd",
      "vcpu_count",
      "memory_gb",
      "container_disk_gb",
      "volume_gb",
      "network_volume_id",
      "cpu_flavor_ids",
      "cpu_flavor_priority",
      "public_ip",
      "ports",
      "max_concurrency",
    ],
    "manifest.pod",
  );
  if (document.pod.name_prefix !== "proxywar-mickey-cpu-fanout") {
    throw new Error("manifest.pod.name_prefix must be proxywar-mickey-cpu-fanout");
  }
  assertString(document.pod.image, "manifest.pod.image", /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{2,255}$/);
  if (document.pod.compute_type !== "CPU" || document.pod.gpu_count !== 0) {
    throw new Error("manifest pod must be CPU with gpu_count 0");
  }
  if (document.pod.cloud_type !== "COMMUNITY") {
    throw new Error("manifest.pod.cloud_type must be COMMUNITY for the preregistered price-bounded screen");
  }
  if (document.pod.max_cost_per_hour !== 0.1) {
    throw new Error("manifest.pod.max_cost_per_hour must be exactly 0.10");
  }
  if (document.pod.max_total_cost_usd !== 3.2) {
    throw new Error("manifest.pod.max_total_cost_usd must be exactly 3.20 for this bounded screen");
  }
  if (document.pod.vcpu_count !== 2 || document.pod.memory_gb !== 4) {
    throw new Error("manifest pod must request exactly 2 vCPU and 4GB system memory");
  }
  if (
    document.pod.container_disk_gb !== 20 ||
    document.pod.volume_gb !== 0 ||
    document.pod.network_volume_id !== null
  ) {
    throw new Error("manifest pod must use 20GB ephemeral disk, no volume, and no network volume");
  }
  if (
    !Array.isArray(document.pod.cpu_flavor_ids) ||
    document.pod.cpu_flavor_ids.join(",") !== "cpu5c,cpu3c" ||
    document.pod.cpu_flavor_priority !== "custom" ||
    document.pod.public_ip !== true ||
    !Array.isArray(document.pod.ports) ||
    document.pod.ports.join(",") !== "22/tcp"
  ) {
    throw new Error("manifest pod must request cpu5c/cpu3c fallback plus public 22/tcp for SSH transport");
  }
  assertInteger(document.pod.max_concurrency, "manifest.pod.max_concurrency", 1, 4);

  exactKeys(
    document.cleanup_watchdog,
    [
      "kind", "installation_id", "state_root", "bin_root", "installations_root",
      "installation_directory", "script", "node_runtime", "plist_path", "ledger_path", "heartbeat_path",
      "heartbeat_max_age_seconds", "client_cleanup_deadline_seconds",
      "poll_interval_seconds", "provider_ttl_available", "exact_id_only",
      "launchd_required_for_live_run", "launchd_label", "service_receipt_path",
    ],
    "manifest.cleanup_watchdog",
  );
  if (document.cleanup_watchdog.kind !== "independent_exact_id_reaper_v1") {
    throw new Error("manifest.cleanup_watchdog.kind is unsupported");
  }
  exactKeys(
    document.cleanup_watchdog.script,
    ["path", "sha256", "install_source_path"],
    "manifest.cleanup_watchdog.script",
  );
  validateHashedFileReference(
    { path: document.cleanup_watchdog.script.path, sha256: document.cleanup_watchdog.script.sha256 },
    "manifest.cleanup_watchdog.script",
  );
  assertAbsoluteFilePath(
    document.cleanup_watchdog.script.install_source_path,
    "manifest.cleanup_watchdog.script.install_source_path",
  );
  validateHashedFileReference(
    document.cleanup_watchdog.node_runtime,
    "manifest.cleanup_watchdog.node_runtime",
  );
  const installationId = durableInstallationId(document);
  const durable = durableInstallationPaths(installationId);
  const adoptedR8PersistentReaper =
    document.schema_version === 5 &&
    document.activation.persistent_reaper.kind ===
      "adopt_existing_r8_immutable_cleanup_daemon_v1";
  if (
    document.cleanup_watchdog.installation_id !== installationId ||
    document.cleanup_watchdog.state_root !== durable.root ||
    document.cleanup_watchdog.bin_root !== durable.binRoot ||
    document.cleanup_watchdog.installations_root !== durable.installationsRoot ||
    document.cleanup_watchdog.installation_directory !== durable.installationDirectory ||
    document.cleanup_watchdog.script.path !== durable.reaper ||
    document.cleanup_watchdog.script.install_source_path !==
      (adoptedR8PersistentReaper ? durable.reaper : REAPER_SCRIPT) ||
    document.cleanup_watchdog.script.sha256 !==
      (adoptedR8PersistentReaper
        ? document.activation.persistent_reaper.script_sha256
        : document.control_plane.exact_id_reaper.sha256) ||
    document.runpodctl.path !== durable.runpodctl ||
    document.cleanup_watchdog.plist_path !== durable.plist
  ) {
    throw new Error("manifest cleanup watchdog must pin the exact durable versioned installation paths");
  }
  assertAbsoluteFilePath(document.cleanup_watchdog.ledger_path, "manifest.cleanup_watchdog.ledger_path");
  assertAbsoluteFilePath(document.cleanup_watchdog.heartbeat_path, "manifest.cleanup_watchdog.heartbeat_path");
  assertString(
    document.cleanup_watchdog.launchd_label,
    "manifest.cleanup_watchdog.launchd_label",
    /^[a-zA-Z0-9][a-zA-Z0-9.-]{2,127}$/,
  );
  assertAbsoluteFilePath(
    document.cleanup_watchdog.service_receipt_path,
    "manifest.cleanup_watchdog.service_receipt_path",
  );
  if (
    document.cleanup_watchdog.ledger_path !== `${durable.root}/ledger.json` ||
    document.cleanup_watchdog.heartbeat_path !== `${durable.root}/provider-heartbeat.json` ||
    !durableServiceReceiptPaths(document.run_id).has(
      document.cleanup_watchdog.service_receipt_path,
    )
  ) {
    throw new Error("manifest cleanup watchdog state files must stay at exact run-bound durable paths");
  }
  if (
    document.cleanup_watchdog.client_cleanup_deadline_seconds !== 7200 ||
    document.cleanup_watchdog.heartbeat_max_age_seconds !== 120 ||
    document.cleanup_watchdog.poll_interval_seconds !== 60 ||
    document.cleanup_watchdog.provider_ttl_available !== false ||
    document.cleanup_watchdog.exact_id_only !== true ||
    document.cleanup_watchdog.launchd_required_for_live_run !== true
  ) {
    throw new Error("manifest cleanup watchdog must declare the truthful 2h client-side exact-ID contract");
  }
  validateHashedFileReference(document.source_reach_receipt, "manifest.source_reach_receipt");

  exactKeys(
    document.promotion_gates,
    [
      "local_fanout_can_promote",
      "upload_allowed",
      "hosted_4_of_4_required",
      "regression_20_of_20_required",
      "final_rci_required",
      "zero_k1z_harm_required",
    ],
    "manifest.promotion_gates",
  );
  if (
    document.promotion_gates.local_fanout_can_promote !== false ||
    document.promotion_gates.upload_allowed !== false ||
    document.promotion_gates.hosted_4_of_4_required !== true ||
    document.promotion_gates.regression_20_of_20_required !== true ||
    document.promotion_gates.final_rci_required !== true ||
    document.promotion_gates.zero_k1z_harm_required !== true
  ) {
    throw new Error("manifest promotion gates must keep local fanout non-promotional and preserve all later gates");
  }

  if (!Array.isArray(document.arms) || document.arms.length < 1 || document.arms.length > 32) {
    throw new Error("manifest.arms must contain 1 to 32 retained candidates");
  }
  const armIds = new Set();
  const pairIds = new Set();
  const candidateImages = new Set();
  const candidateEntrypoints = new Set();
  let canonicalM0 = null;
  const flattenedPairs = [];
  for (let armIndex = 0; armIndex < document.arms.length; armIndex += 1) {
    const arm = document.arms[armIndex];
    const label = `arms[${armIndex}]`;
    exactKeys(
      arm,
      [
        "id",
        "mechanism_class",
        "roster_class",
        "bundle",
        "extractor",
        "shared_files",
        "candidate",
        "m0",
        "gates",
        "pairs",
      ],
      label,
    );
    assertString(arm.id, `${label}.id`, SAFE_ID);
    if (armIds.has(arm.id)) throw new Error(`duplicate arm id ${arm.id}`);
    armIds.add(arm.id);
    const contract = RETAINED_ARMS[arm.id];
    if (!contract) throw new Error(`arm ${arm.id} is unsupported, pruned, or behaviorally redundant`);
    if (arm.mechanism_class !== contract.mechanismClass || arm.roster_class !== contract.rosterClass) {
      throw new Error(`${label} mechanism_class/roster_class does not match retained arm ${arm.id}`);
    }
    validateHashedFileReference(arm.bundle, `${label}.bundle`);
    if (!arm.bundle.path.endsWith(".tar.gz")) throw new Error(`${label}.bundle.path must end in .tar.gz`);
    validateHashedFileReference(arm.extractor, `${label}.extractor`);
    if (!arm.extractor.path.endsWith(".py")) throw new Error(`${label}.extractor.path must end in .py`);
    validateSharedFiles(arm.shared_files, `${label}.shared_files`);
    validatePolicyIdentity(arm.candidate, arm.id, `${label}.candidate`);
    validatePolicyIdentity(arm.m0, "m0", `${label}.m0`);
    if (arm.candidate.source_commit !== arm.m0.source_commit) {
      throw new Error(`${label} candidate and M0 must share one source commit`);
    }
    if (arm.candidate.image_id === arm.m0.image_id) {
      throw new Error(`${label} candidate and M0 image IDs must be distinct`);
    }
    if (candidateImages.has(arm.candidate.image_id) || candidateEntrypoints.has(arm.candidate.entrypoint_sha256)) {
      throw new Error(`${label} duplicates another candidate image or entrypoint hash`);
    }
    candidateImages.add(arm.candidate.image_id);
    candidateEntrypoints.add(arm.candidate.entrypoint_sha256);
    const m0String = JSON.stringify(arm.m0);
    if (canonicalM0 === null) canonicalM0 = m0String;
    else if (canonicalM0 !== m0String) throw new Error("every arm must use the identical evaluation-m0 identity");
    if (!Array.isArray(arm.pairs) || arm.pairs.length < 1 || arm.pairs.length > 10_000) {
      throw new Error(`${label}.pairs must contain at least one pair`);
    }
    const withIndex = { ...arm, __index: armIndex };
    arm.pairs.forEach((pair, pairIndex) => {
      validatePair(pair, withIndex, document.randomization, pairIndex);
      if (pairIds.has(pair.id)) throw new Error(`duplicate pair id ${pair.id}`);
      pairIds.add(pair.id);
      flattenedPairs.push({ arm, pair });
    });
    validateGates(arm.gates, arm.id, arm.pairs.length, `${label}.gates`);
  }
  if (document.pod.max_concurrency > flattenedPairs.length) {
    throw new Error("manifest.pod.max_concurrency cannot exceed the number of pairs");
  }
  const worstCaseCost = flattenedPairs.length *
    document.pod.max_cost_per_hour *
    (document.cleanup_watchdog.client_cleanup_deadline_seconds / 3600);
  if (worstCaseCost > document.pod.max_total_cost_usd + Number.EPSILON) {
    throw new Error(`manifest worst-case pod cost ${worstCaseCost.toFixed(2)} exceeds total cap`);
  }
  if (activationSchema) {
    if (
      document.arms.length !== 4 ||
      !document.arms.every((arm) => arm.pairs.length === 4) ||
      flattenedPairs.length !== document.activation.screen_pair_count ||
      document.pod.max_concurrency !== document.activation.max_concurrency ||
      document.runpodctl.nonce_input_channel !== document.activation.nonce_input_channel
    ) {
      throw new Error("activation must remain the exact four-arm, 16-pair, concurrency-four G000 screen");
    }
    const digest = document.schema_version === 5
      ? r9ActivationManifestDigest(document)
      : activationManifestDigest(document);
    const expectedDigest = document.schema_version === 5
      ? R9_ACTIVATION_MANIFEST_DIGEST
      : R8_ACTIVATION_MANIFEST_DIGEST;
    if (digest !== expectedDigest) {
      throw new Error(`r${document.schema_version === 5 ? 9 : 8} activation manifest semantic digest mismatch: ${digest}`);
    }
  }
  return { document, pairs: flattenedPairs };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function requireRegularUnlinkedFile(filePath, label) {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return realpath(filePath);
}

async function verifyHashedLocalFile(reference, label) {
  const resolved = await requireRegularUnlinkedFile(reference.path, label);
  if (resolved !== reference.path) throw new Error(`${label} must already be canonical: ${reference.path}`);
  const actual = await sha256File(reference.path);
  if (actual !== reference.sha256) {
    throw new Error(`${label} hash mismatch: expected ${reference.sha256}, got ${actual}`);
  }
  return actual;
}

async function verifyOwnedDurableDirectory(directory, label) {
  const info = await lstat(directory).catch(() => null);
  if (
    !info?.isDirectory() ||
    info.isSymbolicLink() ||
    await realpath(directory) !== directory ||
    (info.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error(`${label} must be an operator-owned canonical 0700 directory`);
  }
}

async function verifyOwnedDurableFile(filePath, mode, label) {
  const info = await lstat(filePath).catch(() => null);
  if (
    !info?.isFile() ||
    info.isSymbolicLink() ||
    await realpath(filePath) !== filePath ||
    (info.mode & 0o777) !== mode ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error(`${label} must be an operator-owned canonical ${mode.toString(8).padStart(4, "0")} file`);
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifySourceReachReceipt(manifest) {
  await verifyHashedLocalFile(manifest.source_reach_receipt, "source reach receipt");
  const receipt = JSON.parse(await readFile(manifest.source_reach_receipt.path, "utf8"));
  exactKeys(
    receipt,
    [
      "schema_version",
      "evidence_scope",
      "source_commit",
      "surrogate_source",
      "upload_eligible",
      "fixture_set_sha256",
      "fixture_ids",
      "arms",
    ],
    "source reach receipt",
  );
  if (
    receipt.schema_version !== 1 ||
    receipt.evidence_scope !== "deterministic-source-fixtures-only" ||
    receipt.surrogate_source !== "static-eval-v1" ||
    receipt.upload_eligible !== false
  ) {
    throw new Error("source reach receipt has an unsafe scope or upload boundary");
  }
  assertString(receipt.source_commit, "source reach receipt.source_commit", SOURCE_COMMIT);
  assertString(receipt.fixture_set_sha256, "source reach receipt.fixture_set_sha256", SHA256);
  if (!Array.isArray(receipt.fixture_ids) || receipt.fixture_ids.length < 1) {
    throw new Error("source reach receipt must bind at least one fixture");
  }
  if (!Array.isArray(receipt.arms) || receipt.arms.length !== 5) {
    throw new Error("source reach receipt must contain M0 plus the four retained candidates");
  }
  const expectedIds = new Set(["m0", ...Object.keys(RETAINED_ARMS)]);
  const traces = new Set();
  const records = new Map();
  for (const record of receipt.arms) {
    exactKeys(
      record,
      [
        "id",
        "docker_target",
        "run",
        "entrypoint_sha256",
        "expected_mechanism_reach",
        "mechanism_reached",
        "selected_action_trace_sha256",
        "k1z_harm_count",
      ],
      `source reach receipt arm ${record?.id ?? "unknown"}`,
    );
    if (!expectedIds.delete(record.id)) throw new Error(`source reach receipt has unknown or duplicate arm ${record.id}`);
    const expected = expectedPolicyContract(record.id);
    if (
      record.docker_target !== expected.dockerTarget ||
      !equalJson(record.run, ["node", expected.entrypoint])
    ) {
      throw new Error(`source reach receipt arm ${record.id} has the wrong target or run argv`);
    }
    assertString(record.entrypoint_sha256, `source receipt ${record.id} entrypoint`, SHA256);
    assertString(record.selected_action_trace_sha256, `source receipt ${record.id} trace`, SHA256);
    if (traces.has(record.selected_action_trace_sha256)) {
      throw new Error("source reach receipt contains duplicate selected-action traces");
    }
    traces.add(record.selected_action_trace_sha256);
    if (record.k1z_harm_count !== 0) throw new Error(`source receipt ${record.id} has K1Z harm`);
    if (record.id === "m0") {
      if (record.expected_mechanism_reach !== false || record.mechanism_reached !== false) {
        throw new Error("M0 source receipt must truthfully record null-plan non-reach");
      }
    } else if (record.expected_mechanism_reach !== true || record.mechanism_reached !== true) {
      throw new Error(`candidate ${record.id} lacks source-fixture mechanism reach`);
    }
    records.set(record.id, record);
  }
  if (expectedIds.size !== 0) throw new Error("source reach receipt is missing a retained arm");
  for (const arm of manifest.arms) {
    for (const identity of [arm.candidate, arm.m0]) {
      const record = records.get(identity.arm);
      if (
        identity.source_commit !== receipt.source_commit ||
        identity.surrogate_source !== receipt.surrogate_source ||
        identity.docker_target !== record.docker_target ||
        identity.entrypoint_sha256 !== record.entrypoint_sha256 ||
        !equalJson(identity.run, record.run)
      ) {
        throw new Error(`manifest identity ${identity.arm} does not match the hash-bound source reach receipt`);
      }
    }
  }
  return { receipt, records };
}

export async function preflightManifest(
  manifestPath,
  expectedSha256,
  { requirePersistentServiceArtifacts = false } = {},
) {
  assertAbsoluteFilePath(manifestPath, "--manifest");
  assertString(expectedSha256, "--manifest-sha256", SHA256);
  await requireRegularUnlinkedFile(manifestPath, "manifest");
  const actualManifestSha256 = await sha256File(manifestPath);
  if (actualManifestSha256 !== expectedSha256) {
    throw new Error(`manifest hash mismatch: expected ${expectedSha256}, got ${actualManifestSha256}`);
  }
  const document = JSON.parse(await readFile(manifestPath, "utf8"));
  const validated = validateManifest(document);
  for (const [key, reference] of Object.entries(document.control_plane)) {
    await verifyHashedLocalFile(reference, `pinned control-plane ${key}`);
  }
  await verifyHashedLocalFile(
    { path: document.runpodctl.install_source_path, sha256: document.runpodctl.sha256 },
    "pinned runpodctl installation source",
  );
  const sourceRunpodctlBody = await readFile(document.runpodctl.install_source_path);
  if (!sourceRunpodctlBody.includes(Buffer.from(`cleanroom-${document.runpodctl.source_commit}`, "utf8"))) {
    throw new Error("runpodctl installation source does not embed the declared cleanroom CLI version");
  }
  const sourceRunpodctlInfo = await stat(document.runpodctl.install_source_path);
  if ((sourceRunpodctlInfo.mode & 0o111) === 0) {
    throw new Error("runpodctl installation source must be executable");
  }
  const installedRunpodctl = await lstat(document.runpodctl.path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const installedReaper = await lstat(document.cleanup_watchdog.script.path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  let persistentReaperCompatibility = null;
  if (installedRunpodctl || installedReaper || requirePersistentServiceArtifacts) {
    for (const [directory, label] of [
      [document.cleanup_watchdog.state_root, "durable reaper state root"],
      [document.cleanup_watchdog.bin_root, "durable reaper bin root"],
      [document.cleanup_watchdog.installations_root, "durable reaper installations root"],
      [document.cleanup_watchdog.installation_directory, "durable reaper version directory"],
    ]) {
      await verifyOwnedDurableDirectory(directory, label);
    }
    await verifyHashedLocalFile(
      { path: document.runpodctl.path, sha256: document.runpodctl.sha256 },
      "pinned durable runpodctl binary",
    );
    await verifyOwnedDurableFile(
      document.runpodctl.path,
      0o700,
      "durable runpodctl binary",
    );
    await verifyHashedLocalFile(
      {
        path: document.cleanup_watchdog.script.path,
        sha256: document.cleanup_watchdog.script.sha256,
      },
      "pinned durable reaper script",
    );
    await verifyOwnedDurableFile(
      document.cleanup_watchdog.script.path,
      0o600,
      "durable reaper script",
    );
  }
  if (document.schema_version === 5) {
    const persistent = document.activation.persistent_reaper;
    await verifyHashedLocalFile(persistent.manifest, "pinned r8 persistent reaper manifest");
    await verifyHashedLocalFile(
      persistent.service_receipt,
      "pinned r8 persistent reaper service receipt",
    );
    await verifyOwnedDurableFile(
      persistent.service_receipt.path,
      0o600,
      "pinned r8 persistent reaper service receipt",
    );
    await verifyHashedLocalFile(
      { path: document.cleanup_watchdog.plist_path, sha256: persistent.plist_sha256 },
      "pinned r8 persistent reaper plist",
    );
    await verifyOwnedDurableFile(
      document.cleanup_watchdog.plist_path,
      0o600,
      "pinned r8 persistent reaper plist",
    );
    const installedEntries = (await readdir(document.cleanup_watchdog.installation_directory)).sort();
    if (
      !equalJson(installedEntries, ["runpod-exact-id-reaper.mjs", "runpodctl-darwin-arm64"])
    ) {
      throw new Error("adopted r8 persistent reaper installation is not the exact two-file image");
    }
    const priorReceipt = JSON.parse(await readFile(persistent.service_receipt.path, "utf8"));
    exactKeys(
      priorReceipt,
      [
        "schema_version", "kind", "status", "manifest_sha256", "launchd_label",
        "launchd_domain", "plist_path", "plist_sha256", "ledger_path", "heartbeat_path",
        "runpodctl_sha256", "reaper_sha256", "node_path", "node_sha256", "pid",
        "attested_at",
      ],
      "pinned r8 persistent reaper service receipt",
    );
    if (
      priorReceipt.schema_version !== 1 ||
      priorReceipt.kind !== "mickey_runpod_exact_id_reaper_service" ||
      priorReceipt.status !== "active" ||
      priorReceipt.manifest_sha256 !== persistent.manifest.sha256 ||
      priorReceipt.launchd_label !== document.cleanup_watchdog.launchd_label ||
      priorReceipt.plist_path !== document.cleanup_watchdog.plist_path ||
      priorReceipt.plist_sha256 !== persistent.plist_sha256 ||
      priorReceipt.ledger_path !== document.cleanup_watchdog.ledger_path ||
      priorReceipt.heartbeat_path !== document.cleanup_watchdog.heartbeat_path ||
      priorReceipt.runpodctl_sha256 !== document.runpodctl.sha256 ||
      priorReceipt.reaper_sha256 !== document.cleanup_watchdog.script.sha256 ||
      priorReceipt.node_path !== document.cleanup_watchdog.node_runtime.path ||
      priorReceipt.node_sha256 !== document.cleanup_watchdog.node_runtime.sha256 ||
      priorReceipt.pid !== persistent.historical_receipt_pid
    ) {
      throw new Error("pinned r8 service receipt does not bind the adopted cleanup daemon");
    }
    persistentReaperCompatibility = validateR8PersistentReaperCompatibility(
      await readFile(document.cleanup_watchdog.script.path, "utf8"),
      await readFile(document.control_plane.exact_id_reaper.path, "utf8"),
    );
    if (!equalJson(persistentReaperCompatibility, persistent.compatibility)) {
      throw new Error("manifest persistent-reaper compatibility claim differs from live proof");
    }
  }
  await verifyHashedLocalFile(
    { path: document.runpodctl.patch_path, sha256: document.runpodctl.patch_sha256 },
    "pinned runpodctl patch",
  );
  for (const [index, patch] of document.runpodctl.official_base_patch_series.entries()) {
    await verifyHashedLocalFile(
      { path: patch.path, sha256: patch.sha256 },
      `pinned official-base runpodctl patch ${index + 1}`,
    );
  }
  await verifyHashedLocalFile(
    document.cleanup_watchdog.node_runtime,
    "pinned reaper Node runtime",
  );
  const nodeInfo = await stat(document.cleanup_watchdog.node_runtime.path);
  if ((nodeInfo.mode & 0o111) === 0) throw new Error("pinned reaper Node runtime must be executable");
  await verifyHashedLocalFile(
    { path: document.runner_lease.path, sha256: document.runner_lease.sha256 },
    "pinned Mickey runner lease",
  );
  const runnerInfo = await stat(document.runner_lease.path);
  if ((runnerInfo.mode & 0o111) === 0) throw new Error("pinned Mickey runner lease must be executable");
  const localArtifacts = new Map();
  for (const { arm } of validated.pairs) {
    for (const [label, reference] of [["bundle", arm.bundle], ["extractor", arm.extractor]]) {
      const key = `${label}:${reference.path}:${reference.sha256}`;
      if (!localArtifacts.has(key)) {
        localArtifacts.set(key, await verifyHashedLocalFile(reference, `${arm.id} ${label}`));
      }
    }
  }
  const verifierSha256 = document.control_plane.remote_verifier.sha256;
  const sourceReceipt = await verifySourceReachReceipt(document);
  const activationEvidence = document.schema_version === 4
    ? await verifyR7ActivationEvidence(document)
    : document.schema_version === 5
      ? await verifyR9ActivationEvidence(document, {
        requireRecoveryReceipt: requirePersistentServiceArtifacts,
      })
      : null;
  return {
    ...validated,
    manifestPath,
    manifestSha256: actualManifestSha256,
    verifierPath: REMOTE_VERIFIER,
    verifierSha256,
    sourceReceipt,
    activationEvidence,
    persistentReaperCompatibility,
  };
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function dryRunPodName(manifest) {
  return `${manifest.pod.name_prefix}-${"0".repeat(32)}`;
}

export function isFullFanoutLiveApproved(preflight) {
  return Boolean(
    isExactR9ActivationCandidate(preflight) &&
    preflight.activationEvidence?.receipt_sha256 === R7_CANARY_RECEIPT_SHA256 &&
    preflight.activationEvidence?.known_hosts_sha256 === R7_CANARY_KNOWN_HOSTS_SHA256 &&
    preflight.activationEvidence?.failure_evidence_sha256 === R8_FAILURE_EVIDENCE_SHA256 &&
    preflight.activationEvidence?.recovery_receipt_sha256 === R8_RECOVERY_RECEIPT_SHA256 &&
    preflight.activationEvidence?.relocated_bundle_canary_sha256 === R9_RELOCATED_BUNDLE_CANARY_SHA256 &&
    preflight.activationEvidence?.recovery_status === "passed" &&
    preflight.activationEvidence?.recovery_record_state === "blocked" &&
    preflight.activationEvidence?.recovery_terminal_reason === "pre_post_create_not_invoked"
  );
}

export function isExactR9ActivationCandidate(preflight) {
  return Boolean(
    preflight?.manifestPath === R9_ACTIVATION_MANIFEST_PATH &&
    preflight.document?.schema_version === 5 &&
    preflight.document.run_id === R9_ACTIVATION_RUN_ID &&
    preflight.document.activation?.output_path === R9_ACTIVATION_OUTPUT_PATH &&
    r9ActivationManifestDigest(preflight.document) === R9_ACTIVATION_MANIFEST_DIGEST &&
    preflight.activationEvidence?.receipt_sha256 === R7_CANARY_RECEIPT_SHA256 &&
    preflight.activationEvidence?.known_hosts_sha256 === R7_CANARY_KNOWN_HOSTS_SHA256 &&
    preflight.activationEvidence?.failure_evidence_sha256 === R8_FAILURE_EVIDENCE_SHA256 &&
    preflight.activationEvidence?.recovery_receipt_sha256 === R8_RECOVERY_RECEIPT_SHA256 &&
    preflight.activationEvidence?.relocated_bundle_canary_sha256 === R9_RELOCATED_BUNDLE_CANARY_SHA256
  );
}

export function validateR8LedgerQuiescence(ledger) {
  if (!isObject(ledger) || !Array.isArray(ledger.records)) {
    throw new Error("r8 durable reaper ledger is malformed");
  }
  const nonterminal = ledger.records.filter((record) => record.state !== "retired");
  if (nonterminal.length !== 0) {
    throw new Error("r8 activation requires a zero-nonterminal durable reaper ledger");
  }
  return { revision: ledger.revision, nonterminal_count: 0 };
}

export function isExactR8PrePostRecoveryRecord(record) {
  if (!isObject(record)) return false;
  const events = record.events;
  if (!Array.isArray(events) || events.length < 3) return false;
  const first = events[0];
  const last = events.at(-1);
  const middle = events.slice(1, -1);
  return Boolean(
    record.record_id === R8_RECOVERY_RECORD_ID &&
    record.state === "blocked" &&
    record.run_id === R8_RECOVERY_RECORD_RUN_ID &&
    record.manifest_sha256 === R8_MANIFEST_SHA256 &&
    record.deadline === "2026-07-21T05:42:20.144Z" &&
    record.ownership_kind === "generated-exact-name-v1" &&
    record.name_prefix === "proxywar-mickey-cpu-fanout" &&
    record.name_nonce === "ba7e0411a40d16bb617a743c7a86966f" &&
    record.expected_name === R8_RECOVERY_EXPECTED_NAME &&
    equalJson(record.preexisting_ids, R8_RECOVERY_PREEXISTING_IDS) &&
    record.preexisting_snapshot_sha256 === R8_RECOVERY_SNAPSHOT_SHA256 &&
    record.pod_id === null && record.active_binding_sha256 === null &&
    record.bound_at === null && record.retired_at === null &&
    record.terminal_reason === "pre_post_create_not_invoked" && record.last_error === null &&
    record.created_at === "2026-07-21T03:42:20.155Z" &&
    isObject(first) && equalJson(Object.keys(first).sort(), ["at", "type"]) &&
    first.at === record.created_at && first.type === "pending_create_registered" &&
    middle.length >= 1 && middle.every((event) => (
      isObject(event) && equalJson(Object.keys(event).sort(), ["at", "type"]) &&
      event.type === "pending_name_absent" && Number.isFinite(Date.parse(event.at))
    )) &&
    isObject(last) && equalJson(Object.keys(last).sort(), [
      "at", "provider_snapshot_sha256", "recovery_evidence_sha256", "type",
    ]) &&
    last.type === "pre_post_create_not_invoked" &&
    last.recovery_evidence_sha256 === R8_FAILURE_EVIDENCE_SHA256 &&
    last.provider_snapshot_sha256 === R8_RECOVERY_SNAPSHOT_SHA256 &&
    Number.isFinite(Date.parse(last.at)) && record.updated_at === last.at
  );
}

export function validateR9LedgerReady(ledger) {
  if (!isObject(ledger) || !Array.isArray(ledger.records)) {
    throw new Error("r9 durable reaper ledger is malformed");
  }
  const pending = ledger.records.filter((record) => record.state === "pending");
  const active = ledger.records.filter((record) => record.state === "active");
  const blocked = ledger.records.filter((record) => record.state === "blocked");
  const unknown = ledger.records.filter((record) => !["pending", "active", "retired", "blocked"].includes(record.state));
  if (pending.length !== 0 || active.length !== 0 || unknown.length !== 0) {
    throw new Error("r9 activation requires zero pending and zero active reaper records");
  }
  if (blocked.length !== 1 || !isExactR8PrePostRecoveryRecord(blocked[0])) {
    throw new Error("r9 activation permits only the exact terminal blocked r8 pre-POST sentinel");
  }
  return {
    revision: ledger.revision,
    pending_count: 0,
    active_count: 0,
    blocked_count: 1,
    r8_recovery_record_id: blocked[0].record_id,
  };
}

export function validateR9RecoveryHistory(ledger) {
  if (!isObject(ledger) || !Array.isArray(ledger.records)) {
    throw new Error("r9 durable reaper ledger is malformed");
  }
  const blocked = ledger.records.filter((record) => record.state === "blocked");
  if (blocked.length !== 1 || !isExactR8PrePostRecoveryRecord(blocked[0])) {
    throw new Error("r9 permits only the exact terminal blocked r8 pre-POST sentinel");
  }
  return {
    revision: ledger.revision,
    pending_count: ledger.records.filter((record) => record.state === "pending").length,
    active_count: ledger.records.filter((record) => record.state === "active").length,
    r8_recovery_record_id: blocked[0].record_id,
  };
}

export function validateR8MutationLedgerBoundary({
  ledger,
  manifest,
  manifestSha256,
  pairId,
  pendingOwnership,
  registeredRecords,
}) {
  const r8Context = manifest?.schema_version === 4 && manifest.run_id === R8_ACTIVATION_RUN_ID;
  const r9Context = manifest?.schema_version === 5 && manifest.run_id === R9_ACTIVATION_RUN_ID;
  if (
    !isObject(ledger) ||
    !Array.isArray(ledger.records) ||
    !isObject(manifest) ||
    (!r8Context && !r9Context) ||
    !SHA256.test(manifestSha256 ?? "") ||
    !(registeredRecords instanceof Map)
  ) {
    throw new Error("r8 per-create ledger boundary received an invalid activation context");
  }
  const allowedPairIds = new Set(
    manifest.arms.flatMap((arm) => arm.pairs.map((pair) => pair.id)),
  );
  if (!allowedPairIds.has(pairId)) {
    throw new Error("r8 per-create ledger boundary received an unknown pair");
  }
  if (!isObject(pendingOwnership)) {
    throw new Error("r8 per-create ledger boundary lacks the durable pending record");
  }
  const registration = registeredRecords.get(pendingOwnership.record_id);
  if (!registration || registration.pairId !== pairId) {
    throw new Error("r8 pending record is not registered to this process and pair");
  }
  const matching = ledger.records.filter(
    (record) => record.record_id === pendingOwnership.record_id,
  );
  if (matching.length !== 1) {
    throw new Error("r8 durable ledger lost or duplicated the exact pending record");
  }
  const pending = matching[0];
  const r9PendingEventsExact = !r9Context || (
    Array.isArray(pending.events) &&
    Array.isArray(pendingOwnership.events) &&
    pending.events.length >= pendingOwnership.events.length &&
    equalJson(
      pending.events.slice(0, pendingOwnership.events.length),
      pendingOwnership.events,
    ) &&
    pending.events.slice(pendingOwnership.events.length).every((event) => (
      isObject(event) &&
      equalJson(Object.keys(event).sort(), ["at", "type"]) &&
      event.type === "pending_name_absent" &&
      Number.isFinite(Date.parse(event.at))
    ))
  );
  if (
    pending.state !== "pending" ||
    pending.run_id !== `${manifest.run_id}:${pairId}` ||
    pending.manifest_sha256 !== manifestSha256 ||
    pending.ownership_kind !== "generated-exact-name-v1" ||
    pending.name_prefix !== manifest.pod.name_prefix ||
    pending.expected_name !== pendingOwnership.expected_name ||
    pending.expected_name !== `${pending.name_prefix}-${pending.name_nonce}` ||
    !pending.expected_name.startsWith(`${manifest.pod.name_prefix}-`) ||
    pending.expected_name.toLowerCase().startsWith("storm-") ||
    pending.pod_id !== null ||
    pending.active_binding_sha256 !== null ||
    (r9Context && pending.bound_at !== null) ||
    (r9Context && pending.retired_at !== null) ||
    pending.last_error !== null ||
    pending.terminal_reason !== null ||
    pending.deadline !== pendingOwnership.deadline ||
    pending.name_nonce !== pendingOwnership.name_nonce ||
    (r9Context && pending.created_at !== pendingOwnership.created_at) ||
    pending.preexisting_snapshot_sha256 !== pendingOwnership.preexisting_snapshot_sha256 ||
    !equalJson(pending.preexisting_ids, pendingOwnership.preexisting_ids) ||
    (r9Context && pending.updated_at !== pending.events.at(-1)?.at) ||
    !r9PendingEventsExact
  ) {
    throw new Error("r8 exact pending record drifted before the provider create POST");
  }

  const blockedHistory = ledger.records.filter((record) => record.state === "blocked");
  if (r9Context) {
    if (blockedHistory.length !== 1 || !isExactR8PrePostRecoveryRecord(blockedHistory[0])) {
      throw new Error("r9 per-create boundary permits only the exact blocked r8 pre-POST sentinel");
    }
  } else if (blockedHistory.length !== 0) {
    throw new Error("r8 durable ledger contains a blocked ownership record");
  }
  const nonterminal = ledger.records.filter((record) => record.state === "pending" || record.state === "active");
  if (nonterminal.length > manifest.pod.max_concurrency) {
    throw new Error("r8 durable ledger exceeds the preregistered nonterminal concurrency cap");
  }
  for (const record of nonterminal) {
    if (record.state !== "pending" && record.state !== "active") {
      throw new Error("r8 durable ledger contains an unknown nonterminal state");
    }
    const owner = registeredRecords.get(record.record_id);
    if (!owner || !allowedPairIds.has(owner.pairId)) {
      throw new Error("r8 durable ledger contains an unrelated nonterminal record");
    }
    if (
      record.run_id !== `${manifest.run_id}:${owner.pairId}` ||
      record.manifest_sha256 !== manifestSha256 ||
      record.ownership_kind !== "generated-exact-name-v1" ||
      record.name_prefix !== manifest.pod.name_prefix ||
      !record.expected_name.startsWith(`${manifest.pod.name_prefix}-`) ||
      record.expected_name.toLowerCase().startsWith("storm-") ||
      (record.pod_id !== null && record.preexisting_ids.includes(record.pod_id))
    ) {
      throw new Error("r8 durable ledger contains ownership outside this exact activation");
    }
  }
  return {
    revision: ledger.revision,
    pending_record_id: pending.record_id,
    nonterminal_count: nonterminal.length,
  };
}

export async function executeAfterExactR8MutationBoundary(verifyBoundary, mutation) {
  if (typeof verifyBoundary !== "function" || typeof mutation !== "function") {
    throw new Error("exact r8 mutation boundary requires verifier and mutation functions");
  }
  await verifyBoundary();
  return mutation();
}

export async function executeAfterExactR9WorkerStartBoundary(
  verifyBoundary,
  stopRequested,
  registerPending,
) {
  if (
    typeof verifyBoundary !== "function" ||
    typeof stopRequested !== "function" ||
    typeof registerPending !== "function"
  ) {
    throw new Error("r9 worker-start boundary requires verifier, stop check, and pending registrar");
  }
  if (stopRequested()) throw new Error("fanout stopping before the r9 worker-start guard");
  const boundary = await verifyBoundary();
  if (stopRequested()) throw new Error("fanout stopping after the r9 worker-start guard");
  return registerPending(boundary);
}

export class R9PreProviderPostBoundaryError extends Error {
  constructor(boundaryError, blockResult, blockError) {
    const disposition = blockResult
      ? "pending record terminalized without provider call"
      : `pending record left for manual handling: ${blockError?.message || "block unavailable"}`;
    super(`r9 pre-provider boundary failed: ${boundaryError.message}; ${disposition}`, {
      cause: boundaryError,
    });
    this.name = "R9PreProviderPostBoundaryError";
    this.providerPostInvoked = false;
    this.pendingTerminalized = Boolean(blockResult);
    this.pendingManual = !blockResult;
    this.blockResult = blockResult;
    this.blockError = blockError ?? null;
  }
}

export async function executeAfterExactR9PrePostBoundary({
  verifyBoundary,
  stopRequested,
  blockPending,
  providerPost,
}) {
  if (
    typeof verifyBoundary !== "function" ||
    typeof stopRequested !== "function" ||
    typeof blockPending !== "function" ||
    typeof providerPost !== "function"
  ) {
    throw new Error("r9 pre-provider boundary requires verifier, stop check, blocker, and provider callback");
  }
  let boundaryError = null;
  try {
    await verifyBoundary();
    if (stopRequested()) throw new Error("fanout stopping at the exact pre-provider boundary");
  } catch (error) {
    boundaryError = error;
  }
  if (boundaryError) {
    let blockResult = null;
    let blockError = null;
    try {
      blockResult = await blockPending();
    } catch (error) {
      blockError = error;
    }
    throw new R9PreProviderPostBoundaryError(boundaryError, blockResult, blockError);
  }
  return providerPost();
}

export function createFanoutLedgerMutationCoordinator({
  expectedReaperPid,
  retryDelaysMs = [0, 100, 250, 500, 1_000, 2_000, 4_000],
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (
    !Number.isSafeInteger(expectedReaperPid) ||
    expectedReaperPid < 1 ||
    expectedReaperPid === process.pid ||
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.length < 1 ||
    retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
  ) {
    throw new Error("ledger mutation coordinator requires a distinct exact reaper PID and bounded delays");
  }
  let tail = Promise.resolve();
  const runExclusive = async (operation) => {
    if (typeof operation !== "function") throw new Error("ledger mutation operation must be a function");
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const retryExactServiceLock = async (operation) => {
    if (typeof operation !== "function") throw new Error("ledger retry operation must be a function");
    let lastError;
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      if (attempt > 0) await sleep(retryDelaysMs[attempt]);
      try {
        return await operation(attempt + 1);
      } catch (error) {
        if (!(error instanceof ReaperLedgerLockedError) || error.ownerPid !== expectedReaperPid) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  };
  return Object.freeze({ runExclusive, retryExactServiceLock, expectedReaperPid });
}

export async function runR9SerializedCreateTransaction({
  ledgerMutationCoordinator,
  stopState,
  executor,
  operation,
}) {
  if (
    !ledgerMutationCoordinator ||
    typeof ledgerMutationCoordinator.runExclusive !== "function" ||
    !isObject(stopState) ||
    !executor ||
    typeof executor.stop !== "function" ||
    typeof operation !== "function"
  ) {
    throw new Error("r9 serialized create transaction requires coordinator, stop latch, executor, and operation");
  }
  return ledgerMutationCoordinator.runExclusive(async () => {
    try {
      return await operation();
    } catch (error) {
      stopState.requested = true;
      executor.stop();
      throw error;
    }
  });
}

export function buildPodCreateArgs(manifest, expectedName, controlSecret = null) {
  assertString(expectedName, "exact reaper-owned pod name", /^[a-z0-9][a-z0-9-]{2,62}$/);
  if (!expectedName.startsWith(`${manifest.pod.name_prefix}-`) || expectedName.startsWith("storm-")) {
    throw new Error("pod name is not in the exact reaper-owned Mickey namespace");
  }
  if (controlSecret !== null) assertString(controlSecret, "runtime pod control secret", SHA256);
  const args = [
    "pod",
    "create",
    "--compute-type",
    "CPU",
    "--image",
    manifest.pod.image,
    "--name",
    expectedName,
    "--cpu-flavor-id",
    manifest.pod.cpu_flavor_ids[0],
    "--cpu-flavor-id",
    manifest.pod.cpu_flavor_ids[1],
    "--vcpu-count",
    String(manifest.pod.vcpu_count),
    "--max-cost-per-hour",
    manifest.pod.max_cost_per_hour.toFixed(2),
    "--container-disk-in-gb",
    "20",
    "--volume-in-gb",
    "0",
    "--cloud-type",
    manifest.pod.cloud_type,
    "--public-ip",
    "--ports",
    "22/tcp",
  ];
  if (controlSecret !== null) {
    args.push("--env-stdin");
  }
  args.push(
    "-o",
    "json",
  );
  return args;
}

function validateNetworkVolumeObservation(observation, label) {
  if (!isObject(observation) || typeof observation.present !== "boolean") {
    throw new Error(`created pod ${label} inspection is malformed`);
  }
  const expectedKeys = observation.present ? ["present", "value"] : ["present"];
  const actualKeys = Object.keys(observation).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`created pod ${label} inspection is malformed`);
  }
  return observation;
}

export function validateCreatedPod(
  record,
  {
    expectedName,
    preexistingIds,
    maxCost = 0.1,
    requireNetworkVolumeInspection = false,
    createRequestAttestation = null,
    returnAttestation = false,
  },
) {
  if (!isObject(record)) throw new Error("RunPod create response must be an object");
  assertString(record.id, "created pod id", /^[a-zA-Z0-9][a-zA-Z0-9-]{2,79}$/);
  if (preexistingIds.has(record.id)) {
    throw new Error(`RunPod returned pre-existing pod ID ${record.id}; refusing reuse or cleanup`);
  }
  if (record.name !== expectedName || record.name.startsWith("storm-")) {
    throw new Error("created pod name is not the exact Mickey fanout name");
  }
  if (record.gpuCount !== 0) throw new Error("created pod gpuCount must be zero");
  const costPerHr = typeof record.costPerHr === "string" ? Number(record.costPerHr) : record.costPerHr;
  assertFinite(costPerHr, "created pod costPerHr", 0, maxCost);
  if (record.containerDiskInGb !== 20) throw new Error("created pod must have exactly 20GB container disk");
  if (record.volumeInGb !== 0) throw new Error("created pod must have zero persistent volume");
  if (record.vcpuCount !== 2 || record.memoryInGb !== 4) {
    throw new Error("created pod must have exactly 2 vCPU and 4GB memory");
  }
  for (const key of ["networkVolumeId", "networkVolume", "networkVolumes"]) {
    if (Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined) {
      if (!(Array.isArray(record[key]) && record[key].length === 0)) {
        throw new Error(`created pod unexpectedly has ${key}`);
      }
    }
  }
  let networkVolumeAttestation = null;
  if (requireNetworkVolumeInspection) {
    const inspection = record.networkVolumeInspection;
    const inspectionKeys = isObject(inspection) ? Object.keys(inspection).sort() : [];
    if (
      !isObject(inspection) ||
      inspection.includeNetworkVolumeRequested !== true ||
      inspectionKeys.join(",") !==
        "includeNetworkVolumeRequested,networkVolume,networkVolumeId"
    ) {
      throw new Error("created pod lacks explicit network-volume inspection");
    }
    const idObservation = validateNetworkVolumeObservation(
      inspection.networkVolumeId,
      "networkVolumeId",
    );
    const volumeObservation = validateNetworkVolumeObservation(
      inspection.networkVolume,
      "networkVolume",
    );
    const observations = [idObservation, volumeObservation].filter((entry) => entry.present === true);
    if (observations.length === 0) {
      // RunPod's includeNetworkVolume response may omit both optional fields
      // when none is attached. Accept that shape only when it is bound back to
      // the already-validated zero-volume create request.
      if (
        !isObject(createRequestAttestation) ||
        !SHA256.test(createRequestAttestation.request_input_sha256 ?? "") ||
        createRequestAttestation.request_input_sha256 !== record.requestInputSha256 ||
        createRequestAttestation.request_input_hash_scope !== RUNPODCTL_REQUEST_HASH_SCOPE ||
        createRequestAttestation.request_input_redaction_schema !==
          RUNPODCTL_ENV_REDACTION_SCHEMA ||
        createRequestAttestation.requested_volume_gb !== 0 ||
        createRequestAttestation.network_volume_id_supplied !== false ||
        createRequestAttestation.network_volume_request !== "none" ||
        !isObject(record.requestInput) ||
        record.requestInput.volumeInGb !== 0 ||
        Object.hasOwn(record.requestInput, "networkVolumeId")
      ) {
        throw new Error("RunPod omitted network-volume fields without exact zero-volume create proof");
      }
    }
    if (idObservation.present === true && idObservation.value !== null && idObservation.value !== "") {
      throw new Error("created pod has a networkVolumeId");
    }
    if (volumeObservation.present === true && volumeObservation.value !== null) {
      throw new Error("created pod has an attached networkVolume");
    }
    networkVolumeAttestation = {
      status: observations.length === 0 ? "omitted_when_none" : "explicit_none",
      include_network_volume_requested: true,
      network_volume_id_present: idObservation.present,
      network_volume_present: volumeObservation.present,
      network_volume_attached: false,
      request_input_sha256: createRequestAttestation?.request_input_sha256 ?? null,
      requested_volume_gb: createRequestAttestation?.requested_volume_gb ?? null,
      network_volume_id_supplied:
        createRequestAttestation?.network_volume_id_supplied ?? null,
    };
  }
  if (returnAttestation) {
    return { pod_id: record.id, network_volume_attestation: networkVolumeAttestation };
  }
  return record.id;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]),
  );
}

export function canonicalRequestInputSha256(value) {
  return createHash("sha256").update(JSON.stringify(sortedJsonValue(value)), "utf8").digest("hex");
}

export function validateCreateRequestAttestation(
  record,
  { manifest, expectedName, controlSecret = null },
) {
  if (controlSecret !== null) assertString(controlSecret, "runtime pod control secret", SHA256);
  if (!isObject(record)) throw new Error("RunPod create response must be an object");
  if (
    record.transport !== "rest-v1" ||
    record.validationPassed !== true ||
    record.cleanupAttempted !== false ||
    record.cleanupSucceeded !== false ||
    Number(record.clientMaxCostPerHour) !== manifest.pod.max_cost_per_hour
  ) {
    throw new Error("RunPod create response does not prove a clean bounded REST create");
  }
  if (record.requestInputHashAlgorithm !== RUNPODCTL_REQUEST_HASH_ALGORITHM) {
    throw new Error("RunPod create response uses an unapproved request-input hash algorithm");
  }
  if (
    record.requestInputHashScope !== RUNPODCTL_REQUEST_HASH_SCOPE ||
    record.requestInputRedactionSchema !== RUNPODCTL_ENV_REDACTION_SCHEMA ||
    record.responseEnvRedactionSchema !== RUNPODCTL_ENV_REDACTION_SCHEMA ||
    record.redactedEnvValueMarker !== RUNPODCTL_REDACTED_ENV_VALUE
  ) {
    throw new Error("RunPod create response has an unapproved request/response redaction contract");
  }
  assertString(record.requestInputSha256, "RunPod requestInputSha256", SHA256);
  const expectedRaw = {
    cloudType: manifest.pod.cloud_type,
    computeType: manifest.pod.compute_type,
    containerDiskInGb: manifest.pod.container_disk_gb,
    cpuFlavorIds: manifest.pod.cpu_flavor_ids,
    cpuFlavorPriority: manifest.pod.cpu_flavor_priority,
    imageName: manifest.pod.image,
    name: expectedName,
    ports: manifest.pod.ports,
    supportPublicIp: true,
    vcpuCount: manifest.pod.vcpu_count,
    volumeInGb: manifest.pod.volume_gb,
    volumeMountPath: "/workspace",
  };
  if (controlSecret !== null) {
    expectedRaw.env = { MICKEY_CONTROL_PLANE_NONCE: controlSecret };
  }
  if (record.requestInputSha256 !== canonicalRequestInputSha256(expectedRaw)) {
    throw new Error("RunPod create raw pre-redaction request-input SHA-256 is invalid");
  }
  const expectedEcho = structuredClone(expectedRaw);
  if (controlSecret !== null) {
    expectedEcho.env = {
      redacted: true,
      schema: RUNPODCTL_ENV_REDACTION_SCHEMA,
    };
  }
  if (
    record.requestInputRedacted !== (controlSecret !== null) ||
    JSON.stringify(sortedJsonValue(record.requestInput)) !== JSON.stringify(sortedJsonValue(expectedEcho))
  ) {
    throw new Error("RunPod create redacted request echo differs from the exact CPU/SSH/ephemeral-volume REST contract");
  }
  for (const forbidden of ["terminateAfter", "stopAfter", "deployCost", "maxCostPerHour", "networkVolumeId", "startSsh"]) {
    if (Object.hasOwn(record.requestInput, forbidden)) {
      throw new Error(`RunPod REST request must not contain ${forbidden}`);
    }
  }
  const responseEnv = isObject(record.env) ? record.env : null;
  const responseEnvKeys = responseEnv ? Object.keys(responseEnv) : [];
  if (responseEnvKeys.length === 0) {
    if (record.responseEnvRedacted !== false) {
      throw new Error("RunPod response env redaction flag is inconsistent with an absent env");
    }
  } else {
    if (
      record.responseEnvRedacted !== true ||
      responseEnvKeys.sort().join(",") !== "redacted,schema" ||
      responseEnv.redacted !== true ||
      responseEnv.schema !== RUNPODCTL_ENV_REDACTION_SCHEMA
    ) {
      throw new Error("RunPod create response contains an unexpected or unredacted env");
    }
  }
  if (
    typeof record.responseControlSecretScrubbed !== "boolean" ||
    record.providerIdentityContaminated !== false ||
    record.reconciliationRequired !== false ||
    (
      controlSecret === null &&
      record.responseControlSecretScrubbed !== record.responseEnvRedacted
    )
  ) {
    throw new Error("RunPod create response does not satisfy the response-wide scrub and identity contract");
  }
  if (
    controlSecret !== null &&
    JSON.stringify(record).toLowerCase().includes(controlSecret.toLowerCase())
  ) {
    throw new Error("RunPod create receipt leaked the runtime control nonce");
  }
  return {
    request_input_sha256: record.requestInputSha256,
    request_input_hash_scope: record.requestInputHashScope,
    request_input_redaction_schema: record.requestInputRedactionSchema,
    response_env_redacted: record.responseEnvRedacted,
    response_control_secret_scrubbed: record.responseControlSecretScrubbed,
    provider_identity_contaminated: false,
    reconciliation_required: false,
    transport: record.transport,
    client_max_cost_per_hour: Number(record.clientMaxCostPerHour),
    provider_ttl: null,
    requested_volume_gb: expectedRaw.volumeInGb,
    network_volume_id_supplied: Object.hasOwn(expectedRaw, "networkVolumeId"),
    network_volume_request: "none",
  };
}

export function registerCreatedPod(record, expectedName, preexistingIds, createdIds) {
  void expectedName;
  if (!isObject(record)) throw new Error("RunPod create response must be an object");
  assertString(record.id, "created pod id", /^[a-zA-Z0-9][a-zA-Z0-9-]{2,79}$/);
  const id = record.id;
  if (preexistingIds.has(id)) {
    throw new Error(`RunPod returned pre-existing pod ID ${id}; refusing reuse or cleanup`);
  }
  if (createdIds.has(id)) throw new Error(`RunPod returned duplicate new pod ID ${id}`);
  // Ownership is recorded before any name, shape, price, or volume assertion.
  // If a post-create attestation fails, final cleanup still owns only this
  // exact new ID and can never fall back to a name or prefix deletion.
  createdIds.add(id);
  return id;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }
}

export function sanitizePodInventory(records) {
  if (!Array.isArray(records)) throw new Error("provider pod inventory must be an array");
  const sanitized = records.map((record, index) => {
    if (!isObject(record)) throw new Error(`provider pod inventory[${index}] must be an object`);
    assertString(record.id, `provider pod inventory[${index}].id`, /^[A-Za-z0-9_-]+$/);
    assertString(
      record.name,
      `provider pod inventory[${index}].name`,
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    );
    if (record.id.length > 256 || record.name.length > 256) {
      throw new Error(`provider pod inventory[${index}] identity is too long`);
    }
    return {
      id: record.id,
      name: record.name,
    };
  });
  const ids = new Set();
  for (const record of sanitized) {
    if (ids.has(record.id)) throw new Error(`provider pod inventory repeats ID ${record.id}`);
    ids.add(record.id);
  }
  return sanitized.sort((left, right) => left.id.localeCompare(right.id));
}

export async function discoverNewExactNamePods({
  runpodctl,
  expectedName,
  preexistingIds,
  createdIds,
  executor,
  label,
}) {
  const result = await executor.run(
    runpodctl,
    ["pod", "list", "--name", expectedName, "-a", "-o", "json"],
    {
      label,
      allowFailure: true,
      allowWhenStopping: true,
      outputLogMode: "metadata-only",
    },
  );
  if (result.code !== 0) {
    throw new Error(`indeterminate create reconciliation failed with status ${result.code}`);
  }
  const listed = parseJsonOutput(result, "indeterminate create reconciliation");
  if (!Array.isArray(listed)) throw new Error("indeterminate create reconciliation did not return an array");
  const claimed = [];
  for (const record of listed) {
    if (!isObject(record) || record.name !== expectedName || preexistingIds.has(record.id)) continue;
    const id = registerCreatedPod(record, expectedName, preexistingIds, createdIds);
    claimed.push(id);
  }
  if (claimed.length === 0) {
    throw new Error("create result was indeterminate and no exact-name new pod could be cleanup-claimed");
  }
  return claimed;
}

function remoteQuote(value) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("invalid remote shell value");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export class CommandExecutor {
  constructor(logRoot) {
    this.logRoot = logRoot;
    this.sequence = 0;
    this.children = new Set();
    this.stopping = false;
  }

  stop() {
    this.stopping = true;
    for (const child of this.children) child.kill("SIGTERM");
  }

  async run(
    command,
    args,
    {
      label = "command",
      allowFailure = false,
      allowWhenStopping = false,
      cwd = undefined,
      redactions = [],
      outputLogMode = "full",
      stdinBytes = null,
      sensitiveOutputToken = null,
    } = {},
  ) {
    if (this.stopping && !allowWhenStopping) throw new Error("fanout stopping before command launch");
    const sequence = String(++this.sequence).padStart(4, "0");
    const safeLabel = label.replaceAll(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
    const base = path.join(this.logRoot, `${sequence}-${safeLabel}`);
    if (!Array.isArray(redactions) || redactions.some((value) => typeof value !== "string" || value.length < 16)) {
      throw new Error("command log redactions must be an array of nontrivial strings");
    }
    if (!["full", "metadata-only"].includes(outputLogMode)) {
      throw new Error("command output log mode must be full or metadata-only");
    }
    if (
      stdinBytes !== null &&
      (!Buffer.isBuffer(stdinBytes) || stdinBytes.length < 1 || stdinBytes.length > 1_024)
    ) {
      throw new Error("command stdin must be a nonempty Buffer no larger than 1024 bytes");
    }
    if (
      sensitiveOutputToken !== null &&
      (typeof sensitiveOutputToken !== "string" || !SHA256.test(sensitiveOutputToken))
    ) {
      throw new Error("sensitive output token must be 64 lowercase hex characters");
    }
    const childEnvironment = { ...process.env };
    if (sensitiveOutputToken !== null) {
      const loweredToken = sensitiveOutputToken.toLowerCase();
      const serializedArgv = JSON.stringify([command, ...args]).toLowerCase();
      const serializedEnvironment = JSON.stringify(childEnvironment).toLowerCase();
      const expectedStdin = Buffer.from(
        JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: sensitiveOutputToken }),
        "utf8",
      );
      const stdinMatches =
        stdinBytes !== null &&
        stdinBytes.length === expectedStdin.length &&
        timingSafeEqual(stdinBytes, expectedStdin);
      expectedStdin.fill(0);
      if (
        !stdinMatches ||
        !args.includes("--env-stdin") ||
        args.includes("--env") ||
        serializedArgv.includes(loweredToken) ||
        serializedEnvironment.includes(loweredToken)
      ) {
        throw new Error("sensitive stdin command contract rejected");
      }
    }
    const redact = (value) => redactions.reduce((current, sensitive) => {
      const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return current.replace(new RegExp(escaped, "gi"), "[REDACTED]");
    }, value);
    const loggedArgs = args.map((value) => redact(value));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: childEnvironment,
        stdio: [stdinBytes === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
      this.children.add(child);
      const stdout = [];
      const stderr = [];
      let bytes = 0;
      const capture = (target) => (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) child.kill("SIGTERM");
        else target.push(chunk);
      };
      child.stdout.on("data", capture(stdout));
      child.stderr.on("data", capture(stderr));
      if (stdinBytes !== null) {
        child.stdin.on("error", () => {});
        child.stdin.end(stdinBytes);
      }
      child.once("error", reject);
      child.once("close", (code, signal) => {
        this.children.delete(child);
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
    if (sensitiveOutputToken !== null) {
      const loweredToken = sensitiveOutputToken.toLowerCase();
      if (
        result.stdout.toLowerCase().includes(loweredToken) ||
        result.stderr.toLowerCase().includes(loweredToken)
      ) {
        result.stdout = "";
        result.stderr = "";
        throw new Error("sensitive child output rejected");
      }
    }
    await writeFile(
      `${base}.argv.json.part`,
      `${JSON.stringify({
        command,
        args: loggedArgs,
        redaction_count: redactions.length,
        stdin_provided: stdinBytes !== null,
        stdin_byte_count: stdinBytes?.length ?? 0,
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(`${base}.argv.json.part`, `${base}.argv.json`);
    const loggedStdout = outputLogMode === "metadata-only"
      ? `${JSON.stringify({ content_omitted: true, byte_count: Buffer.byteLength(result.stdout) })}\n`
      : redact(result.stdout);
    const loggedStderr = outputLogMode === "metadata-only"
      ? `${JSON.stringify({ content_omitted: true, byte_count: Buffer.byteLength(result.stderr) })}\n`
      : redact(result.stderr);
    await writeFile(`${base}.stdout.log.part`, loggedStdout, { mode: 0o600 });
    await rename(`${base}.stdout.log.part`, `${base}.stdout.log`);
    await writeFile(`${base}.stderr.log.part`, loggedStderr, { mode: 0o600 });
    await rename(`${base}.stderr.log.part`, `${base}.stderr.log`);
    if (!allowFailure && result.code !== 0) {
      throw new Error(`${label} failed with status ${result.code}${result.signal ? ` signal ${result.signal}` : ""}`);
    }
    return result;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.part-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

let eventAppendTail = Promise.resolve();

export function appendEvent(output, event, detail = {}) {
  const operation = eventAppendTail.then(async () => {
    const entry = {
      timestamp: new Date().toISOString(),
      component: "mickey-cpu-fanout",
      event,
      ...detail,
    };
    const eventPath = path.join(output, "evidence", "events.jsonl");
    const prior = await readFile(eventPath, "utf8").catch(() => "");
    const temporary = `${eventPath}.part-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, `${prior}${JSON.stringify(entry)}\n`, { mode: 0o600 });
    await rename(temporary, eventPath);
  });
  eventAppendTail = operation.catch(() => {});
  return operation;
}

async function readSecureRunnerStateFile(lockRoot, name, { allowEmpty = false } = {}) {
  const filePath = path.join(lockRoot, name);
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`runner state ${name} is missing or unsafe`);
  if (await realpath(filePath) !== filePath) throw new Error(`runner state ${name} must already be canonical`);
  if ((info.mode & 0o077) !== 0) throw new Error(`runner state ${name} permissions are too broad`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(`runner state ${name} is not owned by this operator`);
  }
  const body = await readFile(filePath, "utf8");
  if (body.includes("\0") || (!allowEmpty && body.length === 0)) {
    throw new Error(`runner state ${name} has invalid contents`);
  }
  return body;
}

function oneLine(body, label) {
  if (!body.endsWith("\n") || body.slice(0, -1).includes("\n")) {
    throw new Error(`${label} must contain exactly one newline-terminated line`);
  }
  return body.slice(0, -1);
}

function runnerClaimDigest(token, output, device, inode) {
  return createHash("sha256")
    .update(token, "utf8")
    .update("\0", "utf8")
    .update(output, "utf8")
    .update("\0", "utf8")
    .update(device, "utf8")
    .update("\0", "utf8")
    .update(inode, "utf8")
    .digest("hex");
}

export async function validateClaimedOutputShape(output, runId, stateRoot = RUNNER_STATE_ROOT) {
  assertAbsoluteFilePath(output, "--output");
  if (stateRoot !== RUNNER_STATE_ROOT) throw new Error("runner state root is not the pinned local operator root");
  const stateRootInfo = await lstat(stateRoot).catch(() => null);
  if (!stateRootInfo?.isDirectory() || stateRootInfo.isSymbolicLink() || await realpath(stateRoot) !== stateRoot) {
    throw new Error("runner state root is missing or unsafe");
  }
  if (typeof process.getuid === "function" && stateRootInfo.uid !== process.getuid()) {
    throw new Error("runner state root is not owned by this operator");
  }
  const lockRoot = path.join(stateRoot, "runner.lock");
  const lockInfo = await lstat(lockRoot).catch(() => null);
  if (
    !lockInfo?.isDirectory() ||
    lockInfo.isSymbolicLink() ||
    await realpath(lockRoot) !== lockRoot ||
    (lockInfo.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && lockInfo.uid !== process.getuid())
  ) {
    throw new Error("active runner lock is missing or unsafe");
  }
  const info = await lstat(output).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error("--output must be the runner-claimed directory");
  if (await realpath(output) !== output) throw new Error("--output must already be canonical");
  const markerPath = path.join(output, ".proxywar-runner-claim");
  const markerInfo = await lstat(markerPath).catch(() => null);
  if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) throw new Error("runner claim marker is missing or unsafe");
  if ((markerInfo.mode & 0o077) !== 0 || (typeof process.getuid === "function" && markerInfo.uid !== process.getuid())) {
    throw new Error("runner claim marker permissions or ownership are unsafe");
  }
  const body = await readFile(markerPath, "utf8");
  const fields = new Map();
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("runner claim marker contains an invalid line");
    const key = line.slice(0, separator);
    if (fields.has(key)) throw new Error("runner claim marker contains a duplicate field");
    fields.set(key, line.slice(separator + 1));
  }
  const expectedKeys = ["schema_version", "lane", "run_id", "claim_digest", "device", "inode", "path"];
  const device = String(info.dev);
  const inode = String(info.ino);
  const schemaVersion = oneLine(await readSecureRunnerStateFile(lockRoot, "schema_version"), "runner schema_version");
  const lane = oneLine(await readSecureRunnerStateFile(lockRoot, "owner"), "runner owner");
  const lockedRunId = oneLine(await readSecureRunnerStateFile(lockRoot, "run_id"), "runner run_id");
  const token = oneLine(await readSecureRunnerStateFile(lockRoot, "token"), "runner token");
  const outputs = await readSecureRunnerStateFile(lockRoot, "outputs");
  const outputClaims = await readSecureRunnerStateFile(lockRoot, "output_claims");
  await readSecureRunnerStateFile(lockRoot, "ready", { allowEmpty: true });
  if (
    schemaVersion !== "2" ||
    lane !== RUNNER_OPERATOR_LANE ||
    lockedRunId !== runId ||
    !/^[a-z0-9-]{16,128}$/.test(token) ||
    outputs !== `${output}\n` ||
    outputClaims !== `${output}\t${device}\t${inode}\n`
  ) {
    throw new Error("active runner state does not bind the exact output claim");
  }
  const expectedDigest = runnerClaimDigest(token, output, device, inode);
  if (
    fields.size !== expectedKeys.length ||
    expectedKeys.some((key) => !fields.has(key)) ||
    fields.get("schema_version") !== "1" ||
    fields.get("lane") !== RUNNER_OPERATOR_LANE ||
    fields.get("run_id") !== runId ||
    fields.get("path") !== output ||
    fields.get("claim_digest") !== expectedDigest ||
    fields.get("device") !== device ||
    fields.get("inode") !== inode
  ) {
    throw new Error("output is not claimed by the exact Mickey runner lease/run ID");
  }
  return Object.fromEntries(fields);
}

export async function verifyLiveReaperService({
  manifest,
  manifestSha256,
  executor,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
}) {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("cannot identify the launchd GUI domain owner");
  const receiptPath = manifest.cleanup_watchdog.service_receipt_path;
  const info = await lstat(receiptPath).catch(() => null);
  if (
    !info?.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o600 ||
    await realpath(receiptPath) !== receiptPath ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error("independent reaper service receipt is missing or unsafe");
  }
  const receiptBody = await readFile(receiptPath);
  const receiptSha256 = createHash("sha256").update(receiptBody).digest("hex");
  const receipt = JSON.parse(receiptBody.toString("utf8"));
  exactKeys(
    receipt,
    [
      "schema_version", "kind", "status", "manifest_sha256", "launchd_label",
      "launchd_domain", "plist_path", "plist_sha256", "ledger_path",
      "heartbeat_path", "runpodctl_sha256", "reaper_sha256", "node_path",
      "node_sha256", "pid", "attested_at",
    ],
    "reaper service receipt",
  );
  if (
    receipt.schema_version !== 1 ||
    receipt.kind !== "mickey_runpod_exact_id_reaper_service" ||
    receipt.status !== "active" ||
    receipt.manifest_sha256 !== manifestSha256 ||
    receipt.launchd_label !== manifest.cleanup_watchdog.launchd_label ||
    receipt.launchd_domain !== `gui/${uid}` ||
    receipt.ledger_path !== manifest.cleanup_watchdog.ledger_path ||
    receipt.heartbeat_path !== manifest.cleanup_watchdog.heartbeat_path ||
    receipt.runpodctl_sha256 !== manifest.runpodctl.sha256 ||
    receipt.reaper_sha256 !== manifest.cleanup_watchdog.script.sha256 ||
    receipt.node_path !== manifest.cleanup_watchdog.node_runtime.path ||
    receipt.node_sha256 !== manifest.cleanup_watchdog.node_runtime.sha256 ||
    !Number.isSafeInteger(receipt.pid) ||
    receipt.pid < 1 ||
    (
      manifest.schema_version === 5 &&
      receipt.plist_sha256 !== manifest.activation.persistent_reaper.plist_sha256
    ) ||
    !SHA256.test(receipt.plist_sha256 ?? "") ||
    receipt.plist_path !== manifest.cleanup_watchdog.plist_path ||
    !Number.isFinite(Date.parse(receipt.attested_at))
  ) {
    throw new Error("independent reaper service receipt does not bind the exact manifest tools and ledger");
  }
  await verifyHashedLocalFile(
    { path: receipt.plist_path, sha256: receipt.plist_sha256 },
    "active reaper LaunchAgent plist",
  );
  const service = await executor.run(
    "/bin/launchctl",
    ["print", `${receipt.launchd_domain}/${receipt.launchd_label}`],
    { label: "verify-independent-reaper-service", allowFailure: true },
  );
  const pidMatch = service.stdout.match(/(?:^|\n)\s*pid\s*=\s*([1-9][0-9]*)\s*(?:\n|$)/);
  if (
    service.code !== 0 ||
    !/(?:^|\n)\s*state\s*=\s*running\s*(?:\n|$)/.test(service.stdout) ||
    !pidMatch
  ) {
    throw new Error("independent reaper LaunchAgent is not running");
  }
  const servicePid = Number(pidMatch[1]);
  const servicePath = service.stdout.match(/(?:^|\n)\s*path\s*=\s*([^\n]+)\s*(?:\n|$)/)?.[1]?.trim();
  const serviceProgram = service.stdout.match(/(?:^|\n)\s*program\s*=\s*([^\n]+)\s*(?:\n|$)/)?.[1]?.trim();
  const argumentBlock = service.stdout.match(
    /(?:^|\n)\s*arguments\s*=\s*\{\n([\s\S]*?)\n\s*\}\s*(?:\n|$)/,
  )?.[1];
  const serviceArguments = argumentBlock
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const expectedArguments = [
    manifest.cleanup_watchdog.node_runtime.path,
    manifest.cleanup_watchdog.script.path,
    "poll",
    "--ledger",
    manifest.cleanup_watchdog.ledger_path,
    "--runpodctl",
    manifest.runpodctl.path,
    "--interval-seconds",
    String(manifest.cleanup_watchdog.poll_interval_seconds),
    "--heartbeat",
    manifest.cleanup_watchdog.heartbeat_path,
  ];
  if (
    servicePid !== receipt.pid ||
    servicePath !== manifest.cleanup_watchdog.plist_path ||
    serviceProgram !== manifest.cleanup_watchdog.node_runtime.path ||
    !equalJson(serviceArguments, expectedArguments)
  ) {
    throw new Error("independent reaper service PID differs from the attested receipt");
  }
  const watchdogRoot = path.dirname(manifest.cleanup_watchdog.ledger_path);
  const rootInfo = await lstat(watchdogRoot).catch(() => null);
  if (
    !rootInfo?.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (rootInfo.mode & 0o777) !== 0o700 ||
    await realpath(watchdogRoot) !== watchdogRoot ||
    (typeof process.getuid === "function" && rootInfo.uid !== process.getuid())
  ) {
    throw new Error("independent reaper state directory is missing or unsafe");
  }
  for (const [filePath, label] of [
    [manifest.cleanup_watchdog.ledger_path, "ledger"],
    [manifest.cleanup_watchdog.heartbeat_path, "heartbeat"],
  ]) {
    const fileInfo = await lstat(filePath).catch(() => null);
    if (
      !fileInfo?.isFile() ||
      fileInfo.isSymbolicLink() ||
      (fileInfo.mode & 0o777) !== 0o600 ||
      await realpath(filePath) !== filePath ||
      (typeof process.getuid === "function" && fileInfo.uid !== process.getuid())
    ) {
      throw new Error(`independent reaper ${label} is missing or unsafe`);
    }
  }
  const heartbeat = JSON.parse(await readFile(manifest.cleanup_watchdog.heartbeat_path, "utf8"));
  exactKeys(
    heartbeat,
    [
      "schema_version", "kind", "status", "probed_at", "pod_count", "ledger_path",
      "runpodctl_path", "pid", "identifiers_recorded", "credentials_recorded",
    ],
    "reaper provider heartbeat",
  );
  const heartbeatAgeMs = Date.now() - Date.parse(heartbeat.probed_at);
  if (
    heartbeat.schema_version !== 1 ||
    heartbeat.kind !== "mickey_runpod_exact_id_reaper_provider_heartbeat" ||
    heartbeat.status !== "provider_list_succeeded" ||
    !Number.isSafeInteger(heartbeat.pod_count) ||
    heartbeat.pod_count < 0 ||
    heartbeat.ledger_path !== manifest.cleanup_watchdog.ledger_path ||
    heartbeat.runpodctl_path !== manifest.runpodctl.path ||
    heartbeat.pid !== servicePid ||
    heartbeat.identifiers_recorded !== false ||
    heartbeat.credentials_recorded !== false ||
    !Number.isFinite(heartbeatAgeMs) ||
    heartbeatAgeMs < -5_000 ||
    heartbeatAgeMs > manifest.cleanup_watchdog.heartbeat_max_age_seconds * 1_000
  ) {
    throw new Error("independent reaper provider heartbeat is stale or does not bind the running service");
  }
  return {
    status: "active",
    label: receipt.launchd_label,
    domain: receipt.launchd_domain,
    pid: servicePid,
    ledger_path: receipt.ledger_path,
    receipt_path: receiptPath,
    receipt_sha256: receiptSha256,
    provider_probe: { status: heartbeat.status, pod_count: heartbeat.pod_count, age_ms: heartbeatAgeMs },
  };
}

export function validateFinalReaperServiceIdentity(initial, current) {
  if (
    !isObject(initial) ||
    !isObject(current) ||
    initial.status !== "active" ||
    current.status !== "active" ||
    !Number.isSafeInteger(initial.pid) ||
    initial.pid < 1 ||
    current.pid !== initial.pid ||
    !SHA256.test(initial.receipt_sha256 ?? "") ||
    current.receipt_sha256 !== initial.receipt_sha256 ||
    current.label !== initial.label ||
    current.domain !== initial.domain ||
    current.ledger_path !== initial.ledger_path ||
    current.receipt_path !== initial.receipt_path
  ) {
    throw new Error("independent reaper service identity drifted before final evidence gate");
  }
  return current;
}

export function validateMickeyRunnerStatus(status, output, runId, expectedChildPid = process.pid) {
  if (
    !isObject(status) ||
    status.schema_version !== 2 ||
    status.state !== "active" ||
    status.owner !== RUNNER_OPERATOR_LANE ||
    status.run_id !== runId ||
    status.child_pid !== expectedChildPid ||
    status.supervisor_alive !== true ||
    status.child_alive !== true ||
    status.reap_in_progress !== false ||
    !Array.isArray(status.outputs) ||
    status.outputs.length !== 1 ||
    status.outputs[0] !== output
  ) {
    throw new Error("exact Mickey foreground runner child is not active for its sole output");
  }
  return status;
}

export async function assertClaimedMickeyOutput(output, runId, runnerLease, stateRoot, executor) {
  await validateClaimedOutputShape(output, runId, stateRoot);
  const statusResult = await executor.run(runnerLease, ["status", "--json"], { label: "runner-status" });
  const status = parseJsonOutput(statusResult, "runner status");
  return validateMickeyRunnerStatus(status, output, runId);
}

export async function verifyR8LedgerQuiescent(manifest) {
  const ledger = await readReaperLedger(manifest.cleanup_watchdog.ledger_path);
  return manifest.schema_version === 5
    ? validateR9LedgerReady(ledger)
    : validateR8LedgerQuiescence(ledger);
}

export function validateR9WorkerStartLedgerBoundary({
  ledger,
  manifest,
  manifestSha256,
  pairId,
  registeredRecords,
}) {
  if (
    !isObject(ledger) ||
    !Array.isArray(ledger.records) ||
    manifest?.schema_version !== 5 ||
    manifest.run_id !== R9_ACTIVATION_RUN_ID ||
    !SHA256.test(manifestSha256 ?? "") ||
    !(registeredRecords instanceof Map)
  ) {
    throw new Error("r9 worker-start ledger boundary received an invalid activation context");
  }
  const allowedPairIds = new Set(
    manifest.arms.flatMap((arm) => arm.pairs.map((pair) => pair.id)),
  );
  if (!allowedPairIds.has(pairId)) {
    throw new Error("r9 worker-start ledger boundary received an unknown pair");
  }
  const recordIds = new Set();
  for (const record of ledger.records) {
    if (!isObject(record) || typeof record.record_id !== "string" || recordIds.has(record.record_id)) {
      throw new Error("r9 worker-start ledger contains a malformed or duplicate record");
    }
    recordIds.add(record.record_id);
  }
  const history = validateR9RecoveryHistory(ledger);
  const unknown = ledger.records.filter(
    (record) => !["pending", "active", "retired", "blocked"].includes(record.state),
  );
  if (unknown.length !== 0) {
    throw new Error("r9 worker-start ledger contains an unknown record state");
  }
  const nonterminal = ledger.records.filter(
    (record) => record.state === "pending" || record.state === "active",
  );
  if (nonterminal.length >= manifest.pod.max_concurrency) {
    throw new Error("r9 worker-start ledger has no capacity for another pending record");
  }
  const ownedPairs = new Set();
  for (const record of nonterminal) {
    const owner = registeredRecords.get(record.record_id);
    if (
      !owner ||
      !allowedPairIds.has(owner.pairId) ||
      ownedPairs.has(owner.pairId) ||
      owner.pairId === pairId ||
      record.run_id !== `${manifest.run_id}:${owner.pairId}` ||
      record.manifest_sha256 !== manifestSha256 ||
      record.ownership_kind !== "generated-exact-name-v1" ||
      record.name_prefix !== manifest.pod.name_prefix ||
      record.expected_name !== `${record.name_prefix}-${record.name_nonce}` ||
      !record.expected_name.startsWith(`${manifest.pod.name_prefix}-`) ||
      record.expected_name.toLowerCase().startsWith("storm-") ||
      (record.pod_id !== null && record.preexisting_ids.includes(record.pod_id))
    ) {
      throw new Error("r9 worker-start ledger contains ownership outside this exact process");
    }
    ownedPairs.add(owner.pairId);
  }
  return {
    revision: history.revision,
    next_pair_id: pairId,
    pending_count: history.pending_count,
    active_count: history.active_count,
    nonterminal_count: nonterminal.length,
    r8_recovery_record_id: history.r8_recovery_record_id,
  };
}

async function verifyExactR9ProcessBoundary({
  manifestPath,
  manifestSha256,
  output,
  pairId,
  executor,
  expectedReaperPid,
  expectedReaperReceiptSha256,
}) {
  if (
    manifestPath !== R9_ACTIVATION_MANIFEST_PATH ||
    output !== R9_ACTIVATION_OUTPUT_PATH ||
    !Number.isSafeInteger(expectedReaperPid) ||
    expectedReaperPid < 1 ||
    !SHA256.test(expectedReaperReceiptSha256 ?? "")
  ) {
    throw new Error("r9 process boundary is not bound to the exact activation process");
  }
  const current = await preflightManifest(
    manifestPath,
    manifestSha256,
    { requirePersistentServiceArtifacts: true },
  );
  if (
    !isFullFanoutLiveApproved(current) ||
    current.document.activation.resume_allowed !== false ||
    current.document.activation.output_path !== output ||
    current.pairs.filter(({ pair }) => pair.id === pairId).length !== 1
  ) {
    throw new Error("exact r9 activation drifted at a provider mutation boundary");
  }
  const runner = await assertClaimedMickeyOutput(
    output,
    current.document.run_id,
    current.document.runner_lease.path,
    current.document.runner_lease.state_root,
    executor,
  );
  const reaper = await verifyLiveReaperService({
    manifest: current.document,
    manifestSha256: current.manifestSha256,
    executor,
  });
  if (
    reaper.pid !== expectedReaperPid ||
    reaper.receipt_sha256 !== expectedReaperReceiptSha256
  ) {
    throw new Error("independent reaper PID or service receipt changed before provider mutation");
  }
  return { current, runner, reaper };
}

export async function verifyExactR9WorkerStartBoundary({
  manifestPath,
  manifestSha256,
  output,
  pairId,
  registeredRecords,
  executor,
  expectedReaperPid,
  expectedReaperReceiptSha256,
}) {
  const { current, runner, reaper } = await verifyExactR9ProcessBoundary({
    manifestPath,
    manifestSha256,
    output,
    pairId,
    executor,
    expectedReaperPid,
    expectedReaperReceiptSha256,
  });
  const ledger = await readReaperLedger(current.document.cleanup_watchdog.ledger_path);
  const ledgerBoundary = validateR9WorkerStartLedgerBoundary({
    ledger,
    manifest: current.document,
    manifestSha256: current.manifestSha256,
    pairId,
    registeredRecords,
  });
  return {
    manifest_sha256: current.manifestSha256,
    runner_child_pid: runner.child_pid,
    reaper_pid: reaper.pid,
    reaper_receipt_sha256: reaper.receipt_sha256,
    ledger_revision: ledgerBoundary.revision,
    ledger_digest_sha256: reaperLedgerDigest(ledger),
    ledger_nonterminal_count: ledgerBoundary.nonterminal_count,
    next_pair_id: ledgerBoundary.next_pair_id,
  };
}

export async function verifyExactR8MutationBoundary({
  manifestPath,
  manifestSha256,
  output,
  pairId,
  pendingOwnership,
  registeredRecords,
  executor,
  expectedReaperPid,
  expectedReaperReceiptSha256,
}) {
  const { current, runner, reaper } = await verifyExactR9ProcessBoundary({
    manifestPath,
    manifestSha256,
    output,
    pairId,
    executor,
    expectedReaperPid,
    expectedReaperReceiptSha256,
  });
  const ledger = await readReaperLedger(current.document.cleanup_watchdog.ledger_path);
  const ledgerBoundary = validateR8MutationLedgerBoundary({
    ledger,
    manifest: current.document,
    manifestSha256: current.manifestSha256,
    pairId,
    pendingOwnership,
    registeredRecords,
  });
  return {
    manifest_sha256: current.manifestSha256,
    runner_child_pid: runner.child_pid,
    reaper_pid: reaper.pid,
    reaper_receipt_sha256: reaper.receipt_sha256,
    ledger_revision: ledgerBoundary.revision,
    ledger_nonterminal_count: ledgerBoundary.nonterminal_count,
    pending_record_id: ledgerBoundary.pending_record_id,
  };
}

function pairContract(preflight, arm, pair) {
  return {
    schema_version: 1,
    manifest_sha256: preflight.manifestSha256,
    run_id: preflight.document.run_id,
    arm_id: arm.id,
    mechanism_class: arm.mechanism_class,
    roster_class: arm.roster_class,
    shared_files: arm.shared_files,
    candidate: arm.candidate,
    m0: arm.m0,
    fixture: {
      pair_id: pair.id,
      map: pair.map,
      seed: pair.seed,
      seat: pair.seat,
      max_decision_steps: pair.max_decision_steps,
      roster: pair.roster,
      candidate_spec: pair.candidate_spec,
      m0_spec: pair.m0_spec,
      order: pair.order,
      order_draw_sha256: pair.order_draw_sha256,
    },
    gates: arm.gates,
    promotion_gates: preflight.document.promotion_gates,
  };
}

function sshArgs(info, knownHosts, { bootstrap = false } = {}) {
  return [
    "-i", info.ssh_key.path,
    "-p", String(info.port),
    "-o", "BatchMode=yes",
    "-o", `StrictHostKeyChecking=${bootstrap ? "accept-new" : "yes"}`,
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=9",
  ];
}

function scpArgs(info, knownHosts) {
  return [
    "-i", info.ssh_key.path,
    "-P", String(info.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=9",
  ];
}

export async function prepareKnownHostsFile(knownHosts) {
  await writeFile(knownHosts, "", { flag: "wx", mode: 0o600 });
  const info = await lstat(knownHosts).catch(() => null);
  if (
    !info?.isFile() ||
    info.isSymbolicLink() ||
    await realpath(knownHosts) !== knownHosts ||
    (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error("SSH known_hosts bootstrap file is unsafe");
  }
  return knownHosts;
}

export function validateSshInfo(info, expectedPodId, expectedName) {
  if (
    !isObject(info) ||
    info.id !== expectedPodId ||
    info.name !== expectedName ||
    typeof info.ip !== "string" ||
    !/^[a-zA-Z0-9.:-]+$/.test(info.ip) ||
    !Number.isInteger(info.port) ||
    info.port < 1 ||
    info.port > 65535 ||
    !isObject(info.ssh_key) ||
    typeof info.ssh_key.path !== "string" ||
    !path.isAbsolute(info.ssh_key.path) ||
    info.ssh_key.exists !== true ||
    info.ssh_key.source !== "runpodctl doctor" ||
    info.ssh_key.in_account !== true ||
    typeof info.ssh_key.fingerprint !== "string" ||
    !/^SHA256:[A-Za-z0-9+/]{43}$/.test(info.ssh_key.fingerprint)
  ) {
    throw new Error("runpodctl ssh info returned an unsafe or incomplete record");
  }
  return info;
}

export function parseSshKeygenFingerprint(stdout) {
  if (typeof stdout !== "string") throw new Error("ssh-keygen output must be text");
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error("known_hosts must contain exactly one negotiated host key");
  const match = lines[0].match(/^256 (SHA256:[A-Za-z0-9+/]{43}) .+ \(ED25519\)$/);
  if (!match) throw new Error("known_hosts does not contain one ED25519 SHA-256 fingerprint");
  return match[1];
}

function sshHostKeyHmacMessage(fingerprint) {
  return `${SSH_HOST_KEY_ATTESTATION_DOMAIN}\n${fingerprint}\n`;
}

export function validateSshHostKeyAttestation(challenge, knownHostsFingerprint, controlSecret) {
  if (!isObject(challenge)) throw new Error("SSH host-key attestation must be an object");
  exactKeys(challenge, ["schema_version", "fingerprint", "hmac_sha256"], "SSH host-key attestation");
  assertString(controlSecret, "SSH runtime control secret", SHA256);
  assertString(knownHostsFingerprint, "known_hosts fingerprint", /^SHA256:[A-Za-z0-9+/]{43}$/);
  if (
    challenge.schema_version !== 1 ||
    challenge.fingerprint !== knownHostsFingerprint ||
    !SHA256.test(challenge.hmac_sha256 ?? "")
  ) {
    throw new Error("SSH endpoint host key is not bound to the RunPod control-plane nonce");
  }
  const expected = createHmac("sha256", Buffer.from(controlSecret, "hex"))
    .update(sshHostKeyHmacMessage(knownHostsFingerprint), "utf8")
    .digest();
  const actual = Buffer.from(challenge.hmac_sha256, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("SSH host-key attestation HMAC is invalid");
  }
  return {
    schema_version: 1,
    method: "runpod-control-plane-hmac-host-key-v1",
    fingerprint: knownHostsFingerprint,
    hmac_sha256: challenge.hmac_sha256,
  };
}

function remoteSshHostKeyAttestationCommand() {
  const code = [
    "import hashlib,hmac,json,subprocess",
    "parts=subprocess.check_output(['ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub','-E','sha256'],text=True).split()",
    "assert len(parts)>=2 and parts[0]=='256' and parts[1].startswith('SHA256:')",
    "fingerprint=parts[1]",
    `message=${JSON.stringify(`${SSH_HOST_KEY_ATTESTATION_DOMAIN}\n`)}+fingerprint+'\\n'`,
    "pid1=dict(item.split(b'=',1) for item in open('/proc/1/environ','rb').read().split(b'\\0') if b'=' in item)",
    "key=bytes.fromhex(pid1[b'MICKEY_CONTROL_PLANE_NONCE'].decode())",
    "digest=hmac.new(key,message.encode(),hashlib.sha256).hexdigest()",
    "print(json.dumps({'schema_version':1,'fingerprint':fingerprint,'hmac_sha256':digest},separators=(',',':')))",
  ].join(";");
  return `python3 -c ${remoteQuote(code)}`;
}

async function delay(milliseconds, stopState) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (stopState.requested) throw new Error(`fanout interrupted by ${stopState.signal ?? "failure"}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
}

async function waitForSsh(runpodctl, podId, expectedName, executor, stopState, label) {
  let last = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (stopState.requested) throw new Error("fanout stopping during SSH readiness");
    const result = await executor.run(
      runpodctl,
      ["ssh", "info", podId, "-o", "json"],
      {
        label: `${label}-ssh-info-${attempt}`,
        allowFailure: true,
        outputLogMode: "metadata-only",
      },
    );
    last = result;
    if (result.code === 0) {
      try {
        return validateSshInfo(JSON.parse(result.stdout), podId, expectedName);
      } catch {
        // Keep polling until the full identity is available.
      }
    }
    await delay(5_000, stopState);
  }
  throw new Error(`SSH never became ready after 60 attempts${last ? `; final status ${last.code}` : ""}`);
}

export function transientPinnedTransportFailureCategory(result) {
  if (
    !isObject(result) ||
    ![1, 255].includes(result.code) ||
    result.signal != null ||
    typeof result.stdout !== "string" ||
    result.stdout !== "" ||
    typeof result.stderr !== "string"
  ) {
    return null;
  }
  const patterns = [
    ["connection_refused", /\bconnection refused\b/i],
    ["connection_timed_out", /\bconnection timed out\b/i],
    ["operation_timed_out", /\boperation timed out\b/i],
    ["no_route_to_host", /\bno route to host\b/i],
    ["connection_reset", /\bconnection reset(?: by peer)?\b/i],
    ["connection_closed", /\bconnection closed(?: by (?:remote host|unknown port \d+))?\b/i],
    ["broken_pipe", /\bbroken pipe\b/i],
    ["lost_connection", /\blost connection\b/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(result.stderr))?.[0] ?? null;
}

function assertPinnedTransportIdentity(current, pinned) {
  if (current.id !== pinned.id || current.name !== pinned.name) {
    throw new Error("SSH control-plane identity drifted during hash-and-fetch retry");
  }
  if (current.ip !== pinned.ip || current.port !== pinned.port) {
    throw new Error("SSH public endpoint drifted during hash-and-fetch retry");
  }
  if (
    current.ssh_key.path !== pinned.ssh_key.path ||
    current.ssh_key.fingerprint !== pinned.ssh_key.fingerprint
  ) {
    throw new Error("SSH account key identity drifted during hash-and-fetch retry");
  }
}

async function revalidatePinnedTransportIdentity({
  runpodctl,
  podId,
  expectedName,
  pinnedInfo,
  executor,
  label,
  attempt,
}) {
  const result = await executor.run(
    runpodctl,
    ["ssh", "info", podId, "-o", "json"],
    {
      label: `${label}-identity-revalidate-${attempt}`,
      allowFailure: true,
      outputLogMode: "metadata-only",
    },
  );
  if (result.code !== 0 || result.signal != null) {
    throw new Error("SSH control-plane identity revalidation failed during hash-and-fetch retry");
  }
  let record;
  try {
    record = JSON.parse(result.stdout);
  } catch {
    throw new Error("SSH control-plane identity revalidation returned malformed JSON");
  }
  const current = validateSshInfo(record, podId, expectedName);
  assertPinnedTransportIdentity(current, pinnedInfo);
  return current;
}

export async function runPinnedTransportWithRetry({
  command,
  args,
  label,
  runpodctl,
  podId,
  expectedName,
  pinnedInfo,
  executor,
  stopState,
  retryDelaysMs = HASH_FETCH_TRANSPORT_RETRY_DELAYS_MS,
  settle = null,
  beforeAttempt = null,
  onAttempt = null,
}) {
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    typeof label !== "string" ||
    typeof runpodctl !== "string" ||
    !isObject(executor) ||
    !isObject(stopState) ||
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.length < 1 ||
    retryDelaysMs[0] !== 0 ||
    retryDelaysMs.some((milliseconds) => !Number.isSafeInteger(milliseconds) || milliseconds < 0) ||
    (settle !== null && typeof settle !== "function") ||
    (beforeAttempt !== null && typeof beforeAttempt !== "function") ||
    (onAttempt !== null && typeof onAttempt !== "function")
  ) {
    throw new Error("invalid pinned hash-and-fetch retry contract");
  }
  validateSshInfo(pinnedInfo, podId, expectedName);
  const wait = settle ?? ((milliseconds) => delay(milliseconds, stopState));
  for (let index = 0; index < retryDelaysMs.length; index += 1) {
    const attempt = index + 1;
    if (stopState.requested) {
      throw new Error(`fanout interrupted before ${label} retry by ${stopState.signal ?? "failure"}`);
    }
    if (attempt > 1) {
      await wait(retryDelaysMs[index]);
      if (stopState.requested) {
        throw new Error(`fanout interrupted during ${label} retry by ${stopState.signal ?? "failure"}`);
      }
      await revalidatePinnedTransportIdentity({
        runpodctl,
        podId,
        expectedName,
        pinnedInfo,
        executor,
        label,
        attempt,
      });
    }
    await beforeAttempt?.({ attempt });
    const result = await executor.run(command, args, {
      label: `${label}-attempt-${attempt}`,
      allowFailure: true,
    });
    if (result.code === 0 && result.signal == null) {
      const observation = { attempt, status: "accepted", category: "completed" };
      await onAttempt?.(observation);
      return { result, attempt_count: attempt };
    }
    const category = transientPinnedTransportFailureCategory(result);
    if (!category) {
      await onAttempt?.({ attempt, status: "rejected", category: "non_transient_result" });
      throw new Error(`${label} failed with a non-transient transport result`);
    }
    await onAttempt?.({ attempt, status: "retryable_failure", category });
    if (attempt === retryDelaysMs.length) {
      throw new Error(`${label} exhausted bounded pinned transport retries`);
    }
  }
  throw new Error(`${label} retry loop ended unexpectedly`);
}

export async function runPinnedFetchWithRetry({
  stagingRoot,
  destinationPath,
  beforeAttempt = null,
  ...options
}) {
  const normalizedStagingRoot = typeof stagingRoot === "string" ? path.resolve(stagingRoot) : null;
  const normalizedDestination = typeof destinationPath === "string" ? path.resolve(destinationPath) : null;
  if (
    typeof stagingRoot !== "string" ||
    !path.isAbsolute(stagingRoot) ||
    typeof destinationPath !== "string" ||
    !path.isAbsolute(destinationPath) ||
    normalizedStagingRoot === path.parse(normalizedStagingRoot).root ||
    path.dirname(normalizedDestination) !== normalizedStagingRoot ||
    !new Set(["runs", "evidence", "artifacts.sha256"]).has(path.basename(normalizedDestination)) ||
    (beforeAttempt !== null && typeof beforeAttempt !== "function")
  ) {
    throw new Error("invalid exact fetch retry destination");
  }
  return runPinnedTransportWithRetry({
    ...options,
    beforeAttempt: async ({ attempt }) => {
      if (attempt > 1) await rm(destinationPath, { recursive: true, force: true });
      await beforeAttempt?.({ attempt });
    },
  });
}

function podAlreadyAbsent(result) {
  return isStructuredProviderNotFound(result.stdout, result.stderr);
}

export class ExecutorRunPodClient {
  constructor(runpodctl, executor, labelPrefix = "reaper") {
    this.runpodctl = runpodctl;
    this.executor = executor;
    this.labelPrefix = labelPrefix;
  }

  async listAll() {
    const result = await this.executor.run(
      this.runpodctl,
      ["pod", "list", "-a", "-o", "json"],
      {
        label: `${this.labelPrefix}-list`,
        allowFailure: true,
        allowWhenStopping: true,
        outputLogMode: "metadata-only",
      },
    );
    if (result.code !== 0) throw new Error(`RunPod list failed with status ${result.code}`);
    const records = parseJsonOutput(result, "RunPod list");
    if (!Array.isArray(records)) throw new Error("RunPod list did not return an array");
    return records;
  }

  async get(podId) {
    const result = await this.executor.run(
      this.runpodctl,
      ["pod", "get", podId, "--include-network-volume", "-o", "json"],
      {
        label: `${this.labelPrefix}-get-${podId}`,
        allowFailure: true,
        allowWhenStopping: true,
        outputLogMode: "metadata-only",
      },
    );
    if (result.code !== 0) {
      if (podAlreadyAbsent(result)) return null;
      throw new Error(`RunPod get failed with status ${result.code}`);
    }
    return parseJsonOutput(result, "RunPod get");
  }

  async delete(podId) {
    const result = await this.executor.run(
      this.runpodctl,
      ["pod", "delete", podId, "-o", "json"],
      {
        label: `${this.labelPrefix}-delete-${podId}`,
        allowFailure: true,
        allowWhenStopping: true,
        outputLogMode: "metadata-only",
      },
    );
    if (result.code !== 0) {
      if (podAlreadyAbsent(result)) return { status: "already_absent" };
      throw new Error(`RunPod delete failed with status ${result.code}`);
    }
    return { status: "delete_acknowledged" };
  }
}

export async function deleteExactPod(runpodctl, podId, executor, label) {
  const result = await executor.run(
    runpodctl,
    ["pod", "delete", podId, "-o", "json"],
    {
      label,
      allowFailure: true,
      allowWhenStopping: true,
      outputLogMode: "metadata-only",
    },
  );
  if (result.code !== 0 && !podAlreadyAbsent(result)) {
    throw new Error(`exact pod cleanup failed for ${podId}`);
  }
  return { id: podId, status: result.code === 0 ? "deleted" : "already_absent" };
}

export async function deleteExactOwnedPodWithRetry({
  runpodctl,
  podId,
  expectedName,
  preexistingIds,
  executor,
  label,
  settle = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  let deleteAcknowledged = false;
  let lastError = null;
  for (let attempt = 0; attempt < EXACT_ID_DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await settle(EXACT_ID_DELETE_RETRY_DELAYS_MS[attempt]);
    const suffix = `${label}-attempt-${attempt + 1}`;
    try {
      const inspection = await executor.run(
        runpodctl,
        ["pod", "get", podId, "--include-network-volume", "-o", "json"],
        {
          label: `${suffix}-identity-check`,
          allowFailure: true,
          allowWhenStopping: true,
          outputLogMode: "metadata-only",
        },
      );
      if (inspection.code !== 0) {
        if (podAlreadyAbsent(inspection)) {
          return {
            id: podId,
            status: deleteAcknowledged ? "deleted_and_absent" : "confirmed_absent",
            attempts: attempt + 1,
          };
        }
        throw new Error(`exact-ID identity check failed with status ${inspection.code}`);
      }
      const current = parseJsonOutput(inspection, "exact-ID cleanup identity check");
      if (
        current.id !== podId ||
        current.name !== expectedName ||
        current.name.startsWith("storm-") ||
        preexistingIds.has(podId)
      ) {
        throw new ReaperIdentityRefusalError(`exact-ID cleanup identity refusal for ${podId}`);
      }
      const deletion = await deleteExactPod(runpodctl, podId, executor, `${suffix}-delete`);
      deleteAcknowledged ||= deletion.status === "deleted";
    } catch (error) {
      if (error instanceof ReaperIdentityRefusalError) throw error;
      lastError = error;
    }
  }
  throw new Error(
    `exact-ID cleanup retries exhausted for ${podId}: ${lastError?.message || "pod never reached verified absence"}`,
  );
}

async function reaperRecord(ledgerPath, recordId) {
  const ledger = await readReaperLedger(ledgerPath);
  const record = ledger.records.find((candidate) => candidate.record_id === recordId);
  if (!record) throw new Error(`reaper ledger lost record ${recordId}`);
  return record;
}

export function validateR9SafePreProviderBlockedRecord(record, expectedPending) {
  if (!isObject(record) || !isObject(expectedPending)) {
    throw new ReaperIdentityRefusalError("safe r9 pre-provider terminal requires current and saved proofs");
  }
  const exactFields = [
    "record_id", "run_id", "manifest_sha256", "deadline", "ownership_kind",
    "name_prefix", "name_nonce", "expected_name", "preexisting_snapshot_sha256",
    "created_at",
  ];
  for (const field of exactFields) {
    if (record[field] !== expectedPending[field]) {
      throw new ReaperIdentityRefusalError(`safe r9 pre-provider terminal ${field} differs from saved proof`);
    }
  }
  const events = record.events;
  const terminal = Array.isArray(events) ? events.at(-1) : null;
  if (
    expectedPending.state !== "pending" ||
    record.state !== "blocked" ||
    !record.run_id.startsWith(`${R9_ACTIVATION_RUN_ID}:`) ||
    record.pod_id !== null ||
    expectedPending.pod_id !== null ||
    record.active_binding_sha256 !== null ||
    expectedPending.active_binding_sha256 !== null ||
    record.bound_at !== null ||
    expectedPending.bound_at !== null ||
    record.retired_at !== null ||
    expectedPending.retired_at !== null ||
    record.terminal_reason !== "pre_post_create_not_invoked" ||
    expectedPending.terminal_reason !== null ||
    record.last_error !== null ||
    expectedPending.last_error !== null ||
    !Array.isArray(record.preexisting_ids) ||
    !equalJson(record.preexisting_ids, expectedPending.preexisting_ids) ||
    !Array.isArray(events) ||
    !Array.isArray(expectedPending.events) ||
    events.length < 2 ||
    !equalJson(events[0], expectedPending.events[0]) ||
    events.slice(1, -1).some((event) => (
      !isObject(event) ||
      !equalJson(Object.keys(event).sort(), ["at", "type"]) ||
      event.type !== "pending_name_absent" ||
      !Number.isFinite(Date.parse(event.at))
    )) ||
    !isObject(terminal) ||
    !equalJson(Object.keys(terminal).sort(), ["at", "type"]) ||
    terminal.type !== "pre_post_create_not_invoked" ||
    !Number.isFinite(Date.parse(terminal.at)) ||
    record.updated_at !== terminal.at
  ) {
    throw new ReaperIdentityRefusalError("record is not the exact safe r9 pre-provider terminal");
  }
  return record;
}

export async function reconcileAndCleanupReaperRecord({
  ledgerPath,
  recordId,
  runpodctl,
  reaperClient,
  executor,
  label,
  createdIds = new Set(),
  podRecords = new Map(),
  expectedPreProviderPending = null,
  expectedPendingOwnership = null,
  settle,
  retryLedgerMutation = (operation) => operation(),
}) {
  if (expectedPreProviderPending !== null) {
    const terminal = validateR9SafePreProviderBlockedRecord(
      await reaperRecord(ledgerPath, recordId),
      expectedPreProviderPending,
    );
    return {
      record_id: recordId,
      pod_id: null,
      state: terminal.state,
      outcome: terminal.terminal_reason,
      safe_terminal: true,
      provider_calls: 0,
      external_deadline_cleanup_required: false,
    };
  }
  let record = await reaperRecord(ledgerPath, recordId);
  if (record.state === "pending") {
    if (!isObject(expectedPendingOwnership)) {
      throw new ReaperIdentityRefusalError(
        `r9 pending record ${recordId} lacks its immutable registration proof`,
      );
    }
    record = await retryLedgerMutation(() => reconcilePendingCreateR9({
      ledgerPath,
      client: reaperClient,
      expected: expectedPendingOwnership,
    }));
  }
  if (record.state === "pending") {
    return {
      record_id: recordId,
      state: "pending",
      outcome: "exact_generated_name_not_currently_observed",
      external_deadline_cleanup_required: true,
    };
  }
  if (record.state === "blocked") {
    throw new ReaperIdentityRefusalError(`reaper record ${recordId} is blocked`);
  }
  if (record.state === "retired") {
    record = await retryLedgerMutation(() => confirmOwnedPodAbsentR9({
      ledgerPath,
      client: reaperClient,
      expected: record,
    }));
    return {
      record_id: recordId,
      pod_id: record.pod_id,
      state: record.state,
      outcome: record.terminal_reason,
      external_deadline_cleanup_required: false,
    };
  }
  const preexistingIds = new Set(record.preexisting_ids);
  createdIds.add(record.pod_id);
  podRecords.set(record.pod_id, {
    recordId,
    name: record.expected_name,
    preexistingIds,
  });
  const deletion = await deleteExactOwnedPodWithRetry({
    runpodctl,
    podId: record.pod_id,
    expectedName: record.expected_name,
    preexistingIds,
    executor,
    label,
    settle,
  });
  record = await retryLedgerMutation(() => confirmOwnedPodAbsentR9({
    ledgerPath,
    client: reaperClient,
    expected: record,
  }));
  createdIds.delete(record.pod_id);
  podRecords.delete(record.pod_id);
  return {
    record_id: recordId,
    pod_id: record.pod_id,
    state: record.state,
    outcome: record.terminal_reason,
    delete: deletion,
    external_deadline_cleanup_required: false,
  };
}

async function verifyFetchedArtifacts(fetchRoot) {
  const manifestPath = path.join(fetchRoot, "artifacts.sha256");
  const body = await readFile(manifestPath, "utf8");
  const expected = new Map();
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const match = line.match(/^([a-f0-9]{64})  (runs|evidence)\/([a-zA-Z0-9._/-]+)$/);
    if (!match) throw new Error("fetched artifact manifest contains an unsafe line");
    const relative = `${match[2]}/${match[3]}`;
    if (
      expected.has(relative) ||
      relative.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error("fetched artifact manifest contains a duplicate or non-canonical path");
    }
    expected.set(relative, match[1]);
  }
  if (expected.size < 1) throw new Error("fetched artifact manifest is empty");
  const actualFiles = [];
  async function walk(directory, relativeRoot) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeRoot, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`fetched artifact is a symlink: ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) actualFiles.push(relative);
      else throw new Error(`fetched artifact has unsupported type: ${relative}`);
    }
  }
  for (const root of ["runs", "evidence"]) {
    const rootPath = path.join(fetchRoot, root);
    const info = await lstat(rootPath).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`fetched ${root} directory is missing or unsafe`);
    await walk(rootPath, root);
  }
  actualFiles.sort();
  const listed = [...expected.keys()].sort();
  if (!equalJson(actualFiles, listed)) throw new Error("fetched files do not exactly match artifacts.sha256");
  for (const [relative, digest] of expected) {
    const actual = await sha256File(path.join(fetchRoot, ...relative.split("/")));
    if (actual !== digest) throw new Error(`fetched artifact hash mismatch: ${relative}`);
  }
  return { status: "verified", file_count: expected.size, manifest_sha256: await sha256File(manifestPath) };
}

export { verifyFetchedArtifacts };

async function quarantineOutputEvidence(output, reason, state) {
  const quarantineRoot = path.join(output, "quarantine");
  await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  const stamp = safeTimestamp();
  for (const sourceRoot of [path.join(output, "active"), path.join(output, "completed")]) {
    const names = await readdir(sourceRoot).catch(() => []);
    for (const name of names) {
      const source = path.join(sourceRoot, name);
      const destination = path.join(quarantineRoot, `${name}.aborted-${stamp}`);
      await rename(source, destination);
      await writeJsonAtomic(path.join(destination, "quarantine-receipt.json"), {
        schema_version: 1,
        reason,
        source_path: source,
        quarantined_path: destination,
        quarantined_at: new Date().toISOString(),
        evidence_eligible: false,
      });
    }
  }
  state.status = "aborted";
  state.evidence_eligible = false;
  state.abort_reason = reason;
  state.updated_at = new Date().toISOString();
  await writeJsonAtomic(path.join(output, "state.json"), state);
  await writeJsonAtomic(path.join(output, "evidence", "run-verdict.json"), {
    schema_version: 1,
    run_id: state.run_id,
    manifest_sha256: state.manifest_sha256,
    transport_status: "aborted",
    policy_audit_status: "not_completed",
    reason,
    evidence_eligible: false,
  });
}

async function loadResumePairs(resumeFrom, preflight, output, state) {
  if (!resumeFrom) return new Set();
  assertAbsoluteFilePath(resumeFrom, "--resume-from");
  const real = await realpath(resumeFrom);
  if (real !== resumeFrom) throw new Error("--resume-from must be canonical");
  const abortReceipt = await lstat(path.join(real, "runner-abort-receipt.json")).catch(() => null);
  const priorVerdict = JSON.parse(await readFile(path.join(real, "evidence", "run-verdict.json"), "utf8"));
  if (abortReceipt || priorVerdict.evidence_eligible !== true) {
    throw new Error("resume source is aborted, quarantined, or evidence-ineligible");
  }
  if (priorVerdict.manifest_sha256 !== preflight.manifestSha256) {
    throw new Error("resume source uses a different immutable manifest");
  }
  const resumed = new Set();
  for (const { pair } of preflight.pairs) {
    const source = path.join(real, "completed", pair.id);
    const sourceInfo = await lstat(source).catch(() => null);
    if (!sourceInfo) continue;
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error(`resume pair ${pair.id} is unsafe`);
    const completion = JSON.parse(await readFile(path.join(source, "pair-complete.json"), "utf8"));
    if (
      completion.evidence_eligible !== true ||
      completion.manifest_sha256 !== preflight.manifestSha256 ||
      completion.pair_id !== pair.id
    ) {
      throw new Error(`resume pair ${pair.id} lacks an exact completion receipt`);
    }
    await verifyFetchedArtifacts(path.join(source, "fetched"));
    const destination = path.join(output, "completed", pair.id);
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    resumed.add(pair.id);
    state.pairs[pair.id] = { status: "completed", resumed_from: source, evidence_eligible: true };
  }
  return resumed;
}

async function runOnePair({
  preflight,
  arm,
  pair,
  output,
  executor,
  tools,
  createdIds,
  podRecords,
  reaperRecords,
  beforeRegister,
  beforeCreate,
  ledgerMutationCoordinator,
  stopState,
  state,
}) {
  const activeRoot = path.join(output, "active", `${pair.id}.working`);
  const completeRoot = path.join(output, "completed", pair.id);
  await mkdir(activeRoot, { mode: 0o700 });
  const pairLogs = path.join(activeRoot, "logs");
  await mkdir(pairLogs, { mode: 0o700 });
  const contract = pairContract(preflight, arm, pair);
  const contractPath = path.join(activeRoot, "pair-contract.json");
  await writeJsonAtomic(contractPath, contract);
  const contractSha256 = await sha256File(contractPath);
  let name = null;
  let cleanupRecordId = null;
  state.pairs[pair.id] = { status: "running", phase: "register-cleanup", arm_id: arm.id };
  state.updated_at = new Date().toISOString();
  await writeJsonAtomic(path.join(output, "state.json"), state);
  await appendEvent(output, "pair_started", { pair_id: pair.id, arm_id: arm.id, order: pair.order });

  let podId = null;
  let deadlineTimer = null;
  const createNow = Date.now();
  const controlSecret = randomBytes(32).toString("hex");
  const watchdogDeadline = new Date(
    createNow + preflight.document.cleanup_watchdog.client_cleanup_deadline_seconds * 1000,
  ).toISOString();
  let pendingOwnership;
  let pairPreexistingIds;
  let createResult;
  let createRecord;
  let preProviderBoundaryFailed = false;
  try {
    await runR9SerializedCreateTransaction({
      ledgerMutationCoordinator,
      stopState,
      executor,
      operation: async () => {
      if (stopState.requested) throw new Error(`fanout stopping before ${pair.id} ownership registration`);
      pendingOwnership = await executeAfterExactR9WorkerStartBoundary(
        beforeRegister,
        () => stopState.requested,
        (workerBoundary) => ledgerMutationCoordinator.retryExactServiceLock(() => preparePendingCreateR9({
          ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
          client: tools.reaperClient,
          runId: `${preflight.document.run_id}:${pair.id}`,
          manifestSha256: preflight.manifestSha256,
          deadline: watchdogDeadline,
          namePrefix: preflight.document.pod.name_prefix,
          expectedLedgerRevision: workerBoundary.ledger_revision,
          expectedLedgerDigest: workerBoundary.ledger_digest_sha256,
        })),
      );
      cleanupRecordId = pendingOwnership.record_id;
      reaperRecords.set(cleanupRecordId, {
        pairId: pair.id,
        pendingOwnership,
      });
      name = pendingOwnership.expected_name;
      pairPreexistingIds = new Set(pendingOwnership.preexisting_ids);
      await writeJsonAtomic(path.join(activeRoot, "reaper-pending-create.json"), pendingOwnership);
      state.pairs[pair.id] = {
        ...state.pairs[pair.id],
        phase: "create",
        pod_name: name,
        reaper_record_id: cleanupRecordId,
        client_cleanup_deadline: watchdogDeadline,
      };
      await writeJsonAtomic(path.join(output, "state.json"), state);
      const controlStdin = Buffer.from(
        JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: controlSecret }),
        "utf8",
      );
      try {
        createResult = await executeAfterExactR9PrePostBoundary({
          verifyBoundary: async () => {
            await verifyPendingNameAbsentR9({
              client: tools.reaperClient,
              expected: pendingOwnership,
            });
            return beforeCreate(pendingOwnership);
          },
          stopRequested: () => stopState.requested,
          blockPending: () => ledgerMutationCoordinator.retryExactServiceLock(
            () => blockPendingBeforeProviderPost({
              ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
              expected: pendingOwnership,
            }),
          ),
          providerPost: () => executor.run(
              tools.runpodctl,
              buildPodCreateArgs(preflight.document, name, controlSecret),
              {
                label: `${pair.id}-pod-create`,
                allowFailure: true,
                redactions: [controlSecret],
                outputLogMode: "metadata-only",
                stdinBytes: controlStdin,
                sensitiveOutputToken: controlSecret,
              },
            ),
        });
      } catch (error) {
        if (error instanceof R9PreProviderPostBoundaryError) {
          preProviderBoundaryFailed = true;
          const registration = reaperRecords.get(cleanupRecordId);
          reaperRecords.set(cleanupRecordId, {
            ...registration,
            preProviderDisposition: error.pendingTerminalized
              ? "blocked_pre_post_create_not_invoked"
              : "pending_manual_block_unavailable",
            preProviderPending: pendingOwnership,
          });
          if (error.blockResult) {
            await writeJsonAtomic(
              path.join(activeRoot, "reaper-pre-provider-block.json"),
              error.blockResult,
            );
          }
          throw error;
        }
        throw new Error(`RunPod create transport failed before a trustworthy response: ${error.message}`);
      } finally {
        controlStdin.fill(0);
      }
        try {
          createRecord = parseJsonOutput(createResult, "RunPod create");
          podId = registerCreatedPod(createRecord, name, pairPreexistingIds, createdIds);
          const activeOwnership = await ledgerMutationCoordinator.retryExactServiceLock(() => bindActivePodR9({
            ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
            client: tools.reaperClient,
            expected: pendingOwnership,
            podId,
          }));
          await writeJsonAtomic(path.join(activeRoot, "reaper-active-binding.json"), activeOwnership);
        } catch (error) {
          throw new Error(`RunPod create response was not cleanup-safe: ${error.message}`);
        }
      },
    });
    podRecords.set(podId, { pairId: pair.id, name, recordId: cleanupRecordId, preexistingIds: pairPreexistingIds });
    const loweredControlSecret = controlSecret.toLowerCase();
    if (
      createResult.stdout.toLowerCase().includes(loweredControlSecret) ||
      createResult.stderr.toLowerCase().includes(loweredControlSecret) ||
      JSON.stringify(createRecord).toLowerCase().includes(loweredControlSecret)
    ) {
      throw new Error("RunPod create response leaked the runtime control nonce");
    }
    if (createResult.code !== 0) {
      throw new Error(`RunPod create returned status ${createResult.code} after pod ID ${podId}`);
    }
    const requestAttestation = validateCreateRequestAttestation(createRecord, {
      manifest: preflight.document,
      expectedName: name,
      controlSecret,
    });
    validateCreatedPod(createRecord, {
      expectedName: name,
      preexistingIds: pairPreexistingIds,
    });
    deadlineTimer = setTimeout(() => {
      stopState.requested = true;
      stopState.signal = "LOCAL_2H_WATCHDOG";
      executor.stop();
    }, preflight.document.cleanup_watchdog.client_cleanup_deadline_seconds * 1000);
    deadlineTimer.unref();
    await writeJsonAtomic(path.join(activeRoot, "pod-create.json"), createRecord);
    await writeJsonAtomic(path.join(activeRoot, "pod-create-request-attestation.json"), requestAttestation);
    state.pairs[pair.id] = {
      ...state.pairs[pair.id],
      pod_id: podId,
      phase: "verify-pod",
      local_watchdog_deadline: watchdogDeadline,
    };
    await writeJsonAtomic(path.join(output, "state.json"), state);

    const listResult = await executor.run(
      tools.runpodctl,
      ["pod", "list", "--name", name, "-a", "-o", "json"],
      { label: `${pair.id}-pod-list`, outputLogMode: "metadata-only" },
    );
    const listed = parseJsonOutput(listResult, "RunPod list");
    if (!Array.isArray(listed) || listed.length !== 1 || listed[0].id !== podId || listed[0].name !== name) {
      throw new Error("post-create pod listing does not resolve to the exact new pod ID");
    }
    const getResult = await executor.run(
      tools.runpodctl,
      ["pod", "get", podId, "--include-network-volume", "-o", "json"],
      { label: `${pair.id}-pod-get`, outputLogMode: "metadata-only" },
    );
    const got = parseJsonOutput(getResult, "RunPod get");
    if (got.id !== podId || got.name !== name) throw new Error("RunPod get returned a different pod identity");
    const podAttestation = validateCreatedPod(
      { ...createRecord, ...listed[0], ...got, id: podId },
      {
        expectedName: name,
        preexistingIds: pairPreexistingIds,
        requireNetworkVolumeInspection: true,
        createRequestAttestation: requestAttestation,
        returnAttestation: true,
      },
    );
    await writeJsonAtomic(
      path.join(activeRoot, "pod-network-volume-attestation.json"),
      podAttestation.network_volume_attestation,
    );

    state.pairs[pair.id].phase = "ssh-ready";
    await writeJsonAtomic(path.join(output, "state.json"), state);
    const info = await waitForSsh(tools.runpodctl, podId, name, executor, stopState, pair.id);
    await writeJsonAtomic(path.join(activeRoot, "ssh-info.json"), info);
    const keyInfo = await lstat(info.ssh_key.path).catch(() => null);
    if (!keyInfo?.isFile() || keyInfo.isSymbolicLink()) throw new Error("SSH key path is missing or unsafe");
    if (await realpath(info.ssh_key.path) !== info.ssh_key.path) throw new Error("SSH key path must already be canonical");
    if ((keyInfo.mode & 0o077) !== 0) throw new Error("SSH private key permissions are too broad");
    if (typeof process.getuid === "function" && keyInfo.uid !== process.getuid()) {
      throw new Error("SSH private key is not owned by this operator");
    }
    const knownHosts = path.join(activeRoot, "known_hosts");
    await prepareKnownHostsFile(knownHosts);
    const remote = `root@${info.ip}`;
    const bootstrapResult = await executor.run(
      tools.ssh,
      [
        ...sshArgs(info, knownHosts, { bootstrap: true }),
        remote,
        remoteSshHostKeyAttestationCommand(),
      ],
      { label: `${pair.id}-host-key-attestation-challenge` },
    );
    const knownHostsInfo = await lstat(knownHosts).catch(() => null);
    if (
      !knownHostsInfo?.isFile() ||
      knownHostsInfo.isSymbolicLink() ||
      knownHostsInfo.size < 20 ||
      (knownHostsInfo.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && knownHostsInfo.uid !== process.getuid())
    ) {
      throw new Error("SSH bootstrap did not produce a safe pinned host-key file");
    }
    const fingerprintResult = await executor.run(
      tools.sshKeygen,
      ["-lf", knownHosts, "-E", "sha256"],
      { label: `${pair.id}-known-host-fingerprint` },
    );
    const knownHostsFingerprint = parseSshKeygenFingerprint(fingerprintResult.stdout);
    let hostKeyChallenge;
    try {
      hostKeyChallenge = JSON.parse(bootstrapResult.stdout);
    } catch (error) {
      throw new Error(`SSH host-key attestation did not return exact JSON: ${error.message}`);
    }
    const hostKeyAttestation = validateSshHostKeyAttestation(
      hostKeyChallenge,
      knownHostsFingerprint,
      controlSecret,
    );
    await writeJsonAtomic(path.join(activeRoot, "ssh-host-key-attestation.json"), {
      ...hostKeyAttestation,
      pod_id: podId,
      pod_name: name,
      ssh_account_key_fingerprint: info.ssh_key.fingerprint,
      known_hosts_sha256: await sha256File(knownHosts),
      strict_followup_required: true,
    });
    const ssh = sshArgs(info, knownHosts);
    const scp = scpArgs(info, knownHosts);
    const remoteRoot = `/workspace/proxywar-mickey-fanout-${preflight.document.run_id}-${pair.id}`;
    const remoteStage = `${remoteRoot}/stage`;
    const bundleRoot = `${remoteRoot}/extracted/proxywar-runpod-bundle`;
    const remoteCommand = (...parts) => parts.map(remoteQuote).join(" ");

    const archResult = await executor.run(tools.ssh, [...ssh, remote, "uname -m"], { label: `${pair.id}-arch` });
    if (!/^(x86_64|amd64)\s*$/.test(archResult.stdout)) throw new Error("RunPod CPU architecture is not amd64");
    await executor.run(
      tools.ssh,
      [...ssh, remote, `set -euo pipefail; test ! -e ${remoteQuote(remoteRoot)}; mkdir -p ${remoteQuote(remoteStage)} ${remoteQuote(`${remoteRoot}/runs`)} ${remoteQuote(`${remoteRoot}/evidence`)}`],
      { label: `${pair.id}-remote-init` },
    );

    for (const transfer of [
      { local: arm.bundle.path, sha: arm.bundle.sha256, remoteName: "bundle.tar.gz" },
      { local: arm.extractor.path, sha: arm.extractor.sha256, remoteName: "extract.py" },
      { local: preflight.verifierPath, sha: preflight.verifierSha256, remoteName: "verify-bundle.mjs" },
      { local: contractPath, sha: contractSha256, remoteName: "pair-contract.json" },
    ]) {
      const before = await sha256File(transfer.local);
      if (before !== transfer.sha) throw new Error(`local transfer source changed: ${transfer.local}`);
      await executor.run(
        tools.scp,
        [...scp, transfer.local, `${remote}:${remoteStage}/${transfer.remoteName}.part`],
        { label: `${pair.id}-scp-${transfer.remoteName}` },
      );
      await executor.run(
        tools.ssh,
        [
          ...ssh,
          remote,
          `set -euo pipefail; cd ${remoteQuote(remoteStage)}; printf '%s  %s\\n' ${remoteQuote(transfer.sha)} ${remoteQuote(`${transfer.remoteName}.part`)} | sha256sum -c -; mv -- ${remoteQuote(`${transfer.remoteName}.part`)} ${remoteQuote(transfer.remoteName)}; printf '%s  %s\\n' ${remoteQuote(transfer.sha)} ${remoteQuote(transfer.remoteName)} | sha256sum -c -`,
        ],
        { label: `${pair.id}-verify-${transfer.remoteName}` },
      );
    }

    state.pairs[pair.id].phase = "extract-and-verify";
    await writeJsonAtomic(path.join(output, "state.json"), state);
    await executor.run(
      tools.ssh,
      [
        ...ssh,
        remote,
        `set -euo pipefail; cd ${remoteQuote(remoteStage)}; chmod 0755 extract.py; python3 extract.py --archive bundle.tar.gz --expected-sha256 ${remoteQuote(arm.bundle.sha256)} --destination ${remoteQuote(`${remoteRoot}/extracted`)} > extract.json.part; mv -- extract.json.part extract.json; test -x ${remoteQuote(`${bundleRoot}/bin/runpod-proxywar-episode`)}; cd ${remoteQuote(bundleRoot)}; sha256sum -c files.sha256`,
      ],
      { label: `${pair.id}-extract` },
    );
    await executor.run(
      tools.ssh,
      [
        ...ssh,
        remote,
        `set -euo pipefail; ${remoteQuote(`${bundleRoot}/runtime/node/bin/node`)} ${remoteQuote(`${remoteStage}/verify-bundle.mjs`)} --bundle-root ${remoteQuote(bundleRoot)} --contract ${remoteQuote(`${remoteStage}/pair-contract.json`)} --output ${remoteQuote(`${remoteRoot}/evidence/bundle-validation.json.part`)}; mv -- ${remoteQuote(`${remoteRoot}/evidence/bundle-validation.json.part`)} ${remoteQuote(`${remoteRoot}/evidence/bundle-validation.json`)}`,
      ],
      { label: `${pair.id}-bundle-verify` },
    );

    const runner = `${bundleRoot}/bin/runpod-proxywar-episode`;
    const remoteReceiptGate =
      `const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));` +
      `if(r.status!=='passed'||r.post_run_attestation?.status!==${JSON.stringify(REMOTE_POST_RUN_ATTESTATION_STATUS)})process.exit(1)`;
    for (const role of pair.order) {
      if (stopState.requested) throw new Error(`fanout interrupted before ${pair.id}/${role}`);
      const spec = role === "candidate" ? pair.candidate_spec : pair.m0_spec;
      const outputDir = `${remoteRoot}/runs/${role}`;
      const episodeRunId = `${preflight.document.run_id}-${pair.id}-${role}`.slice(0, 80);
      state.pairs[pair.id].phase = `run-${role}`;
      await writeJsonAtomic(path.join(output, "state.json"), state);
      await executor.run(
        tools.ssh,
        [
          ...ssh,
          remote,
          `set -euo pipefail; ${remoteQuote(runner)} --spec ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} --validate-only > ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt.part`)}; mv -- ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt.part`)} ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt`)}; ${remoteQuote(runner)} --spec ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} --output-dir ${remoteQuote(outputDir)} --run-id ${remoteQuote(episodeRunId)} | tee ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log.part`)}; mv -- ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log.part`)} ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log`)}; cp ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} ${remoteQuote(`${outputDir}/config.json`)}; ${remoteQuote(`${bundleRoot}/runtime/node/bin/node`)} -e ${remoteQuote(remoteReceiptGate)} ${remoteQuote(`${outputDir}/receipt.json`)}`,
        ],
        { label: `${pair.id}-run-${role}` },
      );
    }

    state.pairs[pair.id].phase = "hash-and-fetch";
    await writeJsonAtomic(path.join(output, "state.json"), state);
    const recordHashFetchAttempt = (operation) => (record) => appendEvent(
      output,
      "hash_fetch_transport_attempt",
      { pair_id: pair.id, arm_id: arm.id, operation, ...record },
    );
    await runPinnedTransportWithRetry({
      command: tools.ssh,
      args: [
        ...ssh,
        remote,
        `set -euo pipefail; cp ${remoteQuote(`${remoteStage}/extract.json`)} ${remoteQuote(`${remoteRoot}/evidence/extract.json`)}; cp ${remoteQuote(`${remoteStage}/pair-contract.json`)} ${remoteQuote(`${remoteRoot}/evidence/pair-contract.json`)}; cd ${remoteQuote(remoteRoot)}; find runs evidence -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > artifacts.sha256.part; mv -- artifacts.sha256.part artifacts.sha256`,
      ],
      label: `${pair.id}-remote-hash`,
      runpodctl: tools.runpodctl,
      podId,
      expectedName: name,
      pinnedInfo: info,
      executor,
      stopState,
      onAttempt: recordHashFetchAttempt("remote-hash"),
    });
    const fetchPart = path.join(activeRoot, "fetched.part");
    await mkdir(fetchPart, { mode: 0o700 });
    for (const remoteItem of ["runs", "evidence", "artifacts.sha256"]) {
      await runPinnedFetchWithRetry({
        command: tools.scp,
        args: [...scp, "-r", `${remote}:${remoteRoot}/${remoteItem}`, `${fetchPart}/`],
        label: `${pair.id}-fetch-${remoteItem}`,
        stagingRoot: fetchPart,
        destinationPath: path.join(fetchPart, remoteItem),
        runpodctl: tools.runpodctl,
        podId,
        expectedName: name,
        pinnedInfo: info,
        executor,
        stopState,
        onAttempt: recordHashFetchAttempt(`fetch-${remoteItem}`),
      });
    }
    const fetchVerification = await verifyFetchedArtifacts(fetchPart);
    await writeJsonAtomic(path.join(activeRoot, "fetch-verification.json"), fetchVerification);
    await rename(fetchPart, path.join(activeRoot, "fetched"));

    const deletion = await ledgerMutationCoordinator.runExclusive(() => reconcileAndCleanupReaperRecord({
      ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
      recordId: cleanupRecordId,
      runpodctl: tools.runpodctl,
      reaperClient: tools.reaperClient,
      executor,
      label: `${pair.id}-pod-delete`,
      createdIds,
      podRecords,
      retryLedgerMutation: ledgerMutationCoordinator.retryExactServiceLock,
      expectedPendingOwnership: pendingOwnership,
    }));
    if (deletion.state !== "retired" || deletion.external_deadline_cleanup_required) {
      throw new Error("normal pair cleanup did not reach reaper-confirmed exact-ID absence");
    }
    await writeJsonAtomic(path.join(activeRoot, "pod-delete.json"), deletion);
    await writeJsonAtomic(path.join(activeRoot, "pair-complete.json"), {
      schema_version: 1,
      pair_id: pair.id,
      arm_id: arm.id,
      manifest_sha256: preflight.manifestSha256,
      pod_id: podId,
      reaper_record_id: cleanupRecordId,
      execution_order: pair.order,
      order_draw_sha256: pair.order_draw_sha256,
      fetched_manifest_sha256: fetchVerification.manifest_sha256,
      completed_at: new Date().toISOString(),
      evidence_eligible: true,
    });
    await rename(activeRoot, completeRoot);
    state.pairs[pair.id] = { status: "completed", arm_id: arm.id, pod_id: podId, evidence_eligible: true };
    state.updated_at = new Date().toISOString();
    await writeJsonAtomic(path.join(output, "state.json"), state);
    await appendEvent(output, "pair_completed", { pair_id: pair.id, arm_id: arm.id, pod_id: podId });
    if (deadlineTimer) clearTimeout(deadlineTimer);
  } catch (error) {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    // Ordinary pair failure must not kill transports owned by sibling pairs.
    // Signals, the local watchdog, and serialized-create failure set the
    // shared latch and retain immediate kill-all behavior.
    if (stopState.requested) executor.stop();
    let terminalError = error;
    if (cleanupRecordId && !preProviderBoundaryFailed) {
      try {
        const cleanup = await ledgerMutationCoordinator.runExclusive(() => reconcileAndCleanupReaperRecord({
          ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
          recordId: cleanupRecordId,
          runpodctl: tools.runpodctl,
          reaperClient: tools.reaperClient,
          executor,
          label: `${pair.id}-failure-cleanup`,
          createdIds,
          podRecords,
          retryLedgerMutation: ledgerMutationCoordinator.retryExactServiceLock,
          expectedPendingOwnership: pendingOwnership,
        }));
        await writeJsonAtomic(path.join(activeRoot, "failure-cleanup.json"), cleanup);
      } catch (cleanupError) {
        terminalError = new Error(`${error.message}; exact-ID cleanup: ${cleanupError.message}`);
      }
    }
    state.pairs[pair.id] = {
      ...state.pairs[pair.id],
      status: "failed",
      error: terminalError.message,
      evidence_eligible: false,
    };
    state.updated_at = new Date().toISOString();
    await writeJsonAtomic(path.join(output, "state.json"), state).catch(() => {});
    throw terminalError;
  }
}

export async function runWorkerPool(items, concurrency, worker) {
  let index = 0;
  let firstError = null;
  const threads = Array.from({ length: concurrency }, async () => {
    while (!firstError && index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.allSettled(threads);
  if (firstError) throw firstError;
}

function parseArgs(argv) {
  const options = { manifest: null, manifestSha256: null, output: null, resumeFrom: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const field = {
      "--manifest": "manifest",
      "--manifest-sha256": "manifestSha256",
      "--output": "output",
      "--resume-from": "resumeFrom",
    }[arg];
    if (!field || index + 1 >= argv.length) throw new Error(`unknown or incomplete option: ${arg}`);
    if (options[field] !== null) throw new Error(`duplicate option: ${arg}`);
    options[field] = argv[++index];
  }
  if (!options.manifest || !options.manifestSha256) throw new Error("--manifest and --manifest-sha256 are required");
  if (!options.dryRun && !options.output) throw new Error("--output is required outside dry-run mode");
  return options;
}

export async function runCli(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  let preflight = await preflightManifest(
    options.manifest,
    options.manifestSha256,
    { requirePersistentServiceArtifacts: false },
  );
  let fullFanoutLiveApproved = isFullFanoutLiveApproved(preflight);
  const exactR9ActivationCandidate = isExactR9ActivationCandidate(preflight);
  if (options.dryRun) {
    const plan = {
      ok: true,
      dry_run: true,
      network_calls: 0,
      manifest_sha256: preflight.manifestSha256,
      run_id: preflight.document.run_id,
      source_commit: preflight.sourceReceipt.receipt.source_commit,
      pair_count: preflight.pairs.length,
      max_concurrency: preflight.document.pod.max_concurrency,
      cleanup_watchdog: {
        kind: preflight.document.cleanup_watchdog.kind,
        provider_ttl_available: false,
        client_cleanup_deadline_seconds:
          preflight.document.cleanup_watchdog.client_cleanup_deadline_seconds,
        exact_generated_name_registered_before_post: true,
      },
      full_fanout_live_approved: fullFanoutLiveApproved,
      transport_canary_live_approved: true,
      activation_evidence: preflight.activationEvidence,
      full_fanout_blocking_reason: fullFanoutLiveApproved
        ? null
        : exactR9ActivationCandidate
          ? "exact r9 activation requires live recovery receipt and ledger verification"
          : "manifest is not the exact recovery-bound r9 G000 activation",
      pairs: preflight.pairs.map(({ arm, pair }) => ({
        arm_id: arm.id,
        pair_id: pair.id,
        map: pair.map,
        seed: pair.seed,
        seat: pair.seat,
        roster_class: arm.roster_class,
        order: pair.order,
        order_draw_sha256: pair.order_draw_sha256,
        pod_name: dryRunPodName(preflight.document),
        pod_create_argv: buildPodCreateArgs(
          preflight.document,
          dryRunPodName(preflight.document),
          "0".repeat(64),
        ).map((value) => {
          if (value.includes("MICKEY_CONTROL_PLANE_NONCE")) {
            return JSON.stringify({
              MICKEY_CONTROL_PLANE_NONCE: "RUNTIME_RANDOM_NONCREDENTIAL_256_BIT_VALUE",
            });
          }
          return value;
        }),
      })),
      live_mutation_allowed: false,
      promotion_possible_from_this_run: false,
    };
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }

  if (!exactR9ActivationCandidate) {
    throw new Error(
      "full fanout live execution is blocked before mutation: manifest is not the exact recovery-bound r9 G000 activation",
    );
  }
  if (options.resumeFrom !== null) {
    throw new Error("r9 G000 activation is fresh-only; --resume-from is blocked before mutation");
  }
  if (options.output !== R9_ACTIVATION_OUTPUT_PATH) {
    throw new Error("r9 G000 activation requires the exact preregistered output path");
  }
  preflight = await preflightManifest(
    options.manifest,
    options.manifestSha256,
    { requirePersistentServiceArtifacts: true },
  );
  fullFanoutLiveApproved = isFullFanoutLiveApproved(preflight);
  if (!fullFanoutLiveApproved) {
    throw new Error("r9 G000 activation or exact recovery drifted during persistent-service preflight");
  }

  const output = options.output;
  await validateClaimedOutputShape(
    output,
    preflight.document.run_id,
    preflight.document.runner_lease.state_root,
  );
  const directories = ["active", "completed", "quarantine", "evidence", "control", "command-logs"];
  for (const directory of directories) await mkdir(path.join(output, directory), { recursive: true, mode: 0o700 });
  const executor = new CommandExecutor(path.join(output, "command-logs"));
  const tools = {
    runpodctl: preflight.document.runpodctl.path,
    ssh: "/usr/bin/ssh",
    scp: "/usr/bin/scp",
    sshKeygen: "/usr/bin/ssh-keygen",
  };
  tools.reaperClient = new ExecutorRunPodClient(tools.runpodctl, executor, preflight.document.run_id);
  if (
    process.env.RUNPODCTL_BIN &&
    path.resolve(process.env.RUNPODCTL_BIN) !== preflight.document.runpodctl.path
  ) {
    throw new Error("RUNPODCTL_BIN override does not match the hash-pinned manifest binary");
  }
  const runnerLease = preflight.document.runner_lease.path;
  if (
    process.env.PROXYWAR_RUNNER_LEASE_SCRIPT &&
    path.resolve(process.env.PROXYWAR_RUNNER_LEASE_SCRIPT) !== runnerLease
  ) {
    throw new Error("PROXYWAR_RUNNER_LEASE_SCRIPT override does not match the hash-pinned manifest runner");
  }
  if (
    process.env.PROXYWAR_OPERATOR_STATE_ROOT &&
    path.resolve(process.env.PROXYWAR_OPERATOR_STATE_ROOT) !== preflight.document.runner_lease.state_root
  ) {
    throw new Error("PROXYWAR_OPERATOR_STATE_ROOT override does not match the pinned runner state root");
  }
  await assertClaimedMickeyOutput(
    output,
    preflight.document.run_id,
    runnerLease,
    preflight.document.runner_lease.state_root,
    executor,
  );
  const reaperService = await verifyLiveReaperService({
    manifest: preflight.document,
    manifestSha256: preflight.manifestSha256,
    executor,
  });
  const ledgerMutationCoordinator = createFanoutLedgerMutationCoordinator({
    expectedReaperPid: reaperService.pid,
  });
  const initialLedgerBoundary = await verifyR8LedgerQuiescent(preflight.document);
  await cp(options.manifest, path.join(output, "evidence", "manifest.json"), { errorOnExist: true, force: false });
  await writeFile(
    path.join(output, "evidence", "manifest.sha256"),
    `${preflight.manifestSha256}  manifest.json\n`,
    { mode: 0o600 },
  );
  await cp(
    preflight.document.source_reach_receipt.path,
    path.join(output, "evidence", "source-reach-receipt.json"),
    { errorOnExist: true, force: false },
  );
  const activationReceiptCopy = path.join(output, "evidence", "r7-transport-canary-receipt.json");
  const activationKnownHostsCopy = path.join(output, "evidence", "r7-transport-canary-known-hosts");
  await cp(preflight.document.activation.canary_receipt.path, activationReceiptCopy, {
    errorOnExist: true,
    force: false,
  });
  await cp(preflight.document.activation.canary_known_hosts.path, activationKnownHostsCopy, {
    errorOnExist: true,
    force: false,
  });
  await verifyHashedLocalFile(
    { path: activationReceiptCopy, sha256: preflight.document.activation.canary_receipt.sha256 },
    "copied r7 transport canary receipt",
  );
  await verifyHashedLocalFile(
    { path: activationKnownHostsCopy, sha256: preflight.document.activation.canary_known_hosts.sha256 },
    "copied r7 transport known_hosts",
  );
  const failureEvidenceCopy = path.join(output, "evidence", "r8-pre-post-failure-evidence.json");
  const recoveryReceiptCopy = path.join(output, "evidence", "r8-pre-post-recovery-receipt.json");
  await cp(preflight.document.activation.r8_failure_evidence.path, failureEvidenceCopy, {
    errorOnExist: true,
    force: false,
  });
  await cp(preflight.document.activation.r8_recovery_receipt.path, recoveryReceiptCopy, {
    errorOnExist: true,
    force: false,
  });
  await verifyHashedLocalFile(
    { path: failureEvidenceCopy, sha256: preflight.document.activation.r8_failure_evidence.sha256 },
    "copied r8 pre-POST failure evidence",
  );
  await verifyHashedLocalFile(
    { path: recoveryReceiptCopy, sha256: preflight.document.activation.r8_recovery_receipt.sha256 },
    "copied r8 pre-POST recovery receipt",
  );
  const state = {
    schema_version: 1,
    run_id: preflight.document.run_id,
    manifest_sha256: preflight.manifestSha256,
    status: "starting",
    evidence_eligible: false,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pairs: {},
  };
  await writeJsonAtomic(path.join(output, "state.json"), state);
  await writeJsonAtomic(path.join(output, "control", "reaper-service.json"), reaperService);
  await writeJsonAtomic(
    path.join(output, "control", "initial-reaper-ledger-boundary.json"),
    initialLedgerBoundary,
  );
  await writeJsonAtomic(path.join(output, "control", "activation-evidence.json"), preflight.activationEvidence);
  await appendEvent(output, "preflight_passed", {
    pair_count: preflight.pairs.length,
    activation_receipt_sha256: preflight.activationEvidence.receipt_sha256,
    r8_recovery_receipt_sha256: preflight.activationEvidence.recovery_receipt_sha256,
    r8_recovery_record_id: preflight.activationEvidence.recovery_record_id,
  });

  const stopState = { requested: false, signal: null };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!stopState.requested) {
        stopState.requested = true;
        stopState.signal = signal;
        executor.stop();
      }
    });
  }
  const createdIds = new Set();
  const podRecords = new Map();
  const reaperRecords = new Map();
  let fatal = null;
  try {
    const snapshotResult = await executor.run(tools.runpodctl, ["pod", "list", "-a", "-o", "json"], {
      label: "preexisting-pod-snapshot",
      outputLogMode: "metadata-only",
    });
    const snapshot = sanitizePodInventory(parseJsonOutput(snapshotResult, "pre-existing pod snapshot"));
    const preexistingIds = new Set(snapshot.map((pod) => pod.id));
    await writeJsonAtomic(path.join(output, "control", "preexisting-pods.json"), snapshot);
    await writeJsonAtomic(path.join(output, "control", "preexisting-pod-ids.json"), [...preexistingIds].sort());
    const resumed = await loadResumePairs(options.resumeFrom, preflight, output, state);
    const pending = preflight.pairs.filter(({ pair }) => !resumed.has(pair.id));
    state.status = "running";
    state.updated_at = new Date().toISOString();
    await writeJsonAtomic(path.join(output, "state.json"), state);
    await runWorkerPool(
      pending,
      Math.min(preflight.document.pod.max_concurrency, Math.max(1, pending.length)),
      ({ arm, pair }) => runOnePair({
        preflight,
        arm,
        pair,
        output,
        executor,
        tools,
        createdIds,
        podRecords,
        reaperRecords,
        beforeRegister: () => verifyExactR9WorkerStartBoundary({
          manifestPath: preflight.manifestPath,
          manifestSha256: preflight.manifestSha256,
          output,
          pairId: pair.id,
          registeredRecords: reaperRecords,
          executor,
          expectedReaperPid: reaperService.pid,
          expectedReaperReceiptSha256: reaperService.receipt_sha256,
        }),
        beforeCreate: (pendingOwnership) => verifyExactR8MutationBoundary({
          manifestPath: preflight.manifestPath,
          manifestSha256: preflight.manifestSha256,
          output,
          pairId: pair.id,
          pendingOwnership,
          registeredRecords: reaperRecords,
          executor,
          expectedReaperPid: reaperService.pid,
          expectedReaperReceiptSha256: reaperService.receipt_sha256,
        }),
        ledgerMutationCoordinator,
        stopState,
        state,
      }),
    );
    if (stopState.signal) throw new Error(`received ${stopState.signal}`);
    if (createdIds.size !== 0) throw new Error("one or more exact created pod IDs remain after pair completion");
    const completed = preflight.pairs.filter(({ pair }) => state.pairs[pair.id]?.status === "completed");
    if (completed.length !== preflight.pairs.length) throw new Error("not every preregistered pair completed");
    state.status = "auditing";
    state.updated_at = new Date().toISOString();
    await writeJsonAtomic(path.join(output, "state.json"), state);
    const leaderboard = await auditMickeyCpuFanout({
      output,
      manifest: preflight.document,
      manifestSha256: preflight.manifestSha256,
    });
    const finalReaperService = await verifyLiveReaperService({
      manifest: preflight.document,
      manifestSha256: preflight.manifestSha256,
      executor,
    });
    validateFinalReaperServiceIdentity(reaperService, finalReaperService);
    await writeJsonAtomic(
      path.join(output, "control", "final-reaper-service.json"),
      finalReaperService,
    );
    await writeJsonAtomic(path.join(output, "evidence", "leaderboard.json"), leaderboard);
    state.status = "completed";
    state.evidence_eligible = true;
    state.policy_audit_status = leaderboard.policy_audit_status;
    state.screen_leader = leaderboard.screen_leader;
    state.completed_at = new Date().toISOString();
    state.updated_at = state.completed_at;
    await writeJsonAtomic(path.join(output, "state.json"), state);
    await writeJsonAtomic(path.join(output, "evidence", "run-verdict.json"), {
      schema_version: 1,
      run_id: state.run_id,
      manifest_sha256: state.manifest_sha256,
      transport_status: "completed",
      policy_audit_status: leaderboard.policy_audit_status,
      policy_audit_integrity_status: leaderboard.audit_integrity_status,
      leaderboard_sha256: await sha256File(path.join(output, "evidence", "leaderboard.json")),
      screen_leader: leaderboard.screen_leader,
      completed_pairs: completed.length,
      evidence_eligible: true,
      local_fanout_can_promote: false,
      upload_allowed: false,
      activation_receipt_sha256: preflight.activationEvidence.receipt_sha256,
      activation_ledger_state: preflight.activationEvidence.ledger_state,
      r8_recovery_receipt_sha256: preflight.activationEvidence.recovery_receipt_sha256,
      r8_recovery_record_state: preflight.activationEvidence.recovery_record_state,
    });
    await appendEvent(output, "fanout_completed", { completed_pairs: completed.length });
  } catch (error) {
    fatal = error;
    stopState.requested = true;
    executor.stop();
  } finally {
    const cleanupErrors = [];
    for (const [recordId, registration] of reaperRecords) {
      if (registration.preProviderDisposition === "pending_manual_block_unavailable") {
        await appendEvent(output, "pre_provider_record_cleanup_skipped", {
          record_id: recordId,
          disposition: registration.preProviderDisposition,
          provider_calls: 0,
        }).catch((error) => cleanupErrors.push(error.message));
        continue;
      }
      try {
        const cleanup = await ledgerMutationCoordinator.runExclusive(() => reconcileAndCleanupReaperRecord({
          ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
          recordId,
          runpodctl: tools.runpodctl,
          reaperClient: tools.reaperClient,
          executor,
          label: `final-cleanup-${recordId}`,
          createdIds,
          podRecords,
          expectedPreProviderPending:
            registration.preProviderDisposition === "blocked_pre_post_create_not_invoked"
              ? registration.preProviderPending
              : null,
          retryLedgerMutation: ledgerMutationCoordinator.retryExactServiceLock,
          expectedPendingOwnership: registration.pendingOwnership,
        }));
        if (cleanup.external_deadline_cleanup_required) {
          await appendEvent(output, "cleanup_pending_external_reaper", {
            record_id: recordId,
            deadline_cleanup_required: true,
          });
        }
      } catch (error) {
        cleanupErrors.push(error.message);
      }
    }
    if (cleanupErrors.length > 0) {
      fatal = new Error(`${fatal?.message || "run failed"}; cleanup errors: ${cleanupErrors.join("; ")}`);
    }
    if (fatal) {
      await quarantineOutputEvidence(output, fatal.message, state).catch((error) => {
        fatal = new Error(`${fatal.message}; quarantine failed: ${error.message}`);
      });
    }
  }
  if (fatal) throw fatal;
  process.stdout.write(`MICKEY_CPU_FANOUT_COMPLETE run_id=${state.run_id} output=${output}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`MICKEY_CPU_FANOUT_FAILED: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    },
  );
}
