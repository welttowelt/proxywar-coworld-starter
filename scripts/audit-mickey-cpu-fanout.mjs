#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  return value;
}

function mean(values) {
  assert(values.length > 0, "cannot average an empty sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function sha256File(filePath) {
  const body = await readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

async function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid JSON: ${error.message}`);
  }
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

async function findDecisionLogs(runRoot) {
  const matches = [];
  async function walk(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`audit encountered symlink ${childRelative}`);
      if (entry.isDirectory()) await walk(child, childRelative);
      else if (entry.isFile() && entry.name === "decisions.jsonl") matches.push(child);
    }
  }
  await walk(runRoot);
  assert(matches.length <= 1, `${runRoot} must not contain multiple decisions.jsonl files`);
  return matches;
}

function parseJsonLinesBody(body, label, { requireEveryLine = true } = {}) {
  const values = [];
  for (const [index, raw] of body.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const value = JSON.parse(line);
      assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} line is not an object`);
      values.push(value);
    } catch (error) {
      if (!requireEveryLine && !line.startsWith("{")) continue;
      throw new Error(`${label} line ${index + 1} is invalid JSON: ${error.message}`);
    }
  }
  return values;
}

async function parseJsonLines(filePath, label, options = {}) {
  return parseJsonLinesBody(await readFile(filePath, "utf8"), label, options);
}

async function loadReplayDecisions(runRoot, pair, role) {
  const replay = await readJson(path.join(runRoot, "replay"), `${pair.id}/${role} replay`);
  const inline = replay.inlineRunArtifacts?.["decisions.jsonl"];
  assert(typeof inline === "string" && inline.length > 0, `${pair.id}/${role} replay lacks inline decisions.jsonl`);
  const standalone = await findDecisionLogs(runRoot);
  if (standalone.length === 1) {
    const standaloneBody = await readFile(standalone[0], "utf8");
    assert(standaloneBody === inline, `${pair.id}/${role} standalone and replay-inline decisions disagree`);
  }
  return {
    rows: parseJsonLinesBody(inline, `${pair.id}/${role} replay-inline decisions`),
    source: standalone.length === 1 ? "replay_inline_and_matching_standalone" : "replay_inline",
  };
}

function validateReceipt(receipt, identity, pair, role) {
  assert(receipt.status === "passed", `${pair.id}/${role} transport receipt did not pass`);
  assert(
    receipt.receipt_scope === "transport_and_artifact_integrity_only" &&
      receipt.evaluation_verdict === "not_evaluated",
    `${pair.id}/${role} receipt confuses transport with policy evaluation`,
  );
  assert(receipt.execution_class === "formal_evaluation", `${pair.id}/${role} is not formal evaluation`);
  assert(receipt.post_run_attestation?.status === "stable", `${pair.id}/${role} post-run attestation is not stable`);
  const expectedSpec = role === "candidate" ? pair.candidate_spec : pair.m0_spec;
  assert(receipt.run_spec?.location === "bundle", `${pair.id}/${role} spec was not bundle-bound`);
  assert(receipt.run_spec?.relative_path === expectedSpec.archive_path, `${pair.id}/${role} spec path mismatch`);
  assert(receipt.run_spec?.sha256 === expectedSpec.sha256, `${pair.id}/${role} spec hash mismatch`);
  assert(receipt.run_spec?.execution_class === "formal_evaluation", `${pair.id}/${role} run-spec class mismatch`);
  const player = receipt.plan?.players?.[pair.seat];
  assert(player?.slot === pair.seat, `${pair.id}/${role} tested seat mismatch`);
  assert(player?.name === pair.roster[pair.seat].name, `${pair.id}/${role} tested player name mismatch`);
  assert(player?.policy === identity.policy_key, `${pair.id}/${role} tested policy mismatch`);
  assert(player?.cwd === identity.bundle_root, `${pair.id}/${role} tested cwd mismatch`);
  assert(equal(player?.run, identity.run), `${pair.id}/${role} tested command mismatch`);
  assert(receipt.plan?.game_config?.seed === pair.seed, `${pair.id}/${role} seed mismatch`);
  assert(receipt.plan?.game_config?.map === pair.map, `${pair.id}/${role} map mismatch`);
  assert(
    receipt.plan?.game_config?.max_decision_steps === pair.max_decision_steps,
    `${pair.id}/${role} decision horizon mismatch`,
  );
}

