import assert from "node:assert/strict";
import test from "node:test";

import { createStandardController } from "../standard-controller.mjs";

const low = { level: "low" };
const KATANASAN = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";
const MICKEY = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";

function action(id, kind, metadata = {}, label = id) {
  return { id, kind, label, metadata, risk: low };
}

function observation({ tileShare = 0.05, rivals = [], incoming = [], own = {} } = {}) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troops: 500_000,
      maxTroops: 1_000_000,
      incomingAttacks: incoming.map((attackerID) => ({ attackerID })),
      ...own,
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

function decide(controller, number, legalActions, obs = observation()) {
  return controller.decide({ requestID: `r${number}`, observation: obs, legalActions });
}

test("spawn is the deterministic first priority", () => {
  const controller = createStandardController();
  const selected = decide(controller, 0, [
    action("hold", "hold"),
    action("spawn:b", "spawn"),
    action("spawn:a", "spawn"),
  ]);
  assert.equal(selected.selectedLegalActionId, "spawn:a");
  assert.equal(selected.route, "spawn");
});

test("the first twenty active decisions stay conquest-heavy", () => {
  const controller = createStandardController();
  const actions = [
    action("alliance:kata", "alliance_request", {
      recipientID: KATANASAN,
      recipientName: "K1Z katanasan",
    }),
    action("reject:kata", "alliance_reject", {
      recipientID: KATANASAN,
      recipientName: "K1Z katanasan",
    }),
    action("expand:10", "attack", { expansion: true, troopPercent: 10 }),
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("build:city", "build", { unit: "City" }),
    action("boat:neutral:16", "boat", { expansion: true, troopPercent: 16 }),
    action("upgrade:city", "upgrade_structure", { unit: "City" }),
    action("hold", "hold"),
  ];
  const routes = [];
  const kinds = [];
  for (let index = 0; index < 20; index++) {
    const selected = decide(
      controller,
      index,
      actions,
      observation({ tileShare: 0.03 + index * 0.004 }),
    );
    routes.push(selected.route);
    kinds.push(selected.action.kind);
  }
  assert.equal(routes.filter((route) => route === "reverse_handshake").length, 1);
  assert.equal(routes.filter((route) => route === "opening_build").length, 1);
  assert.equal(kinds.filter((kind) => kind === "attack").length, 18);
  assert.equal(kinds.filter((kind) => kind === "boat").length, 0);
  assert.equal(kinds.filter((kind) => kind === "upgrade_structure").length, 0);
});

test("neutral opening selects the offered percentage closest to 35", () => {
  for (const actions of [[
    action("expand:40", "attack", { expansion: true, troopPercent: 40 }),
    action("expand:10", "attack", { expansion: true, troopPercent: 10 }),
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
  ], [
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("expand:10", "attack", { expansion: true, troopPercent: 10 }),
    action("expand:40", "attack", { expansion: true, troopPercent: 40 }),
  ]]) {
    const selected = decide(createStandardController(), 0, actions);
    assert.equal(selected.selectedLegalActionId, "expand:35");
  }
});

test("an efficient incoming counter outranks neutral opening growth", () => {
  const controller = createStandardController();
  const selected = decide(controller, 0, [
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("attack:raider:25", "attack", {
      targetID: "raider",
      targetName: "Raider",
      troopPercent: 25,
      incomingAttack: true,
    }),
  ], observation({
    incoming: ["raider"],
    rivals: [{
      id: "raider",
      name: "Raider",
      tileShare: 0.1,
      relativeTroopRatio: 1.4,
      incomingAttack: true,
    }],
  }));
  assert.equal(selected.selectedLegalActionId, "attack:raider:25");
  assert.equal(selected.route, "pressure_counter");
});

test("suicidal pressure counters yield to defense or retreat below the 1.3 floor", () => {
  const pressured = observation({
    incoming: ["raider"],
    rivals: [{
      id: "raider",
      name: "Raider",
      relativeTroopRatio: 0.2,
      incomingAttack: true,
    }],
  });
  const counter = action("attack:raider:25", "attack", {
    targetID: "raider",
    targetName: "Raider",
    troopPercent: 25,
    incomingAttack: true,
  });
  const defense = decide(createStandardController(), 0, [
    counter,
    action("build:defense-post", "build", { unit: "Defense Post" }),
    action("retreat", "retreat"),
    action("hold", "hold"),
  ], pressured);
  assert.equal(defense.selectedLegalActionId, "build:defense-post");
  assert.equal(defense.route, "pressure_defense");

  const retreat = decide(createStandardController(), 0, [
    counter,
    action("retreat", "retreat"),
    action("hold", "hold"),
  ], pressured);
  assert.equal(retreat.selectedLegalActionId, "retreat");
  assert.equal(retreat.route, "pressure_retreat");

  const credible = decide(createStandardController(), 0, [
    counter,
    action("build:defense-post", "build", { unit: "Defense Post" }),
    action("retreat", "retreat"),
    action("hold", "hold"),
  ], observation({
    incoming: ["raider"],
    rivals: [{
      id: "raider",
      name: "Raider",
      relativeTroopRatio: 1.3,
      incomingAttack: true,
    }],
  }));
  assert.equal(credible.selectedLegalActionId, counter.id);
  assert.equal(credible.route, "pressure_counter");
});

