import assert from "node:assert/strict";
import test from "node:test";

import {
  auditHrafnChassisReplay,
  parseHrafnChassisReason,
} from "../scripts/audit-hrafn-chassis-replay.mjs";

function replayWith(decisions) {
  return {
    gameID: "test-game",
    inlineRunArtifacts: {
      "decisions.jsonl": `${decisions.map((decision) =>
        JSON.stringify(decision)
      ).join("\n")}\n`,
    },
    finalState: {
      players: [
        {
          username: "K1Z Hrafn",
          playerID: "runtime-hrafn",
        },
        {
          username: "K1Z odin free",
          playerID: "runtime-odin",
        },
        {
          username: "Outsider",
          playerID: "runtime-outsider",
        },
      ],
    },
  };
}

function decision({
  turn,
  id,
  kind,
  metadata = {},
  reason,
  legal = [id],
  legalByKind = { [kind]: [id] },
  accepted = true,
  fallbackUsed = false,
  intent,
}) {
  const inferredTroops = Number(
    metadata.troops ??
    metadata.troopPercent ??
    id.split(":").at(-1),
  );
  const selectedMetadata =
    (kind === "attack" || kind === "boat") &&
      !Number.isFinite(Number(metadata.troops))
      ? {
          ...metadata,
          troops: Number.isFinite(inferredTroops) ? inferredTroops : 1,
        }
      : metadata;
  const targetID = String(
    selectedMetadata.targetID ??
    selectedMetadata.recipientID ??
    id.split(":")[1] ??
    "",
  );
  const submittedIntent = (() => {
    switch (kind) {
      case "hold":
        return null;
      case "spawn":
        return { type: "spawn", tile: selectedMetadata.tile };
      case "attack":
        return {
          type: "attack",
          targetID: id.startsWith("expand:") ? null : targetID,
          troops: selectedMetadata.troops,
        };
      case "build":
      case "warship":
        return {
          type: "build_unit",
          unit: selectedMetadata.unit,
          tile: selectedMetadata.targetTile ?? selectedMetadata.buildTile,
        };
      case "boat":
        return {
          type: "boat",
          dst: selectedMetadata.targetTile,
          troops: selectedMetadata.troops,
        };
      case "boat_retreat":
        return { type: "cancel_boat", unitID: selectedMetadata.unitID };
      case "retreat":
        return {
          type: "cancel_attack",
          attackID: selectedMetadata.attackID,
        };
      case "upgrade_structure":
        return {
          type: "upgrade_structure",
          unit: selectedMetadata.unit,
          unitId: selectedMetadata.unitID,
        };
      case "move_warship":
        return {
          type: "move_warship",
          unitIds: [id.split(":")[1]],
          tile: selectedMetadata.targetTile,
        };
      case "donate_troops":
      case "donate_gold":
        return { type: kind, recipient: targetID };
      case "alliance_request":
        return { type: "allianceRequest", recipient: targetID };
      case "alliance_extend":
        return { type: "allianceExtension", recipient: targetID };
      case "nuke":
        return {
          type: "build_unit",
          unit: selectedMetadata.unit,
          tile: selectedMetadata.targetTile,
        };
      default:
        return { type: kind };
    }
  })();
  return {
    username: "K1Z Hrafn",
    turnNumber: turn,
    selectedLegalActionId: id,
    selectedActionKind: kind,
    selectedActionMetadata: selectedMetadata,
    legalActionIDs: legal,
    legalActionIDsByKind: legalByKind,
    reason,
    fallbackUsed,
    llmPlannerDegraded: false,
    auditBefore: { playerID: "runtime-hrafn" },
    result: {
      accepted,
      submittedIntent: intent === undefined ? submittedIntent : intent,
    },
  };
}

