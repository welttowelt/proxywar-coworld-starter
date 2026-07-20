import assert from "node:assert/strict";
import test from "node:test";

import {
  buildState,
  chooseAction as chooseSelectorAction,
} from "../strategy-engine.mjs";
import {
  chooseChassisAction,
  chooseOdinChassisAction,
} from "../strategy-chassis.mjs";

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

function chooseOdin(actions, obs, plan = null, history = []) {
  const state = buildState(obs, actions, history);
  return chooseOdinChassisAction(actions, state, plan, history);
}

function chooseParent(actions, obs, plan = null, history = []) {
  const state = buildState(obs, actions, history);
  return chooseSelectorAction(actions, state, plan, history);
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

test("chassis delegates World to the proven mx3 route", () => {
  const selected = choose(
    neutralActions(),
    observation({ tileShare: 0.08, troopRatio: 0.9, spawnTile: 1088580 }),
    null,
    [],
  );
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, undefined);
});

test("chassis delegates unknown maps to the proven mx3 route", () => {
  const selected = choose(
    neutralActions(),
    observation({ tileShare: 0.08, troopRatio: 0.9, spawnTile: 42 }),
    null,
    [],
  );
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, undefined);
});

test("ODC1 accepts a proven incoming K1Z handshake before routine growth", () => {
  const request = {
    ...action("alliance:kata", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan", relation: 2 },
  };
  const reject = {
    ...action("alliance-reject:kata", "alliance_reject", "Reject K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan" },
  };
  const selected = chooseOdin(
    [...neutralActions(), request, reject],
    observation({
      tileShare: 0.04,
      rivals: [{
        id: "kata",
        name: "K1Z katanasan",
        tileShare: 0.08,
        relativeTroopRatio: 1,
      }],
    }),
  );
  assert.equal(selected.id, request.id);
  assert.equal(selected.policyMarker, "kp2");
});

test("ODC1 accepts a proven reverse K1Z handshake despite a recent request", () => {
  const request = {
    ...action("alliance:kata", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan", relation: 2 },
  };
  const reject = {
    ...action("alliance-reject:kata", "alliance_reject", "Reject K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan" },
  };
  const history = [{
    actionID: request.id,
    kind: "alliance_request",
    targetID: "kata",
    targetName: "K1Z katanasan",
    tileShare: 0.04,
  }];
  const obs = observation({
    tileShare: 0.04,
    rivals: [{
      id: "kata",
      name: "K1Z katanasan",
      tileShare: 0.08,
      relativeTroopRatio: 1,
    }],
  });
  const actions = [...neutralActions(), request, reject];
  const selected = chooseOdin(actions, obs, null, history);
  assert.equal(selected.id, request.id);
  assert.equal(selected.policyMarker, "kp2");
  assert.equal(chooseParent(actions, obs, null, history).id, "expand:terra-nullius:10");
});

test("ODC1 defers a routine K1Z request while neutral growth is legal", () => {
  const request = {
    ...action("alliance:kata", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan", relation: 2 },
  };
  const selected = chooseOdin(
    [...neutralActions(), request],
    observation({
      tileShare: 0.04,
      rivals: [{
        id: "kata",
        name: "K1Z katanasan",
        tileShare: 0.08,
        relativeTroopRatio: 1,
      }],
    }),
  );
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "odg10");
});

test("ODC1 has causal action deltas from exact v89 on identical fixtures", () => {
  const request = {
    ...action("alliance:kata", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan", relation: 2 },
  };
  const obs = observation({
    tileShare: 0.04,
    rivals: [{
      id: "kata",
      name: "K1Z katanasan",
      tileShare: 0.08,
      relativeTroopRatio: 1,
    }],
  });
  const actions = [...neutralActions(), request];
  assert.equal(chooseParent(actions, obs).id, request.id);
  assert.equal(chooseOdin(actions, obs).id, "expand:terra-nullius:10");

  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.03 + index * 0.01,
  }));
  const city = action("build:City:1", "build", "Build City");
  const economyActions = [...neutralActions(), city];
  const economyObs = observation({ tileShare: 0.08 });
  assert.equal(chooseParent(economyActions, economyObs, null, history).id, "expand:terra-nullius:35");
  assert.equal(chooseOdin(economyActions, economyObs, null, history).id, city.id);
});

