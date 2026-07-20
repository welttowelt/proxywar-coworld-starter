import assert from "node:assert/strict";
import test from "node:test";

import {
  boatConversionStalled,
  buildState,
  chooseAction,
  neutralExpansionStalled,
  recordDecision,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, risk = lowRisk) {
  return { id, kind, label, risk };
}

function observation({
  tileShare = 0.05,
  tilesOwned,
  troopRatio = 0.8,
  rivals = [],
  incomingAttacks = [],
  incomingAttackPlayerIDs = [],
  spawnTile = null,
  profile = "",
  objective = null,
} = {}) {
  return {
    phase: "active",
    profile,
    objective,
    ownState: {
      tileShare,
      ...(tilesOwned === undefined ? {} : { tilesOwned }),
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
  return chooseAction(actions, state, plan, history);
}

test("a flat boat loop triggers one bounded conversion interrupt", () => {
  const boat = action("boat:terra:8", "boat", "Boat to Terra Nullius 8%");
  const upgrade = action("upgrade:port:1", "upgrade_structure", "Upgrade Port");
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: index < 6 ? `boat:terra:${index}` : `emoji:${index}`,
    kind: index < 6 ? "boat" : "emoji",
    neutral: index < 6,
    tileShare: 0.08,
  }));
  const state = buildState(observation({ tileShare: 0.08 }), [boat, upgrade], history);
  assert.equal(boatConversionStalled(state, history), true);
  const selected = chooseAction([boat, upgrade], state, null, history);
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, "cv1");
});

test("a stranded sub-two-percent seat can enter conversion mode", () => {
  const boat = action("boat:terra:8", "boat", "Boat to Terra Nullius 8%");
  const upgrade = action("upgrade:port:1", "upgrade_structure", "Upgrade Port");
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: index < 6 ? `boat:terra:${index}` : `emoji:${index}`,
    kind: index < 6 ? "boat" : "emoji",
    neutral: index < 6,
    tileShare: 0.00646,
  }));
  const state = buildState(
    observation({ tileShare: 0.00646 }),
    [boat, upgrade],
    history,
  );
  assert.equal(boatConversionStalled(state, history), true);
  const selected = chooseAction([boat, upgrade], state, null, history);
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, "cv1");
});

test("a near-eliminated seat keeps its last neutral escape route", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: `boat:terra:${index}`,
    kind: "boat",
    neutral: true,
    tileShare: 0.0019,
  }));
  const state = buildState(observation({ tileShare: 0.0019 }), [], history);
  assert.equal(boatConversionStalled(state, history), false);
});

test("conversion interrupt cools down and falls through to parent boat behavior", () => {
  const boat = action("boat:terra:8", "boat", "Boat to Terra Nullius 8%");
  const upgrade = action("upgrade:port:1", "upgrade_structure", "Upgrade Port");
  const history = [
    ...Array.from({ length: 8 }, (_, index) => ({
      actionID: `boat:terra:${index}`,
      kind: "boat",
      neutral: true,
      tileShare: 0.08,
    })),
    { actionID: "upgrade:port:0", kind: "upgrade_structure", tileShare: 0.08, policyMarker: "cv1" },
  ];
  const selected = choose([boat, upgrade], observation({ tileShare: 0.08 }), null, history);
  assert.equal(selected.id, boat.id);
  assert.equal(selected.policyMarker, undefined);
});

test("productive boat growth does not trigger conversion mode", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: `boat:terra:${index}`,
    kind: "boat",
    neutral: true,
    tileShare: 0.04 + index * 0.004,
  }));
  const state = buildState(observation({ tileShare: 0.08 }), [], history);
  assert.equal(boatConversionStalled(state, history), false);
});

