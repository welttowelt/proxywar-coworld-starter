#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const target = process.argv[2];
const requireDiagnostic = process.argv.includes("--require-diagnostic");
const requirePromotion = process.argv.includes("--require-promotion");

if (!target || (requireDiagnostic && requirePromotion)) {
  throw new Error(
    "usage: validate-standard-rebuild.mjs <preflight.json> " +
      "[--require-diagnostic|--require-promotion]",
  );
}

const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const POLICY_LABEL = /^qd1n:v[1-9][0-9]*$/;
const POLICY_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_SOURCE_CLOSURE = new Set([
  "llm-player.mjs",
  "standard-controller.mjs",
  "controller-safety.mjs",
  "package.json",
  "package-lock.json",
  "Dockerfile",
]);
const CONTROL_RUNTIME_MODE = "credential-free-v97-deterministic-fallback";
const BENCHMARK_RUNTIME_FILES = new Set([
  "llm-player.mjs",
  "standard-controller.mjs",
  "controller-safety.mjs",
]);
const DISPATCH_PODS = Object.freeze([
  { id: "7p0nqjordosvuy", name: "storm-evidence-32a", map: "Pangaea", role: "candidate" },
  { id: "9u8oumfcvyyhy5", name: "storm-evidence-32b", map: "Pangaea", role: "control" },
  { id: "877itccar33zdp", name: "storm-lazy-c", map: "World", role: "candidate" },
  { id: "76stn0v7q81d47", name: "storm-lazy-d", map: "World", role: "control" },
]);

const errors = [];
const preflight = JSON.parse(await readFile(target, "utf8"));

function error(message) {
  errors.push(message);
}

function isEmpty(value) {
  return Array.isArray(value) && value.length === 0;
}

async function boundJson(binding, label) {
  if (
    !binding ||
    typeof binding.path !== "string" ||
    !binding.path.startsWith("/") ||
    !SHA256.test(binding.sha256 ?? "")
  ) {
    error(`${label} binding is invalid`);
    return null;
  }
  let bytes;
  try {
    bytes = await readFile(binding.path);
  } catch {
    error(`${label} is unavailable`);
    return null;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== binding.sha256) {
    error(`${label} SHA-256 mismatched`);
    return null;
  }
  try {
    return JSON.parse(bytes);
  } catch {
    error(`${label} is not JSON`);
    return null;
  }
}

function validateArtifactBindings(audit, candidate) {
  if (audit?.image_binding_method !== "docker-image-id+git-commit+revision-label") {
    error("candidate runtime closure is not bound to Git and the Docker image ID");
  }
  if (
    audit?.source_commit_verified !== true ||
    audit?.image_revision_label !== candidate.source_commit ||
    typeof audit?.candidate_source_repo !== "string" ||
    !audit.candidate_source_repo.startsWith("/")
  ) {
    error("candidate Git commit/revision-label binding is invalid");
  }
  const artifacts = Array.isArray(audit?.artifacts) ? audit.artifacts : [];
  const names = new Set(artifacts.map((entry) => entry.path));
  if (
    artifacts.length !== EXPECTED_SOURCE_CLOSURE.size ||
    names.size !== EXPECTED_SOURCE_CLOSURE.size ||
    [...EXPECTED_SOURCE_CLOSURE].some((name) => !names.has(name))
  ) {
    error("audit must bind exactly the six-file committed runtime closure");
  }
  for (const artifact of artifacts) {
    if (!EXPECTED_SOURCE_CLOSURE.has(artifact.path) ||
        !SHA256.test(artifact.source_sha256 ?? "")) {
      error(`runtime closure artifact ${artifact.path ?? "unknown"} is not Git-bound`);
      continue;
    }
    if (artifact.path === "Dockerfile") {
      if (
        artifact.image_sha256 !== null ||
        artifact.binding !== "git-blob+image-revision-label"
      ) error("Dockerfile is not bound through the exact image revision label");
    } else if (
      artifact.source_sha256 !== artifact.image_sha256 ||
      artifact.binding !== "git-blob+docker-image-id"
    ) {
      error(`runtime artifact ${artifact.path} is not byte-identical`);
    }
  }
  if (audit?.candidate_source_commit !== candidate.source_commit) {
    error("audit candidate source commit mismatched");
  }
  if (audit?.candidate_image_id !== candidate.image_id) {
    error("audit candidate image ID mismatched");
  }
  if (audit?.parent_source_commit !== candidate.parent_commit) {
    error("audit parent source commit mismatched");
  }
  if (audit?.parent_image_id !== candidate.parent_image_id) {
    error("audit parent image ID mismatched");
  }
}