test("ODC1 inserts the first City after four productive neutral conquests", () => {
  const history = Array.from({ length: 4 }, (_, index) => ({
    actionID: `expand:terra-nullius:${index}`,
    kind: "attack",
    neutral: true,
    tileShare: 0.03 + index * 0.01,
  }));
  const city = action("build:City:1", "build", "Build City");
  const selected = chooseOdin(
    [...neutralActions(), city],
    observation({ tileShare: 0.08 }),
    null,
    history,
  );
  assert.equal(selected.id, city.id);
  assert.equal(selected.policyMarker, "odec1");
});

test("ODC1 inserts the first Factory after six productive neutral conquests", () => {
  const history = [
    ...Array.from({ length: 4 }, (_, index) => ({
      actionID: `expand:terra-nullius:${index}`,
      kind: "attack",
      neutral: true,
      tileShare: 0.03 + index * 0.01,
    })),
    { actionID: "build:City:1", kind: "build", tileShare: 0.07 },
    { actionID: "expand:terra-nullius:4", kind: "attack", neutral: true, tileShare: 0.07 },
    { actionID: "expand:terra-nullius:5", kind: "attack", neutral: true, tileShare: 0.08 },
  ];
  const factory = action("build:Factory:1", "build", "Build Factory");
  const selected = chooseOdin(
    [...neutralActions(), factory],
    observation({ tileShare: 0.09 }),
    null,
    history,
  );
  assert.equal(selected.id, factory.id);
  assert.equal(selected.policyMarker, "odec2");
});

