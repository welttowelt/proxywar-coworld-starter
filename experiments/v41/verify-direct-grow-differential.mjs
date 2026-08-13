import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chooseIntentCoreAction } from "../../intent-core.mjs";
import {
  buildState,
  chooseCaptainUnderpantsRuntimeAction,
} from "../../strategy-engine.mjs";

const [repositoryArg, parentCommitArg, candidateCommitArg, fixtureArg, outputArg] =
  process.argv.slice(2);
const expectedParentCommit = "ac5d26330ca066a73265f94d0f4f42b80a02f5a2";
const expectedCandidateCommit = "e8ceb516bcdaaaeb06b557228b1a6cf6b73e8c6f";
const expectedFixture = "experiments/v41/direct-grow-fixture.json";
if (repositoryArg !== undefined) {
  assert.equal(path.resolve(repositoryArg), path.resolve("."), "repository");
  assert.equal(parentCommitArg, expectedParentCommit, "parent commit");
  assert.equal(candidateCommitArg, expectedCandidateCommit, "candidate commit");
  assert.equal(fixtureArg, expectedFixture, "fixture path");
  assert.ok(outputArg, "output path");
}

const fixturePath = fixtureArg
  ? path.resolve(repositoryArg, fixtureArg)
  : new URL("./direct-grow-fixture.json", import.meta.url);
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

const report = {
  schema_version: 1,
  arm: "v41-direct-grow",
  passed: true,
  same_fixture: true,
  parent_source_commit: expectedParentCommit,
  candidate_source_commit: expectedCandidateCommit,
  fixture: expectedFixture,
  cases: results,
};
const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (outputArg) await writeFile(path.resolve(repositoryArg, outputArg), encoded, "utf8");
process.stdout.write(encoded);
