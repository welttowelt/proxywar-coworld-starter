import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chooseIntentCoreAction } from "../../intent-core.mjs";
import {
  buildState,
  chooseCaptainUnderpantsRuntimeAction,
  clean,
  rivalForAction,
  rivalIsProtected,
} from "../../strategy-engine.mjs";

const [repositoryArg, parentCommitArg, candidateCommitArg, fixtureArg, outputArg] =
  process.argv.slice(2);
const expectedParentCommit = "e8ceb516bcdaaaeb06b557228b1a6cf6b73e8c6f";
const expectedCandidateCommit = "7cdca3128c32593bace1955fa7c26f3726ef3d5a";
const expectedFixture = "experiments/v42/intent-delegation-fixture.json";
if (repositoryArg !== undefined) {
  assert.equal(path.resolve(repositoryArg), path.resolve("."), "repository");
  assert.equal(parentCommitArg, expectedParentCommit, "parent commit");
  assert.equal(candidateCommitArg, expectedCandidateCommit, "candidate commit");
  assert.equal(fixtureArg, expectedFixture, "fixture path");
  assert.ok(outputArg, "output path");
}

const fixturePath = fixtureArg
  ? path.resolve(repositoryArg, fixtureArg)
  : new URL("./intent-delegation-fixture.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const materialKinds = new Set([
  "spawn", "attack", "nuke", "build", "upgrade_structure", "boat",
  "boat_retreat", "retreat", "warship", "move_warship",
]);
const harmfulKinds = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);

function isNeutral(action) {
  const targetID = clean(action?.metadata?.targetID ?? action?.targetID ?? "");
  const targetName = clean(action?.metadata?.targetName ?? "").toLowerCase();
  const text = `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
  return !targetID && (targetName === "terra nullius" || text.includes("terra nullius"));
}

function isStrike(action) {
  const unit = clean(action?.metadata?.unit ?? action?.unit ?? "").toLowerCase();
  return action?.kind === "nuke" || unit === "atom bomb";
}

function safeFromK1z(actions, state, history) {
  return actions.filter((action) => {
    if ((!harmfulKinds.has(action?.kind) && !isStrike(action)) || isNeutral(action)) {
      return true;
    }
    const rival = rivalForAction(action, state);
    return !rival || !rivalIsProtected(state, history, rival);
  });
}

function parentMenu(actions, intent, state) {
  const material = actions.filter((action) => materialKinds.has(action.kind));
  const holds = actions.filter((action) => action.kind === "hold");
  const base = material.length > 0 ? material : (holds.length > 0 ? holds : actions);
  const spawn = base.filter((action) => action.kind === "spawn");
  if (spawn.length > 0) return spawn;
  const attackers = state?.self?.allProtocolAttackerIDs;
  const incoming = state?.self?.incomingAttacks;
  if ((Array.isArray(attackers) && attackers.length > 0) ||
      (Array.isArray(incoming) ? incoming.length > 0 : Number(incoming) > 0)) {
    return base;
  }
  const matching = base.filter((action) => {
    if (intent === "grow") {
      return ((action.kind === "attack" || action.kind === "boat") && !isStrike(action)) ||
        ((action.kind === "build" || action.kind === "upgrade_structure") && !isStrike(action));
    }
    return !isNeutral(action) && (
      isStrike(action) ||
      ["attack", "boat", "nuke", "warship", "move_warship"].includes(action.kind)
    );
  });
  if (intent === "grow") {
    const direct = matching.filter((action) => action.kind === "build" || isNeutral(action));
    if (direct.length > 0) return direct;
  }
  return matching.length > 0 ? matching : base;
}

const cases = [];
for (const testCase of fixture.cases) {
  const state = buildState(testCase.observation, testCase.actions, testCase.history);
  const safe = safeFromK1z(testCase.actions, state, testCase.history);
  const parent = chooseCaptainUnderpantsRuntimeAction(
    parentMenu(safe, testCase.intent, state),
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
  cases.push({
    id: testCase.id,
    intent: testCase.intent,
    parent_action_id: parent.id,
    candidate_action_id: candidate.id,
    changed: parent.id !== candidate.id,
  });
}

assert.equal(cases.filter((entry) => entry.changed).length, 1);
assert.equal(cases.find((entry) => entry.id === "restore-inbound-alliance")?.changed, true);
assert.equal(cases.find((entry) => entry.id === "pressure-defense-unchanged")?.changed, false);
assert.equal(cases.find((entry) => entry.id === "k1z-no-harm-unchanged")?.changed, false);

const report = {
  schema_version: 1,
  arm: "v42-intent-delegation",
  passed: true,
  same_fixture: true,
  parent_source_commit: expectedParentCommit,
  candidate_source_commit: expectedCandidateCommit,
  fixture: expectedFixture,
  cases,
};
const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (outputArg) await writeFile(path.resolve(repositoryArg, outputArg), encoded, "utf8");
process.stdout.write(encoded);
