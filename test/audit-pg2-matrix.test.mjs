import assert from "node:assert/strict";
import test from "node:test";

import {
  actionTargetID,
  artifactRecordViolations,
  checkpointTiles,
  holdIsExplained,
  isK1zHarm,
  median,
  receiptPlanIntegrityViolations,
  selectedTargetLooksK1z,
} from "../scripts/audit-pg2-matrix.mjs";
import { canonicalHash } from "../scripts/runpod-proxywar-episode.mjs";

test("matrix checkpoints preserve the canonical canary convention", () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({
    auditBefore: { tilesOwned: 1000 + index },
  }));
  assert.equal(checkpointTiles(rows, 20), 1018);
  assert.equal(checkpointTiles(rows, 50), 1048);
});

test("holds are explained only when no productive game action exists", () => {
  assert.equal(
    holdIsExplained({
      legalActionIDsByKind: {
        donate_troops: ["donate_troops:ally"],
        quick_chat: ["quick_chat:ally:misc.team_up"],
        hold: ["hold"],
      },
    }),
    true,
  );
  assert.equal(
    holdIsExplained({
      legalActionIDsByKind: {
        attack: ["expand:terra-nullius:35"],
        hold: ["hold"],
      },
    }),
    false,
  );
});

test("matrix medians are deterministic for eight paired deltas", () => {
  assert.equal(median([8, 1, 6, 2, 7, 3, 5, 4]), 4.5);
  assert.equal(median([]), null);
  assert.equal(median([1, null, 2]), null);
});

test("runner receipt plan is the audited, hash-bound game config", () => {
  const plan = {
    game_config: { map: "World", seed: 20260721 },
    players: [{ name: "K1Z odin free", policy: "qd1n-pg2" }],
  };
  assert.deepEqual(
    receiptPlanIntegrityViolations({
      plan,
      input_sha256: canonicalHash(plan),
    }),
    [],
  );
  assert.deepEqual(
    receiptPlanIntegrityViolations({
      plan: { ...plan, game_config: { ...plan.game_config, seed: 9 } },
      input_sha256: canonicalHash(plan),
    }),
    ["receipt_input_hash_drift"],
  );
  assert.deepEqual(receiptPlanIntegrityViolations({}), [
    "receipt_plan_missing",
  ]);
});

test("every consumed artifact must match its runner receipt", () => {
  const actual = { sha256: "a".repeat(64), bytes: 42 };
  const receipt = {
    artifacts: [{ path: "results.json", ...actual }],
    primary_artifact_hashes: { "results.json": actual },
  };
  assert.deepEqual(
    artifactRecordViolations(receipt, "results.json", actual, true),
    [],
  );
  assert.deepEqual(
    artifactRecordViolations(
      receipt,
      "results.json",
      { ...actual, bytes: 41 },
      true,
    ),
    [
      "artifact_receipt_drift:results.json",
      "primary_artifact_drift:results.json",
    ],
  );
  assert.deepEqual(
    artifactRecordViolations({}, "proxywar-runs/x/decisions.jsonl", actual),
    ["artifact_receipt_missing:proxywar-runs/x/decisions.jsonl"],
  );
});

test("ally protection covers indirect and naval target identifiers", () => {
  const allyIDs = new Set(["ally-1"]);
  const submittedTarget = {
    selectedActionKind: "move_warship",
    result: { submittedIntent: { targetID: "ALLY-1" } },
  };
  assert.equal(actionTargetID(submittedTarget), "ally-1");
  assert.equal(selectedTargetLooksK1z(submittedTarget, allyIDs), true);
  for (const kind of [
    "attack",
    "boat",
    "nuke",
    "atom_bomb",
    "hydrogen_bomb",
    "mirv",
    "embargo",
    "embargo_all",
    "break_alliance",
    "alliance_reject",
    "target_player",
    "move_warship",
    "warship",
  ]) {
    assert.equal(isK1zHarm({ ...submittedTarget, selectedActionKind: kind }, allyIDs), true);
  }
  assert.equal(
    isK1zHarm(
      {
        selectedActionKind: "boat",
        selectedActionMetadata: { targetName: "K1Z Hrafn" },
      },
      allyIDs,
    ),
    true,
  );
  assert.equal(
    isK1zHarm(
      {
        selectedActionKind: "build",
        result: { submittedIntent: { targetID: "ally-1" } },
      },
      allyIDs,
    ),
    false,
  );
});
