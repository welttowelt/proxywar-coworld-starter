import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import {
  K1Z_MEMBERS,
  canonicalizeK1ZName,
} from "../hrafn-strategy.mjs";

const target = process.argv[2];
if (!target) {
  throw new Error("usage: node scripts/audit-hrafn-replay.mjs <replay>");
}

const bytes = await readFile(target);
const replay = JSON.parse(bytes);
const rawDecisions = replay?.inlineRunArtifacts?.["decisions.jsonl"];
if (typeof rawDecisions !== "string") {
  throw new Error("replay does not contain inline decisions.jsonl");
}

const decisions = rawDecisions
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const taggedDecisions = decisions.filter((decision) =>
  String(decision.reason ?? "").startsWith("[K1Z]")
);
const harmfulKinds = new Set([
  "attack",
  "boat",
  "nuke",
  "target_player",
  "embargo",
  "embargo_all",
  "break_alliance",
  "alliance_reject",
]);
const memberIDs = new Set(K1Z_MEMBERS.map((member) => member.id.toLowerCase()));
const memberNames = new Set(
  K1Z_MEMBERS.flatMap((member) => member.names.map(canonicalizeK1ZName)),
);
memberNames.add(canonicalizeK1ZName("Hrafn"));
const namedHrafnDecisions = decisions.filter((decision) =>
  canonicalizeK1ZName(decision.username) === canonicalizeK1ZName("Hrafn")
);
const hrafnDecisions = namedHrafnDecisions.length > 0
  ? namedHrafnDecisions
  : taggedDecisions;
const coalitionDecisions = decisions.filter((decision) =>
  memberNames.has(canonicalizeK1ZName(decision.username)) ||
  taggedDecisions.includes(decision)
);
const policyDecisions = hrafnDecisions;

function targetIdentity(decision) {
  const metadata = decision?.selectedActionMetadata ?? {};
  return {
    id: String(
      metadata.targetID ?? metadata.targetId ??
      metadata.recipientID ?? metadata.recipientId ?? "",
    ).toLowerCase(),
    name: canonicalizeK1ZName(
      metadata.targetName ?? metadata.recipientName ?? "",
    ),
  };
}

const perPlayer = Object.fromEntries(
  [...new Set(coalitionDecisions.map((decision) => decision.username))].map((username) => {
    const rows = coalitionDecisions.filter((decision) => decision.username === username);
    return [username, {
      decisions: rows.length,
      accepted: rows.filter((decision) => decision?.result?.accepted === true).length,
      rejected: rows.filter((decision) => decision?.result?.accepted === false).length,
      holds: rows.filter((decision) =>
        decision.selectedActionKind === "hold" ||
        String(decision.selectedLegalActionId).startsWith("hold")
      ).length,
      fallbacks: rows.filter((decision) => decision.fallbackUsed === true).length,
      rv1: rows.filter((decision) => String(decision.reason).includes(":rv1")).length,
      rv2: rows.filter((decision) => String(decision.reason).includes(":rv2")).length,
      rv3: rows.filter((decision) => String(decision.reason).includes(":rv3")).length,
      k1z: rows.filter((decision) => String(decision.reason).includes(":k1z")).length,
      sk1: rows.filter((decision) => String(decision.reason).includes(":sk1")).length,
    }];
  }),
);

const harmfulK1Z = coalitionDecisions.filter((decision) => {
  if (!harmfulKinds.has(decision.selectedActionKind)) return false;
  const target = targetIdentity(decision);
  return memberIDs.has(target.id) || memberNames.has(target.name);
}).map((decision) => ({
  username: decision.username,
  turnNumber: decision.turnNumber,
  action: decision.selectedLegalActionId,
  kind: decision.selectedActionKind,
  target: targetIdentity(decision),
}));

const badPublicReasons = hrafnDecisions.filter((decision) => {
  if (decision.actionSelectionSource === "deterministic-spawn") return false;
  const reason = String(decision.reason ?? "");
  return reason.length > 48 || !/^[\x20-\x7e]+$/.test(reason) ||
    !reason.startsWith("[K1Z]");
}).map((decision) => ({
  username: decision.username,
  turnNumber: decision.turnNumber,
  reason: decision.reason,
}));

const resultPlayers = Array.isArray(replay.results?.players)
  ? replay.results.players.map((player) => ({
    slot: player.slot,
    name: player.name,
    canonical_name: canonicalizeK1ZName(player.name),
    score: Number.isFinite(Number(player.score)) ? Number(player.score) : null,
    tiles_owned: Number.isFinite(Number(player.tiles_owned))
      ? Number(player.tiles_owned)
      : null,
    is_alive: player.is_alive ?? null,
  }))
  : [];
