#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { canonicalHash } from "./runpod-proxywar-episode.mjs";

const ODIN_NAME = "K1Z odin free";
const EXPECTED_ROSTER = [
  "K1Z odin free",
  "K1Z Hrafn",
  "K1Z juryoku-koku",
  "K1Z katanasan",
];
const PRODUCTIVE_HOLD_KINDS = new Set([
  "attack",
  "boat",
  "build",
  "upgrade",
  "upgrade_structure",
  "warship",
  "move_warship",
  "nuke",
  "atom_bomb",
  "hydrogen_bomb",
  "mirv",
]);
const HARMFUL_KINDS = new Set([
  "attack",
  "boat",
  "nuke",
  "atom_bomb",
  "hydrogen_bomb",
  "mirv",
  "embargo",
  "embargo_all",
  "break_alliance",
  "alliance_reject",
  "target_player",
  "move_warship",
  "warship",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || !value) fail(`missing value for ${key}`);
    result[key.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (result.mode === "pair") {
    for (const key of ["candidate", "parent", "plan", "pair_id", "output"]) {
      if (!result[key]) fail(`--${key.replaceAll("_", "-")} is required`);
    }
  } else if (result.mode === "matrix") {
    for (const key of ["root", "plan", "output"]) {
      if (!result[key]) fail(`--${key} is required`);
    }
  } else {
    fail(
      "usage: audit-pg2-matrix.mjs --mode pair --candidate DIR --parent DIR --plan PLAN --pair-id ID --output FILE | --mode matrix --root DIR --plan PLAN --output FILE",
    );
  }
  return result;
}

async function artifactInfo(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  const info = await lstat(filePath);
  return {
    sha256: digest.digest("hex"),
    bytes: info.size,
  };
}

async function findOne(root, name) {
  const matches = [];
  async function visit(current) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) await visit(absolute);
      else if (child.isFile() && child.name === name) matches.push(absolute);
    }
  }
  await visit(root);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${name} below ${root}, found ${matches.length}`);
  }
  return matches[0];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonLines(filePath) {
  return (await readFile(filePath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`invalid JSONL at ${filePath}:${index + 1}`);
      }
    });
}

function median(values) {
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function receiptPlanIntegrityViolations(receipt) {
  if (
    !receipt.plan ||
    typeof receipt.plan !== "object" ||
    Array.isArray(receipt.plan)
  ) {
    return ["receipt_plan_missing"];
  }
  return receipt.input_sha256 === canonicalHash(receipt.plan)
    ? []
    : ["receipt_input_hash_drift"];
}

function checkpointTiles(activeRows, checkpoint) {
  const row = activeRows[checkpoint - 2];
  return Number.isFinite(row?.auditBefore?.tilesOwned)
    ? row.auditBefore.tilesOwned
    : null;
}

function actionTargetID(row) {
  const metadata = row.selectedActionMetadata ?? {};
  const submitted = row.result?.submittedIntent ?? {};
  const direct =
    metadata.targetID ??
    metadata.recipientID ??
    metadata.playerID ??
    submitted.targetID ??
    submitted.recipientID ??
    submitted.playerID ??
    null;
  if (direct) return String(direct).toLowerCase();
  const match = String(row.selectedLegalActionId ?? "").match(
    /^(?:attack|target|embargo|alliance|quick_chat|emoji|boat|warship|move_warship):([^:]+)/,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function selectedTargetLooksK1z(row, k1zIDs) {
  const metadata = row.selectedActionMetadata ?? {};
  const submitted = row.result?.submittedIntent ?? {};
  const targetName = String(
    metadata.targetName ??
      metadata.recipientName ??
      metadata.playerName ??
      submitted.targetName ??
      submitted.recipientName ??
      submitted.playerName ??
      "",
  );
  if (/^k1z\b/i.test(targetName)) return true;
  const targetID = actionTargetID(row);
  return targetID !== null && k1zIDs.has(targetID);
}

function isK1zHarm(row, k1zIDs) {
  return (
    HARMFUL_KINDS.has(row.selectedActionKind) &&
    selectedTargetLooksK1z(row, k1zIDs)
  );
}

function artifactRecordViolations(receipt, relative, actual, primary = false) {
  const violations = [];
  const matches = Array.isArray(receipt.artifacts)
    ? receipt.artifacts.filter((artifact) => artifact.path === relative)
    : [];
  if (matches.length !== 1) {
    violations.push(
      matches.length === 0
        ? `artifact_receipt_missing:${relative}`
        : `artifact_receipt_ambiguous:${relative}`,
    );
  } else if (
    matches[0].sha256 !== actual.sha256 ||
    matches[0].bytes !== actual.bytes
  ) {
    violations.push(`artifact_receipt_drift:${relative}`);
  }
  if (primary) {
    const expected = receipt.primary_artifact_hashes?.[relative];
    if (!expected) {
      violations.push(`primary_artifact_missing:${relative}`);
    } else if (
      expected.sha256 !== actual.sha256 ||
      expected.bytes !== actual.bytes
    ) {
      violations.push(`primary_artifact_drift:${relative}`);
    }
  }
  return violations;
}

function holdIsExplained(row) {
  const available = row.legalActionIDsByKind ?? {};
  return ![...PRODUCTIVE_HOLD_KINDS].some(
    (kind) => Array.isArray(available[kind]) && available[kind].length > 0,
  );
}

function markerViolation(row, activeOrdinal) {
  if (!String(row.reason ?? "").endsWith(":pg2")) return null;
  const metadata = row.selectedActionMetadata ?? {};
  const opening = row.tacticalAffordances?.openingExpansionTempo ?? {};
  const banking = row.tacticalAffordances?.transportTroopBanking ?? {};
  if (
    row.selectedActionKind !== "attack" ||
    row.selectedLegalActionId !== "expand:terra-nullius:35" ||
    metadata.expansion !== true ||
    metadata.targetName !== "Terra Nullius" ||
    Number(metadata.troopPercent) !== 35 ||
    activeOrdinal > 20 ||
    !Number.isFinite(opening.ownTileShare) ||
    opening.ownTileShare >= 0.12 ||
    !Number.isFinite(banking.incomingThreatRatio) ||
    banking.incomingThreatRatio !== 0
  ) {
    return {
      active_ordinal: activeOrdinal,
      turn: row.turnNumber,
      action: row.selectedLegalActionId,
      target: metadata.targetName ?? null,
      troop_percent: metadata.troopPercent ?? null,
      tile_share: opening.ownTileShare ?? null,
      incoming_threat_ratio: banking.incomingThreatRatio ?? null,
    };
  }
  return null;
}

async function auditArm(directory, expected, plan) {
  const receiptPath = path.join(directory, "receipt.json");
  const resultsPath = path.join(directory, "results.json");
  const replayPath = path.join(directory, "replay");
  const [receipt, results] = await Promise.all([
    readJson(receiptPath),
    readJson(resultsPath),
  ]);
  const config =
    receipt.plan &&
    typeof receipt.plan === "object" &&
    !Array.isArray(receipt.plan)
      ? receipt.plan
      : {};
  const decisionsPath = await findOne(directory, "decisions.jsonl");
  const decisionsRelative = path
    .relative(directory, decisionsPath)
    .split(path.sep)
    .join("/");
  const [receiptArtifact, resultsArtifact, replayArtifact, decisionsArtifact] =
    await Promise.all([
      artifactInfo(receiptPath),
      artifactInfo(resultsPath),
      artifactInfo(replayPath),
      artifactInfo(decisionsPath),
    ]);
  const decisions = await readJsonLines(decisionsPath);
  const odinRows = decisions.filter((row) => row.username === ODIN_NAME);
  const activeRows = odinRows.filter((row) => row.selectedActionKind !== "spawn");
  const k1zIDs = new Set(
    decisions
      .filter((row) => /^K1Z\b/.test(String(row.username ?? "")))
      .flatMap((row) => [
        row.auditBefore?.playerID,
        row.auditAfter?.playerID,
      ])
      .filter(Boolean)
      .map((id) => String(id).toLowerCase()),
  );
  const rejects = odinRows.filter((row) => row.result?.accepted !== true);
  const holds = odinRows.filter((row) => row.selectedActionKind === "hold");
  const unexplainedHolds = holds.filter((row) => !holdIsExplained(row));
  const k1zHarm = odinRows.filter((row) => isK1zHarm(row, k1zIDs));
  const markers = [];
  const markerViolations = [];
  activeRows.forEach((row, index) => {
    if (!String(row.reason ?? "").endsWith(":pg2")) return;
    markers.push({
      active_ordinal: index + 1,
      turn: row.turnNumber,
      action: row.selectedLegalActionId,
      target: row.selectedActionMetadata?.targetName ?? null,
      troop_percent: row.selectedActionMetadata?.troopPercent ?? null,
      accepted: row.result?.accepted === true,
    });
    const violation = markerViolation(row, index + 1);
    if (violation) markerViolations.push(violation);
  });
  const roster = config.players?.map((player) => player.name) ?? [];
  const policy = config.players?.[0]?.policy;
  const expectedPolicy =
    expected.role === "candidate" ? plan.candidate.policy : plan.parent.policy;
  const expectedSpec = expected.spec;
  const integrityViolations = [];
  if (receipt.status !== "passed") integrityViolations.push("receipt_not_passed");
  integrityViolations.push(...receiptPlanIntegrityViolations(receipt));
  integrityViolations.push(
    ...artifactRecordViolations(
      receipt,
      "results.json",
      resultsArtifact,
      true,
    ),
    ...artifactRecordViolations(receipt, "replay", replayArtifact, true),
    ...artifactRecordViolations(
      receipt,
      decisionsRelative,
      decisionsArtifact,
    ),
  );
  if (receipt.post_run_attestation?.status !== "stable") {
    integrityViolations.push("post_run_attestation_not_stable");
  }
  if (receipt.bundle_verification?.manifest_sha256 !== plan.bundle_manifest_sha256) {
    integrityViolations.push("bundle_manifest_hash_drift");
  }
  if (receipt.run_spec?.sha256 !== expectedSpec.sha256) {
    integrityViolations.push("run_spec_hash_drift");
  }
  if (JSON.stringify(roster) !== JSON.stringify(EXPECTED_ROSTER)) {
    integrityViolations.push("roster_drift");
  }
  if (
    config.game_config?.map !== expected.map ||
    config.game_config?.seed !== expected.seed ||
    config.game_config?.map_size !== plan.game.map_size ||
    config.game_config?.max_decision_steps !== plan.game.max_decision_steps ||
    policy !== expectedPolicy
  ) {
    integrityViolations.push("config_drift");
  }
  if (
    results.seed !== expected.seed ||
    JSON.stringify(results.players?.map((player) => player.name)) !==
      JSON.stringify(EXPECTED_ROSTER)
  ) {
    integrityViolations.push("results_identity_drift");
  }
  const odin = results.players?.[0];
  return {
    role: expected.role,
    directory,
    receipt_sha256: receiptArtifact.sha256,
    results_sha256: resultsArtifact.sha256,
    replay_sha256: replayArtifact.sha256,
    decisions_sha256: decisionsArtifact.sha256,
    game_id: results.game_id,
    decision_count: odinRows.length,
    accepted_decisions: odinRows.length - rejects.length,
    rejects: rejects.length,
    holds: holds.length,
    unexplained_holds: unexplainedHolds.length,
    fallbacks: odinRows.filter((row) => row.fallbackUsed === true).length,
    k1z_harm: k1zHarm.length,
    marker_count: markers.length,
    markers,
    marker_violations: markerViolations,
    d20_tiles: checkpointTiles(activeRows, 20),
    d50_tiles: checkpointTiles(activeRows, 50),
    final_tiles: odin?.tiles_owned ?? null,
    final_score: odin?.score ?? null,
    declared_win: results.winner_slot === 0,
    winner_slot: results.winner_slot,
    integrity_violations: integrityViolations,
  };
}

async function auditPair(candidateDir, parentDir, bundledPlan, pairID) {
  const pair = bundledPlan.pairs.find((entry) => entry.pair_id === pairID);
  if (!pair) throw new Error(`pair absent from plan: ${pairID}`);
  const plan = {
    ...bundledPlan,
    bundle_manifest_sha256: bundledPlan.bundle_manifest_sha256,
  };
  const candidate = await auditArm(
    candidateDir,
    {
      role: "candidate",
      map: pair.map,
      seed: pair.seed,
      spec: pair.specs.candidate,
    },
    plan,
  );
  const parent = await auditArm(
    parentDir,
    {
      role: "exact-parent",
      map: pair.map,
      seed: pair.seed,
      spec: pair.specs["exact-parent"],
    },
    plan,
  );
  const violations = [
    ...candidate.integrity_violations.map((value) => `candidate:${value}`),
    ...parent.integrity_violations.map((value) => `parent:${value}`),
  ];
  for (const [label, arm] of [
    ["candidate", candidate],
    ["parent", parent],
  ]) {
    if (arm.rejects > 0) violations.push(`${label}:rejection`);
    if (arm.unexplained_holds > 0) violations.push(`${label}:unexplained_hold`);
    if (arm.k1z_harm > 0) violations.push(`${label}:k1z_harm`);
    if (arm.marker_violations.length > 0) {
      violations.push(`${label}:marker_outside_guard`);
    }
  }
  if (parent.marker_count > 0) violations.push("parent:unexpected_pg2_marker");
  return {
    schema_version: 1,
    pair_id: pairID,
    map: pair.map,
    seed: pair.seed,
    worker: pair.worker,
    candidate,
    parent,
    deltas: {
      d20_tiles:
        Number.isFinite(candidate.d20_tiles) && Number.isFinite(parent.d20_tiles)
          ? candidate.d20_tiles - parent.d20_tiles
          : null,
      d50_tiles:
        Number.isFinite(candidate.d50_tiles) && Number.isFinite(parent.d50_tiles)
          ? candidate.d50_tiles - parent.d50_tiles
          : null,
      final_tiles:
        Number.isFinite(candidate.final_tiles) &&
        Number.isFinite(parent.final_tiles)
          ? candidate.final_tiles - parent.final_tiles
          : null,
      final_score:
        Number.isFinite(candidate.final_score) &&
        Number.isFinite(parent.final_score)
          ? candidate.final_score - parent.final_score
          : null,
      declared_wins:
        Number(candidate.declared_win) - Number(parent.declared_win),
    },
    hard_stop_violations: [...new Set(violations)],
    hard_stop_pass: violations.length === 0,
  };
}

async function auditMatrix(root, bundledPlan) {
  const pairs = [];
  for (const pair of bundledPlan.pairs) {
    const base = path.join(root, "workers", pair.worker, pair.pair_id);
    pairs.push(
      await auditPair(
        path.join(base, "candidate"),
        path.join(base, "parent"),
        bundledPlan,
        pair.pair_id,
      ),
    );
  }
  const mapResults = {};
  for (const map of bundledPlan.maps) {
    const selected = pairs.filter((pair) => pair.map === map);
    const candidateWins = selected.filter(
      (pair) => pair.candidate.declared_win,
    ).length;
    const parentWins = selected.filter((pair) => pair.parent.declared_win).length;
    mapResults[map] = {
      pairs: selected.length,
      reached_pairs: selected.filter((pair) => pair.candidate.marker_count > 0)
        .length,
      median_d20_tile_delta: median(
        selected.map((pair) => pair.deltas.d20_tiles),
      ),
      median_d50_tile_delta: median(
        selected.map((pair) => pair.deltas.d50_tiles),
      ),
      median_final_score_delta: median(
        selected.map((pair) => pair.deltas.final_score),
      ),
      candidate_declared_wins: candidateWins,
      parent_declared_wins: parentWins,
      wins_not_lower: candidateWins >= parentWins,
    };
  }
  const candidateWins = pairs.filter((pair) => pair.candidate.declared_win).length;
  const parentWins = pairs.filter((pair) => pair.parent.declared_win).length;
  const hardStops = pairs.flatMap((pair) =>
    pair.hard_stop_violations.map((violation) => `${pair.pair_id}:${violation}`),
  );
  const positiveFinalScorePairs = pairs.filter(
    (pair) => pair.deltas.final_score > 0,
  ).length;
  const rules = bundledPlan.pass_rules;
  const outcomeChecks = {
    reach_per_map: Object.values(mapResults).every(
      (entry) => entry.reached_pairs >= rules.minimum_reached_pairs_per_map,
    ),
    positive_d20_median_per_map: Object.values(mapResults).every(
      (entry) => entry.median_d20_tile_delta > 0,
    ),
    positive_d50_median_per_map: Object.values(mapResults).every(
      (entry) => entry.median_d50_tile_delta > 0,
    ),
    positive_final_score_median_per_map: Object.values(mapResults).every(
      (entry) => entry.median_final_score_delta > 0,
    ),
    positive_final_score_pairs:
      positiveFinalScorePairs >= rules.minimum_positive_final_score_pairs_overall,
    wins_not_lower_per_map: Object.values(mapResults).every(
      (entry) => entry.wins_not_lower,
    ),
    wins_not_lower_overall: candidateWins >= parentWins,
  };
  const localQualified =
    hardStops.length === 0 &&
    Object.values(outcomeChecks).every((value) => value === true);
  return {
    schema_version: 1,
    run_id: bundledPlan.run_id,
    pair_count: pairs.length,
    hard_stop_pass: hardStops.length === 0,
    hard_stop_violations: hardStops,
    positive_final_score_pairs: positiveFinalScorePairs,
    candidate_declared_wins: candidateWins,
    parent_declared_wins: parentWins,
    maps: mapResults,
    outcome_checks: outcomeChecks,
    local_qualified: localQualified,
    verdict: localQualified ? "LOCAL_MATRIX_PASS" : "LOCAL_MATRIX_FAIL",
    pairs,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2));
  const bundledPlan = await readJson(path.resolve(args.plan));
  if (!bundledPlan.bundle_manifest_sha256) {
    fail("bundled plan must include bundle_manifest_sha256");
  }
  let report;
  if (args.mode === "pair") {
    report = await auditPair(
      path.resolve(args.candidate),
      path.resolve(args.parent),
      bundledPlan,
      args.pair_id,
    );
  } else {
    report = await auditMatrix(path.resolve(args.root), bundledPlan);
  }
  await writeFile(
    path.resolve(args.output),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    args.mode === "pair"
      ? `PG2_PAIR_AUDIT pair=${report.pair_id} hard_stop_pass=${report.hard_stop_pass}`
      : `PG2_MATRIX_AUDIT verdict=${report.verdict} positive_score_pairs=${report.positive_final_score_pairs}`,
  );
  if (args.mode === "pair" && !report.hard_stop_pass) process.exit(2);
}

export {
  actionTargetID,
  artifactRecordViolations,
  auditPair,
  auditMatrix,
  checkpointTiles,
  holdIsExplained,
  isK1zHarm,
  median,
  receiptPlanIntegrityViolations,
  selectedTargetLooksK1z,
};
