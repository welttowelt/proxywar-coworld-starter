import assert from "node:assert/strict";
import test from "node:test";

import { chooseIntentCoreAction } from "../intent-core.mjs";
import { buildState } from "../strategy-engine.mjs";

const MICKEY_ID = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";
const SIAN_ID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: { level: "low" } };
}

function observation({ rivals = [], incoming = [], tileShare = 0.12, troopRatio = 1 } = {}) {
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

function decide(actions, plan, options = {}) {
  const history = options.history ?? [];
  const state = buildState(observation(options), actions, history);
  return chooseIntentCoreAction(actions, state, plan, history);
}

function alliance(id, name) {
  return action(`alliance:${id}`, "alliance_request", `Request alliance with ${name}`, {
    recipientID: id,
    recipientName: name,
    relation: 2,
  });
}

test("expand intent chooses offered neutral land instead of proactive diplomacy", () => {
  const mickey = alliance(MICKEY_ID, "K1Z Mickey Mouse");
  const land = action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
    expansion: true,
    troopPercent: 35,
  });
  const selected = decide([mickey, land], {
    intent: "expand", targetID: null, horizon: 4,
  }, {
    rivals: [{ id: MICKEY_ID, name: "K1Z Mickey Mouse", tileShare: 0.1 }],
  });
  assert.equal(selected.id, land.id);
  assert.equal(selected.policyMarker, "ixexp");
});

test("fortify intent chooses infrastructure instead of proactive diplomacy", () => {
  const mickey = alliance(MICKEY_ID, "K1Z Mickey Mouse");
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  const selected = decide([mickey, factory], {
    intent: "fortify", targetID: null, horizon: 4,
  }, {
    rivals: [{ id: MICKEY_ID, name: "K1Z Mickey Mouse", tileShare: 0.1 }],
  });
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "ixfor");
});

test("defend intent answers the current attacker instead of proactive diplomacy", () => {
  const mickey = alliance(MICKEY_ID, "K1Z Mickey Mouse");
  const counter = action("attack:raider:25", "attack", "Counter Raider 25%", {
    targetID: "raider",
    targetName: "Raider",
    troopPercent: 25,
    incomingAttack: true,
  });
  const selected = decide([mickey, counter], {
    intent: "defend", targetID: null, horizon: 4,
  }, {
    incoming: ["raider"],
    rivals: [
      { id: MICKEY_ID, name: "K1Z Mickey Mouse", tileShare: 0.1 },
      { id: "raider", name: "Raider", tileShare: 0.14, relativeTroopRatio: 1.2 },
    ],
  });
  assert.equal(selected.id, counter.id);
  assert.equal(selected.policyMarker, "ixdef");
});

test("active attack pressure overrides an older expand plan with defend", () => {
  const land = action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
    expansion: true, troopPercent: 35,
  });
  const embargo = action("embargo:raider:start", "embargo", "Embargo Raider", {
    targetID: "raider", targetName: "Raider",
  });
  const counter = action("attack:raider:40", "attack", "Counter Raider 40%", {
    targetID: "raider", targetName: "Raider", troopPercent: 40,
    incomingAttack: true,
  });
  const harmfulMickey = action("attack:mickey:40", "attack", "Attack K1Z Mickey Mouse 40%", {
    targetID: MICKEY_ID, targetName: "K1Z Mickey Mouse", troopPercent: 40,
  });
  const selected = decide([land, embargo, counter, harmfulMickey], {
    intent: "expand", targetID: null, horizon: 4,
  }, {
    incoming: ["raider"],
    rivals: [
      { id: "raider", name: "Raider", tileShare: 0.2, relativeTroopRatio: 1.4 },
      { id: MICKEY_ID, name: "K1Z Mickey Mouse", tileShare: 0.1 },
    ],
  });
  assert.equal(selected.id, counter.id);
  assert.equal(selected.policyMarker, "ixdef");
});

test("ally intent binds to its exact visible target", () => {
  const mickey = alliance(MICKEY_ID, "K1Z Mickey Mouse");
  const sian = alliance(SIAN_ID, "K1Z katanasan");
  const selected = decide([mickey, sian], {
    intent: "ally", targetID: SIAN_ID, horizon: 4,
  }, {
    rivals: [
      { id: MICKEY_ID, name: "K1Z Mickey Mouse", tileShare: 0.2 },
      { id: SIAN_ID, name: "K1Z katanasan", tileShare: 0.1 },
    ],
  });
  assert.equal(selected.id, sian.id);
  assert.equal(selected.policyMarker, "ixaly");
});