const odin = resultPlayers.find((player) =>
  player.canonical_name === canonicalizeK1ZName("odin free")
);
const hrafn = resultPlayers.find((player) =>
  player.canonical_name === canonicalizeK1ZName("Hrafn")
);
const maximumScore = Math.max(
  ...resultPlayers.map((player) => player.score).filter(Number.isFinite),
  -Infinity,
);
const coalitionResults = resultPlayers.filter((player) =>
  memberNames.has(player.canonical_name)
);
const outsiderResults = resultPlayers.filter((player) =>
  !memberNames.has(player.canonical_name)
);
const mechanismDecisions = hrafnDecisions.filter((decision) =>
  /:rv[123](?:$|[^a-z0-9])/i.test(String(decision.reason))
);
const mechanismTargets = Object.values(mechanismDecisions.reduce((targets, decision) => {
  const target = targetIdentity(decision);
  const key = target.id || target.name || "unknown";
  const current = targets[key] ?? {
    id: target.id || null,
    name: target.name || null,
    executions: 0,
  };
  current.executions += 1;
  targets[key] = current;
  return targets;
}, {})).sort((left, right) => right.executions - left.executions);
const odinMember = K1Z_MEMBERS.find((member) => member.role === "king");
const supportDonations = hrafnDecisions
  .filter((decision) => String(decision.reason ?? "").includes(":dn1"))
  .map((decision) => ({
    turn: decision.turnNumber,
    action_id: decision.selectedLegalActionId ?? null,
    action_kind: decision.selectedActionKind ?? null,
    target: targetIdentity(decision),
    accepted: decision.result?.accepted === true,
    fallback: decision.fallbackUsed === true,
  }));
const productiveSupportDonations = supportDonations.filter((donation) =>
  donation.accepted && !donation.fallback &&
  (donation.action_kind === "donate_troops" || donation.action_kind === "donate_gold") &&
  donation.target.id === odinMember.id.toLowerCase()
);
const sum = (rows, field) => rows.reduce(
  (total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0),
  0,
);

const report = {
  schema_version: 1,
  replay_path: target,
  replay_sha256: createHash("sha256").update(bytes).digest("hex"),
  game_id: replay.gameID ?? replay.results?.game_id ?? null,
  turn_count: replay.results?.turn_count ?? replay.finalState?.turn ?? null,
  winner_slot: replay.results?.winner_slot ?? null,
  winner_name: Number.isInteger(replay.results?.winner_slot)
    ? resultPlayers.find((player) => player.slot === replay.results.winner_slot)?.name ?? null
    : null,
  scores: replay.results?.scores ?? null,
  players: resultPlayers,
  odin_first: Boolean(odin) && odin.score === maximumScore,
  hrafn_survived: hrafn?.is_alive === true,
  coalition_score: sum(coalitionResults, "score"),
  outsider_score: sum(outsiderResults, "score"),
  coalition_tiles: sum(coalitionResults, "tiles_owned"),
  outsider_tiles: sum(outsiderResults, "tiles_owned"),
  total_decisions: decisions.length,
  coalition_decisions: coalitionDecisions.length,
  framework_spawn_decisions: hrafnDecisions.filter((decision) =>
    decision.actionSelectionSource === "deterministic-spawn"
  ).length,
  policy_decisions: policyDecisions.length,
  per_player: perPlayer,
  rv1_executions: mechanismDecisions.length,
  mechanism_executions: mechanismDecisions.length,
  mechanism_targets: mechanismTargets,
  support_donations: supportDonations,
  productive_support_donations: productiveSupportDonations.length,
  harmful_k1z_actions: harmfulK1Z,
  bad_public_reasons: badPublicReasons,
  checks: {
    all_policy_decisions_accepted: policyDecisions.every((decision) =>
      decision?.result?.accepted === true
    ),
    zero_holds: policyDecisions.every((decision) =>
      decision.selectedActionKind !== "hold" &&
      !String(decision.selectedLegalActionId).startsWith("hold")
    ),
    zero_fallbacks: policyDecisions.every((decision) =>
      decision.fallbackUsed !== true
    ),
    zero_k1z_harm: harmfulK1Z.length === 0,
    support_marker_reached: supportDonations.length > 0,
    support_transfers_productive: supportDonations.every((donation) =>
      donation.accepted && !donation.fallback &&
      (donation.action_kind === "donate_troops" || donation.action_kind === "donate_gold") &&
      donation.target.id === odinMember.id.toLowerCase()
    ),
    public_text_valid: badPublicReasons.length === 0,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  !report.checks.all_policy_decisions_accepted ||
  !report.checks.zero_holds ||
  !report.checks.zero_fallbacks ||
  !report.checks.zero_k1z_harm ||
  !report.checks.public_text_valid
) {
  process.exitCode = 1;
}
