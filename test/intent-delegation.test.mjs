import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, risk = lowRisk) {
  return { id, kind, label, risk };
}

function observation({
  tileShare = 0.05,
  troopRatio = 0.8,
  rivals = [],
  incomingAttacks = [],
} = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks,
    },
    visiblePlayers: rivals.map((rival) => ({
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      ...rival,
    })),
  };
}

function choose(actions, obs, plan = null, history = []) {
  const state = buildState(obs, actions, history);
  return chooseAction(actions, state, plan, history);
}

function allianceAndLand({ landRisk = lowRisk } = {}) {
  const alliance = {
    ...action("alliance:katanasan", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: {
      recipientID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      recipientName: "K1Z katanasan",
      relation: 2,
    },
  };
  const land = {
    ...action(
      "expand:terra-nullius:10",
      "attack",
      "Expand Terra Nullius 10%",
      landRisk,
    ),
    metadata: { expansion: true, troopPercent: 10 },
  };
  const obs = observation({
    rivals: [{
      id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      name: "K1Z katanasan",
      tileShare: 0.08,
      relativeTroopRatio: 1.2,
    }],
  });
  return { alliance, land, obs };
}

test("grow intent delegates a proactive coalition request to safe land", () => {
  const { alliance, land, obs } = allianceAndLand();
  const selected = choose([alliance, land], obs, { intent: "grow" });
  assert.equal(selected.id, land.id);
  assert.equal(selected.policyMarker, "id1");
});

test("no intent remains exact-parent coalition behavior", () => {
  const { alliance, land, obs } = allianceAndLand();
  const selected = choose([alliance, land], obs);
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("grow intent preserves a genuine coalition reverse handshake", () => {
  const { alliance, land, obs } = allianceAndLand();
  const reject = {
    ...action(
      "alliance_reject:katanasan",
      "alliance_reject",
      "Reject alliance with K1Z katanasan",
    ),
    metadata: {
      recipientID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      recipientName: "K1Z katanasan",
    },
  };
  const selected = choose([alliance, reject, land], obs, { intent: "grow" });
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("grow intent preserves pressure defense", () => {
  const { alliance, land, obs } = allianceAndLand();
  const city = action("build:city:1", "build", "Build City");
  obs.ownState.troopRatio = 0.5;
  obs.ownState.incomingAttacks = [{ attackerID: "foe" }];
  const selected = choose([alliance, land, city], obs, { intent: "grow" });
  assert.equal(selected.id, city.id);
  assert.equal(selected.policyMarker, undefined);
});

test("grow intent delegates collapsing territory to the exact parent", () => {
  const { alliance, land, obs } = allianceAndLand();
  obs.ownState.tileShare = 0.05;
  const history = [0.1, 0.09, 0.08].map((tileShare, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare,
  }));
  const selected = choose([alliance, land], obs, { intent: "grow" }, history);
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("grow intent delegates stalled expansion to the exact parent", () => {
  const { alliance, land, obs } = allianceAndLand();
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.05,
  }));
  const selected = choose([alliance, land], obs, { intent: "grow" }, history);
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("grow intent never overrides an attack already selected by the parent", () => {
  const rivalAttack = {
    ...action("attack:outsider:10", "attack", "Attack Outsider 10%"),
    metadata: { targetID: "outsider", troopPercent: 10 },
  };
  const land = {
    ...action("expand:terra-nullius:10", "attack", "Expand Terra Nullius 10%"),
    metadata: { expansion: true, troopPercent: 10 },
  };
  const obs = observation({
    tileShare: 0.2,
    rivals: [{
      id: "outsider",
      name: "Outsider",
      tileShare: 0.1,
      relativeTroopRatio: 2,
    }],
  });
  const selected = choose([rivalAttack, land], obs, { intent: "grow" });
  assert.equal(selected.id, rivalAttack.id);
  assert.equal(selected.policyMarker, undefined);
});

test("grow intent does not route through high-risk land", () => {
  const { alliance, land, obs } = allianceAndLand({
    landRisk: { level: "high" },
  });
  const selected = choose([alliance, land], obs, { intent: "grow" });
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("unimplemented intents stay exact parent", () => {
  const { alliance, land, obs } = allianceAndLand();
  for (const intent of ["convert", "stabilize", "support", "finish"]) {
    const selected = choose([alliance, land], obs, { intent });
    assert.equal(selected.id, alliance.id);
    assert.equal(selected.policyMarker, "kp2");
  }
});

test("grow intent expires after twenty active decisions", () => {
  const { alliance, land, obs } = allianceAndLand();
  const history = Array.from({ length: 20 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.02 + index * 0.001,
  }));
  const selected = choose([alliance, land], obs, { intent: "grow" }, history);
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.policyMarker, "kp2");
});
