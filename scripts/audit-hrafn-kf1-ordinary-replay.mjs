import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalizeK1ZName } from "../hrafn-strategy.mjs";

const target = process.argv[2];
if (!target) {
  throw new Error("usage: node scripts/audit-hrafn-kf1-ordinary-replay.mjs <replay>");
}

const bytes = await readFile(target);
const replay = JSON.parse(bytes);
const rawDecisions = replay?.inlineRunArtifacts?.["decisions.jsonl"];
const rawTelemetry = replay?.inlineRunArtifacts?.["spectator-telemetry.json"];
if (typeof rawDecisions !== "string" || typeof rawTelemetry !== "string") {
  throw new Error("replay lacks inline decisions or spectator telemetry");
}

const decisions = rawDecisions
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const telemetry = JSON.parse(rawTelemetry);
const agents = Array.isArray(telemetry?.agents) ? telemetry.agents : [];
const eliminationEvents = (telemetry?.timelineBuckets ?? [])
  .flatMap((bucket) => bucket?.events ?? [])
  .filter((event) => event?.kind === "elimination")
  .sort((left, right) =>
    Number(left.turnNumber) - Number(right.turnNumber) ||
    Number(left.sequence) - Number(right.sequence)
  );
const hrafnName = canonicalizeK1ZName("Hrafn");
const odinName = canonicalizeK1ZName("odin free");
const permittedNames = new Set([
  hrafnName,
  odinName,
  canonicalizeK1ZName("katanasan"),
  canonicalizeK1ZName("juryoku koku"),
]);
const hrafnDecisions = decisions.filter((decision) =>
  canonicalizeK1ZName(decision?.username) === hrafnName &&
  /(?:^|[, ])phase=active(?:[, ]|$)/.test(String(decision?.observationSummary ?? ""))
);

function aliveNamesAt(turnNumber) {
  const eliminated = new Set(eliminationEvents
    .filter((event) => Number(event.turnNumber) <= turnNumber)
    .map((event) => String(event.actorAgentID ?? "")));
  return agents
    .filter((agent) => !eliminated.has(String(agent.agentID ?? "")))
    .map((agent) => String(agent.username ?? ""));
}

const evaluated = hrafnDecisions.map((decision) => {
  const aliveNames = aliveNamesAt(Number(decision.turnNumber));
  const canonicalAlive = aliveNames.map(canonicalizeK1ZName);
  const outsiders = aliveNames.filter((name, index) =>
    !permittedNames.has(canonicalAlive[index])
  );
  const odinAlive = canonicalAlive.includes(odinName);
  return {
    turn: Number(decision.turnNumber),
    alive_count: aliveNames.length,
    outsider_count: outsiders.length,
    outsiders,
    necessary_kf1_condition: aliveNames.length >= 2 && odinAlive && outsiders.length === 0,
  };
});
const necessaryReach = evaluated.filter((entry) => entry.necessary_kf1_condition);
const minimumOutsiderCount = evaluated.length > 0
  ? Math.min(...evaluated.map((entry) => entry.outsider_count))
  : null;

const report = {
  schema_version: 1,
  replay_path: target,
  replay_sha256: createHash("sha256").update(bytes).digest("hex"),
  game_id: replay.gameID ?? replay.results?.game_id ?? null,
  hrafn_active_decisions: hrafnDecisions.length,
  first_hrafn_active_turn: evaluated[0]?.turn ?? null,
  last_hrafn_active_turn: evaluated.at(-1)?.turn ?? null,
  minimum_outsider_count_at_hrafn_decision: minimumOutsiderCount,
  necessary_kf1_condition_turns: necessaryReach.map((entry) => entry.turn),
  zero_ordinary_play_reach: necessaryReach.length === 0,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.zero_ordinary_play_reach) process.exitCode = 1;
