import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const DIFFERENTIAL_VERIFIER = "experiments/odc1/verify-differential.mjs";
const DIFFERENTIAL_FIXTURE = "experiments/odc1/differential-fixture.json";

function committedFile(commit, file) {
  return execFileSync("git", ["-C", root, "show", `${commit}:${file}`]);
}

function fixture() {
  return {
    schema_version: 1,
    candidate: {
      policy_ref: "agent:v30",
      parent_ref: "agent:v29",
      exact_deltas: ["one delta"],
    },
    hypothesis: "one measurable effect",
    mechanism: { marker: "wireVeto=", prior_reachable_decisions: 10 },
    local: { runs: 4, independent_traces: 1 },
    matched_baseline: {
      policy_ref: "agent:v14",
      request_id: null,
      same_roster: false,
      same_variant: true,
    },
    diagnostic_only: true,
    hosted: {
      criteria: {
        win_rate_pct: 100,
        max_holds: 0,
        max_rejections: 0,
        max_k1z_harm: 0,
        planner_degradation_rule: "no_unexplained_regression_vs_parent",
        min_mechanism_executions: 1,
      },
    },
    promotion: { regression_episodes: 20 },
  };
}

function validate(value, ...args) {
  const directory = mkdtempSync(path.join(tmpdir(), "proxywar-preflight-"));
  const target = path.join(directory, "preflight.json");
  writeFileSync(target, JSON.stringify(value));
  const result = spawnSync(process.execPath, [
    "scripts/validate-experiment-preflight.mjs",
    target,
    ...args,
  ], { encoding: "utf8" });
  return { ...result, report: JSON.parse(result.stdout) };
}

test("diagnostic preflight is valid but cannot claim promotion eligibility", () => {
  const result = validate(fixture());
  assert.equal(result.status, 0);
  assert.equal(result.report.valid, true);
  assert.equal(result.report.hosted_gate_ready, false);
  assert.equal(result.report.promotion_eligible, false);
  assert.match(result.report.warnings.join(" "), /repeated strategic traces/);
  assert.match(result.report.warnings.join(" "), /no matched hosted baseline/);
});

test("preflight fails when mechanism reach is unproven", () => {
  const value = fixture();
  value.mechanism.prior_reachable_decisions = 0;
  const result = validate(value);
  assert.equal(result.status, 1);
  assert.equal(result.report.valid, false);
  assert.match(result.report.errors.join(" "), /non-zero reach/);
});

test("promotion mode fails a diagnostic-only candidate", () => {
  const result = validate(fixture(), "--require-promotion");
  assert.equal(result.status, 1);
  assert.equal(result.report.valid, false);
  assert.equal(result.report.promotion_eligible, false);
  assert.match(result.report.errors.join(" "), /promotion preflight cannot be diagnostic-only/);
});

test("matched evidence is hosted-gate ready but not promotion eligible", () => {
  const value = fixture();
  value.diagnostic_only = false;
  value.matched_baseline = {
    policy_ref: "agent:v29",
    request_id: "xreq_parent",
    same_roster: true,
    same_variant: true,
  };
  const result = validate(value);

  assert.equal(result.status, 0);
  assert.equal(result.report.valid, true);
  assert.equal(result.report.hosted_gate_ready, true);
  assert.equal(result.report.hosted_gate_passed, false);
  assert.equal(result.report.regression_passed, false);
  assert.equal(result.report.promotion_eligible, false);
});

test("promotion eligibility requires completed perfect hosted and regression results", () => {
  const value = fixture();
  value.diagnostic_only = false;
  value.matched_baseline = {
    policy_ref: "agent:v29",
    request_id: "xreq_parent",
    same_roster: true,
    same_variant: true,
  };
  value.hosted.request_id = "xreq_child";
  value.hosted.result = {
    status: "completed",
    episodes: 4,
    wins: 4,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    mechanism_executions: 3,
    planner_degradation_rule_passed: true,
  };
  value.promotion.result = {
    status: "completed",
    episodes: 20,
    wins: 20,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
  };
  const result = validate(value);

  assert.equal(result.status, 0);
  assert.equal(result.report.hosted_gate_passed, true);
  assert.equal(result.report.regression_passed, true);
  assert.equal(result.report.promotion_eligible, true);
});

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function receipt(directory, name, value) {
  const file = path.join(directory, name);
  writeFileSync(file, JSON.stringify(value));
  return { path: file, sha256: sha256(file) };
}

function strictDiagnosticFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "strict-preflight-"));
  const value = fixture();
  const source = "a".repeat(40);
  const image = `sha256:${"b".repeat(64)}`;
  value.candidate.source_commit = source;
  value.candidate.parent_commit = "c".repeat(40);
  value.candidate.image_id = image;
  value.local.runs = 2;
  value.local.independent_traces = 2;
  value.local.contract_sha256 = "e".repeat(64);
  value.promotion.league_change_allowed = false;
  const evaluatorCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  value.local.audit_receipt = receipt(directory, "local.json", {
    schema_version: 2,
    verdict: "PASS_LOCAL_SCREEN",
    failures: [],
    candidate_source_commit: source,
    candidate_image_id: image,
    parent_source_commit: value.candidate.parent_commit,
    contract_sha256: value.local.contract_sha256,
    required_coalition_roles: ["katanasan"],
    differential_unit_proof: {
      same_fixture: true,
      test_exit_code: 0,
      verifier: {
        evaluator_commit: evaluatorCommit,
        path: DIFFERENTIAL_VERIFIER,
        sha256: createHash("sha256")
          .update(committedFile(evaluatorCommit, DIFFERENTIAL_VERIFIER))
          .digest("hex"),
      },
      fixture: {
        sha256: createHash("sha256")
          .update(committedFile(evaluatorCommit, DIFFERENTIAL_FIXTURE))
          .digest("hex"),
      },
      parent: {
        source_commit: value.candidate.parent_commit,
        selected_action_id: "parent-action",
      },
      candidate: {
        source_commit: source,
        selected_action_id: "candidate-action",
      },
      test_command: [
        "node",
        DIFFERENTIAL_VERIFIER,
        ".",
        value.candidate.parent_commit,
        source,
        DIFFERENTIAL_FIXTURE,
        `experiments/odc1/differential-proof-${source.slice(0, 8)}.json`,
      ],
    },
    runs: ["A", "B"].map((orientation, index) => ({
      orientation,
      replay_sha256: String(index + 1).repeat(64),
      coalition_roles_present: ["odin", "katanasan"],
      resolved_images: {
        images: { candidate: { image_id: image } },
      },
      candidate: {
        decision_count: 10,
        accepted: 10,
        illegal_turns: [],
        rejected_turns: [],
        fallback_turns: [],
        degradation_turns: [],
        unexplained_holds: [],
        harmful_k1z_actions: [],
        unresolved_harmful_targets: [],
        marker_counts: { "wireveto=": 1 },
        route_execution_count: 1,
      },
      orientation_advantage: { score_delta: 0.1, tile_delta: 10 },
    })),
  });
  value.preupload_rci = {
    receipt: receipt(directory, "preupload-rci.json", {
      status: "passed",
      unresolved_violations: [],
      candidate_source_commit: source,
      candidate_image_id: image,
    }),
  };
  return { directory, value, source, image };
}

