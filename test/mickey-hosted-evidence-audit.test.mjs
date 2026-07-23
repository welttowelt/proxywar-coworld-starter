import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  auditMickeyHostedEvidence,
  auditMickeyHostedEvidenceManifest,
} from "../scripts/audit-mickey-hosted-evidence.mjs";

const CANDIDATE = Object.freeze({
  player_name: "K1Z Mickey Mouse",
  policy_ref: "mickey-mouse-intent:v1",
  policy_version_id: "mickey-version-1",
  marker: "mm1g",
});
const BASELINE = Object.freeze({
  player_name: "K1Z Mickey Mouse",
  policy_ref: "mickey-parent:v0",
  policy_version_id: "mickey-parent-0",
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function experienceRequest({
  id,
  count,
  policyVersionID = CANDIDATE.policy_version_id,
  playerName = CANDIDATE.player_name,
  opponentVersionID = "odin-v89",
  policyRef = policyVersionID === BASELINE.policy_version_id ? BASELINE.policy_ref : CANDIDATE.policy_ref,
  wins = true,
}) {
  return {
    id,
    status: "completed",
    variant_id: "tournament-3p-pangaea",
    episode_count: count,
    completed_count: count,
    failed_count: 0,
    episodes: Array.from({ length: count }, (_, index) => ({
      id: `${id}-episode-${index}`,
      episode_id: `${id}-game-${index}`,
      status: "completed",
      game_config: {
        map: "Pangaea",
        map_size: "Normal",
        difficulty: "Easy",
        num_agents: 3,
      },
      participants: [
        {
          position: 0,
          player_id: "ply_mickey",
          player_name: playerName,
          policy_version_id: policyVersionID,
          label: policyRef,
        },
        {
          position: 1,
          player_id: "ply_odin",
          player_name: "K1Z odin free",
          policy_version_id: opponentVersionID,
          label: `qd1n:${opponentVersionID}`,
        },
        {
          position: 2,
          player_id: "ply_auri",
          player_name: "Auri",
          policy_version_id: "auri-v24",
          label: "proxywar-keystone:v24",
        },
      ],
      scores: [{ policy_version_id: policyVersionID, score: wins ? 1 : 0 }],
    })),
  };
}

function decisionRows(marker, options = {}) {
  const convert = marker === "mm1c";
  const selectedLegalActionId = convert ? "attack:auri-local:25" : "expand:terra-nullius:10";
  const rows = [
    {
      agentID: "opportunistic-agent-1",
      username: CANDIDATE.player_name,
      turnNumber: 0,
      selectedLegalActionId: "spawn:100",
      selectedActionKind: "spawn",
      selectedActionMetadata: { tile: 100 },
      legalActionIDs: ["spawn:100", "hold"],
      reason: "rul:spn",
      fallbackUsed: true,
      llmPlannerDegraded: true,
      result: { accepted: true, reason: "accepted" },
    },
    {
      agentID: "opportunistic-agent-1",
      username: CANDIDATE.player_name,
      turnNumber: 400,
      selectedLegalActionId,
      selectedActionKind: "attack",
      selectedActionMetadata: convert
        ? {
            targetID: "auri-local",
            targetName: "Auri",
            troopPercent: 25,
            expansion: false,
          }
        : {
            targetID: null,
            targetName: "Terra Nullius",
            troopPercent: 10,
            expansion: true,
          },
      legalActionIDs: options.illegal ? ["hold"] : [selectedLegalActionId, "hold"],
      reason: `${options.degraded ? "dgd" : "pln"}:atk:${options.wrongMarker ?? marker}`,
      fallbackUsed: options.degraded ? true : false,
      llmPlannerDegraded: options.degraded ? true : false,
      result: { accepted: options.rejected ? false : true, reason: options.rejected ? "rejected" : "accepted" },
    },
  ];
  if (options.k1zHarm) {
    rows.push({
      agentID: "opportunistic-agent-1",
      username: CANDIDATE.player_name,
      turnNumber: 500,
      selectedLegalActionId: "attack:odin-local:10",
      selectedActionKind: "attack",
      selectedActionMetadata: {
        targetID: "odin-local",
        targetName: "K1Z odin free",
        troopPercent: 10,
        expansion: false,
      },
      legalActionIDs: ["attack:odin-local:10", "hold"],
      reason: "rul:atk",
      fallbackUsed: true,
      llmPlannerDegraded: true,
      result: { accepted: true, reason: "accepted" },
    });
  }
  if (options.unexplainedHold) {
    rows.push({
      agentID: "opportunistic-agent-1",
      username: CANDIDATE.player_name,
      turnNumber: 600,
      selectedLegalActionId: "hold",
      selectedActionKind: "hold",
      selectedActionMetadata: {},
      legalActionIDs: ["expand:terra-nullius:10", "hold"],
      reason: "rul:h0d",
      fallbackUsed: true,
      llmPlannerDegraded: true,
      result: { accepted: true, reason: "accepted" },
    });
  }
  return rows;
}

function replayRecord(episode, { marker = CANDIDATE.marker, ...options } = {}) {
  const replay = {
    runID: episode.episode_id,
    config: { map: episode.game_config.map },
    finalState: {
      players: [
        { username: CANDIDATE.player_name, playerID: "mickey-local" },
        { username: "K1Z odin free", playerID: "odin-local" },
        { username: "Auri", playerID: "auri-local" },
      ],
    },
    inlineRunArtifacts: {
      "decisions.jsonl": `${decisionRows(marker, options).map((row) => JSON.stringify(row)).join("\n")}\n`,
    },
    results: {
      winner_slot: options.winnerSlot ?? 0,
      players: [
        { tiles_owned: 900000, is_alive: true },
        { tiles_owned: 50000, is_alive: true },
        { tiles_owned: 10000, is_alive: true },
      ],
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(replay)}\n`);
  return { episode_request_id: episode.id, bytes, sha256: digest(bytes) };
}

function evidence(options = {}) {
  const hostedRequest = experienceRequest({
    id: "xreq_hosted",
    count: 4,
    wins: options.hostedWins ?? true,
  });
  const baselineRequest = experienceRequest({
    id: "xreq_baseline",
    count: 4,
    policyVersionID: BASELINE.policy_version_id,
    playerName: BASELINE.player_name,
    opponentVersionID: options.baselineOpponentVersionID ?? "odin-v89",
    wins: false,
  });
  const hostedReplays = hostedRequest.episodes.map((episode, index) =>
    replayRecord(episode, index === 0 ? (options.hostedReplayOptions ?? {}) : {})
  );
  let regressionRequest = null;
  let regressionReplays = null;
  if (options.regression) {
    regressionRequest = experienceRequest({
      id: options.regressionRequestID ?? "xreq_regression",
      count: 20,
      wins: options.regressionWins ?? true,
    });
    regressionReplays = regressionRequest.episodes.map((episode) => replayRecord(episode));
  }
  return {
    candidate: CANDIDATE,
    baseline: BASELINE,
    baselineRequest,
    hostedRequest,
    hostedReplays,
    regressionRequest,
    regressionReplays,
  };
}

test("matched hosted evidence passes 4/4 while an absent regression remains explicitly open", () => {
  const report = auditMickeyHostedEvidence(evidence());

  assert.equal(report.matched_baseline.passed, true);
  assert.equal(report.hosted.passed, true);
  assert.equal(report.hosted.wins, 4);
  assert.equal(report.hosted.marker_count, 4);
  assert.equal(report.hosted.nondegraded_marker_count, 4);
  assert.equal(report.hosted.accepted, report.hosted.decisions);
  assert.equal(report.confirmation.matched_hosted_4_of_4_passed, true);
  assert.equal(report.regression.status, "not_provided");
  assert.equal(report.confirmation.separate_regression_20_of_20_passed, false);
  assert.equal(report.confirmation.promotion_allowed, false);
});

test("a distinct clean regression can pass 20/20 without claiming final promotion", () => {
  const report = auditMickeyHostedEvidence(evidence({ regression: true }));

  assert.equal(report.regression.passed, true);
  assert.equal(report.regression.episodes, 20);
  assert.equal(report.regression.wins, 20);
  assert.equal(report.regression.checks.separate_request_id, true);
  assert.equal(report.regression.checks.separate_replay_evidence, true);
  assert.equal(report.confirmation.hosted_and_regression_evidence_passed, true);
  assert.equal(report.confirmation.final_rci_still_required, true);
  assert.equal(report.confirmation.promotion_allowed, false);
});

test("mm1c is accepted only as a nondegraded legal outsider conversion", () => {
  const value = evidence();
  value.candidate = { ...CANDIDATE, marker: "mm1c" };
  value.hostedReplays = value.hostedRequest.episodes.map((episode) =>
    replayRecord(episode, { marker: "mm1c" })
  );
  const report = auditMickeyHostedEvidence(value);

  assert.equal(report.hosted.passed, true);
  assert.equal(report.hosted.selected_marker, "mm1c");
  assert.equal(report.hosted.nondegraded_marker_count, 4);
});

test("a degraded marker, rejected action, or illegal selection fails closed", () => {
  for (const hostedReplayOptions of [
    { degraded: true },
    { rejected: true },
    { illegal: true },
  ]) {
    const report = auditMickeyHostedEvidence(evidence({ hostedReplayOptions }));
    assert.equal(report.hosted.passed, false);
    assert.equal(report.confirmation.matched_hosted_4_of_4_passed, false);
  }
});

test("replay-bound K1Z harm and an avoidable hold each reject the hosted gate", () => {
  const harmed = auditMickeyHostedEvidence(evidence({ hostedReplayOptions: { k1zHarm: true } }));
  assert.equal(harmed.hosted.k1z_harm_count, 1);
  assert.equal(harmed.hosted.checks.zero_k1z_harm, false);
  assert.equal(harmed.hosted.passed, false);

  const held = auditMickeyHostedEvidence(evidence({ hostedReplayOptions: { unexplainedHold: true } }));
  assert.equal(held.hosted.unexplained_holds, 1);
  assert.equal(held.hosted.checks.zero_unexplained_holds, false);
  assert.equal(held.hosted.passed, false);
});

test("a roster mismatch or reused regression request cannot satisfy the combined evidence gate", () => {
  const mismatched = auditMickeyHostedEvidence(evidence({ baselineOpponentVersionID: "odin-v88" }));
  assert.equal(mismatched.matched_baseline.checks.same_roster_and_game_config, false);
  assert.equal(mismatched.confirmation.matched_hosted_4_of_4_passed, false);

  const reused = evidence({ regression: true, regressionRequestID: "xreq_hosted" });
  const reusedReport = auditMickeyHostedEvidence(reused);
  assert.equal(reusedReport.regression.checks.separate_request_id, false);
  assert.equal(reusedReport.regression.passed, false);
  assert.equal(reusedReport.confirmation.hosted_and_regression_evidence_passed, false);
});

test("the manifest loader verifies every pinned local artifact before auditing", async () => {
  const value = evidence();
  const directory = mkdtempSync(path.join(tmpdir(), "mickey-hosted-audit-"));
  const writeJson = (name, body) => {
    const target = path.join(directory, name);
    const bytes = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
    writeFileSync(target, bytes);
    return { path: name, sha256: digest(bytes) };
  };
  const baselineEvidence = writeJson("baseline.json", value.baselineRequest);
  const hostedEvidence = writeJson("hosted.json", value.hostedRequest);
  const replayReferences = value.hostedReplays.map((record, index) => {
    const name = `hosted-${index}.replay`;
    writeFileSync(path.join(directory, name), record.bytes);
    return {
      episode_request_id: record.episode_request_id,
      path: name,
      sha256: record.sha256,
    };
  });
  const manifest = {
    schema_version: 1,
    kind: "mickey_hosted_evidence_manifest",
    candidate: CANDIDATE,
    baseline: {
      player_name: BASELINE.player_name,
      policy_ref: BASELINE.policy_ref,
      policy_version_id: BASELINE.policy_version_id,
      evidence: baselineEvidence,
    },
    hosted: { request: hostedEvidence, replays: replayReferences },
    regression: null,
  };
  const manifestReference = writeJson("manifest.json", manifest);
  const report = await auditMickeyHostedEvidenceManifest(
    path.join(directory, manifestReference.path),
    manifestReference.sha256,
  );
  assert.equal(report.confirmation.matched_hosted_4_of_4_passed, true);

  writeFileSync(path.join(directory, "hosted-0.replay"), "{}\n");
  await assert.rejects(
    auditMickeyHostedEvidenceManifest(
      path.join(directory, manifestReference.path),
      manifestReference.sha256,
    ),
    /sha256 mismatch/,
  );
});