test("post-opening conversion stays on one target and escalates to 40 percent", () => {
  const controller = createStandardController();
  const neutral = [action("expand:35", "attack", { expansion: true, troopPercent: 35 })];
  for (let index = 0; index < 20; index++) {
    decide(controller, index, neutral, observation({ tileShare: 0.05 + index * 0.005 }));
  }
  const rivals = [
    { id: "weak", name: "Weak", tileShare: 0.05, relativeTroopRatio: 1.8 },
    { id: "large", name: "Large", tileShare: 0.2, relativeTroopRatio: 1.2 },
  ];
  const first = decide(controller, 20, [
    action("attack:weak:25", "attack", { targetID: "weak", targetName: "Weak", troopPercent: 25 }),
    action("attack:large:25", "attack", { targetID: "large", targetName: "Large", troopPercent: 25 }),
  ], observation({ tileShare: 0.2, rivals }));
  const second = decide(controller, 21, [
    action("attack:weak:25", "attack", { targetID: "weak", targetName: "Weak", troopPercent: 25 }),
    action("attack:weak:40", "attack", { targetID: "weak", targetName: "Weak", troopPercent: 40 }),
    action("attack:large:40", "attack", { targetID: "large", targetName: "Large", troopPercent: 40 }),
  ], observation({ tileShare: 0.22, rivals }));
  assert.equal(first.selectedLegalActionId, "attack:weak:25");
  assert.equal(second.selectedLegalActionId, "attack:weak:40");
  assert.equal(second.route, "finish");
});

test("boats require a post-opening stall or troop-cap signal", () => {
  const controller = createStandardController();
  const neutral = [action("expand:35", "attack", { expansion: true, troopPercent: 35 })];
  for (let index = 0; index < 20; index++) {
    decide(controller, index, neutral, observation({ tileShare: 0.05 + index * 0.005 }));
  }
  const actions = [
    action("boat:foe:25", "boat", { targetID: "foe", targetName: "Foe", troopPercent: 25 }),
    action("hold", "hold"),
  ];
  const selected = decide(controller, 20, actions, observation({
    tileShare: 0.15,
    own: { troops: 950_000, maxTroops: 1_000_000 },
    rivals: [{ id: "foe", name: "Foe", tileShare: 0.1, relativeTroopRatio: 1.2 }],
  }));
  assert.equal(selected.selectedLegalActionId, "boat:foe:25");
  assert.equal(selected.route, "naval_escape");
});

test("a neutral boat is valid opening growth only when neutral land is absent", () => {
  const boat = action("boat:123:16", "boat", {
    expansion: true,
    targetName: "Terra Nullius",
    troopPercent: 16,
  });
  const hold = action("hold", "hold");
  assert.equal(
    decide(createStandardController(), 1, [boat, hold]).selectedLegalActionId,
    boat.id,
  );
  const land = action("expand:35", "attack", { expansion: true, troopPercent: 35 });
  assert.equal(
    decide(createStandardController(), 2, [boat, land, hold]).selectedLegalActionId,
    land.id,
  );
});