function addStrictPromotionEvidence(context) {
  const { directory, value, source, image } = context;
  const policyId = "11111111-1111-4111-8111-111111111111";
  const odin = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
  value.diagnostic_only = false;
  value.candidate.uploaded_label = "qd1n:v100";
  value.candidate.policy_version_id = policyId;
  value.candidate.upload_receipt = receipt(directory, "upload.json", {
    mode: "diagnostic",
    status: "completed",
    candidate_source_commit: source,
    candidate_image_id: image,
    candidate_policy_ref: value.candidate.policy_ref,
    uploaded_label: value.candidate.uploaded_label,
    policy_version_id: policyId,
  });
  value.matched_baseline = {
    policy_ref: value.candidate.parent_ref,
    request_id: "xreq_parent",
    same_roster: true,
    same_variant: true,
  };
  const hostedEpisodes = Array.from({ length: 4 }, (_, index) => ({
    episode_id: `hosted-${index}`,
    replay_sha256: (index + 1).toString(16).repeat(64),
    winner_player_id: odin,
    candidate_policy_version_id: policyId,
    marker_executions: 1,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    planner_degradation_passed: true,
  }));
  value.hosted.request_id = "xreq_child";
  value.hosted.audit_receipt = receipt(directory, "hosted.json", {
    verdict: "PASS_HOSTED",
    violations: [],
    candidate_source_commit: source,
    candidate_image_id: image,
    candidate_policy_version_id: policyId,
    request_id: "xreq_child",
    baseline_request_id: "xreq_parent",
    roster_sha256: "d".repeat(64),
    variant: "12p-pangaea",
    episodes: hostedEpisodes,
  });
  value.hosted.result = {
    status: "completed",
    episodes: 4,
    wins: 4,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    mechanism_executions: 4,
    planner_degradation_rule_passed: true,
  };
  const regressionEpisodes = Array.from({ length: 20 }, (_, index) => ({
    episode_id: `regression-${index}`,
    replay_sha256: createHash("sha256")
      .update(`regression-${index}`)
      .digest("hex"),
    winner_player_id: odin,
    candidate_policy_version_id: policyId,
    marker_executions: 0,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    map: index % 2 ? "World" : "Pangaea",
    seat: index % 4,
  }));
  value.promotion.request_id = "xreq_regression";
  value.promotion.regression_audit_receipt = receipt(
    directory,
    "regression.json",
    {
      verdict: "PASS_REGRESSION",
      candidate_source_commit: source,
      candidate_image_id: image,
      candidate_policy_version_id: policyId,
      request_id: "xreq_regression",
      episodes: regressionEpisodes,
    },
  );
  value.promotion.result = {
    status: "completed",
    episodes: 20,
    wins: 20,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
  };
  value.final_rci = {
    receipt: receipt(directory, "final-rci.json", {
      status: "passed",
      unresolved_violations: [],
      candidate_source_commit: source,
      candidate_image_id: image,
      candidate_policy_version_id: policyId,
      checks: {
        source_identity: true,
        image_identity: true,
        roster_identity: true,
        runtime_identity: true,
        marker_integrity: true,
        k1z_safety: true,
        outcome_identity: true,
      },
    }),
  };
}

test("strict diagnostic mode requires hash-bound local and pre-upload RCI receipts", () => {
  const context = strictDiagnosticFixture();
  const passed = validate(context.value, "--require-diagnostic");
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.report.strict_mode, "diagnostic");

  context.value.local.audit_receipt.sha256 = "0".repeat(64);
  const tampered = validate(context.value, "--require-diagnostic");
  assert.equal(tampered.status, 1);
  assert.match(tampered.report.errors.join(" "), /local.audit_receipt SHA-256/);
});

test("strict diagnostic mode requires an explicit league-mutation prohibition", () => {
  const context = strictDiagnosticFixture();
  delete context.value.promotion.league_change_allowed;
  const result = validate(context.value, "--require-diagnostic");
  assert.equal(result.status, 1);
  assert.match(result.report.errors.join(" "), /explicitly forbid league mutation/);
});

test("strict diagnostic accepts a safe mechanism screen without a lift claim", () => {
  const context = strictDiagnosticFixture();
  const localBinding = context.value.local.audit_receipt;
  const local = JSON.parse(readFileSync(localBinding.path, "utf8"));
  local.verdict = "PASS_MECHANISM_SCREEN";
  local.screen_mode = "mechanism";
  local.competitive_evidence = false;
  local.runs = [local.runs[0]];
  delete local.runs[0].orientation_advantage;
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);
  context.value.local.runs = 1;
  context.value.local.independent_traces = 1;

  const passed = validate(context.value, "--require-diagnostic");
  assert.equal(passed.status, 0, passed.stderr);

  local.runs[0].candidate.marker_counts = { "other-marker": 1 };
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);
  const wrongMarker = validate(context.value, "--require-diagnostic");
  assert.equal(wrongMarker.status, 1);
  assert.match(wrongMarker.report.errors.join(" "), /preflight mechanism marker/);

  local.runs[0].candidate.marker_counts = { "wireveto=": 1 };
  local.runs[0].coalition_roles_present = ["odin"];
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);
  const unsafe = validate(context.value, "--require-diagnostic");
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.report.errors.join(" "), /coalition presence failed/);
});

