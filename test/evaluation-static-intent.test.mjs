import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_SURROGATE_SOURCE,
  STATIC_INTENT_ARMS,
  createStaticIntentScheduler,
  normalizeEvaluationDirective,
  staticIntentPlan,
} from "../evaluation-static-intent.mjs";
import { buildState, chooseAction } from "../strategy-engine.mjs";
import { buildSourceReachReceipt } from "../scripts/mickey-static-source-reach.mjs";

const lowRisk = { level: "low" };
const coalitionID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function rival({
  id,
  name,
  tileShare = 0.1,
  relativeTroopRatio = 1.8,
  incomingAttack = false,
} = {}) {
  return {
    id,
    name,
    isAlive: true,
    tileShare,
    relativeTroopRatio,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
    incomingAttack,
  };
}

function observation({
  tileShare = 0.05,
  rivals = [],
  incomingAttacks = [],
} = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio: 0.8,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks,
    },
    visiblePlayers: rivals,
  };
}

function stateFor(options = {}, actions = [], history = []) {
  return buildState(observation(options), actions, history);
}

function coalitionMenu() {
  return [
    action(
      "alliance:katanasan",
      "alliance_request",
      "Alliance with K1Z katanasan",
      { recipientID: coalitionID, recipientName: "K1Z katanasan", relation: 2 },
    ),
    action(
      "expand:terra-nullius:10",
      "attack",
      "Expand Terra Nullius 10%",
      { expansion: true, troopPercent: 10 },
    ),
  ];
}

test("static evaluation exposes only preregistered interpretable arms", () => {
  assert.equal(EVALUATION_SURROGATE_SOURCE, "static-eval-v1");
  assert.deepEqual(STATIC_INTENT_ARMS, [
    "m0",
    "grow-opening",
    "grow-low-share",
    "convert-weakest",
    "convert-largest",
  ]);
});

test("evaluation directives use the production normalizer and fail closed", () => {
  const state = stateFor({
    rivals: [rival({ id: "outsider", name: "Outsider" })],
  });
  const valid = normalizeEvaluationDirective(
    { intent: "convert", targetID: "outsider", horizon: 4 },
    state,
    "convert-weakest",
  );
  assert.equal(valid.intent, "convert");
  assert.equal(valid.targetID, "outsider");
  assert.equal(valid.model, "static-eval-v1:convert-weakest");
  assert.equal(valid.surrogateSource, "static-eval-v1");
  assert.equal(valid.surrogateArm, "convert-weakest");

  for (const directive of [
    { intent: "grow", targetID: null, horizon: "4" },
    { intent: "grow", targetID: null, horizon: 4, actionID: "hold" },
    { intent: "convert", targetID: "missing", horizon: 4 },
    { intent: "finish", targetID: null, horizon: 4 },
  ]) {
    assert.equal(
      normalizeEvaluationDirective(directive, state, "grow-opening"),
      null,
    );
  }
  assert.equal(
    normalizeEvaluationDirective(
      { intent: "grow", targetID: null, horizon: 4 },
      state,
      "not-an-arm",
    ),
    null,
  );
});

test("M0 is the exact no-intent Mickey chassis control", () => {
  const menu = coalitionMenu();
  const state = stateFor({
    rivals: [rival({ id: coalitionID, name: "K1Z katanasan" })],
  }, menu);
  const plan = staticIntentPlan("m0", state, []);
  const baseline = chooseAction(menu, state, null, []);
  const control = chooseAction(menu, state, plan, []);
  assert.equal(plan, null);
  assert.deepEqual(control, baseline);
  assert.equal(control.id, "alliance:katanasan");
  assert.equal(control.policyMarker, "kp2");
});

test("grow-opening changes only the bounded opening action and emits mm1g", () => {
  const menu = coalitionMenu();
  const earlyHistory = [];
  const earlyState = stateFor({
    rivals: [rival({ id: coalitionID, name: "K1Z katanasan" })],
  }, menu, earlyHistory);
  const plan = staticIntentPlan("grow-opening", earlyState, earlyHistory);
  const baseline = chooseAction(menu, earlyState, null, earlyHistory);
  const selected = chooseAction(menu, earlyState, plan, earlyHistory);
  assert.equal(baseline.id, "alliance:katanasan");
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "mm1g");

  const lateHistory = Array.from({ length: 20 }, (_, index) => ({
    actionID: `build:${index}`,
    kind: "build",
    tileShare: 0.05,
  }));
  const lateState = stateFor({
    rivals: [rival({ id: coalitionID, name: "K1Z katanasan" })],
  }, menu, lateHistory);
  assert.equal(staticIntentPlan("grow-opening", lateState, lateHistory), null);
});

test("grow-opening counts twenty active decisions rather than the spawn", () => {
  const menu = coalitionMenu();
  const nineteenActive = [
    { actionID: "spawn:1", kind: "spawn", tileShare: 0 },
    ...Array.from({ length: 19 }, (_, index) => ({
      actionID: `build:${index}`,
      kind: "build",
      tileShare: 0.05,
    })),
  ];
  const earlyState = stateFor({ tileShare: 0.05 }, menu, nineteenActive);
  assert.equal(
    staticIntentPlan("grow-opening", earlyState, nineteenActive).intent,
    "grow",
  );

  const twentyActive = [
    ...nineteenActive,
    { actionID: "build:20", kind: "build", tileShare: 0.05 },
  ];
  const lateState = stateFor({ tileShare: 0.05 }, menu, twentyActive);
  assert.equal(staticIntentPlan("grow-opening", lateState, twentyActive), null);
});

