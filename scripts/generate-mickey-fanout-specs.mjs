#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "experiments", "mickey-fanout-specs-20260721");
const INPUT_PATH = path.join(REPO_ROOT, "experiments", "mickey-runpod-multi-policy-bundle-input-20260721.json");
const PAIR_INDEX_PATH = path.join(REPO_ROOT, "experiments", "mickey-fanout-pair-index-20260721.json");
const HORIZON = 80;

const arms = [
  { id: "grow-opening", mechanism: "grow", rosterClass: "all-k1z-grow", entrypoint: "evaluation-grow-opening-player.mjs" },
  { id: "grow-low-share", mechanism: "grow", rosterClass: "all-k1z-grow", entrypoint: "evaluation-grow-low-share-player.mjs" },
  { id: "convert-weakest", mechanism: "convert", rosterClass: "mixed-outsider-convert", entrypoint: "evaluation-convert-weakest-player.mjs" },
  { id: "convert-largest", mechanism: "convert", rosterClass: "mixed-outsider-convert", entrypoint: "evaluation-convert-largest-player.mjs" },
];

const cells = {
  "all-k1z-grow": [
    { id: "pangaea-s0-a", map: "Pangaea", seed: 2026072101, seat: 0 },
    { id: "pangaea-s2-b", map: "Pangaea", seed: 2026072102, seat: 2 },
    { id: "asia-s0-c", map: "Asia", seed: 2026072103, seat: 0 },
    { id: "asia-s2-d", map: "Asia", seed: 2026072104, seat: 2 },
  ],
  "mixed-outsider-convert": [
    { id: "world-s0-a", map: "World", seed: 2026072111, seat: 0 },
    { id: "world-s2-b", map: "World", seed: 2026072112, seat: 2 },
    { id: "asia-s0-c", map: "Asia", seed: 2026072113, seat: 0 },
    { id: "asia-s2-d", map: "Asia", seed: 2026072114, seat: 2 },
  ],
};

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function writeJSON(filePath, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(filePath, body, { mode: 0o644 });
  return sha256(body);
}

function mickeyPlayer(policyKey, entrypoint) {
  return {
    name: "K1Z Mickey Mouse",
    policy: policyKey,
    cwd: `policies/${policyKey}/app`,
    run: ["node", entrypoint],
    env: { AWS_EC2_METADATA_DISABLED: "true" },
  };
}

const qd1n = (name) => ({
  name,
  policy: "opponent-qd1n-v89",
  cwd: "policies/opponent-qd1n-v89/app",
  run: ["node", "llm-player.mjs"],
  env: { POLICY_CODENAME: "s4ntai", POLICY_ENGINE: "", AWS_EC2_METADATA_DISABLED: "true" },
});

const gravity = {
  name: "K1Z Gravity",
  policy: "opponent-gravity-kiz1-selector",
  cwd: "policies/opponent-gravity-kiz1-selector/app",
  run: ["node", "kiz1-selector-player.mjs"],
  env: { AWS_EC2_METADATA_DISABLED: "true" },
};

function players(rosterClass, seat, tested) {
  const fixed = rosterClass === "all-k1z-grow"
    ? [qd1n("K1Z odin free"), gravity, qd1n("K1Z sparring ghost")]
    : [qd1n("K1Z odin free"), gravity, qd1n("outsider-control-v89")];
  const result = [...fixed];
  result.splice(seat, 0, tested);
  return result.slice(0, 4);
}

function spec(cell, rosterClass, tested) {
  return {
    schema_version: 1,
    game_config: {
      seed: cell.seed,
      map: cell.map,
      map_size: "Compact",
      difficulty: "Easy",
      num_agents: 4,
      max_decision_steps: HORIZON,
      turns_per_decision_step: 100,
      max_decision_ms: 15000,
      replay_tail_turns: 500,
      episode_timeout_seconds: 1800,
      player_connect_timeout_seconds: 120,
    },
    players: players(rosterClass, cell.seat, tested),
  };
}

