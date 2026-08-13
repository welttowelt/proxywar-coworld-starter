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
const scratch = mkdtempSync(path.join(os.tmpdir(), "v34-differential-"));
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

let parentDiplomacy;
let candidateDiplomacy;
let parentSymbolic;
let candidateSymbolic;
let parentNuclear;
let candidateNuclear;
let candidateProtected;
try {
  parentDiplomacy = await choose(parentRoot, fixture.diplomacyActions, "grow");
  candidateDiplomacy = await choose(candidateRoot, fixture.diplomacyActions, "grow");
  parentSymbolic = await choose(parentRoot, fixture.symbolicOnlyActions, "secure");
  candidateSymbolic = await choose(candidateRoot, fixture.symbolicOnlyActions, "secure");
  parentNuclear = await choose(parentRoot, fixture.nuclearActions, "finish");
  candidateNuclear = await choose(candidateRoot, fixture.nuclearActions, "finish");
  candidateProtected = await choose(candidateRoot, fixture.protectedActions, "secure");

  assert.equal(parentDiplomacy.id, "expand:terra-nullius:35");
  assert.equal(candidateDiplomacy.id, "alliance:mickey");
  assert.ok(candidateDiplomacy.policyMarkers.includes("kp2"));
  assert.ok(candidateDiplomacy.policyMarkers.includes("ixgrw"));
  assert.equal(parentSymbolic.id, "hold");
  assert.equal(candidateSymbolic.id, "alliance:outsider");
  assert.equal(parentNuclear.id, "attack:leader:40");
  assert.equal(candidateNuclear.id, "build:Atom Bomb:1");
  assert.ok(candidateNuclear.policyMarkers.includes("nk1"));
  assert.ok(candidateNuclear.policyMarkers.includes("ixfin"));
  assert.equal(candidateProtected.id, "hold");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v34/verify-differential.mjs";
const fixtureRelativePath = "experiments/v34/differential-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "intent-steered-baseline-v34",
  same_fixture: true,
  equivalent_goal: "let macro intent steer without replacing mature execution",
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
    diplomacy_selected_action_id: parentDiplomacy.id,
    symbolic_only_selected_action_id: parentSymbolic.id,
    nuclear_selected_action_id: parentNuclear.id,
    interpretation: "standalone intent taxonomy owns and narrows execution",
  },
  candidate: {
    source_commit: candidateCommit,
    diplomacy_selected_action_id: candidateDiplomacy.id,
    symbolic_only_selected_action_id: candidateSymbolic.id,
    nuclear_selected_action_id: candidateNuclear.id,
    markers: candidateNuclear.policyMarkers,
    interpretation: "intent annotates and softly steers the mature full-menu selector",
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
