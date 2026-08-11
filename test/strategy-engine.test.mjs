import assert from "node:assert/strict";
import test from "node:test";

import {
  boatConversionStalled,
  buildState,
  chooseAction,
  chooseCaptainUnderpantsRuntimeAction,
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

test("MM1 convert requires the exact visible rival ID at the selector boundary", () => {
  const weak = {
    ...action("attack:weak:10", "attack", "Attack Weak 10%"),
    metadata: { targetID: "weak", targetName: "Weak", troopPercent: 10 },
  };
  const large = {
    ...action("attack:large:10", "attack", "Attack Large 10%"),
    metadata: { targetID: "large", targetName: "Large", troopPercent: 10 },
  };
  const hold = action("hold", "hold", "Hold");
  const obs = observation({
    tileShare: 0.2,
    rivals: [
      { id: "weak", name: "Weak", tileShare: 0.08, relativeTroopRatio: 2.2 },
      { id: "large", name: "Large", tileShare: 0.2, relativeTroopRatio: 1.5 },
    ],
  });
  const menu = [weak, large, hold];
  const baseline = choose(menu, obs, null, []);
  const exact = choose(menu, obs, {
    intent: "convert", targetID: "large", horizon: 4, model: "test",
  }, []);
  const wrongCase = choose(menu, obs, {
    intent: "convert", targetID: "LARGE", horizon: 4, model: "test",
  }, []);

  assert.equal(baseline.id, weak.id);
  assert.equal(exact.id, large.id);
  assert.equal(exact.policyMarker, "mm1c");
  assert.equal(wrongCase.id, baseline.id);
  assert.notEqual(wrongCase.policyMarker, "mm1c");
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
    Pangaea: [
      659528, 266554, 687420, 622372, 589302, 450306, 740346,
      856604, 855528,
    ],
    // 0.1.26 rotating generation, harvested from live round replays.
    BlackSea: [87062, 103422, 204804, 528376, 680556, 823450, 931556,
      1227812, 1346942, 1372678, 1548490, 1549104],
    EastAsia: [139982, 158414, 159174, 159476, 318806, 476042, 787846,
      805724, 966024, 1277640, 1605498, 1618670],
    NorthAmerica: [94258, 533412, 782258, 784490, 1100538, 1546436,
      2031300, 2065364, 2554544, 3308084, 4042276],
    Oceania: [24054, 230178, 996628, 1000504, 1108410, 1160598, 1168508,
      1196714, 1334418, 1334584, 1336292, 1558664],
    Britannia: [469552, 930618, 1141426, 1698062, 1701672, 2092478, 2107368,
      2334966, 2729848, 2759682, 2994416, 3339196,
      1298456, 1692346, 2378550, 2502336],
    // 0.1.35 16P generation additions + regenerated Pangaea/World sets.
    BlackSea16: [97960, 103112, 508538, 534682],
    EastAsia16: [447782, 484550, 715024, 1118712],
    Oceania16: [104126, 1200350, 1340668, 1446708],
    Pangaea16: [70318, 71628, 188728, 190532, 249166, 281344, 376534, 431138,
      446336, 552576, 619140, 640382, 712688, 796512, 855352, 916672],
    World135: [50504, 231078, 300170, 369496, 757248, 878938, 1068540,
      1239648, 1991074, 1991826, 1994392, 1997454],
  };
  const LABEL = { BlackSea16: "BlackSea", EastAsia16: "EastAsia",
    Oceania16: "Oceania", Pangaea16: "Pangaea", World135: "World" };
  for (const [map, spawnTiles] of Object.entries(cases)) {
    for (const spawnTile of spawnTiles) {
      const state = buildState(observation({ spawnTile }), [action("hold", "hold", "Hold")]);
      assert.equal(state.mapFingerprint, LABEL[map] ?? map);
    }
  }
  // Tile 534350 spawns on both Pangaea and NorthAmerica: ambiguous tiles
  // fingerprint as neither, because a wrong fingerprint activates the other
  // map's opening doctrine while a missing one stays neutral.
  const ambiguous = buildState(observation({ spawnTile: 534350 }), [action("hold", "hold", "Hold")]);
  assert.equal(ambiguous.mapFingerprint, null);
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

test("legacy tactical planner fields cannot trigger donations", () => {
  const actions = [
    action("donate_gold:friend:1000", "donate_gold", "Donate gold to Friend"),
    action("hold", "hold", "Hold"),
  ];
  const rival = { id: "friend", name: "Friend", tileShare: 0.1, relativeTroopRatio: 2 };
  assert.equal(choose(actions, observation({ rivals: [rival] }), { focus: "ally" }).kind, "hold");
  rival.isAllied = true;
  assert.equal(choose(actions, observation({ rivals: [rival] }), { focus: "ally" }).kind, "hold");
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

test("CU1 entrant suppresses a repeated outgoing K1Z request on Pangaea", () => {
  const hrafn = {
    id: "hrafn-live-id",
    name: "K1Z Hrafn",
    tileShare: 0.12,
    relativeTroopRatio: 1.1,
  };
  const ally = {
    ...action("alliance:hrafn-live-id", "alliance_request", "Request alliance with K1Z Hrafn"),
    metadata: {
      recipientID: hrafn.id,
      recipientName: hrafn.name,
      relation: 0,
    },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const history = [
    {
      actionID: ally.id,
      kind: "alliance_request",
      targetID: hrafn.id,
      targetName: hrafn.name,
      tileShare: 0.1,
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      actionID: `build:City:${index}`,
      kind: "build",
      tileShare: 0.1,
    })),
  ];
  for (const spawnTile of [659528, 856604, 855528]) {
    const state = buildState(observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      spawnTile,
      rivals: [hrafn],
    }), [ally, neutral], history);

    assert.equal(chooseAction([ally, neutral], state, null, history).id, ally.id);
    const selected = chooseCaptainUnderpantsRuntimeAction([ally, neutral], state, null, history);
    assert.equal(selected.id, neutral.id);
    assert.equal(selected.policyMarker, "cu1");
  }
});

test("CU1 entrant always accepts a real reverse K1Z handshake during cooldown", () => {
  const hrafn = {
    id: "hrafn-live-id",
    name: "K1Z Hrafn",
    tileShare: 0.12,
    relativeTroopRatio: 1.1,
  };
  const ally = {
    ...action("alliance:hrafn-live-id", "alliance_request", "Accept K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name, relation: 2 },
  };
  const reject = {
    ...action("alliance_reject:hrafn-live-id", "alliance_reject", "Reject K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name },
  };
  const neutral = action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%");
  neutral.metadata = { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true };
  const history = [{
    actionID: ally.id,
    kind: "alliance_request",
    targetID: hrafn.id,
    targetName: hrafn.name,
    tileShare: 0.1,
  }];
  const state = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [hrafn],
  }), [ally, reject, neutral], history);

  const selected = chooseCaptainUnderpantsRuntimeAction([ally, reject, neutral], state, null, history);
  assert.equal(selected.id, ally.id);
  assert.equal(selected.policyMarker, "kp2");
  assert.equal(selected.allianceDirection, "inbound");
});