test("alliance selection rejects a recent attacker when a peaceful rival is legal", () => {
  const attackerAlliance = {
    ...action("alliance:attacker", "alliance_request", "Alliance with Attacker"),
    metadata: { recipientID: "attacker", relation: 1 },
  };
  const peacefulAlliance = {
    ...action("alliance:peaceful", "alliance_request", "Alliance with Peaceful"),
    metadata: { recipientID: "peaceful", relation: 1 },
  };
  const history = [{
    actionID: "build:city:1",
    kind: "build",
    tileShare: 0.08,
    incomingAttackerIDs: ["attacker"],
    incomingAttackerNames: ["Attacker"],
  }];
  const obs = observation({
    tileShare: 0.08,
    rivals: [
      { id: "attacker", name: "Attacker", tileShare: 0.3, relativeTroopRatio: 1.2 },
      { id: "peaceful", name: "Peaceful", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([attackerAlliance, peacefulAlliance], obs, null, history).id, peacefulAlliance.id);
});

test("survival alliance quietly prefers nonhostile katanasan", () => {
  const katanasanAlliance = {
    ...action("alliance:kata", "alliance_request", "Alliance with katanasan"),
    metadata: { recipientID: "kata", relation: 1 },
  };
  const leaderAlliance = {
    ...action("alliance:leader", "alliance_request", "Alliance with Leader"),
    metadata: { recipientID: "leader", relation: 1 },
  };
  const obs = observation({
    tileShare: 0.08,
    rivals: [
      { id: "kata", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1 },
      { id: "leader", name: "Leader", tileShare: 0.3, relativeTroopRatio: 1.2 },
    ],
  });
  assert.equal(choose([katanasanAlliance, leaderAlliance], obs).id, katanasanAlliance.id);
});

test("a fresh alliance request protects the target from our attacks", () => {
  const history = [{
    actionID: "alliance:friend",
    kind: "alliance_request",
    targetID: "friend",
    targetName: "Friend",
    tileShare: 0.2,
    incomingAttackerIDs: [],
  }];
  const friendAttack = action("attack:friend:10", "attack", "Attack Friend 10%");
  const foeAttack = action("attack:foe:10", "attack", "Attack Foe 10%");
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "friend", name: "Friend", tileShare: 0.25, relativeTroopRatio: 2 },
      { id: "foe", name: "Foe", tileShare: 0.1, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([friendAttack, foeAttack], obs, null, history).id, foeAttack.id);
});

test("an incoming attack revokes soft alliance protection", () => {
  const history = [
    {
      actionID: "alliance:friend",
      kind: "alliance_request",
      targetID: "friend",
      targetName: "Friend",
      tileShare: 0.2,
      incomingAttackerIDs: [],
    },
    {
      actionID: "build:city:1",
      kind: "build",
      tileShare: 0.2,
      incomingAttackerIDs: ["friend"],
      incomingAttackerNames: ["Friend"],
    },
  ];
  const friendAttack = action("attack:friend:10", "attack", "Attack Friend 10%");
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "friend", name: "Friend", tileShare: 0.1, relativeTroopRatio: 1.2 }],
  });
  assert.equal(choose([friendAttack], obs, null, history).id, friendAttack.id);
});

test("naval pressure rotates away from an overused rival", () => {
  const alphaBoat = {
    ...action("boat:alpha:8", "boat", "Boat to Alpha 8%"),
    metadata: { targetID: "alpha", troopPercent: 8 },
  };
  const betaBoat = {
    ...action("boat:beta:8", "boat", "Boat to Beta 8%"),
    metadata: { targetID: "beta", troopPercent: 8 },
  };
  const history = Array.from({ length: 3 }, (_, index) => ({
    actionID: `boat:alpha:${index}`,
    kind: "boat",
    targetName: "Alpha",
    tileShare: 0.2,
  }));
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "alpha", name: "Alpha", tileShare: 0.1, relativeTroopRatio: 1.3 },
      { id: "beta", name: "Beta", tileShare: 0.1, relativeTroopRatio: 1.3 },
    ],
  });
  assert.equal(choose([alphaBoat, betaBoat], obs, null, history).id, betaBoat.id);
});

test("reciprocal neutrality protects katanasan before the finishing phase", () => {
  const katanasanAttack = action("attack:kata:10", "attack", "Attack katanasan 10%");
  const aggressorAttack = action("attack:aggressor:10", "attack", "Attack Aggressor 10%");
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "kata", name: "katanasan", tileShare: 0.18, relativeTroopRatio: 2 },
      { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.1 },
    ],
  });
  assert.equal(choose([katanasanAttack, aggressorAttack], obs).id, aggressorAttack.id);
});

test("betrayal revokes reciprocal neutrality immediately", () => {
  const katanasanAttack = action("attack:kata:10", "attack", "Attack katanasan 10%");
  const history = [{
    actionID: "build:city:1",
    kind: "build",
    tileShare: 0.2,
    incomingAttackerIDs: ["kata"],
    incomingAttackerNames: ["katanasan"],
  }];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "kata", name: "katanasan", tileShare: 0.18, relativeTroopRatio: 1.2 }],
  });
  assert.equal(choose([katanasanAttack], obs, null, history).id, katanasanAttack.id);
});

test("late dominance permits a reciprocal-rival finish", () => {
  const katanasanAttack = action("attack:kata:10", "attack", "Attack katanasan 10%");
  const obs = observation({
    tileShare: 0.36,
    rivals: [{ id: "kata", name: "katanasan", tileShare: 0.1, relativeTroopRatio: 1.2 }],
  });
  assert.equal(choose([katanasanAttack], obs).id, katanasanAttack.id);
});

test("recent aggressor pressure outranks a slightly softer bystander", () => {
  const aggressorAttack = action("attack:aggressor:10", "attack", "Attack Aggressor 10%");
  const bystanderAttack = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const history = [0, 1].map((index) => ({
    actionID: `build:city:${index}`,
    kind: "build",
    tileShare: 0.2,
    incomingAttackerIDs: ["aggressor"],
    incomingAttackerNames: ["Aggressor"],
  }));
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.1 },
      { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
    ],
  });
  assert.equal(
    choose([aggressorAttack, bystanderAttack], obs, null, history).id,
    aggressorAttack.id,
  );
});

