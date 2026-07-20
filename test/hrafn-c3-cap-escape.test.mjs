import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decideHrafn,
  publicHrafnChassisReason,
  validateHrafnMarkerSemantics,
} from "../hrafn-chassis.mjs";
import { createHrafnPersistentState } from "../hrafn-state.mjs";
import { auditHrafnChassisReplay } from "../scripts/audit-hrafn-chassis-replay.mjs";
import {
  action,
  hold,
  neutralBoat,
  observation,
  rival,
} from "./helpers/hrafn-fixtures.mjs";

const vectors = JSON.parse(
  await readFile(
    new URL(
      "./fixtures/hrafn-c3-cap-escape-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function warship(tile = 500241, risk = "low") {
  return {
    ...action(
      `build:Warship:${tile}`,
      "warship",
      "Build Warship",
      {
        unit: "Warship",
        targetTile: tile,
        unitCount: 0,
        legalReason: "Port can build Warship",
      },
    ),
    risk: { level: risk },
  };
}

function moveWarship(unitID = "warship-1", tile = 500250, risk = "low") {
  return {
    ...action(
      `move_warship:${unitID}:${tile}`,
      "move_warship",
      "Move Warship",
      {
        unitCount: 1,
        targetTile: tile,
        legalReason: "Warship can move",
      },
    ),
    risk: { level: risk },
  };
}

function cappedState(overrides = {}) {
  return createHrafnPersistentState({
    bootNeutralCount: 10,
    selectedStructures: ["city", "factory", "port"],
    naval: {
      routeID: "boat:500240",
      attempts: 2,
      noProgress: 2,
      blocked: true,
      capEscapeBuilds: 0,
      ...(overrides.naval ?? {}),
    },
    recent: [
      { decision: 1, actionID: "boat:1:16", kind: "boat", marker: "hn16" },
      { decision: 2, actionID: "boat:2:16", kind: "boat", marker: "hn16" },
      { decision: 3, actionID: "build:City:1", kind: "build", marker: "hec1" },
      {
        decision: 4,
        actionID: "build:Factory:1",
        kind: "build",
        marker: "hef1",
      },
      {
        decision: 5,
        actionID: "upgrade:City:1",
        kind: "upgrade_structure",
        marker: "hdef",
      },
      {
        decision: 6,
        actionID: "retreat:attack-1",
        kind: "retreat",
        marker: "hdef",
      },
    ],
    ...overrides,
    naval: {
      routeID: "boat:500240",
      attempts: 2,
      noProgress: 2,
      blocked: true,
      capEscapeBuilds: 0,
      ...(overrides.naval ?? {}),
    },
  });
}

function capObservation(overrides = {}) {
  return observation({
    turnNumber: 10800,
    unitCounts: {
      City: 1,
      Factory: 1,
      Port: 1,
      Warship: 0,
    },
    ...overrides,
  });
}

function decide({
  actions,
  obs = capObservation(),
  state = cappedState(),
  requestID = null,
  config = {},
}) {
  return decideHrafn({
    actions,
    observation: obs,
    state,
    requestID,
    config,
  });
}

function replayWith(decisions) {
  return {
    gameID: "c3-test-game",
    inlineRunArtifacts: {
      "decisions.jsonl": `${decisions.map(JSON.stringify).join("\n")}\n`,
    },
    finalState: {
      players: [
        { username: "K1Z Hrafn", playerID: "runtime-hrafn" },
        { username: "K1Z odin free", playerID: "runtime-odin" },
      ],
    },
  };
}

function replayDecision({
  turn,
  id,
  kind,
  metadata = {},
  reason,
  intent,
  requestID = `req-c3-${turn}-${id}`,
}) {
  return {
    username: "K1Z Hrafn",
    turnNumber: turn,
    requestID,
    selectedLegalActionId: id,
    selectedActionKind: kind,
    selectedActionMetadata: metadata,
    legalActionIDs: [id, "hold"],
    legalActionIDsByKind: {
      [kind]: [id],
      hold: ["hold"],
    },
    reason,
    fallbackUsed: false,
    llmPlannerDegraded: false,
    auditBefore: { playerID: "runtime-hrafn" },
    result: {
      accepted: true,
      submittedIntent: intent,
    },
  };
}

function acceptedLaunch(
  turn,
  tile,
  requestID = `req-c3-launch-${turn}-${tile}`,
) {
  return replayDecision({
    turn,
    id: `boat:${tile}:16`,
    kind: "boat",
    metadata: {
      targetTile: tile,
      expansion: true,
      invasion: false,
      troopPercent: 16,
      troops: 16000,
    },
    reason: "[K1Z] r4vn:b0t:hn16",
    intent: { type: "boat", dst: tile, troops: 16000 },
    requestID,
  });
}

test("normalized turn-10800 and turn-8200 fixtures preserve hashes and reach C3", () => {
  assert.equal(
    vectors.fixture_type,
    "normalized_c1_replay_derived_c3_counterfactual_vectors",
  );
  assert.match(vectors.caveat, /not byte-exact raw observations/i);
  assert.match(vectors.caveat, /counterfactually/i);
  assert.deepEqual(
    vectors.vectors.map((vector) => vector.provenance.turn),
    [10800, 8200],
  );
  for (const vector of vectors.vectors) {
    assert.match(vector.provenance.replay_sha256, /^[a-f0-9]{64}$/);
    assert.equal(vector.provenance.observed_parent_action_id, "hold");
    const result = decideHrafn({
      actions: vector.actions,
      observation: vector.observation,
      state: createHrafnPersistentState(vector.persistent_state),
      requestID: `c3-fixture:${vector.id}`,
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
    assert.equal(result.action.policyPhase, vector.expected.phase, vector.id);
  }
});

test("frozen exact-C2 receipt proves the policy and auditor red gates", () => {
  const receipt = vectors.exact_c2_red_receipt;
  assert.equal(
    receipt.exact_parent_commit,
    "9c9ae7b6b3a978d971cde24688aba3995a88bdea",
  );
  assert.equal(
    receipt.hrafn_chassis_sha256,
    "531c5affbea511c47bff1ba249e5b8811cacd48e76171b33213d9588068c5ae3",
  );
  assert.equal(
    receipt.replay_auditor_sha256,
    "0935ce3abd5b09f26fb24ad0db7f98dee84013dada103c0da11cc7c0d6fc140d",
  );
  assert.equal(receipt.policy_red.actual_action_id, "hold");
  assert.equal(receipt.policy_red.actual_primary_marker, "hncap");
  assert.match(
    receipt.auditor_red.failures.join(" "),
    /unknown primary marker hks1/,
  );
  assert.equal(receipt.auditor_red.marker_semantics_valid, false);
  assert.deepEqual(receipt.initial_red_run, {
    command: "node --test test/hrafn-c3-cap-escape.test.mjs",
    tests: 13,
    passed: 6,
    failed: 7,
  });
});

test("latched cap selects one fresh Warship build with hks1.hncap", () => {
  const low = warship(500241, "low");
  const high = warship(500240, "high");
  const result = decide({
    actions: [high, neutralBoat(500242, 16), low, hold()],
    requestID: "c3-build-1",
  });
  assert.equal(result.action.id, low.id);
  assert.equal(result.action.policyMarker, "hks1");
  assert.deepEqual(result.action.evidenceMarkers, ["hncap"]);
  assert.equal(result.action.policyPhase, "RECOVERY");
  assert.equal(
    publicHrafnChassisReason(result.action),
    "[K1Z] r4vn:w4r:hks1.hncap",
  );
  assert.equal(result.nextState.naval.capEscapeBuilds, 1);
  assert.equal(result.nextState.naval.blocked, true);
});

test("an observed Warship selects a fresh move before another build", () => {
  const moveHigh = moveWarship("warship-2", 500252, "high");
  const moveLow = moveWarship("warship-1", 500251, "low");
  const result = decide({
    actions: [warship(), moveHigh, moveLow, hold()],
    obs: capObservation({
      unitCounts: {
        City: 1,
        Factory: 1,
        Port: 1,
        Warship: 1,
      },
    }),
    requestID: "c3-move-1",
  });
  assert.equal(result.action.id, moveLow.id);
  assert.equal(result.action.policyMarker, "hks1");
  assert.deepEqual(result.action.evidenceMarkers, ["hncap"]);
  assert.equal(result.action.policyPhase, "RECOVERY");
  assert.equal(
    publicHrafnChassisReason(result.action),
    "[K1Z] r4vn:mvw:hks1.hncap",
  );
  assert.equal(result.nextState.naval.capEscapeBuilds, 0);
  assert.equal(result.nextState.naval.blocked, true);
});

test("malformed or owner-attributed moves are skipped without crashing", () => {
  const malformed = moveWarship("warship-bad", 500251);
  malformed.metadata.unitCount = 0;
  const attributed = moveWarship("warship-owned", 500252);
  attributed.metadata.ownerPlayerID = "runtime-outsider";
  const build = warship();
  for (const [index, rejectedMove] of [malformed, attributed].entries()) {
    const withBuild = decide({
      actions: [rejectedMove, build, hold()],
      requestID: `c3-invalid-move-build-${index}`,
    });
    assert.equal(withBuild.action.id, build.id);
    assert.equal(withBuild.action.policyMarker, "hks1");

    const withoutBuild = decide({
      actions: [rejectedMove, hold()],
      obs: capObservation({
        unitCounts: {
          City: 1,
          Factory: 1,
          Port: 1,
          Warship: 1,
        },
      }),
      requestID: `c3-invalid-move-hold-${index}`,
    });
    assert.equal(withoutBuild.action.id, "hold");
    assert.equal(withoutBuild.action.policyMarker, "hncap");
  }
});

test("an observed Warship without a valid move cannot trigger another build", () => {
  const result = decide({
    actions: [warship(), hold()],
    obs: capObservation({
      unitCounts: {
        City: 1,
        Factory: 1,
        Port: 1,
        Warship: 1,
      },
    }),
    requestID: "c3-observed-no-rebuild",
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");
  assert.equal(result.nextState.naval.capEscapeBuilds, 0);
});

test("Warship build ID binds a numeric build anchor when metadata exposes it", () => {
  const malformed = warship();
  malformed.metadata.buildTile = 500240;
  const result = decide({
    actions: [malformed, hold()],
    requestID: "c3-warship-build-anchor-mismatch",
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");

  const replayBuild = replayDecision({
    turn: 300,
    id: malformed.id,
    kind: "warship",
    metadata: malformed.metadata,
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: {
      type: "build_unit",
      unit: "Warship",
      tile: malformed.metadata.targetTile,
    },
  });
  const report = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    replayBuild,
  ]));
  assert.equal(report.checks.marker_semantics_valid, false);
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /matching optional buildTile/,
  );
});

test("the first build increments once and a second cap-escape build is blocked", () => {
  const actions = [warship(), neutralBoat(500242, 16), hold()];
  const first = decide({
    actions,
    requestID: "c3-build-bound-1",
  });
  const second = decide({
    actions,
    state: first.nextState,
    requestID: "c3-build-bound-2",
  });
  assert.equal(first.action.kind, "warship");
  assert.equal(first.nextState.naval.capEscapeBuilds, 1);
  assert.equal(second.action.id, "hold");
  assert.equal(second.action.policyMarker, "hncap");
  assert.equal(second.nextState.naval.capEscapeBuilds, 1);
  assert.equal(second.nextState.naval.blocked, true);
});

test("a config override cannot widen the one-build cap", () => {
  const actions = [warship(), hold()];
  const first = decide({
    actions,
    requestID: "c3-fixed-bound-1",
    config: { navalCapWarshipBuildLimit: 2 },
  });
  const second = decide({
    actions,
    state: first.nextState,
    requestID: "c3-fixed-bound-2",
    config: { navalCapWarshipBuildLimit: 2 },
  });
  assert.equal(first.action.kind, "warship");
  assert.equal(second.action.id, "hold");
  assert.equal(second.nextState.naval.capEscapeBuilds, 1);
});

test("duplicate request replay cannot increment capEscapeBuilds twice", () => {
  const actions = [warship(), hold()];
  const first = decide({
    actions,
    requestID: "c3-duplicate",
  });
  const duplicate = decide({
    actions,
    state: first.nextState,
    requestID: "c3-duplicate",
  });
  assert.equal(first.action.kind, "warship");
  assert.equal(duplicate.action.id, first.action.id);
  assert.equal(duplicate.telemetry.duplicateRequest, true);
  assert.equal(first.nextState.naval.capEscapeBuilds, 1);
  assert.equal(duplicate.nextState.naval.capEscapeBuilds, 1);
});

test("without a latched cap, enabled C3 is action-identical to exact C2", () => {
  const actions = [warship(), neutralBoat(500242, 16), hold()];
  const state = cappedState({
    naval: {
      attempts: 1,
      noProgress: 1,
      blocked: false,
      capEscapeBuilds: 0,
    },
  });
  const enabled = decide({
    actions,
    state,
    requestID: "c3-pre-cap-enabled",
  });
  const parent = decide({
    actions,
    state,
    requestID: "c3-pre-cap-parent",
    config: { enableCapEscape: false },
  });
  assert.equal(enabled.action.id, parent.action.id);
  assert.equal(enabled.action.policyMarker, parent.action.policyMarker);
  assert.notEqual(enabled.action.policyMarker, "hks1");
  assert.equal(enabled.action.evidenceMarkers.includes("hncap"), false);
});

test("enableCapEscape false preserves the exact C2 cap hold", () => {
  const result = decide({
    actions: [warship(), neutralBoat(500242, 16), hold()],
    requestID: "c3-disabled",
    config: { enableCapEscape: false },
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");
  assert.deepEqual(result.action.evidenceMarkers, []);
  assert.equal(result.nextState.naval.capEscapeBuilds, 0);
});

test("exact C2 holds with observed Warship plus legal move and build", () => {
  const result = decide({
    actions: [moveWarship(), warship(), hold()],
    obs: capObservation({
      unitCounts: {
        City: 1,
        Factory: 1,
        Port: 1,
        Warship: 1,
      },
    }),
    requestID: "c2-observed-warship-control",
    config: { enableCapEscape: false },
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");
});

test("donations never enter the bounded cap-escape selector", () => {
  const odin = rival({
    id: "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    name: "K1Z odin free",
  });
  const donate = action(
    `donate_troops:${odin.id}`,
    "donate_troops",
    "Donate troops",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const result = decide({
    actions: [donate, neutralBoat(500242, 16), hold()],
    obs: capObservation({ rivals: [odin] }),
    requestID: "c3-no-donations",
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");
});

test("cap escape excludes K1Z and ambiguous boats, destructive, and social actions", () => {
  const odin = rival({
    id: "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    name: "K1Z odin free",
  });
  const twinA = rival({ id: "twin-a", name: "Twin" });
  const twinB = rival({ id: "twin-b", name: "Twin" });
  const actions = [
    action(
      `boat:${odin.id}:25`,
      "boat",
      "Invade K1Z odin free 25%",
      {
        targetID: odin.id,
        targetName: odin.name,
        invasion: true,
        troopPercent: 25,
      },
    ),
    action("boat:twin:25", "boat", "Invade Twin 25%", {
      targetName: "Twin",
      invasion: true,
      troopPercent: 25,
    }),
    action("delete_unit:warship-1", "delete_unit", "Delete Warship"),
    action("quick_chat:1", "quick_chat", "Quick chat"),
    action("emoji:1", "emoji", "Emoji"),
    hold(),
  ];
  const result = decide({
    actions,
    obs: capObservation({ rivals: [odin, twinA, twinB] }),
    requestID: "c3-exclusions",
  });
  assert.equal(result.action.id, "hold");
  assert.equal(result.action.policyMarker, "hncap");
  assert.equal(result.telemetry.safetyRejectedCount, 2);
});

test("hks1 marker rejects hold, donation, ordinary build, and missing hncap", () => {
  const cases = [
    action("hold", "hold", "Hold"),
    action(
      "donate_troops:runtime-odin",
      "donate_troops",
      "Donate troops",
      { recipientID: "runtime-odin" },
    ),
    action(
      "build:City:1",
      "build",
      "Build City",
      { unit: "City", targetTile: 1 },
    ),
    warship(),
  ];
  const evidence = [["hncap"], ["hncap"], ["hncap"], []];
  for (const [index, candidate] of cases.entries()) {
    const checked = validateHrafnMarkerSemantics({
      ...candidate,
      policyMarker: "hks1",
      evidenceMarkers: evidence[index],
      policyPhase: "RECOVERY",
    });
    assert.equal(checked.valid, false, candidate.kind);
  }
});

test("replay audit proves cap antecedent and strict hks1 build/move semantics", () => {
  const build = replayDecision({
    turn: 300,
    id: "build:Warship:500241",
    kind: "warship",
    metadata: {
      unit: "Warship",
      targetTile: 500241,
      unitCount: 0,
    },
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: { type: "build_unit", unit: "Warship", tile: 500241 },
  });
  const move = replayDecision({
    turn: 400,
    id: "move_warship:warship-1:500250",
    kind: "move_warship",
    metadata: {
      unitCount: 1,
      targetTile: 500250,
    },
    reason: "[K1Z] r4vn:mvw:hks1.hncap",
    intent: {
      type: "move_warship",
      unitIds: ["warship-1"],
      tile: 500250,
    },
  });
  const report = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    build,
    move,
  ]));
  assert.equal(report.cap_escape.accepted_naval_launches, 2);
  assert.equal(report.cap_escape.cap_antecedent_reached, true);
  assert.equal(report.cap_escape.cap_antecedent_first_turn, 200);
  assert.equal(report.cap_escape.hks1_builds, 1);
  assert.equal(report.cap_escape.hks1_moves, 1);
  assert.deepEqual(report.cap_escape.accepted_hks1_first_reach, {
    turn: 300,
    action_id: "build:Warship:500241",
    kind: "warship",
  });
  assert.deepEqual(report.cap_escape.hks1_first_reach, {
    turn: 300,
    action_id: "build:Warship:500241",
    kind: "warship",
  });
  assert.equal(
    report.cap_escape.owner_attribution.unavailable_moves,
    1,
  );
  assert.equal(report.checks.hks1_cap_antecedent_valid, true);
  assert.equal(report.checks.hks1_build_bound_valid, true);
  assert.equal(report.checks.hks1_owner_attribution_valid, true);
  assert.equal(report.checks.marker_semantics_valid, true);
  assert.equal(report.checks.submitted_effects_consistent, true);
});

test("hks1 replay reach must follow the cap antecedent by turn", () => {
  const build = replayDecision({
    turn: 300,
    id: "build:Warship:500241",
    kind: "warship",
    metadata: {
      unit: "Warship",
      targetTile: 500241,
      unitCount: 0,
    },
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: { type: "build_unit", unit: "Warship", tile: 500241 },
  });
  const report = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(400, 500239),
    acceptedLaunch(500, 500240),
    build,
  ]));
  assert.equal(report.checks.hks1_cap_antecedent_valid, false);
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /follow the second accepted naval launch by turn/,
  );
});

test("available non-Hrafn move owner attribution fails replay validation", () => {
  const move = replayDecision({
    turn: 300,
    id: "move_warship:warship-1:500250",
    kind: "move_warship",
    metadata: {
      unitCount: 1,
      targetTile: 500250,
      ownerPlayerID: "runtime-odin",
    },
    reason: "[K1Z] r4vn:mvw:hks1.hncap",
    intent: {
      type: "move_warship",
      unitIds: ["warship-1"],
      tile: 500250,
    },
  });
  const report = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    move,
  ]));
  assert.equal(report.checks.hks1_owner_attribution_valid, false);
  assert.equal(report.cap_escape.owner_attribution.invalid_moves, 1);
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /resolve uniquely to Hrafn/,
  );
});

