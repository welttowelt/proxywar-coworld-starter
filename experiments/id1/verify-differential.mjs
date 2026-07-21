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
const VERIFIER_PATH = "experiments/id1/verify-differential.mjs";
const FIXTURE_PATH = "experiments/id1/differential-fixture.json";
const repository = path.resolve(repositoryPath);
const resolveCommit = (value) =>
  execFileSync(
    "git",
    ["-C", repository, "rev-parse", "--verify", `${value}^{commit}`],
    { encoding: "utf8" },
  ).trim();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
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
assert.equal(path.posix.normalize(fixturePath), FIXTURE_PATH);

const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const scratch = mkdtempSync(path.join(os.tmpdir(), "id1-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extractCommit(parentCommit, parentRoot);
extractCommit(candidateCommit, candidateRoot);

let parent;
let candidate;
try {
  const parentEngine = await import(
    pathToFileURL(path.join(parentRoot, "strategy-engine.mjs")).href
  );
  const candidateEngine = await import(
    pathToFileURL(path.join(candidateRoot, "strategy-engine.mjs")).href
  );
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
    fixture.plan,
    fixture.history,
  );
  candidate = candidateEngine.chooseAction(
    fixture.legalActions,
    candidateState,
    fixture.plan,
    fixture.history,
  );
  assert.equal(parent.id, fixture.expected.parent_action_id);
  assert.equal(parent.policyMarker, fixture.expected.parent_policy_marker);
  assert.equal(candidate.id, fixture.expected.candidate_action_id);
  assert.equal(candidate.policyMarker, fixture.expected.candidate_policy_marker);
  assert.notEqual(parent.id, candidate.id);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const committedVerifierBytes = execFileSync(
  "git",
  ["-C", repository, "show", `${evaluatorCommit}:${VERIFIER_PATH}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(
  digest(verifierBytes),
  digest(committedVerifierBytes),
  "verifier source must match repository HEAD",
);

const proof = {
  schema_version: 2,
  arm: "id1",
  same_fixture: true,
  verifier: {
    evaluator_commit: evaluatorCommit,
    path: VERIFIER_PATH,
    sha256: digest(verifierBytes),
  },
  fixture: {
    id: fixture.id,
    path: FIXTURE_PATH,
    sha256: digest(fixtureBytes),
    legal_action_ids_sha256: digest(
      Buffer.from(JSON.stringify(fixture.legalActions.map((action) => action.id))),
    ),
  },
  plan: fixture.plan,
  parent: {
    source_commit: parentCommit,
    selected_action_id: parent.id,
    policy_marker: parent.policyMarker,
  },
  candidate: {
    source_commit: candidateCommit,
    selected_action_id: candidate.id,
    policy_marker: candidate.policyMarker,
  },
  test_command: [
    "node",
    VERIFIER_PATH,
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
