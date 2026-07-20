#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
} from "node:fs";

const [
  manifestPath,
  outputPath,
  variantID,
  candidateImage,
  controlImage,
  order = "candidate-first",
  controlKind = "v5-control",
  seedText,
] = process.argv.slice(2);

if (
  !manifestPath ||
  !outputPath ||
  !variantID ||
  !candidateImage ||
  !controlImage
) {
  throw new Error(
    "usage: build-hrafn-matched-job MANIFEST OUTPUT VARIANT CANDIDATE CONTROL " +
      "[candidate-first|control-first] [v5-control|chassis-control] [seed]",
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const variant = manifest.variants?.find((entry) => entry.id === variantID);
if (!variant) throw new Error(`unknown variant ${variantID}`);
if (variant.game_config?.num_agents !== 2) {
  throw new Error("matched Hrafn job requires an exact two-player variant");
}
if (!["candidate-first", "control-first"].includes(order)) {
  throw new Error("order must be candidate-first or control-first");
}
if (!["v5-control", "chassis-control"].includes(controlKind)) {
  throw new Error("control kind must be v5-control or chassis-control");
}
const seed = seedText === undefined ? null : Number(seedText);
if (
  seed !== null &&
  (!Number.isSafeInteger(seed) || seed < 0 || seed > 308915775)
) {
  throw new Error("seed must be an integer from 0 through 308915775");
}

const gameConfig = structuredClone(variant.game_config);
gameConfig.tokens = null;
if (seed !== null) gameConfig.seed = seed;
const chassisControl = controlKind === "chassis-control";
const namedPlayers = chassisControl
  ? [{ name: "K1Z Hrafn" }, { name: "Hrafn comparison" }]
  : [{ name: "K1Z Hrafn" }, { name: "Hrafn v5 control" }];
const runnables = [
  {
    type: "player",
    image: candidateImage,
    run: ["node", "/app/hrafn-chassis-player.mjs"],
  },
  {
    type: "player",
    image: controlImage,
    run: [
      "node",
      chassisControl
        ? "/app/hrafn-chassis-player.mjs"
        : "/app/hrafn-player.mjs",
    ],
  },
];
if (order === "control-first") {
  if (!chassisControl) namedPlayers.reverse();
  runnables.reverse();
}
gameConfig.players = namedPlayers;

const job = {
  manifest,
  game_config: gameConfig,
  players: runnables,
};

writeFileSync(outputPath, `${JSON.stringify(job, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
