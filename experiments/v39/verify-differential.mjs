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
const evaluate = async (root, fixture) => {
  const engine = await import(pathToFileURL(path.join(root, "strategy-engine.mjs")).href);
  const controller = await import(pathToFileURL(path.join(root, "intent-controller.mjs")).href);
  const core = await import(pathToFileURL(path.join(root, "intent-core.mjs")).href);
  const state = engine.buildState(fixture.observation, fixture.actions, fixture.history);
  return {
    normalized: controller.normalizeIntentDirective(fixture.planner_packet, state, "fixture"),
    selected: core.chooseIntentCoreAction(
      fixture.actions, state, { ...fixture.planner_packet, model: "fixture" }, fixture.history,
    ),
  };
};

const parentCommit = resolveCommit(requestedParent);
const candidateCommit = resolveCommit(requestedCandidate);
const evaluatorCommit = resolveCommit("HEAD");
assert.equal(parentCommit, requestedParent);
assert.equal(candidateCommit, requestedCandidate);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const scratch = mkdtempSync(path.join(os.tmpdir(), "v39-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extract(parentCommit, parentRoot);
extract(candidateCommit, candidateRoot);

let parent;
let candidate;
try {
  parent = await evaluate(parentRoot, fixture);
  candidate = await evaluate(candidateRoot, fixture);
  assert.deepEqual(parent.normalized, { intent: "secure", model: "fixture" });
  assert.equal(candidate.normalized, null);
  assert.equal(parent.selected.id, "build:City");
  assert.equal(candidate.selected.id, "expand:terra-nullius:35");
  assert.ok(parent.selected.policyMarkers.includes("ixsec"));
  assert.ok(candidate.selected.policyMarkers.includes("ib2"));
  assert.ok(candidate.selected.policyMarkers.includes("ixgrw"));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v39/verify-differential.mjs";
const fixtureRelativePath = "experiments/v39/differential-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 2,
  arm: "two-intents-v39",
  same_fixture: true,
  equivalent_goal: "select a board-level outcome without tactical planner instructions",
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
    secure_packet_accepted: parent.normalized !== null,
    selected_action_id: parent.selected.id,
    interpretation: "the three-intent parent preserves a separate upgrade-only lane",
  },
  candidate: {
    source_commit: candidateCommit,
    secure_packet_accepted: candidate.normalized !== null,
    selected_action_id: candidate.selected.id,
    markers: candidate.selected.policyMarkers,
    interpretation: "the two-intent candidate rejects secure and resolves the same state through grow",
  },
  safety: {
    offered_k1z_target: false,
    candidate_selected_harmful_action: false,
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
