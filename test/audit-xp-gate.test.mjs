import assert from "node:assert/strict";
import test from "node:test";

import { auditEpisodeReplay, buildGateReport } from "../scripts/audit-xp-gate.mjs";

const POLICY_ID = "policy-v19";

function episode() {
  return {
    id: "ereq-one",
    episode_id: "episode-one",
    game_config: { map: "Pangaea" },
    participants: [
      { player_name: "James Boggs", policy_version_id: "james", version: 1 },
      { player_name: "odin free", policy_version_id: POLICY_ID, version: 19 },
      { player_name: "Auri", policy_version_id: "auri", version: 4 },
      { player_name: "Richard Higgins", policy_version_id: "richard", version: 1 },
    ],
    scores: [{ policy_version_id: POLICY_ID, score: 1 }],
  };
}

function replay(selectedActionID = "alliance:james") {
  const decisions = [
    {
      agentID: "defensive-agent-2",
      profile: "defensive",
      selectedActionKind: "spawn",
      selectedLegalActionId: "spawn:1",
      result: { accepted: true },
    },
    {
      agentID: "defensive-agent-2",
      turnNumber: 400,
      profile: "defensive",
      selectedActionKind: selectedActionID.startsWith("alliance:")
        ? "alliance_request"
        : "attack",
      selectedLegalActionId: selectedActionID,
      legalActionIDsByKind: { alliance_request: ["alliance:james"] },
      tacticalAffordances: {
        survivalAlliance: {
          recommended: true,
          bestAllyTargetID: "james",
          bestAllyName: "James Boggs",
        },
      },
      result: { accepted: true },
      fallbackUsed: false,
    },
  ];
  return {
    inlineRunArtifacts: {
      "decisions.jsonl": `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`,
    },
    results: {
      winner_slot: 1,
      players: [{}, { tiles_owned: 90000, is_alive: true }, {}, {}],
    },
  };
}

test("gate audit proves the exact opening alliance mechanism", () => {
  const audit = auditEpisodeReplay(episode(), replay());
  assert.equal(audit.won, true);
  assert.equal(audit.alliance_selections.length, 1);
  assert.equal(audit.opening_alliance_opportunities[0].aligned, true);

  const report = buildGateReport(
    { id: "xreq-test", status: "completed" },
    [audit, audit, audit, audit],
  );
  assert.equal(report.passed, true);
  assert.equal(report.alliance_selections, 4);
  assert.equal(report.opening_alliance_selections, 4);
  assert.equal(report.opening_alliance_alignments, 4);
});

test("gate audit fails a missed exact opening alliance", () => {
  const audit = auditEpisodeReplay(episode(), replay("expand:terra-nullius:10"));
  const report = buildGateReport(
    { id: "xreq-test", status: "completed" },
    [audit, audit, audit, audit],
  );
  assert.equal(report.passed, false);
  assert.equal(report.alliance_selections, 0);
  assert.equal(report.opening_alliance_selections, 0);
  assert.equal(report.checks.opening_alliance_mechanism_exercised, false);
  assert.equal(report.checks.exact_opening_alliance_alignment, false);
});

test("a one-decision gate audits the isolated opening without requiring a retry", () => {
  const fixture = replay();
  const decisions = fixture.inlineRunArtifacts["decisions.jsonl"]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  decisions.push({
    ...decisions[1],
    turnNumber: 600,
    selectedActionKind: "attack",
    selectedLegalActionId: "expand:terra-nullius:10",
  });
  fixture.inlineRunArtifacts["decisions.jsonl"] =
    `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`;

  const audit = auditEpisodeReplay(
    episode(),
    fixture,
    "odin free",
    { openingDecisionLimit: 1 },
  );
  const report = buildGateReport(
    { id: "xreq-test", status: "completed" },
    [audit, audit, audit, audit],
  );
  assert.equal(report.opening_decision_limit, 1);
  assert.equal(report.opening_alliance_opportunities, 4);
  assert.equal(report.opening_alliance_alignments, 4);
  assert.equal(report.passed, true);
});

test("partial audit cannot pass before the request completes", () => {
  const audit = auditEpisodeReplay(episode(), replay());
  const report = buildGateReport(
    { id: "xreq-test", status: "running" },
    [audit, audit, audit, audit],
  );
  assert.equal(report.passed, false);
  assert.equal(report.checks.completed_episode_floor, false);
});

test("opening-reserve gate proves a capped attack where 40 percent was legal", () => {
  const fixture = replay("expand:terra-nullius:10");
  const decisions = fixture.inlineRunArtifacts["decisions.jsonl"]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  decisions.splice(1, 1, ...[10, 25, 10].map((percent, index) => ({
    agentID: "defensive-agent-2",
    turnNumber: 400 + index * 100,
    profile: "defensive",
    selectedActionKind: "attack",
    selectedLegalActionId: `attack:weak:${percent}`,
    selectedActionMetadata: {
      targetID: "weak",
      targetName: "Weak",
      troopPercent: percent,
      relativeTroopRatio: 1.7,
    },
    legalActionIDsByKind: {
      attack: ["attack:weak:10", "attack:weak:25", "attack:weak:40"],
    },
    tacticalAffordances: {
      transportTroopBanking: { troopRatio: index === 1 ? 0.8 : 0.7 },
    },
    result: { accepted: true },
    fallbackUsed: false,
  })));
  fixture.inlineRunArtifacts["decisions.jsonl"] =
    `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`;

  const audit = auditEpisodeReplay(episode(), fixture);
  const report = buildGateReport(
    { id: "xreq-opening-reserve", status: "completed" },
    [audit, audit, audit, audit],
    4,
    { mechanism: "opening-reserve" },
  );

  assert.equal(audit.opening_reserve_selections.length, 1);
  assert.equal(audit.opening_reserve_selections[0].reserve_limit, 10);
  assert.equal(report.opening_reserve_selections, 4);
  assert.equal(report.checks.opening_reserve_mechanism_exercised, true);
  assert.equal(report.checks.all_opening_reserve_decisions_productive, true);
  assert.equal(report.planner_degraded_decisions, 0);
  assert.equal(report.passed, true);
});

