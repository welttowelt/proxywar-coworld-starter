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
  bindActivePod,
  confirmOwnedPodAbsent,
  isStructuredProviderNotFound,
  preparePendingCreate,
  readReaperLedger,
  runReaperOnce,
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
const EXACT_ID_DELETE_RETRY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);
const FULL_FANOUT_LIVE_APPROVED = false;

function durableInstallationId(document) {
  return createHash("sha256").update([
    document.runpodctl.source_commit,
    document.runpodctl.source_tree,
    document.runpodctl.sha256,
    document.control_plane.exact_id_reaper.sha256,
    document.cleanup_watchdog.node_runtime.sha256,
  ].join("\n"), "utf8").digest("hex");
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
  Full fanout live execution remains fail-closed pending a separate end-to-end
  execution RCI. Source-level transport approval does not enable it. Only the
  separate one-pod no-env transport canary is approved for a live mutation.
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

export function validateManifest(document) {
  assertNoSecretKeys(document);
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
    ],
    "manifest",
  );
  if (document.schema_version !== 3 || document.kind !== "mickey_cpu_fanout") {
    throw new Error("manifest schema_version/kind must be 3/mickey_cpu_fanout");
  }
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
      "reaper_launchd_renderer",
    ],
    "manifest.control_plane",
  );
  const controlPlanePaths = {
    fanout_runner: SCRIPT_PATH,
    policy_auditor: AUDIT_SCRIPT,
    remote_verifier: REMOTE_VERIFIER,
    exact_id_reaper: REAPER_SCRIPT,
    reaper_launchd_renderer: REAPER_LAUNCHD_RENDERER,
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
  if (
    document.cleanup_watchdog.installation_id !== installationId ||
    document.cleanup_watchdog.state_root !== durable.root ||
    document.cleanup_watchdog.bin_root !== durable.binRoot ||
    document.cleanup_watchdog.installations_root !== durable.installationsRoot ||
    document.cleanup_watchdog.installation_directory !== durable.installationDirectory ||
    document.cleanup_watchdog.script.path !== durable.reaper ||
    document.cleanup_watchdog.script.install_source_path !== REAPER_SCRIPT ||
    document.cleanup_watchdog.script.sha256 !== document.control_plane.exact_id_reaper.sha256 ||
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
    document.cleanup_watchdog.service_receipt_path !== `${durable.root}/service-receipt.json`
  ) {
    throw new Error("manifest cleanup watchdog state files must stay in the exact durable reaper root");
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
  return {
    ...validated,
    manifestPath,
    manifestSha256: actualManifestSha256,
    verifierPath: REMOTE_VERIFIER,
    verifierSha256,
    sourceReceipt,
  };
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function dryRunPodName(manifest) {
  return `${manifest.pod.name_prefix}-${"0".repeat(32)}`;
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

export function validateCreatedPod(
  record,
  { expectedName, preexistingIds, maxCost = 0.1, requireNetworkVolumeInspection = false },
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
  if (requireNetworkVolumeInspection) {
    const inspection = record.networkVolumeInspection;
    if (!isObject(inspection) || inspection.includeNetworkVolumeRequested !== true) {
      throw new Error("created pod lacks explicit network-volume inspection");
    }
    const idObservation = inspection.networkVolumeId;
    const volumeObservation = inspection.networkVolume;
    if (!isObject(idObservation) || !isObject(volumeObservation)) {
      throw new Error("created pod network-volume inspection is malformed");
    }
    const observations = [idObservation, volumeObservation].filter((entry) => entry.present === true);
    if (observations.length === 0) {
      throw new Error("RunPod omitted both network-volume fields from explicit inspection");
    }
    if (idObservation.present === true && idObservation.value !== null && idObservation.value !== "") {
      throw new Error("created pod has a networkVolumeId");
    }
    if (volumeObservation.present === true && volumeObservation.value !== null) {
      throw new Error("created pod has an attached networkVolume");
    }
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
      controlSecret === null ||
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
    (controlSecret === null && record.responseControlSecretScrubbed !== false)
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
    await realpath(receiptPath) !== receiptPath
  ) {
    throw new Error("independent reaper service receipt is missing or unsafe");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
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
  if (servicePid !== receipt.pid) {
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
    ledger_path: receipt.ledger_path,
    receipt_path: receiptPath,
    provider_probe: { status: heartbeat.status, pod_count: heartbeat.pod_count, age_ms: heartbeatAgeMs },
  };
}

async function assertClaimedMickeyOutput(output, runId, runnerLease, stateRoot, executor) {
  await validateClaimedOutputShape(output, runId, stateRoot);
  const statusResult = await executor.run(runnerLease, ["status", "--json"], { label: "runner-status" });
  const status = parseJsonOutput(statusResult, "runner status");
  if (
    status.state !== "active" ||
    status.owner !== RUNNER_OPERATOR_LANE ||
    status.run_id !== runId ||
    status.supervisor_alive !== true ||
    status.child_alive !== true ||
    status.reap_in_progress !== false ||
    !Array.isArray(status.outputs) ||
    !status.outputs.includes(output)
  ) {
    throw new Error("exact Mickey foreground runner lease is not active for this output");
  }
  return status;
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

export async function reconcileAndCleanupReaperRecord({
  ledgerPath,
  recordId,
  runpodctl,
  reaperClient,
  executor,
  label,
  createdIds = new Set(),
  podRecords = new Map(),
  settle,
}) {
  await runReaperOnce({ ledgerPath, client: reaperClient });
  let record = await reaperRecord(ledgerPath, recordId);
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
    record = await confirmOwnedPodAbsent({
      ledgerPath,
      client: reaperClient,
      recordId,
    });
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
  record = await confirmOwnedPodAbsent({
    ledgerPath,
    client: reaperClient,
    recordId,
  });
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
  try {
    const createNow = Date.now();
    const controlSecret = randomBytes(32).toString("hex");
    const watchdogDeadline = new Date(
      createNow + preflight.document.cleanup_watchdog.client_cleanup_deadline_seconds * 1000,
    ).toISOString();
    const pendingOwnership = await preparePendingCreate({
      ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
      client: tools.reaperClient,
      runId: `${preflight.document.run_id}:${pair.id}`,
      manifestSha256: preflight.manifestSha256,
      deadline: watchdogDeadline,
      namePrefix: preflight.document.pod.name_prefix,
    });
    cleanupRecordId = pendingOwnership.record_id;
    reaperRecords.set(cleanupRecordId, { pairId: pair.id });
    name = pendingOwnership.expected_name;
    const pairPreexistingIds = new Set(pendingOwnership.preexisting_ids);
    await writeJsonAtomic(path.join(activeRoot, "reaper-pending-create.json"), pendingOwnership);
    state.pairs[pair.id] = {
      ...state.pairs[pair.id],
      phase: "create",
      pod_name: name,
      reaper_record_id: cleanupRecordId,
      client_cleanup_deadline: watchdogDeadline,
    };
    await writeJsonAtomic(path.join(output, "state.json"), state);
    let createResult;
    const controlStdin = Buffer.from(
      JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: controlSecret }),
      "utf8",
    );
    try {
      createResult = await executor.run(
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
      );
    } catch (error) {
      await runReaperOnce({
        ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
        client: tools.reaperClient,
      }).catch(() => null);
      throw new Error(`RunPod create transport failed before a trustworthy response: ${error.message}`);
    } finally {
      controlStdin.fill(0);
    }
    let createRecord;
    try {
      createRecord = parseJsonOutput(createResult, "RunPod create");
      podId = registerCreatedPod(createRecord, name, pairPreexistingIds, createdIds);
      const activeOwnership = await bindActivePod({
        ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
        client: tools.reaperClient,
        recordId: cleanupRecordId,
        podId,
      });
      await writeJsonAtomic(path.join(activeRoot, "reaper-active-binding.json"), activeOwnership);
    } catch (error) {
      await runReaperOnce({
        ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
        client: tools.reaperClient,
      }).catch(() => null);
      throw new Error(`RunPod create response was not cleanup-safe: ${error.message}`);
    }
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
    validateCreatedPod(
      { ...createRecord, ...listed[0], ...got, id: podId },
      { expectedName: name, preexistingIds: pairPreexistingIds, requireNetworkVolumeInspection: true },
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
          `set -euo pipefail; ${remoteQuote(runner)} --spec ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} --validate-only > ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt.part`)}; mv -- ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt.part`)} ${remoteQuote(`${remoteRoot}/evidence/${role}-validation.txt`)}; ${remoteQuote(runner)} --spec ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} --output-dir ${remoteQuote(outputDir)} --run-id ${remoteQuote(episodeRunId)} | tee ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log.part`)}; mv -- ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log.part`)} ${remoteQuote(`${remoteRoot}/runs/${role}.stdout.log`)}; cp ${remoteQuote(`${bundleRoot}/${spec.archive_path}`)} ${remoteQuote(`${outputDir}/config.json`)}; ${remoteQuote(`${bundleRoot}/runtime/node/bin/node`)} -e ${remoteQuote("const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(r.status!=='passed'||r.post_run_attestation?.status!=='passed')process.exit(1)")} ${remoteQuote(`${outputDir}/receipt.json`)}`,
        ],
        { label: `${pair.id}-run-${role}` },
      );
    }

    state.pairs[pair.id].phase = "hash-and-fetch";
    await writeJsonAtomic(path.join(output, "state.json"), state);
    await executor.run(
      tools.ssh,
      [
        ...ssh,
        remote,
        `set -euo pipefail; cp ${remoteQuote(`${remoteStage}/extract.json`)} ${remoteQuote(`${remoteRoot}/evidence/extract.json`)}; cp ${remoteQuote(`${remoteStage}/pair-contract.json`)} ${remoteQuote(`${remoteRoot}/evidence/pair-contract.json`)}; cd ${remoteQuote(remoteRoot)}; find runs evidence -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > artifacts.sha256.part; mv -- artifacts.sha256.part artifacts.sha256`,
      ],
      { label: `${pair.id}-remote-hash` },
    );
    const fetchPart = path.join(activeRoot, "fetched.part");
    await mkdir(fetchPart, { mode: 0o700 });
    for (const remoteItem of ["runs", "evidence", "artifacts.sha256"]) {
      await executor.run(
        tools.scp,
        [...scp, "-r", `${remote}:${remoteRoot}/${remoteItem}`, `${fetchPart}/`],
        { label: `${pair.id}-fetch-${remoteItem}` },
      );
    }
    const fetchVerification = await verifyFetchedArtifacts(fetchPart);
    await writeJsonAtomic(path.join(activeRoot, "fetch-verification.json"), fetchVerification);
    await rename(fetchPart, path.join(activeRoot, "fetched"));

    const deletion = await reconcileAndCleanupReaperRecord({
      ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
      recordId: cleanupRecordId,
      runpodctl: tools.runpodctl,
      reaperClient: tools.reaperClient,
      executor,
      label: `${pair.id}-pod-delete`,
      createdIds,
      podRecords,
    });
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
    let terminalError = error;
    if (cleanupRecordId) {
      try {
        const cleanup = await reconcileAndCleanupReaperRecord({
          ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
          recordId: cleanupRecordId,
          runpodctl: tools.runpodctl,
          reaperClient: tools.reaperClient,
          executor,
          label: `${pair.id}-failure-cleanup`,
          createdIds,
          podRecords,
        });
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

async function runWorkerPool(items, concurrency, worker, stopState, onFailure) {
  let index = 0;
  let firstError = null;
  const threads = Array.from({ length: concurrency }, async () => {
    while (!firstError && index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (error) {
        firstError ??= error;
        stopState.requested = true;
        onFailure?.(error);
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
  const preflight = await preflightManifest(
    options.manifest,
    options.manifestSha256,
    { requirePersistentServiceArtifacts: !options.dryRun && FULL_FANOUT_LIVE_APPROVED },
  );
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
      full_fanout_live_approved: FULL_FANOUT_LIVE_APPROVED,
      transport_canary_live_approved: true,
      full_fanout_blocking_reason:
        "full fanout end-to-end execution awaits separate RCI approval",
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

  if (!FULL_FANOUT_LIVE_APPROVED) {
    throw new Error(
      "full fanout live execution is blocked before mutation: end-to-end execution awaits separate RCI approval; only the no-env one-pod transport canary is approved",
    );
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
  await appendEvent(output, "preflight_passed", { pair_count: preflight.pairs.length });

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
        stopState,
        state,
      }),
      stopState,
      () => executor.stop(),
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
    });
    await appendEvent(output, "fanout_completed", { completed_pairs: completed.length });
  } catch (error) {
    fatal = error;
    stopState.requested = true;
    executor.stop();
  } finally {
    const cleanupErrors = [];
    for (const recordId of reaperRecords.keys()) {
      try {
        const cleanup = await reconcileAndCleanupReaperRecord({
          ledgerPath: preflight.document.cleanup_watchdog.ledger_path,
          recordId,
          runpodctl: tools.runpodctl,
          reaperClient: tools.reaperClient,
          executor,
          label: `final-cleanup-${recordId}`,
          createdIds,
          podRecords,
        });
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
