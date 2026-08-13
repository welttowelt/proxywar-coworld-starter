import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { chooseIntentCoreAction } from "../../intent-core.mjs";
import {
  buildState,
  chooseCaptainUnderpantsRuntimeAction,
} from "../../strategy-engine.mjs";

const fixturePath = new URL("./direct-grow-fixture.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

function isNeutral(action) {
  const targetID = String(action?.metadata?.targetID ?? action?.targetID ?? "").trim();
  const targetName = String(action?.metadata?.targetName ?? "").trim().toLowerCase();
  const text = `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
  return !targetID && (targetName === "terra nullius" || text.includes("terra nullius"));
}

function isStrike(action) {
  const unit = String(action?.metadata?.unit ?? action?.unit ?? "").trim().toLowerCase();
  return action?.kind === "nuke" || unit === "atom bomb";
}

function parentIntentMenu(actions, intent, state) {
  const materialKinds = new Set([
    "spawn", "attack", "nuke", "build", "upgrade_structure", "boat",
    "boat_retreat", "retreat", "warship", "move_warship",
  ]);
  const material = actions.filter((action) => materialKinds.has(action.kind));
  const menu = material.length > 0 ? material : actions;
  const spawn = menu.filter((action) => action.kind === "spawn");
  if (spawn.length > 0) return spawn;
  const incoming = state?.self?.allProtocolAttackerIDs;
  if ((Array.isArray(incoming) && incoming.length > 0) || Number(state?.self?.incomingAttacks) > 0) {
    return menu;
  }
  const matching = menu.filter((action) => {
    if (intent === "grow") {
      return ((action.kind === "attack" || action.kind === "boat") && !isStrike(action)) ||
        ((action.kind === "build" || action.kind === "upgrade_structure") && !isStrike(action));
    }
    return !isNeutral(action) && (
      isStrike(action) ||
      ["attack", "boat", "nuke", "warship", "move_warship"].includes(action.kind)
    );
  });
  return matching.length > 0 ? matching : menu;
}

const results = [];
for (const testCase of fixture.cases) {
  const state = buildState(testCase.observation, testCase.actions, testCase.history);
  const parent = chooseCaptainUnderpantsRuntimeAction(
    parentIntentMenu(testCase.actions, testCase.intent, state),
    state,
    { strategicIntent: testCase.intent },
    testCase.history,
  );
  const candidate = chooseIntentCoreAction(
    testCase.actions,
    state,
    { intent: testCase.intent },
    testCase.history,
  );
  assert.equal(parent.id, testCase.expected_parent_action_id, `${testCase.id}: parent`);
  assert.equal(candidate.id, testCase.expected_candidate_action_id, `${testCase.id}: candidate`);
  results.push({
    id: testCase.id,
    intent: testCase.intent,
    parent_action_id: parent.id,
    candidate_action_id: candidate.id,
    changed: parent.id !== candidate.id,
  });
}

assert.equal(results.filter((result) => result.changed).length, 1);
assert.equal(results.find((result) => result.id === "finish-unchanged")?.changed, false);

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  arm: "v41-direct-grow",
  passed: true,
  fixture: "experiments/v41/direct-grow-fixture.json",
  cases: results,
}, null, 2)}\n`);
