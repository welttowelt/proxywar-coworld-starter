import assert from "node:assert/strict";
import test from "node:test";

import { chooseIntentCoreAction } from "../intent-core.mjs";
import {
  buildState,
  chooseCaptainUnderpantsRuntimeAction,
} from "../strategy-engine.mjs";

const MICKEY_ID = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";
const GRAVITY_ID = "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335";
const KATANA_ID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: { level: "low" } };
}

function observation({
  rivals = [],
  incoming = [],
  tileShare = 0.12,
  troopRatio = 1,
} = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio,
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

test("grow is an outcome rather than a neutral-action instruction", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "grow", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "attack:rival:40");
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("a removed secure intent falls back to grow", () => {
  const selected = decide([attack("rival"), build(), land(), hold()], "secure", {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.6 }],
  });
  assert.equal(selected.id, "attack:rival:40");
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

test("an unknown intent defaults to grow without filtering executor capabilities", () => {
  const bomb = build("Atom Bomb", {
    targetID: "leader",
    targetName: "Leader",
    targetTileShare: 0.79,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const city = build("City");
  const actions = [bomb, city, hold()];
  const options = {
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 1 }],
  };
  const history = [];
  const state = buildState(observation(options), actions, history);
  const selected = chooseIntentCoreAction(actions, state, { intent: "secure" }, history);
  const delegated = chooseCaptainUnderpantsRuntimeAction(
    actions,
    state,
    { strategicIntent: "grow" },
    history,
  );
  assert.equal(selected.id, delegated.id);
  assert.ok(selected.policyMarkers.includes("ib2"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow asks the mature executor for direct conversion before stockpiling", () => {
  const bomb = build("Atom Bomb", {
    targetID: "leader",
    targetName: "Leader",
    targetTileShare: 0.79,
    targetSamCoverage: 0,
    nuclearTargetPriority: 267,
  });
  const actions = [bomb, land(), hold()];
  const options = {
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 1 }],
  };
  const history = [];
  const state = buildState(observation(options), actions, history);
  const selected = chooseIntentCoreAction(actions, state, { intent: "grow" }, history);
  const delegated = chooseCaptainUnderpantsRuntimeAction(
    actions,
    state,
    null,
    history,
  );
  assert.equal(delegated.id, bomb.id);
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.ok(selected.policyMarkers.includes("ig1"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow preserves an upgrade when no direct grow action exists", () => {
  const selected = decide([upgrade(), hold()], "grow");
  assert.equal(selected.id, "upgrade:Port:95");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow does not force a high-risk hostile action past maintenance", () => {
  const selected = decide([upgrade(), attack("rival", 40, "high"), hold()], "grow", {
    tileShare: 0.01,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 0.2 }],
  });
  assert.equal(selected.id, "upgrade:Port:95");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("finish delegates an upgrade-only menu", () => {
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

test("intent delegates a safe pending inbound alliance to the mature executor", () => {
  const reject = action("alliance_reject:rival", "alliance_reject", "Reject rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const alliance = action("alliance:rival", "alliance_request", "Ally rival", {
    recipientID: "rival",
    recipientName: "rival",
  });
  const selected = decide([reject, alliance, hold()], "grow", {
    tileShare: 0.08,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 0.7 }],
  });
  assert.equal(selected.id, alliance.id);
  assert.equal(selected.allianceDirection, "inbound");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
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

test("grow yields a proactive K1Z request to material progress", () => {
  const alliance = action(`alliance:${MICKEY_ID}`, "alliance_request", "Ally Mickey", {
    recipientID: MICKEY_ID,
    recipientName: "K1Z Mickey Mouse",
  });
  const selected = decide([alliance, build(), hold()], "grow", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 1,
    }],
  });
  assert.equal(selected.id, "build:Factory");
  assert.ok(selected.policyMarkers.includes("iax"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow preserves a pending inbound K1Z handshake", () => {
  const reject = action(`alliance_reject:${MICKEY_ID}`, "alliance_reject", "Reject Mickey", {
    recipientID: MICKEY_ID,
    recipientName: "K1Z Mickey Mouse",
  });
  const alliance = action(`alliance:${MICKEY_ID}`, "alliance_request", "Ally Mickey", {
    recipientID: MICKEY_ID,
    recipientName: "K1Z Mickey Mouse",
  });
  const selected = decide([reject, alliance, build(), hold()], "grow", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 1,
    }],
  });
  assert.equal(selected.id, alliance.id);
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow keeps a proactive alliance when no productive alternative exists", () => {
  const alliance = action(`alliance:${MICKEY_ID}`, "alliance_request", "Ally Mickey", {
    recipientID: MICKEY_ID,
    recipientName: "K1Z Mickey Mouse",
  });
  const selected = decide([alliance, hold()], "grow", {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 1,
    }],
  });
  assert.equal(selected.id, alliance.id);
  assert.ok(!selected.policyMarkers.includes("iax"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("grow prefers direct territory conversion through the mature executor", () => {
  const selected = decide([
    attack("rival", 10),
    attack("rival", 25),
    build(),
    hold(),
  ], "grow", {
    troopRatio: 1,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.15, relativeTroopRatio: 0.95 }],
  });
  assert.equal(selected.id, "attack:rival:10");
  assert.ok(selected.policyMarkers.includes("ig1"));
  assert.ok(selected.policyMarkers.includes("ixgrw"));
});

