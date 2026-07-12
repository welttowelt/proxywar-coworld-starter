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

function observation({
  tileShare = 0.05,
  troopRatio = 0.8,
  rivals = [],
  incomingAttacks = [],
  profile = "",
  objective = null,
} = {}) {
  return {
    phase: "active",
    profile,
    objective,
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
    action("expand:terra-nullius:10", "attack", "Expand into neutral land with 10% troops"),
    action("hold", "hold", "Hold"),
  ];
  const selected = choose(actions, observation(), {
    focus: "expand",
    preferKinds: ["boat", "boat", "hold"],
  });
  assert.equal(selected.id, "expand:terra-nullius:10");
});

test("a diplomatic opening objective does not override reliable expansion", () => {
  const alliance = {
    ...action("alliance:richard", "alliance_request", "Untrusted rival label"),
    metadata: { recipientID: "richard", relation: 2 },
  };
  const neutral = action(
    "expand:terra-nullius:10",
    "attack",
    "Expand into neutral land with 10% troops",
  );
  const obs = observation({
    profile: "diplomatic",
    objective: { kind: "build_alliance", targetPlayerID: "richard" },
    rivals: [{ id: "richard", name: "Richard Higgins", tileShare: 0 }],
  });
  assert.equal(choose([neutral, alliance], obs).id, neutral.id);
});

test("an opening counterattack outranks neutral expansion under active attack", () => {
  const rival = {
    id: "threat",
    name: "Threat",
    tileShare: 0.08,
    relativeTroopRatio: 1.2,
  };
  const actions = [
    action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    action("attack:threat:10", "attack", "Attack Threat 10%"),
    action("hold", "hold", "Hold"),
  ];
  const selected = choose(actions, observation({
    tileShare: 0.05,
    rivals: [rival],
    incomingAttacks: [{ attackerID: "threat" }],
  }));
  assert.equal(selected.id, "attack:threat:10");
});

test("structured expansion metadata identifies neutral land and boats", () => {
  const land = {
    ...action("future-neutral-id:10", "attack", "Expand into neutral land"),
    metadata: { expansion: true, troopPercent: 10 },
  };
  const boat = {
    ...action("boat:123:8", "boat", "Send transport to neutral land"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  assert.equal(choose([boat, land], observation()).id, "future-neutral-id:10");
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

test("stalled land expansion switches to a neutral boat", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.045,
  }));
  assert.equal(choose([land, boat], observation({ tileShare: 0.045 }), null, history).id, boat.id);
});

test("stalled expansion converts a favorable rival before launching a boat", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const rivalAttack = action("attack:weak:10", "attack", "Attack Weak 10%");
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.17,
  }));
  const obs = observation({
    tileShare: 0.17,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 1.5 }],
  });
  assert.equal(choose([land, boat, rivalAttack], obs, null, history).id, rivalAttack.id);
});

test("stalled expansion builds after two escape boats", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:16", "boat", "Boat to Terra Nullius 16%"),
    metadata: { expansion: true, troopPercent: 16 },
  };
  const build = action("build:City:696749", "build", "Build City");
  const history = [
    ...Array.from({ length: 4 }, (_, index) => ({
      actionID: `expand:terra-nullius:${index}`,
      kind: "attack",
      neutral: true,
      tileShare: 0.045,
    })),
    { actionID: "boat:675041:8", kind: "boat", neutral: true, tileShare: 0.045 },
    { actionID: "boat:675042:16", kind: "boat", neutral: true, tileShare: 0.045 },
  ];
  assert.equal(
    choose([land, boat, build], observation({ tileShare: 0.045 }), null, history).id,
    build.id,
  );
});

test("sustained territory collapse inserts an emergency build", () => {
  const land = action(
    "expand:terra-nullius:10",
    "attack",
    "Expand into Terra Nullius 10%",
  );
  const build = action("build:City:500", "build", "Build City");
  const history = [
    { actionID: "attack:a:10", kind: "attack", tileShare: 0.24 },
    { actionID: "build:Factory:400", kind: "build", tileShare: 0.23 },
    { actionID: "attack:a:10", kind: "attack", tileShare: 0.22 },
    { actionID: "attack:a:10", kind: "attack", tileShare: 0.20 },
    { actionID: "attack:a:10", kind: "attack", tileShare: 0.18 },
  ];
  assert.equal(
    choose([land, build], observation({ tileShare: 0.17 }), null, history).id,
    build.id,
  );
});