function validatePreregistration(audit, candidate) {
  const prereg = audit?.preregistration ?? {};
  const specs = Array.isArray(prereg.specs) ? prereg.specs : [];
  const cells = specs.map((spec) => `${spec?.map}/${spec?.arm}`);
  if (
    typeof prereg.path !== "string" || prereg.path.startsWith("/") ||
    !SHA256.test(prereg.sha256 ?? "") ||
    prereg.candidate_source_commit !== candidate.source_commit ||
    prereg.source_commit_bound !== true ||
    prereg.parent_label !== "qd1n:v97" ||
    prereg.parent_source_commit !== candidate.parent_commit ||
    prereg.parent_image_id !== candidate.parent_image_id ||
    specs.length !== 4 || new Set(cells).size !== 4 ||
    [...new Set(["Pangaea/candidate", "Pangaea/control", "World/candidate", "World/control"])]
      .some((cell) => !cells.includes(cell))
  ) {
    error("committed preregistration binding is invalid");
  }
  for (const spec of specs) {
    if (
      typeof spec?.path !== "string" || spec.path.startsWith("/") ||
      !SHA256.test(spec?.sha256 ?? "") || !Number.isInteger(spec?.seat)
    ) error("committed experiment spec binding is invalid");
  }
}

function validateDispatcher(audit) {
  const dispatcher = audit?.dispatcher ?? {};
  const pods = Array.isArray(dispatcher.pods) ? dispatcher.pods : [];
  if (
    dispatcher.verified !== true || !SHA256.test(dispatcher.sha256 ?? "") ||
    typeof dispatcher.run_id !== "string" ||
    typeof dispatcher.execution_id !== "string" ||
    !SHA256.test(dispatcher.dispatcher_script_sha256 ?? "") ||
    pods.length !== 4
  ) error("four-pod dispatcher attestation failed");
  for (let index = 0; index < DISPATCH_PODS.length; index++) {
    const expected = DISPATCH_PODS[index];
    const pod = pods[index] ?? {};
    const run = audit?.runs?.find((entry) =>
      entry?.map === expected.map && entry?.arm === expected.role
    );
    if (
      pod.index !== index || pod.id !== expected.id || pod.name !== expected.name ||
      pod.map !== expected.map || pod.role !== expected.role ||
      pod.pre_start_status !== "EXITED" || pod.post_stop_status !== "EXITED" ||
      pod.formal_receipt_sha256 !== run?.runner_receipt_sha256 ||
      (expected.role === "candidate"
        ? !SHA256.test(pod.qualifier_receipt_sha256 ?? "")
        : pod.qualifier_receipt_sha256 !== null)
    ) error(`${expected.map}/${expected.role} dispatcher attestation failed`);
  }
}

