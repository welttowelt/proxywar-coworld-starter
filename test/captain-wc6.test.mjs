import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction,
  chooseCaptainUnderpantsRuntimeAction,
  inferMapFingerprint,
  recordDecision,
} from "../strategy-engine.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id) {
  return { id, kind, label, risk: lowRisk };
}

function spawnAction({ tile, x, y, height }) {
  const centerY = (height - 1) / 2;
  const diplomacyScore = 1 - Math.abs(y - centerY) / centerY;
  return {
    ...action(`spawn:${tile}`, "spawn", `Spawn at tile ${tile}`),
    metadata: { tile, x, y, diplomacyScore },
  };
}

function spawnGeometryActions({ width, height }) {
  return [
    { x: Math.min(width - 1, 1500), y: 100 },
    { x: Math.min(width - 1, 508), y: 241 },
    { x: Math.min(width - 1, 300), y: Math.min(height - 1, 700) },
  ].map(({ x, y }) => spawnAction({
    tile: y * width + x,
    x,
    y,
    height,
  }));
}

function fixture({
  spawnTile = 1088580,
  ratio = 1.1,
  currentPressure = false,
  recentPressure = false,
  priorConflictKind = null,
  historyLength = 6,
  ownTileShare = 0.03,
  targetTileShare = 0.1,
  includeNeutralLand = false,
} = {}) {
  const rivalAttack = {
    ...action("attack:rival:10", "attack", "Attack Rival 10%"),
    metadata: {
      targetID: "rival",
      targetName: "Rival",
      troopPercent: 10,
      incomingAttack: currentPressure,
    },
  };
  const neutralBoat = {
    ...action("boat:terra-nullius:8", "boat", "Boat to Terra Nullius 8%"),
    metadata: {
      targetID: null,
      targetName: "Terra Nullius",
      troopPercent: 8,
      expansion: true,
    },
  };
  const neutralLand = {
    ...action("expand:terra-nullius:35", "attack", "Expand into Terra Nullius 35%"),
    metadata: {
      targetID: null,
      targetName: "Terra Nullius",
      troopPercent: 35,
      expansion: true,
    },
  };
  const city = {
    ...action("build:city:1", "build", "Build City"),
    metadata: { unit: "City" },
  };
  const history = Array.from({ length: historyLength }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: Math.min(0.005 + index * 0.004, 0.03),
    incomingAttackerIDs: recentPressure && index === 0 ? ["rival"] : [],
    allProtocolAttackerIDs: recentPressure && index === 0 ? ["rival"] : [],
    incomingAttackerNames: recentPressure && index === 0 ? ["Rival"] : [],
  }));
  if (priorConflictKind && history.length > 0) {
    history[history.length - 1] = {
      ...history[history.length - 1],
      actionID: `${priorConflictKind}:rival:10`,
      kind: priorConflictKind,
      neutral: false,
      targetID: "rival",
      targetName: "Rival",
    };
  }
  const actions = [
    rivalAttack,
    ...(includeNeutralLand ? [neutralLand] : []),
    neutralBoat,
    city,
  ];
  const observation = {
    phase: "active",
    ownState: {
      tileShare: ownTileShare,
      troopRatio: 0.9,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: currentPressure ? [{ attackerID: "rival" }] : [],
      spawnTile,
    },
    combat: {
      incomingAttackPlayerIDs: currentPressure ? ["rival"] : [],
    },
    visiblePlayers: [{
      id: "rival",
      name: "Rival",
      tileShare: targetTileShare,
      relativeTroopRatio: ratio,
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    }],
  };
  const state = buildState(observation, actions, history);
  return { actions, state, history, rivalAttack, neutralBoat, neutralLand };
}

function parent(f) {
  return chooseAction(f.actions, f.state, null, f.history);
}

function candidate(f) {
  return chooseCaptainUnderpantsRuntimeAction(f.actions, f.state, null, f.history);
}

test("WC6 red: public spawn geometry identifies supported map families", () => {
  assert.equal(
    inferMapFingerprint({}, [], spawnGeometryActions({ width: 2000, height: 1000 })),
    "World",
  );
  assert.equal(
    inferMapFingerprint({}, [], spawnGeometryActions({ width: 2000, height: 1200 })),
    "Asia",
  );
  assert.equal(
    inferMapFingerprint({}, [], spawnGeometryActions({ width: 1000, height: 1000 })),
    "Pangaea",
  );
});

