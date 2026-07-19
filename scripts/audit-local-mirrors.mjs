#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const harmfulKinds = new Set([
  "attack",
  "boat",
  "nuke",
  "embargo",
  "embargo_all",
  "target_player",
  "break_alliance",
  "alliance_reject",
  "move_warship",
  "warship",
]);
const tacticalKinds = new Set([
  "attack",
  "boat",
  "build",
  "upgrade_structure",
  "nuke",
  "move_warship",
  "warship",
  "donate_troops",
  "donate_gold",
]);

const values = (name) => {
  const out = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) out.push(process.argv[index + 1]);
  }
  return out;
};
const value = (name, fallback = null) => values(name).at(-1) ?? fallback;
const arm = value("--arm");
const marker = value("--marker");
const runSpecs = values("--run");
const requestSpecs = values("--request");
const output = value("--output");
const configuredAllyNames = values("--ally-name");
const configuredAllyIDs = new Set(values("--ally-id").map((item) => item.toLowerCase()));

if (!arm || !marker || runSpecs.length === 0) {
  throw new Error(
    "usage: node audit-local-mirrors.mjs --arm <name> --marker <marker> " +
      "--run <label>:<candidate-parity>:<directory> [--run ...] " +
      "[--request <label>:<request.json>] " +
      "[--ally-name <name>] [--ally-id <id>] [--output <report.json>]",
  );
}

const canonical = (input) =>
  String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^k1z\s+/, "");
