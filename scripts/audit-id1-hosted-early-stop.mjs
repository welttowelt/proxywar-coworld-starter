#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const COWORLD = "coworld==0.1.28";
const ODIN_PLAYER_ID = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
const ODIN_SLOT = 7;
const LOSS = {
  request_episode_id: "ereq_5f33733f-8a2f-4e99-bb14-a8201388d5ed",
  episode_id: "f2b16473-b3b7-42ab-926b-dee8d0c2b357",
  replay_url: "https://softmax-public.s3.amazonaws.com/replays/05ddf25d-887b-4d11-94a0-0605f52ac295.replay",
};
export const ARMS = {
  candidate: {
    request_id: "xreq_e1e6d695-e84d-4628-a7ef-3c48d296dcaa",
    body_path: "experiments/request-qd1n-id1-r2-hosted-candidate-4x.json",
    body_sha256: "cbc44cec5abe6154fcb9884230f1a3bd5681b037d9b301a6efdd61f543c54165",
    policy_version_id: "ccf3a01d-f4bd-4eaa-a1c4-a1c900b78844",
  },
  parent: {
    request_id: "xreq_cb3631e0-12f7-4617-b5c1-ce8275fc7e48",
    body_path: "experiments/request-qd1n-id1-r2-hosted-parent-4x.json",
    body_sha256: "b1c6f865f3d15c6683046a174a85f7baf51b668d52c83c1ddc49fa34dbb8e498",
    policy_version_id: "ca4a4e76-fd83-4c92-bf9f-f2440d1f867f",
  },
};
const K1Z_PLAYER_IDS = new Set([
  "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
  "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
  "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
]);
const K1Z_NAMES = [
  "K1Z katanasan", "katanasan", "K1Z Gravity", "Gravity", "juryoku-koku",
  "juryoku koku", "K1Z Hrafn", "Hrafn",
].map(normalize);
const HARMFUL = new Set([
  "attack", "boat", "nuke", "move_warship", "warship", "target_player",
  "break_alliance", "alliance_break", "alliance_reject", "embargo", "embargo_all",
]);

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return sha256(stable(value));
}

function same(left, right) {
  return stable(left) === stable(right);
}

