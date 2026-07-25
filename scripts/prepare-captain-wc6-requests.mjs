#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTROL_COMMIT = "96482ba6595273e5b32be11c73a4907864f64933";
const CANDIDATE_COMMIT = "80d54f18ad3071e35b4c0b80377e115c0f701d75";
const QUALIFIER_SEEDS = Object.freeze([
  20260788,
  20260789,
  20260790,
  20260791,
  20260792,
  20260793,
  20260794,
  20260795,
  20260796,
  20260797,
  20260798,
  20260799,
]);
const ROSTER = Object.freeze(
  Array.from({ length: 12 }, (_, slot) => `Captain parity clone ${slot}`),
);

function usage() {
  return [
    "Usage:",
    "  node scripts/prepare-captain-wc6-requests.mjs \\",
    "    --mode qualifier|matched --base-request ABS_JSON --manifest ABS_JSON \\",
    "    --output-dir ABS_DIR --candidate-image SHA256 --control-image SHA256 \\",
    "    [--seed INTEGER --slot 0..11]",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.length % 2 !== 0) throw new Error(usage());
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) {
      throw new Error(usage());
    }
    values.set(key, value);
  }
  const allowed = new Set([
    "--mode",
    "--base-request",
    "--manifest",
    "--output-dir",
    "--candidate-image",
    "--control-image",
    "--seed",
    "--slot",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown argument ${key}\n${usage()}`);
  }

  const result = {
    mode: values.get("--mode"),
    baseRequest: values.get("--base-request"),
    manifest: values.get("--manifest"),
    outputDir: values.get("--output-dir"),
    candidateImage: values.get("--candidate-image"),
    controlImage: values.get("--control-image"),
    seed: values.has("--seed") ? Number(values.get("--seed")) : null,
    slot: values.has("--slot") ? Number(values.get("--slot")) : null,
  };
  for (const key of [
    "mode",
    "baseRequest",
    "manifest",
    "outputDir",
    "candidateImage",
    "controlImage",
  ]) {
    if (!result[key]) throw new Error(`missing ${key}\n${usage()}`);
  }
  if (!["qualifier", "matched"].includes(result.mode)) {
    throw new Error(`invalid mode ${result.mode}\n${usage()}`);
  }
  if (
    !path.isAbsolute(result.baseRequest) ||
    !path.isAbsolute(result.manifest) ||
    !path.isAbsolute(result.outputDir)
  ) {
    throw new Error("base request, manifest, and output directory must be absolute paths");
  }
  for (const image of [result.candidateImage, result.controlImage]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(image)) {
      throw new Error(`invalid immutable image ID: ${image}`);
    }
  }
  if (result.candidateImage === result.controlImage) {
    throw new Error("candidate and control images must differ");
  }
  if (result.mode === "qualifier" && (result.seed !== null || result.slot !== null)) {
    throw new Error("qualifier mode forbids --seed and --slot");
  }
  if (
    result.mode === "matched" &&
    (!Number.isSafeInteger(result.seed) ||
      !Number.isSafeInteger(result.slot) ||
      result.slot < 0 ||
      result.slot >= ROSTER.length)
  ) {
    throw new Error("matched mode requires an integer --seed and --slot 0..11");
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makePolicy(image) {
  return {
    type: "player",
    image,
    run: ["node", "/app/llm-player.mjs"],
  };
}

function makeRequest(base, {
  seed,
  maxDecisionSteps,
  images,
  phase,
  selectedSlot = null,
}) {
  const request = structuredClone(base);
  request.game_config = {
    ...request.game_config,
    map: "World",
    map_size: "Normal",
    difficulty: "Easy",
    num_agents: ROSTER.length,
    max_decision_steps: maxDecisionSteps,
    turns_per_decision_step: 100,
    max_decision_ms: 15000,
    replay_tail_turns: 0,
    episode_timeout_seconds: maxDecisionSteps === 25 ? 900 : 1800,
    player_connect_timeout_seconds: 240,
    seed,
    players: ROSTER.map((name) => ({ name })),
  };
  request.players = images.map(makePolicy);
  request.episode_tags = {
    campaign: "captain-wc6-v4-observable-first-contact",
    phase,
    seed: String(seed),
    selected_slot: selectedSlot === null ? "none" : String(selectedSlot),
    exact_parent_commit: CONTROL_COMMIT,
    candidate_commit: CANDIDATE_COMMIT,
  };
  return request;
}

async function writeRequest(outputDir, filename, request, metadata) {
  const serialized = `${JSON.stringify(request, null, 2)}\n`;
  await writeFile(path.join(outputDir, filename), serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return {
    filename,
    sha256: sha256(serialized),
    ...metadata,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = JSON.parse(await readFile(args.baseRequest, "utf8"));
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  if (
    manifest?.game?.name !== "proxywar" ||
    manifest?.game?.version !== "0.1.11" ||
    base?.game_config?.players?.length !== ROSTER.length ||
    base?.players?.length !== ROSTER.length ||
    sha256(JSON.stringify(base?.manifest)) !== sha256(JSON.stringify(manifest))
  ) {
    throw new Error("base request is not the pinned 12-player ProxyWar 0.1.11 request");
  }
  const starter = manifest?.player?.[0];
  if (
    starter?.type !== "player" ||
    !Array.isArray(starter.run) ||
    starter.run.join(" ") !== "node /app/integration/src/starter-player.mjs"
  ) {
    throw new Error("pinned manifest does not expose the expected starter control");
  }
  base.manifest = manifest;
  await mkdir(args.outputDir, { recursive: false });

  const index = [];
  if (args.mode === "qualifier") {
    for (const seed of QUALIFIER_SEEDS) {
      const request = makeRequest(base, {
        seed,
        maxDecisionSteps: 25,
        images: Array.from({ length: ROSTER.length }, () => args.candidateImage),
        phase: "outcome-blind-reach-qualifier",
      });
      index.push(await writeRequest(
        args.outputDir,
        `captain-wc6-qualifier-${seed}.json`,
        request,
        { seed, phase: "qualifier" },
      ));
    }
  } else {
    const controlImages = Array.from(
      { length: ROSTER.length },
      () => args.controlImage,
    );
    const candidateImages = [...controlImages];
    candidateImages[args.slot] = args.candidateImage;
    for (const [variant, images] of [
      ["control", controlImages],
      ["candidate", candidateImages],
    ]) {
      const request = makeRequest(base, {
        seed: args.seed,
        maxDecisionSteps: 100,
        images,
        phase: `same-seat-${variant}`,
        selectedSlot: args.slot,
      });
      index.push(await writeRequest(
        args.outputDir,
        `captain-wc6-matched-${args.seed}-slot-${args.slot}-${variant}.json`,
        request,
        {
          seed: args.seed,
          slot: args.slot,
          phase: "matched",
          variant,
        },
      ));
    }
  }

  process.stdout.write(`${JSON.stringify({
    mode: args.mode,
    output_dir: args.outputDir,
    requests: index,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`CAPTAIN_WC6_PREPARE_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
