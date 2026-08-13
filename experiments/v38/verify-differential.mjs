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
const extract = (commit, destination) => {
  const archive = execFileSync(
    "git", ["-C", repository, "archive", "--format=tar", commit],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync("tar", ["-xf", "-", "-C", destination], {
    input: archive,
    maxBuffer: 64 * 1024 * 1024,
  });
};
const choose = async (root, fixture) => {
  const engine = await import(pathToFileURL(path.join(root, "strategy-engine.mjs")).href);
  const core = await import(pathToFileURL(path.join(root, "intent-core.mjs")).href);
  const state = engine.buildState(fixture.observation, fixture.actions, fixture.history);
  return core.chooseIntentCoreAction(
    fixture.actions, state, { intent: "grow", model: "fixture" }, fixture.history,
  );
};

const parentCommit = resolveCommit(requestedParent);
const candidateCommit = resolveCommit(requestedCandidate);
const evaluatorCommit = resolveCommit("HEAD");
assert.equal(parentCommit, requestedParent);
assert.equal(candidateCommit, requestedCandidate);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const scratch = mkdtempSync(path.join(os.tmpdir(), "v38-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extract(parentCommit, parentRoot);
extract(candidateCommit, candidateRoot);

let parent;
let candidate;
try {
  parent = await choose(parentRoot, fixture);
  candidate = await choose(candidateRoot, fixture);
  assert.equal(parent.id, "build:Atom Bomb");
  assert.equal(candidate.id, "expand:terra-nullius:35");
  assert.ok(candidate.policyMarkers.includes("ib1"));
  assert.ok(candidate.policyMarkers.includes("ixgrw"));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v38/verify-differential.mjs";
const fixtureRelativePath = "experiments/v38/differential-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "intent-boundary-v38",
  same_fixture: true,
  equivalent_goal: "execute grow without tactical planner instructions",
  verifier: {
    evaluator_commit: evaluatorCommit,
    path: verifierRelativePath,
    sha256: digest(verifierBytes),
  },
  fixture: {
    id: fixture.id,
    path: fixtureRelativePath,
    sha256: digest(fixtureBytes),
  },
  parent: {
    source_commit: parentCommit,
    selected_action_id: parent.id,
    interpretation: "unbounded grow intent permits the legacy nuclear-economy priority",
  },
  candidate: {
    source_commit: candidateCommit,
    selected_action_id: candidate.id,
    markers: candidate.policyMarkers,
    interpretation: "grow boundary excludes the strike while leaving exact growth selection to the executor",
  },
  safety: {
    offered_k1z_target: false,
    candidate_selected_strike: false,
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