test("CU1 entrant does not count an accepted handshake as optional outbound outreach", () => {
  const hrafn = {
    id: "hrafn-live-id",
    name: "K1Z Hrafn",
    tileShare: 0.12,
    relativeTroopRatio: 1.1,
  };
  const gravity = {
    id: "gravity-live-id",
    name: "K1Z Gravity",
    tileShare: 0.11,
    relativeTroopRatio: 1.1,
  };
  const acceptHrafn = {
    ...action("alliance:hrafn-live-id", "alliance_request", "Accept K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name, relation: 2 },
  };
  const rejectHrafn = {
    ...action("alliance_reject:hrafn-live-id", "alliance_reject", "Reject K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name },
  };
  const firstState = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [hrafn, gravity],
  }), [acceptHrafn, rejectHrafn], []);
  const accepted = chooseCaptainUnderpantsRuntimeAction(
    [acceptHrafn, rejectHrafn],
    firstState,
    null,
    [],
  );
  const history = [];
  recordDecision(history, accepted, firstState);

  const requestGravity = {
    ...action("alliance:gravity-live-id", "alliance_request", "Request K1Z Gravity"),
    metadata: { recipientID: gravity.id, recipientName: gravity.name, relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const secondState = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [hrafn, gravity],
  }), [requestGravity, neutral], history);
  const selected = chooseCaptainUnderpantsRuntimeAction(
    [requestGravity, neutral],
    secondState,
    null,
    history,
  );

  assert.equal(history[0].allianceDirection, "inbound");
  assert.equal(selected.id, requestGravity.id);
  assert.equal(selected.policyMarker, "kp2");
  assert.equal(selected.allianceDirection, undefined);
});

