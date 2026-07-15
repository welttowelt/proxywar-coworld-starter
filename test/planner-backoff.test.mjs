import assert from "node:assert/strict";
import test from "node:test";

import { classifyPlannerError, plannerCooldownMs } from "../planner-backoff.mjs";

test("planner errors distinguish quota from timeout and generic failures", () => {
  assert.equal(classifyPlannerError(new Error("429 Too many tokens per day")), "qta");
  assert.equal(classifyPlannerError(new Error("Request timed out")), "tmo");
  assert.equal(classifyPlannerError(new Error("plan reply had no JSON")), "err");
});

test("quota failures use the long cooldown", () => {
  assert.equal(plannerCooldownMs("qta", 1, {
    baseMs: 30000,
    quotaMs: 900000,
    maxMs: 300000,
  }), 900000);
});

test("transient planner failures back off exponentially with a cap", () => {
  assert.deepEqual(
    [1, 2, 3, 8].map((failure) => plannerCooldownMs("tmo", failure, {
      baseMs: 30000,
      quotaMs: 900000,
      maxMs: 300000,
    })),
    [30000, 60000, 120000, 300000],
  );
});