test("five neutral growth boats unlock the first City while hostile boats do not count", () => {
  const island = createStandardController();
  const islandActions = [
    action("boat:neutral:16", "boat", { expansion: true, troopPercent: 16 }),
    action("boat:foe:25", "boat", {
      targetID: "foe",
      targetName: "Foe",
      troopPercent: 25,
    }),
    action("build:city", "build", { unit: "City" }),
    action("hold", "hold"),
  ];
  const islandObservation = observation({
    rivals: [{ id: "foe", name: "Foe", relativeTroopRatio: 2 }],
  });
  for (let index = 0; index < 5; index++) {
    const selected = decide(island, index, islandActions, islandObservation);
    assert.equal(selected.selectedLegalActionId, "boat:neutral:16");
  }
  const firstBuild = decide(island, 5, islandActions, islandObservation);
  assert.equal(firstBuild.selectedLegalActionId, "build:city");
  assert.equal(firstBuild.route, "opening_build");
  assert.equal(island.snapshot().conquestCount, 5);

  const naval = createStandardController();
  const idle = [
    action("upgrade:city", "upgrade_structure", { unit: "City" }),
    action("hold", "hold"),
  ];
  for (let index = 0; index < 20; index++) decide(naval, index, idle);
  const hostileBoat = decide(naval, 20, [
    action("boat:foe:25", "boat", {
      targetID: "foe",
      targetName: "Foe",
      troopPercent: 25,
    }),
    action("hold", "hold"),
  ], observation({
    rivals: [{ id: "foe", name: "Foe", relativeTroopRatio: 2 }],
    own: { troops: 950_000, maxTroops: 1_000_000 },
  }));
  assert.equal(hostileBoat.selectedLegalActionId, "boat:foe:25");
  assert.equal(naval.snapshot().conquestCount, 0);
});

test("optional social and upgrades run only without territorial actions", () => {
  const controller = createStandardController();
  const actions = [
    action("alliance:kata", "alliance_request", {
      recipientID: KATANASAN,
      recipientName: "K1Z katanasan",
    }),
    action("upgrade:city", "upgrade_structure", { unit: "City" }),
    action("hold", "hold"),
  ];
  assert.equal(decide(controller, 0, actions).selectedLegalActionId, "alliance:kata");
  assert.equal(decide(controller, 1, [
    ...actions,
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
  ]).selectedLegalActionId, "expand:35");
});

test("outsider alliance requests never enter the controller route", () => {
  const selected = decide(createStandardController(), 0, [
    action("alliance:foe", "alliance_request", {
      recipientID: "foe",
      recipientName: "Foe",
    }),
    action("upgrade:city", "upgrade_structure", { unit: "City" }),
    action("hold", "hold"),
  ], observation({
    rivals: [{ id: "foe", name: "Foe", tileShare: 0.2, relativeTroopRatio: 1 }],
  }));
  assert.equal(selected.selectedLegalActionId, "upgrade:city");
});

test("K1Z alliance extensions stay alive while outsider extensions are ignored", () => {
  const selected = decide(createStandardController(), 0, [
    action("extend:kata", "alliance_extend", {
      recipientID: KATANASAN,
      recipientName: "K1Z katanasan",
    }),
    action("extend:foe", "alliance_extend", {
      recipientID: "foe",
      recipientName: "Foe",
    }),
    action("hold", "hold"),
  ]);
  assert.equal(selected.selectedLegalActionId, "extend:kata");
});

test("a stranded seat can bootstrap with a safe economy build", () => {
  const selected = decide(createStandardController(), 0, [
    action("build:city", "build", { unit: "City" }),
    action("hold", "hold"),
  ]);
  assert.equal(selected.selectedLegalActionId, "build:city");
  assert.equal(selected.safety.fallbackUsed, false);
});

test("protected-only territory cannot suppress a safe idle action", () => {
  const controller = createStandardController();
  const selected = decide(controller, 1, [
    action("attack:mickey:40", "attack", {
      targetID: MICKEY,
      targetName: "K1Z Mickey Mouse",
      troopPercent: 40,
    }),
    action("alliance:outsider", "alliance_request", {
      recipientID: "outsider",
      recipientName: "Outsider",
    }),
    action("upgrade:city", "upgrade_structure", { unit: "City" }),
    action("hold", "hold"),
  ], observation({
    rivals: [{
      id: MICKEY,
      name: "K1Z Mickey Mouse",
      tileShare: 0.2,
      relativeTroopRatio: 2,
    }],
  }));
  assert.notEqual(selected.action.kind, "hold");
  assert.equal(selected.safety.fallbackUsed, false);
});

test("unfavorable attacks and premature boats cannot suppress safe idle work", () => {
  for (const blockedAction of [
    action("attack:strong:40", "attack", {
      targetID: "strong",
      targetName: "Strong",
      troopPercent: 40,
    }),
    action("boat:123:25", "boat", { troopPercent: 25 }),
  ]) {
    const controller = createStandardController();
    const selected = decide(controller, blockedAction.id, [
      blockedAction,
      action("alliance:outsider", "alliance_request", {
        recipientID: "outsider",
        recipientName: "Outsider",
      }),
      action("upgrade:city", "upgrade_structure", { unit: "City" }),
      action("hold", "hold"),
    ], observation({
      rivals: [{
        id: "strong",
        name: "Strong",
        tileShare: 0.3,
        relativeTroopRatio: 0.5,
      }],
    }));
    assert.notEqual(selected.action.kind, "hold");
    assert.equal(selected.safety.fallbackUsed, false);
  }
});