test("midgame pressure keeps a reliable tactical action over alliance requests", () => {
  const allianceWithLeader = {
    ...action("alliance:leader", "alliance_request", "Alliance with Leader"),
    metadata: { recipientID: "leader", relation: 1 },
  };
  const pendingAlliance = {
    ...action("alliance:requester", "alliance_request", "Alliance with Requester"),
    metadata: { recipientID: "requester", relation: 2 },
  };
  const land = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const history = Array.from({ length: 18 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.1 + index * 0.005,
  }));
  const obs = observation({
    tileShare: 0.2,
    troopRatio: 0.9,
    incomingAttacks: [{ attackerID: "leader" }],
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.28, relativeTroopRatio: 0.8 },
      { id: "requester", name: "Requester", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(
    choose([land, allianceWithLeader, pendingAlliance], obs, null, history).id,
    land.id,
  );
});

test("active survival pressure keeps a reliable tactic over a pending alliance", () => {
  const pendingAlliance = {
    ...action("alliance:requester", "alliance_request", "Alliance with Requester"),
    metadata: { recipientID: "requester", relation: 2 },
  };
  const land = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const history = Array.from({ length: 18 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.1 + index * 0.005,
  }));
  const obs = observation({
    tileShare: 0.2,
    troopRatio: 0.9,
    incomingAttacks: [{ attackerID: "leader" }],
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.28, relativeTroopRatio: 0.8 },
      { id: "requester", name: "Requester", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([land, pendingAlliance], obs, null, history).id, land.id);
});

test("an isolated player uses a stable alliance instead of holding", () => {
  const stableAlliance = {
    ...action("alliance:leader", "alliance_request", "Alliance with Leader"),
    metadata: { recipientID: "leader", relation: 0 },
  };
  const pendingAlliance = {
    ...action("alliance:other", "alliance_request", "Alliance with Other"),
    metadata: { recipientID: "other", relation: 2 },
  };
  const hold = action("hold", "hold", "Hold");
  const obs = observation({
    tileShare: 0.01,
    troopRatio: 0.98,
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.7, relativeTroopRatio: 0.1 },
      { id: "other", name: "Other", tileShare: 0.2, relativeTroopRatio: 0.2 },
    ],
  });
  assert.equal(choose([pendingAlliance, stableAlliance, hold], obs).id, stableAlliance.id);
});

test("an isolated player pressures a rival instead of using a pending alliance", () => {
  const pendingAlliance = {
    ...action("alliance:other", "alliance_request", "Alliance with Other"),
    metadata: { recipientID: "other", relation: 2 },
  };
  const targetLeader = {
    ...action("target:leader", "target_player", "Target Leader"),
    metadata: { targetID: "leader" },
  };
  const hold = action("hold", "hold", "Hold");
  const obs = observation({
    tileShare: 0.01,
    troopRatio: 0.98,
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.7, relativeTroopRatio: 0.1 },
      { id: "other", name: "Other", tileShare: 0.2, relativeTroopRatio: 0.2 },
    ],
  });
  assert.equal(choose([pendingAlliance, targetLeader, hold], obs).id, targetLeader.id);
});

test("survival alliance does not consume tempo without incoming pressure", () => {
  const alliance = {
    ...action("alliance:leader", "alliance_request", "Alliance with Leader"),
    metadata: { recipientID: "leader", relation: 1 },
  };
  const land = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const history = Array.from({ length: 18 }, (_, index) => ({
    actionID: `build:City:${index}`,
    kind: "build",
    tileShare: 0.1 + index * 0.005,
  }));
  const obs = observation({
    tileShare: 0.2,
    troopRatio: 0.9,
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.28, relativeTroopRatio: 0.8 },
      { id: "other", name: "Other", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([land, alliance], obs, null, history).id, land.id);
});

test("survival alliance waits eighteen decisions before retrying", () => {
  const alliance = {
    ...action("alliance:leader", "alliance_request", "Alliance with Leader"),
    metadata: { recipientID: "leader", relation: 1 },
  };
  const land = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const history = [
    ...Array.from({ length: 17 }, (_, index) => ({
      actionID: `build:City:${index}`,
      kind: "build",
      tileShare: 0.1 + index * 0.005,
    })),
    { actionID: alliance.id, kind: "alliance_request", tileShare: 0.19 },
  ];
  const obs = observation({
    tileShare: 0.18,
    troopRatio: 0.9,
    incomingAttacks: [{ attackerID: "leader" }],
    rivals: [
      { id: "leader", name: "Leader", tileShare: 0.3, relativeTroopRatio: 0.8 },
      { id: "other", name: "Other", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([land, alliance], obs, null, history).id, land.id);
});

test("a dominant player breaks an alliance to finish", () => {
  const breakAlliance = {
    ...action("break:ally", "break_alliance", "Break alliance with Ally"),
    metadata: { targetID: "ally" },
  };
  const land = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  const obs = observation({
    tileShare: 0.48,
    troopRatio: 0.9,
    rivals: [
      {
        id: "ally",
        name: "Ally",
        tileShare: 0.3,
        relativeTroopRatio: 1.1,
        isAllied: true,
      },
    ],
  });
  assert.equal(choose([land, breakAlliance], obs).id, breakAlliance.id);
});

test("productive land expansion stays on land", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const history = [0.02, 0.025, 0.03, 0.035].map((tileShare, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare,
  }));
  assert.equal(choose([land, boat], observation({ tileShare: 0.04 }), null, history).id, land.id);
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

test("target continuity holds at 25 percent in the middle reserve band", () => {
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
  assert.deepEqual(selected, ["attack:weak:10", "attack:weak:25", "attack:weak:25"]);
});

test("target continuity stays at 10 percent below the reserve floor", () => {
  const actions = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`)
  );
  const obs = observation({
    tileShare: 0.25,
    troopRatio: 0.7,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.09, relativeTroopRatio: 1.7 }],
  });
  const history = [10, 25].map((percent) => ({
    actionID: `attack:weak:${percent}`,
    kind: "attack",
    neutral: false,
    targetName: "Weak",
    tileShare: 0.25,
  }));

  assert.equal(choose(actions, obs, null, history).id, "attack:weak:10");
});

test("target continuity reaches 40 percent only with a full troop bank", () => {
  const actions = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`)
  );
  const obs = observation({
    tileShare: 0.25,
    troopRatio: 0.9,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.09, relativeTroopRatio: 1.7 }],
  });
  const history = [10, 25].map((percent) => ({
    actionID: `attack:weak:${percent}`,
    kind: "attack",
    neutral: false,
    targetName: "Weak",
    tileShare: 0.25,
  }));

  assert.equal(choose(actions, obs, null, history).id, "attack:weak:40");
});

