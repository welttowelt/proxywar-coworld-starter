import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

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
  assert.equal(result.report.valid, true);
  assert.equal(result.report.promotion_eligible, false);
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
    mechanism_executions: 3,
    planner_degradation_rule_passed: true,
  };
  value.promotion.result = {
    status: "completed",
    episodes: 20,
    wins: 20,
    holds: 0,
    rejections: 0,
  };
  const result = validate(value, "--require-promotion");

  assert.equal(result.status, 0);
  assert.equal(result.report.hosted_gate_passed, true);
  assert.equal(result.report.regression_passed, true);
  assert.equal(result.report.promotion_eligible, true);
});
