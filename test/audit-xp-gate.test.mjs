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
  assert.equal(report.checks.opening_alliance_mechanism_exercised, false);
  assert.equal(report.checks.exact_opening_alliance_alignment, false);
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
