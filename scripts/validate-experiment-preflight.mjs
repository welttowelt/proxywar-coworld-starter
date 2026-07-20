import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) {
  throw new Error(
    "usage: node validate-experiment-preflight.mjs <preflight.json> " +
    "[--require-diagnostic|--require-promotion]",
  );
}

const requireDiagnostic = process.argv.includes("--require-diagnostic");
const requirePromotion = process.argv.includes("--require-promotion");
if (requireDiagnostic && requirePromotion) {
  throw new Error("choose exactly one strict validation mode");
}

const preflight = JSON.parse(await readFile(target, "utf8"));
const errors = [];
const warnings = [];
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_LABEL = /^qd1n:v[1-9][0-9]*$/;
const ODIN_PLAYER_ID = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_DIFFERENTIAL_VERIFIER = "experiments/odc1/verify-differential.mjs";
const LEGACY_DIFFERENTIAL_FIXTURE = "experiments/odc1/differential-fixture.json";

const requireString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label} is required`);
};
const emptyArray = (value) => Array.isArray(value) && value.length === 0;
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const safeRepositoryPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..");
const safeExperimentArtifact = (value) =>
  safeRepositoryPath(value) && value.startsWith("experiments/");

function committedArtifact(commit, artifactPath, label) {
  if (!COMMIT.test(commit ?? "") || !safeRepositoryPath(artifactPath)) {
    errors.push(`${label} provenance is invalid`);
    return null;
  }
  try {
    return execFileSync(
      "git",
      ["-C", REPOSITORY, "show", `${commit}:${artifactPath}`],
    );
  } catch {
    errors.push(`${label} commit or path is unavailable`);
    return null;
  }
}

async function loadBoundReceipt(binding, label) {
  if (!binding || typeof binding !== "object") {
    errors.push(`${label} binding is required`);
    return null;
  }
  if (typeof binding.path !== "string" || !path.isAbsolute(binding.path)) {
    errors.push(`${label}.path must be absolute`);
    return null;
  }
  if (!SHA256.test(binding.sha256 ?? "")) {
    errors.push(`${label}.sha256 must be a full SHA-256`);
    return null;
  }
  let bytes;
  try {
    bytes = await readFile(binding.path);
  } catch {
    errors.push(`${label} file is unavailable`);
    return null;
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== binding.sha256) {
    errors.push(`${label} SHA-256 mismatched`);
    return null;
  }
  try {
    const parsed = JSON.parse(bytes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(`${label} must contain one JSON object`);
      return null;
    }
    return parsed;
  } catch {
    errors.push(`${label} is not valid JSON`);
    return null;
  }
}

function receiptIdentityMatches(receipt, label, candidate, {
  requirePolicyVersion = false,
} = {}) {
  if (receipt.candidate_source_commit !== candidate.source_commit) {
    errors.push(`${label} candidate source commit mismatched`);
  }
  if (receipt.candidate_image_id !== candidate.image_id) {
    errors.push(`${label} candidate image ID mismatched`);
  }
  if (
    requirePolicyVersion &&
    receipt.candidate_policy_version_id !== candidate.policy_version_id
  ) {
    errors.push(`${label} candidate policy-version ID mismatched`);
  }
}

function validateLocalReceipt(receipt, candidate, preflightValue) {
  if (!receipt) return;
  if (receipt.schema_version !== 2) errors.push("local audit schema_version must be 2");
  const mechanismOnly = receipt.verdict === "PASS_MECHANISM_SCREEN";
  if (![
    "PASS_MECHANISM_SCREEN",
    "PASS_LOCAL_SCREEN",
    "PASS_LOCAL_QUALIFIED",
  ].includes(receipt.verdict)) {
    errors.push("local audit did not pass");
  }
  if (mechanismOnly && (
    receipt.screen_mode !== "mechanism" ||
    receipt.competitive_evidence !== false
  )) {
    errors.push("mechanism screen must explicitly disclaim local competitive lift");
  }
  if (!emptyArray(receipt.failures)) errors.push("local audit has unresolved failures");
  receiptIdentityMatches(receipt, "local audit", candidate);
  if (receipt.parent_source_commit !== candidate.parent_commit) {
    errors.push("local audit parent source commit mismatched");
  }
  if (
    !SHA256.test(preflightValue.local?.contract_sha256 ?? "") ||
    receipt.contract_sha256 !== preflightValue.local?.contract_sha256
  ) {
    errors.push("local audit contract SHA-256 mismatched or absent");
  }
  const runs = Array.isArray(receipt.runs) ? receipt.runs : [];
  if (runs.length < (mechanismOnly ? 1 : 2)) {
    errors.push(
      mechanismOnly
        ? "local mechanism audit requires one trace"
        : "local audit requires both seat orientations",
    );
    return;
  }
  const orientations = new Set();
  const replayHashes = new Set();
  for (const run of runs) {
    orientations.add(run.orientation);
    const replay = run.replay_sha256;
    if (!SHA256.test(replay ?? "")) {
      errors.push(`local ${run.orientation ?? "unknown"} replay hash is invalid`);
    } else if (replayHashes.has(replay)) {
      errors.push("local audit replay hashes are not distinct");
    } else {
      replayHashes.add(replay);
    }
    const candidateRun = run.candidate ?? {};
    for (const [field, value] of Object.entries({
      illegal_turns: candidateRun.illegal_turns,
      rejected_turns: candidateRun.rejected_turns,
      fallback_turns: candidateRun.fallback_turns,
      degradation_turns: candidateRun.degradation_turns,
      unexplained_holds: candidateRun.unexplained_holds,
      harmful_k1z_actions: candidateRun.harmful_k1z_actions,
      unresolved_harmful_targets: candidateRun.unresolved_harmful_targets,
    })) {
      if (!emptyArray(value)) {
        errors.push(`local ${run.orientation ?? "unknown"} ${field} is not empty`);
      }
    }
    if (!Number.isInteger(candidateRun.route_execution_count) ||
        candidateRun.route_execution_count < 1) {
      errors.push(`local ${run.orientation ?? "unknown"} mechanism had zero reach`);
    }
    if (!Number.isInteger(candidateRun.decision_count) ||
        candidateRun.decision_count < 1 ||
        candidateRun.accepted !== candidateRun.decision_count) {
      errors.push(`local ${run.orientation ?? "unknown"} decisions were not all accepted`);
    }
    const presentRoles = Array.isArray(run.coalition_roles_present)
      ? new Set(run.coalition_roles_present)
      : new Set();
    const requiredRoles = Array.isArray(receipt.required_coalition_roles)
      ? receipt.required_coalition_roles
      : [];
    if (mechanismOnly && !requiredRoles.some((role) => role !== "odin")) {
      errors.push("local mechanism audit requires a configured coalition partner");
    }
    if (!presentRoles.has("odin") ||
        requiredRoles.some((role) => !presentRoles.has(role))) {
      errors.push(`local ${run.orientation ?? "unknown"} coalition presence failed`);
    }
    if (!mechanismOnly) {
      const advantage = run.orientation_advantage ?? {};
      if (
        !(Number(advantage.score_delta) > 0) ||
        !(Number(advantage.tile_delta) > 0)
      ) {
        errors.push(
          `local ${run.orientation ?? "unknown"} candidate advantage was not positive`,
        );
      }
    }
    const resolvedCandidate =
      run.resolved_images?.images?.candidate?.image_id;
    if (resolvedCandidate !== candidate.image_id) {
      const harness = run.mechanism_harness ?? {};
      const binding = preflightValue.local?.mechanism_harness ?? {};
      const candidateEngine = committedArtifact(
        candidate.source_commit,
        "strategy-engine.mjs",
        "local mechanism harness candidate engine",
      );
      const candidateEngineSha = candidateEngine && createHash("sha256")
        .update(candidateEngine)
        .digest("hex");
      const artifactNames = ["player", "dockerfile"];
      const artifactsValid = artifactNames.every((name) => {
        const artifact = binding.artifacts?.[name] ?? {};
        const committed = safeExperimentArtifact(artifact.path)
          ? committedArtifact(
              binding.evaluator_commit,
              artifact.path,
              `local mechanism harness ${name}`,
            )
          : null;
        const committedSha = committed && createHash("sha256")
          .update(committed)
          .digest("hex");
        return (
          committed !== null &&
          SHA256.test(artifact.sha256 ?? "") &&
          artifact.sha256 === committedSha &&
          harness[name]?.path === artifact.path &&
          harness[name]?.sha256 === artifact.sha256
        );
      });
      if (
        !mechanismOnly ||
        receipt.competitive_evidence !== false ||
        !IMAGE_ID.test(resolvedCandidate ?? "") ||
        binding.resolved_image_id !== resolvedCandidate ||
        binding.base_candidate_image_id !== candidate.image_id ||
        binding.strategy_engine_sha256 !== candidateEngineSha ||
        !COMMIT.test(binding.evaluator_commit ?? "") ||
        harness.resolved_image_id !== resolvedCandidate ||
        harness.base_candidate_image_id !== candidate.image_id ||
        harness.evaluator_commit !== binding.evaluator_commit ||
        harness.strategy_engine_byte_match !== true ||
        !SHA256.test(harness.strategy_engine_sha256 ?? "") ||
        harness.strategy_engine_sha256 !== candidateEngineSha ||
        !artifactsValid
      ) {
        errors.push(
          `local ${run.orientation ?? "unknown"} resolved image ID mismatched`,
        );
      }
    }
  }
  if (!mechanismOnly && (!orientations.has("A") || !orientations.has("B"))) {
    errors.push("local audit must contain orientations A and B");
  }
  const expectedMarker = String(preflightValue.mechanism?.marker ?? "")
    .trim()
    .toLowerCase();
  const markerReach = runs.reduce(
    (total, run) =>
      total + Number(run.candidate?.marker_counts?.[expectedMarker] ?? 0),
    0,
  );
  if (!expectedMarker || markerReach < 1) {
    errors.push("local audit did not reach the preflight mechanism marker");
  }
  const proof = receipt.differential_unit_proof ?? {};
  if (
    proof.same_fixture !== true ||
    proof.test_exit_code !== 0 ||
    proof.parent?.source_commit !== candidate.parent_commit ||
    proof.candidate?.source_commit !== candidate.source_commit ||
    !proof.parent?.selected_action_id ||
    !proof.candidate?.selected_action_id ||
    proof.parent.selected_action_id === proof.candidate.selected_action_id
  ) {
    errors.push("local audit differential proof is incomplete or mismatched");
  }
  const verifier = proof.verifier ?? {};
  const differentialBinding = preflightValue.local?.differential_binding;
  const explicitBinding = differentialBinding !== undefined;
  const verifierPath = explicitBinding
    ? differentialBinding?.verifier_path
    : LEGACY_DIFFERENTIAL_VERIFIER;
  const fixturePath = explicitBinding
    ? differentialBinding?.fixture_path
    : LEGACY_DIFFERENTIAL_FIXTURE;
  const pathsShareDirectory =
    safeExperimentArtifact(verifierPath) &&
    safeExperimentArtifact(fixturePath) &&
    path.posix.dirname(verifierPath) === path.posix.dirname(fixturePath);
  if (
    !pathsShareDirectory ||
    verifier.path !== verifierPath ||
    (explicitBinding && proof.fixture?.path !== fixturePath) ||
    (!explicitBinding &&
      proof.fixture?.path !== undefined &&
      proof.fixture.path !== fixturePath) ||
    !COMMIT.test(verifier.evaluator_commit ?? "") ||
    !SHA256.test(verifier.sha256 ?? "")
  ) {
    errors.push("local audit differential verifier provenance is incomplete");
  } else {
    const committedVerifier = committedArtifact(
      verifier.evaluator_commit,
      verifierPath,
      "local audit differential verifier",
    );
    if (committedVerifier) {
      const actualVerifierSha = createHash("sha256")
        .update(committedVerifier)
        .digest("hex");
      if (actualVerifierSha !== verifier.sha256) {
        errors.push("local audit differential verifier SHA-256 mismatched");
      }
    }
  }
  if (!SHA256.test(proof.fixture?.sha256 ?? "")) {
    errors.push("local audit differential fixture SHA-256 is invalid");
  } else if (
    COMMIT.test(verifier.evaluator_commit ?? "") &&
    safeExperimentArtifact(fixturePath)
  ) {
    const committedFixture = committedArtifact(
      verifier.evaluator_commit,
      fixturePath,
      "local audit differential fixture",
    );
    if (committedFixture) {
      const actualFixtureSha = createHash("sha256")
        .update(committedFixture)
        .digest("hex");
      if (actualFixtureSha !== proof.fixture.sha256) {
        errors.push("local audit differential fixture SHA-256 mismatched");
      }
    }
  }
  const command = proof.test_command;
  const expectedOutput = safeExperimentArtifact(verifierPath)
    ? path.posix.join(
        path.posix.dirname(verifierPath),
        `differential-proof-${candidate.source_commit.slice(0, 8)}.json`,
      )
    : null;
  if (
    !Array.isArray(command) ||
    command.length !== 7 ||
    command[0] !== "node" ||
    command[1] !== verifierPath ||
    command[2] !== "." ||
    command[3] !== candidate.parent_commit ||
    command[4] !== candidate.source_commit ||
    command[5] !== fixturePath ||
    command[6] !== expectedOutput
  ) {
    errors.push("local audit differential command is not reproducibly bound");
  }
}

function validateRciReceipt(receipt, label, candidate, { final = false } = {}) {
  if (!receipt) return;
  const passed =
    receipt.status === "passed" ||
    ["PASS", "PASS_RCI", "PASS_PREUPLOAD_RCI", "RCI_AUDIT_PASSED"].includes(
      receipt.verdict,
    );
  if (!passed) errors.push(`${label} did not pass`);
  const unresolved = receipt.unresolved_violations;
  if (!(unresolved === 0 || emptyArray(unresolved))) {
    errors.push(`${label} has unresolved violations`);
  }
  receiptIdentityMatches(receipt, label, candidate, {
    requirePolicyVersion: final,
  });
  if (final) {
    const checks = receipt.checks ?? {};
    for (const field of [
      "source_identity",
      "image_identity",
      "roster_identity",
      "runtime_identity",
      "marker_integrity",
      "k1z_safety",
      "outcome_identity",
    ]) {
      if (checks[field] !== true) errors.push(`final RCI check ${field} did not pass`);
    }
  }
}

function validateUploadReceipt(receipt, candidate) {
  if (!receipt) return;
  if (receipt.status !== "completed" || receipt.mode !== "diagnostic") {
    errors.push("diagnostic upload receipt is not completed");
  }
  receiptIdentityMatches(receipt, "diagnostic upload receipt", candidate);
  if (receipt.candidate_policy_ref !== candidate.policy_ref) {
    errors.push("diagnostic upload policy ref mismatched");
  }
  if (receipt.uploaded_label !== candidate.uploaded_label) {
    errors.push("diagnostic upload label mismatched");
  }
  if (receipt.policy_version_id !== candidate.policy_version_id) {
    errors.push("diagnostic upload policy-version ID mismatched");
  }
}

function validateEpisodeSet(episodes, {
  label,
  expectedCount,
  candidate,
  requireMarker,
  requirePlanner,
  requireCoverage,
}) {
  if (!Array.isArray(episodes) || episodes.length !== expectedCount) {
    errors.push(`${label} requires exactly ${expectedCount} episodes`);
    return;
  }
  const ids = new Set();
  const replays = new Set();
  const maps = new Set();
  const seats = new Set();
  let markerExecutions = 0;
  for (const episode of episodes) {
    const id = episode.episode_id;
    if (typeof id !== "string" || id.trim() === "" || ids.has(id)) {
      errors.push(`${label} episode IDs are missing or duplicated`);
    } else {
      ids.add(id);
    }
    const replay = episode.replay_sha256;
    if (!SHA256.test(replay ?? "") || replays.has(replay)) {
      errors.push(`${label} replay hashes are invalid or duplicated`);
    } else {
      replays.add(replay);
    }
    if (episode.winner_player_id !== ODIN_PLAYER_ID) {
      errors.push(`${label} contains a non-Odin result`);
    }
    for (const field of ["holds", "rejections", "k1z_harm"]) {
      if (episode[field] !== 0) errors.push(`${label} ${field} must be zero`);
    }
    if (episode.candidate_policy_version_id !== candidate.policy_version_id) {
      errors.push(`${label} episode policy-version ID mismatched`);
    }
    if (!nonNegativeInteger(episode.marker_executions)) {
      errors.push(`${label} marker count is invalid`);
    } else {
      markerExecutions += episode.marker_executions;
    }
    if (requirePlanner && episode.planner_degradation_passed !== true) {
      errors.push(`${label} planner comparison did not pass`);
    }
    if (requireCoverage) {
      if (typeof episode.map !== "string" || episode.map.trim() === "") {
        errors.push(`${label} map is missing`);
      } else {
        maps.add(episode.map);
      }
      if (!Number.isInteger(episode.seat) || episode.seat < 0) {
        errors.push(`${label} seat is invalid`);
      } else {
        seats.add(episode.seat);
      }
    }
  }
  if (requireMarker && markerExecutions < 1) {
    errors.push(`${label} mechanism had zero reach`);
  }
  if (requireCoverage && (maps.size < 2 || seats.size < 2)) {
    errors.push(`${label} map-and-seat coverage is insufficient`);
  }
}

function validateHostedReceipt(receipt, candidate, preflightValue) {
  if (!receipt) return;
  if (receipt.verdict !== "PASS_HOSTED") errors.push("hosted audit did not pass");
  if (!emptyArray(receipt.violations)) {
    errors.push("hosted audit has unresolved violations");
  }
  receiptIdentityMatches(receipt, "hosted audit", candidate, {
    requirePolicyVersion: true,
  });
  if (receipt.request_id !== preflightValue.hosted?.request_id) {
    errors.push("hosted request ID mismatched");
  }
  if (receipt.baseline_request_id !== preflightValue.matched_baseline?.request_id) {
    errors.push("hosted baseline request ID mismatched");
  }
  if (!SHA256.test(receipt.roster_sha256 ?? "")) {
    errors.push("hosted roster hash is not pinned");
  }
  requireString(receipt.variant, "hosted audit variant");
  validateEpisodeSet(receipt.episodes, {
    label: "hosted audit",
    expectedCount: 4,
    candidate,
    requireMarker: true,
    requirePlanner: true,
    requireCoverage: false,
  });
}

function validateRegressionReceipt(receipt, candidate, preflightValue) {
  if (!receipt) return;
  if (receipt.verdict !== "PASS_REGRESSION") errors.push("regression audit did not pass");
  receiptIdentityMatches(receipt, "regression audit", candidate, {
    requirePolicyVersion: true,
  });
  if (
    typeof receipt.request_id !== "string" ||
    !receipt.request_id.startsWith("xreq_") ||
    receipt.request_id !== preflightValue.promotion?.request_id
  ) {
    errors.push("regression request ID mismatched or absent");
  }
  validateEpisodeSet(receipt.episodes, {
    label: "regression audit",
    expectedCount: 20,
    candidate,
    requireMarker: false,
    requirePlanner: false,
    requireCoverage: true,
  });
}

function validateDisjointEpisodeSets(hostedReceipt, regressionReceipt) {
  if (!hostedReceipt || !regressionReceipt) return;
  const hostedIDs = new Set(
    (hostedReceipt.episodes ?? []).map((episode) => episode.episode_id),
  );
  const hostedReplays = new Set(
    (hostedReceipt.episodes ?? []).map((episode) => episode.replay_sha256),
  );
  for (const episode of regressionReceipt.episodes ?? []) {
    if (hostedIDs.has(episode.episode_id)) {
      errors.push("hosted and regression episode IDs are not disjoint");
    }
    if (hostedReplays.has(episode.replay_sha256)) {
      errors.push("hosted and regression replay hashes are not disjoint");
    }
  }
  if (
    regressionReceipt.request_id === hostedReceipt.request_id ||
    regressionReceipt.request_id === hostedReceipt.baseline_request_id
  ) {
    errors.push("regression request must be separate from hosted requests");
  }
}

if (preflight.schema_version !== 1) errors.push("schema_version must be 1");
requireString(preflight.candidate?.policy_ref, "candidate.policy_ref");
requireString(preflight.candidate?.parent_ref, "candidate.parent_ref");
requireString(preflight.hypothesis, "hypothesis");
requireString(preflight.mechanism?.marker, "mechanism.marker");
if (!Array.isArray(preflight.candidate?.exact_deltas) ||
    preflight.candidate.exact_deltas.length !== 1) {
  errors.push("candidate.exact_deltas must contain exactly one isolated delta");
}
if (!Number.isInteger(preflight.mechanism?.prior_reachable_decisions) ||
    preflight.mechanism.prior_reachable_decisions < 1) {
  errors.push("mechanism.prior_reachable_decisions must prove non-zero reach");
}
if (!Number.isInteger(preflight.local?.runs) || preflight.local.runs < 1) {
  errors.push("local.runs must be a positive integer");
}
if (!Number.isInteger(preflight.local?.independent_traces) ||
    preflight.local.independent_traces < 1 ||
    preflight.local.independent_traces > preflight.local.runs) {
  errors.push("local.independent_traces must be between 1 and local.runs");
}
if (preflight.local?.independent_traces < preflight.local?.runs) {
  warnings.push(
    "local runs include repeated strategic traces; do not report them as independent trials",
  );
}

const criteria = preflight.hosted?.criteria ?? {};
if (criteria.win_rate_pct !== 100) errors.push("hosted.criteria.win_rate_pct must be 100");
for (const field of ["max_holds", "max_rejections"]) {
  if (criteria[field] !== 0) errors.push(`hosted.criteria.${field} must be 0`);
}
if ((requireDiagnostic || requirePromotion) && criteria.max_k1z_harm !== 0) {
  errors.push("hosted.criteria.max_k1z_harm must be 0");
}
if (criteria.planner_degradation_rule !== "no_unexplained_regression_vs_parent") {
  errors.push(
    "hosted.criteria.planner_degradation_rule must compare against the matched parent",
  );
}
if (!Number.isInteger(criteria.min_mechanism_executions) ||
    criteria.min_mechanism_executions < 1) {
  errors.push("hosted.criteria.min_mechanism_executions must be at least 1");
}
if (preflight.promotion?.regression_episodes !== 20) {
  errors.push("promotion.regression_episodes must be 20");
}

const candidate = preflight.candidate ?? {};
if (requireDiagnostic || requirePromotion) {
  if (!COMMIT.test(candidate.source_commit ?? "")) {
    errors.push("candidate.source_commit must be a full commit");
  }
  if (!COMMIT.test(candidate.parent_commit ?? "")) {
    errors.push("candidate.parent_commit must be a full commit");
  }
  if (!IMAGE_ID.test(candidate.image_id ?? "")) {
    errors.push("candidate.image_id must be a full Docker image ID");
  }
  const localReceipt = await loadBoundReceipt(
    preflight.local?.audit_receipt,
    "local.audit_receipt",
  );
  validateLocalReceipt(localReceipt, candidate, preflight);
  const preuploadRciReceipt = await loadBoundReceipt(
    preflight.preupload_rci?.receipt,
    "preupload_rci.receipt",
  );
  validateRciReceipt(preuploadRciReceipt, "pre-upload RCI", candidate);
}

const matchedBaseline = preflight.matched_baseline ?? {};
const baselineReady =
  typeof matchedBaseline.request_id === "string" &&
  matchedBaseline.request_id.startsWith("xreq_") &&
  matchedBaseline.same_roster === true &&
  matchedBaseline.same_variant === true;
const diagnosticOnly = preflight.diagnostic_only === true;
if (!baselineReady && !diagnosticOnly) {
  errors.push("a matched hosted baseline is required unless diagnostic_only is true");
}
if (!baselineReady) warnings.push("no matched hosted baseline; this run cannot support promotion");

if (requireDiagnostic) {
  if (!diagnosticOnly ||
      preflight.promotion?.league_change_allowed !== false) {
    errors.push("diagnostic mode must explicitly forbid league mutation");
  }
}

const hostedResult = preflight.hosted?.result ?? {};
const hostedEpisodes = Number(hostedResult.episodes);
const hostedWins = Number(hostedResult.wins);
const hostedPassed =
  typeof preflight.hosted?.request_id === "string" &&
  preflight.hosted.request_id.startsWith("xreq_") &&
  hostedResult.status === "completed" &&
  Number.isInteger(hostedEpisodes) &&
  hostedEpisodes === 4 &&
  hostedWins === hostedEpisodes &&
  hostedResult.holds === 0 &&
  hostedResult.rejections === 0 &&
  hostedResult.k1z_harm === 0 &&
  Number(hostedResult.mechanism_executions) >= criteria.min_mechanism_executions &&
  hostedResult.planner_degradation_rule_passed === true;
const regressionResult = preflight.promotion?.result ?? {};
const regressionEpisodes = Number(regressionResult.episodes);
const regressionWins = Number(regressionResult.wins);
const regressionPassed =
  regressionResult.status === "completed" &&
  regressionEpisodes === preflight.promotion?.regression_episodes &&
  regressionWins === regressionEpisodes &&
  regressionResult.holds === 0 &&
  regressionResult.rejections === 0 &&
  regressionResult.k1z_harm === 0;

if (requirePromotion) {
  if (diagnosticOnly) errors.push("promotion preflight cannot be diagnostic-only");
  if (!POLICY_LABEL.test(candidate.uploaded_label ?? "")) {
    errors.push("candidate.uploaded_label must pin qd1n:vN");
  }
  if (!UUID.test(candidate.policy_version_id ?? "")) {
    errors.push("candidate.policy_version_id must be a UUID");
  }
  const uploadReceipt = await loadBoundReceipt(
    candidate.upload_receipt,
    "candidate.upload_receipt",
  );
  validateUploadReceipt(uploadReceipt, candidate);
  const hostedReceipt = await loadBoundReceipt(
    preflight.hosted?.audit_receipt,
    "hosted.audit_receipt",
  );
  validateHostedReceipt(hostedReceipt, candidate, preflight);
  const regressionReceipt = await loadBoundReceipt(
    preflight.promotion?.regression_audit_receipt,
    "promotion.regression_audit_receipt",
  );
  validateRegressionReceipt(regressionReceipt, candidate, preflight);
  validateDisjointEpisodeSets(hostedReceipt, regressionReceipt);
  const finalRciReceipt = await loadBoundReceipt(
    preflight.final_rci?.receipt,
    "final_rci.receipt",
  );
  validateRciReceipt(finalRciReceipt, "final RCI", candidate, { final: true });
}

const valid = errors.length === 0;
const hostedGateReady = valid && baselineReady && !diagnosticOnly;
const promotionEligible =
  valid && baselineReady && !diagnosticOnly && hostedPassed && regressionPassed;
if (baselineReady && !diagnosticOnly && !hostedPassed) {
  warnings.push("hosted 4/4 result is not complete; promotion is not eligible");
}
if (baselineReady && !diagnosticOnly && !regressionPassed) {
  warnings.push("20/20 regression result is not complete; promotion is not eligible");
}
const report = {
  valid,
  hosted_gate_ready: hostedGateReady,
  hosted_gate_passed: hostedPassed,
  regression_passed: regressionPassed,
  promotion_eligible: promotionEligible,
  candidate: preflight.candidate?.policy_ref ?? null,
  diagnostic_only: diagnosticOnly,
  strict_mode: requirePromotion
    ? "promotion"
    : (requireDiagnostic ? "diagnostic" : null),
  errors,
  warnings,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!valid || (requirePromotion && !promotionEligible)) {
  process.exitCode = 1;
}
