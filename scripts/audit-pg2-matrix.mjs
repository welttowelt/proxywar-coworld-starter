import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function optionValues(name) {
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === `--${name}`) values.push(process.argv[++index]);
    if (argument.startsWith(`--${name}=`)) values.push(argument.slice(name.length + 3));
  }
  return values.filter(Boolean);
}

function safetyViolations(report, role) {
  const arm = report[role] ?? {};
  const violations = [];
  for (const field of [
    "rejected_decisions",
    "unexplained_holds",
    "k1z_harmful_actions",
    "all_k1z_harmful_actions",
    "marker_scope_violations",
  ]) {
    if (Array.isArray(arm[field]) && arm[field].length > 0) {
      violations.push(`${report.pair} ${role} ${field} is non-empty`);
    }
  }
  return violations;
}

function deltas(reports, field) {
  return reports.map((report) => report.paired_deltas?.[field]);
}

export function buildMatrixReport(matrix, reports) {
  const violations = [];
  const assignments = matrix?.assignments;
  if (matrix?.schema_version !== 1 || matrix?.arm !== "pg2") {
    violations.push("matrix manifest identity is invalid");
  }
  if (!Array.isArray(assignments) || assignments.length !== 24) {
    violations.push("matrix manifest must contain exactly 24 assignments");
  }
  if (!Array.isArray(reports) || reports.length !== 24) {
    violations.push(`expected 24 pair audits, found ${reports?.length ?? 0}`);
  }

  const expected = new Map((assignments ?? []).map((assignment) => [assignment.pair, assignment]));
  const seen = new Set();
  for (const report of reports ?? []) {
    if (!report || typeof report !== "object") {
      violations.push("pair audit is not an object");
      continue;
    }
    if (report.arm !== "pg2" || report.verdict !== "CONTINUE") {
      violations.push(`${report.pair ?? "unknown"} did not pass its semantic audit`);
      continue;
    }
    const assignment = expected.get(report.pair);
    if (!assignment) {
      violations.push(`${report.pair ?? "unknown"} is absent from the matrix manifest`);
      continue;
    }
    if (seen.has(report.pair)) violations.push(`${report.pair} appears more than once`);
    seen.add(report.pair);
    for (const field of ["lane", "wave", "map", "seed"]) {
      if (report[field] !== assignment[field]) {
        violations.push(`${report.pair} ${field} differs from the matrix manifest`);
      }
    }
    violations.push(...safetyViolations(report, "candidate"));
    violations.push(...safetyViolations(report, "parent"));
    for (const field of ["tile_at_decision_20", "tile_at_decision_50", "final_score"]) {
      if (!finite(report.paired_deltas?.[field])) {
        violations.push(`${report.pair} has no finite ${field} delta`);
      }
    }
  }
  for (const pair of expected.keys()) {
    if (!seen.has(pair)) violations.push(`missing audit for ${pair}`);
  }

  const maps = {};
  for (const map of ["World", "Asia", "Pangaea"]) {
    const rows = (reports ?? []).filter((report) => report?.map === map && report?.verdict === "CONTINUE");
    const tile20 = deltas(rows, "tile_at_decision_20");
    const tile50 = deltas(rows, "tile_at_decision_50");
    const score = deltas(rows, "final_score");
    const markerReach = rows.filter((report) => Number(report.candidate?.marker_count) > 0).length;
    const candidateWins = rows.filter((report) => report.candidate?.declared_win === true).length;
    const parentWins = rows.filter((report) => report.parent?.declared_win === true).length;
    const report = {
      pair_count: rows.length,
      marker_reach: markerReach,
      median_tile_delta_decision_20: median(tile20),
      median_tile_delta_decision_50: median(tile50),
      median_final_score_delta: median(score),
      candidate_declared_wins: candidateWins,
      parent_declared_wins: parentWins,
    };
    maps[map] = report;
    if (rows.length !== 8) violations.push(`${map} has ${rows.length}/8 passing pair audits`);
    if (markerReach < 6) violations.push(`${map} marker reach ${markerReach}/8 is below 6/8`);
    for (const [label, value] of Object.entries({
      decision20: report.median_tile_delta_decision_20,
      decision50: report.median_tile_delta_decision_50,
      score: report.median_final_score_delta,
    })) {
      if (!finite(value) || value <= 0) violations.push(`${map} ${label} paired median is not positive`);
    }
    if (candidateWins < parentWins) violations.push(`${map} candidate declared wins are below parent`);
  }

  const positiveFinalScorePairs = (reports ?? []).filter((report) =>
    finite(report?.paired_deltas?.final_score) && report.paired_deltas.final_score > 0,
  ).length;
  const candidateDeclaredWins = (reports ?? []).filter((report) => report?.candidate?.declared_win === true).length;
  const parentDeclaredWins = (reports ?? []).filter((report) => report?.parent?.declared_win === true).length;
  if (positiveFinalScorePairs < 15) {
    violations.push(`positive final-score pairs ${positiveFinalScorePairs}/24 is below 15/24`);
  }
  if (candidateDeclaredWins < parentDeclaredWins) {
    violations.push("overall candidate declared wins are below parent");
  }

  return {
    schema_version: 1,
    arm: "pg2",
    candidate_source_commit: matrix?.candidate_source_commit ?? null,
    exact_parent_commit: matrix?.exact_parent_commit ?? null,
    pair_count: reports?.length ?? 0,
    maps,
    overall: {
      positive_final_score_pairs: positiveFinalScorePairs,
      candidate_declared_wins: candidateDeclaredWins,
      parent_declared_wins: parentDeclaredWins,
    },
    verdict: violations.length === 0 ? "CONTINUE" : "STOP",
    violations,
  };
}

async function main() {
  const matrixPath = optionValues("matrix")[0];
  const roots = optionValues("root");
  const outputPath = optionValues("output")[0];
  if (!matrixPath || roots.length !== 4) {
    throw new Error(
      "usage: node scripts/audit-pg2-matrix.mjs --matrix PATH --root PATH --root PATH --root PATH --root PATH [--output PATH]",
    );
  }
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  const reports = [];
  for (const root of roots) {
    for (const assignment of matrix.assignments ?? []) {
      const target = path.join(root, "evidence", assignment.pair, "audit.json");
      try {
        reports.push(JSON.parse(await readFile(target, "utf8")));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  const unique = new Map(reports.map((report) => [report.pair, report]));
  const result = buildMatrixReport(matrix, [...unique.values()]);
  if (outputPath) {
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.verdict !== "CONTINUE") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
