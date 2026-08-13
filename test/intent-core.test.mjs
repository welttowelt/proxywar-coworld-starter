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

function decide(actions, plan, options = {}) {
  const history = options.history ?? [];
  const state = buildState(observation(options), actions, history);
  return chooseIntentCoreAction(actions, state, plan, history);
}

function land(percent = 35) {
  return action(`expand:terra-nullius:${percent}`, "attack", "Expand Terra Nullius", {
    expansion: true,
    troopPercent: percent,
  });
}

function boat(percent = 16) {
  return action(`boat:neutral:${percent}`, "boat", "Boat to Terra Nullius", {
    targetType: "neutral",
    troopPercent: percent,
  });
}

function build(unit = "Factory", id = `build:${unit}`) {
  return action(id, "build", `Build ${unit}`, { unit });
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

function symbolic(targetID) {
  return [
    action(`target:${targetID}`, "target_player", `Target ${targetID}`, { targetID }),
    action(`embargo:${targetID}`, "embargo", `Embargo ${targetID}`, { targetID }),
    action(`alliance:${targetID}`, "alliance_request", `Ally ${targetID}`, {
      recipientID: targetID,
    }),
  ];
}

test("grow chooses neutral territory and ignores every other outcome", () => {
  const expansion = land();
  const selected = decide([
    attack("rival"), build(), ...symbolic("rival"), expansion, hold(),
  ], { intent: "grow" });
  assert.equal(selected.id, expansion.id);
  assert.equal(selected.policyMarker, "ixgrw");
});

test("grow can use an explicitly neutral boat", () => {
  const neutralBoat = boat();
  assert.equal(decide([neutralBoat, build(), hold()], {
    intent: "grow",
  }).id, neutralBoat.id);
});

test("grow strengthens infrastructure when neutral territory is unavailable", () => {
  const selected = decide([attack("rival"), build(), hold()], {
    intent: "grow",
  });
  assert.equal(selected.id, "build:Factory");
  assert.equal(selected.policyMarker, "ixgrw");
});

test("rival force cannot masquerade as grow through expansion metadata", () => {
  const disguised = attack("rival");
  disguised.metadata.expansion = true;
  const neutral = land();
  const selected = decide([disguised, neutral, hold()], { intent: "grow" }, {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 1.2 }],
  });
  assert.equal(selected.id, neutral.id);
  assert.equal(selected.policyMarker, "ixgrw");
});

test("ambiguous boat force cannot masquerade as grow through expansion metadata", () => {
  const ambiguous = action("boat:485204:16", "boat", "Boat 16%", {
    expansion: true,
    troopPercent: 16,
  });
  const factory = build();
  assert.equal(decide([ambiguous, factory, hold()], { intent: "grow" }).id, factory.id);
  assert.equal(decide([ambiguous, factory, hold()], { intent: "finish" }).id, ambiguous.id);
});

test("secure chooses infrastructure and never grows or attacks", () => {
  const factory = build();
  const selected = decide([land(), attack("rival"), factory, hold()], {
    intent: "secure",
  });
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "ixsec");
});

test("secure continues neutral growth when infrastructure is unavailable", () => {
  const selected = decide([land(), attack("rival"), hold()], {
    intent: "secure",
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.equal(selected.policyMarker, "ixsec");
});

test("finish continues neutral growth when physical force is unavailable", () => {
  const selected = decide([land(), build(), hold()], {
    intent: "finish",
  });
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.equal(selected.policyMarker, "ixfin");
});

test("finish continues the executor-owned physical target", () => {
  const named = attack("target", 25);
  const selected = decide([
    attack("decoy", 40), named, land(), build(), ...symbolic("target"), hold(),
  ], { intent: "finish" }, {
    history: [{
      actionID: "attack:target:10",
      kind: "attack",
      targetID: "target",
      targetName: "target",
      tileShare: 0.12,
      policyMarker: "ixfin",
    }],
    rivals: [
      { id: "target", name: "target", tileShare: 0.1, relativeTroopRatio: 1.1 },
      { id: "decoy", name: "decoy", tileShare: 0.2, relativeTroopRatio: 1.8 },
    ],
  });
  assert.equal(selected.id, named.id);
  assert.equal(selected.policyMarker, "ixfin");
});

test("finish chooses physical force locally when continuity is unavailable", () => {
  const selected = decide([attack("other"), land(), build(), hold()], {
    intent: "finish",
  }, {
    rivals: [{ id: "other", name: "other", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, "attack:other:40");
  assert.equal(selected.policyMarker, "ixfin");
});

test("incoming pressure does not silently change grow into finish", () => {
  const expansion = land();
  const selected = decide([expansion, attack("raider"), hold()], {
    intent: "grow",
  }, {
    incoming: ["raider"],
    rivals: [{ id: "raider", name: "raider", tileShare: 0.2, relativeTroopRatio: 1.3 }],
  });
  assert.equal(selected.id, expansion.id);
  assert.equal(selected.policyMarker, "ixgrw");
});

test("territorial collapse does not silently change secure into finish", () => {
  const history = [0.2, 0.19, 0.18, 0.16].map((tileShare, index) => ({
    actionID: `prior:${index}`,
    kind: "build",
    tileShare,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
  }));
  const factory = build();
  const selected = decide([land(), factory, attack("rival"), hold()], {
    intent: "secure",
  }, {
    history,
    tileShare: 0.08,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.3, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "ixsec");
});

test("no outcome can harm K1Z Mickey Mouse", () => {
  const selected = decide([attack(MICKEY_ID), hold()], {
    intent: "finish",
  }, {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 2,
    }],
  });
  assert.equal(selected.id, "hold");
  assert.equal(selected.policyMarker, "ixfin");
});

test("finish can accept high-risk physical force", () => {
  const riskyForce = attack("rival", 40, "high");
  assert.equal(decide([riskyForce, hold()], {
    intent: "finish",
  }, {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 1.4 }],
  }).id, riskyForce.id);
});

test("repetition penalty breaks ties within one outcome", () => {
  const city = build("City", "build:City:1");
  const factory = build("Factory", "build:Factory:2");
  const selected = decide([city, factory, hold()], {
    intent: "secure",
  }, {
    history: [{ actionID: city.id, kind: "build", tileShare: 0.2 }],
    tileShare: 0.2,
  });
  assert.equal(selected.id, factory.id);
});

test("a missing or stale plan defaults to grow", () => {
  const expansion = land();
  assert.equal(decide([expansion, attack("rival"), hold()], null).id, expansion.id);
  assert.equal(decide([expansion, attack("rival"), hold()], {
    intent: "defend",
  }).id, expansion.id);
});

test("spawn passes through before intent arbitration", () => {
  const spawn = action("spawn:1", "spawn", "Spawn");
  assert.equal(decide([land(), spawn], {
    intent: "finish",
  }).id, spawn.id);
});
