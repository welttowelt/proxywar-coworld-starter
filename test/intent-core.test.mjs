import assert from "node:assert/strict";
import test from "node:test";

import { chooseIntentCoreAction } from "../intent-core.mjs";
import { buildState } from "../strategy-engine.mjs";

const MICKEY_ID = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: { level: "low" } };
}

function observation({ rivals = [], incoming = [], tileShare = 0.12 } = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio: 1,
      troops: 1_000_000,
      gold: 500_000,
      borderTiles: 100,
      incomingAttacks: incoming.length,
    },
    combat: { incomingAttackPlayerIDs: incoming },
    visiblePlayers: rivals.map((rival) => ({
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      ...rival,
    })),
  };
}

function decide(actions, intent, options = {}) {
  const history = options.history ?? [];
  const state = buildState(observation(options), actions, history);
  return chooseIntentCoreAction(actions, state, intent ? { intent } : null, history);
}

function land(percent = 35) {
  return action(`expand:terra-nullius:${percent}`, "attack", "Expand Terra Nullius", {
    expansion: true,
    troopPercent: percent,
  });
}

function build(unit = "Factory", metadata = {}) {
  return action(`build:${unit}`, "build", `Build ${unit}`, { unit, ...metadata });
}

function attack(targetID, percent = 40, risk = "low") {
  return {
    ...action(`attack:${targetID}:${percent}`, "attack", `Attack ${targetID}`, {
      targetID,
      targetName: targetID,
      troopPercent: percent,
    }),
    risk: { level: risk },
  };
}

function hold() {
  return action("hold", "hold", "Hold");
}

test("grow softly prefers safe neutral territory", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "grow", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.deepEqual(selected.policyMarkers, ["is1g", "ixgrw"]);
});

test("secure softly prefers an available economy action", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "secure", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "build:Factory");
  assert.deepEqual(selected.policyMarkers, ["is1s", "ixsec"]);
});

test("finish softly prefers a safe mature finishing target", () => {
  const history = [{
    actionID: "attack:rival:10",
    kind: "attack",
    targetID: "rival",
    targetName: "rival",
    tileShare: 0.2,
  }];
  const selected = decide([attack("rival"), build(), land(), hold()], "finish", {
    history,
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.8 }],
  });
  assert.equal(selected.id, "attack:rival:40");
  assert.deepEqual(selected.policyMarkers, ["is1f", "ixfin"]);
});

test("intent cannot override pressure defense", () => {
  const selected = decide([attack("raider"), land(), hold()], "grow", {
    incoming: ["raider"],
    rivals: [{ id: "raider", name: "raider", tileShare: 0.2, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, "attack:raider:40");
  assert.deepEqual(selected.policyMarkers, ["ixgrw"]);
});

test("intent cannot override safe atom-bomb economy", () => {
  const bomb = build("Atom Bomb", {
    targetID: "leader",
    targetName: "Leader",
    targetTileShare: 0.79,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const selected = decide([bomb, build("City"), hold()], "secure", {
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 1 }],
  });
  assert.equal(selected.id, bomb.id);
  assert.deepEqual(selected.policyMarkers, ["nk1", "ixsec"]);
});

test("unavailable intent falls through to the productive mature baseline", () => {
  const selected = decide([attack("rival"), hold()], "grow", {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, "attack:rival:40");
  assert.notEqual(selected.kind, "hold");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("symbolic strategy remains available instead of becoming an intent hold", () => {
  const alliance = action("alliance:rival", "alliance_request", "Ally rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const selected = decide([alliance, hold()], "secure", {
    incoming: ["raider"],
    rivals: [
      { id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 0.9 },
      { id: "raider", name: "raider", tileShare: 0.3, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(selected.id, alliance.id);
  assert.notEqual(selected.kind, "hold");
});

test("no intent can harm K1Z Mickey Mouse", () => {
  const selected = decide([attack(MICKEY_ID), hold()], "finish", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 2,
    }],
  });
  assert.equal(selected.id, "hold");
  assert.ok(selected.policyMarkers.includes("ixfin"));
});

test("secure cannot disguise a K1Z strike as infrastructure", () => {
  const bomb = build("Atom Bomb", {
    targetID: MICKEY_ID,
    targetName: "K1Z Mickey Mouse",
    targetTileShare: 0.8,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const selected = decide([bomb, hold()], "secure", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.8,
      relativeTroopRatio: 1,
    }],
  });
  assert.equal(selected.id, "hold");
  assert.ok(selected.policyMarkers.includes("ixsec"));
});

test("a missing or stale plan uses the grow preference", () => {
  const menu = [land(), attack("rival"), hold()];
  const options = {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  };
  assert.equal(decide(menu, null, options).id, "expand:terra-nullius:35");
  const history = [];
  const state = buildState(observation(options), menu, history);
  assert.equal(chooseIntentCoreAction(menu, state, { intent: "defend" }, history).id,
    "expand:terra-nullius:35");
});

test("spawn remains owned by the mature selector", () => {
  const spawn = action("spawn:1", "spawn", "Spawn");
  assert.equal(decide([land(), spawn], "finish").id, spawn.id);
});
