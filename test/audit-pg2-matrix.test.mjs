import assert from "node:assert/strict";
import test from "node:test";

import { buildMatrixReport } from "../scripts/audit-pg2-matrix.mjs";

const maps = ["World", "Asia", "Pangaea"];
const assignments = maps.flatMap((map, mapIndex) =>
  Array.from({ length: 8 }, (_, index) => ({
    pair: `${map.toLowerCase()}-${index}`,
    map,
    lane: "abcd"[index % 4],
    wave: mapIndex * 2 + (index < 4 ? 1 : 2),
    seed: 20260721 + index,
  })),
);

function audit(assignment) {
  return {
    arm: "pg2",
    verdict: "CONTINUE",
    ...assignment,
    candidate: {
      marker_count: 1,
      declared_win: false,
      rejected_decisions: [],
      unexplained_holds: [],
      k1z_harmful_actions: [],
      all_k1z_harmful_actions: [],
      marker_scope_violations: [],
    },
    parent: {
      declared_win: false,
      rejected_decisions: [],
      unexplained_holds: [],
      k1z_harmful_actions: [],
      all_k1z_harmful_actions: [],
      marker_scope_violations: [],
    },
    paired_deltas: {
      tile_at_decision_20: 5,
      tile_at_decision_50: 4,
      final_score: 0.01,
    },
  };
}

test("PG2 matrix auditor requires all predeclared map and overall gates", () => {
  const matrix = {
    schema_version: 1,
    arm: "pg2",
    candidate_source_commit: "candidate",
    exact_parent_commit: "parent",
    assignments,
  };
  const result = buildMatrixReport(matrix, assignments.map(audit));
  assert.equal(result.verdict, "CONTINUE");
  assert.equal(result.maps.World.marker_reach, 8);
  assert.equal(result.overall.positive_final_score_pairs, 24);
});

test("PG2 matrix auditor rejects a safety violation even with positive outcomes", () => {
  const matrix = { schema_version: 1, arm: "pg2", assignments };
  const reports = assignments.map(audit);
  reports[0].candidate.k1z_harmful_actions.push({ kind: "attack" });
  const result = buildMatrixReport(matrix, reports);
  assert.equal(result.verdict, "STOP");
  assert.match(result.violations.join("\n"), /k1z_harmful_actions/);
});

test("PG2 matrix auditor rejects an incomplete map before an overall total can pass", () => {
  const matrix = { schema_version: 1, arm: "pg2", assignments };
  const reports = assignments.map(audit).slice(1);
  const result = buildMatrixReport(matrix, reports);
  assert.equal(result.verdict, "STOP");
  assert.match(result.violations.join("\n"), /expected 24 pair audits/);
  assert.match(result.violations.join("\n"), /World has 7\/8/);
});

test("PG2 matrix auditor blocks promotion but preserves a parent-control replay receipt", () => {
  const matrix = { schema_version: 1, arm: "pg2", assignments };
  const reports = assignments.map(audit);
  reports[0].verdict = "REPLAY_REQUIRED";
  reports[0].parent.control_anomalies = ["Odin had an unexplained hold"];
  const result = buildMatrixReport(matrix, reports);
  assert.equal(result.verdict, "STOP");
  assert.match(result.violations.join("\n"), /targeted parent-control replay/);
});