function validateRun(run, candidate) {
  const prefix = `${run.map ?? "unknown"}/${run.arm ?? "unknown"}`;
  if (!SHA256.test(run.replay_sha256 ?? "")) error(`${prefix} replay hash is invalid`);
  if (
    !SHA256.test(run.decisions_sha256 ?? "") ||
    !(Number.isInteger(run.decisions_bytes) && run.decisions_bytes > 0) ||
    run.decisions_receipt_bound !== true
  ) error(`${prefix} decisions artifact proof is invalid`);
  if (!(Number.isInteger(run.decision_count) && run.decision_count > 0)) {
    error(`${prefix} has no decisions`);
  }
  if (
    !SHA256.test(run.preregistration_sha256 ?? "") ||
    typeof run.spec_path !== "string" || run.spec_path.startsWith("/") ||
    !SHA256.test(run.spec_sha256 ?? "") ||
    run.run_spec_sha256 !== run.spec_sha256 ||
    !SHA256.test(run.matched_plan_sha256 ?? "")
  ) error(`${prefix} committed spec/run-plan binding failed`);
  if (run.accepted_decisions !== run.decision_count) {
    error(`${prefix} decisions were not all accepted`);
  }
  for (const field of [
    "illegal_decisions",
    "rejected_decisions",
    "unexplained_holds",
    "normal_phase_k1z_harm",
    "unresolved_harmful_targets",
  ]) {
    if (!isEmpty(run[field])) error(`${prefix} ${field} is not empty`);
  }
  if (run.arm === "candidate") {
    for (const field of ["fallback_decisions", "degraded_decisions"]) {
      if (!isEmpty(run[field])) error(`${prefix} ${field} is not empty`);
    }
  } else {
    const expected = Array.isArray(run.fallback_decisions) &&
      Array.isArray(run.degraded_decisions) &&
      run.fallback_decisions.length === run.decision_count &&
      run.degraded_decisions.length === run.decision_count &&
      run.fallback_decisions.every((entry) => /^(?:rul|dgd):/.test(entry?.reason ?? ""));
    if (!expected) error(`${prefix} control degradation is not the declared v97 fallback mode`);
  }
  if (run.all_selected_ids_offered !== true) {
    error(`${prefix} selected an action that was not offered`);
  }
  if (run.arm === "candidate") {
    const opening = run.opening ?? {};
    if (!(opening.active_decisions >= 20 && opening.conquest_actions >= 17)) {
      error(`${prefix} opening conquest floor failed`);
    }
    if (
      opening.proactive_social_actions !== 0 ||
      opening.reverse_handshakes > 1 ||
      opening.build_actions > 1 ||
      opening.upgrade_actions !== 0 ||
      opening.boat_actions !== opening.forced_neutral_boat_actions ||
      !(opening.neutral_land_attacks > 0) ||
      !isEmpty(opening.neutral_land_attack_percent_violations)
    ) {
      error(`${prefix} opening discipline failed`);
    }
  }
  if (run.arm === "candidate" && run.image_id !== candidate.image_id) {
    error(`${prefix} candidate image ID mismatched`);
  }
  if (run.arm === "control" && run.image_id !== candidate.parent_image_id) {
    error(`${prefix} control image ID mismatched`);
  }
}