function validateResults(results, receipt, pair, role) {
  assert(equal(results, receipt.results), `${pair.id}/${role} results differ from the attested receipt summary`);
  assert(Array.isArray(results.players) && results.players.length === pair.roster.length, `${pair.id}/${role} result roster mismatch`);
  for (let seat = 0; seat < pair.roster.length; seat += 1) {
    assert(results.players[seat]?.slot === seat, `${pair.id}/${role} result slots are not contiguous`);
    assert(results.players[seat]?.name === pair.roster[seat].name, `${pair.id}/${role} result player ${seat} mismatch`);
  }
  const tested = results.players[pair.seat];
  return {
    score: finite(tested.score, `${pair.id}/${role} score`),
    final_tiles: finite(tested.tiles_owned, `${pair.id}/${role} tiles_owned`),
  };
}

function validatePrimaryHashes(runRoot, receipt, pair, role) {
  const expected = receipt.primary_artifact_hashes;
  assert(expected && typeof expected === "object", `${pair.id}/${role} primary hashes are missing`);
  for (const relative of ["results.json", "replay"]) {
    assert(SHA256.test(expected[relative]?.sha256 ?? ""), `${pair.id}/${role} ${relative} hash is missing`);
  }
  return Promise.all(["results.json", "replay"].map(async (relative) => {
    const actual = await sha256File(path.join(runRoot, relative));
    assert(actual === expected[relative].sha256, `${pair.id}/${role} ${relative} changed after receipt`);
    return [relative, actual];
  })).then(Object.fromEntries);
}

function analyzeDecisions(rows, telemetry, pair, identity, role, gateMarker) {
  const username = pair.roster[pair.seat].name;
  const testedRows = rows.filter((row) => row.username === username);
  assert(testedRows.length > 0, `${pair.id}/${role} has no decisions for the tested player`);
  assert(
    testedRows.length === telemetry.length,
    `${pair.id}/${role} telemetry count does not match tested-player decisions`,
  );
  const seenRequests = new Set();
  let markerCount = 0;
  let reachedCount = 0;
  let acceptedReplacements = 0;
  let holds = 0;
  let unexplainedHolds = 0;
  let rejected = 0;
  let k1zHarm = 0;
  let mechanismReachedK1zHarm = 0;
  const reach = [];
  for (let index = 0; index < testedRows.length; index += 1) {
    const row = testedRows[index];
    const event = telemetry[index];
    assert(event.source === "static-eval-v1", `${pair.id}/${role} telemetry source mismatch`);
    assert(event.arm === identity.arm, `${pair.id}/${role} telemetry arm mismatch`);
    assert(typeof event.requestID === "string" && event.requestID.length > 0, `${pair.id}/${role} telemetry requestID is missing`);
    assert(!seenRequests.has(event.requestID), `${pair.id}/${role} telemetry requestID is duplicated`);
    seenRequests.add(event.requestID);
    assert(event.selectedActionID === row.selectedLegalActionId, `${pair.id}/${role} telemetry action does not match replay decision`);
    assert(event.selectedActionKind === row.selectedActionKind, `${pair.id}/${role} telemetry kind does not match replay decision`);
    const accepted = row.result?.accepted === true;
    if (!accepted) rejected += 1;
    if (String(row.selectedActionKind).toLowerCase() === "hold") {
      holds += 1;
      assert(Array.isArray(row.legalActionIDs), `${pair.id}/${role} hold lacks legalActionIDs`);
      const nonHoldLegal = row.legalActionIDs.some((id) => typeof id === "string" && id !== "hold");
      if (accepted && nonHoldLegal) unexplainedHolds += 1;
    }
    const hostileKinds = new Set(["attack", "boat", "nuke", "target_player", "embargo"]);
    const metadata = row.selectedActionMetadata ?? {};
    let hostileK1z = false;
    if (accepted && hostileKinds.has(String(row.selectedActionKind).toLowerCase())) {
      const targetID = metadata.targetID ?? null;
      if (targetID !== null) {
        assert(typeof targetID === "string" && targetID.length > 0, `${pair.id}/${role} hostile target ID is invalid`);
        assert(typeof metadata.targetName === "string" && metadata.targetName.length > 0, `${pair.id}/${role} hostile target name is unverifiable`);
        const rosterTarget = pair.roster.find((entry) => entry.name === metadata.targetName);
        assert(rosterTarget, `${pair.id}/${role} hostile target is absent from the preregistered roster`);
        hostileK1z = rosterTarget.coalition === "k1z" && rosterTarget.seat !== pair.seat;
        if (hostileK1z) k1zHarm += 1;
      }
    }
    if (event.policyMarker === gateMarker) markerCount += 1;
    if (event.reached === true) {
      assert(event.actionDelta === true, `${pair.id}/${role} reached without an action delta`);
      assert(event.policyMarker === gateMarker, `${pair.id}/${role} reached with the wrong policy marker`);
      reachedCount += 1;
      if (accepted) acceptedReplacements += 1;
      const targetID = event.selectedTargetID;
      if (targetID !== null) {
        assert(typeof targetID === "string" && targetID.length > 0, `${pair.id}/${role} reached target ID is invalid`);
        assert(metadata.targetID === targetID, `${pair.id}/${role} reached target does not match replay metadata`);
        assert(typeof metadata.targetName === "string" && metadata.targetName.length > 0, `${pair.id}/${role} reached target name is unverifiable`);
        const rosterTarget = pair.roster.find((entry) => entry.name === metadata.targetName);
        assert(rosterTarget, `${pair.id}/${role} reached target is absent from the preregistered roster`);
      }
      if (hostileK1z) mechanismReachedK1zHarm += 1;
      reach.push({
        decision_index: index,
        request_id: event.requestID,
        selected_action_id: event.selectedActionID,
        selected_action_kind: event.selectedActionKind,
        selected_target_id: targetID,
        selected_target_name: metadata.targetName ?? null,
        accepted,
      });
    }
  }
  if (role === "m0") {
    assert(markerCount === 0 && reachedCount === 0 && acceptedReplacements === 0, `${pair.id}/m0 unexpectedly reached a candidate mechanism`);
    assert(telemetry.every((event) => event.actionDelta === false), `${pair.id}/m0 changed the baseline action`);
  }
  return {
    decisions: testedRows.length,
    accepted: testedRows.length - rejected,
    holds,
    unexplained_holds: unexplainedHolds,
    rejected,
    marker_count: markerCount,
    reached_count: reachedCount,
    accepted_replacements: acceptedReplacements,
    k1z_harm_count: k1zHarm,
    mechanism_reached_k1z_harm_count: mechanismReachedK1zHarm,
    reach,
  };
}