test("CU1 entrant records an accepted handshake as inbound even under pressure", () => {
  const hrafn = {
    id: "hrafn-live-id",
    name: "K1Z Hrafn",
    tileShare: 0.12,
    relativeTroopRatio: 1.1,
  };
  const gravity = {
    id: "gravity-live-id",
    name: "K1Z Gravity",
    tileShare: 0.11,
    relativeTroopRatio: 1.1,
  };
  const acceptHrafn = {
    ...action("alliance:hrafn-live-id", "alliance_request", "Accept K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name, relation: 2 },
  };
  const rejectHrafn = {
    ...action("alliance_reject:hrafn-live-id", "alliance_reject", "Reject K1Z Hrafn alliance"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name },
  };
  const pressuredState = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    incomingAttacks: [{ attackerID: "outsider" }],
    incomingAttackPlayerIDs: ["outsider"],
    spawnTile: 659528,
    rivals: [
      hrafn,
      gravity,
      { id: "outsider", name: "Outsider", tileShare: 0.1, relativeTroopRatio: 0.9 },
    ],
  }), [acceptHrafn, rejectHrafn], []);
  const accepted = chooseCaptainUnderpantsRuntimeAction(
    [acceptHrafn, rejectHrafn],
    pressuredState,
    null,
    [],
  );
  const history = [];
  recordDecision(history, accepted, pressuredState);

  const requestGravity = {
    ...action("alliance:gravity-live-id", "alliance_request", "Request K1Z Gravity"),
    metadata: { recipientID: gravity.id, recipientName: gravity.name, relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const calmState = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [hrafn, gravity],
  }), [requestGravity, neutral], history);
  const selected = chooseCaptainUnderpantsRuntimeAction(
    [requestGravity, neutral],
    calmState,
    null,
    history,
  );

  assert.equal(accepted.id, acceptHrafn.id);
  assert.equal(history[0].allianceDirection, "inbound");
  assert.equal(selected.id, requestGravity.id);
});

test("CU1 entrant leaves rested K1Z requests and non-Pangaea retries unchanged", () => {
  const hrafn = {
    id: "hrafn-live-id",
    name: "K1Z Hrafn",
    tileShare: 0.12,
    relativeTroopRatio: 1.1,
  };
  const ally = {
    ...action("alliance:hrafn-live-id", "alliance_request", "Request alliance with K1Z Hrafn"),
    metadata: { recipientID: hrafn.id, recipientName: hrafn.name, relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const coolingHistory = [{
    actionID: ally.id,
    kind: "alliance_request",
    targetID: hrafn.id,
    targetName: hrafn.name,
    tileShare: 0.1,
  }, ...Array.from({ length: 6 }, (_, index) => ({
    actionID: `build:City:${index}`,
    kind: "build",
    tileShare: 0.1,
  }))];
  const restedHistory = [coolingHistory[0], ...Array.from({ length: 24 }, (_, index) => ({
    actionID: `build:Factory:${index}`,
    kind: "build",
    tileShare: 0.1,
  }))];

  for (const [spawnTile, history] of [[659528, restedHistory], [1088580, coolingHistory]]) {
    const state = buildState(observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      spawnTile,
      rivals: [hrafn],
    }), [ally, neutral], history);
    const selected = chooseCaptainUnderpantsRuntimeAction([ally, neutral], state, null, history);
    assert.equal(selected.id, ally.id);
    assert.equal(selected.policyMarker, "kp2");
  }
});

test("CU1 entrant keeps a repeated request when no productive replacement is offered", () => {
  const ally = {
    ...action("alliance:hidden-hrafn", "alliance_request", "Request alliance"),
    metadata: { recipientID: "hidden-hrafn", recipientName: "K1Z Hrafn", relation: 0 },
  };
  const hold = action("hold", "hold", "Hold");
  const history = [{
    actionID: ally.id,
    kind: "alliance_request",
    targetID: "hidden-hrafn",
    targetName: "K1Z Hrafn",
    tileShare: 0.1,
  }, ...Array.from({ length: 6 }, (_, index) => ({
    actionID: `build:City:${index}`,
    kind: "build",
    tileShare: 0.1,
  }))];
  const state = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [],
  }), [ally, hold], history);

  const selected = chooseCaptainUnderpantsRuntimeAction([ally, hold], state, null, history);
  assert.equal(selected.id, ally.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("CU1 entrant tracks invisible partners by alliance metadata", () => {
  const ally = {
    ...action("alliance:hidden-hrafn", "alliance_request", "Request alliance"),
    metadata: { recipientID: "hidden-hrafn", recipientName: "K1Z Hrafn", relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const history = [{
    actionID: ally.id,
    kind: "alliance_request",
    targetID: "hidden-hrafn",
    targetName: "K1Z Hrafn",
    tileShare: 0.1,
  }, ...Array.from({ length: 6 }, (_, index) => ({
    actionID: `build:City:${index}`,
    kind: "build",
    tileShare: 0.1,
  }))];
  const state = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [],
  }), [ally, neutral], history);

  const selected = chooseCaptainUnderpantsRuntimeAction([ally, neutral], state, null, history);
  assert.equal(selected.id, neutral.id);
  assert.equal(selected.policyMarker, "cu1");
});

