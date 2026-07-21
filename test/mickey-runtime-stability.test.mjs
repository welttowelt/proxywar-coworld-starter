import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction,
  chooseMickeyRuntimeAction,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };
const growPlan = { intent: "grow", targetID: null, horizon: 4 };
// Exact per-episode Odin ID from Mickey hosted probe r2.
const odinID = "c4o8gv6v";

function observation({ incomingAttack = false } = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare: 0.05,
      troopRatio: 0.8,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: incomingAttack ? [{ attackerID: odinID }] : [],
    },
    combat: {
      incomingAttackPlayerIDs: incomingAttack ? [odinID] : [],
    },
    visiblePlayers: [{
      id: odinID,
      name: "K1Z odin free",
      isAlive: true,
      tileShare: 0.08,
      relativeTroopRatio: 1.2,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      incomingAttack,
    }],
  };
}

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function menu() {
  return [
    action(
      `alliance:${odinID}`,
      "alliance_request",
      "Alliance with K1Z odin free",
      { recipientID: odinID, recipientName: "K1Z odin free", relation: 2 },
    ),
    action(
      "expand:terra-nullius:10",
      "attack",
      "Expand Terra Nullius 10%",
      { expansion: true, troopPercent: 10 },
    ),
    action("hold", "hold", "Hold"),
  ];
}

test("Mickey runtime replaces an outgoing K1Z alliance request with stable growth", () => {
  const actions = menu();
  const state = buildState(observation(), actions, []);

  assert.equal(chooseAction(actions, state, null, []).kind, "alliance_request");
  const selected = chooseMickeyRuntimeAction(actions, state, null, []);
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "ms1");
});

test("Mickey runtime keeps a genuine intent action and its MM1 marker", () => {
  const actions = menu();
  const state = buildState(observation(), actions, []);
  const selected = chooseMickeyRuntimeAction(actions, state, growPlan, []);

  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "mm1g");
});

test("an invalid intent packet cannot reopen degraded alliance selection", () => {
  const actions = menu();
  const state = buildState(observation(), actions, []);
  const selected = chooseMickeyRuntimeAction(
    actions,
    state,
    { intent: "grow", targetID: null, horizon: 30 },
    [],
  );

  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "ms1");
});

test("a healthy planner cannot reopen the hosted alliance race", () => {
  const actions = [
    ...menu(),
    action(
      `alliance_reject:${odinID}`,
      "alliance_reject",
      "Reject alliance with K1Z odin free",
      { recipientID: odinID, recipientName: "K1Z odin free" },
    ),
  ];
  const state = buildState(observation(), actions, []);

  assert.equal(chooseAction(actions, state, growPlan, []).kind, "alliance_request");
  const selected = chooseMickeyRuntimeAction(actions, state, growPlan, []);
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "ms1");
});

test("alliance stabilization preserves a safe convert intent", () => {
  const targetID = "28k1hctz";
  const decoyID = "xbt2wt14";
  const actions = [
    ...menu(),
    action(
      `alliance_reject:${odinID}`,
      "alliance_reject",
      "Reject alliance with K1Z odin free",
      { recipientID: odinID, recipientName: "K1Z odin free" },
    ),
    action(
      `attack:${targetID}:10`,
      "attack",
      "Attack outsider 10%",
      { targetID, targetName: "outsider", troopPercent: 10 },
    ),
    action(
      `attack:${decoyID}:40`,
      "attack",
      "Attack decoy 40%",
      { targetID: decoyID, targetName: "decoy", troopPercent: 40 },
    ),
  ];
  const obs = observation();
  obs.ownState.tileShare = 0.2;
  obs.visiblePlayers.push({
    id: targetID,
    name: "outsider",
    isAlive: true,
    tileShare: 0.1,
    relativeTroopRatio: 1.8,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
  });
  obs.visiblePlayers.push({
    id: decoyID,
    name: "decoy",
    isAlive: true,
    tileShare: 0.3,
    relativeTroopRatio: 3,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
  });
  const state = buildState(obs, actions, []);
  const plan = { intent: "convert", targetID, horizon: 4 };

  assert.equal(chooseAction(actions, state, plan, []).kind, "alliance_request");
  const selected = chooseMickeyRuntimeAction(actions, state, plan, []);
  assert.equal(selected.id, `attack:${targetID}:10`);
  assert.equal(selected.policyMarker, "mm1c");
});

test("Mickey runtime never trades coalition safety for alliance stability", () => {
  const actions = [
    menu()[0],
    action(
      `attack:${odinID}:40`,
      "attack",
      "Attack K1Z odin free 40%",
      { targetID: odinID, targetName: "K1Z odin free", troopPercent: 40 },
    ),
    action("hold", "hold", "Hold"),
  ];
  const state = buildState(observation(), actions, []);
  const selected = chooseMickeyRuntimeAction(actions, state, null, []);

  assert.equal(selected.id, "hold");
  assert.notEqual(selected.id, `attack:${odinID}:40`);
});

test("observed K1Z aggression still reaches deterministic defense", () => {
  const actions = [
    menu()[0],
    action(
      `attack:${odinID}:40`,
      "attack",
      "Attack K1Z odin free 40%",
      { targetID: odinID, targetName: "K1Z odin free", troopPercent: 40 },
    ),
    action("hold", "hold", "Hold"),
  ];
  const state = buildState(observation({ incomingAttack: true }), actions, []);
  const selected = chooseMickeyRuntimeAction(actions, state, null, []);

  assert.equal(selected.id, `attack:${odinID}:40`);
});