test("pre-cap hks1 and a second hks1 build fail replay marker validation", () => {
  const builds = [100, 400].map((turn) =>
    replayDecision({
      turn,
      id: `build:Warship:${500000 + turn}`,
      kind: "warship",
      metadata: {
        unit: "Warship",
        targetTile: 500000 + turn,
        unitCount: 0,
      },
      reason: "[K1Z] r4vn:w4r:hks1.hncap",
      intent: {
        type: "build_unit",
        unit: "Warship",
        tile: 500000 + turn,
      },
    })
  );
  const report = auditHrafnChassisReplay(replayWith([
    builds[0],
    acceptedLaunch(200, 500239),
    acceptedLaunch(300, 500240),
    builds[1],
  ]));
  assert.equal(report.cap_escape.hks1_builds, 2);
  assert.equal(report.checks.hks1_cap_antecedent_valid, false);
  assert.equal(report.checks.hks1_build_bound_valid, false);
  assert.equal(report.checks.marker_semantics_valid, false);
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /independent naval cap antecedent/,
  );
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /at most one hks1 Warship build/,
  );
});

test("naval-cap hold audit still rejects Warship, move, and donation alternatives", () => {
  for (const [kind, id] of [
    ["warship", "build:Warship:500241"],
    ["move_warship", "move_warship:warship-1:500250"],
    ["donate_troops", "donate_troops:runtime-odin"],
    ["donate_gold", "donate_gold:runtime-odin"],
  ]) {
    const cappedHold = replayDecision({
      turn: 500,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hncap",
      intent: null,
    });
    cappedHold.legalActionIDs = ["hold", id];
    cappedHold.legalActionIDsByKind = {
      hold: ["hold"],
      [kind]: [id],
    };
    const report = auditHrafnChassisReplay(replayWith([cappedHold]));
    assert.equal(report.verified_holds.length, 0, kind);
    assert.equal(report.hold_evidence_gaps.length, 1, kind);
    assert.equal(report.checks.hold_evidence_complete, false, kind);
  }
});