test("CU1 entrant allows the first optional opening K1Z request", () => {
  const gravity = {
    ...action("alliance:gravity", "alliance_request", "Request K1Z Gravity"),
    metadata: { recipientID: "gravity", recipientName: "K1Z Gravity", relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const state = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [{ id: "gravity", name: "K1Z Gravity", tileShare: 0.1, relativeTroopRatio: 1.1 }],
  }), [gravity, neutral], []);

  const selected = chooseCaptainUnderpantsRuntimeAction([gravity, neutral], state, null, []);
  assert.equal(selected.id, gravity.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("CU1 entrant opening cooldown is global across reciprocal partners", () => {
  const hrafn = {
    ...action("alliance:hrafn", "alliance_request", "Request K1Z Hrafn"),
    metadata: { recipientID: "hrafn", recipientName: "K1Z Hrafn", relation: 0 },
  };
  const gravity = {
    ...action("alliance:gravity", "alliance_request", "Request K1Z Gravity"),
    metadata: { recipientID: "gravity", recipientName: "K1Z Gravity", relation: 0 },
  };
  const neutral = {
    ...action("expand:terra-nullius:10", "attack", "Expand into Terra Nullius 10%"),
    metadata: { targetID: null, targetName: "Terra Nullius", troopPercent: 10, expansion: true },
  };
  const history = [{
    actionID: hrafn.id,
    kind: "alliance_request",
    targetID: "hrafn",
    targetName: "K1Z Hrafn",
    tileShare: 0.1,
  }];
  const state = buildState(observation({
    tileShare: 0.1,
    troopRatio: 0.9,
    spawnTile: 659528,
    rivals: [{ id: "gravity", name: "K1Z Gravity", tileShare: 0.1, relativeTroopRatio: 1.1 }],
  }), [gravity, neutral], history);

  const selected = chooseCaptainUnderpantsRuntimeAction([gravity, neutral], state, null, history);
  assert.equal(selected.id, neutral.id);
  assert.equal(selected.policyMarker, "cu1");
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
  const state = buildState(observation({ rivals: [] }), [], history);
  recordDecision(history, {
    ...action("alliance:9h8tnrym", "alliance_request", "Send alliance request"),
    metadata: { recipientID: "9h8tnrym", recipientName: "juryoku koku", relation: 0 },
  }, state);
  assert.equal(history[0].targetID, "9h8tnrym");
  assert.equal(history[0].targetName, "juryoku koku");
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

test("an interleaved coalition retry waits out the global cadence", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const strike = action("attack:raider:10", "attack", "Attack Raider 10%");
  const history = [
    { actionID: "x0", kind: "attack", tileShare: 0.3 },
    { actionID: "x1", kind: "attack", tileShare: 0.3 },
    { actionID: "x2", kind: "attack", tileShare: 0.3 },
    {
      actionID: "alliance:kata:0",
      kind: "alliance_request",
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      tileShare: 0.3,
      policyMarker: "kp2",
    },
  ];
  const selected = choose(
    [gravAlly, strike],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "raider", name: "Raider", tileShare: 0.15, relativeTroopRatio: 1.8 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, strike.id);
  assert.equal(selected.policyMarker, "gc1");
});

test("a coalition retry fires once the global cadence lapses", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const strike = action("attack:raider:10", "attack", "Attack Raider 10%");
  const history = [
    {
      actionID: "alliance:kata:0",
      kind: "alliance_request",
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      tileShare: 0.3,
      policyMarker: "kp2",
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      actionID: `x${index}`,
      kind: "attack",
      tileShare: 0.3,
    })),
  ];
  const selected = choose(
    [gravAlly, strike],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "raider", name: "Raider", tileShare: 0.15, relativeTroopRatio: 1.8 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, gravAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a pending reverse handshake bypasses the global cadence", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const gravReject = {
    ...action("alliance_reject:grav:1", "alliance_reject", "Reject K1Z juryoku-koku alliance"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
    },
  };
  const strike = action("attack:raider:10", "attack", "Attack Raider 10%");
  const history = [
    {
      actionID: "alliance:kata:0",
      kind: "alliance_request",
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      tileShare: 0.3,
      policyMarker: "kp2",
    },
  ];
  const selected = choose(
    [gravAlly, gravReject, strike],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "raider", name: "Raider", tileShare: 0.15, relativeTroopRatio: 1.8 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, gravAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("the cadence never suppresses a request without a reliable alternative", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const hold = action("hold:1", "hold", "Hold");
  const history = [
    { actionID: "x0", kind: "attack", tileShare: 0.3 },
    {
      actionID: "alliance:kata:0",
      kind: "alliance_request",
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      tileShare: 0.3,
      policyMarker: "kp2",
    },
  ];
  const selected = choose(
    [gravAlly, hold],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
        name: "K1Z juryoku-koku",
        tileShare: 0.12,
        relativeTroopRatio: 1.1,
      }],
    }),
    null,
    history,
  );
  assert.equal(selected.id, gravAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a protected-only attack is not a reliable alternative to a coalition request", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const protectedStrike = {
    ...action("attack:kata:10", "attack", "Attack K1Z katanasan 10%"),
    metadata: {
      targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      targetName: "K1Z katanasan",
      troopPercent: 10,
    },
  };
  const hold = action("hold:1", "hold", "Hold");
  const history = [{
    actionID: "alliance:kata:0",
    kind: "alliance_request",
    targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    targetName: "K1Z katanasan",
    tileShare: 0.3,
    policyMarker: "kp2",
  }];
  const selected = choose(
    [gravAlly, protectedStrike, hold],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        {
          id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
          name: "K1Z katanasan",
          tileShare: 0.12,
          relativeTroopRatio: 1.5,
        },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, gravAlly.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("a gc1 reroute remains observable when the tactical route has another marker", () => {
  const gravAlly = {
    ...action("alliance:grav:1", "alliance_request", "Request alliance with K1Z juryoku-koku"),
    metadata: {
      recipientID: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
      recipientName: "K1Z juryoku-koku",
      relation: 2,
    },
  };
  const strike = {
    ...action("attack:raider:10", "attack", "Attack Raider 10%"),
    metadata: {
      targetID: "raider",
      targetName: "Raider",
      troopPercent: 10,
      incomingAttack: true,
    },
  };
  const history = [{
    actionID: "alliance:kata:0",
    kind: "alliance_request",
    targetID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    targetName: "K1Z katanasan",
    tileShare: 0.3,
    policyMarker: "kp2",
  }];
  const selected = choose(
    [gravAlly, strike],
    observation({
      tileShare: 0.3,
      troopRatio: 0.9,
      spawnTile: 1180588,
      incomingAttackPlayerIDs: ["raider"],
      rivals: [
        {
          id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
          name: "K1Z juryoku-koku",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        {
          id: "raider",
          name: "Raider",
          tileShare: 0.15,
          relativeTroopRatio: 1.8,
          incomingAttack: true,
        },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, strike.id);
  assert.equal(selected.policyMarker, "ia1");
  assert.deepEqual(selected.policyMarkers, ["gc1", "ia1"]);
});

test("recorded decisions enforce three-partner cadence and preserve a reverse handshake", () => {
  const ids = {
    kata: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    grav: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
    hrafn: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
  };
  const rivals = [
    { id: ids.kata, name: "K1Z katanasan", tileShare: 0.1, relativeTroopRatio: 1.1 },
    { id: ids.grav, name: "K1Z juryoku-koku", tileShare: 0.1, relativeTroopRatio: 1.1 },
    { id: ids.hrafn, name: "K1Z Hrafn", tileShare: 0.1, relativeTroopRatio: 1.1 },
  ];
  const partnerRequest = (key) => ({
    ...action(`alliance:${key}`, "alliance_request", `Request alliance with ${key}`),
    metadata: {
      recipientID: ids[key],
      recipientName: rivals.find((rival) => rival.id === ids[key]).name,
      relation: 2,
    },
  });
  const expand = (index) => ({
    ...action(
      `expand:terra-nullius:${index}`,
      "attack",
      `Expand into Terra Nullius ${index}%`,
    ),
    metadata: { expansion: true, troopPercent: 10 },
  });
  const obs = observation({ tileShare: 0.3, troopRatio: 0.9, rivals });
  const history = [];

  const firstActions = [partnerRequest("kata")];
  const firstState = buildState(obs, firstActions, history);
  const first = chooseAction(firstActions, firstState, null, history);
  assert.equal(first.id, "alliance:kata");
  assert.equal(first.policyMarker, "kp2");
  recordDecision(history, first, firstState);

  for (let index = 0; index < 8; index++) {
    const partner = index % 2 === 0 ? "grav" : "hrafn";
    const actions = [partnerRequest(partner), expand(index + 10)];
    const state = buildState(obs, actions, history);
    const selected = chooseAction(actions, state, null, history);
    assert.equal(selected.kind, "attack");
    assert.equal(selected.policyMarker, "gc1");
    assert.deepEqual(selected.policyMarkers, ["gc1"]);
    recordDecision(history, selected, state);
  }

  const lapsedActions = [partnerRequest("grav"), expand(35)];
  const lapsedState = buildState(obs, lapsedActions, history);
  const lapsed = chooseAction(lapsedActions, lapsedState, null, history);
  assert.equal(lapsed.id, "alliance:grav");
  assert.equal(lapsed.policyMarker, "kp2");
  recordDecision(history, lapsed, lapsedState);

  const hrafnRequest = partnerRequest("hrafn");
  const pendingHrafn = {
    ...action("alliance_reject:hrafn", "alliance_reject", "Reject K1Z Hrafn alliance"),
    metadata: {
      recipientID: ids.hrafn,
      recipientName: "K1Z Hrafn",
    },
  };
  const reverseActions = [hrafnRequest, pendingHrafn, expand(40)];
  const reverseState = buildState(obs, reverseActions, history);
  const reverse = chooseAction(reverseActions, reverseState, null, history);
  assert.equal(reverse.id, "alliance:hrafn");
  assert.equal(reverse.policyMarker, "kp2");
});

test("K1Z Mickey Mouse is protected by canonical name and stable player ID", () => {
  const harmful = [
    action("attack:mickey:40", "attack", "Attack K1Z Mickey Mouse 40%"),
    action("boat:mickey:25", "boat", "Invade K1Z Mickey Mouse 25%"),
    {
      ...action("nuke:mickey", "nuke", "Launch strike"),
      metadata: {
        targetID: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
        targetName: "K1Z Mickey Mouse",
      },
    },
  ];
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [...harmful, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
        name: "K1Z Mickey Mouse",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
      }],
    }),
    null,
    [],
  );
  for (const hostile of harmful) assert.notEqual(selected.id, hostile.id);
  assert.equal(selected.id, build.id);
});

test("Mickey remains protected even after observed incoming pressure", () => {
  const counter = action("attack:mickey:40", "attack", "Attack Mickey Mouse 40%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [counter, build],
    observation({
      tileShare: 0.4,
      troopRatio: 0.9,
      incomingAttacks: [{ attackerID: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421" }],
      incomingAttackPlayerIDs: ["ply_e982e621-9ca3-47cd-8151-f57ee9d99421"],
      rivals: [{
        id: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
        name: "Mickey Mouse",
        tileShare: 0.12,
        relativeTroopRatio: 1.8,
        incomingAttack: true,
      }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("a Mickey alliance offer is accepted with coalition priority", () => {
  const mickeyAlliance = {
    ...action("alliance:mickey", "alliance_request", "Request alliance with K1Z Mickey Mouse"),
    metadata: {
      recipientID: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
      recipientName: "K1Z Mickey Mouse",
      relation: 2,
    },
  };
  const outsider = action("attack:outsider:10", "attack", "Attack Outsider 10%");
  const selected = choose(
    [mickeyAlliance, outsider],
    observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        {
          id: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
          name: "K1Z Mickey Mouse",
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
        },
        { id: "outsider", name: "Outsider", tileShare: 0.12, relativeTroopRatio: 1.3 },
      ],
    }),
    null,
    [],
  );
  assert.equal(selected.id, mickeyAlliance.id);
  assert.equal(selected.policyMarker, "kp2");
});

// Structured-deal pact keeping (engine 0.1.26): an accepted non-aggression /
// trade-security pact binds the whole move channel while our obligation is
// pending — attacks, nukes, and forced conversion transports all treat the
// partner as protected. Self-defense stays exempt: a partner currently
// attacking us is fair game (their defection is the recorded one).

function pactObservation(extra = {}) {
  return {
    ...observation({
      tileShare: 0.1,
      troopRatio: 0.9,
      rivals: [
        { id: "partner", name: "Partner", tileShare: 0.12, relativeTroopRatio: 1.5 },
        { id: "neutralfoe", name: "Neutralfoe", tileShare: 0.1, relativeTroopRatio: 1.4 },
      ],
      ...extra,
    }),
    ownState: {
      tileShare: 0.1, troopRatio: 0.9, troops: 500000, gold: 250000,
      borderTiles: 100, incomingAttacks: extra.incomingAttacks ?? [],
      playerID: "odin",
    },
    deals: {
      activeDeals: [{
        template: "non_aggression_pact",
        proposerPlayerID: "partner", recipientPlayerID: "odin",
        proposerName: "Partner", recipientName: "Odin",
        obligations: [
          { obligorPlayerID: "odin", status: "pending" },
          { obligorPlayerID: "partner", status: "pending" },
        ],
      }],
      incomingProposals: [],
      outgoingProposals: [],
    },
  };
}

test("an active pact steers attacks away from the partner", () => {
  const attackPartner = {
    ...action("attack:partner:10", "attack", "Attack Partner 10%"),
    metadata: { targetID: "partner", targetName: "Partner", troopPercent: 10 },
  };
  const attackFoe = {
    ...action("attack:neutralfoe:10", "attack", "Attack Neutralfoe 10%"),
    metadata: { targetID: "neutralfoe", targetName: "Neutralfoe", troopPercent: 10 },
  };
  const selected = choose([attackPartner, attackFoe], pactObservation(), null, []);
  assert.equal(selected.id, attackFoe.id);
});

test("a partner attacking us forfeits pact protection", () => {
  const attackPartner = {
    ...action("attack:partner:10", "attack", "Attack Partner 10%"),
    metadata: { targetID: "partner", targetName: "Partner", troopPercent: 10 },
  };
  const selected = choose(
    [attackPartner],
    pactObservation({ incomingAttacks: [{ attackerID: "partner" }] }),
    null,
    [],
  );
  assert.equal(selected.id, attackPartner.id);
});

// UG1: a World upgrade-lock at a frozen frontier releases one bounded forced
// conversion transport instead of another unconditional utility upgrade.
// Round-1325 evidence: ab2e1fcd froze at 46,015 tiles for 8,400 turns while
// selecting 83 consecutive upgrades with invasion transports legal; the
// invasion pool was gated off by the tileShare >= 0.15 bar at realistic World
// shares, and cv1 could not fire without boats in recent history.

const WORLD_SPAWN_TILE = 1088580;

function upgradeLockHistory({
  tileShare = 0.05,
  upgrades = 6,
  length = 8,
  marker = null,
} = {}) {
  return Array.from({ length }, (_, index) => ({
    actionID: index < upgrades ? `upgrade:city:${index}` : `build:city:${index}`,
    kind: index < upgrades ? "upgrade_structure" : "build",
    neutral: false,
    tileShare,
    policyMarker: index === length - 1 ? marker : null,
    mapFingerprint: "World",
  }));
}

function invasionBoat(id, targetID, targetName, troopPercent) {
  return {
    ...action(id, "boat", `Transport to ${targetName} ${troopPercent}%`),
    metadata: {
      targetID,
      targetName,
      troopPercent,
      navalInvasion: true,
      expansion: false,
    },
  };
}

test("ug1: a World upgrade-lock converts an optional upgrade into a forced conversion transport", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const boat25 = invasionBoat("boat:93699:25", "weakling", "Weakling", 25);
  const history = upgradeLockHistory();
  const selected = choose(
    [upgrade, boat8, boat25],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, boat8.id);
  assert.equal(selected.policyMarker, "ug1");
});

test("ug1 stays inert under incoming pressure", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      incomingAttacks: [{ attackerID: "weakling" }],
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ug1 stays inert below the troop-ratio reserve floor", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.7,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ug1 releases on any map, fingerprinted or not", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const rivals = [
    { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
  ];
  // Pangaea-fingerprinted seat
  const onPangaea = choose(
    [upgrade, boat8],
    observation({ tileShare: 0.05, troopRatio: 0.9, spawnTile: 659528, rivals }),
    null,
    upgradeLockHistory().map((entry) => ({ ...entry, mapFingerprint: "Pangaea" })),
  );
  assert.equal(onPangaea.id, boat8.id);
  assert.equal(onPangaea.policyMarker, "ug1");
  // Unknown-map seat (0.1.26 rotating generation, no fingerprint)
  const onUnknown = choose(
    [upgrade, boat8],
    observation({ tileShare: 0.05, troopRatio: 0.9, spawnTile: 999999999, rivals }),
    null,
    upgradeLockHistory().map((entry) => ({ ...entry, mapFingerprint: null })),
  );
  assert.equal(onUnknown.id, boat8.id);
  assert.equal(onUnknown.policyMarker, "ug1");
});

test("ug1 never fires at a protected or allied target and never holds", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "friend", "Friend", 8);
  const hold = action("hold", "hold", "Hold");
  const selected = choose(
    [upgrade, boat8, hold],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "friend", name: "Friend", tileShare: 0.03, relativeTroopRatio: 1.4, isAllied: true, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ug1 cools down after a recent ug1 release", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory({ marker: "ug1" }),
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 needs a genuine upgrade-lock signature, not scattered upgrades", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory({ upgrades: 3 }),
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 stays inert while the frontier is still moving", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const history = upgradeLockHistory().map((entry, index) => ({
    ...entry,
    tileShare: 0.04 + index * 0.004,
  }));
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.072,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, upgrade.id);
});

