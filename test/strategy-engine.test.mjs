import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction,
  recordDecision,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, risk = lowRisk) {
  return { id, kind, label, risk };
}

function observation({ tileShare = 0.05, troopRatio = 0.8, rivals = [], incomingAttacks = [] } = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks,
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

function choose(actions, obs, plan = null, history = []) {
  const state = buildState(obs, actions, history);
  return chooseAction(actions, state, plan, history);
}

test("opening neutral expansion overrides a boat-heavy plan", () => {
  const actions = [
    action("boat:123:8", "boat", "Boat to Terra Nullius 8%"),
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
    action("hold", "hold", "Hold"),
  ];
  const selected = choose(actions, observation(), {
    focus: "expand",
    preferKinds: ["boat", "boat", "hold"],
  });
  assert.equal(selected.id, "expand:terra-nullius:10");
});

test("neutral expansion cadence escalates 10, 10, 20, 35 percent", () => {
  const actions = [10, 20, 35].map((percent) =>
    action(`expand:terra-nullius:${percent}`, "attack", `Attack Terra Nullius ${percent}%`)
  );
  const history = [];
  const obs = observation();
  const selected = [];
  for (let index = 0; index < 4; index++) {
    const state = buildState(obs, actions, history);
    const choice = chooseAction(actions, state, null, history);
    selected.push(choice.id);
    recordDecision(history, choice, state);
  }
  assert.deepEqual(selected, [
    "expand:terra-nullius:10",
    "expand:terra-nullius:10",
    "expand:terra-nullius:20",
    "expand:terra-nullius:35",
  ]);
});

test("post-opening converts a rival at 1.01 instead of spamming boats", () => {
  const actions = [
    action("boat:123:8", "boat", "Boat to Terra Nullius 8%"),
    action("attack:weak:10", "attack", "Attack Weak 10%"),
    action("attack:weak:25", "attack", "Attack Weak 25%"),
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
  ];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 1.01 }],
  });
  const selected = choose(actions, obs, { focus: "expand", preferKinds: ["boat"] });
  assert.equal(selected.id, "attack:weak:10");
});

test("target continuity escalates a favorable attack from 10 to 25 to 40", () => {
  const actions = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`)
  );
  const obs = observation({
    tileShare: 0.25,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.09, relativeTroopRatio: 1.7 }],
  });
  const history = [];
  const selected = [];
  for (let index = 0; index < 3; index++) {
    const state = buildState(obs, actions, history);
    const choice = chooseAction(actions, state, null, history);
    selected.push(choice.id);
    recordDecision(history, choice, state);
  }
  assert.deepEqual(selected, ["attack:weak:10", "attack:weak:25", "attack:weak:40"]);
});

test("a vulnerable target outranks a planner preference for the leader", () => {
  const actions = [
    action("attack:weak:10", "attack", "Attack Weak 10%"),
    action("attack:leader:10", "attack", "Attack Leader 10%"),
  ];
  const obs = observation({
    tileShare: 0.18,
    rivals: [
      { id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 1.6 },
      { id: "leader", name: "Leader", tileShare: 0.3, relativeTroopRatio: 1.1 },
    ],
  });
  const plan = { focus: "attack", target: "Leader", avoidTargets: [] };
  assert.equal(choose(actions, obs, plan).id, "attack:weak:10");
});

test("a runaway leader can be pressured at a 0.9 relative ratio", () => {
  const actions = [
    action("attack:leader:10", "attack", "Attack Leader 10%"),
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
  ];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.36, relativeTroopRatio: 0.92 }],
  });
  assert.equal(choose(actions, obs).id, "attack:leader:10");
});

test("a weak non-leader attack is rejected", () => {
  const actions = [
    action("attack:rival:10", "attack", "Attack Rival 10%"),
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
  ];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.1, relativeTroopRatio: 0.8 }],
  });
  assert.equal(choose(actions, obs).id, "expand:terra-nullius:10");
});

test("boat streak is capped by an available economy build", () => {
  const actions = [
    action("boat:123:8", "boat", "Boat to Terra Nullius 8%"),
    action("build:City:99", "build", "Build City"),
  ];
  const history = [
    { actionID: "boat:100:8", kind: "boat", neutral: true },
    { actionID: "boat:110:16", kind: "boat", neutral: true },
  ];
  assert.equal(choose(actions, observation({ tileShare: 0.18 }), null, history).id, "build:City:99");
});

test("economy cadence interrupts generic expansion but not a target finish", () => {
  const actions = [
    action("attack:weak:40", "attack", "Attack Weak 40%"),
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
    action("build:City:99", "build", "Build City"),
  ];
  const baseHistory = Array.from({ length: 9 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
  }));
  const noRivals = observation({ tileShare: 0.16 });
  assert.equal(choose(actions, noRivals, null, baseHistory).id, "build:City:99");

  const finishingHistory = [
    ...baseHistory.slice(0, 7),
    { actionID: "attack:weak:10", kind: "attack", targetName: "Weak", neutral: false },
    { actionID: "attack:weak:25", kind: "attack", targetName: "Weak", neutral: false },
  ];
  const target = observation({
    tileShare: 0.2,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 1.8 }],
  });
  assert.equal(choose(actions, target, null, finishingHistory).id, "attack:weak:40");
});

test("recurring economy builds wait fourteen decisions", () => {
  const actions = [
    action("expand:terra-nullius:10", "attack", "Attack Terra Nullius 10%"),
    action("build:Factory:99", "build", "Build Factory"),
  ];
  const baseHistory = [
    { actionID: "build:City:10", kind: "build", neutral: false },
    ...Array.from({ length: 13 }, (_, index) => ({
      actionID: `expand:terra-nullius:${index}`,
      kind: "attack",
      neutral: true,
    })),
  ];
  const obs = observation({ tileShare: 0.16 });
  assert.equal(choose(actions, obs, null, baseHistory).id, "expand:terra-nullius:10");
  baseHistory.push({ actionID: "hold", kind: "hold", neutral: false });
  assert.equal(choose(actions, obs, null, baseHistory).id, "build:Factory:99");
});

test("donations require an allied recipient and ally focus", () => {
  const actions = [
    action("donate_gold:friend:1000", "donate_gold", "Donate gold to Friend"),
    action("hold", "hold", "Hold"),
  ];
  const rival = { id: "friend", name: "Friend", tileShare: 0.1, relativeTroopRatio: 2 };
  assert.equal(choose(actions, observation({ rivals: [rival] }), { focus: "ally" }).kind, "hold");
  rival.isAllied = true;
  assert.equal(choose(actions, observation({ rivals: [rival] }), { focus: "ally" }).kind, "donate_gold");
});