test("a planner avoid list cannot cancel an active favorable finish", () => {
  const actions = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`)
  );
  actions.push(action(
    "expand:terra-nullius:10",
    "attack",
    "Expand into Terra Nullius 10%",
  ));
  const obs = observation({
    tileShare: 0.19,
    troopRatio: 0.95,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.03, relativeTroopRatio: 3.2 }],
  });
  const history = [10, 25, 40].map((percent) => ({
    actionID: `attack:weak:${percent}`,
    kind: "attack",
    neutral: false,
    targetName: "Weak",
    tileShare: 0.19,
  }));
  const plan = { focus: "attack", target: "Leader", avoidTargets: ["Weak"] };
  assert.equal(choose(actions, obs, plan, history).id, "attack:weak:40");
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

test("an isolated collapsing player invades instead of holding", () => {
  const actions = [
    action("boat:rival:8", "boat", "Boat to Rival 8%"),
    action("boat:rival:16", "boat", "Boat to Rival 16%"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.001,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.7, relativeTroopRatio: 0.7 }],
  });
  assert.equal(choose(actions, obs).id, "boat:rival:8");
});

test("desperate naval fallback never invades an ally", () => {
  const actions = [
    action("boat:friend:8", "boat", "Boat to Friend 8%"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.001,
    rivals: [{
      id: "friend",
      name: "Friend",
      tileShare: 0.7,
      relativeTroopRatio: 0.7,
      isAllied: true,
    }],
  });
  assert.equal(choose(actions, obs).id, "hold");
});

test("a reliable build beats hold even during build cooldown", () => {
  const actions = [
    action("attack:leader:10", "attack", "Attack Leader 10%"),
    action("build:City:307123", "build", "Build City"),
    action("hold", "hold", "Hold"),
  ];
  const history = [{ actionID: "build:City:300000", kind: "build", tileShare: 0.09 }];
  const obs = observation({
    tileShare: 0.08,
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.46, relativeTroopRatio: 0.79 }],
  });
  assert.equal(choose(actions, obs, null, history).id, "build:City:307123");
});

test("a stale Defense Post action is bypassed for a valid counterattack", () => {
  const actions = [
    action("attack:leader:10", "attack", "Attack Leader 10%"),
    action("build:Defense Post:307123", "build", "Build Defense Post"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.08,
    rivals: [{ id: "leader", name: "Leader", tileShare: 0.46, relativeTroopRatio: 0.79 }],
  });
  assert.equal(choose(actions, obs).id, "attack:leader:10");
});

test("an exposed transport retreats instead of holding", () => {
  const actions = [
    action("boat_retreat:113", "boat_retreat", "Retreat boat 113"),
    action("hold", "hold", "Hold"),
  ];
  assert.equal(choose(actions, observation()).id, "boat_retreat:113");
});

test("a legal land retreat is used instead of holding", () => {
  const actions = [
    action("retreat:attack-113", "retreat", "Retreat attack 113"),
    action("hold", "hold", "Hold"),
  ];
  assert.equal(choose(actions, observation()).id, "retreat:attack-113");
});

test("a low-commitment counterattack beats hold as the last tactical option", () => {
  const actions = [
    action("attack:rival:10", "attack", "Attack Rival 10%"),
    action("attack:rival:25", "attack", "Attack Rival 25%"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.08,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.46, relativeTroopRatio: 0.7 }],
  });
  assert.equal(choose(actions, obs).id, "attack:rival:10");
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
    troopRatio: 0.95,
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