// Pins from the adversarial refutation panel (2026-08-08): upper share gate,
// pressure lookback, ratio-1.0 relaxation, cooldown boundary, shared cv1
// cooldown, authoritative-target hardening, tier disambiguation, sparse
// histories, and protocol-only pressure.

test("ug1 releases at forced-conversion ratio 1.05, below the ordinary 1.15 bar", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.05, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, boat8.id);
  assert.equal(selected.policyMarker, "ug1");
});

test("ug1 respects the full cooldown window boundary: inert at 5, fires at 6", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const obs = () => observation({
    tileShare: 0.05,
    troopRatio: 0.9,
    spawnTile: WORLD_SPAWN_TILE,
    rivals: [
      { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
    ],
  });
  const withMarkerAt = (index) => upgradeLockHistory().map((entry, i) =>
    i === index ? { ...entry, kind: "boat", policyMarker: "ug1" } : entry
  );
  const inert = choose([upgrade, boat8], obs(), null, withMarkerAt(2)); // decisionsSince = 5
  assert.equal(inert.id, upgrade.id);
  const fires = choose([upgrade, boat8], obs(), null, withMarkerAt(1)); // decisionsSince = 6
  assert.equal(fires.id, boat8.id);
  assert.equal(fires.policyMarker, "ug1");
});

