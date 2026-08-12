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

test("accepts only exact outcome packets", () => {
  assert.deepEqual(
    normalizeIntentDirective(
      { intent: "convert", targetID: "player-7" },
      state,
      "planner-model",
    ),
    { intent: "convert", targetID: "player-7", model: "planner-model" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "expand", targetID: null }, state),
    { intent: "expand", targetID: null, model: "unknown" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "consolidate", targetID: null }, state),
    { intent: "consolidate", targetID: null, model: "unknown" },
  );
});

test("accepts only the three planner outcomes", () => {
  assert.deepEqual(
    normalizeIntentDirective({ intent: "expand", targetID: null }, state),
    { intent: "expand", targetID: null, model: "unknown" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "consolidate", targetID: null }, state),
    { intent: "consolidate", targetID: null, model: "unknown" },
  );
  assert.deepEqual(
    normalizeIntentDirective({ intent: "convert", targetID: "player-7" }, state),
    { intent: "convert", targetID: "player-7", model: "unknown" },
  );
  for (const intent of ["grow", "fortify", "defend", "ally", "pressure"]) {
    assert.equal(normalizeIntentDirective({
      intent,
      targetID: ["ally", "pressure"].includes(intent) ? "player-7" : null,
    }, state), null);
  }
});

test("parses exactly one transport-framed JSON mission packet", () => {
  const packet = '{"intent":"expand","targetID":null}';
  const expected = { intent: "expand", targetID: null, model: "planner-model" };
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
    '{"intent":"expand","targetID":null',
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
    actionID: "attack:player-7:100",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "finish",
    targetID: "player-7",
  }, state), null);
});

test("rejects planner timing and other extra instruction keys", () => {
  assert.equal(normalizeIntentDirective({
    intent: "expand", targetID: null, horizon: 4,
  }, state), null);
});

test("requires null non-targeted outcomes and an exact visible convert target ID", () => {
  assert.equal(normalizeIntentDirective({
    intent: "expand", targetID: "player-7",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "Visible Rival",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "missing",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: "PLAYER-7",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "convert", targetID: " player-7 ",
  }, state), null);
  assert.equal(normalizeIntentDirective({
    intent: "Expand", targetID: null,
  }, state), null);
});

test("rejects empty convert IDs even when a visible rival has no ID", () => {
  const emptyIDState = { rivals: [{ id: "", name: "Nameless" }] };
  assert.equal(normalizeIntentDirective({
    intent: "convert",
    targetID: "",
  }, emptyIDState), null);
});

test("intent snapshot excludes legal action IDs and labels", () => {
  const snapshot = buildIntentSnapshot(state);
  assert.deepEqual(snapshot.legalActionKinds, ["attack", "hold"]);
  assert.equal(JSON.stringify(snapshot).includes("attack:player-7:40"), false);
  assert.equal(JSON.stringify(snapshot).includes("Attack Visible Rival"), false);
  assert.equal(snapshot.rivals[0].id, "player-7");
});

test("outcome plans use the operator refresh cadence", () => {
  assert.equal(intentRefreshInterval({ intent: "expand" }, 8), 8);
  assert.equal(intentRefreshInterval({ horizon: 12 }, 8), 8);
  assert.equal(intentRefreshInterval(null, 6), 6);
});

test("valid intents persist across refresh age and transient refresh errors", () => {
  const plan = { intent: "expand", targetID: null, model: "test" };
  assert.equal(executableIntentPlan(plan, 3, false), plan);
  assert.equal(executableIntentPlan(plan, 4, false), plan);
  assert.equal(executableIntentPlan(plan, 1, true), plan);
  assert.equal(executableIntentPlan(null, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "finish", targetID: null, model: "test",
  }, 1, false), null);
  assert.equal(executableIntentPlan({
    intent: "convert", targetID: "", model: "test",
  }, 1, false), null);
});
