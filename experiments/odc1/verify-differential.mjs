#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [parentRoot, candidateRoot, fixturePath, outputPath] = process.argv.slice(2);
if (!parentRoot || !candidateRoot || !fixturePath || !outputPath) {
  throw new Error(
    "usage: verify-differential.mjs PARENT_ROOT CANDIDATE_ROOT FIXTURE OUTPUT",
  );
}

const commit = (root) =>
  execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const moduleAt = (root, file) =>
  import(pathToFileURL(path.join(root, file)).href);

const parentCommit = commit(parentRoot);
const candidateCommit = commit(candidateRoot);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes);
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
const parent = parentEngine.chooseAction(
  fixture.legalActions,
  parentState,
  null,
  fixture.history,
);
const candidate = candidateChassis.chooseOdinChassisAction(
  fixture.legalActions,
  candidateState,
  null,
  fixture.history,
);

assert.equal(parent.id, "alliance:kata");
assert.equal(candidate.id, "expand:terra-nullius:10");
assert.notEqual(parent.id, candidate.id);

const proof = {
  schema_version: 2,
  arm: "odc1",
  same_fixture: true,
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
    parentRoot,
    candidateRoot,
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
