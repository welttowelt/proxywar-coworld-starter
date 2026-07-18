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
const policyDecisions = decisions.filter((decision) =>
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
  [...new Set(policyDecisions.map((decision) => decision.username))].map((username) => {
    const rows = policyDecisions.filter((decision) => decision.username === username);
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
      k1z: rows.filter((decision) => String(decision.reason).includes(":k1z")).length,
      sk1: rows.filter((decision) => String(decision.reason).includes(":sk1")).length,
    }];
  }),
);

const harmfulK1Z = policyDecisions.filter((decision) => {
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

const badPublicReasons = policyDecisions.filter((decision) => {
  const reason = String(decision.reason ?? "");
  return reason.length > 48 || !/^[\x20-\x7e]+$/.test(reason) ||
    !reason.startsWith("[K1Z]");
}).map((decision) => ({
  username: decision.username,
  turnNumber: decision.turnNumber,
  reason: decision.reason,
}));

const report = {
  schema_version: 1,
  replay_path: target,
  replay_sha256: createHash("sha256").update(bytes).digest("hex"),
  game_id: replay.gameID ?? replay.results?.game_id ?? null,
  turn_count: replay.results?.turn_count ?? replay.finalState?.turn ?? null,
  winner_slot: replay.results?.winner_slot ?? null,
  scores: replay.results?.scores ?? null,
  total_decisions: decisions.length,
  policy_decisions: policyDecisions.length,
  per_player: perPlayer,
  rv1_executions: policyDecisions.filter((decision) =>
    String(decision.reason).includes(":rv1")
  ).length,
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
