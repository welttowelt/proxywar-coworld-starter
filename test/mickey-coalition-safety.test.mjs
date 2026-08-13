import assert from "node:assert/strict";
import test from "node:test";

import { buildState, chooseAction } from "../strategy-engine.mjs";

const protectedPlayers = [
  ["ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c", "K1Z odin free"],
  ["ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863", "K1Z Hrafn"],
  ["ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba", "K1Z katanasan"],
  ["ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335", "K1Z Gravity"],
];

function observation(id, name, incomingAttack = false) {
  return {
    phase: "active",
    ownState: {
      tileShare: 0.2,
      troopRatio: 0.9,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: incomingAttack ? [{ attackerID: id }] : [],
    },
    combat: { incomingAttackPlayerIDs: incomingAttack ? [id] : [] },
    visiblePlayers: [{
      id,
      name,
      isAlive: true,
      tileShare: 0.2,
      relativeTroopRatio: 2,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      incomingAttack,
    }],
  };
}

function actions(id, name) {
  const low = { level: "low" };
  return [
    {
      id: `attack:${id}:40`,
      kind: "attack",
      label: `Attack ${name} 40%`,
      risk: low,
      metadata: { targetID: id, targetName: name, troopPercent: 40 },
    },
    {
      id: "expand:terra-nullius:10",
      kind: "attack",
      label: "Expand Terra Nullius 10%",
      risk: low,
      metadata: { expansion: true, troopPercent: 10 },
    },
    { id: "hold", kind: "hold", label: "Hold", risk: low },
  ];
}

test("Mickey never targets an unprovoked protected player", () => {
  for (const [id, name] of protectedPlayers) {
    const menu = actions(id, name);
    const state = buildState(observation(id, name), menu, []);
    const selected = chooseAction(
      menu,
      state,
      { intent: "convert", targetID: id, horizon: 4 },
      [],
    );
    assert.notEqual(selected.id, `attack:${id}:40`, name);
  }
});

test("exact metadata IDs defeat adversarial rival-name collisions", () => {
  const low = { level: "low" };
  for (const [id, name] of protectedPlayers) {
    const menu = [
      {
        id: `attack:${id}:10`,
        kind: "attack",
        label: `Attack ${name} 10%`,
        risk: low,
        metadata: { targetID: id, targetName: name, troopPercent: 10 },
      },
      {
        id: "attack:ply_spoof:40",
        kind: "attack",
        label: "Attack Attack 40%",
        risk: low,
        metadata: { targetID: "ply_spoof", targetName: "Attack", troopPercent: 40 },
      },
      { id: "hold", kind: "hold", label: "Hold", risk: low },
    ];
    const obs = observation(id, name);
    obs.visiblePlayers.unshift({
      id: "ply_spoof",
      name: "Attack",
      isAlive: true,
      tileShare: 0.1,
      relativeTroopRatio: 2,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    });
    const state = buildState(obs, menu, []);
    const selected = chooseAction(menu, state, null, []);
    assert.notEqual(selected.id, `attack:${id}:10`, name);
  }
});

test("incoming pressure does not revoke coalition no-harm", () => {
  const [id, name] = protectedPlayers[0];
  const menu = actions(id, name);
  const state = buildState(observation(id, name, true), menu, []);
  const selected = chooseAction(menu, state, null, []);
  assert.equal(selected.id, "expand:terra-nullius:10");
});