test("excluded actions never outrank an offered hold", () => {
  const selected = decide(createStandardController(), 0, [
    action("nuke:leader", "nuke", { targetID: "leader" }),
    action("build:atom", "build", { unit: "Atom Bomb", targetID: "leader" }),
    action("embargo:all", "embargo_all"),
    action("chat", "quick_chat"),
    action("donate", "donate_troops"),
    action("hold", "hold"),
  ]);
  assert.equal(selected.selectedLegalActionId, "hold");
});

test("duplicate request IDs are idempotent and mismatches do not advance state", () => {
  const controller = createStandardController();
  const originalActions = [
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("hold", "hold"),
  ];
  const first = controller.decide({
    requestID: "same",
    observation: observation(),
    legalActions: originalActions,
  });
  const duplicate = controller.decide({
    requestID: "same",
    observation: observation(),
    legalActions: [...originalActions].reverse(),
  });
  assert.equal(duplicate, first);
  assert.equal(controller.snapshot().activeDecisionCount, 1);

  const mismatch = controller.decide({
    requestID: "same",
    observation: observation(),
    legalActions: [action("different", "attack"), action("hold", "hold")],
  });
  assert.equal(mismatch.selectedLegalActionId, "hold");
  assert.equal(mismatch.route, "cache_mismatch");
  assert.equal(mismatch.safety.fallbackUsed, true);
  assert.equal(controller.snapshot().activeDecisionCount, 1);
});

test("duplicate request IDs bind action semantics, not only offered IDs", () => {
  const controller = createStandardController();
  const sharedID = "attack:opaque:25";
  const first = controller.decide({
    requestID: "semantic-reuse",
    observation: observation({
      rivals: [{ id: "outsider", name: "Outsider", relativeTroopRatio: 2 }],
    }),
    legalActions: [
      action(sharedID, "attack", {
        targetID: "outsider",
        targetName: "Outsider",
        troopPercent: 25,
      }),
      action("hold", "hold"),
    ],
  });
  const changed = controller.decide({
    requestID: "semantic-reuse",
    observation: observation({
      rivals: [{ id: MICKEY, name: "K1Z Mickey Mouse", relativeTroopRatio: 2 }],
    }),
    legalActions: [
      action(sharedID, "attack", {
        targetID: MICKEY,
        targetName: "K1Z Mickey Mouse",
        troopPercent: 25,
      }),
      action("hold", "hold"),
    ],
  });

  assert.equal(first.selectedLegalActionId, sharedID);
  assert.equal(changed.selectedLegalActionId, "hold");
  assert.equal(changed.route, "cache_mismatch");
  assert.equal(changed.safety.fallbackUsed, true);
  assert.equal(controller.snapshot().activeDecisionCount, 1);
});

test("duplicate request IDs bind match-local visible-player identity", () => {
  const controller = createStandardController();
  const opaqueAttack = action("attack:slot-7:25", "attack", {
    targetID: "slot-7",
    troopPercent: 25,
  }, "Attack player 7 with 25%");
  const legalActions = [opaqueAttack, action("hold", "hold")];
  const first = controller.decide({
    requestID: "visible-remap",
    observation: observation({
      rivals: [{ id: "slot-7", name: "Outsider", relativeTroopRatio: 2 }],
    }),
    legalActions,
  });
  const changed = controller.decide({
    requestID: "visible-remap",
    observation: observation({
      rivals: [{ id: "slot-7", name: "K1Z Mickey Mouse", relativeTroopRatio: 2 }],
    }),
    legalActions,
  });

  assert.equal(first.selectedLegalActionId, opaqueAttack.id);
  assert.equal(changed.selectedLegalActionId, "hold");
  assert.equal(changed.route, "cache_mismatch");
  assert.equal(changed.safety.fallbackUsed, true);
  assert.equal(controller.snapshot().activeDecisionCount, 1);
});

test("the safety finalizer receives one total ranking and can reroute it", () => {
  let received;
  const controller = createStandardController({
    enforceSafety(input) {
      received = input;
      return {
        action: input.ranked[1],
        fallbackUsed: false,
        marker: "sv1",
        mode: "normal",
        rerouted: true,
        rejectedActionIDs: [input.ranked[0].id],
        reason: "test reroute",
      };
    },
  });
  const selected = decide(controller, 0, [
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("expand:10", "attack", { expansion: true, troopPercent: 10 }),
    action("hold", "hold"),
  ]);
  assert.deepEqual(received.ranked.map((candidate) => candidate.id), [
    "expand:35", "expand:10", "hold",
  ]);
  assert.equal(selected.selectedLegalActionId, "expand:10");
  assert.deepEqual(selected.markers, ["std1", "sv1"]);
});