test("ODC1 uses ten-percent pressure below the war ratio floor", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:rival:${percent}`, "attack", `Attack Rival ${percent}%`));
  const selected = chooseOdin(
    attacks,
    observation({
      tileShare: 0.15,
      rivals: [{
        id: "rival",
        name: "Rival",
        tileShare: 0.2,
        relativeTroopRatio: 0.9,
      }],
    }),
  );
  assert.equal(selected.id, "attack:rival:10");
  assert.equal(selected.policyMarker, "odc10");
});

test("ODC1 attributes a current attacker consistently on every map", () => {
  for (const [map, spawnTile] of [
    ["Asia", 1180588],
    ["World", 1088580],
    ["Pangaea", 659528],
  ]) {
    const attacks = [10, 25].map((percent) =>
      action(`attack:raider:${percent}`, "attack", `Attack Raider ${percent}%`));
    const history = [{
      actionID: "alliance:raider",
      kind: "alliance_request",
      targetID: "raider",
      targetName: "Raider",
      tileShare: 0.08,
      mapFingerprint: map,
    }];
    const selected = chooseOdin(
      [...neutralActions(), ...attacks],
      observation({
        tileShare: 0.08,
        spawnTile,
        incomingAttackPlayerIDs: ["raider"],
        rivals: [{
          id: "raider",
          name: "Raider",
          tileShare: 0.2,
          relativeTroopRatio: 0.9,
        }],
      }),
      null,
      history,
    );
    assert.equal(selected.id, "attack:raider:10", map);
  }
});

test("ODC1 never attacks a confirmed ally on a stale incoming ID", () => {
  const attacks = [10, 40].map((percent) =>
    action(`attack:hrafn:${percent}`, "attack", `Attack K1Z Hrafn ${percent}%`));
  const selected = chooseOdin(
    [...neutralActions(), ...attacks],
    observation({
      tileShare: 0.08,
      incomingAttackPlayerIDs: ["hrafn"],
      rivals: [{
        id: "hrafn",
        name: "K1Z Hrafn",
        tileShare: 0.04,
        relativeTroopRatio: 2,
        isAllied: true,
      }],
    }),
  );
  assert.equal(selected.id, "expand:terra-nullius:10");
});

test("ODC1 never retaliates against a non-allied K1Z current attacker", () => {
  const hrafnID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
  const hrafn = [10, 25, 40].map((percent) => ({
    ...action(`attack:hrafn:${percent}`, "attack", `Attack K1Z Hrafn ${percent}%`),
    metadata: { targetID: hrafnID, targetName: "K1Z Hrafn" },
  }));
  const outsider = [10, 25, 40].map((percent) =>
    action(`attack:outsider:${percent}`, "attack", `Attack Outsider ${percent}%`));
  const selected = chooseOdin(
    [...hrafn, ...outsider],
    observation({
      tileShare: 0.15,
      incomingAttackPlayerIDs: [hrafnID],
      rivals: [
        {
          id: hrafnID,
          name: "K1Z Hrafn",
          tileShare: 0.2,
          relativeTroopRatio: 2,
        },
        {
          id: "outsider",
          name: "Outsider",
          tileShare: 0.15,
          relativeTroopRatio: 1.3,
        },
      ],
    }),
  );
  assert.equal(selected.id, "attack:outsider:25");
  assert.equal(selected.policyMarker, "odc25");
});

test("ODC1 never infers a K1Z-only endgame from visible territory", () => {
  const hrafnID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
  const allianceBreak = {
    ...action("break:hrafn", "break_alliance", "Break alliance with K1Z Hrafn"),
    metadata: { targetID: hrafnID, targetName: "K1Z Hrafn" },
  };
  const selected = chooseOdin(
    [allianceBreak, action("hold", "hold", "Hold")],
    observation({
      tileShare: 0.6,
      rivals: [{
        id: hrafnID,
        name: "K1Z Hrafn",
        tileShare: 0.4,
        relativeTroopRatio: 1.5,
        isAllied: true,
      }],
    }),
  );
  assert.equal(selected.id, "hold");
});

test("ODC1 fails closed when only K1Z attacks are offered without hold", () => {
  const hrafnID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
  const attacks = [10, 25, 40].map((percent) => ({
    ...action(`attack:hrafn:${percent}`, "attack", `Attack K1Z Hrafn ${percent}%`),
    metadata: { targetID: hrafnID, targetName: "K1Z Hrafn" },
  }));
  assert.throws(
    () => chooseOdin(
      attacks,
      observation({
        tileShare: 0.6,
        rivals: [{
          id: hrafnID,
          name: "K1Z Hrafn",
          tileShare: 0.4,
          relativeTroopRatio: 1.5,
        }],
      }),
    ),
    /no admissible legal action/,
  );
});

test("ODC1 does not infer a K1Z-only endgame from partial visibility", () => {
  const hrafnID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
  const attacks = [10, 25, 40].map((percent) => ({
    ...action(`attack:hrafn:${percent}`, "attack", `Attack K1Z Hrafn ${percent}%`),
    metadata: { targetID: hrafnID, targetName: "K1Z Hrafn" },
  }));
  const selected = chooseOdin(
    [...neutralActions(), ...attacks],
    observation({
      tileShare: 0.2,
      rivals: [{
        id: hrafnID,
        name: "K1Z Hrafn",
        tileShare: 0.2,
        relativeTroopRatio: 2,
      }],
    }),
  );
  assert.equal(selected.id, "expand:terra-nullius:10");
  assert.equal(selected.policyMarker, "odg10");
});

test("ODC1 rival choice is independent of planner advice", () => {
  const attacks = ["alpha", "beta"].flatMap((name) => [10, 25].map((percent) =>
    action(`attack:${name}:${percent}`, "attack", `Attack ${name} ${percent}%`)));
  const obs = observation({
    tileShare: 0.15,
    rivals: [
      { id: "alpha", name: "alpha", tileShare: 0.15, relativeTroopRatio: 1.3 },
      { id: "beta", name: "beta", tileShare: 0.15, relativeTroopRatio: 1.3 },
    ],
  });
  assert.equal(
    chooseOdin(attacks, obs).id,
    chooseOdin(attacks, obs, { target: "beta", focus: "attack" }).id,
  );
});

test("ODC1 does not pressure a weaker rival while Odin already leads", () => {
  const attacks = [10, 25, 40].map((percent) =>
    action(`attack:rival:${percent}`, "attack", `Attack Rival ${percent}%`));
  const hold = action("hold", "hold", "Hold");
  const selected = chooseOdin(
    [...attacks, hold],
    observation({
      tileShare: 0.7,
      rivals: [{
        id: "rival",
        name: "Rival",
        tileShare: 0.2,
        relativeTroopRatio: 0.9,
      }],
    }),
  );
  assert.equal(selected.id, hold.id);
  assert.equal(selected.policyMarker, "odguard");
});

test("ODC1 lets a newly finishable rival replace an older mediocre target", () => {
  const older = [10, 25, 40].map((percent) =>
    action(`attack:older:${percent}`, "attack", `Attack Older ${percent}%`));
  const finish = [10, 25, 40].map((percent) =>
    action(`attack:finish:${percent}`, "attack", `Attack Finish ${percent}%`));
  const history = [{
    actionID: "attack:older:25",
    kind: "attack",
    targetName: "older",
    tileShare: 0.15,
  }];
  const selected = chooseOdin(
    [...older, ...finish],
    observation({
      tileShare: 0.15,
      rivals: [
        { id: "older", name: "Older", tileShare: 0.2, relativeTroopRatio: 1.25 },
        { id: "finish", name: "Finish", tileShare: 0.04, relativeTroopRatio: 1.7 },
      ],
    }),
    null,
    history,
  );
  assert.equal(selected.id, "attack:finish:40");
  assert.equal(selected.policyMarker, "odc40");
});

test("ODC1 permits a third naval move when the prior two gained territory", () => {
  const history = [
    { actionID: "boat:terra:8", kind: "boat", neutral: true, tileShare: 0.04 },
    { actionID: "boat:terra:16", kind: "boat", neutral: true, tileShare: 0.06 },
  ];
  const boat = action("boat:terra:16", "boat", "Boat to Terra Nullius 16%");
  const city = action("build:City:1", "build", "Build City");
  const selected = chooseOdin(
    [boat, city],
    observation({ tileShare: 0.08 }),
    null,
    history,
  );
  assert.equal(selected.id, boat.id);
  assert.equal(selected.policyMarker, "odn16");
});

test("ODC1 exits a flat naval loop into economy instead of holding", () => {
  const history = [
    ...Array.from({ length: 6 }, (_, index) => ({
      actionID: `boat:terra:${index}`,
      kind: "boat",
      neutral: true,
      tileShare: 0.08,
    })),
    { actionID: "emoji:1", kind: "emoji", tileShare: 0.08 },
    { actionID: "emoji:2", kind: "emoji", tileShare: 0.08 },
  ];
  const boat = action("boat:terra:16", "boat", "Boat to Terra Nullius 16%");
  const city = action("build:City:1", "build", "Build City");
  const selected = chooseOdin(
    [boat, city, action("hold", "hold", "Hold")],
    observation({ tileShare: 0.08 }),
    null,
    history,
  );
  assert.equal(selected.id, city.id);
  assert.equal(selected.policyMarker, "odncap");
});

test("ODC1 uses a production-shaped safe Atom Bomb on a runaway outsider", () => {
  const bomb = {
    ...action("nuke:atom-bomb:leader", "nuke", "Launch Atom Bomb at Leader"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "leader",
      targetName: "Leader",
      targetTileShare: 0.79,
      targetSamCoverage: 0,
    },
  };
  const city = action("build:City:1", "build", "Build City");
  const selected = chooseOdin(
    [bomb, city],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{
        id: "leader",
        name: "Leader",
        tileShare: 0.79,
        relativeTroopRatio: 0.5,
      }],
    }),
  );
  assert.equal(selected.id, bomb.id);
  assert.equal(selected.policyMarker, "nk1");
});

test("ODC1 never launches a production-shaped Atom Bomb at K1Z", () => {
  const bomb = {
    ...action("nuke:atom-bomb:hrafn", "nuke", "Launch Atom Bomb at K1Z Hrafn"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
      targetName: "K1Z Hrafn",
      targetTileShare: 0.79,
      targetSamCoverage: 0,
    },
  };
  const hold = action("hold", "hold", "Hold");
  const selected = chooseOdin(
    [bomb, hold],
    observation({
      tileShare: 0.2,
      troopRatio: 0.9,
      rivals: [{
        id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
        name: "K1Z Hrafn",
        tileShare: 0.79,
        relativeTroopRatio: 0.5,
      }],
    }),
  );
  assert.equal(selected.id, hold.id);
});

test("ODC1 does not reintroduce a SAM-covered nuke through generic utility", () => {
  const bomb = {
    ...action("nuke:atom-bomb:leader", "nuke", "Launch Atom Bomb at Leader"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "leader",
      targetName: "Leader",
      targetTileShare: 0.79,
      targetSamCoverage: 1,
    },
  };
  const hold = action("hold", "hold", "Hold");
  const obs = observation({
    tileShare: 0.2,
    rivals: [{
      id: "leader",
      name: "Leader",
      tileShare: 0.79,
      relativeTroopRatio: 0.5,
    }],
  });
  assert.equal(chooseOdin([bomb, hold], obs).id, hold.id);
  assert.equal(chooseParent([bomb, hold], obs).id, bomb.id);
});

test("ODC1 skips an uncovered Atom Bomb without a worthwhile target", () => {
  const bomb = {
    ...action("nuke:atom-bomb:minor", "nuke", "Launch Atom Bomb at Minor"),
    metadata: {
      unit: "Atom Bomb",
      targetID: "minor",
      targetName: "Minor",
      targetTileShare: 0.08,
      targetSamCoverage: 0,
    },
  };
  const hold = action("hold", "hold", "Hold");
  const selected = chooseOdin(
    [bomb, hold],
    observation({
      tileShare: 0.2,
      rivals: [{
        id: "minor",
        name: "Minor",
        tileShare: 0.08,
        relativeTroopRatio: 0.5,
      }],
    }),
  );
  assert.equal(selected.id, hold.id);
});

test("ODC1 does not confuse an ordinary City build with a rival named City", () => {
  const city = action("build:City:1", "build", "Build City");
  const selected = chooseOdin(
    [city, action("hold", "hold", "Hold")],
    observation({
      tileShare: 0.08,
      troopRatio: 0.5,
      incomingAttacks: 1,
      rivals: [{
        id: "city-rival",
        name: "City",
        tileShare: 0.2,
        relativeTroopRatio: 1,
        isAllied: true,
      }],
    }),
  );
  assert.equal(selected.id, city.id);
  assert.equal(selected.policyMarker, "odef");
});

test("ODC1 takes a legal retreat before a routine coalition request", () => {
  const request = {
    ...action("alliance:kata", "alliance_request", "Alliance with K1Z katanasan"),
    metadata: { recipientID: "kata", recipientName: "K1Z katanasan", relation: 2 },
  };
  const retreat = action("retreat:land:1", "retreat", "Retreat");
  const selected = chooseOdin(
    [request, retreat, action("hold", "hold", "Hold")],
    observation({
      tileShare: 0.1,
      rivals: [{
        id: "kata",
        name: "K1Z katanasan",
        tileShare: 0.08,
        relativeTroopRatio: 1,
      }],
    }),
  );
  assert.equal(selected.id, retreat.id);
});

test("ODC1 uses a harmless social action instead of an unexplained hold", () => {
  for (const kind of ["alliance_extend", "embargo_stop", "emoji"]) {
    const harmless = action(`${kind}:1`, kind, kind);
    const selected = chooseOdin(
      [harmless, action("hold", "hold", "Hold")],
      observation({ tileShare: 0.1 }),
    );
    assert.equal(selected.id, harmless.id, kind);
    assert.equal(selected.policyMarker, "odsafe", kind);
  }
});

test("ODC1 never emits unrestricted quick chat", () => {
  const hold = action("hold", "hold", "Hold");
  const selected = chooseOdin(
    [action("quick-chat:1", "quick_chat", "This is unrestricted public prose"), hold],
    observation({ tileShare: 0.1 }),
  );
  assert.equal(selected.id, hold.id);
  assert.equal(selected.policyMarker, undefined);
});

test("ODC1 fails closed instead of reopening quick chat without hold", () => {
  assert.throws(
    () => chooseOdin(
      [action("quick-chat:1", "quick_chat", "This is unrestricted public prose")],
      observation({ tileShare: 0.1 }),
    ),
    /no admissible legal action/,
  );
});

test("ODC1 excludes unresolved move-warship and global embargo actions", () => {
  const unresolvedMove = {
    ...action("move-warship:123", "move_warship", "Move warship"),
    metadata: { targetTile: 123, unitCount: 1 },
  };
  const globalEmbargo = action("embargo-all", "embargo_all", "Embargo everyone");
  const hold = action("hold", "hold", "Hold");
  const selected = chooseOdin(
    [unresolvedMove, globalEmbargo, hold],
    observation({ tileShare: 0.1 }),
  );
  assert.equal(selected.id, hold.id);
  assert.equal(selected.policyMarker, "odguard");
});

test("ODC1 never attacks a metadata-resolved K1Z partner", () => {
  const hidden = {
    ...action("attack:hidden:25", "attack", "Attack target 25%"),
    metadata: {
      targetID: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
      targetName: "K1Z Hrafn",
    },
  };
  const outsider = action("attack:outsider:25", "attack", "Attack Outsider 25%");
  const selected = chooseOdin(
    [hidden, outsider],
    observation({
      tileShare: 0.15,
      rivals: [
        {
          id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
          name: "K1Z Hrafn",
          tileShare: 0.2,
          relativeTroopRatio: 3,
        },
        {
          id: "outsider",
          name: "Outsider",
          tileShare: 0.15,
          relativeTroopRatio: 1.3,
        },
      ],
    }),
  );
  assert.equal(selected.id, outsider.id);
  assert.equal(selected.policyMarker, "odc25");
});