test("reason parser separates the primary marker from sidecar evidence", () => {
  assert.deepEqual(
    parseHrafnChassisReason("[K1Z] r4vn:atk:hc40.hint.hpri"),
    {
      valid: true,
      kindCode: "atk",
      primaryMarker: "hc40",
      evidenceMarkers: ["hint", "hpri"],
    },
  );
  assert.equal(parseHrafnChassisReason("not tagged").valid, false);
  assert.equal(
    parseHrafnChassisReason("[K1Z] r4vn:attack:hc40").valid,
    false,
  );
  assert.deepEqual(
    parseHrafnChassisReason("[K1Z] r4vn:atk:rv3.hi1.q0123456789"),
    {
      valid: true,
      kindCode: "atk",
      primaryMarker: "rv3",
      evidenceMarkers: ["hi1", "q0123456789"],
    },
  );
  assert.equal(
    parseHrafnChassisReason("[K1Z] r4vn:atk:rv3.q01234").valid,
    true,
    "legacy short policy tokens remain legal even when they begin with q",
  );
  assert.equal(
    parseHrafnChassisReason("[K1Z] r4vn:atk:rv3.q01234567890").valid,
    false,
  );
});

test("clean candidate replay passes freshness, safety, marker, and hold checks", () => {
  const replay = replayWith([
    decision({
      turn: 100,
      id: "expand:terra-nullius:35",
      kind: "attack",
      metadata: { expansion: true, troopPercent: 35 },
      reason: "[K1Z] r4vn:atk:hg35",
    }),
    decision({
      turn: 200,
      id: "attack:runtime-outsider:40",
      kind: "attack",
      metadata: {
        targetID: "runtime-outsider",
        targetName: "Outsider",
        troopPercent: 40,
      },
      reason: "[K1Z] r4vn:atk:hc40.hint",
    }),
    decision({
      turn: 300,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
      legal: ["hold"],
      legalByKind: { hold: ["hold"] },
    }),
  ]);
  const report = auditHrafnChassisReplay(
    replay,
    Buffer.from(JSON.stringify(replay)),
  );
  assert.equal(report.policy_decisions, 3);
  assert.equal(report.accepted, 3);
  assert.equal(report.holds, 1);
  assert.equal(report.explained_holds.length, 1);
  assert.equal(report.verified_holds.length, 1);
  assert.equal(report.hold_evidence_gaps.length, 0);
  assert.deepEqual(report.marker_counts, {
    hg35: 1,
    hc40: 1,
    hint: 1,
    hhfc: 1,
  });
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.match(report.replay_sha256, /^[a-f0-9]{64}$/);
});

test("tracked submitted-intent schema covers every candidate-emittable kind", () => {
  const decisions = [
    decision({
      turn: 10,
      id: "spawn:7",
      kind: "spawn",
      metadata: { tile: 7 },
      reason: "[K1Z] r4vn:spn",
    }),
    decision({
      turn: 20,
      id: "expand:terra-nullius:35",
      kind: "attack",
      metadata: { expansion: true, troopPercent: 35 },
      reason: "[K1Z] r4vn:atk:hg35",
    }),
    decision({
      turn: 30,
      id: "build:City:100",
      kind: "build",
      metadata: { unit: "City", targetTile: 100, buildTile: 100 },
      reason: "[K1Z] r4vn:bld:hec1",
    }),
    decision({
      turn: 40,
      id: "boat:runtime-outsider:25",
      kind: "boat",
      metadata: {
        targetID: "runtime-outsider",
        targetName: "Outsider",
        targetTile: 200,
        invasion: true,
        troopPercent: 25,
      },
      reason: "[K1Z] r4vn:b0t:hni25",
    }),
    decision({
      turn: 50,
      id: "retreat:attack-1",
      kind: "retreat",
      metadata: { attackID: "attack-1" },
      reason: "[K1Z] r4vn:rtr:hdef",
    }),
    decision({
      turn: 60,
      id: "boat_retreat:92",
      kind: "boat_retreat",
      metadata: { unitID: 92 },
      reason: "[K1Z] r4vn:rtr:hdef",
    }),
    decision({
      turn: 70,
      id: "upgrade:City:5",
      kind: "upgrade_structure",
      metadata: { unit: "City", unitID: 5 },
      reason: "[K1Z] r4vn:upg:hdef",
    }),
    decision({
      turn: 80,
      id: "build:Warship:300",
      kind: "warship",
      metadata: { unit: "Warship", targetTile: 301, buildTile: 300 },
      reason: "[K1Z] r4vn:w4r:hdef",
    }),
    decision({
      turn: 90,
      id: "move_warship:1223:400",
      kind: "move_warship",
      metadata: { targetTile: 400 },
      reason: "[K1Z] r4vn:mvw:hdef",
    }),
    decision({
      turn: 100,
      id: "alliance:runtime-odin",
      kind: "alliance_request",
      metadata: {
        recipientID: "runtime-odin",
        recipientName: "K1Z odin free",
      },
      reason: "[K1Z] r4vn:4ly:hka1",
    }),
    decision({
      turn: 110,
      id: "alliance_extend:runtime-odin",
      kind: "alliance_extend",
      metadata: {
        recipientID: "runtime-odin",
        recipientName: "K1Z odin free",
      },
      reason: "[K1Z] r4vn:4ly:hka1",
    }),
    decision({
      turn: 120,
      id: "donate_troops:runtime-odin",
      kind: "donate_troops",
      metadata: {
        recipientID: "runtime-odin",
        recipientName: "K1Z odin free",
      },
      reason: "[K1Z] r4vn:dnt:hkf1",
    }),
    decision({
      turn: 130,
      id: "donate_gold:runtime-odin",
      kind: "donate_gold",
      metadata: {
        recipientID: "runtime-odin",
        recipientName: "K1Z odin free",
      },
      reason: "[K1Z] r4vn:dnt:hkf1",
    }),
    decision({
      turn: 140,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
      legal: ["hold"],
      legalByKind: { hold: ["hold"] },
    }),
  ];
  const report = auditHrafnChassisReplay(replayWith(decisions));
  assert.equal(report.policy_decisions, decisions.length);
  assert.deepEqual(report.effect_consistency_failures, []);
  assert.equal(Object.values(report.checks).every(Boolean), true);
});