function roster(specDocument, rosterClass) {
  return specDocument.players.map((player, seat) => ({
    seat,
    name: player.name,
    coalition: rosterClass === "mixed-outsider-convert" && player.name === "outsider-control-v89"
      ? "outsider"
      : "k1z",
  }));
}

mkdirSync(OUTPUT_ROOT, { recursive: true });
const template = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
const specRecords = [];
const controls = new Map();
const pairs = [];

for (const arm of arms) {
  for (const cell of cells[arm.rosterClass]) {
    const controlID = `${arm.rosterClass}-${cell.id}-m0`;
    if (!controls.has(controlID)) {
      const controlSource = `experiments/mickey-fanout-specs-20260721/${controlID}.json`;
      const controlArchive = `specs/${controlID}.json`;
      const controlDocument = spec(
        cell,
        arm.rosterClass,
        mickeyPlayer("mickey-static-eval-m0", "evaluation-m0-player.mjs"),
      );
      const controlHash = writeJSON(path.join(REPO_ROOT, controlSource), controlDocument);
      const control = {
        label: controlID,
        source: controlSource,
        archive_path: controlArchive,
        sha256: controlHash,
        role: "exact-parent",
        max_decision_steps: HORIZON,
      };
      controls.set(controlID, control);
      specRecords.push(control);
    }

    const candidateID = `${arm.id}-${cell.id}-candidate`;
    const candidateSource = `experiments/mickey-fanout-specs-20260721/${candidateID}.json`;
    const candidateArchive = `specs/${candidateID}.json`;
    const candidateDocument = spec(
      cell,
      arm.rosterClass,
      mickeyPlayer(`mickey-static-eval-${arm.id}`, arm.entrypoint),
    );
    const candidateHash = writeJSON(path.join(REPO_ROOT, candidateSource), candidateDocument);
    const candidate = {
      label: candidateID,
      source: candidateSource,
      archive_path: candidateArchive,
      sha256: candidateHash,
      role: "candidate",
      max_decision_steps: HORIZON,
    };
    specRecords.push(candidate);
    const control = controls.get(controlID);
    pairs.push({
      id: `${arm.id}-${cell.id}`,
      arm: arm.id,
      mechanism_class: arm.mechanism,
      roster_class: arm.rosterClass,
      map: cell.map,
      seed: cell.seed,
      seat: cell.seat,
      max_decision_steps: HORIZON,
      roster: roster(candidateDocument, arm.rosterClass),
      candidate_spec: { archive_path: candidate.archive_path, sha256: candidate.sha256 },
      m0_spec: { archive_path: control.archive_path, sha256: control.sha256 },
    });
  }
}

specRecords.sort((left, right) => left.label.localeCompare(right.label, "en"));
pairs.sort((left, right) => left.id.localeCompare(right.id, "en"));
const pairIndex = {
  schema_version: 1,
  kind: "mickey_cpu_fanout_pair_index",
  evidence_scope: "diagnostic_only",
  pair_count: pairs.length,
  cells_per_arm: 4,
  maps_per_arm: 2,
  test_seats_per_arm: 2,
  pairs,
};
const pairIndexHash = writeJSON(PAIR_INDEX_PATH, pairIndex);

template.source_reach_receipt.sha256 = "127d60ee51f4e4b2d50c7b6908d1e571ce8f9e40f1939f61c25e3cdb4abaa129";
template.pair_index = {
  path: "experiments/mickey-fanout-pair-index-20260721.json",
  sha256: pairIndexHash,
};
template.experiment_specs = specRecords;
writeJSON(INPUT_PATH, template);

process.stdout.write(`${JSON.stringify({
  pair_index: path.relative(REPO_ROOT, PAIR_INDEX_PATH),
  pair_index_sha256: pairIndexHash,
  pair_count: pairs.length,
  spec_count: specRecords.length,
  input_manifest: path.relative(REPO_ROOT, INPUT_PATH),
}, null, 2)}\n`);
