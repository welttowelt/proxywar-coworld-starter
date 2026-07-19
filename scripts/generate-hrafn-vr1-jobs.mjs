#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const value = (name, fallback = null) => {
  const index = process.argv.lastIndexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const manifestPath = value("--manifest");
const outputDir = value("--output-dir", "/private/tmp/hrafn-vr1-jobs");
if (!manifestPath) {
  throw new Error(
    "usage: node scripts/generate-hrafn-vr1-jobs.mjs " +
    "--manifest <coworld_manifest.json> [--output-dir <directory>]",
  );
}

const EXPECTED_MANIFEST_FILE_SHA256 =
  "f5e6b4dd247b2b2e534a415d293babab7fd655d44b2004db4257a2df3a01dab0";
const EXPECTED_MANIFEST_CANONICAL_SHA256 =
  "a43dafa9bb7e68a5c708b3fc6a44e80097e04e1da07131d62a00b7a8a445d86d";
const images = Object.freeze({
  exact: "sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d",
  quickchat: "sha256:b7c6c1fb8e5bbee02d80ba156187bab6bb5ca996b2a4f5ddc8cc871c0989646c",
  control: "sha256:aa5c15a39681fff79c4db7e380c9d6ac6c573cc8fbb69bb9cc545b079f25a1d7",
  candidate: "sha256:02439078ca32f096ee457b4d5dbf80bfcecffd75c0559f1790875b2b6eac03a6",
  odin: "sha256:ebd9eed3f8a936cc2d0813f54944a0e3e826a0141932356041d71f0c3638a478",
  katanasan: "sha256:0afece2db25675b0b744844769c64e02960270f56502c33d62bf0702f7b58cf6",
  gravity: "sha256:2ebf15372e8cf59b194ebb20f06b818a6a54f96994f4125e103b6a26070491c2",
  outsider: "sha256:3ea2a36dbf2c554f619adfc36e890e6a333bf43144340bfe594807d539b82ef0",
});

const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const canonicalize = (input) => {
  if (Array.isArray(input)) return input.map(canonicalize);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]),
    );
  }
  return input;
};
const canonicalHash = (input) =>
  sha256(`${JSON.stringify(canonicalize(input))}\n`);

const manifestBytes = await readFile(manifestPath);
const manifestFileHash = sha256(manifestBytes);
if (manifestFileHash !== EXPECTED_MANIFEST_FILE_SHA256) {
  throw new Error(
    `manifest file hash ${manifestFileHash} does not match ${EXPECTED_MANIFEST_FILE_SHA256}`,
  );
}
const manifest = JSON.parse(manifestBytes);
const manifestHash = canonicalHash(manifest);
if (manifestHash !== EXPECTED_MANIFEST_CANONICAL_SHA256) {
  throw new Error(
    `canonical manifest hash ${manifestHash} does not match ${EXPECTED_MANIFEST_CANONICAL_SHA256}`,
  );
}

const player = (name, image, hrafn = false) => ({
  name,
  image,
  run: ["node", hrafn ? "/app/hrafn-player.mjs" : "/app/llm-player.mjs"],
});
const fixed = Object.freeze({
  auri: player("Auri proxy", images.outsider),
  daveey: player("daveey proxy", images.outsider),
  richard: player("Richard proxy", images.outsider),
  relh: player("RelhAlpha proxy", images.outsider),
  gravity: player("K1Z juryoku-koku", images.gravity),
  katanasan: player("K1Z katanasan", images.katanasan),
  odin: player("K1Z odin free", images.odin),
});
const hrafn = (arm) => player("K1Z Hrafn", images[arm], true);

const gameConfig = (roster, seed, compact = false) => ({
  map: "Pangaea",
  seed,
  players: roster.map(({ name }) => ({ name })),
  map_size: compact ? "Compact" : "Normal",
  difficulty: "Easy",
  num_agents: roster.length,
  max_decision_ms: 15000,
  replay_tail_turns: 500,
  max_decision_steps: compact ? 300 : 400,
  episode_timeout_seconds: compact ? 2400 : 3000,
  turns_per_decision_step: 100,
  player_connect_timeout_seconds: 120,
  tokens: null,
});
const job = (roster, seed, compact = false) => ({
  manifest,
  game_config: gameConfig(roster, seed, compact),
  players: roster.map(({ image, run }) => ({ type: "player", image, run })),
});

const orientation = (arm, parity) => {
  const first = [fixed.auri, fixed.daveey, fixed.richard, fixed.relh];
  const coalition = [hrafn(arm), fixed.gravity, fixed.katanasan, fixed.odin];
  return parity === "a" ? [...first, ...coalition] : [...coalition].reverse().concat(first);
};

const jobs = [
  {
    name: "qualifier-vr1-wr1",
    data: job([hrafn("candidate"), fixed.odin, fixed.auri, fixed.daveey], 52900, true),
  },
  ...["a", "b"].flatMap((parity, index) =>
    ["exact", "quickchat", "control", "candidate"].map((arm) => ({
      name: `matched-pangaea-${parity}-${arm}`,
      data: job(orientation(arm, parity), 52901 + index),
    })),
  ),
];

await mkdir(outputDir, { recursive: true });
const reports = [];
for (const entry of jobs) {
  const output = path.join(outputDir, `${entry.name}.json`);
  const encoded = `${JSON.stringify(entry.data, null, 2)}\n`;
  await writeFile(output, encoded);
  reports.push({
    name: entry.name,
    output,
    request_sha256: sha256(encoded),
    game_config_sha256: canonicalHash(entry.data.game_config),
    player_images: entry.data.players.map(({ image }) => image),
  });
}

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  manifest_path: manifestPath,
  manifest_file_sha256: manifestFileHash,
  manifest_canonical_sha256: manifestHash,
  images,
  reports,
}, null, 2)}\n`);