test("port submitted intent binds the water target rather than its land anchor", () => {
  const port = decision({
    turn: 4900,
    id: "build:Port:142163",
    kind: "build",
    metadata: {
      unit: "Port",
      targetTile: 141677,
      buildTile: 142163,
    },
    reason: "[K1Z] r4vn:bld:hec1",
  });
  const report = auditHrafnChassisReplay(replayWith([port]));
  assert.deepEqual(report.effect_consistency_failures, []);

  const anchored = structuredClone(port);
  anchored.result.submittedIntent.tile = 142163;
  const anchoredReport = auditHrafnChassisReplay(replayWith([anchored]));
  assert.equal(anchoredReport.effect_consistency_failures.length, 1);
  assert.match(
    anchoredReport.effect_consistency_failures[0].failures.join(" "),
    /build tile/,
  );
});

test("obsolete submitted-intent type aliases fail closed", () => {
  const cases = [
    decision({
      turn: 150,
      id: "boat_retreat:92",
      kind: "boat_retreat",
      metadata: { unitID: 92 },
      reason: "[K1Z] r4vn:rtr:hdef",
      intent: { type: "boat_retreat", unitID: 92 },
    }),
    decision({
      turn: 160,
      id: "upgrade:City:5",
      kind: "upgrade_structure",
      metadata: { unit: "City", unitID: 5 },
      reason: "[K1Z] r4vn:upg:hdef",
      intent: { type: "upgrade_unit", unit: "City", unitId: 5 },
    }),
    decision({
      turn: 170,
      id: "alliance_extend:runtime-odin",
      kind: "alliance_extend",
      metadata: {
        recipientID: "runtime-odin",
        recipientName: "K1Z odin free",
      },
      reason: "[K1Z] r4vn:4ly:hka1",
      intent: { type: "allianceRequest", recipient: "runtime-odin" },
    }),
  ];
  const report = auditHrafnChassisReplay(replayWith(cases));
  assert.equal(report.effect_consistency_failures.length, cases.length);
  assert.equal(report.checks.submitted_effects_consistent, false);
});

