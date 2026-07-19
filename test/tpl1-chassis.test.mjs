import assert from "node:assert/strict";
import test from "node:test";

import { buildState } from "../strategy-engine.mjs";
import { chooseTpl1Action } from "../tpl1-chassis.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, risk = lowRisk) {
  return { id, kind, label, risk };
}

function observation({
  tileShare = 0.05,
  troopRatio = 0.8,
  rivals = [],
  incomingAttacks = [],
  incomingAttackPlayerIDs = [],
  spawnTile = null,
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
      spawnTile,
    },
    combat: { incomingAttackPlayerIDs },
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
  return chooseTpl1Action(actions, state, plan, history);
}

test("the opening grind takes 25% neutral over builds and socials", () => {
  const neutral25 = action("expand:terra-nullius:25", "attack", "Expand into Terra Nullius 25%");
  const neutral10 = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const build = action("build:City:1", "build", "Build City");
  const ally = {
    ...action("alliance:kata:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "kata", recipientName: "katanasan", relation: 2 },
  };
  const selected = choose(
    [neutral10, build, ally, neutral25],
    observation({ tileShare: 0.05, troopRatio: 0.9 }),
  );
  assert.equal(selected.id, neutral25.id);
  assert.equal(selected.policyMarker, "tpl1");
});

test("two zero-gain expansions pivot to a boat, never a third probe", () => {
  const deadExpansion = action("expand:terra-nullius:35", "attack", "Expand into Terra Nullius 35%");
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const history = [
    { actionID: "expand:terra-nullius:25", kind: "attack", neutral: true, tileShare: 0.045 },
    { actionID: "expand:terra-nullius:35", kind: "attack", neutral: true, tileShare: 0.045 },
    { actionID: "expand:terra-nullius:35", kind: "attack", neutral: true, tileShare: 0.045 },
  ];
  const selected = choose([deadExpansion, boat], observation({ tileShare: 0.045 }), null, history);
  assert.equal(selected.id, boat.id);
});

test("the upgrade loop caps at eight consecutive decisions", () => {
  const upgrade = action("upgrade:city:1", "upgrade_structure", "Upgrade City");
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: `upgrade:${index}`,
    kind: "upgrade_structure",
    tileShare: 0.3,
  }));
  const selected = choose(
    [upgrade, boat],
    observation({ tileShare: 0.3, troopRatio: 0.9 }),
    null,
    history,
  );
  assert.equal(selected.id, boat.id);
});

test("a reverse handshake is accepted before the opening grind", () => {
  const ally = {
    ...action("alliance:kata:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "kata", recipientName: "katanasan", relation: 2 },
  };
  const reject = {
    ...action("alliance_reject:kata:1", "alliance_reject", "Reject katanasan alliance"),
    metadata: { recipientID: "kata", recipientName: "katanasan" },
  };
  const neutral25 = action("expand:terra-nullius:25", "attack", "Expand into Terra Nullius 25%");
  const selected = choose(
    [ally, reject, neutral25],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      rivals: [{ id: "kata", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1 }],
    }),
  );
  assert.equal(selected.id, ally.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("coalition retries never exceed one per cadence window with work available", () => {
  const ally = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with juryoku koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "juryoku koku",
      relation: 2,
    },
  };
  const neutral25 = action("expand:terra-nullius:25", "attack", "Expand into Terra Nullius 25%");
  const history = [
    { actionID: "x0", kind: "attack", tileShare: 0.04 },
    { actionID: "x1", kind: "attack", tileShare: 0.04 },
    { actionID: "x2", kind: "attack", tileShare: 0.04 },
    {
      actionID: "alliance:kata:0",
      kind: "alliance_request",
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "katanasan",
      tileShare: 0.04,
      policyMarker: "kp2",
    },
  ];
  const selected = choose(
    [ally, neutral25],
    observation({
      tileShare: 0.04,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "juryoku koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, neutral25.id);
});

test("a hidden-label nuke whose metadata names an ally is never selected", () => {
  const hiddenNuke = {
    ...action("nuke:fullsend", "nuke", "Full send!"),
    metadata: { targetName: "K1Z juryoku koku" },
  };
  const hold = action("hold:1", "hold", "Hold");
  const selected = choose(
    [hiddenNuke, hold],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [
        {
          id: "in-game-7",
          name: "K1Z juryoku-koku",
          tileShare: 0.3,
          relativeTroopRatio: 0.6,
        },
        { id: "leader", name: "Leader", tileShare: 0.4, relativeTroopRatio: 0.5 },
      ],
    }),
  );
  assert.equal(selected.id, hold.id);
});

test("a protected rival is never attacked even at a favorable ratio", () => {
  const probe = action("attack:kata:40", "attack", "Attack katanasan 40%");
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const selected = choose(
    [probe, boat],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [{ id: "kata", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 2.5 }],
    }),
  );
  assert.equal(selected.id, boat.id);
});