test("strict diagnostic binds an arm-specific differential verifier and fixture", () => {
  const context = strictDiagnosticFixture();
  const localBinding = context.value.local.audit_receipt;
  const local = JSON.parse(readFileSync(localBinding.path, "utf8"));
  context.value.local.differential_binding = {
    verifier_path: DIFFERENTIAL_VERIFIER,
    fixture_path: DIFFERENTIAL_FIXTURE,
  };
  local.differential_unit_proof.fixture.path = DIFFERENTIAL_FIXTURE;
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);

  const passed = validate(context.value, "--require-diagnostic");
  assert.equal(passed.status, 0, passed.stderr);

  context.value.local.differential_binding.fixture_path =
    "experiments/odc1/../kiz1/differential-fixture.json";
  const traversal = validate(context.value, "--require-diagnostic");
  assert.equal(traversal.status, 1);
  assert.match(
    traversal.report.errors.join(" "),
    /differential verifier provenance|differential command/,
  );
});

test("strict mechanism screen honestly binds a derived selector harness", () => {
  const context = strictDiagnosticFixture();
  const evaluatorCommit = execFileSync(
    "git",
    ["-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const source = evaluatorCommit;
  const harnessImage = `sha256:${"f".repeat(64)}`;
  const engineSha = createHash("sha256")
    .update(committedFile(source, "strategy-engine.mjs"))
    .digest("hex");
  const playerPath = "experiments/kiz1/selector-player.mjs";
  const dockerfilePath = "experiments/kiz1/Dockerfile.mechanism";
  const playerSha = createHash("sha256")
    .update(committedFile(evaluatorCommit, playerPath))
    .digest("hex");
  const dockerfileSha = createHash("sha256")
    .update(committedFile(evaluatorCommit, dockerfilePath))
    .digest("hex");

  context.value.candidate.source_commit = source;
  context.value.local.runs = 1;
  context.value.local.independent_traces = 1;
  context.value.local.mechanism_harness = {
    resolved_image_id: harnessImage,
    base_candidate_image_id: context.image,
    strategy_engine_sha256: engineSha,
    evaluator_commit: evaluatorCommit,
    artifacts: {
      player: { path: playerPath, sha256: playerSha },
      dockerfile: { path: dockerfilePath, sha256: dockerfileSha },
    },
  };

  const localBinding = context.value.local.audit_receipt;
  const local = JSON.parse(readFileSync(localBinding.path, "utf8"));
  local.verdict = "PASS_MECHANISM_SCREEN";
  local.screen_mode = "mechanism";
  local.competitive_evidence = false;
  local.candidate_source_commit = source;
  local.differential_unit_proof.candidate.source_commit = source;
  local.differential_unit_proof.test_command[4] = source;
  local.differential_unit_proof.test_command[6] =
    `experiments/odc1/differential-proof-${source.slice(0, 8)}.json`;
  local.runs = [local.runs[0]];
  delete local.runs[0].orientation_advantage;
  local.runs[0].resolved_images.images.candidate.image_id = harnessImage;
  local.runs[0].mechanism_harness = {
    resolved_image_id: harnessImage,
    base_candidate_image_id: context.image,
    evaluator_commit: evaluatorCommit,
    strategy_engine_byte_match: true,
    strategy_engine_sha256: engineSha,
    player: { path: playerPath, sha256: playerSha },
    dockerfile: { path: dockerfilePath, sha256: dockerfileSha },
  };
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);

  const rciBinding = context.value.preupload_rci.receipt;
  const rci = JSON.parse(readFileSync(rciBinding.path, "utf8"));
  rci.candidate_source_commit = source;
  writeFileSync(rciBinding.path, JSON.stringify(rci));
  rciBinding.sha256 = sha256(rciBinding.path);

  const passed = validate(context.value, "--require-diagnostic");
  assert.equal(passed.status, 0, passed.stderr);

  local.runs[0].mechanism_harness.strategy_engine_sha256 = "0".repeat(64);
  writeFileSync(localBinding.path, JSON.stringify(local));
  localBinding.sha256 = sha256(localBinding.path);
  const mismatched = validate(context.value, "--require-diagnostic");
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.report.errors.join(" "), /resolved image ID mismatched/);
});