test("fresh hks1 rejects all owner and player-target attribution", () => {
  const odin = rival({
    id: "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    name: "K1Z odin free",
  });
  const twinA = rival({ id: "twin-a", name: "Twin" });
  const twinB = rival({ id: "twin-b", name: "Twin" });
  const attributed = [
    {
      action: {
        ...moveWarship("warship-k1z", 500250),
        metadata: {
          ...moveWarship("warship-k1z", 500250).metadata,
          targetPlayerID: odin.id,
        },
      },
      obs: capObservation({
        rivals: [odin],
        unitCounts: {
          City: 1,
          Factory: 1,
          Port: 1,
          Warship: 1,
        },
      }),
    },
    {
      action: {
        ...moveWarship("warship-ambiguous", 500251),
        metadata: {
          ...moveWarship("warship-ambiguous", 500251).metadata,
          targetName: "Twin",
        },
      },
      obs: capObservation({
        rivals: [twinA, twinB],
        unitCounts: {
          City: 1,
          Factory: 1,
          Port: 1,
          Warship: 1,
        },
      }),
    },
    {
      action: {
        ...warship(500252),
        metadata: {
          ...warship(500252).metadata,
          ownerPlayerID: "runtime-hrafn",
        },
      },
      obs: capObservation(),
    },
    {
      action: {
        ...warship(500253),
        metadata: {
          ...warship(500253).metadata,
          targetPlayerName: "Twin",
        },
      },
      obs: capObservation({ rivals: [twinA, twinB] }),
    },
  ];
  for (const [index, candidate] of attributed.entries()) {
    const result = decide({
      actions: [candidate.action, hold()],
      obs: candidate.obs,
      requestID: `c3-attribution-fresh-${index}`,
    });
    assert.equal(result.action.id, "hold", candidate.action.id);
    assert.equal(result.action.policyMarker, "hncap", candidate.action.id);
    const semantic = validateHrafnMarkerSemantics({
      ...candidate.action,
      policyMarker: "hks1",
      evidenceMarkers: ["hncap"],
      policyPhase: "RECOVERY",
    });
    assert.equal(semantic.valid, false, candidate.action.id);
    assert.match(semantic.failures.join(" "), /attribution/i);
  }
});

