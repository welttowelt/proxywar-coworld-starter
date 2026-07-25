#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const COWORLD_PACKAGE = "coworld==0.1.34";
const SERVER = "https://softmax.com/api";
const ALLOWED_REPLAY_PREFIX =
  "https://softmax-public.s3.amazonaws.com/replays/";
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
const REQUEST_ID = /^xreq_[0-9a-f-]+$/;
const EPISODE_REQUEST_ID = /^ereq_[0-9a-f-]+$/;
const POLICY_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function legalKinds(row) {
  const byKind = row?.legalActionIDsByKind;
  if (!byKind || typeof byKind !== "object" || Array.isArray(byKind)) return [];
  return Object.entries(byKind)
    .filter(([, actionIDs]) => Array.isArray(actionIDs) && actionIDs.length > 0)
    .map(([kind]) => kind);
}

export function classifyCaptainHold(row) {
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

export function auditCaptainDecisions(rows, marker) {
  assert(typeof marker === "string" && marker.length > 0, "marker is required");
  const holds = rows
    .filter((row) => row.selectedActionKind === "hold")
    .map(classifyCaptainHold);
  const markers = rows
    .filter((row) => String(row.reason ?? "").includes(marker))
    .map((row) => {
      const valid =
        ["attack", "boat", "build"].includes(row.selectedActionKind) &&
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
    parse_failure_count: rows.filter(
      (row) => row.parseFailure === true || row.parse_failure === true,
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
    invalid_marker_count: markers.filter((entry) => !entry.valid).length,
    markers,
  };
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
  assert(typeof raw === "string", "replay is missing inline decisions.jsonl");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function replayBytes(url) {
  assert(
    typeof url === "string" && url.startsWith(ALLOWED_REPLAY_PREFIX),
    `replay URL is outside the allowlist: ${url}`,
  );
  const response = await fetch(url);
  assert(response.ok, `replay download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length <= MAX_REPLAY_BYTES, `replay exceeds ${MAX_REPLAY_BYTES} bytes`);
  return bytes;
}

function validateConfig(config) {
  assert(config?.schema_version === 1, "config.schema_version must be 1");
  assert(REQUEST_ID.test(config.request_id ?? ""), "invalid config.request_id");
  assert(
    Number.isInteger(config.episode_count) && config.episode_count > 0,
    "config.episode_count must be positive",
  );
  assert(
    Array.isArray(config.expected_episode_request_ids) &&
      config.expected_episode_request_ids.length === config.episode_count &&
      config.expected_episode_request_ids.every((id) => EPISODE_REQUEST_ID.test(id)),
    "invalid config.expected_episode_request_ids",
  );
  assert(
    new Set(config.expected_episode_request_ids).size === config.episode_count,
    "episode request ids must be unique",
  );
  assert(
    Array.isArray(config.expected_policy_version_ids) &&
      config.expected_policy_version_ids.length > 0 &&
      config.expected_policy_version_ids.every((id) => POLICY_VERSION_ID.test(id)),
    "invalid config.expected_policy_version_ids",
  );
  assert(
    Number.isInteger(config.candidate_slot) &&
      config.candidate_slot >= 0 &&
      config.candidate_slot < config.expected_policy_version_ids.length,
    "invalid config.candidate_slot",
  );
  assert(
    config.expected_policy_version_ids[config.candidate_slot] ===
      config.candidate_policy_version_id,
    "candidate policy does not occupy candidate_slot",
  );
  assert(
    typeof config.marker === "string" && config.marker.length > 0,
    "config.marker is required",
  );
  assert(
    Number.isInteger(config.minimum_marker_count) &&
      config.minimum_marker_count >= 0,
    "config.minimum_marker_count must be non-negative",
  );
  return config;
}

function validateEpisodeIdentity(episode, config) {
  const participant = (episode.participants ?? []).find(
    (row) => row.policy_version_id === config.candidate_policy_version_id,
  );
  const policyVersionIDs = (episode.participants ?? []).map(
    (row) => row.policy_version_id,
  );
  return {
    participant,
    checks: {
      completed: episode.status === "completed",
      expected_episode_request:
        config.expected_episode_request_ids.includes(episode.id),
      exact_roster:
        JSON.stringify(policyVersionIDs) ===
        JSON.stringify(config.expected_policy_version_ids),
      exact_candidate:
        participant?.position === config.candidate_slot &&
        participant?.player_id === config.candidate_player_id &&
        participant?.player_name === config.candidate_player_name,
      exact_runtime:
        episode.coworld_id === config.coworld_id &&
        episode.coworld_version === config.coworld_version &&
        episode.game_config?.map === config.map &&
        episode.game_config?.num_agents ===
          config.expected_policy_version_ids.length,
      replay_available:
        typeof episode.replay_url === "string" &&
        episode.replay_url.startsWith(ALLOWED_REPLAY_PREFIX),
    },
  };
}

function scoreForCandidate(episode, config) {
  const rows = (episode.scores ?? []).filter(
    (row) => row.policy_version_id === config.candidate_policy_version_id,
  );
  return rows.length === 1 && Number.isFinite(Number(rows[0].score))
    ? Number(rows[0].score)
    : null;
}

async function auditEpisode(episode, config, replayCache) {
  const identity = validateEpisodeIdentity(episode, config);
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
    (row) => slotFromAgentID(row.agentID) === config.candidate_slot,
  );
  const behavior = auditCaptainDecisions(rows, config.marker);
  const score = scoreForCandidate(episode, config);
  const replayPlayer = replay?.results?.players?.[config.candidate_slot] ?? {};
  const replayWon = replay?.results?.winner_slot === config.candidate_slot;
  const replayPath = path.join(
    replayCache,
    `${episode.episode_id ?? episode.id}.replay`,
  );
  await writeFile(replayPath, bytes, { flag: "wx", mode: 0o600 });
  return {
    episode_request_id: episode.id,
    episode_id: episode.episode_id,
    identity_checks: identity.checks,
    replay_sha256: sha256(bytes),
    replay_bytes: bytes.length,
    score,
    won: score === 1 || replayWon,
    final_tiles: replayPlayer.tiles_owned ?? replayPlayer.tilesOwned ?? null,
    is_alive: replayPlayer.is_alive ?? replayPlayer.isAlive ?? null,
    ...behavior,
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const configPath = option("config");
  const output = option("output");
  const replayCache = option("replay-cache");
  assert(configPath && output && replayCache, "usage: audit-captain-hosted.mjs --config JSON --output ABS_JSON --replay-cache ABS_DIR");
  assert(path.isAbsolute(output), "--output must be absolute");
  assert(path.isAbsolute(replayCache), "--replay-cache must be absolute");
  const config = validateConfig(
    JSON.parse(await readFile(path.resolve(configPath), "utf8")),
  );
  const request = coworldJson(["xp-request", "get", config.request_id]);
  const episodes = coworldJson(["xp-request", "episodes", config.request_id]);
  await mkdir(replayCache, { recursive: true });

  const violations = [];
  if (
    request.status !== "completed" ||
    request.completed_count !== config.episode_count ||
    request.failed_count !== 0 ||
    request.coworld_id !== config.coworld_id ||
    request.coworld_version !== config.coworld_version ||
    request.variant_id !== config.variant_id ||
    episodes.length !== config.episode_count
  ) {
    violations.push("hosted request identity, completion, or transport gate failed");
  }
  if (
    JSON.stringify([...new Set(episodes.map((episode) => episode.id))].sort()) !==
    JSON.stringify([...config.expected_episode_request_ids].sort())
  ) {
    violations.push("hosted episode request identities drifted");
  }

  const episodeAudits = [];
  for (const episode of episodes) {
    const audit = await auditEpisode(episode, config, replayCache);
    episodeAudits.push(audit);
    if (!Object.values(audit.identity_checks ?? {}).every(Boolean)) {
      violations.push(`${episode.id}: identity or completion check failed`);
      continue;
    }
    for (const [field, label] of [
      ["rejected_decision_count", "rejected decisions"],
      ["unconfirmed_decision_count", "unconfirmed decisions"],
      ["parse_failure_count", "parse failures"],
      ["fallback_count", "fallbacks"],
      ["degraded_count", "degraded decisions"],
      ["unexplained_hold_count", "unexplained holds"],
      ["invalid_marker_count", "invalid markers"],
    ]) {
      if (audit[field] !== 0) {
        violations.push(`${episode.id}: candidate had ${label}`);
      }
    }
  }

  const wins = episodeAudits.filter((audit) => audit.won).length;
  const markerCount = episodeAudits.reduce(
    (sum, audit) => sum + (audit.marker_count ?? 0),
    0,
  );
  if (wins !== config.episode_count) {
    violations.push(
      `candidate won ${wins}/${config.episode_count}, not ${config.episode_count}/${config.episode_count}`,
    );
  }
  if (markerCount < config.minimum_marker_count) {
    violations.push(
      `${config.marker} reached ${markerCount} times, below ${config.minimum_marker_count}`,
    );
  }

  const report = {
    schema_version: 1,
    arm: config.arm,
    gate: config.gate,
    recorded_at: new Date().toISOString(),
    request_id: config.request_id,
    request_status: request.status,
    coworld_id: request.coworld_id,
    coworld_version: request.coworld_version,
    variant: request.variant_id,
    candidate_policy_version_id: config.candidate_policy_version_id,
    candidate_slot: config.candidate_slot,
    completed_episodes: episodeAudits.length,
    wins,
    marker: config.marker,
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
    process.stderr.write(`CAPTAIN_HOSTED_AUDIT_FAILED: ${error.message}\n`);
    process.exitCode = 2;
  });
}
