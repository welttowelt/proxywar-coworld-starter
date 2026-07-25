#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const COWORLD_PACKAGE = "coworld==0.1.34";
const SERVER = "https://softmax.com/api";
const REQUEST_ID = "xreq_b6b9d83c-e1af-405f-8724-6e1d58a573af";
const COWORLD_ID = "cow_5d275752-ff30-4f5c-a1c1-6db56b518ef2";
const CANDIDATE_POLICY_VERSION_ID = "a5a12c09-f27e-4bb6-9927-c68d2c48c81f";
const CANDIDATE_PLAYER_ID = "ply_02c1e39b-94af-4b38-8e12-645e6cd06ec1";
const CANDIDATE_PLAYER_NAME = "Captain Underpants Maximum Aura";
const CANDIDATE_SLOT = 9;
const VARIANT = "tournament-12p-world";
const EPISODE_COUNT = 4;
const EXPECTED_POLICY_VERSION_IDS = Object.freeze([
  "cea2bb5b-add0-4dd3-aa32-9442280142c5",
  "dffb6fb2-673e-4be5-9e35-ba69d6731754",
  "9f233579-4837-4a27-b352-ed3135301135",
  "4110c5a3-f340-44d6-ad60-106f5672df88",
  "2b8cdf1f-7602-4340-ac38-3e6eba911ec7",
  "b378acb9-2446-45c9-b3ce-67eac8e72170",
  "13cfba2f-2270-4b1f-97a2-d9cd3d391b21",
  "3ed5713d-7940-45f1-b347-76d596b90fe8",
  "7329eda7-b041-4853-9ee6-e05cc1a98ac2",
  CANDIDATE_POLICY_VERSION_ID,
  "93b8e253-6b9c-4ae6-983e-857e044c4842",
  "08a431c6-7b6d-48d2-ad08-5b7e3530528d",
]);
const EXPECTED_EPISODE_REQUEST_IDS = new Set([
  "ereq_b547b5c4-7fb3-4b79-9ef6-02beb205ae92",
  "ereq_5c77d604-cb87-4b6b-9655-cc5e5667881e",
  "ereq_b8628fb1-a33a-4767-a5a2-db856f97f608",
  "ereq_e3097c29-129b-426e-a61c-11ceb51f4b1d",
]);
const TACTICAL_KINDS = new Set([
  "spawn",
  "attack",
  "boat",
  "build",
  "upgrade",
  "boat_retreat",
  "retreat_transport",
  "move_warship",
  "nuke",
]);
const ALLOWED_REPLAY_PREFIX =
  "https://softmax-public.s3.amazonaws.com/replays/";
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function coworldJson(args) {
  const result = spawnSync(
    "uvx",
    ["--from", COWORLD_PACKAGE, "coworld", ...args, "--server", SERVER, "--json"],
    {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `coworld ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
}

function parseDecisions(replay) {
  const raw = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof raw !== "string") {
    throw new Error("replay is missing inline decisions.jsonl");
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function legalKinds(row) {
  const byKind = row?.legalActionIDsByKind;
  if (!byKind || typeof byKind !== "object" || Array.isArray(byKind)) return [];
  return Object.entries(byKind)
    .filter(([, actionIDs]) => Array.isArray(actionIDs) && actionIDs.length > 0)
    .map(([kind]) => kind);
}

export function classifyHold(row) {
  const kinds = legalKinds(row);
  const tacticalKinds = kinds.filter((kind) => TACTICAL_KINDS.has(kind));
  return {
    turn: row.turnNumber ?? null,
    reason: row.reason ?? null,
    legal_kinds: kinds,
    tactical_kinds: tacticalKinds,
    explained: tacticalKinds.length === 0,
  };
}

export function auditCandidateDecisions(rows) {
  const holds = rows
    .filter((row) => row.selectedActionKind === "hold")
    .map(classifyHold);
  const markers = rows
    .filter((row) => String(row.reason ?? "").includes("wc5"))
    .map((row) => {
      const valid =
        ["boat", "build"].includes(row.selectedActionKind) &&
        row.result?.accepted === true &&
        row.fallbackUsed !== true &&
        row.llmPlannerDegraded !== true;
      return {
        turn: row.turnNumber ?? null,
        action_id: row.selectedLegalActionId ?? null,
        action_kind: row.selectedActionKind ?? null,
        reason: row.reason ?? null,
        accepted: row.result?.accepted ?? null,
        valid,
      };
    });
  return {
    decision_count: rows.length,
    accepted_decision_count: rows.filter((row) => row.result?.accepted === true)
      .length,
    rejected_decision_count: rows.filter((row) => row.result?.accepted === false)
      .length,
    unconfirmed_decision_count: rows.filter(
      (row) => typeof row.result?.accepted !== "boolean",
    ).length,
    fallback_count: rows.filter((row) => row.fallbackUsed === true).length,
    degraded_count: rows.filter(
      (row) =>
        row.llmPlannerDegraded === true ||
        String(row.actionSelectionSource ?? "").includes("degraded"),
    ).length,
    hold_count: holds.length,
    unexplained_hold_count: holds.filter((hold) => !hold.explained).length,
    holds,
    marker_count: markers.length,
    invalid_marker_count: markers.filter((marker) => !marker.valid).length,
    markers,
  };
}

async function replayBytes(url) {
  if (typeof url !== "string" || !url.startsWith(ALLOWED_REPLAY_PREFIX)) {
    throw new Error(`replay URL is outside the allowlist: ${url}`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`replay download failed with HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REPLAY_BYTES) {
    throw new Error(`replay exceeds ${MAX_REPLAY_BYTES} bytes`);
  }
  return bytes;
}

function scoreForCandidate(episode) {
  const rows = (episode.scores ?? []).filter(
    (row) => row.policy_version_id === CANDIDATE_POLICY_VERSION_ID,
  );
  return rows.length === 1 && Number.isFinite(Number(rows[0].score))
    ? Number(rows[0].score)
    : null;
}

export function validateEpisodeIdentity(episode) {
  const participant = (episode.participants ?? []).find(
    (row) => row.policy_version_id === CANDIDATE_POLICY_VERSION_ID,
  );
  const policyVersionIDs = (episode.participants ?? []).map(
    (row) => row.policy_version_id,
  );
  return {
    participant,
    checks: {
      completed: episode.status === "completed",
      expected_episode_request: EXPECTED_EPISODE_REQUEST_IDS.has(episode.id),
      exact_roster:
        JSON.stringify(policyVersionIDs) ===
        JSON.stringify(EXPECTED_POLICY_VERSION_IDS),
      exact_candidate:
        participant?.position === CANDIDATE_SLOT &&
        participant?.player_id === CANDIDATE_PLAYER_ID &&
        participant?.player_name === CANDIDATE_PLAYER_NAME,
      exact_runtime:
        episode.coworld_id === COWORLD_ID &&
        episode.coworld_version === "0.1.11" &&
        episode.game_config?.map === "World" &&
        episode.game_config?.num_agents === 12,
      replay_available:
        typeof episode.replay_url === "string" &&
        episode.replay_url.startsWith(ALLOWED_REPLAY_PREFIX),
    },
  };
}

async function auditEpisode(episode, replayCache) {
  const identity = validateEpisodeIdentity(episode);
  if (!Object.values(identity.checks).every(Boolean)) {
    return {
      episode_request_id: episode.id,
      identity_checks: identity.checks,
      violation: "episode identity or completion check failed",
    };
  }
  const bytes = await replayBytes(episode.replay_url);
  const replay = JSON.parse(bytes.toString("utf8"));
  const rows = parseDecisions(replay).filter(
    (row) => slotFromAgentID(row.agentID) === CANDIDATE_SLOT,
  );
  const behavior = auditCandidateDecisions(rows);
  const score = scoreForCandidate(episode);
  const replayPlayer = replay?.results?.players?.[CANDIDATE_SLOT] ?? {};
  const replayWon = replay?.results?.winner_slot === CANDIDATE_SLOT;
  const destination = path.join(
    replayCache,
    `${episode.episode_id ?? episode.id}.replay`,
  );
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  return {
    episode_request_id: episode.id,
    episode_id: episode.episode_id,
    identity_checks: identity.checks,
    replay_sha256: sha256(bytes),
    score,
    won: score === 1 || replayWon,
    final_tiles:
      replayPlayer.tiles_owned ?? replayPlayer.tilesOwned ?? null,
    is_alive: replayPlayer.is_alive ?? replayPlayer.isAlive ?? null,
    ...behavior,
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const requestID = process.argv[2];
  const output = option("output");
  if (requestID !== REQUEST_ID || !output) {
    throw new Error(
      `usage: node scripts/audit-captain-wc5-hosted.mjs ${REQUEST_ID} --output ABS_JSON`,
    );
  }
  if (!path.isAbsolute(output)) throw new Error("--output must be absolute");
  const request = coworldJson(["xp-request", "get", requestID]);
  const episodes = coworldJson(["xp-request", "episodes", requestID]);
  const replayCache = path.resolve("data/cache/replays");
  await mkdir(replayCache, { recursive: true });

  const violations = [];
  if (
    request.status !== "completed" ||
    request.completed_count !== EPISODE_COUNT ||
    request.failed_count !== 0 ||
    request.coworld_id !== COWORLD_ID ||
    request.variant_id !== VARIANT ||
    episodes.length !== EPISODE_COUNT
  ) {
    violations.push("hosted request identity, completion, or transport gate failed");
  }
  if (
    JSON.stringify([...new Set(episodes.map((episode) => episode.id))].sort()) !==
    JSON.stringify([...EXPECTED_EPISODE_REQUEST_IDS].sort())
  ) {
    violations.push("hosted episode request identities drifted");
  }

  const episodeAudits = [];
  for (const episode of episodes) {
    const audit = await auditEpisode(episode, replayCache);
    episodeAudits.push(audit);
    if (!Object.values(audit.identity_checks ?? {}).every(Boolean)) {
      violations.push(`${episode.id}: identity or completion check failed`);
      continue;
    }
    if (audit.rejected_decision_count !== 0) {
      violations.push(`${episode.id}: candidate had rejected decisions`);
    }
    if (audit.unconfirmed_decision_count !== 0) {
      violations.push(`${episode.id}: candidate had unconfirmed decisions`);
    }
    if (audit.fallback_count !== 0 || audit.degraded_count !== 0) {
      violations.push(`${episode.id}: candidate fallback or degradation occurred`);
    }
    if (audit.unexplained_hold_count !== 0) {
      violations.push(`${episode.id}: candidate had unexplained holds`);
    }
    if (audit.invalid_marker_count !== 0) {
      violations.push(`${episode.id}: candidate emitted an invalid wc5 marker`);
    }
  }

  const wins = episodeAudits.filter((audit) => audit.won).length;
  const markerCount = episodeAudits.reduce(
    (sum, audit) => sum + (audit.marker_count ?? 0),
    0,
  );
  if (wins !== EPISODE_COUNT) {
    violations.push(`candidate won ${wins}/${EPISODE_COUNT}, not 4/4`);
  }
  if (markerCount < 1) {
    violations.push("wc5 did not reach in the hosted field");
  }

  const report = {
    schema_version: 1,
    arm: "WC5",
    gate: "hosted_current_field_4_of_4",
    recorded_at: new Date().toISOString(),
    request_id: requestID,
    request_status: request.status,
    coworld_id: request.coworld_id,
    coworld_version: request.coworld_version,
    variant: request.variant_id,
    completed_episodes: episodeAudits.length,
    wins,
    marker_count: markerCount,
    violations,
    verdict: violations.length === 0 ? "PASS" : "STOP",
    episodes: episodeAudits,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = violations.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`CAPTAIN_WC5_HOSTED_AUDIT_FAILED: ${error.message}\n`);
    process.exitCode = 2;
  });
}
