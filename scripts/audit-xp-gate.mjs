import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const COWORLD_PACKAGE = "coworld==0.1.28";
const DEFAULT_PLAYER = "odin free";
const ALLOWED_REPLAY_HOSTS = new Set(["softmax-public.s3.amazonaws.com"]);
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

function option(name, fallback = null) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function coworldJson(args, cwd = process.cwd()) {
  const result = spawnSync(
    "uvx",
    ["--from", COWORLD_PACKAGE, "coworld", ...args, "--json"],
    { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`coworld ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function slotFromAgentID(agentID) {
  const match = String(agentID ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function parseDecisions(replay) {
  const raw = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof raw !== "string") throw new Error("replay is missing inline decisions.jsonl");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function auditEpisodeReplay(episode, replay, playerName = DEFAULT_PLAYER) {
  const position = episode.participants.findIndex((participant) =>
    participant.player_name === playerName
  );
  if (position < 0) throw new Error(`${playerName} is not present in episode ${episode.id}`);
  const participant = episode.participants[position];
  const decisions = parseDecisions(replay)
    .filter((decision) => slotFromAgentID(decision.agentID) === position);
  const result = replay.results?.players?.[position] ?? {};
  const score = episode.scores?.find((entry) =>
    entry.policy_version_id === participant.policy_version_id
  )?.score;

  let activeDecisions = 0;
  const openingAllianceOpportunities = [];
  const allianceSelections = [];
  for (const decision of decisions) {
    const isSpawn = decision.selectedActionKind === "spawn";
    const survival = decision.tacticalAffordances?.survivalAlliance ?? {};
    const expectedActionID = survival.bestAllyTargetID
      ? `alliance:${survival.bestAllyTargetID}`
      : null;
    const legalAllianceIDs = decision.legalActionIDsByKind?.alliance_request ?? [];
    if (
      !isSpawn && activeDecisions <= 2 && survival.recommended === true &&
      expectedActionID && legalAllianceIDs.includes(expectedActionID)
    ) {
      openingAllianceOpportunities.push({
        turn: decision.turnNumber,
        profile: decision.profile ?? null,
        expected_action_id: expectedActionID,
        selected_action_id: decision.selectedLegalActionId ?? null,
        aligned: decision.selectedLegalActionId === expectedActionID,
      });
    }
    if (decision.selectedActionKind === "alliance_request") {
      allianceSelections.push({
        turn: decision.turnNumber,
        action_id: decision.selectedLegalActionId ?? null,
        accepted: decision.result?.accepted ?? null,
      });
    }
    if (!isSpawn) activeDecisions += 1;
  }

  return {
    episode_request_id: episode.id,
    episode_id: episode.episode_id,
    map: episode.game_config?.map ?? null,
    seat: position + 1,
    policy_version: participant.version,
    policy_version_id: participant.policy_version_id,
    won: Number(score) === 1 || replay.results?.winner_slot === position,
    score: Number.isFinite(Number(score)) ? Number(score) : null,
    final_tiles: Number.isFinite(Number(result.tiles_owned)) ? Number(result.tiles_owned) : null,
    is_alive: result.is_alive ?? null,
    decisions: decisions.length,
    holds: decisions.filter((decision) => decision.selectedActionKind === "hold").length,
    rejected: decisions.filter((decision) => decision.result?.accepted === false).length,
    fallbacks: decisions.filter((decision) => decision.fallbackUsed === true).length,
    profiles: [...new Set(decisions.map((decision) => decision.profile).filter(Boolean))],
    alliance_selections: allianceSelections,
    opening_alliance_opportunities: openingAllianceOpportunities,
  };
}

export function buildGateReport(request, audits, minimumEpisodes = 4) {
  const wins = audits.filter((audit) => audit.won).length;
  const holds = audits.reduce((sum, audit) => sum + audit.holds, 0);
  const rejected = audits.reduce((sum, audit) => sum + audit.rejected, 0);
  const fallbacks = audits.reduce((sum, audit) => sum + audit.fallbacks, 0);
  const opportunities = audits.flatMap((audit) => audit.opening_alliance_opportunities);
  const selections = audits.flatMap((audit) => audit.alliance_selections);
  const aligned = opportunities.filter((opportunity) => opportunity.aligned).length;
  const mechanismExercised = selections.length > 0;
  const mechanismPassed = mechanismExercised && aligned === opportunities.length;
  const completed = request.status === "completed" && audits.length >= minimumEpisodes;
  const checks = {
    completed_episode_floor: completed,
    perfect_episode_wins: completed && wins === audits.length,
    zero_holds: holds === 0,
    zero_rejected_decisions: rejected === 0,
    opening_alliance_mechanism_exercised: mechanismExercised,
    exact_opening_alliance_alignment: mechanismPassed,
  };
  return {
    schema_version: 1,
    experience_request_id: request.id,
    status: request.status,
    policy_version: audits[0]?.policy_version ?? null,
    policy_version_id: audits[0]?.policy_version_id ?? null,
    episodes: audits.length,
    wins,
    win_rate_pct: audits.length > 0 ? Number((100 * wins / audits.length).toFixed(2)) : 0,
    final_tiles: audits.map((audit) => audit.final_tiles),
    holds,
    rejected,
    fallbacks,
    alliance_selections: selections.length,
    opening_alliance_opportunities: opportunities.length,
    opening_alliance_alignments: aligned,
    checks,
    passed: Object.values(checks).every(Boolean),
    episode_audits: audits,
  };
}

async function downloadReplay(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_REPLAY_HOSTS.has(parsed.hostname)) {
    throw new Error(`refusing replay URL outside the allowlist: ${url}`);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`replay download failed (${response.status}): ${url}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPLAY_BYTES) {
    throw new Error(`replay exceeds 64 MiB limit: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REPLAY_BYTES) throw new Error(`replay exceeds 64 MiB limit: ${url}`);
  return bytes;
}

async function replayBytes(episode, cacheDir) {
  const destination = path.join(cacheDir, `${episode.episode_id}.replay`);
  try {
    return { bytes: await readFile(destination), destination };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = await downloadReplay(episode.replay_url);
  await writeFile(destination, bytes);
  return { bytes, destination };
}

async function main() {
  const requestID = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!requestID?.startsWith("xreq_")) {
    throw new Error("usage: node scripts/audit-xp-gate.mjs xreq_... [--player NAME] [--output PATH]");
  }
  const root = process.cwd();
  const playerName = option("player", DEFAULT_PLAYER);
  const outputPath = option("output");
  const allowRunning = process.argv.includes("--allow-running");
  const minimumEpisodes = Number(option("min-episodes", "4"));
  if (!Number.isInteger(minimumEpisodes) || minimumEpisodes < 1) {
    throw new Error("--min-episodes must be a positive integer");
  }
  const request = coworldJson(["xp-request", "get", requestID], root);
  const episodes = coworldJson(["xp-request", "episodes", requestID], root);
  if (request.status !== "completed" && !allowRunning) {
    process.stdout.write(`${JSON.stringify({
      experience_request_id: requestID,
      status: request.status,
      pending_count: request.pending_count,
      running_count: request.running_count,
      completed_count: request.completed_count,
      failed_count: request.failed_count,
      passed: false,
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const cacheDir = path.join(root, "data", "cache", "replays");
  await mkdir(cacheDir, { recursive: true });
  const audits = [];
  for (const episode of episodes) {
    if (episode.status !== "completed" || !episode.replay_url) continue;
    const { bytes, destination } = await replayBytes(episode, cacheDir);
    const replay = JSON.parse(bytes.toString("utf8"));
    const audit = auditEpisodeReplay(episode, replay, playerName);
    audit.replay_url = episode.replay_url;
    audit.replay_sha256 = sha256(bytes);
    audit.replay_path = path.relative(root, destination);
    audits.push(audit);
  }
  const report = buildGateReport(request, audits, minimumEpisodes);
  if (outputPath) {
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