test("audit detects K1Z harm, stale IDs, rejection, fallback, and bad semantics", () => {
  const harmful = decision({
    turn: 400,
    id: "attack:runtime-odin:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-odin",
      targetName: "K1Z odin free",
      troopPercent: 25,
    },
    reason: "[K1Z] r4vn:atk:hc40.hctr",
    legal: ["hold"],
    legalByKind: { hold: ["hold"] },
    accepted: false,
    fallbackUsed: true,
  });
  const report = auditHrafnChassisReplay(replayWith([harmful]));
  assert.equal(report.harmful_k1z_actions.length, 1);
  assert.equal(report.freshness_failures.length, 1);
  assert.equal(report.marker_failures.length, 1);
  assert.equal(report.checks.all_decisions_accepted, false);
  assert.equal(report.checks.zero_rejections, false);
  assert.equal(report.checks.zero_fallbacks, false);
  assert.equal(report.checks.zero_k1z_harm, false);
  assert.equal(report.checks.marker_semantics_valid, false);
  assert.equal(report.checks.selected_ids_were_legal, false);
});

test("missing fallback and planner evidence fails closed", () => {
  const incomplete = decision({
    turn: 450,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hhfc",
    legal: ["hold"],
    legalByKind: { hold: ["hold"] },
  });
  delete incomplete.fallbackUsed;
  delete incomplete.llmPlannerDegraded;
  const report = auditHrafnChassisReplay(replayWith([incomplete]));
  assert.equal(report.fallback_evidence_failures.length, 1);
  assert.equal(report.planner_degradation_failures.length, 1);
  assert.equal(report.checks.fallback_evidence_complete, false);
  assert.equal(report.checks.zero_fallbacks, false);
  assert.equal(report.checks.zero_planner_degradation, false);
});

test("an unmarked hold stays unexplained even when its public text parses", () => {
  const unmarked = decision({
    turn: 500,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d",
    legal: ["hold", "build:City:100"],
    legalByKind: {
      hold: ["hold"],
      build: ["build:City:100"],
    },
  });
  const report = auditHrafnChassisReplay(replayWith([unmarked]));
  assert.equal(report.public_reason_failures.length, 0);
  assert.equal(report.unexplained_holds.length, 1);
  assert.deepEqual(
    report.unexplained_holds[0].offered_non_hold_kinds,
    ["build"],
  );
  assert.equal(report.checks.zero_unexplained_holds, false);
});

test("marked hold intent is separated from independent replay proof", () => {
  const marked = decision({
    turn: 550,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hhfc",
    legal: ["hold", "build:City:100"],
    legalByKind: {
      hold: ["hold"],
      build: ["build:City:100"],
    },
  });
  const report = auditHrafnChassisReplay(replayWith([marked]));
  assert.equal(report.explained_holds.length, 1);
  assert.equal(report.unexplained_holds.length, 0);
  assert.equal(report.hold_evidence_gaps.length, 1);
  assert.equal(report.checks.zero_unexplained_holds, true);
  assert.equal(report.checks.hold_evidence_complete, false);
});

test("naval-cap hold is verified when replay proves recovery options exhausted", () => {
  const capped = decision({
    turn: 560,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hncap",
    legal: [
      "attack:runtime-outsider:10",
      "boat:100:16",
      "target:runtime-outsider",
      "hold",
    ],
    legalByKind: {
      attack: ["attack:runtime-outsider:10"],
      boat: ["boat:100:16"],
      target_player: ["target:runtime-outsider"],
      hold: ["hold"],
    },
  });
  capped.tacticalAffordances = {
    frontierConversionTiming: {
      hostileAttackActionCount: 1,
      favorableHostileAttackActionCount: 0,
    },
  };
  const report = auditHrafnChassisReplay(replayWith([capped]));
  assert.equal(report.verified_holds.length, 1);
  assert.equal(report.hold_evidence_gaps.length, 0);
  assert.equal(report.checks.hold_evidence_complete, true);
});

test("naval-cap hold fails proof if land, utility, or favorable combat remains", () => {
  const cases = [
    {
      id: "expand:terra-nullius:35",
      kind: "attack",
      conversion: {
        hostileAttackActionCount: 0,
        favorableHostileAttackActionCount: 0,
      },
    },
    {
      id: "build:City:100",
      kind: "build",
      conversion: {
        hostileAttackActionCount: 0,
        favorableHostileAttackActionCount: 0,
      },
    },
    {
      id: "attack:runtime-outsider:10",
      kind: "attack",
      conversion: {
        hostileAttackActionCount: 1,
        favorableHostileAttackActionCount: 1,
      },
    },
  ];
  for (const [index, alternative] of cases.entries()) {
    const capped = decision({
      turn: 565 + index,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hncap",
      legal: ["hold", alternative.id],
      legalByKind: {
        hold: ["hold"],
        [alternative.kind]: [alternative.id],
      },
    });
    capped.tacticalAffordances = {
      frontierConversionTiming: alternative.conversion,
    };
    const report = auditHrafnChassisReplay(replayWith([capped]));
    assert.equal(report.verified_holds.length, 0);
    assert.equal(report.hold_evidence_gaps.length, 1);
  }
});