test("official Normal-map spawn tiles identify every supported route", () => {
  const cases = {
    Asia: [1180588, 1228670, 1216916, 1214746, 1224834, 892476, 1020678, 1450648],
    World: [1088580, 1216626, 877134, 659476, 494334, 628394, 994502, 1333674],
    Pangaea: [659528, 534350, 266554, 687420, 622372, 589302, 450306, 740346],
  };
  for (const [map, spawnTiles] of Object.entries(cases)) {
    for (const spawnTile of spawnTiles) {
      const state = buildState(observation({ spawnTile }), [action("hold", "hold", "Hold")]);
      assert.equal(state.mapFingerprint, map);
    }
  }
});

test("unknown spawn tiles fail closed and recorded map identity persists", () => {
  const actions = [action("hold", "hold", "Hold")];
  const unknownState = buildState(observation({ spawnTile: 42 }), actions);
  assert.equal(unknownState.mapFingerprint, null);

  const spawnState = buildState(observation({ spawnTile: 1088580 }), actions);
  const history = [];
  recordDecision(history, chooseAction(actions, spawnState), spawnState);
  const laterState = buildState(observation(), actions, history);
  assert.equal(history[0].mapFingerprint, "World");
  assert.equal(laterState.mapFingerprint, "World");
});

test("Asia route restores current attacker attribution", () => {
  const aggressorAttack = action("attack:aggressor:10", "attack", "Attack Aggressor 10%");
  const bystanderAttack = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const obs = observation({
    tileShare: 0.2,
    incomingAttacks: 1,
    incomingAttackPlayerIDs: ["aggressor"],
    spawnTile: 1180588,
    rivals: [
      { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.1, incomingAttack: true },
      { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
    ],
  });
  const selected = choose(
    [aggressorAttack, bystanderAttack],
    obs,
    null,
    [],
  );
  assert.equal(selected.id, aggressorAttack.id);
  assert.equal(selected.policyMarker, "ia1");
});

test("World route commits against an active near-parity attacker", () => {
  const actions = [10, 25, 40].map((percent) => ({
    ...action(`attack:threat:${percent}`, "attack", `Attack Threat ${percent}%`),
    metadata: { targetID: "threat", troopPercent: percent, incomingAttack: true },
  }));
  const obs = observation({
    tileShare: 0.2,
    troopRatio: 0.9,
    incomingAttacks: 1,
    spawnTile: 1088580,
    rivals: [{ id: "threat", name: "Threat", tileShare: 0.12, relativeTroopRatio: 1.03 }],
  });
  const selected = choose(
    actions,
    obs,
    null,
    [],
  );
  assert.equal(selected.id, "attack:threat:40");
  assert.equal(selected.policyMarker, "pc1");
});

test("World route stays on parent cadence without active pressure", () => {
  const actions = [10, 25, 40].map((percent) => ({
    ...action(`attack:threat:${percent}`, "attack", `Attack Threat ${percent}%`),
    metadata: { targetID: "threat", troopPercent: percent, incomingAttack: true },
  }));
  const selected = choose(
    actions,
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      spawnTile: 1088580,
      rivals: [{ id: "threat", name: "Threat", tileShare: 0.12, relativeTroopRatio: 1.03 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:threat:10");
  assert.equal(selected.policyMarker, undefined);
});

test("Pangaea route ignores current-protocol attribution and stays exact v77", () => {
  const aggressorAttack = action("attack:aggressor:10", "attack", "Attack Aggressor 10%");
  const bystanderAttack = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [aggressorAttack, bystanderAttack],
    observation({
      tileShare: 0.2,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["aggressor"],
      spawnTile: 659528,
      rivals: [
        { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.1, incomingAttack: true },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bystanderAttack.id);
  assert.equal(selected.policyMarker, undefined);
});

test("Pangaea route preserves exact-v77 handling of string-form incoming attacks", () => {
  const aggressorAttack = action("attack:aggressor:10", "attack", "Attack Aggressor 10%");
  const bystanderAttack = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [aggressorAttack, bystanderAttack],
    observation({
      tileShare: 0.2,
      incomingAttacks: ["aggressor"],
      spawnTile: 659528,
      rivals: [
        { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bystanderAttack.id);
  assert.equal(selected.policyMarker, undefined);
});

test("unknown maps ignore both composition arms and stay exact v77", () => {
  const actions = [10, 40].map((percent) => ({
    ...action(`attack:threat:${percent}`, "attack", `Attack Threat ${percent}%`),
    metadata: { targetID: "threat", troopPercent: percent, incomingAttack: true },
  }));
  const selected = choose(
    actions,
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["threat"],
      spawnTile: 42,
      rivals: [{ id: "threat", name: "Threat", tileShare: 0.12, relativeTroopRatio: 1.03 }],
    }),
  );
  assert.equal(selected.id, "attack:threat:10");
  assert.equal(selected.policyMarker, undefined);
});

test("naval pressure also prefers an observed aggressor", () => {
  const aggressorBoat = {
    ...action("boat:aggressor:8", "boat", "Boat to Aggressor 8%"),
    metadata: { targetID: "aggressor", troopPercent: 8 },
  };
  const bystanderBoat = {
    ...action("boat:bystander:8", "boat", "Boat to Bystander 8%"),
    metadata: { targetID: "bystander", troopPercent: 8 },
  };
  const history = [{
    actionID: "build:city:1",
    kind: "build",
    tileShare: 0.2,
    incomingAttackerIDs: ["aggressor"],
    incomingAttackerNames: ["Aggressor"],
  }];
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.2 },
      { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.4 },
    ],
  });
  assert.equal(choose([aggressorBoat, bystanderBoat], obs, null, history).id, aggressorBoat.id);
});

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

test("rising raw tiles veto a rounded-share stall and keep neutral land", () => {
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
    tilesOwned: 10_000 + index * 1_000,
  }));
  const state = buildState(
    observation({ tileShare: 0.045, tilesOwned: 14_000 }),
    [land, boat],
    history,
  );
  assert.equal(neutralExpansionStalled(state, history), false);
  const selected = chooseAction([land, boat], state, null, history);
  assert.equal(selected.id, land.id);
  assert.equal(selected.policyMarker, "rs1");
});