const allyNames = new Set(
  (configuredAllyNames.length > 0
    ? configuredAllyNames
    : ["katanasan", "juryoku-koku", "hrafn"]
  ).map(canonical),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJSON = async (target) => JSON.parse(await readFile(target, "utf8"));

const parseRunSpec = (spec) => {
  const first = spec.indexOf(":");
  const second = spec.indexOf(":", first + 1);
  if (first < 1 || second < 0) throw new Error(`invalid --run spec: ${spec}`);
  const label = spec.slice(0, first);
  const parity = Number(spec.slice(first + 1, second));
  const directory = spec.slice(second + 1);
  if (![0, 1].includes(parity) || !directory) {
    throw new Error(`invalid --run parity or directory: ${spec}`);
  }
  return { label, parity, directory };
};
const requestPaths = new Map(
  requestSpecs.map((spec) => {
    const separator = spec.indexOf(":");
    if (separator < 1 || separator === spec.length - 1) {
      throw new Error(`invalid --request spec: ${spec}`);
    }
    return [spec.slice(0, separator), spec.slice(separator + 1)];
  }),
);

const loadDecisions = async (directory) => {
  const root = path.join(directory, "proxywar-runs");
  const runs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (runs.length !== 1) {
    throw new Error(`${directory}: expected one proxywar run, found ${runs.length}`);
  }
  const target = path.join(root, runs[0], "decisions.jsonl");
  const lines = (await readFile(target, "utf8")).split("\n").filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${target}:${index + 1}: ${error.message}`);
    }
  });
};

const actionTargetID = (decision) => {
  const metadata = decision.selectedActionMetadata ?? {};
  const direct =
    metadata.targetID ??
    metadata.recipientID ??
    metadata.playerID ??
    decision.result?.submittedIntent?.targetID ??
    null;
  if (direct) return String(direct).toLowerCase();
  const match = String(decision.selectedLegalActionId ?? "").match(
    /^(?:attack|target|embargo|alliance|quick_chat|emoji):([^:]+)/,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

const markerCount = (decision, needle) => {
  const fields = [
    decision.policyMarker,
    ...(Array.isArray(decision.policyMarkers) ? decision.policyMarkers : []),
    decision.reason,
  ];
  return fields.some((field) =>
    String(field ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .includes(needle.toLowerCase()),
  )
    ? 1
    : 0;
};

const classifyHold = (decision, allyIDs) => {
  const legal = decision.legalActionIDsByKind ?? {};
  const tactical = Object.entries(legal)
    .filter(([kind]) => tacticalKinds.has(kind))
    .flatMap(([kind, ids]) => (ids ?? []).map((id) => ({ kind, id: String(id) })));
  if (tactical.length === 0) {
    return { classification: "no_tactical_action", tactical_actions: [] };
  }
  const classified = tactical.map((action) => {
    const match = action.id.match(
      /^(?:attack|target|embargo|alliance|quick_chat|emoji):([^:]+)/,
    );
    const targetID = match?.[1]?.toLowerCase() ?? null;
    return {
      ...action,
      target_id: targetID,
      protected_k1z: targetID !== null && allyIDs.has(targetID),
    };
  });
  const protectedOnly = classified.every((action) => action.protected_k1z);
  return {
    classification: protectedOnly ? "protected_k1z_only" : "unexplained",
    tactical_actions: classified,
  };
};

const reports = [];
for (const spec of runSpecs.map(parseRunSpec)) {
  const resultsPath = path.join(spec.directory, "results.json");
  const configPath = path.join(spec.directory, "config.json");
  const replayPath = path.join(spec.directory, "replay");
  const requestPath = requestPaths.get(spec.label);
  const [results, configBytes, replayBytes, decisions, requestBytes] = await Promise.all([
    readJSON(resultsPath),
    readFile(configPath),
    readFile(replayPath),
    loadDecisions(spec.directory),
    requestPath ? readFile(requestPath) : null,
  ]);

  const playerIDs = new Map();
  for (const decision of decisions) {
    const playerID = decision.auditBefore?.playerID ?? decision.auditAfter?.playerID;
    if (playerID) playerIDs.set(canonical(decision.username), String(playerID).toLowerCase());
  }
  const allyIDs = new Set(configuredAllyIDs);
  for (const name of allyNames) {
    const playerID = playerIDs.get(name);
    if (playerID) allyIDs.add(playerID);
  }

  const decisionsByName = new Map();
  for (const decision of decisions) {
    const name = canonical(decision.username);
    if (!decisionsByName.has(name)) decisionsByName.set(name, []);
    decisionsByName.get(name).push(decision);
  }

  const seats = (results.players ?? []).map((player) => {
    const seatDecisions = decisionsByName.get(canonical(player.name)) ?? [];
    const holds = seatDecisions.filter((decision) => decision.selectedActionKind === "hold");
    const holdDetails = holds.map((decision) => ({
      turn: decision.turnNumber ?? null,
      reason: decision.reason ?? null,
      ...classifyHold(decision, allyIDs),
    }));
    const harmful = seatDecisions.filter((decision) => {
      if (!harmfulKinds.has(decision.selectedActionKind)) return false;
      const targetID = actionTargetID(decision);
      const targetName = canonical(decision.selectedActionMetadata?.targetName);
      return (targetID && allyIDs.has(targetID)) || (targetName && allyNames.has(targetName));
    });
    const isCandidate = Number(player.slot) % 2 === spec.parity;
    return {
      run_id: `${spec.label}-seat-${player.slot}`,
      pair_id: spec.label,
      gate: "matched",
      arm: isCandidate ? arm : "parent",
      map: results.map ?? "Pangaea",
      seat: player.slot,
      player: player.name,
      won: results.winner_slot === player.slot,
      score: player.score ?? null,
      final_tiles: player.tiles_owned ?? null,
      survived: player.is_alive ?? null,
      branch_reached: seatDecisions.some((decision) => markerCount(decision, marker) > 0),
      marker_count: seatDecisions.reduce(
        (count, decision) => count + markerCount(decision, marker),
        0,
      ),
      decision_count: seatDecisions.length,
      accepted_decisions: seatDecisions.filter(
        (decision) => decision.result?.accepted === true,
      ).length,
      rejected_decisions: seatDecisions.filter(
        (decision) => decision.result?.accepted === false,
      ).length,
      holds: holds.length,
      unexplained_holds: holdDetails.filter(
        (detail) => detail.classification === "unexplained",
      ).length,
      hold_details: holdDetails,
      alliance_requests: seatDecisions.filter(
        (decision) => decision.selectedActionKind === "alliance_request",
      ).length,
      k1z_harmful_actions: harmful.length,
      k1z_harmful_action_details: harmful.map((decision) => ({
        turn: decision.turnNumber ?? null,
        kind: decision.selectedActionKind,
        action_id: decision.selectedLegalActionId ?? null,
        target_id: actionTargetID(decision),
        target_name: decision.selectedActionMetadata?.targetName ?? null,
      })),
    };
  });

  const totals = {};
  for (const name of [arm, "parent"]) {
    const members = seats.filter((seat) => seat.arm === name);
    totals[name] = {
      seats: members.length,
      wins: members.filter((seat) => seat.won).length,
      survivors: members.filter((seat) => seat.survived).length,
      final_tiles: members.reduce((sum, seat) => sum + Number(seat.final_tiles ?? 0), 0),
      decisions: members.reduce((sum, seat) => sum + seat.decision_count, 0),
      accepted_decisions: members.reduce((sum, seat) => sum + seat.accepted_decisions, 0),
      rejected_decisions: members.reduce((sum, seat) => sum + seat.rejected_decisions, 0),
      holds: members.reduce((sum, seat) => sum + seat.holds, 0),
      unexplained_holds: members.reduce((sum, seat) => sum + seat.unexplained_holds, 0),
      marker_count: members.reduce((sum, seat) => sum + seat.marker_count, 0),
      k1z_harmful_actions: members.reduce(
        (sum, seat) => sum + seat.k1z_harmful_actions,
        0,
      ),
    };
  }

  reports.push({
    label: spec.label,
    directory: spec.directory,
    game_id: results.game_id ?? null,
    candidate_parity: spec.parity,
    winner_slot: results.winner_slot ?? null,
    turn_count: results.turn_count ?? null,
    request_path: requestPath ?? null,
    request_sha256: requestBytes ? sha256(requestBytes) : null,
    effective_config_sha256: sha256(configBytes),
    replay_sha256: sha256(replayBytes),
    k1z_identity_map: Object.fromEntries(
      [...allyNames].map((name) => [name, playerIDs.get(name) ?? null]),
    ),
    totals,
    seats,
  });
}

const report = {
  schema_version: 1,
  arm,
  marker,
  generated_at: new Date().toISOString(),
  runs: reports,
};
const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(output, encoded);
process.stdout.write(encoded);
