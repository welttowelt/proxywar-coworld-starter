import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HRAFN_CHASSIS_DEFAULTS,
  decideHrafn,
  publicHrafnChassisReason,
  validateHrafnMarkerSemantics,
} from "../hrafn-chassis.mjs";
import {
  K1Z_MEMBERS,
  createHrafnPersistentState,
} from "../hrafn-state.mjs";
import {
  action,
  alliance,
  attack,
  build,
  expand,
  hold,
  invasion,
  neutralBoat,
  observation,
  rival,
} from "./helpers/hrafn-fixtures.mjs";

const replayVectors = JSON.parse(
  await readFile(
    new URL("./fixtures/hrafn-chassis-vectors.json", import.meta.url),
    "utf8",
  ),
);

function decide({
  actions,
  obs = observation(),
  persistent = {},
  requestID,
  config,
}) {
  return decideHrafn({
    actions,
    observation: obs,
    state: createHrafnPersistentState(persistent),
    requestID,
    config,
  });
}

function combatMenu(target, percents = [10, 25, 40]) {
  return percents.map((percent) => attack(target, percent));
}

function established(overrides = {}) {
  return createHrafnPersistentState({
    bootNeutralCount: 10,
    selectedStructures: ["city", "factory"],
    ...overrides,
  });
}

test("all normalized replay-derived decision vectors reach their declared action", () => {
  assert.equal(
    replayVectors.fixture_type,
    "normalized_replay_derived_decision_vectors",
  );
  for (const vector of replayVectors.vectors) {
    const result = decide({
      actions: vector.actions,
      obs: vector.observation,
      persistent: vector.persistent_state,
      requestID: `fixture:${vector.id}`,
    });
    assert.equal(result.action.id, vector.expected.action_id, vector.id);
    assert.equal(
      result.action.policyMarker,
      vector.expected.primary_marker,
      vector.id,
    );
    assert.deepEqual(
      result.action.evidenceMarkers,
      vector.expected.evidence_markers,
      vector.id,
    );
    assert.equal(
      vector.actions.some((candidate) => candidate.id === result.action.id),
      true,
      `${vector.id} selected a current legal ID`,
    );
    assert.equal(validateHrafnMarkerSemantics(result.action).valid, true, vector.id);
  }
});

test("fixture provenance retains full replay hashes and explicit normalization caveat", () => {
  assert.match(replayVectors.caveat, /not byte-exact raw observation/i);
  for (const vector of replayVectors.vectors) {
    assert.match(vector.provenance.replay_sha256, /^[a-f0-9]{64}$/);
    assert.match(vector.provenance.run_id, /^coworld-/);
    assert.equal(Number.isInteger(vector.provenance.turn), true);
    assert.equal(typeof vector.provenance.source_username, "string");
    assert.equal(typeof vector.provenance.observed_selected_action_id, "string");
  }
  const daveey = replayVectors.vectors.filter((vector) =>
    vector.provenance.source_username === "daveey"
  );
  assert.deepEqual(
    daveey.map((vector) => vector.expected.action_id),
    daveey.map((vector) => vector.provenance.observed_selected_action_id),
  );
});

test("spawn is selected from the fresh menu without pretending to be growth reach", () => {
  const actions = [
    action("spawn:200", "spawn", "Spawn 200"),
    action("spawn:100", "spawn", "Spawn 100"),
    hold(),
  ];
  const result = decide({
    actions,
    obs: observation({ phase: "spawn", tileShare: 0 }),
    requestID: "spawn-1",
  });
  assert.equal(result.action.id, "spawn:100");
  assert.equal(result.action.policyMarker, null);
  assert.equal(result.telemetry.phase, "BOOT");
  assert.equal(publicHrafnChassisReason(result.action), "[K1Z] r4vn:spn");
});

test("four productive growth actions trigger the first City milestone", () => {
  const result = decide({
    actions: [expand(35), build("City"), build("Factory"), hold()],
    persistent: {
      bootNeutralCount: HRAFN_CHASSIS_DEFAULTS.cityAfterNeutralActions,
    },
  });
  assert.equal(result.action.id, "build:City:100");
  assert.equal(result.action.policyMarker, "hec1");
  assert.equal(result.telemetry.phase, "BOOT");
});

test("City never preempts the fourth productive 35 percent expansion", () => {
  const result = decide({
    actions: [build("City"), expand(10), expand(35), hold()],
    persistent: {
      bootNeutralCount:
        HRAFN_CHASSIS_DEFAULTS.cityAfterNeutralActions - 1,
    },
  });
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.equal(result.action.policyMarker, "hg35");
});

test("productive land resumes after City before Factory", () => {
  const result = decide({
    actions: [build("Factory"), expand(35), hold()],
    obs: observation({ unitCounts: { City: 1 } }),
    persistent: {
      bootNeutralCount: HRAFN_CHASSIS_DEFAULTS.bootNeutralActions,
      selectedStructures: ["city"],
    },
  });
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.equal(result.action.policyMarker, "hg35");
});

test("Factory becomes the second milestone when productive land disappears", () => {
  const result = decide({
    actions: [build("Factory"), hold()],
    obs: observation({ unitCounts: { City: 1 } }),
    persistent: {
      bootNeutralCount: HRAFN_CHASSIS_DEFAULTS.factoryAfterNeutralActions,
      selectedStructures: ["city"],
    },
  });
  assert.equal(result.action.id, "build:Factory:100");
  assert.equal(result.action.policyMarker, "hef1");
});

test("Factory cannot leapfrog a missing City", () => {
  const result = decide({
    actions: [build("Factory"), build("City"), hold()],
    persistent: {
      bootNeutralCount: HRAFN_CHASSIS_DEFAULTS.factoryAfterNeutralActions,
    },
  });
  assert.equal(result.action.id, "build:City:100");
  assert.equal(result.action.policyMarker, "hec1");
});

