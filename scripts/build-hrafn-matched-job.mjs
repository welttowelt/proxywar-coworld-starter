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
] = process.argv.slice(2);

if (
  !manifestPath ||
  !outputPath ||
  !variantID ||
  !candidateImage ||
  !controlImage
) {
  throw new Error(
    "usage: build-hrafn-matched-job MANIFEST OUTPUT VARIANT CANDIDATE CONTROL",
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

const gameConfig = structuredClone(variant.game_config);
gameConfig.tokens = null;
const namedPlayers = [
  { name: "K1Z Hrafn" },
  { name: "Hrafn v5 control" },
];
const runnables = [
  {
    type: "player",
    image: candidateImage,
    run: ["node", "/app/hrafn-chassis-player.mjs"],
  },
  {
    type: "player",
    image: controlImage,
    run: ["node", "/app/hrafn-player.mjs"],
  },
];
if (order === "control-first") {
  namedPlayers.reverse();
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
