import assert from "node:assert/strict";
import test from "node:test";

import { chooseIntentCoreAction } from "../intent-core.mjs";
import { buildState } from "../strategy-engine.mjs";

const MICKEY_ID = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";
const GRAVITY_ID = "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335";
const KATANA_ID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";

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

function upgrade(unit = "Port", unitId = 95) {
  return action(`upgrade:${unit}:${unitId}`, "upgrade_structure", `Upgrade ${unit}`, {
    unit,
    unitId,
  });
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

test("grow delegates safe neutral territory first", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "grow", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("a removed secure intent falls back to grow", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "secure", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("finish ranks a safe finishing target first", () => {
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
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixfin"));
});

test("intent cannot override pressure defense", () => {
  const selected = decide([attack("raider"), land(), hold()], "grow", {
    incoming: ["raider"],
    rivals: [{ id: "raider", name: "raider", tileShare: 0.2, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, "attack:raider:40");
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("a removed secure intent cannot restore the upgrade-only family", () => {
  const bomb = build("Atom Bomb", {
    targetID: "leader",
    targetName: "Leader",
    targetTileShare: 0.79,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const city = build("City");
  const selected = decide([bomb, city, hold()], "secure", {
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 1 }],
  });
  assert.equal(selected.id, city.id);
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow keeps a strike outside its action family", () => {
  const bomb = build("Atom Bomb", {
    targetID: "leader",
    targetName: "Leader",
    targetTileShare: 0.79,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const selected = decide([bomb, land(), hold()], "grow", {
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 1 }],
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow ranks direct capacity ahead of maintenance upgrades", () => {
  const selected = decide([upgrade(), build("City"), hold()], "grow");
  assert.equal(selected.id, "build:City");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow preserves an upgrade when no direct grow action exists", () => {
  const selected = decide([upgrade(), hold()], "grow");
  assert.equal(selected.id, "upgrade:Port:95");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("direct-grow filtering does not alter the finish menu", () => {
  const selected = decide([upgrade(), hold()], "finish");
  assert.equal(selected.id, "upgrade:Port:95");
  assert.ok(selected.policyMarkers.includes("ixfin"));
});

test("unavailable intent defaults to productive grow ranking", () => {
  const selected = decide([attack("rival"), hold()], "grow", {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, "attack:rival:40");
  assert.notEqual(selected.kind, "hold");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("a symbolic-only menu yields to hold", () => {
  const alliance = action("alliance:rival", "alliance_request", "Ally rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const selected = decide([alliance, hold()], "grow", {
    incoming: ["raider"],
    rivals: [
      { id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 0.9 },
      { id: "raider", name: "raider", tileShare: 0.3, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(selected.id, "hold");
});

test("grow cannot substitute alliance activity for material progress", () => {
  const alliance = action("alliance:rival", "alliance_request", "Ally rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const selected = decide([alliance, build(), hold()], "grow", {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 1 }],
  });
  assert.equal(selected.id, "build:Factory");
});

test("grow cannot substitute alliance activity for immediate defense", () => {
  const alliance = action("alliance:rival", "alliance_request", "Ally rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const selected = decide([alliance, attack("raider"), hold()], "grow", {
    incoming: ["raider"],
    rivals: [
      { id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 0.9 },
      { id: "raider", name: "raider", tileShare: 0.3, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(selected.id, "attack:raider:40");
});

test("repeated symbolic pressure yields to a productive action", () => {
  const target = action("target:rival", "target_player", "Target rival", {
    targetID: "rival",
    targetName: "rival",
  });
  const history = Array.from({ length: 3 }, () => ({
    actionID: target.id,
    kind: target.kind,
    targetID: "rival",
    targetName: "rival",
    tileShare: 0.12,
  }));
  const selected = decide([target, build(), hold()], "finish", {
    history,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 1 }],
  });
  assert.equal(selected.id, "build:Factory");
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixfin"));
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

test("Gravity and Katana identities stay absolute no-harm under pressure", () => {
  for (const [id, name] of [
    ["gravity-canonical", "K1Z Gravity"],
    ["gravity-runtime", "CYAN HELLSTAR"],
    ["katana-canonical", "K1Z katanasan"],
    ["katana-runtime", "SIAN VOIDCROWN"],
    [GRAVITY_ID, "unrecognized gravity alias"],
    [KATANA_ID, "unrecognized katana alias"],
  ]) {
    const selected = decide([attack(id), hold()], "finish", {
      tileShare: 0.6,
      incoming: [id],
      rivals: [{
        id,
        name,
        tileShare: 0.2,
        relativeTroopRatio: 2,
      }],
    });
    assert.equal(selected.id, "hold", name);
    assert.ok(selected.policyMarkers.includes("ixfin"));
  }
});

test("grow cannot disguise a K1Z strike as infrastructure", () => {
  const bomb = build("Atom Bomb", {
    targetID: MICKEY_ID,
    targetName: "K1Z Mickey Mouse",
    targetTileShare: 0.8,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const selected = decide([bomb, hold()], "grow", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.8,
      relativeTroopRatio: 1,
    }],
  });
  assert.equal(selected.id, "hold");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
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

test("spawn remains the ranker's absolute first action", () => {
  const spawn = action("spawn:1", "spawn", "Spawn");
  assert.equal(decide([land(), spawn], "finish").id, spawn.id);
});