test("reserve boundaries dispatch 10, 25, 25, and 40 percent exactly", () => {
  const prey = rival({
    id: "prey",
    name: "Prey",
    tileShare: 0.03,
    relativeTroopRatio: 2,
  });
  const cases = [
    [0.74, "attack:prey:10", "hc10"],
    [0.75, "attack:prey:25", "hc25"],
    [0.89, "attack:prey:25", "hc25"],
    [0.9, "attack:prey:40", "hc40"],
  ];
  for (const [troopRatio, actionID, marker] of cases) {
    const result = decide({
      actions: [...combatMenu(prey), hold()],
      obs: observation({
        troopRatio,
        tileShare: 0.2,
        rivals: [prey],
        unitCounts: { City: 1, Factory: 1 },
      }),
      persistent: established(),
    });
    assert.equal(result.action.id, actionID, `reserve=${troopRatio}`);
    assert.equal(result.action.policyMarker, marker, `reserve=${troopRatio}`);
  }
});

test("missing exact commitments never inherit a nearby marked action", () => {
  const prey = rival({
    id: "prey",
    name: "Prey",
    tileShare: 0.03,
    relativeTroopRatio: 2,
  });
  const cases = [
    decide({
      actions: [expand(10), hold()],
      persistent: { bootNeutralCount: 1 },
    }),
    decide({
      actions: [attack(prey, 25), attack(prey, 40), hold()],
      obs: observation({ troopRatio: 0.74, rivals: [prey] }),
      persistent: established(),
    }),
    decide({
      actions: [attack(prey, 10), attack(prey, 40), hold()],
      obs: observation({ troopRatio: 0.8, rivals: [prey] }),
      persistent: established(),
    }),
    decide({
      actions: [attack(prey, 10), attack(prey, 25), hold()],
      obs: observation({ troopRatio: 0.9, rivals: [prey] }),
      persistent: established(),
    }),
    decide({
      actions: [neutralBoat(100, 8), neutralBoat(100, 25), hold()],
      persistent: established(),
    }),
    decide({
      actions: [invasion(prey, 8), invasion(prey, 16), hold()],
      obs: observation({ troopRatio: 0.8, rivals: [prey] }),
      persistent: established({
        selectedStructures: ["city", "factory", "port"],
      }),
    }),
  ];
  assert.equal(cases[0].action.policyMarker === "hg35", false);
  assert.equal(cases[1].action.policyMarker === "hc10", false);
  assert.equal(cases[2].action.policyMarker === "hc25", false);
  assert.equal(cases[3].action.policyMarker === "hc40", false);
  assert.equal(cases[4].action.policyMarker === "hn16", false);
  assert.equal(cases[5].action.policyMarker === "hni25", false);
  for (const result of cases) {
    assert.equal(
      validateHrafnMarkerSemantics(result.action).valid,
      true,
      `${result.action.id} carried ${result.action.policyMarker}`,
    );
  }
});

test("integer tile growth keeps quantized-share expansion productive", () => {
  let persistent = createHrafnPersistentState();
  const selected = [];
  for (let index = 0; index < 4; index += 1) {
    const result = decideHrafn({
      actions: [expand(35), build("City"), hold()],
      observation: observation({
        tileShare: 0,
        tilesOwned: 100 + index,
      }),
      state: persistent,
      requestID: `quantized-grow-${index}`,
    });
    selected.push(result.action.id);
    persistent = result.nextState;
  }
  const milestone = decideHrafn({
    actions: [expand(35), build("City"), hold()],
    observation: observation({ tileShare: 0, tilesOwned: 104 }),
    state: persistent,
    requestID: "quantized-city",
  });
  assert.deepEqual(selected, Array(4).fill("expand:terra-nullius:35"));
  assert.equal(milestone.action.id, "build:City:100");
  assert.equal(milestone.action.policyMarker, "hec1");
});

test("war ratio boundary stays pressure-only below 1.20", () => {
  const weak = rival({
    id: "weak",
    name: "Weak",
    tileShare: 0.2,
    relativeTroopRatio: 1.19,
  });
  const exact = { ...weak, relativeTroopRatio: 1.2 };
  const below = decide({
    actions: [...combatMenu(weak), hold()],
    obs: observation({ troopRatio: 0.8, rivals: [weak] }),
    persistent: established(),
  });
  const at = decide({
    actions: [...combatMenu(exact), hold()],
    obs: observation({ troopRatio: 0.8, rivals: [exact] }),
    persistent: established(),
  });
  assert.equal(below.action.id, "attack:weak:10");
  assert.equal(below.action.policyMarker, "hc10");
  assert.equal(at.action.id, "attack:weak:25");
  assert.equal(at.action.policyMarker, "hc25");
});

test("low-bank growth beats a favorable non-attacker conversion", () => {
  const prey = rival({
    id: "prey",
    name: "Prey",
    tileShare: 0.05,
    relativeTroopRatio: 3,
  });
  const result = decide({
    actions: [...combatMenu(prey), expand(35), hold()],
    obs: observation({ troopRatio: 0.74, rivals: [prey] }),
    persistent: established(),
  });
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.equal(result.action.policyMarker, "hg35");
});