test("bank-build gate requires an accepted tagged build", () => {
  const audits = Array.from({ length: 4 }, (_, index) => ({
    won: true,
    final_tiles: 220000 + index,
    holds: 0,
    rejected: 0,
    fallbacks: 0,
    bank_build_selections: index === 0
      ? [{
          turn: 3100,
          action_id: "build:City:99",
          selected_action_kind: "build",
          unit: "City",
          reserve: 0.76,
          leader_gap: 0.15,
          accepted: true,
          fallback: false,
        }]
      : [],
  }));
  const report = buildGateReport(
    { id: "xreq-bank-build", status: "completed" },
    audits,
    4,
    { mechanism: "bank-build" },
  );

  assert.equal(report.bank_build_selections, 1);
  assert.equal(report.checks.bank_build_mechanism_exercised, true);
  assert.equal(report.checks.all_bank_build_decisions_productive, true);
  assert.equal(report.passed, true);
});

test("pressure-pulse gate requires an accepted tagged execution", () => {
  const audits = [0, 1, 2, 3].map((index) => ({
    won: true,
    final_tiles: 220000 + index,
    holds: 0,
    rejected: 0,
    fallbacks: 0,
    alliance_selections: [],
    opening_alliance_opportunities: [],
    pressure_pulse_selections: index === 0
      ? [{ turn: 1800, action_id: "attack:auri:10", accepted: true }]
      : [],
  }));
  const report = buildGateReport(
    { id: "xreq_pressure", status: "completed" },
    audits,
    4,
    { mechanism: "pressure-pulse" },
  );

  assert.equal(report.pressure_pulse_selections, 1);
  assert.equal(report.checks.pressure_pulse_mechanism_exercised, true);
  assert.equal(report.checks.all_pressure_pulses_accepted, true);
  assert.equal(report.passed, true);
});

test("parity-pulse gate parses and requires a productive 10 percent strike", () => {
  const fixture = replay("expand:terra-nullius:10");
  const decisions = fixture.inlineRunArtifacts["decisions.jsonl"]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  decisions[1] = {
    ...decisions[1],
    selectedActionKind: "attack",
    selectedLegalActionId: "attack:auri:10",
    selectedActionMetadata: {
      targetID: "auri",
      targetName: "Auri",
      troopPercent: 10,
      relativeTroopRatio: 0.95,
    },
    reason: "bedrock diagnostic || [hrafn-s4r:r1ft] leader=Auri",
  };
  fixture.inlineRunArtifacts["decisions.jsonl"] =
    `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`;

  const audit = auditEpisodeReplay(episode(), fixture);
  const report = buildGateReport(
    { id: "xreq-parity-pulse", status: "completed" },
    [audit, audit, audit, audit],
    4,
    { mechanism: "parity-pulse" },
  );

  assert.equal(audit.parity_pulse_selections.length, 1);
  assert.equal(report.parity_pulse_selections, 4);
  assert.equal(report.checks.parity_pulse_mechanism_exercised, true);
  assert.equal(report.checks.all_parity_pulses_productive, true);
  assert.equal(report.passed, true);
});

test("wire-veto gate requires an observed productive rerank", () => {
  const audits = Array.from({ length: 4 }, (_, index) => ({
    won: true,
    final_tiles: 220000 + index,
    holds: 0,
    rejected: 0,
    fallbacks: 0,
    alliance_selections: [],
    opening_alliance_opportunities: [],
    pressure_pulse_selections: [],
    wire_veto_selections: index === 0
      ? [{
          turn: 1800,
          vetoed_action_ids: ["alliance:james"],
          selected_action_id: "attack:auri:10",
          selected_action_kind: "attack",
          accepted: true,
          fallback: false,
        }]
      : [],
  }));
  const report = buildGateReport(
    { id: "xreq-wire-veto", status: "completed" },
    audits,
    4,
    { mechanism: "wire-veto" },
  );
  assert.equal(report.wire_veto_selections, 1);
  assert.equal(report.checks.wire_veto_mechanism_exercised, true);
  assert.equal(report.checks.all_wire_veto_decisions_productive, true);
  assert.equal(report.passed, true);
});

test("wire-salvage gate requires an accepted productive replacement", () => {
  const fixture = replay("expand:terra-nullius:10");
  const decisions = fixture.inlineRunArtifacts["decisions.jsonl"]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  decisions[1] = {
    ...decisions[1],
    selectedActionKind: "build",
    selectedLegalActionId: "build:City:10",
    selectedActionMetadata: { unit: "City" },
    reason:
      "bedrock diagnostic || [g4lga-v4rd:w1re] " +
      "unknown=alliance:missing replacement=build:City:10; parent",
  };
  fixture.inlineRunArtifacts["decisions.jsonl"] =
    `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`;

  const audit = auditEpisodeReplay(episode(), fixture);
  const report = buildGateReport(
    { id: "xreq-wire-salvage", status: "completed" },
    [audit, audit, audit, audit],
    4,
    { mechanism: "wire-salvage" },
  );

  assert.equal(audit.wire_salvage_selections.length, 1);
  assert.equal(report.wire_salvage_selections, 4);
  assert.equal(report.checks.wire_salvage_mechanism_exercised, true);
  assert.equal(report.checks.all_wire_salvages_productive, true);
  assert.equal(report.passed, true);
});