test("the KIZ1 selector cold-starts from a relocated CPU-runner cwd", () => {
  const source = readFileSync(
    path.join(root, "experiments/kiz1/selector-player.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /file:\/\/\/app\//);
  assert.doesNotMatch(source, /createRequire\("\/app\//);
  assert.match(source, /createRequire\(import\.meta\.url\)/);

  const directory = mkdtempSync(path.join(tmpdir(), "kiz1-relocated-"));
  try {
    copyFileSync(
      path.join(root, "experiments/kiz1/selector-player.mjs"),
      path.join(directory, "selector-player.mjs"),
    );
    copyFileSync(
      path.join(root, "strategy-engine.mjs"),
      path.join(directory, "strategy-engine.mjs"),
    );
    symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"));
    const result = spawnSync(process.execPath, ["selector-player.mjs"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, COWORLD_PLAYER_WS_URL: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /COWORLD_PLAYER_WS_URL is required/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict promotion rejects self-attested counters without immutable receipts", () => {
  const value = fixture();
  value.diagnostic_only = false;
  value.matched_baseline = {
    policy_ref: "agent:v29",
    request_id: "xreq_parent",
    same_roster: true,
    same_variant: true,
  };
  const result = validate(value, "--require-promotion");
  assert.equal(result.status, 1);
  assert.match(result.report.errors.join(" "), /local.audit_receipt/);
  assert.match(result.report.errors.join(" "), /final_rci.receipt/);
});

test("strict promotion verifies final RCI, K1Z safety, and distinct replay evidence", () => {
  const context = strictDiagnosticFixture();
  addStrictPromotionEvidence(context);
  const passed = validate(context.value, "--require-promotion");
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.report.promotion_eligible, true);

  const regressionBinding = context.value.promotion.regression_audit_receipt;
  const regression = JSON.parse(readFileSync(regressionBinding.path, "utf8"));
  const hostedBinding = context.value.hosted.audit_receipt;
  const hosted = JSON.parse(readFileSync(hostedBinding.path, "utf8"));
  hosted.violations = ["forged pass"];
  writeFileSync(hostedBinding.path, JSON.stringify(hosted));
  hostedBinding.sha256 = sha256(hostedBinding.path);
  const contradicted = validate(context.value, "--require-promotion");
  assert.equal(contradicted.status, 1);
  assert.match(contradicted.report.errors.join(" "), /hosted audit has unresolved/);

  hosted.violations = [];
  writeFileSync(hostedBinding.path, JSON.stringify(hosted));
  hostedBinding.sha256 = sha256(hostedBinding.path);
  const originalRegressionReplay = regression.episodes[0].replay_sha256;
  regression.episodes[0].replay_sha256 = hosted.episodes[0].replay_sha256;
  writeFileSync(regressionBinding.path, JSON.stringify(regression));
  regressionBinding.sha256 = sha256(regressionBinding.path);
  const reused = validate(context.value, "--require-promotion");
  assert.equal(reused.status, 1);
  assert.match(reused.report.errors.join(" "), /replay hashes are not disjoint/);

  regression.episodes[0].replay_sha256 = originalRegressionReplay;
  writeFileSync(regressionBinding.path, JSON.stringify(regression));
  regressionBinding.sha256 = sha256(regressionBinding.path);
  hosted.episodes[1].replay_sha256 = hosted.episodes[0].replay_sha256;
  writeFileSync(hostedBinding.path, JSON.stringify(hosted));
  hostedBinding.sha256 = sha256(hostedBinding.path);
  const duplicated = validate(context.value, "--require-promotion");
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.report.errors.join(" "), /replay hashes.*duplicated/);
});
