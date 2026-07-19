#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const value = (name, fallback = null) => {
  const index = process.argv.lastIndexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const templateA = value("--template-a", "/private/tmp/gc1-mirror-pangaea-a.json");
const templateB = value("--template-b", "/private/tmp/gc1-mirror-pangaea-b.json");
const outputA = value("--output-a", "/private/tmp/gc2-mirror-pangaea-a.json");
const outputB = value("--output-b", "/private/tmp/gc2-mirror-pangaea-b.json");
const candidate = value("--candidate", "proxywar-agent-llm:qd1n-v89-gc2-amd64");
const parent = value("--parent", "proxywar-agent-llm:qd1n-v89-exact-amd64");
const expectedManifest =
  "a43dafa9bb7e68a5c708b3fc6a44e80097e04e1da07131d62a00b7a8a445d86d";
const expectedGameConfig =
  "b2ad49534890d4c7783e90eaf7d947d09440979dcc8281e0b08728c5ffe3de43";

const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const canonicalHash = (value) => sha256(`${JSON.stringify(canonicalize(value))}\n`);

const generate = async (templatePath, outputPath, parity) => {
  const job = JSON.parse(await readFile(templatePath, "utf8"));
  const manifestHash = canonicalHash(job.manifest);
  const gameConfigHash = canonicalHash(job.game_config);
  if (manifestHash !== expectedManifest) {
    throw new Error(
      `${templatePath}: manifest hash ${manifestHash} does not match ${expectedManifest}`,
    );
  }
  if (gameConfigHash !== expectedGameConfig) {
    throw new Error(
      `${templatePath}: game config hash ${gameConfigHash} does not match ${expectedGameConfig}`,
    );
  }
  if (!Array.isArray(job.players) || job.players.length !== 8) {
    throw new Error(`${templatePath}: expected eight policy players`);
  }
  job.players = job.players.map((player, slot) => ({
    ...player,
    image: slot % 2 === parity ? candidate : parent,
  }));
  const encoded = `${JSON.stringify(job, null, 2)}\n`;
  await writeFile(outputPath, encoded);
  return {
    output: outputPath,
    candidate_parity: parity,
    request_sha256: sha256(encoded),
    manifest_sha256: manifestHash,
    game_config_sha256: gameConfigHash,
    candidate,
    parent,
  };
};

const reports = await Promise.all([
  generate(templateA, outputA, 0),
  generate(templateB, outputB, 1),
]);
process.stdout.write(`${JSON.stringify({ reports }, null, 2)}\n`);
