#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [repositoryPath, requestedParent, requestedCandidate, fixturePath, outputPath] =
  process.argv.slice(2);
if (!repositoryPath || !requestedParent || !requestedCandidate || !fixturePath || !outputPath) {
  throw new Error(
    "usage: verify-differential.mjs REPOSITORY PARENT_COMMIT " +
    "CANDIDATE_COMMIT FIXTURE OUTPUT",
  );
}

const repository = path.resolve(repositoryPath);
const resolveCommit = (value) => execFileSync(
  "git",
  ["-C", repository, "rev-parse", "--verify", `${value}^{commit}`],
  { encoding: "utf8" },
).trim();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const moduleAt = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const extractCommit = (commit, destination) => {
  const archive = execFileSync(
    "git",
    ["-C", repository, "archive", "--format=tar", commit],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync("tar", ["-xf", "-", "-C", destination], {
    input: archive,
    maxBuffer: 64 * 1024 * 1024,
  });
};

const parentCommit = resolveCommit(requestedParent);
const candidateCommit = resolveCommit(requestedCandidate);
const evaluatorCommit = resolveCommit("HEAD");
assert.equal(parentCommit, requestedParent);
assert.equal(candidateCommit, requestedCandidate);

const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const scratch = mkdtempSync(path.join(os.tmpdir(), "v23-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extractCommit(parentCommit, parentRoot);
extractCommit(candidateCommit, candidateRoot);

let parentParsedPlan;
let candidateParsedPlan;
let parentExecutablePlan;
let candidateExecutablePlan;
let parentAction;
let candidateAction;
try {
  const parentController = await moduleAt(parentRoot, "intent-controller.mjs");
  const candidateController = await moduleAt(candidateRoot, "intent-controller.mjs");
  const parentEngine = await moduleAt(parentRoot, "strategy-engine.mjs");
  const candidateEngine = await moduleAt(candidateRoot, "strategy-engine.mjs");
  const parentIntentCore = await moduleAt(parentRoot, "intent-core.mjs");
  const candidateIntentCore = await moduleAt(candidateRoot, "intent-core.mjs");

  const parentState = parentEngine.buildState(
    fixture.observation,
    fixture.legalActions,
    fixture.history,
  );
  const candidateState = candidateEngine.buildState(
    fixture.observation,
    fixture.legalActions,
    fixture.history,
  );
  parentParsedPlan = parentController.parseIntentDirective(
    fixture.planner_reply,
    parentState,
    "fixture",
  );
  candidateParsedPlan = candidateController.parseIntentDirective(
    fixture.planner_reply,
    candidateState,
    "fixture",
  );
  parentExecutablePlan = parentController.executableIntentPlan(
    parentParsedPlan,
    fixture.plan_age,
    fixture.planner_degraded,
  );
  candidateExecutablePlan = candidateController.executableIntentPlan(
    candidateParsedPlan,
    fixture.plan_age,
    fixture.planner_degraded,
  );
  parentAction = parentIntentCore.chooseIntentCoreAction(
    fixture.legalActions,
    parentState,
    parentExecutablePlan,
    fixture.history,
  );
  candidateAction = candidateIntentCore.chooseIntentCoreAction(
    fixture.legalActions,
    candidateState,
    candidateExecutablePlan,
    fixture.history,
  );

  const expectedPlan = {
    intent: "expand", targetID: null, horizon: 4, model: "fixture",
  };
  assert.deepEqual(parentParsedPlan, expectedPlan);
  assert.deepEqual(candidateParsedPlan, expectedPlan);
  assert.equal(parentExecutablePlan, null);
  assert.deepEqual(candidateExecutablePlan, expectedPlan);
  assert.equal(parentAction.id, "expand:terra-nullius:35");
  assert.equal(parentAction.policyMarker, "ixexp");
  assert.equal(candidateAction.id, "retreat:front");
  assert.equal(candidateAction.policyMarker, "ixdef");
  assert.notEqual(parentAction.id, "attack:mickey:40");
  assert.notEqual(candidateAction.id, "attack:mickey:40");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v23/verify-differential.mjs";
const fixtureRelativePath = "experiments/v23/differential-fixture.json";
const committedVerifier = execFileSync(
  "git",
  ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "persistent-intents-v23",
  same_fixture: true,
  verifier: {
    evaluator_commit: evaluatorCommit,
    path: verifierRelativePath,
    sha256: digest(verifierBytes),
  },
  fixture: {
    id: fixture.id,
    path: fixtureRelativePath,
    sha256: digest(fixtureBytes),
    legal_action_ids_sha256: digest(
      Buffer.from(JSON.stringify(fixture.legalActions.map((action) => action.id))),
    ),
  },
  refresh_failure: {
    plan_age: fixture.plan_age,
    planner_degraded: fixture.planner_degraded,
  },
  parent: {
    source_commit: parentCommit,
    parsed_plan: parentParsedPlan,
    executable_plan: parentExecutablePlan,
    fallback_used: parentExecutablePlan === null,
    selected_action_id: parentAction.id,
    marker: parentAction.policyMarker,
  },
  candidate: {
    source_commit: candidateCommit,
    parsed_plan: candidateParsedPlan,
    executable_plan: candidateExecutablePlan,
    fallback_used: candidateExecutablePlan === null,
    selected_action_id: candidateAction.id,
    marker: candidateAction.policyMarker,
  },
  safety: {
    offered_k1z_harmful_action: "attack:mickey:40",
    parent_selected_k1z_harm: false,
    candidate_selected_k1z_harm: false,
  },
  test_command: [
    "node",
    verifierRelativePath,
    repositoryPath,
    parentCommit,
    candidateCommit,
    fixtureRelativePath,
    outputPath,
  ],
  test_exit_code: 0,
};
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
process.stdout.write(`${JSON.stringify(proof)}\n`);