async function auditRole(pairRoot, pair, arm, role) {
  const identity = role === "candidate" ? arm.candidate : arm.m0;
  const runRoot = path.join(pairRoot, "fetched", "runs", role);
  const info = await lstat(runRoot).catch(() => null);
  assert(info?.isDirectory() && !info.isSymbolicLink(), `${pair.id}/${role} run directory is missing or unsafe`);
  const receipt = await readJson(path.join(runRoot, "receipt.json"), `${pair.id}/${role} receipt`);
  validateReceipt(receipt, identity, pair, role);
  const results = await readJson(path.join(runRoot, "results.json"), `${pair.id}/${role} results`);
  const metrics = validateResults(results, receipt, pair, role);
  const primaryHashes = await validatePrimaryHashes(runRoot, receipt, pair, role);
  const decisions = await loadReplayDecisions(runRoot, pair, role);
  const rows = decisions.rows;
  const stdoutPath = path.join(
    runRoot,
    "logs",
    `player-${String(pair.seat).padStart(2, "0")}-${identity.policy_key}.stdout.log`,
  );
  const logEvents = await parseJsonLines(stdoutPath, `${pair.id}/${role} player telemetry`, {
    requireEveryLine: true,
  });
  const starts = logEvents.filter((event) => event.type === "evaluation_static_intent_start");
  assert(starts.length === 1, `${pair.id}/${role} requires exactly one evaluation start event`);
  assert(starts[0].source === "static-eval-v1" && starts[0].arm === identity.arm, `${pair.id}/${role} start event identity mismatch`);
  assert(starts[0].uploadEligible === false, `${pair.id}/${role} start event must be upload-ineligible`);
  const telemetry = logEvents.filter((event) => event.type === "evaluation_static_intent_decision");
  const decisionAudit = analyzeDecisions(rows, telemetry, pair, identity, role, arm.gates.mechanism.marker);
  return {
    role,
    policy_id: identity.policy_id,
    image_id: identity.image_id,
    spec_sha256: role === "candidate" ? pair.candidate_spec.sha256 : pair.m0_spec.sha256,
    results_sha256: primaryHashes["results.json"],
    replay_sha256: primaryHashes.replay,
    decision_evidence_source: decisions.source,
    ...metrics,
    ...decisionAudit,
  };
}

