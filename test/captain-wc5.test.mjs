import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction,
  chooseCaptainUnderpantsRuntimeAction,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id) {
  return { id, kind, label, risk: lowRisk };
}

function fixture({
  spawnTile = 1088580,
  ratio = 1.1,
  currentPressure = false,
  recentPressure = false,
  priorConflictKind = null,
  historyLength = 6,
  ownTileShare = 0.03,
  targetTileShare = 0.1,
} = {}) {
  const rivalAttack = {
    ...action("attack:rival:10", "attack", "Attack Rival 10%"),
    metadata: {
      targetID: "rival",
      targetName: "Rival",
      troopPercent: 10,
      incomingAttack: currentPressure,
    },
  };
  const neutralBoat = {
    ...action("boat:terra-nullius:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: {
      targetID: null,
      targetName: "Terra Nullius",
      troopPercent: 8,
      expansion: true,
    },
  };
  const city = {
    ...action("build:city:1", "build", "Build City"),
    metadata: { unit: "City" },
  };
  const history = Array.from({ length: historyLength }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: Math.min(0.005 + index * 0.004, 0.03),
    incomingAttackerIDs: recentPressure && index === 0 ? ["rival"] : [],
    allProtocolAttackerIDs: recentPressure && index === 0 ? ["rival"] : [],
    incomingAttackerNames: recentPressure && index === 0 ? ["Rival"] : [],
  }));
  if (priorConflictKind && history.length > 0) {
    history[history.length - 1] = {
      ...history[history.length - 1],
      actionID: `${priorConflictKind}:rival:10`,
      kind: priorConflictKind,
      neutral: false,
      targetID: "rival",
      targetName: "Rival",
    };
  }
  const actions = [rivalAttack, neutralBoat, city];
  const observation = {
    phase: "active",
    ownState: {
      tileShare: ownTileShare,
      troopRatio: 0.9,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: currentPressure ? [{ attackerID: "rival" }] : [],
      spawnTile,
    },
    combat: {
      incomingAttackPlayerIDs: currentPressure ? ["rival"] : [],
    },
    visiblePlayers: [{
      id: "rival",
      name: "Rival",
      tileShare: targetTileShare,
      relativeTroopRatio: ratio,
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    }],
  };
  const state = buildState(observation, actions, history);
  return { actions, state, history, rivalAttack, neutralBoat };
}

function parent(f) {
  return chooseAction(f.actions, f.state, null, f.history);
}

function candidate(f) {
  return chooseCaptainUnderpantsRuntimeAction(f.actions, f.state, null, f.history);
}

test("WC5 defers replay-shaped calm World first contact at marginal ratio", () => {
  const f = fixture();
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.equal(candidate(f).id, f.neutralBoat.id);
  assert.equal(candidate(f).policyMarker, "wc5");
});

test("WC5 preserves current and recent retaliation byte-for-byte", () => {
  for (const f of [
    fixture({ currentPressure: true }),
    fixture({ recentPressure: true }),
  ]) {
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC5 applies only before any recorded player conflict", () => {
  for (const priorConflictKind of ["attack", "boat"]) {
    const f = fixture({ priorConflictKind });
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC5 preserves a marginal attack against a territorially smaller rival", () => {
  const f = fixture({ ownTileShare: 0.03, targetTileShare: 0.02, ratio: 1.16 });
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.deepEqual(candidate(f), parent(f));
});

test("WC5 preserves strong conversions and non-World openings", () => {
  for (const f of [
    fixture({ ratio: 1.3 }),
    fixture({ spawnTile: 659528 }),
    fixture({ spawnTile: 1180588 }),
  ]) {
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC5 preserves exact v1 after the opening horizon", () => {
  const f = fixture({ historyLength: 20 });
  assert.deepEqual(candidate(f), parent(f));
});