test("flat raw tiles retain the neutral escape branch", () => {
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
    tilesOwned: 13_000,
  }));
  const state = buildState(
    observation({ tileShare: 0.045, tilesOwned: 13_000 }),
    [land, boat],
    history,
  );
  assert.equal(neutralExpansionStalled(state, history), true);
  assert.equal(chooseAction([land, boat], state, null, history).id, boat.id);
});

test("falling raw tiles retain the parent escape branch", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const history = [14_000, 13_750, 13_500, 13_250].map((tilesOwned, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.045,
    tilesOwned,
  }));
  const state = buildState(
    observation({ tileShare: 0.045, tilesOwned: 13_000 }),
    [land, boat],
    history,
  );
  assert.equal(neutralExpansionStalled(state, history), true);
  assert.equal(chooseAction([land, boat], state, null, history).id, boat.id);
});

test("raw growth never outranks the parent counterattack", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const boat = {
    ...action("boat:675041:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: { expansion: true, troopPercent: 8 },
  };
  const counter = action("attack:weak:10", "attack", "Attack Weak 10%");
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.045,
    tilesOwned: 10_000 + index * 1_000,
  }));
  const state = buildState(observation({
    tileShare: 0.045,
    tilesOwned: 14_000,
    rivals: [{ id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 1.5 }],
  }), [land, boat, counter], history);
  const selected = chooseAction([land, boat, counter], state, null, history);
  assert.equal(selected.id, counter.id);
  assert.equal(selected.policyMarker, undefined);
});

test("raw growth emits no marker when no parent escape action exists", () => {
  const land = {
    ...action("expand:terra-nullius:35", "attack", "Expand into neutral land 35%"),
    metadata: { expansion: true, troopPercent: 35 },
  };
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.045,
    tilesOwned: 10_000 + index * 1_000,
  }));
  const state = buildState(
    observation({ tileShare: 0.045, tilesOwned: 14_000 }),
    [land],
    history,
  );
  const selected = chooseAction([land], state, null, history);
  assert.equal(selected.id, land.id);
  assert.equal(selected.policyMarker, undefined);
});

test("missing raw tiles preserve the exact parent state and history shape", () => {
  const state = buildState(observation(), [], []);
  assert.equal(Object.hasOwn(state.self, "tilesOwned"), false);
  const history = [];
  recordDecision(history, action("hold", "hold", "Hold"), state);
  assert.equal(Object.hasOwn(history[0], "tilesOwned"), false);
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

test("desperate naval fallback rejects a sub-half troop ratio", () => {
  const actions = [
    action("boat:rival:8", "boat", "Boat to Rival 8%"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.4, relativeTroopRatio: 0.49 }],
  });
  assert.equal(choose(actions, obs).id, "hold");
});

test("utility precedes a merely desperate naval invasion", () => {
  const actions = [
    action("boat:rival:8", "boat", "Boat to Rival 8%"),
    action("move_warship:1:2", "move_warship", "Move Warship"),
    action("hold", "hold", "Hold"),
  ];
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.4, relativeTroopRatio: 0.7 }],
  });
  assert.equal(choose(actions, obs).id, "move_warship:1:2");
});

test("a flat same-target naval loop enters cooldown", () => {
  const actions = [
    action("boat:rival:8", "boat", "Boat to Rival 8%"),
    action("move_warship:1:2", "move_warship", "Move Warship"),
  ];
  const history = Array.from({ length: 6 }, (_, index) => ({
    actionID: `boat:rival:${index}`,
    kind: "boat",
    targetName: "Rival",
    tileShare: 0.2,
  }));
  const obs = observation({
    tileShare: 0.2,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.2, relativeTroopRatio: 1.3 }],
  });
  assert.equal(choose(actions, obs, null, history).id, "move_warship:1:2");
});