test("WC6 red: spawn geometry is cached and routes an unlisted World spawn", () => {
  const spawnActions = spawnGeometryActions({ width: 2000, height: 1000 });
  const spawnState = buildState(
    { phase: "spawn", ownState: null, visiblePlayers: [] },
    spawnActions,
    [],
  );
  const history = [];
  recordDecision(history, spawnActions[1], spawnState);
  assert.equal(history[0].mapFingerprint, "World");

  const f = fixture({
    spawnTile: 483508,
    historyLength: 24,
    ownTileShare: 0.14,
    targetTileShare: 0.2,
    includeNeutralLand: true,
  });
  f.history.splice(0, 1, history[0]);
  f.history[f.history.length - 2] = {
    actionID: "build:city:prior",
    kind: "build",
    neutral: false,
    tileShare: 0.14,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
    incomingAttackerNames: [],
    mapFingerprint: "World",
    worldRouteV2: false,
  };
  f.state = buildState({
    phase: "active",
    ownState: {
      tileShare: 0.14,
      troopRatio: 0.9,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: [],
      spawnTile: 483508,
    },
    combat: { incomingAttackPlayerIDs: [] },
    visiblePlayers: [{
      id: "rival",
      name: "Rival",
      tileShare: 0.2,
      relativeTroopRatio: 1.1,
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    }],
  }, f.actions, f.history);
  assert.equal(f.state.mapFingerprint, "World");
  assert.equal(candidate(f).id, f.neutralLand.id);
  assert.equal(candidate(f).policyMarker, "wc6");
});

test("WC6 red: incomplete or contradictory spawn geometry fails closed", () => {
  assert.equal(
    inferMapFingerprint({}, [], [
      spawnAction({ tile: 483508, x: 1508, y: 241, height: 1000 }),
    ]),
    null,
  );
  assert.equal(
    inferMapFingerprint({}, [], [
      spawnAction({ tile: 483508, x: 1508, y: 241, height: 1000 }),
      spawnAction({ tile: 311658, x: 658, y: 311, height: 1000 }),
      spawnAction({ tile: 1420300, x: 300, y: 710, height: 1200 }),
    ]),
    null,
  );
});

test("WC6 preserves exact WC5 behavior inside the legacy opening horizon", () => {
  const f = fixture();
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.equal(candidate(f).id, f.neutralBoat.id);
  assert.equal(candidate(f).policyMarker, "wc5");
});

test("WC6 preserves current and recent retaliation byte-for-byte", () => {
  for (const f of [
    fixture({ currentPressure: true }),
    fixture({ recentPressure: true }),
  ]) {
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC6 applies only before any recorded player conflict", () => {
  for (const priorConflictKind of ["attack", "boat"]) {
    const f = fixture({ priorConflictKind });
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC6 preserves a marginal attack against a territorially smaller rival", () => {
  const f = fixture({ ownTileShare: 0.03, targetTileShare: 0.02, ratio: 1.16 });
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.deepEqual(candidate(f), parent(f));
});

test("WC6 preserves strong conversions and non-World openings", () => {
  for (const f of [
    fixture({ ratio: 1.3 }),
    fixture({ spawnTile: 659528 }),
    fixture({ spawnTile: 1180588 }),
  ]) {
    assert.deepEqual(candidate(f), parent(f));
  }
});

test("WC6 preserves exact v2 after the old horizon for a smaller target", () => {
  const f = fixture({
    historyLength: 20,
    ownTileShare: 0.14,
    targetTileShare: 0.1,
  });
  assert.deepEqual(candidate(f), parent(f));
});

test("WC6 red: current 12-player World spawn reaches neutral land after the old horizon", () => {
  const f = fixture({
    spawnTile: 373314,
    historyLength: 24,
    ownTileShare: 0.14,
    targetTileShare: 0.2,
    includeNeutralLand: true,
  });
  f.history[f.history.length - 2] = {
    actionID: "build:city:prior",
    kind: "build",
    neutral: false,
    tileShare: 0.14,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
    incomingAttackerNames: [],
  };
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.equal(candidate(f).id, f.neutralLand.id);
  assert.equal(candidate(f).policyMarker, "wc6");
});

test("WC6 red: a legacy World route emits wc6 only after the WC5 horizon", () => {
  const f = fixture({
    spawnTile: 1088580,
    historyLength: 24,
    ownTileShare: 0.14,
    targetTileShare: 0.2,
    includeNeutralLand: true,
  });
  f.history[f.history.length - 2] = {
    actionID: "build:city:prior",
    kind: "build",
    neutral: false,
    tileShare: 0.14,
    incomingAttackerIDs: [],
    allProtocolAttackerIDs: [],
    incomingAttackerNames: [],
  };
  assert.equal(parent(f).id, f.rivalAttack.id);
  assert.equal(candidate(f).id, f.neutralLand.id);
  assert.equal(candidate(f).policyMarker, "wc6");
});

test("WC6 red: pressure and smaller-target conversions remain exact v2", () => {
  for (const f of [
    fixture({
      spawnTile: 373314,
      historyLength: 24,
      ownTileShare: 0.14,
      targetTileShare: 0.2,
      includeNeutralLand: true,
      currentPressure: true,
    }),
    fixture({
      spawnTile: 373314,
      historyLength: 24,
      ownTileShare: 0.14,
      targetTileShare: 0.1,
      includeNeutralLand: true,
    }),
  ]) {
    assert.deepEqual(candidate(f), parent(f));
  }
});