test("pressure intent binds hostile action to its exact visible target", () => {
  const decoy = action("attack:decoy:40", "attack", "Attack Decoy 40%", {
    targetID: "decoy", targetName: "Decoy", troopPercent: 40,
  });
  const target = action("attack:target:25", "attack", "Attack Target 25%", {
    targetID: "target", targetName: "Target", troopPercent: 25,
  });
  const selected = decide([decoy, target], {
    intent: "pressure", targetID: "target", horizon: 4,
  }, {
    rivals: [
      { id: "decoy", name: "Decoy", tileShare: 0.25, relativeTroopRatio: 2.5 },
      { id: "target", name: "Target", tileShare: 0.1, relativeTroopRatio: 1.05 },
    ],
  });
  assert.equal(selected.id, target.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("pressure applies physical force instead of repeating target signals", () => {
  const targetPlayer = action("target:target", "target_player", "Target Target", {
    targetID: "target", targetName: "Target",
  });
  const embargo = action("embargo:target:start", "embargo", "Embargo Target", {
    targetID: "target", targetName: "Target",
  });
  const land = action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
    expansion: true, troopPercent: 35,
  });
  const selected = decide([targetPlayer, embargo, land], {
    intent: "pressure", targetID: "target", horizon: 4,
  }, {
    rivals: [{
      id: "target", name: "Target", tileShare: 0.3, relativeTroopRatio: 1.5,
    }],
  });
  assert.equal(selected.id, land.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("pressure still prefers an exact physical strike over expansion", () => {
  const targetPlayer = action("target:target", "target_player", "Target Target", {
    targetID: "target", targetName: "Target",
  });
  const attack = action("attack:target:25", "attack", "Attack Target 25%", {
    targetID: "target", targetName: "Target", troopPercent: 25,
  });
  const land = action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
    expansion: true, troopPercent: 35,
  });
  const selected = decide([targetPlayer, attack, land], {
    intent: "pressure", targetID: "target", horizon: 4,
  }, {
    rivals: [{
      id: "target", name: "Target", tileShare: 0.3, relativeTroopRatio: 1.5,
    }],
  });
  assert.equal(selected.id, attack.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("no intent can select a harmful action against K1Z Mickey Mouse", () => {
  const harmful = action("attack:mickey:40", "attack", "Attack K1Z Mickey Mouse 40%", {
    targetID: MICKEY_ID,
    targetName: "K1Z Mickey Mouse",
    troopPercent: 40,
  });
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  const selected = decide([harmful, factory], {
    intent: "pressure", targetID: MICKEY_ID, horizon: 4,
  }, {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 2,
    }],
  });
  assert.equal(selected.id, factory.id);
});

test("ally stays exact while pressure converts force against a reachable rival", () => {
  const otherAlliance = alliance("other", "Other");
  const otherAttack = action("attack:other:40", "attack", "Attack Other 40%", {
    targetID: "other", targetName: "Other", troopPercent: 40,
  });
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  const rivals = [
    { id: "target", name: "Target", tileShare: 0.2, relativeTroopRatio: 1.4 },
    { id: "other", name: "Other", tileShare: 0.1, relativeTroopRatio: 2 },
  ];
  assert.equal(decide([otherAlliance, factory], {
    intent: "ally", targetID: "target", horizon: 4,
  }, { rivals }).id, factory.id);
  assert.equal(decide([otherAttack, factory], {
    intent: "pressure", targetID: "target", horizon: 4,
  }, { rivals }).id, otherAttack.id);
});

test("pressure considers high-risk physical force before passive low-risk actions", () => {
  const reachable = {
    ...action("attack:other:40", "attack", "Attack Other 40%", {
      targetID: "other", targetName: "Other", troopPercent: 40,
    }),
    risk: { level: "high" },
  };
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  const selected = decide([reachable, factory], {
    intent: "pressure", targetID: "unreachable", horizon: 4,
  }, {
    rivals: [
      { id: "unreachable", name: "Unreachable", tileShare: 0.3, relativeTroopRatio: 0.8 },
      { id: "other", name: "Other", tileShare: 0.1, relativeTroopRatio: 1.4 },
    ],
  });
  assert.equal(selected.id, reachable.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("an aligned high-risk action yields to a lower-risk legal action", () => {
  const risky = {
    ...action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
      expansion: true, troopPercent: 35,
    }),
    risk: { level: "high" },
  };
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  const selected = decide([risky, factory], {
    intent: "expand", targetID: null, horizon: 4,
  });
  assert.equal(selected.id, factory.id);
});

test("hold is only selected when no active safe action exists", () => {
  const risky = {
    ...action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
      expansion: true, troopPercent: 35,
    }),
    risk: { level: "high" },
  };
  const hold = action("hold", "hold", "Hold");
  const selected = decide([risky, hold], {
    intent: "expand", targetID: null, horizon: 4,
  });
  assert.equal(selected.id, risky.id);
});

test("missing or stale plans fall back to a state-derived intent", () => {
  const land = action("expand:terra-nullius:35", "attack", "Expand Terra Nullius 35%", {
    expansion: true, troopPercent: 35,
  });
  const factory = action("build:Factory:42", "build", "Build Factory", { unit: "Factory" });
  assert.equal(decide([land, factory], null, { tileShare: 0.05 }).id, land.id);

  const counter = action("attack:raider:25", "attack", "Counter Raider 25%", {
    targetID: "raider", targetName: "Raider", troopPercent: 25, incomingAttack: true,
  });
  assert.equal(decide([counter, factory], null, {
    incoming: ["raider"],
    rivals: [{ id: "raider", name: "Raider", tileShare: 0.2, relativeTroopRatio: 1.2 }],
  }).id, counter.id);
});

test("intent scoring applies a generic repetition penalty", () => {
  const city = action("build:City:1", "build", "Build City", { unit: "City" });
  const factory = action("build:Factory:2", "build", "Build Factory", { unit: "Factory" });
  const history = [{ actionID: city.id, kind: "build", tileShare: 0.2 }];
  const selected = decide([city, factory], {
    intent: "fortify", targetID: null, horizon: 4,
  }, { history, tileShare: 0.2 });
  assert.equal(selected.id, factory.id);
});