test("hold verification fails closed when by-kind coverage is absent", () => {
  const incomplete = decision({
    turn: 575,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hhfc",
    legal: ["hold", "build:City:100"],
    legalByKind: undefined,
  });
  delete incomplete.legalActionIDsByKind;
  const report = auditHrafnChassisReplay(replayWith([incomplete]));
  assert.equal(report.explained_holds.length, 1);
  assert.equal(report.verified_holds.length, 0);
  assert.equal(report.hold_evidence_gaps.length, 1);
  assert.equal(
    report.hold_evidence_gaps[0].legal_kind_coverage_complete,
    false,
  );
  assert.deepEqual(
    report.hold_evidence_gaps[0].offered_non_hold_ids,
    ["build:City:100"],
  );
  assert.equal(report.checks.hold_evidence_complete, false);
});

test("hold-like IDs under a productive kind cannot pass hold verification", () => {
  const misleading = decision({
    turn: 590,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hhfc",
    legal: ["hold", "hold:fake-build"],
    legalByKind: {
      hold: ["hold"],
      build: ["hold:fake-build"],
    },
  });
  const report = auditHrafnChassisReplay(replayWith([misleading]));
  assert.equal(report.verified_holds.length, 0);
  assert.equal(report.hold_evidence_gaps.length, 1);
  assert.deepEqual(
    report.hold_evidence_gaps[0].offered_non_hold_kinds,
    ["build"],
  );
  assert.equal(report.checks.hold_evidence_complete, false);
});

test("sidecar markers cannot appear on unrelated action families", () => {
  const invalid = decision({
    turn: 600,
    id: "build:City:100",
    kind: "build",
    metadata: { unit: "City" },
    reason: "[K1Z] r4vn:bld:hec1.hctr",
  });
  const report = auditHrafnChassisReplay(replayWith([invalid]));
  assert.equal(report.marker_failures.length, 1);
  assert.match(
    report.marker_failures[0].failures.join(" "),
    /hctr requires a combat primary marker/,
  );
});

test("audit rejects wrong public kind codes and neutral combat markers", () => {
  const wrongKind = decision({
    turn: 700,
    id: "build:City:100",
    kind: "build",
    metadata: { unit: "City" },
    reason: "[K1Z] r4vn:atk:hec1",
  });
  const neutralCombat = decision({
    turn: 800,
    id: "expand:terra-nullius:40",
    kind: "attack",
    metadata: { expansion: true, troopPercent: 40 },
    reason: "[K1Z] r4vn:atk:hc40",
  });
  const report = auditHrafnChassisReplay(
    replayWith([wrongKind, neutralCombat]),
  );
  assert.equal(report.public_reason_failures.length, 1);
  assert.equal(report.marker_failures.length, 1);
  assert.equal(report.checks.public_text_valid, false);
  assert.equal(report.checks.marker_semantics_valid, false);
});

test("audit rejects outsider hkf1 donations and unmarked hostile actions", () => {
  const outsiderDonation = decision({
    turn: 900,
    id: "donate:runtime-outsider",
    kind: "donate_troops",
    metadata: {
      recipientID: "runtime-outsider",
      recipientName: "Outsider",
    },
    reason: "[K1Z] r4vn:dnt:hkf1",
  });
  const unmarkedHostile = decision({
    turn: 1000,
    id: "attack:runtime-outsider:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-outsider",
      targetName: "Outsider",
      troopPercent: 25,
    },
    reason: "[K1Z] r4vn:atk",
  });
  const report = auditHrafnChassisReplay(
    replayWith([outsiderDonation, unmarkedHostile]),
  );
  assert.equal(report.marker_failures.length, 2);
  assert.equal(report.checks.marker_semantics_valid, false);
});

