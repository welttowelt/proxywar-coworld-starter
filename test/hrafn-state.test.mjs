import assert from "node:assert/strict";
import test from "node:test";

import {
  K1Z_MEMBERS,
  actionPercent,
  buildHrafnChassisState,
  buildUnit,
  canonicalizeHrafnName,
  coalitionMemberForRival,
  createHrafnPersistentState,
  hasLeadingK1ZTag,
  hasStrictK1ZEndgameProof,
  isNeutralAction,
  resolveHrafnActionTarget,
} from "../hrafn-state.mjs";
import {
  action,
  attack,
  build,
  hold,
  neutralBoat,
  observation,
  rival,
} from "./helpers/hrafn-fixtures.mjs";

test("canonical K1Z variants collapse to the same identity", () => {
  for (const value of [
    "[K1Z] JURYOKU-KOKU",
    "K1Z juryoku_koku",
    "k1z.juryoku...koku",
    "  K1Z   juryoku koku  ",
  ]) {
    assert.equal(canonicalizeHrafnName(value), "juryoku koku");
  }
});

test("raw K1Z tags stay distinguishable from canonical names", () => {
  assert.equal(hasLeadingK1ZTag("[K1Z] odin free"), true);
  assert.equal(hasLeadingK1ZTag("K1Z odin free"), true);
  assert.equal(hasLeadingK1ZTag("odin free"), false);
});

test("action percentages parse metadata before action IDs", () => {
  assert.equal(
    actionPercent(action("attack:foe:25", "attack", "Attack", {
      troopPercent: 10,
    })),
    10,
  );
  assert.equal(actionPercent(action("attack:foe:40", "attack")), 40);
  assert.equal(actionPercent(action("build:City", "build")), null);
});

test("neutral land and boat actions are classified structurally", () => {
  assert.equal(
    isNeutralAction(action(
      "expand:terra-nullius:35",
      "attack",
      "Expansion",
      { expansion: true, troopPercent: 35 },
    )),
    true,
  );
  assert.equal(isNeutralAction(neutralBoat(123, 16)), true);
  assert.equal(
    isNeutralAction(action(
      "boat:foe:25",
      "boat",
      "Invade Foe",
      { targetID: "foe", invasion: true, troopPercent: 25 },
    )),
    false,
  );
  assert.equal(
    isNeutralAction(action(
      "expand:terra-nullius:35",
      "attack",
      "Expand Terra Nullius 35%",
      {
        targetID: null,
        targetName: "Terra Nullius",
        expansion: true,
        invasion: false,
        troopPercent: 35,
      },
    )),
    true,
  );
  assert.equal(
    isNeutralAction(action(
      "attack:match-odin:35",
      "attack",
      "Attack hidden target",
      { invasion: false, troopPercent: 35 },
    )),
    false,
  );
  assert.equal(
    isNeutralAction(action(
      "boat:odin:16",
      "boat",
      "Boat to Odin 16%",
      {
        targetID: "odin",
        expansion: true,
        invasion: false,
        troopPercent: 16,
      },
    )),
    false,
  );
});

test("build units normalize current Coworld labels and metadata", () => {
  assert.equal(buildUnit(build("City")), "city");
  assert.equal(buildUnit(build("Factory")), "factory");
  assert.equal(
    buildUnit(action("build:SAM Launcher:2", "build", "Build SAM Launcher")),
    "sam launcher",
  );
  assert.equal(buildUnit(hold()), null);
});

test("state parser preserves reserve, liveness, attackers, and structures", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const state = buildHrafnChassisState(
    observation({
      tileShare: 0.21,
      troopRatio: 0.74,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["attacker"],
      rivals: [attacker],
      unitCounts: { City: 1, "SAM Launcher": 2 },
      alivePlayerCount: 2,
      turnNumber: 2300,
    }),
    [attack(attacker, 10), hold()],
  );
  assert.equal(state.turn, 2300);
  assert.equal(state.own.tileShare, 0.21);
  assert.equal(state.own.troopRatio, 0.74);
  assert.deepEqual(state.own.unitCounts, {
    city: 1,
    "sam launcher": 2,
  });
  assert.deepEqual(state.incomingAttackerIDs, ["attacker"]);
  assert.equal(state.incomingCount, 1);
  assert.equal(state.livenessComplete, true);
  assert.equal(state.actionGeneration, "attack:attacker:10\u001fhold");
});

test("unknown liveness stays visible and fails completeness", () => {
  const unknown = rival({ id: "unknown", name: "Unknown" });
  delete unknown.isAlive;
  const state = buildHrafnChassisState(
    observation({
      rivals: [unknown],
      alivePlayerCount: 2,
    }),
    [hold()],
  );
  assert.equal(state.livenessComplete, false);
  assert.equal(state.confirmedAliveRivals.length, 0);
  assert.equal(state.rivals.length, 1);
});

test("malformed visible-player rows fail liveness completeness", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const state = buildHrafnChassisState(
    observation({
      rivals: [odin, null],
      alivePlayerCount: 2,
    }),
    [hold()],
  );
  assert.equal(state.visiblePlayers.length, 1);
  assert.equal(state.livenessComplete, false);
  assert.equal(hasStrictK1ZEndgameProof(state), false);
});