test("duplicate hks1 replay fails closed when owner attribution drifts", () => {
  const clean = moveWarship("warship-cache", 500250);
  const obs = capObservation({
    unitCounts: {
      City: 1,
      Factory: 1,
      Port: 1,
      Warship: 1,
    },
  });
  const first = decide({
    actions: [clean, hold()],
    obs,
    requestID: "c3-owner-drift",
  });
  const drifted = {
    ...clean,
    metadata: {
      ...clean.metadata,
      ownerPlayerID: "runtime-outsider",
    },
  };
  const duplicate = decide({
    actions: [drifted, hold()],
    obs,
    state: first.nextState,
    requestID: "c3-owner-drift",
  });
  assert.equal(first.action.policyMarker, "hks1");
  assert.equal(duplicate.action.id, "hold");
  assert.equal(duplicate.action.policyMarker, "hhfc");
  assert.equal(duplicate.telemetry.duplicateRequest, true);
  assert.equal(duplicate.telemetry.cacheConflict, "cached-action-unsafe");
  assert.equal(
    duplicate.nextState.naval.capEscapeBuilds,
    first.nextState.naval.capEscapeBuilds,
  );
});

test("replay hks1 rejects Hrafn owner and player-target attribution", () => {
  const attributedMove = replayDecision({
    turn: 300,
    id: "move_warship:warship-1:500250",
    kind: "move_warship",
    metadata: {
      unitCount: 1,
      targetTile: 500250,
      ownerPlayerID: "runtime-hrafn",
    },
    reason: "[K1Z] r4vn:mvw:hks1.hncap",
    intent: {
      type: "move_warship",
      unitIds: ["warship-1"],
      tile: 500250,
    },
  });
  const attributedBuild = replayDecision({
    turn: 400,
    id: "build:Warship:500251",
    kind: "warship",
    metadata: {
      unit: "Warship",
      targetTile: 500251,
      unitCount: 0,
      targetPlayerID: "runtime-odin",
    },
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: {
      type: "build_unit",
      unit: "Warship",
      tile: 500251,
    },
  });
  const report = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    attributedMove,
    attributedBuild,
  ]));
  assert.equal(report.checks.hks1_attribution_valid, false);
  assert.equal(report.checks.marker_semantics_valid, false);
  assert.match(
    report.marker_failures.flatMap((failure) => failure.failures).join(" "),
    /attribution/i,
  );
});