test("a current attacker interrupts growth at 10 percent below the war reserve", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    relativeTroopRatio: 1.5,
    incomingAttack: true,
  });
  const result = decide({
    actions: [...combatMenu(attacker), expand(35), hold()],
    obs: observation({
      troopRatio: 0.74,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:attacker:10");
  assert.equal(result.action.policyMarker, "hc10");
  assert.deepEqual(result.action.evidenceMarkers, ["hctr"]);
});

test("a viable current attacker receives 25 percent at the war boundary", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    relativeTroopRatio: 1.2,
    incomingAttack: true,
  });
  const result = decide({
    actions: [...combatMenu(attacker), expand(35), hold()],
    obs: observation({
      troopRatio: 0.75,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:attacker:25");
  assert.equal(result.action.policyMarker, "hc25");
  assert.deepEqual(result.action.evidenceMarkers, ["hctr"]);
});

test("two attackers trigger defensive infrastructure before another front", () => {
  const alpha = rival({
    id: "alpha",
    name: "Alpha",
    incomingAttack: true,
  });
  const beta = rival({
    id: "beta",
    name: "Beta",
    incomingAttack: true,
  });
  const result = decide({
    actions: [
      ...combatMenu(alpha),
      ...combatMenu(beta),
      build("SAM Launcher"),
      expand(35),
      hold(),
    ],
    obs: observation({
      troopRatio: 0.8,
      rivals: [alpha, beta],
      incomingAttackPlayerIDs: [alpha.id, beta.id],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "build:SAM Launcher:100");
  assert.equal(result.action.policyMarker, "hdef");
  assert.equal(result.telemetry.phase, "DEFENSE");
});

test("severe pressure retreats when no defensive build exists", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const retreat = action("retreat:land", "retreat", "Retreat");
  const result = decide({
    actions: [retreat, ...combatMenu(attacker), hold()],
    obs: observation({
      troopRatio: 0.5,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, retreat.id);
  assert.equal(result.action.policyMarker, "hdef");
});

test("severe-defense builds obey a decision cooldown", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const retreat = action("retreat:land", "retreat", "Retreat");
  const result = decide({
    actions: [build("SAM Launcher"), retreat, ...combatMenu(attacker), hold()],
    obs: observation({
      troopRatio: 0.5,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established({
      decisionCount: 10,
      recent: [{
        decision: 9,
        actionID: "build:SAM Launcher:100",
        kind: "build",
        marker: "hdef",
      }],
    }),
  });
  assert.equal(result.action.id, retreat.id);
  assert.equal(result.action.policyMarker, "hdef");
});

test("a pending defense build cannot re-enter through economy selectors", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const actions = [build("City"), hold()];
  const first = decide({
    actions,
    obs: observation({
      troopRatio: 0.5,
      unitCounts: { City: 0, Factory: 0 },
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
    requestID: "pending-defense-city-1",
  });
  const second = decideHrafn({
    actions,
    observation: observation({
      troopRatio: 0.5,
      unitCounts: { City: 0, Factory: 0 },
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    state: first.nextState,
    requestID: "pending-defense-city-2",
  });
  assert.equal(first.action.id, "build:City:100");
  assert.equal(first.action.policyMarker, "hdef");
  assert.equal(second.action.id, "hold");
  assert.equal(second.action.policyMarker, "hhfc");
  assert.equal(second.nextState.pendingStructures.city, 1);
});

test("unchanged structure observations cannot alternate defense and economy rebuilds", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const actions = [build("City"), hold()];
  let persistent = established();
  const selected = [];
  for (let index = 0; index < 6; index += 1) {
    const result = decideHrafn({
      actions,
      observation: observation({
        troopRatio: 0.5,
        unitCounts: { City: 0, Factory: 0 },
        rivals: [attacker],
        incomingAttackPlayerIDs: [attacker.id],
      }),
      state: persistent,
      requestID: `unchanged-defense-city-${index}`,
    });
    selected.push([result.action.id, result.action.policyMarker]);
    persistent = result.nextState;
  }
  assert.deepEqual(selected, [
    ["build:City:100", "hdef"],
    ["hold", "hhfc"],
    ["hold", "hhfc"],
    ["hold", "hhfc"],
    ["hold", "hhfc"],
    ["hold", "hhfc"],
  ]);
});

test("high-bank finish interrupts an older prey for a more finishable rival", () => {
  const old = rival({
    id: "old",
    name: "Old",
    tileShare: 0.24,
    relativeTroopRatio: 1.4,
    incomingAttack: true,
  });
  const exposed = rival({
    id: "exposed",
    name: "Exposed",
    tileShare: 0.03,
    relativeTroopRatio: 2.1,
  });
  const result = decide({
    actions: [
      ...combatMenu(old),
      ...combatMenu(exposed),
      expand(35),
      hold(),
    ],
    obs: observation({
      troopRatio: 0.91,
      tileShare: 0.18,
      rivals: [old, exposed],
      incomingAttackPlayerIDs: [old.id],
    }),
    persistent: established({
      primaryPreyID: old.id,
      primaryPreyName: "old",
      primaryPreyAge: 2,
    }),
  });
  assert.equal(result.action.id, "attack:exposed:40");
  assert.equal(result.action.policyMarker, "hc40");
  assert.deepEqual(result.action.evidenceMarkers, ["hint"]);
});

test("missing rival size cannot earn a 40 percent finish marker", () => {
  const incomplete = rival({
    id: "incomplete",
    name: "Incomplete",
    relativeTroopRatio: 2,
  });
  delete incomplete.tileShare;
  const result = decide({
    actions: [...combatMenu(incomplete), hold()],
    obs: observation({
      troopRatio: 0.95,
      rivals: [incomplete],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:incomplete:25");
  assert.equal(result.action.policyMarker, "hc25");
});

test("primary prey stays advisory when no superior finish appears", () => {
  const primary = rival({
    id: "primary",
    name: "Primary",
    tileShare: 0.15,
    relativeTroopRatio: 1.4,
  });
  const side = rival({
    id: "side",
    name: "Side",
    tileShare: 0.16,
    relativeTroopRatio: 1.4,
  });
  const result = decide({
    actions: [...combatMenu(primary), ...combatMenu(side), hold()],
    obs: observation({
      troopRatio: 0.8,
      rivals: [primary, side],
    }),
    persistent: established({
      primaryPreyID: primary.id,
      primaryPreyName: "primary",
      primaryPreyAge: 1,
    }),
  });
  assert.equal(result.action.id, "attack:primary:25");
  assert.deepEqual(result.action.evidenceMarkers, ["hpri"]);
});

test("the numerically best K1Z prey is removed before target scoring", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    tileShare: 0.01,
    relativeTroopRatio: 10,
  });
  const outsider = rival({
    id: "outsider",
    name: "Outsider",
    tileShare: 0.1,
    relativeTroopRatio: 1.3,
  });
  const result = decide({
    actions: [
      ...combatMenu(odin),
      ...combatMenu(outsider),
      hold(),
    ],
    obs: observation({
      troopRatio: 0.8,
      rivals: [odin, outsider],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:outsider:25");
  assert.equal(result.telemetry.safetyRejectedCount, 3);
});

test("an unknown K1Z-tagged player is never scored as outsider prey", () => {
  const tagged = rival({
    id: "runtime-new-k1z",
    name: "K1Z new shield",
    tileShare: 0.01,
    relativeTroopRatio: 10,
  });
  const result = decide({
    actions: [...combatMenu(tagged), hold()],
    obs: observation({
      troopRatio: 0.95,
      rivals: [tagged],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hhfc");
});

test("only K1Z harm and hold produces an explained fail-closed hold", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    relativeTroopRatio: 10,
  });
  const result = decide({
    actions: [...combatMenu(odin), hold()],
    obs: observation({ rivals: [odin] }),
    persistent: established(),
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hhfc");
  assert.equal(publicHrafnChassisReason(result.action), "[K1Z] r4vn:h0d:hhfc");
});

test("neutral naval access uses 16 percent and rotates away from a stalled route", () => {
  const first = decide({
    actions: [
      neutralBoat(100, 8),
      neutralBoat(100, 16),
      neutralBoat(200, 8),
      neutralBoat(200, 16),
      hold(),
    ],
    obs: observation({ troopRatio: 0.75, unitCounts: { City: 1, Factory: 1 } }),
    persistent: established({
      naval: {
        routeID: "boat:100",
        attempts: 1,
        noProgress: 1,
      },
    }),
  });
  assert.equal(first.action.id, "boat:200:16");
  assert.equal(first.action.policyMarker, "hn16");
});

test("rotating neutral routes still hit the global two-attempt cap", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
  });
  const boats = [
    neutralBoat(100, 16),
    neutralBoat(200, 16),
    hold(),
  ];
  const first = decide({
    actions: boats,
    obs: observation({
      tileShare: 0.1,
      unitCounts: { City: 1, Factory: 1 },
    }),
    persistent: established(),
    requestID: "boat-1",
  });
  const second = decideHrafn({
    actions: boats,
    observation: observation({
      tileShare: 0.1,
      unitCounts: { City: 1, Factory: 1 },
    }),
    state: first.nextState,
    requestID: "boat-2",
  });
  const third = decideHrafn({
    actions: [...combatMenu(foe), ...boats],
    observation: observation({
      tileShare: 0.1,
      troopRatio: 0.8,
      rivals: [foe],
      unitCounts: { City: 1, Factory: 1 },
    }),
    state: second.nextState,
    requestID: "boat-3",
  });
  assert.equal(first.action.id, "boat:100:16");
  assert.equal(second.action.id, "boat:200:16");
  assert.equal(second.nextState.naval.attempts, 2);
  assert.equal(third.action.id, "attack:foe:25");
  assert.ok(third.action.evidenceMarkers.includes("hncap"));
});

test("neutral naval cap latches after two no-progress attempts", () => {
  const actions = [neutralBoat(100, 16), neutralBoat(200, 16), hold()];
  let persistent = established();
  const selected = [];
  for (let index = 0; index < 4; index += 1) {
    const result = decideHrafn({
      actions,
      observation: observation({ tileShare: 0.1, tilesOwned: 100 }),
      state: persistent,
      requestID: `neutral-cap-${index}`,
    });
    selected.push([result.action.id, result.action.policyMarker]);
    persistent = result.nextState;
  }
  assert.deepEqual(selected, [
    ["boat:100:16", "hn16"],
    ["boat:200:16", "hn16"],
    ["hold", "hncap"],
    ["hold", "hncap"],
  ]);
  assert.equal(persistent.naval.blocked, true);
});

test("explicit favorable outsider invasion uses 25 percent", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
    sharesBorder: false,
    canAttack: true,
  });
  const result = decide({
    actions: [invasion(foe, 8), invasion(foe, 25), hold()],
    obs: observation({
      troopRatio: 0.8,
      rivals: [foe],
      unitCounts: { City: 1, Factory: 1, Port: 1 },
    }),
    persistent: established({ selectedStructures: ["city", "factory", "port"] }),
  });
  assert.equal(result.action.id, "boat:foe:25");
  assert.equal(result.action.policyMarker, "hni25");
});

test("targeted naval cap latches after two no-progress invasions", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
  });
  const actions = [invasion(foe, 25), hold()];
  let persistent = established({
    selectedStructures: ["city", "factory", "port"],
  });
  const selected = [];
  for (let index = 0; index < 4; index += 1) {
    const result = decideHrafn({
      actions,
      observation: observation({
        tileShare: 0.1,
        tilesOwned: 100,
        troopRatio: 0.8,
        rivals: [foe],
      }),
      state: persistent,
      requestID: `invasion-cap-${index}`,
    });
    selected.push([result.action.id, result.action.policyMarker]);
    persistent = result.nextState;
  }
  assert.deepEqual(selected, [
    ["boat:foe:25", "hni25"],
    ["boat:foe:25", "hni25"],
    ["hold", "hncap"],
    ["hold", "hncap"],
  ]);
  assert.equal(persistent.naval.blocked, true);
});

test("an unrelated hold cannot erase a failed naval attempt", () => {
  const first = decide({
    actions: [neutralBoat(100, 16), hold()],
    obs: observation({ tileShare: 0.1, tilesOwned: 100 }),
    persistent: established(),
    requestID: "naval-preserve-1",
  });
  const unrelated = decideHrafn({
    actions: [hold()],
    observation: observation({ tileShare: 0.1, tilesOwned: 100 }),
    state: first.nextState,
    requestID: "naval-preserve-hold",
  });
  assert.equal(unrelated.action.policyMarker, "hhfc");
  assert.equal(unrelated.nextState.naval.attempts, 1);
  assert.equal(unrelated.nextState.naval.noProgress, 1);
  const second = decideHrafn({
    actions: [neutralBoat(200, 16), hold()],
    observation: observation({ tileShare: 0.1, tilesOwned: 100 }),
    state: unrelated.nextState,
    requestID: "naval-preserve-2",
  });
  const capped = decideHrafn({
    actions: [neutralBoat(300, 16), hold()],
    observation: observation({ tileShare: 0.1, tilesOwned: 100 }),
    state: second.nextState,
    requestID: "naval-preserve-cap",
  });
  assert.equal(second.action.policyMarker, "hn16");
  assert.equal(capped.action.id, "hold");
  assert.equal(capped.action.policyMarker, "hncap");
});

test("unattributed tile changes cannot reopen the naval cap", () => {
  const actions = [neutralBoat(100, 16), neutralBoat(200, 16), hold()];
  const first = decide({
    actions,
    obs: observation({ tileShare: 0.1, tilesOwned: 100 }),
    persistent: established(),
    requestID: "unattributed-naval-1",
  });
  const second = decideHrafn({
    actions,
    observation: observation({ tileShare: 0.2, tilesOwned: 200 }),
    state: first.nextState,
    requestID: "unattributed-naval-2",
  });
  const capped = decideHrafn({
    actions,
    observation: observation({ tileShare: 0.3, tilesOwned: 300 }),
    state: second.nextState,
    requestID: "unattributed-naval-cap",
  });
  assert.equal(first.action.policyMarker, "hn16");
  assert.equal(second.action.policyMarker, "hn16");
  assert.equal(capped.action.id, "hold");
  assert.equal(capped.action.policyMarker, "hncap");
});

test("K1Z and ambiguous naval invasions are rejected before neutral access", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    relativeTroopRatio: 4,
  });
  const twinA = rival({ id: "twin-a", name: "Twin" });
  const twinB = rival({ id: "twin-b", name: "Twin" });
  const ambiguous = action("boat:twin:25", "boat", "Invade Twin 25%", {
    targetName: "Twin",
    invasion: true,
    troopPercent: 25,
  });
  const result = decide({
    actions: [invasion(odin, 25), ambiguous, neutralBoat(300, 16), hold()],
    obs: observation({
      troopRatio: 0.9,
      rivals: [odin, twinA, twinB],
      unitCounts: { City: 1, Factory: 1 },
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "boat:300:16");
  assert.equal(result.action.policyMarker, "hn16");
  assert.equal(result.telemetry.safetyRejectedCount, 2);
});

test("two no-progress boats yield a cap replacement build", () => {
  const result = decide({
    actions: [neutralBoat(100, 16), build("Factory"), hold()],
    obs: observation({ unitCounts: { City: 1 } }),
    persistent: {
      bootNeutralCount: 10,
      selectedStructures: ["city"],
      naval: {
        routeID: "boat:100",
        attempts: 2,
        noProgress: 2,
      },
    },
  });
  assert.equal(result.action.id, "build:Factory:100");
  assert.equal(result.action.policyMarker, "hncap");
  assert.equal(result.nextState.naval.attempts, 2);
  assert.equal(result.nextState.naval.blocked, true);
});

test("boat cap converts a viable outsider when no milestone build exists", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
  });
  const result = decide({
    actions: [...combatMenu(foe), neutralBoat(100, 16), hold()],
    obs: observation({
      troopRatio: 0.8,
      rivals: [foe],
      unitCounts: { City: 1, Factory: 1 },
    }),
    persistent: established({
      naval: {
        routeID: "boat:100",
        attempts: 2,
        noProgress: 2,
      },
    }),
  });
  assert.equal(result.action.id, "attack:foe:25");
  assert.equal(result.action.policyMarker, "hc25");
  assert.ok(result.action.evidenceMarkers.includes("hncap"));
  assert.equal(result.nextState.naval.attempts, 2);
  assert.equal(result.nextState.naval.blocked, true);
});

test("cap recovery actions cannot start another naval launch cycle", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
  });
  const recovery = decide({
    actions: [...combatMenu(foe), neutralBoat(100, 16), hold()],
    obs: observation({
      troopRatio: 0.8,
      rivals: [foe],
    }),
    persistent: established({
      naval: {
        attempts: 2,
        noProgress: 2,
        blocked: true,
      },
    }),
    requestID: "hard-cap-recovery",
  });
  const after = decideHrafn({
    actions: [neutralBoat(200, 16), hold()],
    observation: observation({ tileShare: 0.2, tilesOwned: 200 }),
    state: recovery.nextState,
    requestID: "hard-cap-after-recovery",
  });
  assert.ok(recovery.action.evidenceMarkers.includes("hncap"));
  assert.equal(recovery.nextState.naval.blocked, true);
  assert.equal(after.action.id, "hold");
  assert.equal(after.action.policyMarker, "hncap");
});

test("boat cap falls through to productive non-naval utility", () => {
  const upgrade = action(
    "upgrade:City:1",
    "upgrade_structure",
    "Upgrade City",
  );
  const result = decide({
    actions: [neutralBoat(100, 16), upgrade, hold()],
    persistent: established({
      naval: {
        routeID: "boat:100",
        attempts: 2,
        noProgress: 2,
        blocked: true,
      },
    }),
  });
  assert.equal(result.action.id, upgrade.id);
  assert.equal(result.action.policyMarker, "hdef");
  assert.equal(result.nextState.naval.blocked, true);
});

test("a bounded frontier stall takes one alternate action and then retries land", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 1.4,
  });
  const menu = [...combatMenu(foe), expand(35), hold()];
  const initial = established({
    lastPrimaryMarker: "hg35",
    lastOwnTileShare: 0.1,
    neutralStallCount: 1,
  });
  const alternate = decideHrafn({
    actions: menu,
    observation: observation({
      tileShare: 0.1,
      troopRatio: 0.8,
      rivals: [foe],
      unitCounts: { City: 1, Factory: 1 },
    }),
    state: initial,
    requestID: "stall-alternate",
  });
  assert.equal(alternate.action.id, "attack:foe:25");
  assert.equal(alternate.nextState.neutralStallCount, 0);

  const retry = decideHrafn({
    actions: menu,
    observation: observation({
      tileShare: 0.1,
      troopRatio: 0.8,
      rivals: [foe],
      unitCounts: { City: 1, Factory: 1 },
    }),
    state: alternate.nextState,
    requestID: "stall-retry",
  });
  assert.equal(retry.action.id, "expand:terra-nullius:35");
  assert.equal(retry.action.policyMarker, "hg35");
});

test("a Port is built only when a credible naval route is present", () => {
  const withoutRoute = decide({
    actions: [build("Port"), hold()],
    obs: observation({ unitCounts: { City: 1, Factory: 1 } }),
    persistent: established(),
  });
  const withRoute = decide({
    actions: [build("Port"), neutralBoat(100, 16), hold()],
    obs: observation({ unitCounts: { City: 1, Factory: 1 } }),
    persistent: established(),
  });
  assert.equal(withoutRoute.action.id, "hold");
  assert.equal(withoutRoute.action.policyMarker, "hhfc");
  assert.equal(withRoute.action.id, "build:Port:100");
  assert.equal(withRoute.action.policyMarker, "hef1");
});

test("an incoming K1Z alliance offer is accepted before optional growth", () => {
  const katanasan = rival({
    id: "match-katana",
    name: "K1Z katanasan",
  });
  const request = alliance(katanasan, { relation: 2 });
  const reject = action(
    "reject:match-katana",
    "alliance_reject",
    "Reject Katanasan",
    { targetID: katanasan.id, targetName: katanasan.name },
  );
  const result = decide({
    actions: [request, reject, expand(35), hold()],
    obs: observation({ rivals: [katanasan] }),
    persistent: established(),
  });
  assert.equal(result.action.id, request.id);
  assert.equal(result.action.policyMarker, "hka1");
});

test("a matching reject action proves an incoming K1Z offer despite stale relation metadata", () => {
  const juryoku = rival({
    id: "match-juryoku",
    name: "K1Z juryoku koku",
  });
  const request = alliance(juryoku, { relation: 0 });
  const reject = action(
    `reject:${juryoku.id}`,
    "alliance_reject",
    "Reject Juryoku",
    { targetID: juryoku.id, targetName: juryoku.name },
  );
  const result = decide({
    actions: [request, reject, expand(35), hold()],
    obs: observation({ rivals: [juryoku] }),
    persistent: established(),
  });
  assert.equal(result.action.id, request.id);
  assert.equal(result.action.policyMarker, "hka1");
});

test("an existing K1Z alliance extension is kept ahead of optional growth", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const extension = action(
    `alliance_extend:${odin.id}`,
    "alliance_extend",
    "Extend Odin alliance",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const result = decide({
    actions: [extension, expand(35), hold()],
    obs: observation({ rivals: [odin] }),
    persistent: established(),
  });
  assert.equal(result.action.id, extension.id);
  assert.equal(result.action.policyMarker, "hka1");
});

test("an outgoing K1Z alliance waits behind productive territory", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const request = alliance(odin, { relation: 1 });
  const result = decide({
    actions: [request, expand(35), hold()],
    obs: observation({ rivals: [odin] }),
    persistent: established(),
  });
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.equal(result.action.policyMarker, "hg35");
});