test("K1Z-only endgame keeps neutral growth ahead of protected harm", () => {
  const controller = createStandardController();
  const selected = decide(controller, 0, [
    action("attack:kata:40", "attack", {
      targetID: KATANASAN,
      targetName: "K1Z katanasan",
      troopPercent: 40,
    }),
    action("expand:35", "attack", { expansion: true, troopPercent: 35 }),
    action("hold", "hold"),
  ], {
    ...observation({
      rivals: [{
        id: KATANASAN,
        name: "K1Z katanasan",
        tileShare: 0.5,
        relativeTroopRatio: 0.2,
      }],
    }),
    alivePlayerCount: 2,
  });
  assert.equal(selected.selectedLegalActionId, "expand:35");
  assert.equal(selected.route, "opening_grind");
  assert.equal(selected.safety.mode, "normal");
});

test("K1Z-only endgame rejects every K1Z attack and takes safe work", () => {
  const selected = decide(createStandardController(), 0, [
    action("attack:kata:40", "attack", {
      targetID: KATANASAN,
      targetName: "K1Z katanasan",
      troopPercent: 40,
    }),
    action("attack:mickey:40", "attack", {
      targetID: MICKEY,
      targetName: "K1Z Mickey Mouse",
      troopPercent: 40,
    }),
    action("build:city", "build", { unit: "City" }),
    action("hold", "hold"),
  ], {
    ...observation({
      rivals: [
        {
          id: KATANASAN,
          name: "K1Z katanasan",
          tileShare: 0.5,
          relativeTroopRatio: 2,
        },
        {
          id: MICKEY,
          name: "K1Z Mickey Mouse",
          tileShare: 0.2,
          relativeTroopRatio: 2,
        },
      ],
    }),
    alivePlayerCount: 3,
  });
  assert.equal(selected.selectedLegalActionId, "build:city");
  assert.equal(selected.route, "build_idle");
  assert.equal(selected.safety.mode, "normal");
  assert.equal(selected.safety.rerouted, true);
  assert.deepEqual(new Set(selected.safety.rejectedActionIDs), new Set([
    "attack:kata:40", "attack:mickey:40",
  ]));
});

test("K1Z-only endgame preserves the last alliance and holds if needed", () => {
  const controller = createStandardController();
  const selected = decide(controller, 0, [
    action("attack:kata:40", "attack", {
      targetID: KATANASAN,
      targetName: "K1Z katanasan",
      troopPercent: 40,
    }),
    action("break:kata", "break_alliance", {
      targetID: KATANASAN,
      targetName: "K1Z katanasan",
    }),
    action("hold", "hold"),
  ], {
    ...observation({
      rivals: [{
        id: KATANASAN,
        name: "K1Z katanasan",
        tileShare: 0.5,
        relativeTroopRatio: 2,
        isAllied: true,
      }],
    }),
    alivePlayerCount: 2,
  });
  assert.equal(selected.selectedLegalActionId, "hold");
  assert.equal(selected.route, "hold");
  assert.equal(selected.safety.mode, "normal");
  assert.equal(selected.safety.fallbackUsed, true);
  assert.deepEqual(selected.safety.rejectedActionIDs, ["attack:kata:40"]);
});

test("history and request cache stay bounded", () => {
  const controller = createStandardController();
  const actions = [action("expand:35", "attack", { expansion: true, troopPercent: 35 })];
  for (let index = 0; index < 530; index++) {
    decide(controller, index, actions, observation({ tileShare: index / 10_000 }));
  }
  const state = controller.snapshot();
  assert.equal(state.historySize, 64);
  assert.equal(state.cacheSize, 512);
});

test("reset clears episode memory and request idempotence state", () => {
  const controller = createStandardController();
  const actions = [action("expand:35", "attack", { expansion: true, troopPercent: 35 })];
  decide(controller, 0, actions);
  assert.equal(controller.snapshot().activeDecisionCount, 1);
  controller.reset();
  assert.equal(controller.snapshot().activeDecisionCount, 0);
  assert.equal(controller.snapshot().cacheSize, 0);
  assert.equal(decide(controller, 0, actions).route, "opening_grind");
});