test("hks1 tile and unit-count schema rejects coercible unsafe values", () => {
  const buildCases = [
    {
      ...warship(0),
      id: "build:Warship: ",
      metadata: { ...warship(0).metadata, targetTile: 0 },
    },
    {
      ...warship(1.5),
      id: "build:Warship:1.5",
      metadata: { ...warship(1.5).metadata, targetTile: 1.5 },
    },
    {
      ...warship(-1),
      id: "build:Warship:-1",
      metadata: { ...warship(-1).metadata, targetTile: -1 },
    },
    {
      ...warship(Number.MAX_SAFE_INTEGER + 1),
      id: `build:Warship:${Number.MAX_SAFE_INTEGER + 1}`,
      metadata: {
        ...warship(Number.MAX_SAFE_INTEGER + 1).metadata,
        targetTile: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, targetTile: null },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, targetTile: "" },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, targetTile: " " },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, targetTile: 1.5 },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, targetTile: -1 },
    },
    {
      ...warship(500241),
      metadata: {
        ...warship(500241).metadata,
        targetTile: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, buildTile: null },
    },
    {
      ...warship(500241),
      metadata: { ...warship(500241).metadata, buildTile: "" },
    },
  ];
  const moveCases = [
    {
      ...moveWarship("warship-1", 0),
      id: "move_warship:warship-1: ",
      metadata: { ...moveWarship("warship-1", 0).metadata, targetTile: 0 },
    },
    moveWarship("warship-1", 1.5),
    moveWarship("warship-1", -1),
    moveWarship("warship-1", Number.MAX_SAFE_INTEGER + 1),
    {
      ...moveWarship("warship-1", 0),
      metadata: { ...moveWarship("warship-1", 0).metadata, targetTile: null },
    },
    {
      ...moveWarship("warship-1", 0),
      metadata: { ...moveWarship("warship-1", 0).metadata, targetTile: "" },
    },
    {
      ...moveWarship("warship-1", 0),
      metadata: { ...moveWarship("warship-1", 0).metadata, targetTile: " " },
    },
    {
      ...moveWarship("warship-1", 500250),
      metadata: { ...moveWarship("warship-1", 500250).metadata, unitCount: null },
    },
    {
      ...moveWarship("warship-1", 500250),
      metadata: { ...moveWarship("warship-1", 500250).metadata, unitCount: "" },
    },
    {
      ...moveWarship("warship-1", 500250),
      metadata: { ...moveWarship("warship-1", 500250).metadata, unitCount: 1.5 },
    },
    {
      ...moveWarship("warship-1", 500250),
      metadata: { ...moveWarship("warship-1", 500250).metadata, unitCount: -1 },
    },
    {
      ...moveWarship("warship-1", 500250),
      metadata: {
        ...moveWarship("warship-1", 500250).metadata,
        unitCount: Number.MAX_SAFE_INTEGER + 1,
      },
    },
  ];
  for (const [kind, cases] of [
    ["build", buildCases],
    ["move", moveCases],
  ]) {
    for (const [index, candidate] of cases.entries()) {
      const result = decide({
        actions: [candidate, hold()],
        obs: kind === "move"
          ? capObservation({
              unitCounts: {
                City: 1,
                Factory: 1,
                Port: 1,
                Warship: 1,
              },
            })
          : capObservation(),
        requestID: `c3-strict-${kind}-${index}`,
      });
      assert.equal(result.action.id, "hold", `${kind}-${index}`);
      const semantic = validateHrafnMarkerSemantics({
        ...candidate,
        policyMarker: "hks1",
        evidenceMarkers: ["hncap"],
        policyPhase: "RECOVERY",
      });
      assert.equal(semantic.valid, false, `${kind}-${index}`);
    }
  }
});