test("stable K1Z alliance is used when productive actions are exhausted", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const request = alliance(odin, { relation: 1 });
  const result = decide({
    actions: [request, hold()],
    obs: observation({ rivals: [odin] }),
    persistent: established(),
  });
  assert.equal(result.action.id, request.id);
  assert.equal(result.action.policyMarker, "hka1");
});

test("current attacker counter precedes an incoming K1Z alliance", () => {
  const odin = rival({ id: "match-odin", name: "K1Z odin free" });
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    relativeTroopRatio: 1.3,
    incomingAttack: true,
  });
  const request = alliance(odin, { relation: 2, incoming: true });
  const result = decide({
    actions: [request, ...combatMenu(attacker), hold()],
    obs: observation({
      troopRatio: 0.8,
      rivals: [odin, attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:attacker:25");
  assert.deepEqual(result.action.evidenceMarkers, ["hctr"]);
});

test("outsider pressure precedes a routine outgoing K1Z alliance", () => {
  const odin = rival({ id: "match-odin", name: "K1Z odin free" });
  const outsider = rival({
    id: "outsider",
    name: "Outsider",
    relativeTroopRatio: 0.9,
  });
  const result = decide({
    actions: [alliance(odin, { relation: 1 }), attack(outsider, 10), hold()],
    obs: observation({ troopRatio: 0.7, rivals: [odin, outsider] }),
    persistent: established(),
  });
  assert.equal(result.action.id, "attack:outsider:10");
  assert.equal(result.action.policyMarker, "hc10");
});

test("outsider diplomacy and public social actions are absent from the first chassis", () => {
  const outsider = rival({ id: "outsider", name: "Outsider" });
  const actions = [
    alliance(outsider),
    action("target:outsider", "target_player", "Target Outsider", {
      targetID: outsider.id,
    }),
    action("chat:raven", "quick_chat", "Raven signal"),
    action("emoji:raven", "emoji", "Raven"),
    hold(),
  ];
  const result = decide({
    actions,
    obs: observation({ rivals: [outsider] }),
    persistent: established(),
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hhfc");
});

test("midgame Odin donation stays disabled even with a large surplus", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    tileShare: 0.02,
    isAllied: true,
  });
  const donation = action(
    `donate:${odin.id}`,
    "donate_troops",
    "Donate Odin",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const result = decide({
    actions: [donation, hold()],
    obs: observation({
      tileShare: 0.5,
      troopRatio: 1,
      rivals: [odin],
      unitCounts: { City: 1, Factory: 1 },
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hhfc");
});

test("strict K1Z-only endgame donates troops to Odin", () => {
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
  const donation = action(
    `donate:${odin.id}`,
    "donate_troops",
    "Donate Odin",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const result = decide({
    actions: [attack(katanasan, 40), donation, hold()],
    obs: observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 3,
      rivals: [odin, katanasan],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, donation.id);
  assert.equal(result.action.policyMarker, "hkf1");
  assert.equal(result.telemetry.phase, "ENDGAME");
});

test("strict K1Z-only endgame allies Odin before holding or donating", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: false,
  });
  const request = alliance(odin, { relation: 1 });
  const result = decide({
    actions: [request, build("City"), hold()],
    obs: observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 2,
      rivals: [odin],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, request.id);
  assert.equal(result.action.policyMarker, "hka1");
  assert.equal(result.telemetry.phase, "ENDGAME");
});

test("strict K1Z-only endgame holds globally without an Odin donation", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const result = decide({
    actions: [build("City"), hold()],
    obs: observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 2,
      rivals: [odin],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hkf1");
});

test("incomplete liveness cannot activate terminal handoff", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: true,
  });
  const donation = action(
    `donate:${odin.id}`,
    "donate_troops",
    "Donate Odin",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const result = decide({
    actions: [donation, expand(35), hold()],
    obs: observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 3,
      rivals: [odin],
    }),
    persistent: established(),
  });
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.notEqual(result.action.policyMarker, "hkf1");
});

test("duplicate request IDs replay one action without a second state mutation", () => {
  const actions = [expand(35), hold()];
  const first = decide({
    actions,
    requestID: "request-1",
  });
  const second = decideHrafn({
    actions,
    observation: observation(),
    state: first.nextState,
    requestID: "request-1",
  });
  assert.equal(second.action.id, first.action.id);
  assert.equal(second.nextState.decisionCount, first.nextState.decisionCount);
  assert.equal(second.nextState.recent.length, first.nextState.recent.length);
  assert.equal(second.telemetry.duplicateRequest, true);
});

test("a duplicate request whose cached action vanished returns hold without mutation", () => {
  const first = decide({
    actions: [expand(35), hold()],
    requestID: "request-1",
  });
  const duplicate = decideHrafn({
    actions: [build("City"), hold()],
    observation: observation(),
    state: first.nextState,
    requestID: "request-1",
  });
  assert.equal(duplicate.action.id, "hold");
  assert.equal(duplicate.action.policyMarker, "hhfc");
  assert.equal(duplicate.nextState.decisionCount, first.nextState.decisionCount);
  assert.equal(duplicate.telemetry.cacheConflict, "cached-action-withdrawn");
  assert.equal(duplicate.telemetry.duplicateContextChanged, true);
  assert.equal(duplicate.fallbackUsed, true);
});

test("same-ID changed context replays a still-safe cached action", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    relativeTroopRatio: 2,
    incomingAttack: true,
  });
  const actions = [expand(35), ...combatMenu(foe), hold()];
  const first = decide({
    actions,
    requestID: "request-context",
    persistent: established(),
  });
  const duplicate = decideHrafn({
    actions,
    observation: observation({
      troopRatio: 0.8,
      rivals: [foe],
      incomingAttackPlayerIDs: [foe.id],
    }),
    state: first.nextState,
    requestID: "request-context",
  });
  assert.equal(duplicate.action.id, first.action.id);
  assert.equal(duplicate.nextState.decisionCount, first.nextState.decisionCount);
  assert.equal(duplicate.telemetry.duplicateContextChanged, true);
  assert.equal(duplicate.telemetry.cacheConflict, null);
  assert.equal(duplicate.fallbackUsed, false);
});

test("a fresh request never retries a withdrawn action ID", () => {
  const first = decide({
    actions: [expand(35), hold()],
    requestID: "request-1",
  });
  const second = decideHrafn({
    actions: [build("City"), hold()],
    observation: observation(),
    state: first.nextState,
    requestID: "request-2",
  });
  assert.equal(second.action.id, "build:City:100");
  assert.notEqual(second.action.id, first.action.id);
  assert.equal(
    ["build:City:100", "hold"].includes(second.action.id),
    true,
  );
});

test("dispatcher-disabled ablation changes the high-bank fixture action ID", () => {
  const vector = replayVectors.vectors.find((candidate) =>
    candidate.id === "high-bank-dynamic-finish-turn-3300"
  );
  const enabled = decide({
    actions: vector.actions,
    obs: vector.observation,
    persistent: vector.persistent_state,
  });
  const disabled = decide({
    actions: vector.actions,
    obs: vector.observation,
    persistent: vector.persistent_state,
    config: { dispatcherEnabled: false },
  });
  assert.equal(enabled.action.id, "attack:xbt2wt14:40");
  assert.notEqual(disabled.action.id, enabled.action.id);
  assert.equal(disabled.telemetry.phase, "ABLATION");
});

test("module ablations produce action-ID deltas for growth, conversion, and naval", () => {
  const grow = decide({
    actions: [expand(35), build("City"), hold()],
    persistent: { bootNeutralCount: 2 },
  });
  const noGrow = decide({
    actions: [expand(35), build("City"), hold()],
    persistent: { bootNeutralCount: 2 },
    config: { enableGrow: false },
  });
  assert.notEqual(grow.action.id, noGrow.action.id);

  const prey = rival({
    id: "prey",
    name: "Prey",
    tileShare: 0.03,
    relativeTroopRatio: 2,
  });
  const convert = decide({
    actions: [...combatMenu(prey), hold()],
    obs: observation({ troopRatio: 0.9, rivals: [prey] }),
    persistent: established(),
  });
  const noConvert = decide({
    actions: [...combatMenu(prey), hold()],
    obs: observation({ troopRatio: 0.9, rivals: [prey] }),
    persistent: established(),
    config: { enableConvert: false },
  });
  assert.notEqual(convert.action.id, noConvert.action.id);

  const naval = decide({
    actions: [neutralBoat(100, 16), hold()],
    persistent: established(),
  });
  const noNaval = decide({
    actions: [neutralBoat(100, 16), hold()],
    persistent: established(),
    config: { enableNaval: false },
  });
  assert.notEqual(naval.action.id, noNaval.action.id);
});

test("conversion ablation also disables defensive counters", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    relativeTroopRatio: 2,
    incomingAttack: true,
  });
  const actions = [...combatMenu(attacker), expand(35), hold()];
  const enabled = decide({
    actions,
    obs: observation({
      troopRatio: 0.8,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
  });
  const disabled = decide({
    actions,
    obs: observation({
      troopRatio: 0.8,
      rivals: [attacker],
      incomingAttackPlayerIDs: [attacker.id],
    }),
    persistent: established(),
    config: { enableConvert: false },
  });
  assert.equal(enabled.action.kind, "attack");
  assert.equal(disabled.action.id, "expand:terra-nullius:35");
});

