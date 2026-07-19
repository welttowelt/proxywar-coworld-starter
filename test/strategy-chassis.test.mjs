import assert from "node:assert/strict";
import test from "node:test";

import { buildState } from "../strategy-engine.mjs";
import { chooseChassisAction } from "../strategy-chassis.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, risk = lowRisk) {
  return { id, kind, label, risk };
}

function observation({
  tileShare = 0.05,
  troopRatio = 0.8,
  troops = 500000,
  rivals = [],
  incomingAttacks = [],
  incomingAttackPlayerIDs = [],
  spawnTile = 1180588,
} = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio,
      troops,
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
  return chooseChassisAction(actions, state, plan, history);
}

function neutralActions() {
  return [
    action("expand:terra-nullius:10", "attack", "Expand into neutral land with 10% troops"),
    action("expand:terra-nullius:20", "attack", "Expand into neutral land with 20% troops"),
    action("expand:terra-nullius:35", "attack", "Expand into neutral land with 35% troops"),
  ];
}

test("chassis takes a legal spawn", () => {
  const spawn = action("spawn:100", "spawn", "Spawn 100");
  const selected = choose([spawn, action("hold", "hold", "Hold")], observation());
  assert.equal(selected.id, "spawn:100");
});

test("chassis grinds the opening at 35 percent above the troop floor", () => {
  const selected = choose(neutralActions(), observation({ tileShare: 0.08 }));
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.equal(selected.policyMarker, "ch1");
});

test("chassis falls back to the cadence below the troop floor", () => {
  const selected = choose(neutralActions(), observation({ tileShare: 0.08, troops: 50000 }));
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, undefined);
});

test("chassis never probes at 10 percent against a rival", () => {
  const probe = [10, 25, 40].map((percent) =>
    action(`attack:bystander:${percent}`, "attack", `Attack Bystander ${percent}%`));
  const selected = choose(
    probe,
    observation({
      tileShare: 0.15,
      rivals: [{ id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 1.25 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:bystander:25");
  assert.equal(selected.policyMarker, "ch2");
});

test("chassis escalates only to finish a weakening target", () => {
  const probe = [10, 25, 40].map((percent) =>
    action(`attack:bystander:${percent}`, "attack", `Attack Bystander ${percent}%`));
  const history = [1, 2].map(() => ({
    actionID: "attack:bystander:25",
    kind: "attack",
    targetName: "bystander",
    tileShare: 0.15,
  }));
  const selected = choose(
    probe,
    observation({
      tileShare: 0.15,
      rivals: [{ id: "bystander", name: "Bystander", tileShare: 0.08, relativeTroopRatio: 1.6 }],
    }),
    null,
    history,
  );
  assert.equal(selected.id, "attack:bystander:40");
});

test("chassis retaliates against a current attacker before grinding", () => {
  const aggressor = [10, 25].map((percent) =>
    action(`attack:aggressor:${percent}`, "attack", `Attack Aggressor ${percent}%`));
  const selected = choose(
    [...neutralActions(), ...aggressor],
    observation({
      tileShare: 0.08,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: ["aggressor"],
      rivals: [{ id: "aggressor", name: "Aggressor", tileShare: 0.12, relativeTroopRatio: 1.0, incomingAttack: true }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, "attack:aggressor:25");
  assert.equal(selected.policyMarker, "ch2");
});

test("chassis ignores rivals below parity without retaliation", () => {
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const build = action("build:City:1", "build", "Build City");
  const selected = choose(
    [probe, build],
    observation({
      tileShare: 0.15,
      rivals: [{ id: "bystander", name: "Bystander", tileShare: 0.12, relativeTroopRatio: 0.9 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, build.id);
});

test("chassis builds defensive economy when threatened and weak", () => {
  const defense = action("build:Defense Post:1", "build", "Build Defense Post");
  const city = action("build:City:1", "build", "Build City");
  // Defense Post stays excluded: its advertised IDs can degrade to HOLD, and
  // holds are gate-fatal. The Auri fortification pattern is deferred evidence.
  const selected = choose(
    [defense, city, ...neutralActions()],
    observation({ tileShare: 0.08, troopRatio: 0.5, incomingAttacks: 1 }),
    null,
    [],
  );
  assert.equal(selected.id, city.id);
});

test("chassis uses an alliance when no tactical action remains", () => {
  const ally = {
    ...action("alliance:bystander:1", "alliance_request", "Request alliance with Bystander"),
    metadata: { targetID: "bystander", relation: 0 },
  };
  const hold = action("hold", "hold", "Hold");
  const selected = choose(
    [ally, hold],
    observation({
      tileShare: 0.15,
      rivals: [{ id: "bystander", name: "Bystander", tileShare: 0.3, relativeTroopRatio: 0.5 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, ally.id);
});

test("chassis finishes a started target instead of switching", () => {
  const weak = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`));
  const juicy = [10, 25, 40].map((percent) =>
    action(`attack:juicy:${percent}`, "attack", `Attack Juicy ${percent}%`));
  const history = [{
    actionID: "attack:weak:25",
    kind: "attack",
    targetName: "weak",
    tileShare: 0.15,
  }];
  const selected = choose(
    [...weak, ...juicy],
    observation({
      tileShare: 0.15,
      rivals: [
        { id: "weak", name: "Weak", tileShare: 0.06, relativeTroopRatio: 1.2 },
        { id: "juicy", name: "Juicy", tileShare: 0.25, relativeTroopRatio: 1.4 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, "attack:weak:25");
});

test("chassis releases a started target that turned unfavorable", () => {
  const weak = [10, 25, 40].map((percent) =>
    action(`attack:weak:${percent}`, "attack", `Attack Weak ${percent}%`));
  const juicy = [10, 25, 40].map((percent) =>
    action(`attack:juicy:${percent}`, "attack", `Attack Juicy ${percent}%`));
  const history = [{
    actionID: "attack:weak:25",
    kind: "attack",
    targetName: "weak",
    tileShare: 0.15,
  }];
  const selected = choose(
    [...weak, ...juicy],
    observation({
      tileShare: 0.15,
      rivals: [
        { id: "weak", name: "Weak", tileShare: 0.06, relativeTroopRatio: 0.8 },
        { id: "juicy", name: "Juicy", tileShare: 0.25, relativeTroopRatio: 1.4 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, "attack:juicy:25");
});

test("chassis probes instead of holding when tactical actions remain", () => {
  const probe = action("attack:bystander:10", "attack", "Attack Bystander 10%");
  const hold = action("hold", "hold", "Hold");
  const selected = choose(
    [probe, hold],
    observation({
      tileShare: 0.15,
      rivals: [{ id: "bystander", name: "Bystander", tileShare: 0.3, relativeTroopRatio: 0.4 }],
    }),
    null,
    [],
  );
  assert.equal(selected.id, probe.id);
});

test("chassis applies the opening rewrite on World", () => {
  const selected = choose(
    neutralActions(),
    observation({ tileShare: 0.08, troopRatio: 0.9, spawnTile: 1088580 }),
    null,
    [],
  );
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.equal(selected.policyMarker, "oc1");
});

test("chassis applies the opening rewrite on unknown maps", () => {
  const selected = choose(
    neutralActions(),
    observation({ tileShare: 0.08, troopRatio: 0.9, spawnTile: 42 }),
    null,
    [],
  );
  assert.equal(selected.id, "expand:terra-nullius:35");
  assert.equal(selected.policyMarker, "oc1");
});
