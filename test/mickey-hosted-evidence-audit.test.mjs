import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  auditMickeyHostedEvidence,
  auditMickeyHostedEvidenceManifest,
  auditMickeyHostedProbe,
  auditMickeyHostedProbeManifest,
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
const PROBE_CANDIDATE = Object.freeze({
  player_id: "ply_11111111-1111-4111-8111-111111111111",
  league_id: "league_33333333-3333-4333-8333-333333333333",
  source_commit: "c".repeat(40),
  image_id: `sha256:${"a".repeat(64)}`,
  policy_ref: "proxywar-agent-llm:mickey-test-amd64",
  uploaded_label: "mickey-mouse-intent:v7",
  policy_version_id: "44444444-4444-4444-8444-444444444444",
  marker: "mm1g",
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function experienceRequest({
  id,
  count,
  policyVersionID = CANDIDATE.policy_version_id,
  playerName = CANDIDATE.player_name,
  playerID = "ply_mickey",
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
          player_id: playerID,
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
      result: options.unconfirmed
        ? { reason: "outcome unavailable" }
        : { accepted: options.rejected ? false : true, reason: options.rejected ? "rejected" : "accepted" },
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
  if (options.unresolvedTarget) {
    rows.push({
      agentID: "opportunistic-agent-1",
      username: CANDIDATE.player_name,
      turnNumber: 700,
      selectedLegalActionId: "attack:unknown-local:10",
      selectedActionKind: "attack",
      selectedActionMetadata: {
        targetID: "unknown-local",
        targetName: "Unknown outsider",
        troopPercent: 10,
        expansion: false,
      },
      legalActionIDs: ["attack:unknown-local:10", "hold"],
      reason: "rul:atk",
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

function probeEvidence({
  episodes = 1,
  wins = false,
  candidate = PROBE_CANDIDATE,
  replayOptions = {},
} = {}) {
  const probeRequest = experienceRequest({
    id: "xreq_probe",
    count: episodes,
    policyVersionID: candidate.policy_version_id,
    playerName: CANDIDATE.player_name,
    playerID: candidate.player_id,
    policyRef: candidate.uploaded_label,
    wins,
  });
  const probeReplays = probeRequest.episodes.map((episode, index) =>
    replayRecord(episode, {
      marker: candidate.marker,
      winnerSlot: wins ? 0 : 1,
      ...(index === 0 ? replayOptions : {}),
    })
  );
  return { candidate, probeRequest, probeReplays };
}

function probeManifestFixture(value = probeEvidence()) {
  const directory = mkdtempSync(path.join(tmpdir(), "mickey-hosted-probe-audit-"));
  const writeJson = (name, body) => {
    const target = path.join(directory, name);
    const bytes = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
    writeFileSync(target, bytes);
    return { path: name, sha256: digest(bytes) };
  };
  const request = writeJson("probe-request.json", value.probeRequest);
  const replayReferences = value.probeReplays.map((record, index) => {
    const name = `probe-${index}.replay`;
    writeFileSync(path.join(directory, name), record.bytes);
    return {
      episode_request_id: record.episode_request_id,
      path: name,
      sha256: record.sha256,
    };
  });
  const manifest = {
    schema_version: 1,
    kind: "mickey_hosted_probe_manifest",
    candidate: value.candidate,
    probe: { request, replays: replayReferences },
  };
  const manifestReference = writeJson("probe-manifest.json", manifest);
  return {
    directory,
    manifest,
    manifestPath: path.join(directory, manifestReference.path),
    manifestSha256: manifestReference.sha256,
    firstReplayPath: path.join(directory, replayReferences[0].path),
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

test("a clean one-or-more-episode hosted probe passes without requiring a win", () => {
  for (const episodes of [1, 3]) {
    const report = auditMickeyHostedProbe(probeEvidence({ episodes, wins: false }));

    assert.equal(report.schema_version, 1);
    assert.equal(report.kind, "mickey_hosted_probe_audit");
    assert.equal(report.evidence_scope, "hosted_probe_only");
    assert.deepEqual(report.candidate, PROBE_CANDIDATE);
    assert.equal(report.probe.status, "completed");
    assert.equal(report.probe.passed, true);
    assert.equal(report.probe.episodes, episodes);
    assert.equal(report.probe.completed_episodes, episodes);
    assert.ok(report.probe.decisions >= episodes);
    assert.equal(report.probe.accepted, report.probe.decisions);
    assert.equal(report.probe.rejected, 0);
    assert.equal(report.probe.unconfirmed_acceptance, 0);
    assert.equal(report.probe.illegal_selections, 0);
    assert.equal(report.probe.unexplained_holds, 0);
    assert.equal(report.probe.k1z_harm_count, 0);
    assert.equal(report.probe.unresolved_harmful_targets, 0);
    assert.ok(report.probe.marker_count >= 1);
    assert.equal(report.probe.nondegraded_marker_count, report.probe.marker_count);
    assert.equal(report.probe.invalid_marker_count, 0);
    assert.equal(report.probe.checks.request_completed, true);
    assert.equal(report.probe.checks.at_least_one_completed_episode, true);
    assert.equal(report.probe.checks.all_decisions_accepted, true);
    assert.equal(report.probe.checks.all_selected_actions_legal, true);
    assert.equal(report.probe.checks.selected_marker_reached, true);
    assert.equal(report.probe.checks.selected_marker_nondegraded, true);
    assert.equal(report.confirmation.experimental_hosted_probe_passed, true);
    assert.equal(report.confirmation.hosted_4_of_4_passed, false);
    assert.equal(report.confirmation.regression_20_of_20_passed, false);
  }
});

for (const [name, replayOptions, counter] of [
  ["rejected action", { rejected: true }, "rejected"],
  ["unconfirmed action", { unconfirmed: true }, "unconfirmed_acceptance"],
  ["illegal action", { illegal: true }, "illegal_selections"],
  ["hold", { unexplainedHold: true }, "unexplained_holds"],
  ["K1Z harm", { k1zHarm: true }, "k1z_harm_count"],
  ["unresolved harmful target", { unresolvedTarget: true }, "unresolved_harmful_targets"],
  ["invalid marker execution", { wrongMarker: "mm1c" }, "invalid_marker_count"],
]) {
  test(`hosted probe rejects a replay-bound ${name}`, () => {
    const report = auditMickeyHostedProbe(probeEvidence({ replayOptions }));

    assert.ok(report.probe[counter] > 0);
    assert.equal(report.probe.passed, false);
    assert.equal(report.confirmation.experimental_hosted_probe_passed, false);
    assert.equal(report.confirmation.hosted_4_of_4_passed, false);
    assert.equal(report.confirmation.regression_20_of_20_passed, false);
  });
}

test("hosted probe rejects a reached marker when its execution is degraded", () => {
  const report = auditMickeyHostedProbe(probeEvidence({ replayOptions: { degraded: true } }));

  assert.equal(report.probe.marker_count, 1);
  assert.equal(report.probe.nondegraded_marker_count, 0);
  assert.equal(report.probe.checks.selected_marker_nondegraded, false);
  assert.equal(report.probe.passed, false);
  assert.equal(report.confirmation.experimental_hosted_probe_passed, false);
});

test("hosted probe rejects forged replay bytes even when the JSON remains parseable", () => {
  const value = probeEvidence();
  value.probeReplays[0] = {
    ...value.probeReplays[0],
    bytes: Buffer.concat([value.probeReplays[0].bytes, Buffer.from(" ")]),
  };

  assert.throws(
    () => auditMickeyHostedProbe(value),
    /sha256 mismatch/,
  );
});

test("hosted probe binds the exact player, uploaded label, and policy version to the request", () => {
  for (const candidatePatch of [
    { uploaded_label: "mickey-mouse-intent:v8" },
    { policy_version_id: "55555555-5555-4555-8555-555555555555" },
    { player_id: "ply_22222222-2222-4222-8222-222222222222" },
  ]) {
    const value = probeEvidence();
    value.candidate = { ...value.candidate, ...candidatePatch };
    assert.throws(
      () => auditMickeyHostedProbe(value),
      /participant|candidate|policy|player/i,
    );
  }
});

test("hosted probe manifest binds the complete candidate and every local artifact", async () => {
  const fixture = probeManifestFixture();
  const report = await auditMickeyHostedProbeManifest(
    fixture.manifestPath,
    fixture.manifestSha256,
  );

  assert.deepEqual(report.candidate, PROBE_CANDIDATE);
  assert.equal(report.confirmation.experimental_hosted_probe_passed, true);

  writeFileSync(fixture.firstReplayPath, "{}\n");
  await assert.rejects(
    auditMickeyHostedProbeManifest(fixture.manifestPath, fixture.manifestSha256),
    /sha256 mismatch/,
  );
});

test("hosted probe manifest hash prevents candidate substitution", async () => {
  const fixture = probeManifestFixture();
  const substituted = {
    ...fixture.manifest,
    candidate: {
      ...fixture.manifest.candidate,
      source_commit: "d".repeat(40),
      image_id: `sha256:${"b".repeat(64)}`,
    },
  };
  writeFileSync(fixture.manifestPath, `${JSON.stringify(substituted, null, 2)}\n`);

  await assert.rejects(
    auditMickeyHostedProbeManifest(fixture.manifestPath, fixture.manifestSha256),
    /manifest SHA-256 mismatch/,
  );
});
