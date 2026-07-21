import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ARMS, auditCompletedLoss, verifyBodies } from "../scripts/audit-id1-hosted-early-stop.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("ID1 early-stop auditor binds the exact candidate and parent request bodies", async () => {
  const bodies = verifyBodies(
    await readFile(path.join(root, ARMS.candidate.body_path)),
    await readFile(path.join(root, ARMS.parent.body_path)),
  );
  assert.equal(bodies.candidate.roster[7].player.policy_ref, ARMS.candidate.policy_version_id);
  assert.equal(bodies.parent.roster[7].player.policy_ref, ARMS.parent.policy_version_id);
});

test("ID1 early-stop auditor reports reach, holds, and safe resolved targets", () => {
  const participants = Array.from({ length: 12 }, (_, position) => ({
    position,
    policy_version_id: position === 7 ? ARMS.candidate.policy_version_id : `pv-${position}`,
    player_id: position === 6
      ? "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335"
      : position === 8
      ? "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863"
      : position === 10
      ? "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba"
      : position === 7
      ? "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c"
      : `outsider-${position}`,
    player_name: position === 7 ? "K1Z odin free" : position === 6 ? "K1Z Gravity" : position === 8 ? "K1Z Hrafn" : position === 10 ? "K1Z katanasan" : `Outsider ${position}`,
  }));
  const episode = {
    id: "ereq_5f33733f-8a2f-4e99-bb14-a8201388d5ed",
    episode_id: "f2b16473-b3b7-42ab-926b-dee8d0c2b357",
    status: "completed",
    replay_url: "https://softmax-public.s3.amazonaws.com/replays/05ddf25d-887b-4d11-94a0-0605f52ac295.replay",
    participants,
    game_config: { map: "Pangaea" },
    scores: [{ policy_version_id: ARMS.candidate.policy_version_id, score: 0 }],
  };
  const decisions = [
    { agentID: "agent-8", username: "K1Z odin free", selectedActionKind: "attack", selectedLegalActionId: "attack:runtime-3:25", selectedActionMetadata: { targetID: "runtime-3", targetName: "Outsider 3" }, result: { accepted: true }, fallbackUsed: false, policyMarker: "id1" },
    { agentID: "agent-8", username: "K1Z odin free", selectedActionKind: "hold", selectedLegalActionId: "hold", selectedActionMetadata: {}, result: { accepted: true }, fallbackUsed: false },
  ];
  const replay = {
    config: { map: "Pangaea" },
    finalState: { players: participants.map((entry, position) => ({ username: entry.player_name, playerID: `runtime-${position}` })) },
    results: { winner_slot: 3, players: participants.map((_, position) => ({ tiles_owned: 100 + position })) },
    inlineRunArtifacts: { "decisions.jsonl": `${decisions.map(JSON.stringify).join("\n")}\n` },
  };
  const audit = auditCompletedLoss(episode, Buffer.from(JSON.stringify(replay)));
  assert.equal(audit.candidate_score, 0);
  assert.equal(audit.winner_player_name, "Outsider 3");
  assert.equal(audit.marker_executions, 1);
  assert.equal(audit.holds, 1);
  assert.equal(audit.rejections, 0);
  assert.equal(audit.k1z_harm, 0);
  assert.equal(audit.unresolved_harmful_targets, 0);
});
