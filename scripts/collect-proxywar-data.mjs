import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const COWORLD_PACKAGE = "coworld==0.1.28";
const DEFAULT_LEAGUE_ID = "league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42";
const ALLOWED_REPLAY_HOSTS = new Set(["softmax-public.s3.amazonaws.com"]);
const SOCIAL_KINDS = new Set([
  "alliance_request", "alliance_extend", "break_alliance", "target_player",
  "embargo", "embargo_all", "embargo_stop", "donate_gold", "donate_troops",
  "quick_chat", "emoji",
]);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const roundLimit = Number(option("rounds", "20"));
const leagueID = option("league", DEFAULT_LEAGUE_ID);
if (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > 200) {
  throw new Error("--rounds must be an integer from 1 to 200");
}

const root = process.cwd();
const cacheDir = path.join(root, "data", "cache", "replays");
const stagingDir = path.join(root, "data", "staging");
const processedDir = path.join(root, "data", "processed");

function coworldJson(args) {
  const result = spawnSync(
    "uvx",
    ["--from", COWORLD_PACKAGE, "coworld", ...args, "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`coworld ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeTimestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function replayBytes(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_REPLAY_HOSTS.has(parsed.hostname)) {
    throw new Error(`refusing replay URL outside the allowlist: ${url}`);
  }
  try {
    return await readFile(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`replay download failed (${response.status}): ${url}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024 * 1024) {
    throw new Error(`replay exceeds 64 MiB limit: ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 64 * 1024 * 1024) throw new Error(`replay exceeds 64 MiB limit: ${url}`);
  await writeFile(destination, buffer);
  return buffer;
}

function parseInlineJson(replay, name) {
  const value = replay?.inlineRunArtifacts?.[name];
  if (typeof value !== "string") throw new Error(`replay is missing inline ${name}`);
  return JSON.parse(value);
}

function parseDecisions(replay) {
  const value = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof value !== "string") throw new Error("replay is missing inline decisions.jsonl");
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function participantRow(episode, replay, position) {
  const participant = episode.participants[position];
  const result = replay.results?.players?.[position] || {};
  const score = episode.scores?.find((entry) =>
    entry.policy_version_id === participant.policy_version_id
  )?.score;
  return {
    episode_id: episode.episode_id,
    episode_request_id: episode.id,
    round_id: episode.round_id,
    participant_position: position,
    player_id: participant.player_id,
    player_name: participant.player_name,
    policy_id: participant.policy_id,
    policy_name: participant.policy_name,
    policy_version: participant.version,
    policy_version_id: participant.policy_version_id,
    policy_label: participant.label,
    is_filler: participant.is_filler === true,
    score: numberOrNull(score ?? result.score),
    won: replay.results?.winner_slot === position,
    final_tiles: numberOrNull(result.tiles_owned),
    is_alive: result.is_alive ?? null,
  };
}

function decisionRow(decision, episode, participant, replayHash) {
  const metadata = decision.selectedActionMetadata || {};
  const before = decision.auditBefore || {};
  const after = decision.auditAfter || {};
  const kind = decision.selectedActionKind || null;
  const expansion = metadata.expansion === true;
  return {
    episode_id: episode.episode_id,
    episode_request_id: episode.id,
    round_id: episode.round_id,
    replay_sha256: replayHash,
    participant_position: participant?.participant_position ?? null,
    player_id: participant?.player_id ?? null,
    player_name: participant?.player_name ?? decision.username ?? null,
    policy_version_id: participant?.policy_version_id ?? null,
    policy_name: participant?.policy_name ?? null,
    policy_version: participant?.policy_version ?? null,
    sequence: numberOrNull(decision.sequence),
    turn_number: numberOrNull(decision.turnNumber),
    action_kind: kind,
    action_id: decision.selectedLegalActionId ?? null,
    target_id: metadata.targetID ?? null,
    target_name: metadata.targetName ?? null,
    target_tile_share: numberOrNull(metadata.targetTileShare),
    relative_troop_ratio: numberOrNull(metadata.relativeTroopRatio),
    troop_percent: numberOrNull(metadata.troopPercent),
    is_neutral_attack: kind === "attack" && expansion,
    is_rival_attack: kind === "attack" && !expansion,
    is_neutral_boat: kind === "boat" && expansion,
    is_naval_invasion: kind === "boat" && metadata.navalInvasion === true,
    is_build: kind === "build",
    is_social: SOCIAL_KINDS.has(kind),
    is_hold: kind === "hold",
    fallback_used: decision.fallbackUsed === true,
    decision_latency_ms: numberOrNull(decision.decisionLatencyMs),
    strategic_priority: decision.strategicPriority ?? null,
    objective_kind: decision.objectiveKind ?? null,
    audit_status: decision.auditStatus ?? null,
    accepted: decision.result?.accepted ?? null,
    tiles_before: numberOrNull(before.tilesOwned),
    tiles_after: numberOrNull(after.tilesOwned),
    troops_before: numberOrNull(before.troops),
    troops_after: numberOrNull(after.troops),
  };
}

function ndjson(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

await mkdir(cacheDir, { recursive: true });
await mkdir(stagingDir, { recursive: true });
await mkdir(processedDir, { recursive: true });

const roundsResponse = coworldJson(["rounds", "--league", leagueID, "--limit", "200"]);
const selectedRounds = roundsResponse.entries
  .filter((round) => round.division?.type === "competition" && round.status === "completed")
  .sort((left, right) => right.round_number - left.round_number)
  .slice(0, roundLimit)
  .sort((left, right) => left.round_number - right.round_number);
if (selectedRounds.length === 0) throw new Error("no completed competition rounds found");

const collectedAt = new Date().toISOString();
const roundRows = selectedRounds.map((round) => ({
  round_id: round.id,
  round_number: round.round_number,
  status: round.status,
  division_id: round.division.id,
  division_name: round.division.name,
  entrant_policy_version_ids: round.round_config?.entrant_policy_version_ids || [],
  entrant_count: round.round_config?.entrant_policy_version_ids?.length ?? 0,
  created_at: normalizeTimestamp(round.created_at),
  started_at: normalizeTimestamp(round.started_at),
  completed_at: normalizeTimestamp(round.completed_at),
  collected_at: collectedAt,
}));

const episodes = [];
for (const round of selectedRounds) {
  const rows = coworldJson([
    "episodes", "--round", round.id, "--with-replay", "--limit", "200",
  ]);
  episodes.push(...rows.filter((episode) => episode.status === "completed" && episode.replay_url));
  process.stdout.write(`round ${round.round_number}: ${rows.length} episode(s)\n`);
}

const episodeRows = [];
const participantRows = [];
const decisionRows = [];
const replayManifest = [];
for (const episode of episodes) {
  const destination = path.join(cacheDir, `${episode.episode_id}.replay`);
  const bytes = await replayBytes(episode.replay_url, destination);
  const replayHash = sha256(bytes);
  const replay = JSON.parse(bytes.toString("utf8"));
  const gameRecord = parseInlineJson(replay, "game-record.json");
  const decisions = parseDecisions(replay);
  const participants = episode.participants.map((_, position) =>
    participantRow(episode, replay, position)
  );
  const participantByPosition = new Map(
    participants.map((participant) => [participant.participant_position, participant]),
  );

  episodeRows.push({
    episode_id: episode.episode_id,
    episode_request_id: episode.id,
    round_id: episode.round_id,
    status: episode.status,
    coworld_name: episode.coworld_name,
    coworld_version: episode.coworld_version,
    variant_name: episode.variant_name,
    map: episode.game_config?.map ?? gameRecord.info?.config?.gameMap ?? null,
    map_size: episode.game_config?.map_size ?? gameRecord.info?.config?.gameMapSize ?? null,
    player_count: episode.participants.length,
    winner_position: replay.results?.winner_slot ?? null,
    turn_count: numberOrNull(replay.results?.turn_count),
    decision_count: numberOrNull(replay.results?.decision_count),
    fallback_count: numberOrNull(replay.results?.fallback_count),
    degraded_count: numberOrNull(replay.results?.degraded_count),
    cost_usd: numberOrNull(episode.cost_usd),
    replay_url: episode.replay_url,
    replay_sha256: replayHash,
    replay_bytes: bytes.length,
    created_at: normalizeTimestamp(episode.created_at),
    completed_at: normalizeTimestamp(episode.completed_at),
    collected_at: collectedAt,
  });
  participantRows.push(...participants);
  for (const decision of decisions) {
    const position = slotFromAgentID(decision.agentID);
    decisionRows.push(decisionRow(
      decision,
      episode,
      participantByPosition.get(position),
      replayHash,
    ));
  }
  replayManifest.push({
    episode_id: episode.episode_id,
    url: episode.replay_url,
    sha256: replayHash,
    bytes: bytes.length,
  });
  process.stdout.write(`  ${episode.episode_id}: ${decisions.length} decisions\n`);
}

await writeFile(path.join(stagingDir, "rounds.ndjson"), ndjson(roundRows));
await writeFile(path.join(stagingDir, "episodes.ndjson"), ndjson(episodeRows));
await writeFile(path.join(stagingDir, "participants.ndjson"), ndjson(participantRows));
await writeFile(path.join(stagingDir, "decisions.ndjson"), ndjson(decisionRows));
await writeFile(path.join(processedDir, "manifest.json"), `${JSON.stringify({
  schema_version: 1,
  league_id: leagueID,
  collected_at: collectedAt,
  requested_round_count: roundLimit,
  first_round_number: selectedRounds[0].round_number,
  last_round_number: selectedRounds.at(-1).round_number,
  round_count: roundRows.length,
  episode_count: episodeRows.length,
  participant_count: participantRows.length,
  decision_count: decisionRows.length,
  replay_bytes: replayManifest.reduce((sum, replay) => sum + replay.bytes, 0),
  replays: replayManifest,
}, null, 2)}\n`);

process.stdout.write(
  `collected ${roundRows.length} rounds, ${episodeRows.length} episodes, ` +
  `${participantRows.length} participants, and ${decisionRows.length} decisions\n`,
);
