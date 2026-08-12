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

const [
  repositoryPath,
  requestedParentCommit,
  requestedCandidateCommit,
  fixturePath,
  outputPath,
] = process.argv.slice(2);
if (
  !repositoryPath ||
  !requestedParentCommit ||
  !requestedCandidateCommit ||
  !fixturePath ||
  !outputPath
) {
  throw new Error(
    "usage: verify-differential.mjs REPOSITORY PARENT_COMMIT " +
    "CANDIDATE_COMMIT FIXTURE OUTPUT",
  );
}

const COMMIT = /^[0-9a-f]{40}$/;
const repository = path.resolve(repositoryPath);
const resolveCommit = (value) =>
  execFileSync("git", ["-C", repository, "rev-parse", "--verify", `${value}^{commit}`], {
    encoding: "utf8",
  }).trim();
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

const parentCommit = resolveCommit(requestedParentCommit);
const candidateCommit = resolveCommit(requestedCandidateCommit);
const evaluatorCommit = resolveCommit("HEAD");
assert.match(parentCommit, COMMIT);
assert.match(candidateCommit, COMMIT);
assert.equal(parentCommit, requestedParentCommit);
assert.equal(candidateCommit, requestedCandidateCommit);

const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const scratch = mkdtempSync(path.join(os.tmpdir(), "v18-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extractCommit(parentCommit, parentRoot);
extractCommit(candidateCommit, candidateRoot);

let parentPlan;
let candidatePlan;
let parentAction;
let candidateAction;
try {
  const parentController = await moduleAt(parentRoot, "intent-controller.mjs");
  const candidateController = await moduleAt(candidateRoot, "intent-controller.mjs");
  const parentEngine = await moduleAt(parentRoot, "strategy-engine.mjs");
  const candidateEngine = await moduleAt(candidateRoot, "strategy-engine.mjs");

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
  parentPlan = parentController.parseIntentDirective(
    fixture.planner_reply,
    parentState,
    "fixture",
  );
  candidatePlan = candidateController.parseIntentDirective(
    fixture.planner_reply,
    candidateState,
    "fixture",
  );
  parentAction = parentEngine.chooseAction(
    fixture.legalActions,
    parentState,
    parentPlan,
    fixture.history,
  );
  candidateAction = candidateEngine.chooseAction(
    fixture.legalActions,
    candidateState,
    candidatePlan,
    fixture.history,
  );

  assert.equal(parentPlan, null);
  assert.deepEqual(
    candidatePlan,
    { intent: "grow", targetID: null, horizon: 4, model: "fixture" },
  );
  assert.equal(parentAction.id, "alliance:kata");
  assert.equal(candidateAction.id, "expand:terra-nullius:10");
  assert.equal(candidateAction.policyMarker, "mm1g");
  assert.notEqual(parentAction.id, candidateAction.id);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v18/verify-differential.mjs";
const fixtureRelativePath = "experiments/v18/differential-fixture.json";
const committedVerifierBytes = execFileSync(
  "git",
  ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(
  digest(verifierBytes),
  digest(committedVerifierBytes),
  "verifier source must match repository HEAD",
);

const proof = {
  schema_version: 2,
  arm: "planner-transport-v18",
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
  parent: {
    source_commit: parentCommit,
    parsed_plan: parentPlan,
    selected_action_id: parentAction.id,
  },
  candidate: {
    source_commit: candidateCommit,
    parsed_plan: candidatePlan,
    selected_action_id: candidateAction.id,
    marker: candidateAction.policyMarker,
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