test("productive same-target naval pressure remains available", () => {
  const boat = action("boat:rival:8", "boat", "Boat to Rival 8%");
  const history = Array.from({ length: 6 }, (_, index) => ({
    actionID: `boat:rival:${index}`,
    kind: "boat",
    targetName: "Rival",
    tileShare: 0.2 + index * 0.001,
  }));
  const obs = observation({
    tileShare: 0.206,
    rivals: [{ id: "rival", name: "Rival", tileShare: 0.2, relativeTroopRatio: 1.3 }],
  });
  assert.equal(choose([boat], obs, null, history).id, boat.id);
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



test("katanasan stays protected past the 0.35 tile share cutoff", () => {
  const kingmaker = [10, 25, 40].map((percent) =>
    action(`attack:katanasan:${percent}`, "attack", `Attack katanasan ${percent}%`));
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...kingmaker, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{ id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.8 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
  assert.equal(selected.policyMarker, "kp1");
});

test("katanasan protection breaks only when katanasan attacks first", () => {
  const kingmaker = [10, 25].map((percent) =>
    action(`attack:katanasan:${percent}`, "attack", `Attack katanasan ${percent}%`));
  const selected = choose(
    kingmaker,
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["katanasan"],
      spawnTile: 1180588,
      rivals: [{ id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.8, incomingAttack: true }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:katanasan:10");
});

test("an Atom Bomb on the runaway leader beats a city build", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "leader", targetName: "Leader", targetTileShare: 0.79, targetSamCoverage: 0, nuclearTargetPriority: 267 },
  };
  const city = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, city],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});

test("an Atom Bomb targeting katanasan is never built", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "katanasan", targetName: "katanasan", targetTileShare: 0.79, targetSamCoverage: 0, nuclearTargetPriority: 267 },
  };
  const city = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, city],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{ id: "katanasan", name: "katanasan", tileShare: 0.79, relativeTroopRatio: 0.5 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, city.id);
});

test("an Atom Bomb under SAM coverage is skipped", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "leader", targetName: "Leader", targetTileShare: 0.79, targetSamCoverage: 1, nuclearTargetPriority: 267 },
  };
  const city = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, city],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{ id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, city.id);
});

test("an alliance offer from katanasan is accepted on sight", () => {
  const ally = {
    ...action("alliance:katanasan:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [ally, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, ally.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a pending katanasan offer is accepted through the transient action", () => {
  const ally = {
    ...action("alliance:katanasan:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan", relation: 2 },
  };
  const reject = {
    ...action("alliance_reject:katanasan:1", "alliance_reject", "Reject katanasan alliance"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan" },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [ally, reject, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, ally.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("an existing katanasan alliance is never broken or re-requested", () => {
  const ally = {
    ...action("alliance:katanasan:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan", relation: 1 },
  };
  const breakAlliance = {
    ...action("break_alliance:katanasan:1", "break_alliance", "Break alliance with katanasan"),
    metadata: { targetID: "katanasan", targetName: "katanasan" },
  };
  const history = Array.from({ length: 20 }, (_, index) => ({
    actionID: `attack:bystander:${index % 3}`, kind: "attack", targetName: "bystander", tileShare: 0.5,
  }));
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [ally, breakAlliance, probe, build],
    observation({
      tileShare: 0.5,
      troopRatio: 0.9,
      incomingAttacks: 1,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1, isAllied: true },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    history,
  );
  assert.notEqual(selected.id, breakAlliance.id);
  assert.notEqual(selected.id, ally.id);
});

test("katanasan alliance retries respect the cooldown", () => {
  const ally = {
    ...action("alliance:katanasan:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const obs = observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    rivals: [
      { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1 },
      { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
    ],
  });
  const cooling = choose([ally, probe], obs, null, [{
    actionID: "alliance:katanasan:0", kind: "alliance_request", targetName: "katanasan", targetID: "katanasan",
  }]);
  assert.notEqual(cooling.id, ally.id);
  const restedHistory = Array.from({ length: 7 }, (_, index) => ({
    actionID: index === 0 ? "alliance:katanasan:0" : `attack:bystander:${index}`,
    kind: index === 0 ? "alliance_request" : "attack",
    targetName: index === 0 ? "katanasan" : "bystander",
    targetID: index === 0 ? "katanasan" : "bystander",
  }));
  const rested = choose([ally, probe], obs, null, restedHistory);
  assert.equal(rested.id, ally.id);
  assert.equal(rested.policyMarker, "kp2");
});

test("no harmful action of any kind is ever taken against katanasan", () => {
  const harmful = [
    action("attack:katanasan:10", "attack", "Attack katanasan 10%"),
    action("boat:katanasan:8", "boat", "Invade katanasan"),
    action("embargo:katanasan:1", "embargo", "Embargo katanasan"),
    action("target:katanasan:1", "target_player", "Target katanasan"),
    { ...action("break_alliance:katanasan:1", "break_alliance", "Break alliance with katanasan"),
      metadata: { targetID: "katanasan", targetName: "katanasan" } },
    { ...action("alliance_reject:katanasan:1", "alliance_reject", "Reject katanasan alliance"),
      metadata: { recipientID: "katanasan", recipientName: "katanasan" } },
    { ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
      metadata: { unit: "Atom Bomb", targetID: "katanasan", targetName: "katanasan", targetTileShare: 0.79, targetSamCoverage: 0 } },
  ];
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...harmful, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{ id: "katanasan", name: "katanasan", tileShare: 0.3, relativeTroopRatio: 1.5 }],
    }),
    null,
    [],
  );
  for (const action of harmful) {
    assert.notEqual(selected.id, action.id);
  }
});

test("unrelated rivals stay valid attack and nuclear targets", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "leader", targetName: "Leader", targetTileShare: 0.79, targetSamCoverage: 0 },
  };
  const probe = action("attack:leader:10", "attack", "Attack Leader 10%");
  const selected = choose(
    [bomb, probe],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.1, relativeTroopRatio: 1.5 },
        { id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});