test("naval ablation disables launches, route infrastructure, and naval utility", () => {
  const warship = action("build:Warship:1", "warship", "Build Warship");
  const result = decide({
    actions: [neutralBoat(100, 16), build("Port"), warship, hold()],
    persistent: established({
      recent: [{
        decision: 9,
        actionID: "boat:90:16",
        kind: "boat",
        marker: "hn16",
      }],
    }),
    config: { enableNaval: false },
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hhfc");
});

test("naval ablation ignores a latched cap and emits no naval recovery marker", () => {
  const result = decide({
    actions: [build("City"), hold()],
    persistent: established({
      selectedStructures: ["factory"],
      naval: {
        attempts: 2,
        noProgress: 2,
        blocked: true,
      },
    }),
    config: { enableNaval: false },
  });
  assert.equal(result.action.id, "build:City:100");
  assert.notEqual(result.action.policyMarker, "hncap");
  assert.deepEqual(result.action.evidenceMarkers, []);
});

test("alliance ablation also disables the terminal alliance branch", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
    isAllied: false,
  });
  const result = decide({
    actions: [alliance(odin), hold()],
    obs: observation({
      gameMode: "FFA",
      phase: "active",
      alivePlayerCount: 2,
      rivals: [odin],
    }),
    persistent: established(),
    config: { enableAlliance: false },
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hkf1");
});

test("public reasons expose primary and sidecar markers in bounded ASCII", () => {
  const reason = publicHrafnChassisReason({
    kind: "attack",
    policyMarker: "hc40",
    evidenceMarkers: ["hint", "hpri", "hint"],
  });
  assert.equal(reason, "[K1Z] r4vn:atk:hc40.hint.hpri");
  assert.ok(reason.length <= 48);
  assert.match(reason, /^[\x20-\x7e]+$/);
});

test("marker semantics reject wrong kind and commitment combinations", () => {
  const invalid = [
    { ...attack(rival(), 25), policyMarker: "hc40", evidenceMarkers: [] },
    { ...neutralBoat(100, 8), policyMarker: "hn16", evidenceMarkers: [] },
    { ...build("Factory"), policyMarker: "hec1", evidenceMarkers: [] },
    { ...hold(), policyMarker: "unknown", evidenceMarkers: [] },
    { ...hold(), policyMarker: "hhfc", evidenceMarkers: ["unknown"] },
  ];
  for (const candidate of invalid) {
    const validation = validateHrafnMarkerSemantics(candidate);
    assert.equal(validation.valid, false, candidate.policyMarker);
    assert.ok(validation.failures.length > 0);
  }
});

test("every selected candidate action carries valid marker semantics", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    tileShare: 0.03,
    relativeTroopRatio: 2,
  });
  const cases = [
    decide({ actions: [expand(35), hold()] }),
    decide({
      actions: [build("City"), hold()],
      persistent: { bootNeutralCount: 4 },
    }),
    decide({
      actions: [build("Factory"), hold()],
      obs: observation({ unitCounts: { City: 1 } }),
      persistent: { bootNeutralCount: 6, selectedStructures: ["city"] },
    }),
    decide({
      actions: [...combatMenu(foe), hold()],
      obs: observation({ troopRatio: 0.74, rivals: [foe] }),
      persistent: established(),
    }),
    decide({
      actions: [...combatMenu(foe), hold()],
      obs: observation({ troopRatio: 0.75, rivals: [foe] }),
      persistent: established(),
    }),
    decide({
      actions: [...combatMenu(foe), hold()],
      obs: observation({ troopRatio: 0.9, rivals: [foe] }),
      persistent: established(),
    }),
    decide({
      actions: [neutralBoat(100, 16), hold()],
      persistent: established(),
    }),
  ];
  for (const result of cases) {
    const validation = validateHrafnMarkerSemantics(result.action);
    assert.equal(
      validation.valid,
      true,
      `${result.action.id}: ${validation.failures.join(", ")}`,
    );
  }
});