test("foreign tagged decisions are never attributed to Hrafn", () => {
  const foreign = {
    ...decision({
      turn: 1100,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
    }),
    username: "K1Z odin free",
  };
  const report = auditHrafnChassisReplay(replayWith([foreign]));
  assert.equal(report.foreign_tagged_decisions, 1);
  assert.equal(report.policy_decisions, 0);
  assert.equal(report.checks.hrafn_identity_verified, false);
  assert.equal(report.checks.decisions_present, false);
  assert.equal(report.checks.zero_foreign_tagged_decisions, false);
});

test("foreign tagged rows fail attribution even beside valid Hrafn rows", () => {
  const own = decision({
    turn: 1110,
    id: "hold",
    kind: "hold",
    reason: "[K1Z] r4vn:h0d:hhfc",
    legal: ["hold"],
    legalByKind: { hold: ["hold"] },
  });
  const foreign = {
    ...decision({
      turn: 1120,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
      legal: ["hold"],
      legalByKind: { hold: ["hold"] },
    }),
    username: "K1Z odin free",
  };
  const report = auditHrafnChassisReplay(replayWith([own, foreign]));
  assert.equal(report.checks.hrafn_identity_verified, true);
  assert.equal(report.foreign_tagged_decisions, 1);
  assert.equal(report.checks.zero_foreign_tagged_decisions, false);
});

test("Hrafn decisions must bind to one unique Hrafn roster identity", () => {
  const replay = replayWith([
    decision({
      turn: 1130,
      id: "hold",
      kind: "hold",
      reason: "[K1Z] r4vn:h0d:hhfc",
      legal: ["hold"],
      legalByKind: { hold: ["hold"] },
    }),
  ]);
  replay.finalState.players.push({
    username: "K1Z Hrafn",
    playerID: "conflicting-hrafn",
  });
  const report = auditHrafnChassisReplay(replay);
  assert.equal(report.checks.hrafn_identity_verified, false);
});

test("malformed public text cannot hide K1Z harm", () => {
  const harmful = decision({
    turn: 1200,
    id: "attack:runtime-odin:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-odin",
      targetName: "K1Z odin free",
      troopPercent: 25,
    },
    reason: "malformed",
  });
  const report = auditHrafnChassisReplay(replayWith([harmful]));
  assert.equal(report.public_reason_failures.length, 1);
  assert.equal(report.harmful_k1z_actions.length, 1);
  assert.equal(report.checks.zero_k1z_harm, false);
});

test("ID-encoded K1Z harm is detected without selected metadata", () => {
  const harmful = decision({
    turn: 1300,
    id: "attack:runtime-odin:25",
    kind: "attack",
    reason: "[K1Z] r4vn:atk:hc25",
  });
  const report = auditHrafnChassisReplay(replayWith([harmful]));
  assert.equal(report.harmful_k1z_actions.length, 1);
  assert.equal(report.checks.zero_k1z_harm, false);
});

test("opaque harmful targets fail replay resolution", () => {
  const harmful = decision({
    turn: 1400,
    id: "attack:opaque-target:25",
    kind: "attack",
    reason: "[K1Z] r4vn:atk:hc25.hpri",
  });
  const report = auditHrafnChassisReplay(replayWith([harmful]));
  assert.equal(report.harm_target_failures.length, 1);
  assert.match(
    report.harm_target_failures[0].failure,
    /unresolved harmful target/,
  );
  assert.equal(report.checks.harmful_targets_resolved, false);
});

test("duplicate replay names remain ambiguous without a target ID", () => {
  const replay = replayWith([
    decision({
      turn: 1500,
      id: "attack:twin:25",
      kind: "attack",
      metadata: { targetName: "Twin", troopPercent: 25 },
      reason: "[K1Z] r4vn:atk:hc25.hpri",
    }),
  ]);
  replay.finalState.players.push(
    { username: "Twin", playerID: "twin-1" },
    { username: "Twin", playerID: "twin-2" },
  );
  const report = auditHrafnChassisReplay(replay);
  assert.equal(report.harm_target_failures.length, 1);
  assert.equal(
    report.harm_target_failures[0].failure,
    "ambiguous harmful target",
  );
  assert.equal(report.checks.harmful_targets_resolved, false);
});