function pileOnObs({ spawnTile, bystanderRatio = 1.2, attackerCount = 2 } = {}) {
  const attackers = [
    { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.05, incomingAttack: true },
    { id: "raider", name: "Raider", tileShare: 0.12, relativeTroopRatio: 1.02, incomingAttack: true },
  ].slice(0, attackerCount);
  return observation({
    tileShare: 0.2,
    troopRatio: 0.9,
    incomingAttacks: attackerCount,
    incomingAttackPlayerIDs: attackers.map((rival) => rival.id),
    spawnTile,
    rivals: [
      ...attackers,
      { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: bystanderRatio },
    ],
  });
}

test("Pangaea pile-on discipline suppresses a near-parity rival attack", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:bystander:${percent}`, "attack", `Attack Bystander ${percent}%`));
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...attacks, build],
    pileOnObs({ spawnTile: 659528 }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
  assert.equal(selected.policyMarker, "pd2");
});

test("Asia pile-on discipline suppresses even a current attacker below 1.3", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:aggressor:${percent}`, "attack", `Attack Aggressor ${percent}%`));
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...attacks, build],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      incomingAttacks: 2,
      incomingAttackPlayerIDs: ["aggressor", "raider"],
      spawnTile: 1180588,
      rivals: [
        { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.2, incomingAttack: true },
        { id: "raider", name: "Raider", tileShare: 0.12, relativeTroopRatio: 1.02, incomingAttack: true },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
  assert.equal(selected.policyMarker, "pd2");
});

test("World near-parity counter survives the pile-on discipline band", () => {
  const actions = [10, 25, 40].map((percent) => ({
    ...action(`attack:aggressor:${percent}`, "attack", `Attack Aggressor ${percent}%`),
    metadata: { targetID: "aggressor", troopPercent: percent, incomingAttack: true },
  }));
  const selected = choose(
    actions,
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      incomingAttacks: 2,
      spawnTile: 1088580,
      rivals: [
        { id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.05, incomingAttack: true },
        { id: "raider", name: "Raider", tileShare: 0.12, relativeTroopRatio: 1.02 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:aggressor:40");
  assert.equal(selected.policyMarker, "pc1");
});

test("a single attacker never triggers pile-on discipline", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:bystander:${percent}`, "attack", `Attack Bystander ${percent}%`));
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...attacks, build],
    pileOnObs({ spawnTile: 659528, attackerCount: 1 }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:bystander:10");
  assert.equal(selected.policyMarker, undefined);
});

test("a strong counter at 1.3 or better proceeds under pile-on", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:bystander:${percent}`, "attack", `Attack Bystander ${percent}%`));
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...attacks, build],
    pileOnObs({ spawnTile: 659528, bystanderRatio: 1.5 }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:bystander:10");
  assert.equal(selected.policyMarker, undefined);
});

