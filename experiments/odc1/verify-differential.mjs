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
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

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
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const moduleAt = (root, file) =>
  import(pathToFileURL(path.join(root, file)).href);
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
const scratch = mkdtempSync(path.join(os.tmpdir(), "odc1-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extractCommit(parentCommit, parentRoot);
extractCommit(candidateCommit, candidateRoot);

let parent;
let candidate;
try {
  const parentEngine = await moduleAt(parentRoot, "strategy-engine.mjs");
  const candidateEngine = await moduleAt(candidateRoot, "strategy-engine.mjs");
  const candidateChassis = await moduleAt(candidateRoot, "strategy-chassis.mjs");

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
  parent = parentEngine.chooseAction(
    fixture.legalActions,
    parentState,
    null,
    fixture.history,
  );
  candidate = candidateChassis.chooseOdinChassisAction(
    fixture.legalActions,
    candidateState,
    null,
    fixture.history,
  );

  assert.equal(parent.id, "alliance:kata");
  assert.equal(candidate.id, "expand:terra-nullius:10");
  assert.notEqual(parent.id, candidate.id);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const committedVerifierBytes = execFileSync(
  "git",
  ["-C", repository, "show", `${evaluatorCommit}:experiments/odc1/verify-differential.mjs`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(
  digest(verifierBytes),
  digest(committedVerifierBytes),
  "verifier source must match repository HEAD",
);
const proof = {
  schema_version: 2,
  arm: "odc1",
  same_fixture: true,
  verifier: {
    evaluator_commit: evaluatorCommit,
    path: "experiments/odc1/verify-differential.mjs",
    sha256: digest(verifierBytes),
  },
  fixture: {
    id: fixture.id,
    sha256: digest(fixtureBytes),
    legal_action_ids_sha256: digest(
      Buffer.from(JSON.stringify(fixture.legalActions.map((action) => action.id))),
    ),
  },
  parent: {
    source_commit: parentCommit,
    selected_action_id: parent.id,
  },
  candidate: {
    source_commit: candidateCommit,
    selected_action_id: candidate.id,
  },
  test_command: [
    "node",
    "experiments/odc1/verify-differential.mjs",
    repositoryPath,
    parentCommit,
    candidateCommit,
    fixturePath,
    outputPath,
  ],
  test_exit_code: 0,
};
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
process.stdout.write(`${JSON.stringify(proof)}\n`);
