import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIntentSnapshot,
  executableIntentPlan,
  intentRefreshInterval,
  normalizeIntentDirective,
  parseIntentDirective,
} from "../intent-controller.mjs";

const state = {
  mapFingerprint: "Pangaea",
  phase: "active",
  decisionNumber: 7,
  self: {
    tileShare: 0.2,
    troopRatio: 0.8,
    allProtocolAttackerIDs: [],
  },
  rivals: [{
    id: "player-7",
    name: "Visible Rival",
    tileShare: 0.1,
    relativeTroopRatio: 1.6,
    sharesBorder: true,
    isAllied: false,
    canAttack: true,
  }],
  legalActions: [
    { id: "attack:player-7:40", kind: "attack", label: "Attack Visible Rival" },
    { id: "hold", kind: "hold", label: "Hold" },
  ],
  recentKinds: ["attack", "build"],
};

test("accepts only exact outcome intents", () => {
  assert.deepEqual(
    normalizeIntentDirective(
      "finish",
      state,
      "planner-model",
    ),
    { intent: "finish", model: "planner-model" },
  );
  assert.deepEqual(
    normalizeIntentDirective("grow", state),
    { intent: "grow", model: "unknown" },
  );
});

test("accepts only the two planner outcomes", () => {
  assert.deepEqual(
    normalizeIntentDirective("grow", state),
    { intent: "grow", model: "unknown" },
  );
  assert.deepEqual(
    normalizeIntentDirective("finish", state),
    { intent: "finish", model: "unknown" },
  );
  for (const intent of ["secure", "expand", "consolidate", "convert", "defend", "ally", "pressure"]) {
    assert.equal(normalizeIntentDirective(intent, state), null);
  }
});

test("parses exactly one bare intent", () => {
  const packet = "grow";
  const expected = { intent: "grow", model: "planner-model" };
  assert.deepEqual(parseIntentDirective(packet, state, "planner-model"), expected);
  for (const whitespace of [
    ` ${packet} `,
    `\n${packet}\n`,
  ]) {
    assert.deepEqual(parseIntentDirective(whitespace, state, "planner-model"), expected);
  }
  for (const rejected of [
    '{"intent":"grow"}',
    "grow finish",
    "Here is the intent: grow",
    "```grow```",
    "",
  ]) {
    assert.equal(parseIntentDirective(rejected, state), null);
  }
});

test("rejects extra tactical keys and unknown intents", () => {
  assert.equal(normalizeIntentDirective({
    intent: "finish",
    actionID: "attack:player-7:100",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert",
  }, state), null);
});

test("rejects planner timing and other extra instruction keys", () => {
  assert.equal(normalizeIntentDirective({
    intent: "grow", horizon: 4,
  }, state), null);
});

test("rejects every planner target field", () => {
  assert.equal(normalizeIntentDirective({
    intent: "grow", targetID: "player-7",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "finish", targetID: "player-7",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "secure", targetID: null,
  }, state), null);
});

test("legacy planners retain their exact target contract", () => {
  assert.deepEqual(normalizeIntentDirective({
    intent: "convert",
    targetID: "player-7",
    horizon: 4,
  }, state, "legacy", ["grow", "convert"]), {
    intent: "convert",
    targetID: "player-7",
    horizon: 4,
    model: "legacy",
  });
});

test("intent snapshot excludes legal action IDs and labels", () => {
  const snapshot = buildIntentSnapshot(state);
  assert.deepEqual(snapshot.legalActionKinds, ["attack", "hold"]);
  assert.equal(JSON.stringify(snapshot).includes("attack:player-7:40"), false);
  assert.equal(JSON.stringify(snapshot).includes("Attack Visible Rival"), false);
  assert.equal(snapshot.rivals[0].id, "player-7");
});

test("intent-only snapshots contain state, not execution affordances", () => {
  const snapshot = buildIntentSnapshot(state, false);
  assert.equal(snapshot.rivals[0].id, undefined);
  assert.equal(snapshot.rivals[0].name, undefined);
  assert.equal(snapshot.rivals[0].canAttack, undefined);
  assert.equal(snapshot.rivals[0].tileShare, 0.1);
  assert.equal(snapshot.legalActionKinds, undefined);
  assert.equal(snapshot.recentKinds, undefined);
});

test("outcome plans use the operator refresh cadence", () => {
  assert.equal(intentRefreshInterval({ intent: "grow" }, 8), 8);
  assert.equal(intentRefreshInterval({ horizon: 12 }, 8), 8);
  assert.equal(intentRefreshInterval(null, 6), 6);
});

test("valid intents persist across refresh age and transient refresh errors", () => {
  const plan = { intent: "grow", model: "test" };
  assert.equal(executableIntentPlan(plan, 3, false), plan);
  assert.equal(executableIntentPlan(plan, 4, false), plan);
  assert.equal(executableIntentPlan(plan, 1, true), plan);
  assert.equal(executableIntentPlan(null, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "expand", model: "test",
  }, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "convert", targetID: "player-7", model: "test",
  }, 1, false), null);
});
