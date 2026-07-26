import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseCaptainUnderpantsRuntimeAction,
  chooseCyan7RuntimeAction,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function observation({
  tileShare = 0.1,
  troopRatio = 0.9,
  incomingAttacks = [],
  rivals = [],
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
      spawnTile: 373314,
    },
    combat: {
      incomingAttackPlayerIDs: incomingAttacks
        .map((entry) => entry?.attackerID)
        .filter(Boolean),
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

function history(length = 8) {
  return Array.from({ length }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.05 + index * 0.005,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
    incomingAttackerNames: [],
  }));
}

function select(actions, obs, prior = []) {
  const state = buildState(obs, actions, prior);
  return chooseCyan7RuntimeAction(actions, state, null, prior);
}

test("cyan7 gives a formerly protected K1Z rival no immunity", () => {
  const alliance = action(
    "alliance:katanasan",
    "alliance_request",
    "Alliance with K1Z katanasan",
    {
      recipientID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      recipientName: "K1Z katanasan",
      relation: 0,
    },
  );
  const attack = action(
    "attack:katanasan:25",
    "attack",
    "Attack K1Z katanasan 25%",
    {
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      troopPercent: 25,
    },
  );
  const obs = observation({
    tileShare: 0.2,
    rivals: [{
      id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      name: "K1Z katanasan",
      tileShare: 0.15,
      relativeTroopRatio: 1.5,
    }],
  });
  assert.equal(select([alliance, attack], obs).id, attack.id);
});

test("cyan7 requests a material nonhostile ally only when trailing under pressure", () => {
  const request = action(
    "alliance:support",
    "alliance_request",
    "Alliance with Support",
    { recipientID: "support", recipientName: "Support", relation: 1 },
  );
  const hold = action("hold", "hold", "Hold");
  const pressured = observation({
    tileShare: 0.08,
    incomingAttacks: [{ attackerID: "leader" }],
    rivals: [
      {
        id: "support",
        name: "Support",
        tileShare: 0.14,
        relativeTroopRatio: 0.8,
      },
      {
        id: "leader",
        name: "Leader",
        tileShare: 0.31,
        relativeTroopRatio: 0.7,
        incomingAttack: true,
      },
    ],
  });
  const selected = select([request, hold], pressured, history());
  assert.equal(selected.id, request.id);
  assert.equal(selected.policyMarker, "c71");

  const level = observation({
    tileShare: 0.3,
    rivals: [
      {
        id: "support",
        name: "Support",
        tileShare: 0.14,
        relativeTroopRatio: 0.8,
      },
      {
        id: "leader",
        name: "Leader",
        tileShare: 0.31,
        relativeTroopRatio: 0.7,
      },
    ],
  });
  assert.equal(select([request, hold], level, history()).id, hold.id);
});

test("cyan7 can break any profitable alliance immediately", () => {
  const sever = action(
    "break_alliance:katanasan",
    "break_alliance",
    "Break alliance with K1Z katanasan",
    {
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
    },
  );
  const land = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const obs = observation({
    tileShare: 0.2,
    rivals: [{
      id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      name: "K1Z katanasan",
      tileShare: 0.3,
      relativeTroopRatio: 1.3,
      isAllied: true,
    }],
  });
  const selected = select([sever, land], obs, history(1));
  assert.equal(selected.id, sever.id);
  assert.equal(selected.policyMarker, "c72");
});

test("cyan7 remains exactly WC6 when the liquid-alliance mechanism is irrelevant", () => {
  const rivalAttack = action(
    "attack:rival:10",
    "attack",
    "Attack Rival 10%",
    { targetID: "rival", targetName: "Rival", troopPercent: 10 },
  );
  const neutralBoat = action(
    "boat:terra-nullius:8",
    "boat",
    "Boat to Terra Nullius 8%",
    {
      targetID: null,
      targetName: "Terra Nullius",
      troopPercent: 8,
      expansion: true,
    },
  );
  const prior = history(8);
  const obs = observation({
    tileShare: 0.03,
    rivals: [{
      id: "rival",
      name: "Rival",
      tileShare: 0.04,
      relativeTroopRatio: 1.29,
    }],
  });
  obs.ownState.spawnTile = 1014590;
  const actions = [rivalAttack, neutralBoat];
  const state = buildState(obs, actions, prior);
  assert.deepEqual(
    chooseCyan7RuntimeAction(actions, state, null, prior),
    chooseCaptainUnderpantsRuntimeAction(actions, state, null, prior),
  );
});