export function mirroredSeatsPass(arm) {
  if (!arm.gates.outcome.require_mirrored_seats) return true;
  const groups = new Map();
  for (const pair of arm.pairs) {
    const rosterSet = pair.roster
      .map((entry) => [entry.name, entry.coalition])
      .sort(([leftName, leftCoalition], [rightName, rightCoalition]) =>
        leftName.localeCompare(rightName) || leftCoalition.localeCompare(rightCoalition));
    const key = JSON.stringify([pair.map, pair.seed, rosterSet]);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(pair.seat);
  }
  return [...groups.values()].every((seats) => seats.size >= 2);
}

async function auditPair(output, manifestSha256, arm, pair) {
  const pairRoot = path.join(output, "completed", pair.id);
  const completion = await readJson(path.join(pairRoot, "pair-complete.json"), `${pair.id} completion receipt`);
  assert(completion.evidence_eligible === true, `${pair.id} is not transport evidence-eligible`);
  assert(completion.manifest_sha256 === manifestSha256, `${pair.id} completion manifest mismatch`);
  assert(completion.pair_id === pair.id && completion.arm_id === arm.id, `${pair.id} completion identity mismatch`);
  assert(equal(completion.execution_order, pair.order), `${pair.id} execution order mismatch`);
  assert(completion.order_draw_sha256 === pair.order_draw_sha256, `${pair.id} order draw mismatch`);
  const [candidate, m0] = await Promise.all([
    auditRole(pairRoot, pair, arm, "candidate"),
    auditRole(pairRoot, pair, arm, "m0"),
  ]);
  return {
    pair_id: pair.id,
    map: pair.map,
    seed: pair.seed,
    seat: pair.seat,
    order: pair.order,
    candidate,
    m0,
    delta: {
      score: candidate.score - m0.score,
      final_tiles: candidate.final_tiles - m0.final_tiles,
    },
  };
}

function armSummary(arm, pairs) {
  const mechanism = {
    marker_count: pairs.reduce((sum, pair) => sum + pair.candidate.marker_count, 0),
    reached_count: pairs.reduce((sum, pair) => sum + pair.candidate.reached_count, 0),
    accepted_replacements: pairs.reduce((sum, pair) => sum + pair.candidate.accepted_replacements, 0),
    unexplained_holds: pairs.reduce((sum, pair) => sum + pair.candidate.unexplained_holds, 0),
    rejected_decisions: pairs.reduce((sum, pair) => sum + pair.candidate.rejected, 0),
    k1z_harm_count: pairs.reduce((sum, pair) => sum + pair.candidate.k1z_harm_count, 0),
    mechanism_reached_k1z_harm_count:
      pairs.reduce((sum, pair) => sum + pair.candidate.mechanism_reached_k1z_harm_count, 0),
  };
  const outcome = {
    pair_count: pairs.length,
    mean_candidate_minus_m0_score: mean(pairs.map((pair) => pair.delta.score)),
    mean_candidate_minus_m0_final_tiles: mean(pairs.map((pair) => pair.delta.final_tiles)),
    mirrored_seats_passed: mirroredSeatsPass(arm),
  };
  const gates = {
    expected_reach: arm.gates.mechanism.expected_reach === true && mechanism.reached_count > 0,
    minimum_marker_count: mechanism.marker_count >= arm.gates.mechanism.minimum_marker_count,
    minimum_accepted_replacements:
      mechanism.accepted_replacements >= arm.gates.mechanism.minimum_accepted_replacements,
    maximum_unexplained_holds:
      mechanism.unexplained_holds <= arm.gates.mechanism.maximum_unexplained_holds,
    maximum_rejected_decisions:
      mechanism.rejected_decisions <= arm.gates.mechanism.maximum_rejected_decisions,
    maximum_k1z_harm: mechanism.k1z_harm_count <= arm.gates.mechanism.maximum_k1z_harm,
    minimum_pairs: outcome.pair_count >= arm.gates.outcome.minimum_pairs,
    minimum_candidate_minus_m0:
      outcome.mean_candidate_minus_m0_score >= arm.gates.outcome.minimum_candidate_minus_m0,
    minimum_secondary_delta:
      outcome.mean_candidate_minus_m0_final_tiles >= arm.gates.outcome.minimum_secondary_delta,
    mirrored_seats: outcome.mirrored_seats_passed,
  };
  return {
    arm_id: arm.id,
    mechanism_class: arm.mechanism_class,
    roster_class: arm.roster_class,
    candidate_policy_id: arm.candidate.policy_id,
    candidate_image_id: arm.candidate.image_id,
    mechanism,
    outcome,
    gates,
    screen_passed: Object.values(gates).every(Boolean),
    pairs,
  };
}