test("conflicting replay target signals fail closed", () => {
  const harmful = decision({
    turn: 1600,
    id: "attack:runtime-outsider:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-odin",
      targetName: "K1Z odin free",
      troopPercent: 25,
    },
    reason: "[K1Z] r4vn:atk:hc25.hpri",
  });
  const report = auditHrafnChassisReplay(replayWith([harmful]));
  assert.equal(report.harm_target_failures.length, 1);
  assert.equal(
    report.harm_target_failures[0].failure,
    "ambiguous harmful target",
  );
  assert.equal(report.checks.harmful_targets_resolved, false);
});

test("submitted server intent cannot redirect harm to K1Z", () => {
  const redirected = decision({
    turn: 1700,
    id: "attack:runtime-outsider:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-outsider",
      targetName: "Outsider",
      troopPercent: 25,
    },
    reason: "[K1Z] r4vn:atk:hc25.hpri",
  });
  redirected.result.submittedIntent = {
    type: "attack",
    targetID: "runtime-odin",
  };
  const report = auditHrafnChassisReplay(replayWith([redirected]));
  assert.equal(report.effect_consistency_failures.length, 1);
  assert.equal(report.checks.submitted_effects_consistent, false);
  assert.equal(report.checks.zero_k1z_harm, false);
});

test("neutral selected action cannot submit a hidden K1Z player target", () => {
  const redirected = decision({
    turn: 1750,
    id: "expand:terra-nullius:35",
    kind: "attack",
    metadata: { expansion: true, troopPercent: 35 },
    reason: "[K1Z] r4vn:atk:hg35",
    intent: { type: "attack", targetID: "runtime-odin" },
  });
  const report = auditHrafnChassisReplay(replayWith([redirected]));
  assert.equal(report.effect_consistency_failures.length, 1);
  assert.match(
    report.effect_consistency_failures[0].failures.join(" "),
    /neutral selected action submitted a player target/,
  );
  assert.equal(report.harmful_k1z_actions.length, 1);
  assert.equal(report.checks.submitted_effects_consistent, false);
  assert.equal(report.checks.zero_k1z_harm, false);
});

test("same-type attack intent cannot change the selected troop count", () => {
  const altered = decision({
    turn: 1775,
    id: "attack:runtime-outsider:25",
    kind: "attack",
    metadata: {
      targetID: "runtime-outsider",
      targetName: "Outsider",
      troopPercent: 25,
      troops: 25000,
    },
    reason: "[K1Z] r4vn:atk:hc25",
    intent: {
      type: "attack",
      targetID: "runtime-outsider",
      troops: 10000,
    },
  });
  const report = auditHrafnChassisReplay(replayWith([altered]));
  assert.equal(report.effect_consistency_failures.length, 1);
  assert.match(
    report.effect_consistency_failures[0].failures.join(" "),
    /attack troops/,
  );
  assert.equal(report.checks.submitted_effects_consistent, false);
});

test("nuclear submitted intent binds the selected unit and target tile", () => {
  const valid = decision({
    turn: 1800,
    id: "build:Atom Bomb:300",
    kind: "nuke",
    metadata: {
      unit: "Atom Bomb",
      targetID: "runtime-outsider",
      targetName: "Outsider",
      targetTile: 900,
      buildTile: 300,
    },
    reason: "[K1Z] r4vn:act:hhfc",
  });
  const validReport = auditHrafnChassisReplay(replayWith([valid]));
  assert.deepEqual(validReport.effect_consistency_failures, []);

  const redirected = structuredClone(valid);
  redirected.result.submittedIntent.tile = 901;
  const redirectedReport = auditHrafnChassisReplay(
    replayWith([redirected]),
  );
  assert.equal(redirectedReport.effect_consistency_failures.length, 1);
  assert.match(
    redirectedReport.effect_consistency_failures[0].failures.join(" "),
    /nuclear tile/,
  );
});

test("replay without inline decisions is rejected", () => {
  assert.throws(
    () => auditHrafnChassisReplay({}),
    /does not contain inline decisions/,
  );
});