test("the grow preference preserves immediate pressure defense", () => {
  const selected = decide([
    attack("raider", 10),
    build("City"),
    hold(),
  ], "grow", {
    incoming: ["raider"],
    troopRatio: 0.7,
    rivals: [{ id: "raider", name: "raider", tileShare: 0.15, relativeTroopRatio: 0.95 }],
  });
  assert.equal(selected.id, "build:City");
  assert.ok(!selected.policyMarkers.includes("ig1"));
});

test("the grow preference preserves a real inbound handshake over direct conversion", () => {
  const reject = action("alliance_reject:ally", "alliance_reject", "Reject Ally", {
    recipientID: "ally",
    recipientName: "Ally",
  });
  const alliance = action("alliance:ally", "alliance_request", "Accept Ally", {
    recipientID: "ally",
    recipientName: "Ally",
  });
  const selected = decide([
    reject,
    alliance,
    attack("rival", 10),
    build(),
    hold(),
  ], "grow", {
    troopRatio: 1,
    rivals: [
      { id: "ally", name: "Ally", tileShare: 0.12, relativeTroopRatio: 1 },
      { id: "rival", name: "rival", tileShare: 0.15, relativeTroopRatio: 0.95 },
    ],
  });
  assert.equal(selected.id, alliance.id);
  assert.ok(!selected.policyMarkers.includes("ig1"));
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

test("the hosted Captain Underpants truncation stays absolute no-harm", () => {
  const hostedID = "j2wxj0cp";
  const selected = decide([attack(hostedID), hold()], "grow", {
    tileShare: 0.01,
    rivals: [{
      id: hostedID,
      name: "Captain Underpants Maximum",
      tileShare: 0.8,
      relativeTroopRatio: 2,
    }],
  });
  assert.equal(selected.id, "hold");
  assert.ok(selected.policyMarkers.includes("ixgrw"));
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

test("a missing or stale plan uses the untargeted grow outcome", () => {
  const menu = [land(), attack("rival"), hold()];
  const options = {
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  };
  assert.equal(decide(menu, null, options).id, "attack:rival:40");
  const history = [];
  const state = buildState(observation(options), menu, history);
  assert.equal(chooseIntentCoreAction(menu, state, { intent: "defend" }, history).id,
    "attack:rival:40");
});

test("spawn remains the ranker's absolute first action", () => {
  const spawn = action("spawn:1", "spawn", "Spawn");
  assert.equal(decide([land(), spawn], "finish").id, spawn.id);
});
