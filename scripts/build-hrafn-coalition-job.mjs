import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const templatePath = option("template");
const outputPath = option("output");
const map = option("map");
const orientation = option("orientation");
const arm = option("arm");
const seed = Number(option("seed"));

if (!templatePath || !outputPath) {
  throw new Error(
    "usage: node scripts/build-hrafn-coalition-job.mjs " +
    "--template <job.json> --output <job.json> --map <Asia|World|Pangaea> " +
    "--orientation <a|b> --arm <candidate|control> --seed <integer>",
  );
}
if (!new Set(["Asia", "World", "Pangaea"]).has(map)) {
  throw new Error(`unsupported map: ${map}`);
}
if (!new Set(["a", "b"]).has(orientation)) {
  throw new Error(`unsupported orientation: ${orientation}`);
}
if (!new Set(["candidate", "control"]).has(arm)) {
  throw new Error(`unsupported arm: ${arm}`);
}
if (!Number.isInteger(seed) || seed < 0 || seed > 308915775) {
  throw new Error(`invalid seed: ${option("seed")}`);
}

const template = JSON.parse(await readFile(templatePath, "utf8"));
const outsider = {
  image: "proxywar-agent-llm:qd1n-v77-exact-arm64",
  run: ["node", "/app/llm-player.mjs"],
};
const roster = {
  auri: {
    name: "Auri proxy",
    ...outsider,
  },
  daveey: {
    name: "daveey proxy",
    ...outsider,
  },
  richard: {
    name: "Richard proxy",
    ...outsider,
  },
  sefirot: {
    name: "Sefirot proxy",
    ...outsider,
  },
  hrafn: {
    name: "K1Z Hrafn",
    image: arm === "candidate"
      ? "proxywar-agent-llm:hrafn-v1-arm64"
      : "proxywar-agent-llm:hrafn-v0-arm64",
    run: ["node", "/app/hrafn-player.mjs"],
  },
  gravity: {
    name: "K1Z juryoku-koku",
    image: "proxywar-agent-llm:santai-juryoku-v3-hrafn-arm64",
    run: ["node", "/app/llm-player.mjs"],
  },
  katanasan: {
    name: "K1Z katanasan",
    image: "proxywar-agent-llm:tsukuyomi-v39-hrafn-arm64",
    run: ["node", "/app/llm-player.mjs"],
  },
  odin: {
    name: "K1Z odin free",
    image: "proxywar-agent-llm:qd1n-v87-hrafn-arm64",
    run: ["node", "/app/llm-player.mjs"],
  },
};
const order = orientation === "a"
  ? ["auri", "daveey", "richard", "sefirot", "hrafn", "gravity", "katanasan", "odin"]
  : ["odin", "katanasan", "gravity", "hrafn", "auri", "daveey", "richard", "sefirot"];
const seats = order.map((key) => roster[key]);

const job = {
  manifest: template.manifest,
  game_config: {
    ...template.game_config,
    map,
    seed,
    players: seats.map(({ name }) => ({ name })),
    num_agents: 8,
    max_decision_steps: 400,
    episode_timeout_seconds: 3000,
    turns_per_decision_step: 100,
    tokens: null,
  },
  players: seats.map(({ image, run }) => ({
    type: "player",
    image,
    run,
  })),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(job, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);