test("replay cap antecedent is chronological, distinct, and exactly bounded", () => {
  const build = replayDecision({
    turn: 300,
    id: "build:Warship:500241",
    kind: "warship",
    metadata: {
      unit: "Warship",
      targetTile: 500241,
      unitCount: 0,
    },
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: { type: "build_unit", unit: "Warship", tile: 500241 },
  });
  const move = replayDecision({
    turn: 400,
    id: "move_warship:warship-1:500250",
    kind: "move_warship",
    metadata: { unitCount: 1, targetTile: 500250 },
    reason: "[K1Z] r4vn:mvw:hks1.hncap",
    intent: {
      type: "move_warship",
      unitIds: ["warship-1"],
      tile: 500250,
    },
  });
  const outOfJsonlOrder = auditHrafnChassisReplay(replayWith([
    move,
    acceptedLaunch(200, 500240),
    build,
    acceptedLaunch(100, 500239),
  ]));
  assert.equal(outOfJsonlOrder.checks.hks1_cap_antecedent_valid, true);
  assert.equal(outOfJsonlOrder.checks.hks1_naval_launch_bound_valid, true);
  assert.deepEqual(outOfJsonlOrder.cap_escape.accepted_hks1_first_reach, {
    turn: 300,
    action_id: "build:Warship:500241",
    kind: "warship",
  });

  const duplicateTurn = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239, "req-launch-a"),
    acceptedLaunch(100, 500240, "req-launch-b"),
    build,
  ]));
  assert.equal(duplicateTurn.checks.hks1_naval_launch_bound_valid, false);
  assert.equal(duplicateTurn.checks.hks1_cap_antecedent_valid, false);
  assert.match(
    duplicateTurn.cap_escape.naval_launch_failures
      .map((failure) => failure.failure)
      .join(" "),
    /duplicate accepted naval launch turn/i,
  );

  const duplicateRequest = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239, "req-launch-same"),
    acceptedLaunch(200, 500240, "req-launch-same"),
    build,
  ]));
  assert.equal(duplicateRequest.checks.hks1_naval_launch_bound_valid, false);
  assert.match(
    duplicateRequest.cap_escape.naval_launch_failures
      .map((failure) => failure.failure)
      .join(" "),
    /duplicate accepted naval launch request/i,
  );

  const thirdLaunch = auditHrafnChassisReplay(replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    acceptedLaunch(250, 500241),
    build,
  ]));
  assert.equal(thirdLaunch.cap_escape.accepted_naval_launches, 3);
  assert.equal(thirdLaunch.checks.hks1_naval_launch_bound_valid, false);
  assert.match(
    thirdLaunch.cap_escape.naval_launch_failures
      .map((failure) => failure.failure)
      .join(" "),
    /at most two accepted naval launches/i,
  );
});

