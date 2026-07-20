#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const [output = "/private/tmp/dp2-world-reach-18step-20260720.json"] = process.argv.slice(2);
const manifestPath =
  "/Users/olifreuler/proxywar-coworld-starter/coworld/cow_15c39dab-eac1-4284-bf3e-bd723d4c2755/coworld_manifest.json";
const candidate = "proxywar-agent-llm:qd1n-v89-dp2-amd64";
const parent = "proxywar-agent-llm:qd1n-v89-exact-amd64";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const variant = manifest.variants.find((entry) => entry.id === "tournament-8p-world");

if (!variant || variant.game_config.map !== "World") {
  throw new Error("canonical 8P World variant is unavailable");
}
if (variant.game_config.players?.length !== 8) {
  throw new Error("canonical 8P World variant must contain eight named seats");
}

const gameConfig = {
  ...variant.game_config,
  seed: 20260720,
  max_decision_steps: 18,
  episode_timeout_seconds: 600,
  replay_tail_turns: 0,
};
const players = Array.from({ length: 8 }, (_, slot) => ({
  type: "player",
  image: slot === 0 ? candidate : parent,
  run: ["node", "/app/llm-player.mjs"],
}));
const job = { manifest, game_config: gameConfig, players };

await writeFile(output, `${JSON.stringify(job, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ output, map: gameConfig.map, steps: gameConfig.max_decision_steps, candidate_slots: [0] })}\n`,
);