test("ug1 shares its cooldown with cv1 releases", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const history = upgradeLockHistory().map((entry, i) =>
    i === 4 ? { ...entry, kind: "boat", policyMarker: "cv1" } : entry // decisionsSince = 3
  );
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 does not serve seats above the invasion-pool share gate", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "parity", "Parity", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "parity", name: "Parity", tileShare: 0.18, relativeTroopRatio: 1.05, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory({ tileShare: 0.2 }),
  );
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ug1 treats a one-tick lull in a bursty siege as pressure, not calm", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const history = upgradeLockHistory().map((entry) => ({
    ...entry,
    incomingAttackerIDs: ["bully"],
  }));
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
        { id: "bully", name: "Bully", tileShare: 0.2, relativeTroopRatio: 0.9, sharesBorder: true },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 stays inert under protocol-only incoming pressure", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      incomingAttackPlayerIDs: ["weakling"],
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 refuses a release without an authoritative resolvable target ID", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  // Metadata-free boat whose label collides with an adversarial rival name.
  const spoofBoat = action("boat:93699:8", "boat", "Transport to Friend 8%");
  const selected = choose(
    [upgrade, spoofBoat],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "friend", name: "Friend", tileShare: 0.03, relativeTroopRatio: 1.4, isAllied: true, sharesBorder: false },
        { id: "spoof", name: "transport", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ug1 picks the 8% tier over a 16% tier on release", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const boat16 = invasionBoat("boat:93699:16", "weakling", "Weakling", 16);
  const boat25 = invasionBoat("boat:93699:25", "weakling", "Weakling", 25);
  const selected = choose(
    [upgrade, boat16, boat25, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory(),
  );
  assert.equal(selected.id, boat8.id);
});