test("ID-encoded attack targets resolve without target metadata", () => {
  const odin = rival({ id: "match-odin", name: "K1Z odin free" });
  const state = buildHrafnChassisState(
    observation({ rivals: [odin] }),
    [],
  );
  const resolved = resolveHrafnActionTarget(
    action(
      "attack:match-odin:35",
      "attack",
      "Opaque attack",
      { invasion: false, troopPercent: 35 },
    ),
    state,
  );
  assert.equal(resolved.rival?.id, odin.id);
  assert.equal(resolved.ambiguous, false);
});

test("action targets resolve by exact metadata ID", () => {
  const foe = rival({ id: "runtime-foe", name: "Renamed" });
  const state = buildHrafnChassisState(
    observation({ rivals: [foe] }),
    [],
  );
  const resolved = resolveHrafnActionTarget(
    action("attack:runtime-foe:25", "attack", "Attack", {
      targetID: foe.id,
      troopPercent: 25,
    }),
    state,
  );
  assert.equal(resolved.rival?.id, foe.id);
  assert.equal(resolved.ambiguous, false);
});

test("action targets resolve by canonical display name", () => {
  const odin = rival({
    id: "match-odin",
    name: "[K1Z] Odin-Free",
  });
  const state = buildHrafnChassisState(
    observation({ rivals: [odin] }),
    [],
  );
  const resolved = resolveHrafnActionTarget(
    action(`alliance:${odin.id}`, "alliance_request", "Alliance K1Z odin free", {
      recipientName: "K1Z odin free",
    }),
    state,
  );
  assert.equal(resolved.rival?.id, odin.id);
});

test("ambiguous name matches fail target resolution", () => {
  const first = rival({ id: "first", name: "Twin" });
  const second = rival({ id: "second", name: "Twin" });
  const state = buildHrafnChassisState(
    observation({ rivals: [first, second] }),
    [],
  );
  const resolved = resolveHrafnActionTarget(
    action("attack:twin:25", "attack", "Attack Twin", {
      targetName: "Twin",
      troopPercent: 25,
    }),
    state,
  );
  assert.equal(resolved.rival, null);
  assert.equal(resolved.ambiguous, true);
});

test("exact configured player ID protects a renamed K1Z member", () => {
  const member = coalitionMemberForRival({
    id: K1Z_MEMBERS[0].id,
    name: "unknown new display",
    canonicalName: "unknown new display",
  });
  assert.equal(member?.role, "king");
});

test("strict K1Z endgame proof accepts a complete tagged survivor set", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const katanasan = rival({
    id: "match-katana",
    name: "[K1Z] katanasan",
    isAllied: true,
  });
  const state = buildHrafnChassisState(
    observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 3,
      rivals: [odin, katanasan],
    }),
    [hold()],
  );
  assert.equal(hasStrictK1ZEndgameProof(state), true);
});

test("strict K1Z endgame proof rejects every incomplete boundary", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const katanasan = rival({
    id: "match-katana",
    name: "K1Z katanasan",
    isAllied: true,
  });
  const outsider = rival({ id: "outsider", name: "Outsider" });
  const cases = [
    ["wrong mode", { gameMode: "Team", phase: "active", alivePlayerCount: 2, rivals: [odin] }],
    ["wrong phase", { gameMode: "FFA", phase: "spawn", alivePlayerCount: 2, rivals: [odin] }],
    ["missing count", { gameMode: "FFA", phase: "active", rivals: [odin] }],
    ["count mismatch", { gameMode: "FFA", phase: "active", alivePlayerCount: 3, rivals: [odin] }],
    ["outsider alive", { gameMode: "FFA", phase: "active", alivePlayerCount: 3, rivals: [odin, outsider] }],
    ["Odin absent", { gameMode: "FFA", phase: "active", alivePlayerCount: 2, rivals: [katanasan] }],
    ["raw tag absent", {
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 2,
      rivals: [{ ...odin, name: "odin free" }],
    }],
    ["duplicate name", {
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 3,
      rivals: [odin, { ...odin, id: "odin-copy" }],
    }],
    ["unknown liveness", {
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 2,
      rivals: [{ ...odin, isAlive: undefined }],
    }],
  ];

  for (const [label, input] of cases) {
    const state = buildHrafnChassisState(observation(input), [hold()]);
    assert.equal(hasStrictK1ZEndgameProof(state), false, label);
  }
});

test("strict K1Z endgame proof rejects duplicate runtime IDs", () => {
  const odin = rival({
    id: "same-runtime-id",
    name: "K1Z odin free",
    isAllied: true,
  });
  const katanasan = rival({
    id: "same-runtime-id",
    name: "K1Z katanasan",
    isAllied: true,
  });
  const state = buildHrafnChassisState(
    observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 3,
      rivals: [odin, katanasan],
    }),
    [hold()],
  );
  assert.equal(hasStrictK1ZEndgameProof(state), false);
});

test("persistent state creation clones mutable nested arrays", () => {
  const source = {
    selectedStructures: ["city"],
    lastEvidenceMarkers: ["hpri"],
    recent: [{ actionID: "one" }],
    requestCache: [{ requestID: "request-1" }],
    naval: { attempts: 2 },
  };
  const state = createHrafnPersistentState(source);
  state.selectedStructures.push("factory");
  state.lastEvidenceMarkers.push("hint");
  state.recent.push({ actionID: "two" });
  state.requestCache.push({ requestID: "request-2" });
  state.naval.attempts = 3;
  assert.deepEqual(source.selectedStructures, ["city"]);
  assert.deepEqual(source.lastEvidenceMarkers, ["hpri"]);
  assert.equal(source.recent.length, 1);
  assert.equal(source.requestCache.length, 1);
  assert.equal(source.naval.attempts, 2);
});
