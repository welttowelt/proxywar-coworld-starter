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

function symbolic(targetID) {
  return [
    action(`target:${targetID}`, "target_player", `Target ${targetID}`, { targetID }),
    action(`embargo:${targetID}`, "embargo", `Embargo ${targetID}`, { targetID }),
    action(`alliance:${targetID}`, "alliance_request", `Ally ${targetID}`, {
      recipientID: targetID,
    }),
  ];
}

test("grow chooses neutral land and ignores symbolic actions", () => {
  const expansion = land();
  const selected = decide([...symbolic("rival"), expansion], { intent: "grow" });
  assert.equal(selected.id, expansion.id);
  assert.equal(selected.policyMarker, "ixexp");
});

test("grow builds infrastructure when neutral land is unavailable", () => {
  const factory = build();
  const selected = decide([...symbolic("rival"), factory], { intent: "grow" });
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "ixexp");
});

test("grow never disguises physical force as growth", () => {
  const factory = build();
  const strike = attack("rival");
  assert.equal(decide([strike, factory], { intent: "grow" }).id, factory.id);
});

test("convert applies physical force to the named target", () => {
  const named = attack("target", 25);
  const decoy = attack("decoy", 40);
  const selected = decide([decoy, named, ...symbolic("target")], {
    intent: "convert", targetID: "target",
  }, {
    rivals: [
      { id: "target", name: "target", tileShare: 0.1, relativeTroopRatio: 1.1 },
      { id: "decoy", name: "decoy", tileShare: 0.2, relativeTroopRatio: 1.8 },
    ],
  });
  assert.equal(selected.id, named.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("convert applies force elsewhere when the named target is unreachable", () => {
  const reachable = attack("other");
  const selected = decide([reachable, build()], {
    intent: "convert", targetID: "unreachable",
  }, {
    rivals: [{ id: "other", name: "other", tileShare: 0.1, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, reachable.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("convert never substitutes target labels embargoes or alliances for force", () => {
  const factory = build();
  const selected = decide([...symbolic("target"), factory], {
    intent: "convert", targetID: "target",
  });
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "ixexp");
});

test("an incoming attack switches grow to physical conversion against the attacker", () => {
  const counter = attack("raider", 25);
  const selected = decide([land(), build(), counter, ...symbolic("raider")], {
    intent: "grow",
  }, {
    incoming: ["raider"],
    rivals: [{ id: "raider", name: "raider", tileShare: 0.2, relativeTroopRatio: 1.3 }],
  });
  assert.equal(selected.id, counter.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("territorial collapse switches grow to physical conversion", () => {
  const history = [0.2, 0.19, 0.18, 0.16].map((tileShare, index) => ({
    actionID: `prior:${index}`,
    kind: "build",
    tileShare,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
  }));
  const strike = attack("rival");
  const selected = decide([land(), build(), strike, ...symbolic("rival")], {
    intent: "grow",
  }, {
    history,
    tileShare: 0.08,
    rivals: [{ id: "rival", name: "rival", tileShare: 0.3, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, strike.id);
  assert.equal(selected.policyMarker, "ixprs");
});

test("neither intent can harm K1Z Mickey Mouse", () => {
  const harmful = attack(MICKEY_ID);
  const factory = build();
  const options = {
    rivals: [{
      id: MICKEY_ID,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 2,
    }],
  };
  assert.equal(decide([harmful, factory], {
    intent: "convert", targetID: MICKEY_ID,
  }, options).id, factory.id);
  assert.equal(decide([harmful, factory], { intent: "grow" }, options).id, factory.id);
});

test("convert accepts high-risk force over low-risk growth", () => {
  const riskyForce = attack("rival", 40, "high");
  const selected = decide([riskyForce, build()], {
    intent: "convert", targetID: "rival",
  }, {
    rivals: [{ id: "rival", name: "rival", tileShare: 0.2, relativeTroopRatio: 1.4 }],
  });
  assert.equal(selected.id, riskyForce.id);
});

test("grow prefers safe infrastructure over high-risk expansion", () => {
  const riskyLand = { ...land(), risk: { level: "high" } };
  const factory = build();
  assert.equal(decide([riskyLand, factory], { intent: "grow" }).id, factory.id);
});

test("repetition penalty breaks ties between equal growth actions", () => {
  const city = build("City", "build:City:1");
  const factory = build("Factory", "build:Factory:2");
  const selected = decide([city, factory], { intent: "grow" }, {
    history: [{ actionID: city.id, kind: "build", tileShare: 0.2 }],
    tileShare: 0.2,
  });
  assert.equal(selected.id, factory.id);
});

test("hold is used only when neither intent has a safe executable action", () => {
  const hold = action("hold", "hold", "Hold");
  const retreat = action("retreat:front", "retreat", "Retreat");
  const selected = decide([...symbolic("rival"), retreat, hold], { intent: "grow" });
  assert.equal(selected.id, hold.id);
  assert.equal(selected.policyMarker, "ixexp");
});

test("a missing or stale plan defaults to grow", () => {
  const expansion = land();
  assert.equal(decide([expansion, attack("rival")], null).id, expansion.id);
  assert.equal(decide([expansion, attack("rival")], { intent: "defend" }).id, expansion.id);
});

test("spawn passes through before intent arbitration", () => {
  const spawn = action("spawn:1", "spawn", "Spawn");
  assert.equal(decide([land(), spawn], { intent: "convert" }).id, spawn.id);
});