export async function auditMickeyCpuFanout({ output, manifest, manifestSha256 }) {
  assert(path.isAbsolute(output), "audit output path must be absolute");
  assert(SHA256.test(manifestSha256), "audit manifest SHA-256 is invalid");
  assert(manifest?.kind === "mickey_cpu_fanout", "audit manifest kind is invalid");
  const arms = [];
  for (const arm of manifest.arms) {
    const pairs = [];
    for (const pair of arm.pairs) pairs.push(await auditPair(output, manifestSha256, arm, pair));
    arms.push(armSummary(arm, pairs));
  }
  arms.sort((left, right) =>
    Number(right.screen_passed) - Number(left.screen_passed) ||
    right.outcome.mean_candidate_minus_m0_score - left.outcome.mean_candidate_minus_m0_score ||
    right.outcome.mean_candidate_minus_m0_final_tiles - left.outcome.mean_candidate_minus_m0_final_tiles ||
    left.arm_id.localeCompare(right.arm_id));
  let screenLeader = null;
  arms.forEach((arm, index) => {
    arm.rank = index + 1;
    if (screenLeader === null && arm.screen_passed) {
      screenLeader = arm.arm_id;
      arm.label = "screen_leader";
    } else {
      arm.label = arm.screen_passed ? "screen_runner_up" : "screen_rejected";
    }
    arm.confirmed = false;
  });
  const passedCount = arms.filter((arm) => arm.screen_passed).length;
  return {
    schema_version: 1,
    kind: "mickey_cpu_fanout_leaderboard",
    run_id: manifest.run_id,
    manifest_sha256: manifestSha256,
    evidence_scope: "diagnostic_only",
    audit_integrity_status: "passed",
    policy_audit_status: passedCount === 0 ? "no_arm_passed" : passedCount === arms.length ? "all_arms_passed" : "some_arms_passed",
    screen_leader: screenLeader,
    arms,
    confirmation: {
      hosted_4_of_4_passed: false,
      regression_20_of_20_passed: false,
      final_rci_passed: false,
      all_thresholds_passed: false,
      promotion_allowed: false,
    },
    upload_allowed: false,
    local_fanout_can_promote: false,
  };
}

async function cli(argv) {
  const options = { manifest: null, manifestSha256: null, output: null, write: null };
  for (let index = 0; index < argv.length; index += 1) {
    const field = {
      "--manifest": "manifest",
      "--manifest-sha256": "manifestSha256",
      "--output": "output",
      "--write": "write",
    }[argv[index]];
    if (!field || index + 1 >= argv.length || options[field] !== null) {
      throw new Error(`unknown, duplicate, or incomplete option: ${argv[index]}`);
    }
    options[field] = argv[++index];
  }
  assert(options.manifest && options.manifestSha256 && options.output, "--manifest, --manifest-sha256, and --output are required");
  const actual = await sha256File(options.manifest);
  assert(actual === options.manifestSha256, "manifest SHA-256 mismatch");
  const manifest = await readJson(options.manifest, "manifest");
  const leaderboard = await auditMickeyCpuFanout({ output: options.output, manifest, manifestSha256: actual });
  const encoded = `${JSON.stringify(leaderboard, null, 2)}\n`;
  if (options.write) await writeFile(options.write, encoded, { flag: "wx", mode: 0o600 });
  process.stdout.write(encoded);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`MICKEY_FANOUT_AUDIT_FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
