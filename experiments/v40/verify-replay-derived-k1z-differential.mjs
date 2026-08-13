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
  throw new Error("usage: verify-replay-derived-k1z-differential.mjs REPOSITORY PARENT CANDIDATE FIXTURE OUTPUT");
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

const decisionInput = (fixture, replayCase) => {
  const defaults = fixture.state_defaults;
  const attack = {
    id: replayCase.selected_action_id,
    kind: "attack",
    label: `Attack ${replayCase.target_name} ${replayCase.troop_percent}%`,
    risk: { level: "low" },
    metadata: {
      targetID: replayCase.target_id,
      targetName: replayCase.target_name,
      troopPercent: replayCase.troop_percent,
    },
  };
  return {
    actions: [attack, { id: "hold", kind: "hold", label: "Hold", risk: { level: "low" } }],
    observation: {
      phase: "active",
      ownState: {
        tileShare: defaults.tile_share,
        troopRatio: defaults.troop_ratio,
        troops: 500000,
        gold: 250000,
        borderTiles: 100,
        incomingAttacks: [],
      },
      combat: { incomingAttackPlayerIDs: [] },
      visiblePlayers: [{
        id: replayCase.target_id,
        name: replayCase.target_name,
        isAlive: true,
        tileShare: defaults.rival_tile_share,
        relativeTroopRatio: defaults.relative_troop_ratio,
        sharesBorder: true,
        canAttack: true,
        isAllied: false,
      }],
    },
    history: [],
  };
};

const evaluate = async (root, fixture, replayCase) => {
  const engine = await import(pathToFileURL(path.join(root, "strategy-engine.mjs")).href);
  const controller = await import(pathToFileURL(path.join(root, "intent-controller.mjs")).href);
  const core = await import(pathToFileURL(path.join(root, "intent-core.mjs")).href);
  const input = decisionInput(fixture, replayCase);
  const state = engine.buildState(input.observation, input.actions, input.history);
  return {
    normalized: controller.normalizeIntentDirective(fixture.planner_packet, state, "fixture"),
    selected: core.chooseIntentCoreAction(
      input.actions,
      state,
      { ...fixture.planner_packet, model: "fixture" },
      input.history,
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
assert.equal(fixture.cases.length, 12);
assert.deepEqual([...new Set(fixture.cases.map((entry) => entry.target_name))].sort(), [
  "CYAN HELLSTAR",
  "SIAN VOIDCROWN",
]);

const scratch = mkdtempSync(path.join(os.tmpdir(), "v40-k1z-differential-"));
const parentRoot = path.join(scratch, "parent");
const candidateRoot = path.join(scratch, "candidate");
mkdirSync(parentRoot);
mkdirSync(candidateRoot);
extract(parentCommit, parentRoot);
extract(candidateCommit, candidateRoot);

const results = [];
try {
  for (const replayCase of fixture.cases) {
    const parent = await evaluate(parentRoot, fixture, replayCase);
    const candidate = await evaluate(candidateRoot, fixture, replayCase);
    assert.deepEqual(parent.normalized, { intent: "grow", model: "fixture" });
    assert.deepEqual(candidate.normalized, parent.normalized);
    assert.equal(parent.selected.id, replayCase.selected_action_id, replayCase.id);
    assert.equal(candidate.selected.id, "hold", replayCase.id);
    assert.ok(candidate.selected.policyMarkers.includes("ixgrw"), replayCase.id);
    results.push({
      id: replayCase.id,
      slot: replayCase.slot,
      episode_id: replayCase.episode_id,
      turn: replayCase.turn,
      target_name: replayCase.target_name,
      parent_selected_action_id: parent.selected.id,
      candidate_selected_action_id: candidate.selected.id,
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierRelativePath = "experiments/v40/verify-replay-derived-k1z-differential.mjs";
const fixtureRelativePath = "experiments/v40/replay-derived-k1z-fixture.json";
const committedVerifier = execFileSync(
  "git", ["-C", repository, "show", `${evaluatorCommit}:${verifierRelativePath}`],
  { maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(digest(verifierBytes), digest(committedVerifier));

const proof = {
  schema_version: 1,
  arm: "v40-k1z-runtime-alias-lock",
  same_input_per_commit: true,
  planner_changed: false,
  planner_intent: "grow",
  replay_derived_cases: fixture.cases.length,
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
    harmful_selections: results.filter((entry) =>
      entry.parent_selected_action_id.startsWith("attack:")
    ).length,
  },
  candidate: {
    source_commit: candidateCommit,
    harmful_selections: results.filter((entry) =>
      entry.candidate_selected_action_id.startsWith("attack:")
    ).length,
    safe_redirects: results.filter((entry) => entry.candidate_selected_action_id === "hold").length,
  },
  results,
  verdict: "candidate redirects all twelve replay-derived K1Z attacks without changing planner intent",
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
