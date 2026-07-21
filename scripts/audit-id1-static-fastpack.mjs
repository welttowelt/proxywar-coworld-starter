#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SUBJECT = "K1Z odin free";
const HARMFUL_KINDS = new Set([
  "attack",
  "boat",
  "nuke",
  "move_warship",
  "break_alliance",
  "alliance_break",
  "embargo",
  "embargo_all",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const index = argv.indexOf("--manifest");
  if (index < 0 || !argv[index + 1]) {
    throw new Error("usage: audit-id1-static-fastpack.mjs --manifest FILE");
  }
  return path.resolve(argv[index + 1]);
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function onlyRunDirectory(outputDir) {
  const runsRoot = path.join(outputDir, "proxywar-runs");
  const entries = (await readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new Error(`${outputDir} has ${entries.length} run directories; expected exactly 1`);
  }
  return path.join(runsRoot, entries[0].name);
}

async function readJsonLines(file) {
  return String(await readFile(file))
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error.message}`);
      }
    });
}

function isPartnerName(value, protectedNames) {
  const candidate = normalize(value);
  return protectedNames.some((name) => candidate === name || candidate.includes(name));
}

function countK1zHarm(decisions, protectedNames, protectedIDs) {
  return decisions.filter((decision) => {
    if (!HARMFUL_KINDS.has(decision.selectedActionKind)) return false;
    const metadata = decision.selectedActionMetadata || {};
    const targetName = metadata.targetName ?? metadata.recipientName ?? "";
    const targetID = normalize(metadata.targetID ?? metadata.recipientID ?? "");
    return isPartnerName(targetName, protectedNames) || protectedIDs.has(targetID);
  }).length;
}

async function auditJob(job, manifest, repoRoot) {
  const jobPath = path.resolve(repoRoot, job.job_path);
  const jobBytes = await readFile(jobPath);
  const actualJobSha = sha256(jobBytes);
  if (actualJobSha !== job.job_sha256) {
    throw new Error(`${job.id} job hash mismatch: ${actualJobSha}`);
  }
  const jobSpec = JSON.parse(jobBytes);
  const expectedRoster = manifest.cell[`orientation_${job.orientation}`];
  const actualRoster = jobSpec.game_config?.players?.map((player) => player.name);
  if (JSON.stringify(actualRoster) !== JSON.stringify(expectedRoster)) {
    throw new Error(`${job.id} roster does not match orientation ${job.orientation}`);
  }
  if (
    jobSpec.game_config.map !== manifest.cell.map ||
    jobSpec.game_config.map_size !== manifest.cell.map_size ||
    jobSpec.game_config.seed !== manifest.cell.seed ||
    jobSpec.game_config.max_decision_steps !== manifest.cell.max_decision_steps ||
    jobSpec.game_config.turns_per_decision_step !== manifest.cell.turns_per_decision_step
  ) {
    throw new Error(`${job.id} cell configuration drifted from the manifest`);
  }
  const subjectSlot = actualRoster.indexOf(SUBJECT);
  if (subjectSlot < 0 || jobSpec.players?.[subjectSlot]?.image !== manifest.images[job.arm].image_id) {
    throw new Error(`${job.id} does not bind ${job.arm} to the Odin seat`);
  }

  const runDir = await onlyRunDirectory(job.output_dir);
  const decisionsPath = path.join(runDir, "decisions.jsonl");
  const summaryPath = path.join(runDir, "match-summary.json");
  const decisions = (await readJsonLines(decisionsPath))
    .filter((decision) => decision.username === SUBJECT);
  if (decisions.length === 0) throw new Error(`${job.id} has no ${SUBJECT} decisions`);

  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const finalPlayers = Array.isArray(summary.finalState) ? summary.finalState : [];
  const protectedNames = manifest.coalition.protected_names.map(normalize);
  const protectedIDs = new Set(manifest.coalition.exact_player_ids.map(normalize));
  for (const player of finalPlayers) {
    if (player.username !== SUBJECT && isPartnerName(player.username, protectedNames)) {
      protectedIDs.add(normalize(player.playerID));
    }
  }

  const active = decisions.filter((decision) => decision.selectedActionKind !== "spawn");
  if (active.length < 20) {
    throw new Error(`${job.id} has ${active.length} active decisions; expected at least 20`);
  }
  const opening = active.slice(0, 20);
  const tiles = opening.map((decision, index) => {
    const value = Number(decision.auditBefore?.tilesOwned);
    if (!Number.isFinite(value)) {
      throw new Error(`${job.id} active decision ${index + 1} has no auditBefore.tilesOwned`);
    }
    return value;
  });

  return {
    id: job.id,
    orientation: job.orientation,
    arm: job.arm,
    job_sha256: actualJobSha,
    decisions: decisions.length,
    active_decisions: active.length,
    accepted: decisions.filter((decision) => decision.result?.accepted === true).length,
    rejects: decisions.filter((decision) => decision.result?.accepted !== true).length,
    fallbacks: decisions.filter((decision) => decision.fallbackUsed === true).length,
    planner_degradations: decisions.filter((decision) =>
      decision.llmPlannerDegraded === true || String(decision.reason ?? "").startsWith("dgd:")
    ).length,
    holds: active.filter((decision) =>
      decision.selectedActionKind === "hold" || decision.selectedLegalActionId === "hold"
    ).length,
    harmful_k1z_actions: countK1zHarm(decisions, protectedNames, protectedIDs),
    id1_reach: decisions.filter((decision) =>
      String(decision.reason ?? "").split(":").includes("id1")
    ).length,
    opening_auc20: tiles.reduce((sum, value) => sum + value, 0),
    decision_20_tiles: tiles[19],
    decisions_sha256: sha256(await readFile(decisionsPath)),
    match_summary_sha256: sha256(await readFile(summaryPath)),
  };
}

function evaluate(jobs) {
  const failures = [];
  for (const job of jobs) {
    for (const field of ["rejects", "fallbacks", "planner_degradations", "holds", "harmful_k1z_actions"]) {
      if (job[field] !== 0) failures.push(`${job.id}:${field}=${job[field]}`);
    }
    if (job.accepted !== job.decisions) {
      failures.push(`${job.id}:accepted=${job.accepted}/${job.decisions}`);
    }
    if (job.arm === "candidate" && job.id1_reach < 1) {
      failures.push(`${job.id}:id1_reach=0`);
    }
    if (job.arm === "control" && job.id1_reach !== 0) {
      failures.push(`${job.id}:control_id1_reach=${job.id1_reach}`);
    }
  }

  const comparisons = [];
  for (const orientation of ["a", "b"]) {
    const candidate = jobs.find((job) => job.orientation === orientation && job.arm === "candidate");
    const control = jobs.find((job) => job.orientation === orientation && job.arm === "control");
    if (!candidate || !control) {
      failures.push(`${orientation}:missing candidate/control pair`);
      continue;
    }
    const aucWin = candidate.opening_auc20 > control.opening_auc20;
    const d20Win = candidate.decision_20_tiles > control.decision_20_tiles;
    comparisons.push({
      orientation,
      candidate: candidate.id,
      control: control.id,
      candidate_opening_auc20: candidate.opening_auc20,
      control_opening_auc20: control.opening_auc20,
      candidate_decision_20_tiles: candidate.decision_20_tiles,
      control_decision_20_tiles: control.decision_20_tiles,
      candidate_auc20_strict_win: aucWin,
      candidate_decision_20_strict_win: d20Win,
    });
    if (!aucWin) failures.push(`${orientation}:candidate AUC20 did not strictly beat control`);
    if (!d20Win) failures.push(`${orientation}:candidate decision-20 tiles did not strictly beat control`);
  }
  return { failures, comparisons };
}

async function writeReceipt(receiptPath, receipt) {
  const absolute = path.resolve(receiptPath);
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, absolute);
}

async function main() {
  const manifestPath = parseArgs(process.argv.slice(2));
  const manifestBytes = await readFile(manifestPath);
  const manifestSha = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  const repoRoot = path.dirname(path.dirname(manifestPath));
  const selfPath = fileURLToPath(import.meta.url);
  const selfSha = sha256(await readFile(selfPath));
  let receipt;
  let exitCode;

  try {
    if (manifest.schema_version !== 1) throw new Error("unsupported manifest schema_version");
    if (manifest.runtime?.coworld_version !== "0.1.30") {
      throw new Error("runtime.coworld_version must be 0.1.30");
    }
    if (manifest.auditor?.sha256 !== selfSha) {
      throw new Error(`auditor hash mismatch: ${selfSha}`);
    }
    for (const [relativePath, expectedSha] of Object.entries(manifest.source.sha256)) {
      const actualSha = sha256(await readFile(path.resolve(repoRoot, relativePath)));
      if (actualSha !== expectedSha) {
        throw new Error(`${relativePath} source hash mismatch: ${actualSha}`);
      }
    }
    const coworldSha = sha256(await readFile(manifest.coworld_manifest.path));
    if (coworldSha !== manifest.coworld_manifest.sha256) {
      throw new Error(`Coworld manifest hash mismatch: ${coworldSha}`);
    }
    if (!Array.isArray(manifest.jobs) || manifest.jobs.length !== 4) {
      throw new Error("manifest must bind exactly four jobs");
    }
    if (new Set(manifest.jobs.map((job) => job.output_dir)).size !== 4) {
      throw new Error("all four jobs require distinct output directories");
    }
    const jobs = [];
    for (const job of manifest.jobs) jobs.push(await auditJob(job, manifest, repoRoot));
    const { failures, comparisons } = evaluate(jobs);
    receipt = {
      schema_version: 1,
      experiment_id: manifest.experiment_id,
      created_at: new Date().toISOString(),
      manifest_path: manifestPath,
      manifest_sha256: manifestSha,
      source_commit: manifest.source.commit,
      auditor_sha256: selfSha,
      verdict: failures.length === 0 ? "PASS_FASTPACK" : "FAIL_FASTPACK",
      failures,
      jobs,
      comparisons,
      league_mutation: false,
    };
    exitCode = failures.length === 0 ? 0 : 1;
  } catch (error) {
    receipt = {
      schema_version: 1,
      experiment_id: manifest.experiment_id ?? null,
      created_at: new Date().toISOString(),
      manifest_path: manifestPath,
      manifest_sha256: manifestSha,
      source_commit: manifest.source?.commit ?? null,
      auditor_sha256: selfSha,
      verdict: "FAIL_ARTIFACT",
      failures: [error.message],
      jobs: [],
      comparisons: [],
      league_mutation: false,
    };
    exitCode = 2;
  }

  await writeReceipt(manifest.receipts.local_audit_path, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
