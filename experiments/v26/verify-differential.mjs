#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [repositoryPath, requestedParent, requestedCandidate, fixturePath, outputPath] =
  process.argv.slice(2);
if (!repositoryPath || !requestedParent || !requestedCandidate || !fixturePath || !outputPath) {
  throw new Error("usage: verify-differential.mjs REPOSITORY PARENT CANDIDATE FIXTURE OUTPUT");
}

const repository = path.resolve(repositoryPath);
const resolveCommit = (value) => execFileSync(
  "git", ["-C", repository, "rev-parse", "--verify", `${value}^{commit}`],
  { encoding: "utf8" },
).trim();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const moduleAt = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const extractCommit = (commit, destination) => {
  const archive = execFileSync(
    "git", ["-C", repository, "archive", "--format=tar", commit],
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
const scratch = mkdtempSync(path.join(os.tmpdir(), "v26-differential-"));
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
  const parentCore = await moduleAt(parentRoot, "intent-core.mjs");
  const candidateCore = await moduleAt(candidateRoot, "intent-core.mjs");
  const parentState = parentEngine.buildState(
    fixture.observation, fixture.legalActions, fixture.history,
  );
  const candidateState = candidateEngine.buildState(
    fixture.observation, fixture.legalActions, fixture.history,
  );
  parentPlan = parentController.parseIntentDirective(
    fixture.planner_reply, parentState, "fixture",
  );
  candidatePlan = candidateController.parseIntentDirective(
    fixture.planner_reply, candidateState, "fixture",
  );
  parentAction = parentCore.chooseIntentCoreAction(
    fixture.legalActions, parentState, parentPlan, fixture.history,
  );
  candidateAction = candidateCore.chooseIntentCoreAction(
    fixture.legalActions, candidateState, candidatePlan, fixture.history,
  );

  const expectedPlan = {
    intent: "grow", targetID: null, horizon: 4, model: "fixture",
  };
  assert.deepEqual(parentPlan, expectedPlan);
  assert.deepEqual(candidatePlan, expectedPlan);
  assert.equal(parentAction.id, "retreat:front");
  assert.equal(parentAction.policyMarker, "ixdef");
  assert.equal(candidateAction.id, "attack:raider:40");
  assert.equal(candidateAction.policyMarker, "ixprs");
  const symbolicKinds = new Set([
    "target_player", "embargo", "embargo_all", "alliance_request", "alliance_extend",
  ]);
  assert.equal(symbolicKinds.has(candidateAction.kind), false);
  assert.notEqual(parentAction.id, "attack:mickey:40");
  assert.notEqual(candidateAction.id, "attack:mickey:40");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v26/verify-differential.mjs";
const fixtureRelativePath = "experiments/v26/differential-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "intent-purity-v26",
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
    selected_kind: parentAction.kind,
    marker: parentAction.policyMarker,
  },
  candidate: {
    source_commit: candidateCommit,
    parsed_plan: candidatePlan,
    selected_action_id: candidateAction.id,
    selected_kind: candidateAction.kind,
    marker: candidateAction.policyMarker,
    telemetry_mode: "dft",
  },
  safety: {
    offered_k1z_harmful_action: "attack:mickey:40",
    parent_selected_k1z_harm: false,
    candidate_selected_k1z_harm: false,
  },
  test_command: [
    "node", verifierRelativePath, repositoryPath, parentCommit, candidateCommit,
    fixtureRelativePath, outputPath,
  ],
  test_exit_code: 0,
};
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
process.stdout.write(`${JSON.stringify(proof)}\n`);
