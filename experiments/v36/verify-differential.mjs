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
const scratch = mkdtempSync(path.join(os.tmpdir(), "v36-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extractCommit(parentCommit, parentRoot);
extractCommit(candidateCommit, candidateRoot);

const choose = async (root, actions, intent) => {
  const engine = await moduleAt(root, "strategy-engine.mjs");
  const core = await moduleAt(root, "intent-core.mjs");
  const state = engine.buildState(fixture.observation, actions, fixture.history);
  return core.chooseIntentCoreAction(
    actions, state, { intent, model: "fixture" }, fixture.history,
  );
};

let parentSymbolic;
let candidateSymbolic;
let parentMaterial;
let candidateMaterial;
let candidateProtected;
try {
  parentSymbolic = await choose(parentRoot, fixture.symbolicOnlyActions, "grow");
  candidateSymbolic = await choose(candidateRoot, fixture.symbolicOnlyActions, "grow");
  parentMaterial = await choose(parentRoot, fixture.materialActions, "grow");
  candidateMaterial = await choose(candidateRoot, fixture.materialActions, "grow");
  candidateProtected = await choose(candidateRoot, fixture.protectedActions, "finish");

  assert.equal(parentSymbolic.id, "alliance:alpha");
  assert.equal(candidateSymbolic.id, "hold");
  assert.equal(parentMaterial.id, "build:Factory:1");
  assert.equal(candidateMaterial.id, "build:Factory:1");
  assert.ok(candidateMaterial.policyMarkers.includes("iu1g"));
  assert.ok(candidateMaterial.policyMarkers.includes("ixgrw"));
  assert.equal(candidateProtected.id, "hold");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v36/verify-differential.mjs";
const fixtureRelativePath = "experiments/v36/differential-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "intent-material-gate-v36",
  same_fixture: true,
  equivalent_goal: "execute one macro intent without substituting symbolic activity for material action",
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
    symbolic_only_selected_action_id: parentSymbolic.id,
    material_selected_action_id: parentMaterial.id,
    interpretation: "complete-menu utility permits symbolic filler",
  },
  candidate: {
    source_commit: candidateCommit,
    symbolic_only_selected_action_id: candidateSymbolic.id,
    material_selected_action_id: candidateMaterial.id,
    markers: candidateMaterial.policyMarkers,
    interpretation: "material gate preserves execution and holds when only symbolic filler remains",
  },
  safety: {
    offered_k1z_harmful_action: "build:Atom Bomb:mickey",
    candidate_selected_action_id: candidateProtected.id,
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