function validateLocalAudit(audit, candidate) {
  if (!audit) return;
  if (audit.schema_version !== 1 || audit.profile !== "standard-rebuild") {
    error("local audit schema/profile mismatched");
  }
  if (audit.verdict !== "PASS_STANDARD_REBUILD" || !isEmpty(audit.failures)) {
    error("local standard-rebuild gate did not pass");
  }
  if (audit.control_runtime_mode !== CONTROL_RUNTIME_MODE) {
    error("local audit control runtime mode mismatched");
  }
  validateArtifactBindings(audit, candidate);
  validatePreregistration(audit, candidate);
  validateDispatcher(audit);

  const benchmark = audit.benchmark ?? {};
  if (
    !(benchmark.iterations >= 10_000) ||
    !(benchmark.p95_ms < 5) ||
    !(benchmark.p99_ms < 10) ||
    !(benchmark.max_ms < 100) ||
    benchmark.action_count !== 47 ||
    JSON.stringify(benchmark.measured_path) !==
      JSON.stringify(["JSON.parse", "decideResponse", "JSON.stringify"]) ||
    benchmark.candidate_binding_verified !== true ||
    benchmark.executed_runtime_verified !== true ||
    benchmark?.executed_runtime?.image_id !== candidate.image_id ||
    !benchmark?.executed_runtime?.files ||
    Object.keys(benchmark.executed_runtime.files).length !== BENCHMARK_RUNTIME_FILES.size ||
    [...BENCHMARK_RUNTIME_FILES].some((name) =>
      !SHA256.test(benchmark.executed_runtime.files[name] ?? "")) ||
    !SHA256.test(benchmark?.producer?.script_sha256 ?? "") ||
    typeof benchmark?.producer?.script_path !== "string"
  ) {
    error("10,000-decision latency/provenance gate failed");
  }
  const qualifier = audit.qualifier ?? {};
  if (
    qualifier.passed !== true ||
    !(qualifier.decision_count > 0) ||
    qualifier.accepted_decisions !== qualifier.decision_count ||
    qualifier.fallback_decisions !== 0 ||
    qualifier.degraded_decisions !== 0 ||
    qualifier.rejected_decisions !== 0 ||
    qualifier.illegal_decisions !== 0 ||
    qualifier.all_selected_ids_offered !== true ||
    qualifier.result_counters_match !== true ||
    qualifier.candidate_binding_verified !== true ||
    qualifier.artifacts_verified !== true ||
    qualifier.runner_attestation_verified !== true ||
    qualifier.runner_attestation_independently_verified !== true ||
    !SHA256.test(qualifier?.producer?.script_sha256 ?? "") ||
    typeof qualifier?.producer?.script_path !== "string"
  ) {
    error("crash qualifier/provenance gate failed");
  }

  const runs = Array.isArray(audit.runs) ? audit.runs : [];
  if (runs.length !== 4) error("local audit must contain exactly four runs");
  for (const run of runs) {
    validateRun(run, candidate);
    const boundSpec = audit?.preregistration?.specs?.find((spec) =>
      spec?.map === run?.map && spec?.arm === run?.arm
    );
    if (
      run?.preregistration_sha256 !== audit?.preregistration?.sha256 ||
      run?.spec_path !== boundSpec?.path ||
      run?.spec_sha256 !== boundSpec?.sha256 ||
      run?.seat !== boundSpec?.seat
    ) error(`${run?.map ?? "unknown"}/${run?.arm ?? "unknown"} run is not preregistered`);
  }
  const replayHashes = runs.map((run) => run.replay_sha256);
  if (new Set(replayHashes).size !== replayHashes.length) {
    error("four local replays must be distinct");
  }
  for (const map of ["Pangaea", "World"]) {
    const pair = runs.filter((run) => run.map === map);
    if (
      pair.length !== 2 ||
      pair.filter((run) => run.arm === "candidate").length !== 1 ||
      pair.filter((run) => run.arm === "control").length !== 1
    ) {
      error(`${map} must contain one isolated candidate/control pair`);
      continue;
    }
    const candidateRun = pair.find((run) => run.arm === "candidate");
    const controlRun = pair.find((run) => run.arm === "control");
    if (!(candidateRun.score > controlRun.score)) {
      error(`${map} candidate score did not beat v97`);
    }
    if (!(candidateRun.final_tiles > controlRun.final_tiles)) {
      error(`${map} candidate final tiles did not beat v97`);
    }
    if (
      candidateRun.seed !== controlRun.seed ||
      candidateRun.seat !== controlRun.seat ||
      candidateRun.roster_sha256 !== controlRun.roster_sha256 ||
      candidateRun.matched_plan_sha256 !== controlRun.matched_plan_sha256
    ) {
      error(`${map} pair is not seed/seat/full-plan matched`);
    }
  }
  const candidates = runs.filter((run) => run.arm === "candidate");
  const controls = runs.filter((run) => run.arm === "control");
  const candidateTiles = candidates.reduce((sum, run) => sum + Number(run.final_tiles), 0);
  const controlTiles = controls.reduce((sum, run) => sum + Number(run.final_tiles), 0);
  if (!(candidateTiles >= controlTiles * 1.2)) {
    error("combined candidate tiles are below the 1.20x gate");
  }
  if (!candidates.some((run) => run.won === true)) {
    error("candidate did not finish first in either local cell");
  }
}