test("grow-low-share is a strict subset of grow-opening", () => {
  const menu = coalitionMenu();
  const calmLow = stateFor({ tileShare: 0.08 }, menu);
  const calmHigh = stateFor({ tileShare: 0.14 }, menu);

  assert.equal(staticIntentPlan("grow-low-share", calmLow, []).intent, "grow");
  assert.equal(staticIntentPlan("grow-low-share", calmHigh, []), null);
  assert.equal(staticIntentPlan("grow-opening", calmLow, []).intent, "grow");
  assert.equal(staticIntentPlan("grow-opening", calmHigh, []).intent, "grow");
});

test("convert arms select exact visible outsiders with distinct single rankings", () => {
  const outsiders = [
    rival({
      id: "weak-small",
      name: "Weak Small",
      tileShare: 0.08,
      relativeTroopRatio: 2.2,
    }),
    rival({
      id: "large-less-weak",
      name: "Large Less Weak",
      tileShare: 0.2,
      relativeTroopRatio: 1.5,
    }),
  ];
  const menu = [
    action("attack:weak-small:10", "attack", "Attack Weak Small 10%", {
      targetID: "weak-small", targetName: "Weak Small", troopPercent: 10,
    }),
    action("attack:large-less-weak:10", "attack", "Attack Large Less Weak 10%", {
      targetID: "large-less-weak", targetName: "Large Less Weak", troopPercent: 10,
    }),
    action("hold", "hold", "Hold"),
  ];
  const state = stateFor({ tileShare: 0.2, rivals: outsiders }, menu);

  const weakest = staticIntentPlan("convert-weakest", state, []);
  const largest = staticIntentPlan("convert-largest", state, []);
  assert.equal(weakest.targetID, "weak-small");
  assert.equal(largest.targetID, "large-less-weak");

  const baseline = chooseAction(menu, state, null, []);
  const largestAction = chooseAction(menu, state, largest, []);
  assert.equal(baseline.id, "attack:weak-small:10");
  assert.equal(largestAction.id, "attack:large-less-weak:10");
  assert.equal(largestAction.policyMarker, "mm1c");
});

test("static scheduler keeps one conversion target for its four-decision horizon", () => {
  const firstState = stateFor({
    tileShare: 0.2,
    rivals: [
      rival({ id: "alpha", name: "Alpha", relativeTroopRatio: 2.2 }),
      rival({ id: "beta", name: "Beta", relativeTroopRatio: 1.5 }),
    ],
  });
  const changedState = stateFor({
    tileShare: 0.2,
    rivals: [
      rival({ id: "alpha", name: "Alpha", relativeTroopRatio: 1.5 }),
      rival({ id: "beta", name: "Beta", relativeTroopRatio: 2.4 }),
    ],
  });
  const scheduler = createStaticIntentScheduler("convert-weakest");

  assert.equal(scheduler.next(firstState, []).plan.targetID, "alpha");
  for (let decision = 2; decision <= 4; decision++) {
    const scheduled = scheduler.next(changedState, []);
    assert.equal(scheduled.plan.targetID, "alpha", `decision ${decision}`);
    assert.equal(scheduled.refreshed, false, `decision ${decision}`);
  }
  const refreshed = scheduler.next(changedState, []);
  assert.equal(refreshed.plan.targetID, "beta");
  assert.equal(refreshed.refreshed, true);
});

test("all-K1Z rosters yield no conversion directive and no K1Z harm", () => {
  const protectedPlayers = [
    ["ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c", "K1Z odin free"],
    ["ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863", "K1Z Hrafn"],
    [coalitionID, "K1Z katanasan"],
    ["ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335", "K1Z Gravity"],
  ];
  const rivals = protectedPlayers.map(([id, name]) => rival({
    id, name, tileShare: 0.2, relativeTroopRatio: 4,
  }));
  const menu = protectedPlayers.map(([id, name]) => action(
    `attack:${id}:40`,
    "attack",
    `Attack ${name} 40%`,
    { targetID: id, targetName: name, troopPercent: 40 },
  ));
  menu.push(action("expand:terra-nullius:10", "attack", "Expand Terra Nullius 10%", {
    expansion: true, troopPercent: 10,
  }));
  const state = stateFor({ tileShare: 0.2, rivals }, menu);

  for (const arm of ["convert-weakest", "convert-largest"]) {
    const plan = staticIntentPlan(arm, state, []);
    const selected = chooseAction(menu, state, plan, []);
    assert.equal(plan, null, arm);
    assert.equal(selected.id.startsWith("attack:ply_"), false, arm);
    assert.notEqual(selected.policyMarker, "mm1c", arm);
  }
});

test("retained arms have unique selected-action traces and honest source reach", async () => {
  const receipt = await buildSourceReachReceipt("0".repeat(40));
  assert.equal(receipt.evidence_scope, "deterministic-source-fixtures-only");
  assert.equal(receipt.upload_eligible, false);
  assert.equal(receipt.arms.length, 5);
  assert.equal(
    new Set(receipt.arms.map((arm) => arm.selected_action_trace_sha256)).size,
    receipt.arms.length,
  );
  assert.equal(
    new Set(receipt.arms.map((arm) => arm.entrypoint_sha256)).size,
    receipt.arms.length,
  );
  for (const arm of receipt.arms) {
    assert.equal(arm.mechanism_reached, arm.expected_mechanism_reach, arm.id);
    assert.equal(arm.k1z_harm_count, 0, arm.id);
  }
  assert.equal(receipt.arms.find((arm) => arm.id === "m0").mechanism_reached, false);
  for (const id of [
    "grow-opening", "grow-low-share", "convert-weakest", "convert-largest",
  ]) {
    assert.equal(receipt.arms.find((arm) => arm.id === id).mechanism_reached, true, id);
  }
});