function slotFromAgentID(value) {
  const match = String(value ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

function hasID1(decision) {
  return [
    decision.policyMarker,
    ...(Array.isArray(decision.policyMarkers) ? decision.policyMarkers : []),
    decision.reason,
  ].some((value) => String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).includes("id1"));
}

export function verifyBodies(candidateBytes, parentBytes) {
  const inputs = { candidate: candidateBytes, parent: parentBytes };
  const bodies = {};
  for (const [arm, spec] of Object.entries(ARMS)) {
    const actual = sha256(inputs[arm]);
    if (actual !== spec.body_sha256) throw new Error(`${arm} body hash mismatch: ${actual}`);
    bodies[arm] = JSON.parse(inputs[arm]);
    if (bodies[arm].num_episodes !== 4 || bodies[arm].roster?.length !== 12) {
      throw new Error(`${arm} body is not the pinned 4x12 request`);
    }
    if (bodies[arm].roster[ODIN_SLOT]?.player?.policy_ref !== spec.policy_version_id) {
      throw new Error(`${arm} body does not pin Odin at slot ${ODIN_SLOT}`);
    }
  }
  if (bodies.candidate.coworld_id !== bodies.parent.coworld_id ||
      bodies.candidate.variant_id !== bodies.parent.variant_id) {
    throw new Error("candidate and parent body world/variant differ");
  }
  for (let slot = 0; slot < 12; slot += 1) {
    if (slot !== ODIN_SLOT && !same(bodies.candidate.roster[slot], bodies.parent.roster[slot])) {
      throw new Error(`candidate and parent differ at non-Odin slot ${slot}`);
    }
  }
  return bodies;
}

function verifyRequest(arm, body, request, episodes) {
  const spec = ARMS[arm];
  if (request.id !== spec.request_id || request.coworld_id !== body.coworld_id ||
      request.variant_id !== body.variant_id || request.episode_count !== 4 ||
      !Array.isArray(episodes) || episodes.length !== 4) {
    throw new Error(`${arm} server request identity drifted`);
  }
  const expected = body.roster.map((entry) => entry.player.policy_ref);
  for (const episode of episodes) {
    const participants = [...(episode.participants ?? [])].sort((a, b) => a.position - b.position);
    if (participants.length !== 12 || participants.some((entry, slot) => entry.position !== slot) ||
        !same(participants.map((entry) => entry.policy_version_id), expected) ||
        !same(episode.policy_version_ids, expected)) {
      throw new Error(`${arm}/${episode.id ?? "unknown"} roster drifted`);
    }
    if (participants[ODIN_SLOT].player_id !== ODIN_PLAYER_ID ||
        participants[ODIN_SLOT].policy_version_id !== spec.policy_version_id) {
      throw new Error(`${arm}/${episode.id} Odin identity drifted`);
    }
  }
}

function classifyTarget(decision, finalPlayers, protectedIDs, protectedNames) {
  if (!HARMFUL.has(decision.selectedActionKind)) return null;
  const metadata = decision.selectedActionMetadata ?? {};
  if (metadata.expansion === true || normalize(metadata.targetName) === "terranullius" ||
      String(decision.selectedLegalActionId ?? "").startsWith("expand:")) return null;
  const intent = decision.result?.submittedIntent ?? {};
  const names = [metadata.targetName, metadata.recipientName, metadata.playerName,
    metadata.targetOwnerName, intent.targetName, intent.recipientName, intent.playerName,
  ].map(normalize).filter(Boolean);
  const ids = [metadata.targetID, metadata.recipientID, metadata.playerID,
    metadata.targetPlayerID, metadata.targetOwnerID, intent.targetID, intent.recipientID,
    intent.playerID, intent.targetPlayerID, intent.targetOwnerID,
  ].map(normalize).filter(Boolean);
  const byID = new Set(finalPlayers.map((player) => normalize(player.playerID)));
  const byName = new Set(finalPlayers.map((player) => normalize(player.username)));
  const k1z = ids.some((id) => protectedIDs.has(id)) || names.some((name) =>
    protectedNames.some((protectedName) =>
      name === protectedName || name.includes(protectedName) || protectedName.includes(name)
    )
  );
  return {
    turn: decision.turnNumber ?? null,
    kind: decision.selectedActionKind,
    action_id: decision.selectedLegalActionId ?? null,
    target_ids: [...new Set(ids)],
    target_names: [...new Set(names)],
    k1z_harm: k1z,
    unresolved: !k1z && !ids.some((id) => byID.has(id)) && !names.some((name) => byName.has(name)),
  };
}

export function auditCompletedLoss(episode, replayBytes) {
  if (episode.id !== LOSS.request_episode_id || episode.episode_id !== LOSS.episode_id ||
      episode.status !== "completed" || episode.replay_url !== LOSS.replay_url) {
    throw new Error("the pinned first completed candidate loss is unavailable");
  }
  const replay = JSON.parse(replayBytes);
  const finalPlayers = replay.finalState?.players;
  if (!Array.isArray(finalPlayers) || finalPlayers.length !== 12) {
    throw new Error("loss replay final state is not 12-player");
  }
  const participants = [...episode.participants].sort((a, b) => a.position - b.position);
  const protectedSlots = participants.filter((entry) => K1Z_PLAYER_IDS.has(entry.player_id))
    .map((entry) => entry.position);
  if (protectedSlots.length !== 3) throw new Error("loss replay is missing a K1Z partner");
  const protectedIDs = new Set(protectedSlots.map((slot) => normalize(finalPlayers[slot].playerID)));
  const protectedNames = [...K1Z_NAMES, ...protectedSlots.map((slot) => normalize(finalPlayers[slot].username))];
  const raw = replay.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof raw !== "string") throw new Error("loss replay has no decisions.jsonl");
  const decisions = raw.split("\n").filter(Boolean).map(JSON.parse)
    .filter((decision) => slotFromAgentID(decision.agentID) === ODIN_SLOT);
  if (decisions.length === 0 || decisions.some((decision) => normalize(decision.username) !== "k1zodinfree")) {
    throw new Error("loss replay Odin decision identity is inconsistent");
  }
  const targets = decisions.map((decision) =>
    classifyTarget(decision, finalPlayers, protectedIDs, protectedNames)
  ).filter(Boolean);
  const candidateScore = episode.scores.find((entry) =>
    entry.policy_version_id === ARMS.candidate.policy_version_id
  )?.score;
  const winnerSlot = replay.results?.winner_slot;
  const winner = participants[winnerSlot];
  return {
    experience_request_id: ARMS.candidate.request_id,
    episode_request_id: episode.id,
    episode_id: episode.episode_id,
    episode_record_sha256: canonicalHash(episode),
    replay_url: episode.replay_url,
    replay_sha256: sha256(replayBytes),
    decisions_sha256: sha256(raw),
    map: episode.game_config?.map ?? replay.config?.map ?? null,
    seat: ODIN_SLOT,
    candidate_policy_version_id: ARMS.candidate.policy_version_id,
    candidate_score: Number(candidateScore),
    winner_slot: winnerSlot,
    winner_player_id: winner?.player_id ?? null,
    winner_player_name: winner?.player_name ?? null,
    winner_policy_version_id: winner?.policy_version_id ?? null,
    decisions: decisions.length,
    accepted: decisions.filter((decision) => decision.result?.accepted === true).length,
    rejections: decisions.filter((decision) => decision.result?.accepted !== true).length,
    fallbacks: decisions.filter((decision) => decision.fallbackUsed === true).length,
    planner_degradations: decisions.filter((decision) =>
      decision.llmPlannerDegraded === true || decision.plannerDegraded === true ||
      String(decision.reason ?? "").startsWith("dgd:")
    ).length,
    holds: decisions.filter((decision) =>
      decision.selectedActionKind === "hold" || decision.selectedLegalActionId === "hold"
    ).length,
    marker_executions: decisions.filter(hasID1).length,
    harmful_targets_audited: targets.length,
    k1z_harm: targets.filter((target) => target.k1z_harm).length,
    unresolved_harmful_targets: targets.filter((target) => target.unresolved).length,
  };
}