function validateRci(receipt, candidate, final = false) {
  if (!receipt) return;
  const expected = final ? "PASS_FINAL_RCI" : "PASS_PREUPLOAD_RCI";
  if (
    receipt.schema_version !== 1 ||
    receipt.verdict !== expected ||
    !isEmpty(receipt.unresolved_violations) ||
    receipt.candidate_source_commit !== candidate.source_commit ||
    receipt.candidate_image_id !== candidate.image_id
  ) {
    error(`${final ? "final" : "pre-upload"} RCI receipt failed`);
  }
  if (final && receipt.candidate_policy_version_id !== candidate.policy_version_id) {
    error("final RCI policy-version ID mismatched");
  }
}

function validateUpload(receipt, candidate) {
  if (!receipt) return;
  if (
    receipt.schema_version !== 2 ||
    receipt.mode !== "diagnostic" ||
    receipt.status !== "completed" ||
    receipt.candidate_source_commit !== candidate.source_commit ||
    receipt.candidate_image_id !== candidate.image_id ||
    receipt.uploaded_label !== candidate.uploaded_label ||
    receipt.policy_version_id !== candidate.policy_version_id
  ) {
    error("diagnostic upload receipt mismatched");
  }
}

if (preflight.schema_version !== 2) error("schema_version must be 2");
if (preflight.profile !== "standard-rebuild") error("profile must be standard-rebuild");
const candidate = preflight.candidate ?? {};
if (typeof candidate.policy_ref !== "string" || candidate.policy_ref === "") {
  error("candidate.policy_ref is required");
}
if (candidate.parent_label !== "qd1n:v97") error("exact parent must be qd1n:v97");
if (!COMMIT.test(candidate.source_commit ?? "")) error("candidate source commit is invalid");
if (!COMMIT.test(candidate.parent_commit ?? "")) error("candidate parent commit is invalid");
if (!IMAGE_ID.test(candidate.image_id ?? "")) error("candidate image ID is invalid");
if (!IMAGE_ID.test(candidate.parent_image_id ?? "")) error("parent image ID is invalid");
if (candidate.runtime_requires_bedrock !== false) error("standard runtime must disable Bedrock");
if (preflight.release?.automatic !== true || preflight.release?.local_games !== 4) {
  error("standard rebuild must bind the automatic four-game release contract");
}

if (requireDiagnostic || requirePromotion) {
  const audit = await boundJson(preflight.local?.audit_receipt, "local audit");
  validateLocalAudit(audit, candidate);
  const preupload = await boundJson(preflight.rci?.preupload_receipt, "pre-upload RCI");
  validateRci(preupload, candidate, false);
}

if (requirePromotion) {
  if (!POLICY_LABEL.test(candidate.uploaded_label ?? "")) {
    error("candidate uploaded label is invalid");
  }
  if (!POLICY_VERSION_ID.test(candidate.policy_version_id ?? "")) {
    error("candidate policy-version ID is invalid");
  }
  const upload = await boundJson(candidate.upload_receipt, "upload receipt");
  validateUpload(upload, candidate);
  const finalRci = await boundJson(preflight.rci?.final_receipt, "final RCI");
  validateRci(finalRci, candidate, true);
}

const valid = errors.length === 0;
const report = {
  valid,
  profile: "standard-rebuild",
  strict_mode: requirePromotion
    ? "promotion"
    : requireDiagnostic
      ? "diagnostic"
      : null,
  promotion_eligible: valid && requirePromotion,
  errors,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!valid) process.exitCode = 1;
