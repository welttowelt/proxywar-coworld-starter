import { readFile } from "node:fs/promises";

const target = process.argv[2];
if (!target) {
  throw new Error("usage: node validate-experiment-preflight.mjs <preflight.json> [--require-promotion]");
}

const preflight = JSON.parse(await readFile(target, "utf8"));
const errors = [];
const warnings = [];
const requireString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label} is required`);
};

if (preflight.schema_version !== 1) errors.push("schema_version must be 1");
requireString(preflight.candidate?.policy_ref, "candidate.policy_ref");
requireString(preflight.candidate?.parent_ref, "candidate.parent_ref");
requireString(preflight.hypothesis, "hypothesis");
requireString(preflight.mechanism?.marker, "mechanism.marker");
if (!Array.isArray(preflight.candidate?.exact_deltas) || preflight.candidate.exact_deltas.length !== 1) {
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
  warnings.push("local runs include repeated strategic traces; do not report them as independent trials");
}

const criteria = preflight.hosted?.criteria ?? {};
if (criteria.win_rate_pct !== 100) errors.push("hosted.criteria.win_rate_pct must be 100");
for (const field of ["max_holds", "max_rejections"]) {
  if (criteria[field] !== 0) errors.push(`hosted.criteria.${field} must be 0`);
}
if (criteria.planner_degradation_rule !== "no_unexplained_regression_vs_parent") {
  errors.push(
    "hosted.criteria.planner_degradation_rule must compare against the matched parent",
  );
}
if (!Number.isInteger(criteria.min_mechanism_executions) || criteria.min_mechanism_executions < 1) {
  errors.push("hosted.criteria.min_mechanism_executions must be at least 1");
}
if (preflight.promotion?.regression_episodes !== 20) {
  errors.push("promotion.regression_episodes must be 20");
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

const valid = errors.length === 0;
const hostedGateReady = valid && baselineReady && !diagnosticOnly;
const hostedResult = preflight.hosted?.result ?? {};
const hostedEpisodes = Number(hostedResult.episodes);
const hostedWins = Number(hostedResult.wins);
const hostedPassed =
  typeof preflight.hosted?.request_id === "string" &&
  preflight.hosted.request_id.startsWith("xreq_") &&
  hostedResult.status === "completed" &&
  Number.isInteger(hostedEpisodes) &&
  hostedEpisodes >= 4 &&
  hostedWins === hostedEpisodes &&
  hostedResult.holds === 0 &&
  hostedResult.rejections === 0 &&
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
  regressionResult.rejections === 0;
const promotionEligible = hostedGateReady && hostedPassed && regressionPassed;
if (hostedGateReady && !hostedPassed) {
  warnings.push("hosted 4/4 result is not complete; promotion is not eligible");
}
if (hostedGateReady && !regressionPassed) {
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
  errors,
  warnings,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!valid || (process.argv.includes("--require-promotion") && !promotionEligible)) {
  process.exitCode = 1;
}