test("ug1 needs a dense share history, not a sparse one", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const history = upgradeLockHistory().map((entry, i) =>
    i < 3 ? { ...entry, tileShare: undefined } : entry // only 5 finite shares
  );
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 needs a full-length history window", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boat8 = invasionBoat("boat:93699:8", "weakling", "Weakling", 8);
  const selected = choose(
    [upgrade, boat8],
    observation({
      tileShare: 0.05,
      troopRatio: 0.9,
      spawnTile: WORLD_SPAWN_TILE,
      rivals: [
        { id: "weakling", name: "Weakling", tileShare: 0.03, relativeTroopRatio: 1.4, sharesBorder: false },
      ],
    }),
    null,
    upgradeLockHistory({ length: 6, upgrades: 4 }),
  );
  assert.equal(selected.id, upgrade.id);
});

test("ug1 refuses a forced release against a pact partner", () => {
  const upgrade = action("upgrade:city:next", "upgrade_structure", "Upgrade City");
  const boatPartner = invasionBoat("boat:93699:8", "partner", "Partner", 8);
  const obs = {
    ...pactObservation(),
    ownState: {
      tileShare: 0.05, troopRatio: 0.9, troops: 500000, gold: 250000,
      borderTiles: 100, incomingAttacks: [], playerID: "odin",
      spawnTile: WORLD_SPAWN_TILE,
    },
    visiblePlayers: [{
      isAlive: true, sharesBorder: false, canAttack: true, isAllied: false,
      id: "partner", name: "Partner", tileShare: 0.03, relativeTroopRatio: 1.4,
    }],
  };
  const selected = choose([upgrade, boatPartner], obs, null, upgradeLockHistory());
  assert.equal(selected.id, upgrade.id);
  assert.equal(selected.policyMarker, undefined);
});