export function buildReceipt({ bodies, requests, episodes, replayBytes }) {
  verifyRequest("candidate", bodies.candidate, requests.candidate, episodes.candidate);
  verifyRequest("parent", bodies.parent, requests.parent, episodes.parent);
  const completed = episodes.candidate.find((episode) => episode.episode_id === LOSS.episode_id);
  const loss = auditCompletedLoss(completed, replayBytes);
  const violations = [];
  if (loss.candidate_score !== 1 || loss.winner_player_id !== ODIN_PLAYER_ID) {
    violations.push("candidate first completed episode was not won; hosted 4/4 is impossible");
  }
  if (loss.accepted !== loss.decisions) violations.push(`candidate accepted=${loss.accepted}/${loss.decisions}`);
  for (const field of ["holds", "rejections", "fallbacks", "planner_degradations", "k1z_harm", "unresolved_harmful_targets"]) {
    if (loss[field] !== 0) violations.push(`candidate ${field}=${loss[field]}`);
  }
  if (loss.marker_executions < 1) violations.push("candidate id1 marker reach=0");
  const commonRoster = bodies.candidate.roster.map((entry, slot) =>
    slot === ODIN_SLOT ? { slot, player: { policy_ref: "ODIN_ARM" } } : entry
  );
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    verdict: "FAIL_HOSTED_GATE",
    disposition: "NO_SUBMIT",
    reason: "One completed candidate loss makes the required hosted 4/4 mathematically impossible.",
    violations,
    candidate_source_commit: "18c7fdebbafcb94f936c0e8182f6ba6e48a478f6",
    candidate_image_id: "sha256:d5660d978261137116dc1c617129ed0c16a1c6819adaff07874821b75f6812b0",
    candidate_policy_version_id: ARMS.candidate.policy_version_id,
    request_id: ARMS.candidate.request_id,
    baseline_request_id: ARMS.parent.request_id,
    request_body_sha256: {
      candidate: ARMS.candidate.body_sha256,
      parent: ARMS.parent.body_sha256,
    },
    request_record_sha256: {
      candidate: canonicalHash(requests.candidate),
      parent: canonicalHash(requests.parent),
    },
    roster_sha256: canonicalHash(commonRoster),
    variant: bodies.candidate.variant_id,
    request_state: {
      candidate: Object.fromEntries(["status", "episode_count", "completed_count", "running_count", "pending_count", "failed_count"].map((key) => [key, requests.candidate[key]])),
      parent: Object.fromEntries(["status", "episode_count", "completed_count", "running_count", "pending_count", "failed_count"].map((key) => [key, requests.parent[key]])),
    },
    completed_candidate_episode: loss,
    regression_20_of_20: "NOT_RUN",
    upload_or_league_mutation: false,
  };
}

function coworldJson(args, cwd) {
  const result = spawnSync("uvx", ["--from", COWORLD, "coworld", ...args, "--json"], {
    cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, UV_NO_PROGRESS: "1", NO_COLOR: "1" },
  });
  if (result.status !== 0) throw new Error(`coworld ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function main() {
  const root = process.cwd();
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const bodyBytes = {};
  for (const [arm, spec] of Object.entries(ARMS)) bodyBytes[arm] = await readFile(path.join(root, spec.body_path));
  const bodies = verifyBodies(bodyBytes.candidate, bodyBytes.parent);
  const requests = {};
  const episodes = {};
  for (const [arm, spec] of Object.entries(ARMS)) {
    requests[arm] = coworldJson(["xp-request", "get", spec.request_id], root);
    episodes[arm] = coworldJson(["xp-request", "episodes", spec.request_id], root);
  }
  const completed = episodes.candidate.find((episode) => episode.episode_id === LOSS.episode_id);
  if (!completed) throw new Error("pinned completed loss is not visible");
  const replayResponse = await fetch(completed.replay_url, { signal: AbortSignal.timeout(120000) });
  if (!replayResponse.ok) throw new Error(`replay download failed: ${replayResponse.status}`);
  const replayBytes = Buffer.from(await replayResponse.arrayBuffer());
  const receipt = buildReceipt({ bodies, requests, episodes, replayBytes });
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = 1;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 2;
  });
}