test("duplicate runtime ID with conflicting canonical identities fails replay audit", () => {
  const build = replayDecision({
    turn: 300,
    id: "build:Warship:500241",
    kind: "warship",
    metadata: {
      unit: "Warship",
      targetTile: 500241,
      unitCount: 0,
    },
    reason: "[K1Z] r4vn:w4r:hks1.hncap",
    intent: { type: "build_unit", unit: "Warship", tile: 500241 },
  });
  const replay = replayWith([
    acceptedLaunch(100, 500239),
    acceptedLaunch(200, 500240),
    build,
  ]);
  replay.finalState.players.push({
    username: "Outsider",
    playerID: "runtime-hrafn",
  });
  const report = auditHrafnChassisReplay(replay);
  assert.equal(report.hrafn_identity_verified, false);
  assert.equal(report.checks.runtime_identities_consistent, false);
  assert.equal(report.runtime_identity_conflicts.length, 1);
  assert.deepEqual(
    report.runtime_identity_conflicts[0].canonical_names,
    ["hrafn", "outsider"],
  );
});

test("hold proof rejects by-kind misbucketing and productive ID prefixes", () => {
  const cases = [
    {
      legal: ["hold", "quick_chat:1"],
      byKind: {
        quick_chat: ["hold"],
        hold: ["quick_chat:1"],
      },
    },
    {
      legal: ["hold", "build:Warship:500241"],
      byKind: {
        hold: ["hold"],
        quick_chat: ["build:Warship:500241"],
      },
    },
    {
      legal: ["hold", "upgrade:City:1"],
      byKind: {
        hold: ["hold"],
        quick_chat: ["upgrade:City:1"],
      },
    },
    {
      legal: ["hold", "move_warship:warship-1:500250"],
      byKind: {
        hold: ["hold"],
        quick_chat: ["move_warship:warship-1:500250"],
      },
    },
    {
      legal: ["hold", "donate_gold:runtime-outsider"],
      byKind: {
        hold: ["hold"],
        quick_chat: ["donate_gold:runtime-outsider"],
      },
    },
  ];
  for (const [index, candidate] of cases.entries()) {
    const cappedHold = replayDecision({
      turn: 500 + index,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hncap",
      intent: null,
    });
    cappedHold.legalActionIDs = candidate.legal;
    cappedHold.legalActionIDsByKind = candidate.byKind;
    const report = auditHrafnChassisReplay(replayWith([cappedHold]));
    assert.equal(report.verified_holds.length, 0, String(index));
    assert.equal(report.hold_evidence_gaps.length, 1, String(index));
    assert.equal(
      report.hold_evidence_gaps[0].legal_kind_coverage_complete,
      false,
      String(index),
    );
    assert.equal(report.checks.hold_evidence_complete, false, String(index));
  }
});