test("a Gravity alliance request is accepted with the same priority as katanasan", () => {
  const gravityAlly = {
    ...action("alliance:juryoku:1", "alliance_request", "Request alliance with juryoku-koku"),
    metadata: { recipientID: "juryoku-koku", recipientName: "juryoku-koku", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "juryoku-koku", name: "juryoku-koku", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("Gravity is protected by exact player ID even under another name", () => {
  const probe = action("attack:someone:10", "attack", "Attack Someone 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [probe, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
        name: "Someone",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("alliance requests stop only for the confirmed ally, not the pending one", () => {
  const gravityAlly = {
    ...action("alliance:juryoku:1", "alliance_request", "Request alliance with juryoku-koku"),
    metadata: { recipientID: "juryoku-koku", recipientName: "juryoku-koku", relation: 0 },
  };
  const katAlly = {
    ...action("alliance:katanasan:1", "alliance_request", "Request alliance with katanasan"),
    metadata: { recipientID: "katanasan", recipientName: "katanasan", relation: 0 },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [gravityAlly, katAlly, build],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.1, isAllied: true },
        { id: "juryoku-koku", name: "juryoku-koku", tileShare: 0.12, relativeTroopRatio: 1.1 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("no harmful action of any kind is taken against Gravity or katanasan", () => {
  const harmfulKat = action("attack:katanasan:10", "attack", "Attack katanasan 10%");
  const harmfulGravBoat = action("boat:juryoku:8", "boat", "Invade juryoku-koku");
  const harmfulGravNuke = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "juryoku-koku", targetName: "juryoku-koku", targetTileShare: 0.7, targetSamCoverage: 0 },
  };
  const harmfulGravWarship = {
    ...action("move_warship:juryoku:1", "move_warship", "Move warship toward juryoku-koku"),
    metadata: { targetID: "juryoku-koku", targetName: "juryoku-koku" },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [harmfulKat, harmfulGravBoat, harmfulGravNuke, harmfulGravWarship, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.12, relativeTroopRatio: 1.8 },
        { id: "juryoku-koku", name: "juryoku-koku", tileShare: 0.12, relativeTroopRatio: 1.8 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("outsiders stay valid nuclear targets under the three-body pact", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: { unit: "Atom Bomb", targetID: "leader", targetName: "Leader", targetTileShare: 0.79, targetSamCoverage: 0 },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, build],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        { id: "katanasan", name: "katanasan", tileShare: 0.1, relativeTroopRatio: 1.5 },
        { id: "juryoku-koku", name: "juryoku-koku", tileShare: 0.1, relativeTroopRatio: 1.5 },
        { id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});

test("Gravity is protected under the game's spaced display name", () => {
  const probe = action("attack:juryokukoku:10", "attack", "Attack juryoku koku 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [probe, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{ id: "juryokukoku", name: "juryoku koku", tileShare: 0.12, relativeTroopRatio: 1.8 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("a Gravity alliance is accepted under the spaced display name", () => {
  const gravityAlly = {
    ...action("alliance:juryokukoku:1", "alliance_request", "Request alliance with juryoku koku"),
    metadata: { recipientID: "juryokukoku", recipientName: "juryoku koku", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "juryokukoku", name: "juryoku koku", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("the current K1Z Gravity display name blocks observed harmful actions", () => {
  const gravity = {
    id: "x262ww19",
    name: "K1Z Gravity",
    tileShare: 0.3,
    relativeTroopRatio: 0.6,
  };
  const safe = action("hold:1", "hold", "Hold");
  const harmful = [
    {
      ...action("build:Atom Bomb:9", "nuke", "Build Atom Bomb"),
      metadata: {
        unit: "Atom Bomb",
        targetID: gravity.id,
        targetName: gravity.name,
        targetTileShare: gravity.tileShare,
        targetSamCoverage: 0,
      },
    },
    {
      ...action("attack:x262ww19:40", "attack", "Attack K1Z Gravity 40%"),
      metadata: { targetID: gravity.id, targetName: gravity.name },
    },
    {
      ...action("boat:x262ww19:40", "boat", "Invade K1Z Gravity 40%"),
      metadata: { targetID: gravity.id, targetName: gravity.name },
    },
  ];

  for (const hostileAction of harmful) {
    const selected = choose(
      [hostileAction, safe],
      observation({ tileShare: 0.2, troopRatio: 0.9, rivals: [gravity] }),
      null,
      [],
    );
    assert.equal(selected.id, safe.id, `selected ${hostileAction.kind} against K1Z Gravity`);
  }
});

test("the current K1Z Gravity display name receives reciprocal alliance priority", () => {
  const gravityAlly = {
    ...action("alliance:x262ww19", "alliance_request", "Request alliance with K1Z Gravity"),
    metadata: { recipientID: "x262ww19", recipientName: "K1Z Gravity", relation: 2 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "x262ww19", name: "K1Z Gravity", tileShare: 0.12, relativeTroopRatio: 1.1 },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("K1Z Gravity protection still ends immediately after observed betrayal", () => {
  const counter = action("attack:x262ww19:10", "attack", "Attack K1Z Gravity 10%");
  const hold = action("hold:1", "hold", "Hold");
  const selected = choose(
    [counter, hold],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["x262ww19"],
      spawnTile: 1180588,
      rivals: [{
        id: "x262ww19",
        name: "K1Z Gravity",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
        incomingAttack: true,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, counter.id);
});

test("outsiders remain valid targets beside the renamed K1Z Gravity", () => {
  const gravityProbe = action("attack:x262ww19:10", "attack", "Attack K1Z Gravity 10%");
  const outsiderProbe = action("attack:outsider:10", "attack", "Attack Outsider 10%");
  const selected = choose(
    [gravityProbe, outsiderProbe],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        { id: "x262ww19", name: "K1Z Gravity", tileShare: 0.3, relativeTroopRatio: 1.8 },
        { id: "outsider", name: "Outsider", tileShare: 0.1, relativeTroopRatio: 1.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, outsiderProbe.id);
});

test("K1Z-tagged katanasan stays protected by canonical name and stable ID", () => {
  const probe = action("attack:kata:10", "attack", "Attack K1Z katanasan 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [probe, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
        name: "K1Z katanasan",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("a K1Z-tagged katanasan alliance offer is accepted on sight", () => {
  const taggedAlly = {
    ...action("alliance:kata:1", "alliance_request", "Request alliance with K1Z katanasan"),
    metadata: {
      recipientID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      recipientName: "K1Z katanasan",
      relation: 0,
    },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [taggedAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
          name: "K1Z katanasan",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, taggedAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a hidden-label nuke whose metadata names K1Z juryoku koku is rejected", () => {
  const hiddenNuke = {
    ...action("nuke:fullsend", "nuke", "Full send!"),
    metadata: { targetName: "K1Z juryoku koku" },
  };
  const hold = action("hold:1", "hold", "Hold");
  const selected = choose(
    [hiddenNuke, hold],
    observation({
      tileShare: 0.2,
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
    null,
    [],
  );
  assert.equal(selected.id, hold.id);
});

test("a hidden-label warship move carrying the observed Gravity ID is rejected", () => {
  const hiddenMove = {
    ...action("move_warship:x", "move_warship", "Reposition fleet"),
    metadata: { targetID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335" },
  };
  const hold = action("hold:1", "hold", "Hold");
  const selected = choose(
    [hiddenMove, hold],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.3,
          relativeTroopRatio: 0.6,
        },
        { id: "leader", name: "Leader", tileShare: 0.4, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, hold.id);
});

test("outsiders remain legal nuclear targets beside K1Z-tagged allies", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "leader",
      targetName: "Leader",
      targetTileShare: 0.79,
      targetSamCoverage: 0,
    },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, build],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
          name: "K1Z katanasan",
          tileShare: 0.1,
          relativeTroopRatio: 1.5,
        },
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.1,
          relativeTroopRatio: 1.5,
        },
        { id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});

test("an invisible Gravity partner is requested from alliance metadata", () => {
  const gravityAlly = {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("an invisible Gravity retry respects the six-decision cooldown", () => {
  const gravityAlly = {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const history = [
    { actionID: "x0", kind: "attack", tileShare: 0.1 },
    { actionID: "x1", kind: "attack", tileShare: 0.1 },
    { actionID: "x2", kind: "attack", tileShare: 0.1 },
    {
      actionID: "alliance:9h8tnrym",
      kind: "alliance_request",
      targetID: "9h8tnrym",
      targetName: "juryoku koku",
      tileShare: 0.1,
    },
  ];
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, probe.id);
});

test("an invisible Gravity is retried once the cooldown lapses", () => {
  const gravityAlly = {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 0 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const history = [
    {
      actionID: "alliance:9h8tnrym",
      kind: "alliance_request",
      targetID: "9h8tnrym",
      targetName: "juryoku koku",
      tileShare: 0.1,
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      actionID: `x${index}`,
      kind: "attack",
      tileShare: 0.1,
    })),
  ];
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("an allied Gravity gets no fresh requests while its action lingers", () => {
  const gravityAlly = {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 1 },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [gravityAlly, build],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{
        id: "9h8tnrym",
        name: "juryoku koku",
        tileShare: 0.12,
        relativeTroopRatio: 1.1,
        isAllied: true,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("recordDecision keeps metadata targets for invisible partners", () => {
  const history = [];
  const state = buildState(observation({ rivals: [], tilesOwned: 12_345 }), [], history);
  recordDecision(history, {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 0 },
  }, state);
  assert.equal(history[0].targetID, "9h8tnrym");
  assert.equal(history[0].targetName, "juryoku koku");
  assert.equal(history[0].tilesOwned, 12_345);
});

test("a Neutral-relation Gravity partner is requested immediately", () => {
  const gravityAlly = {
    ...action("alliance:9h8tnrym", "alliance_request", "Request alliance with juryoku koku"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 2 },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [gravityAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        {
          id: "9h8tnrym",
          name: "juryoku koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
          relation: "2",
        },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, gravityAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("K1Z Hrafn stays protected by canonical name and stable ID", () => {
  const probe = action("attack:hrafn:10", "attack", "Attack K1Z Hrafn 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [probe, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
        name: "K1Z Hrafn",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("a Hrafn alliance offer is accepted on sight", () => {
  const hrafnAlly = {
    ...action("alliance:hrafn:1", "alliance_request", "Request alliance with K1Z Hrafn"),
    metadata: {
      recipientID: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
      recipientName: "K1Z Hrafn",
      relation: 2,
    },
  };
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const selected = choose(
    [hrafnAlly, probe],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
          name: "K1Z Hrafn",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, hrafnAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a hidden-label nuke whose metadata names K1Z Hrafn is rejected", () => {
  const hiddenNuke = {
    ...action("nuke:fullsend2", "nuke", "Full send!"),
    metadata: { targetName: "K1Z Hrafn" },
  };
  const hold = action("hold:1", "hold", "Hold");
  const selected = choose(
    [hiddenNuke, hold],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        {
          id: "in-game-9",
          name: "K1Z Hrafn",
          tileShare: 0.3,
          relativeTroopRatio: 0.6,
        },
        { id: "leader", name: "Leader", tileShare: 0.4, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, hold.id);
});

test("outsiders remain legal nuclear targets beside all three K1Z allies", () => {
  const bomb = {
    ...action("build:Atom Bomb:1", "build", "Build Atom Bomb"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "leader",
      targetName: "Leader",
      targetTileShare: 0.79,
      targetSamCoverage: 0,
    },
  };
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [bomb, build],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
          name: "K1Z katanasan",
          tileShare: 0.1,
          relativeTroopRatio: 1.5,
        },
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.1,
          relativeTroopRatio: 1.5,
        },
        {
          id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
          name: "K1Z Hrafn",
          tileShare: 0.1,
          relativeTroopRatio: 1.5,
        },
        { id: "leader", name: "Leader", tileShare: 0.79, relativeTroopRatio: 0.5 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});
