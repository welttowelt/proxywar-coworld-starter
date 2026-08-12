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

test("accepts only exact grow or convert mission packets", () => {
  assert.deepEqual(
    normalizeIntentDirective(
      { intent: "convert", targetID: "player-7", horizon: 5 },
      state,
      "planner-model",
    ),
    { intent: "convert", targetID: "player-7", horizon: 5, model: "planner-model" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "grow", targetID: null, horizon: 2 }, state),
    { intent: "grow", targetID: null, horizon: 2, model: "unknown" },
  );
});

test("accepts only the two planner outcomes", () => {
  assert.deepEqual(
    normalizeIntentDirective({ intent: "grow", targetID: null, horizon: 4 }, state),
    { intent: "grow", targetID: null, horizon: 4, model: "unknown" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "convert", targetID: "player-7", horizon: 4 }, state),
    { intent: "convert", targetID: "player-7", horizon: 4, model: "unknown" },
  );
  for (const intent of ["expand", "fortify", "defend", "ally", "pressure"]) {
    assert.equal(normalizeIntentDirective({
      intent,
      targetID: ["ally", "pressure"].includes(intent) ? "player-7" : null,
      horizon: 4,
    }, state), null);
  }
});

test("parses exactly one transport-framed JSON mission packet", () => {
  const packet = '{"intent":"grow","targetID":null,"horizon":4}';
  const expected = { intent: "grow", targetID: null, horizon: 4, model: "planner-model" };
  assert.deepEqual(parseIntentDirective(packet, state, "planner-model"), expected);
  for (const framed of [
    `Here is the plan: ${packet}`,
    `${packet}\nDone.`,
    "```json\n" + packet + "\n```",
    "```\n" + packet + "\n```",
    `My mission:\n\n${packet}\n\nGood luck.`,
  ]) {
    assert.deepEqual(parseIntentDirective(framed, state, "planner-model"), expected);
  }
  for (const rejected of [
    `${packet}${packet}`,
    `${packet} and also {"intent":"convert"}`,
    '{"intent":"grow","targetID":null,"horizon":4',
    `closing stray } before ${packet}`,
    "no packet at all",
    "",
  ]) {
    assert.equal(parseIntentDirective(rejected, state), null);
  }
});

test("rejects extra tactical keys and unknown intents", () => {
  assert.equal(normalizeIntentDirective({
    intent: "convert",
    targetID: "player-7",
    horizon: 5,
    actionID: "attack:player-7:100",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "finish",
    targetID: "player-7",
    horizon: 5,
  }, state), null);
});

test("rejects malformed horizons rather than coercing them", () => {
  for (const horizon of [-1, 1, 13, 2.5, "5", null]) {
    assert.equal(normalizeIntentDirective({ intent: "grow", targetID: null, horizon }, state), null);
  }
});

test("requires null grow target and an exact visible convert target ID", () => {
  assert.equal(normalizeIntentDirective({
    intent: "grow", targetID: "player-7", horizon: 3,
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "Visible Rival", horizon: 3,
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "missing", horizon: 3,
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "PLAYER-7", horizon: 3,
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: " player-7 ", horizon: 3,
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "Grow", targetID: null, horizon: 3,
  }, state), null);
});

test("rejects empty convert IDs even when a visible rival has no ID", () => {
  const emptyIDState = { rivals: [{ id: "", name: "Nameless" }] };
  assert.equal(normalizeIntentDirective({
    intent: "convert",
    targetID: "",
    horizon: 4,
  }, emptyIDState), null);
});

test("intent snapshot excludes legal action IDs and labels", () => {
  const snapshot = buildIntentSnapshot(state);
  assert.deepEqual(snapshot.legalActionKinds, ["attack", "hold"]);
  assert.equal(JSON.stringify(snapshot).includes("attack:player-7:40"), false);
  assert.equal(JSON.stringify(snapshot).includes("Attack Visible Rival"), false);
  assert.equal(snapshot.rivals[0].id, "player-7");
});

test("refresh interval honors a valid horizon and operator ceiling", () => {
  assert.equal(intentRefreshInterval({ horizon: 3 }, 8), 3);
  assert.equal(intentRefreshInterval({ horizon: 12 }, 8), 8);
  assert.equal(intentRefreshInterval(null, 6), 6);
});

test("valid intents persist across refresh age and transient refresh errors", () => {
  const plan = { intent: "grow", targetID: null, horizon: 3, model: "test" };
  assert.equal(executableIntentPlan(plan, 3, false), plan);
  assert.equal(executableIntentPlan(plan, 4, false), plan);
  assert.equal(executableIntentPlan(plan, 1, true), plan);
  assert.equal(executableIntentPlan(null, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "finish", targetID: null, horizon: 3, model: "test",
  }, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "convert", targetID: "", horizon: 3, model: "test",
  }, 1, false), null);
});