test("history and request caches remain bounded", () => {
  let persistent = createHrafnPersistentState();
  const config = { historyLimit: 4, requestCacheLimit: 3 };
  for (let index = 0; index < 8; index += 1) {
    const result = decideHrafn({
      actions: [expand(35), hold()],
      observation: observation({ tileShare: index / 100 }),
      state: persistent,
      requestID: `request-${index}`,
      config,
    });
    persistent = result.nextState;
  }
  assert.equal(persistent.recent.length, 4);
  assert.equal(persistent.requestCache.length, 3);
  assert.deepEqual(
    persistent.requestCache.map(({ requestID }) => requestID),
    ["request-5", "request-6", "request-7"],
  );
});

test("production request cache retains every request ID for the process match", () => {
  let first = decide({
    actions: [expand(35), hold()],
    requestID: "old-request",
  });
  let persistent = first.nextState;
  for (let index = 0; index < 520; index += 1) {
    const result = decideHrafn({
      actions: [expand(35), hold()],
      observation: observation({ tileShare: index / 100 }),
      state: persistent,
      requestID: `new-request-${index}`,
    });
    persistent = result.nextState;
  }
  const before = persistent.decisionCount;
  const duplicate = decideHrafn({
    actions: [expand(35), hold()],
    observation: observation(),
    state: persistent,
    requestID: "old-request",
  });
  assert.equal(duplicate.telemetry.duplicateRequest, true);
  assert.equal(duplicate.nextState.decisionCount, before);
  assert.equal(HRAFN_CHASSIS_DEFAULTS.requestCacheLimit, null);
});

test("observed structure counts override stale selected-structure memory", () => {
  const result = decide({
    actions: [build("City"), hold()],
    obs: observation({ unitCounts: { City: 0, Factory: 0 } }),
    persistent: established(),
  });
  assert.equal(result.action.id, "build:City:100");
  assert.equal(result.action.policyMarker, "hec1");
  assert.deepEqual(result.nextState.selectedStructures, ["city"]);
});

test("empty and wholly unsafe menus fail closed instead of selecting actions[0]", () => {
  assert.throws(
    () => decideHrafn({
      actions: [],
      observation: observation(),
    }),
    /no legal actions/,
  );

  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
  });
  assert.throws(
    () => decideHrafn({
      actions: combatMenu(odin),
      observation: observation({ rivals: [odin] }),
    }),
    /no safe Hrafn action/,
  );
});

test("invalid request IDs fail closed instead of bypassing idempotence", () => {
  for (const requestID of ["", " spaced ", 17, {}]) {
    assert.throws(
      () => decideHrafn({
        actions: [expand(35), hold()],
        observation: observation(),
        requestID,
      }),
      /no non-empty string request ID/,
    );
  }
});
