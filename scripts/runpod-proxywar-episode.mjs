#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASE_IMAGE =
  "public.ecr.aws/q5f4m8t9/cogames@sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1";

export const RUNTIME_FINGERPRINT_FILES = Object.freeze([
  {
    root: "node",
    path: "node",
    sha256: "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c",
  },
  {
    root: "game",
    path: "src/no-docker-coworld-episode.ts",
    sha256: "fb012e107b254ac3147a4d4999e5f04dfda0abf942d8f45343c064f7c1b83ca5",
  },
  {
    root: "proxywar",
    path: "package-lock.json",
    sha256: "af35e25af6ed67076f7fc10b1c7a3446570f411aa6f1c7f0f4a9f564bff423cf",
  },
  {
    root: "proxywar",
    path: "src/core/configuration/DefaultConfig.ts",
    sha256: "3e66eba94e3de376650c88611381f624e965507426045061332df90e143f80a9",
  },
  {
    root: "proxywar",
    path: "src/core/game/Game.ts",
    sha256: "b64a5808480d68bf37b4cf69596d13487db2c09358df6e13d81973f81e00db12",
  },
  {
    root: "proxywar",
    path: "src/core/execution/AttackExecution.ts",
    sha256: "a07057436a8785f383b555cd6008ba509b38dfe6fec8ef10e1cb65fed491ec31",
  },
  {
    root: "proxywar",
    path: "src/core/execution/WinCheckExecution.ts",
    sha256: "0d9c8bd1212813fb5606444b190237cd8c050bae5b35e26931aa53373480b96e",
  },
]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RESERVED_PLAYER_ENV = new Set([
  "COWORLD_PLAYER_WS_URL",
  "COGAME_CONFIG_URI",
  "COGAME_RESULTS_URI",
  "COGAME_SAVE_REPLAY_URI",
  "COGAME_HOST",
  "COGAME_PORT",
]);
const SECRET_ENV_NAME =
  /(?:^|_)(?:API_?KEY|ACCESS_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|AUTH)(?:_|$)/i;
const ALLOWED_PLAYER_ENV = new Set([
  "AWS_EC2_METADATA_DISABLED",
  "DEBUG_ACTIONS",
  "HRAFN_RV1",
  "PLAN_EVERY",
  "PLAN_FAILURE_COOLDOWN_MS",
  "PLAN_QUOTA_COOLDOWN_MS",
  "PLAN_TIMEOUT_MS",
  "POLICY_CODENAME",
  "POLICY_ENGINE",
  "RECONNECT_BASE_MS",
]);
const REQUIRED_GAME_FIELDS = [
  "seed",
  "max_decision_steps",
  "turns_per_decision_step",
  "max_decision_ms",
  "map",
  "map_size",
  "difficulty",
];
const ALLOWED_GAME_FIELDS = new Set([
  ...REQUIRED_GAME_FIELDS,
  "episode_timeout_seconds",
  "num_agents",
  "player_connect_timeout_seconds",
  "replay_tail_turns",
  "seed",
]);
const MAPS = new Set([
  "Pangaea",
  "Asia",
  "World",
  "GiantWorldMap",
  "Europe",
  "NorthAmerica",
  "Africa",
  "Mena",
  "Britannia",
]);

function usage() {
  return `Usage:
  node scripts/runpod-proxywar-episode.mjs --spec <run-spec.json> [options]

Options:
  --bundle-root <dir>       Resolve policy cwd paths below this directory.
                            Default: directory containing --spec.
  --output-dir <dir>        New, empty run directory. Default:
                            /workspace/proxywar-episodes/<unique-run-id>.
  --run-id <id>             Receipt/run label (letters, numbers, dot, dash,
                            underscore only).
  --port <port>             Loopback game port. Default: an unused local port.
  --startup-timeout <sec>   Game health-check budget. Default: 60.
  --shutdown-timeout <sec>  Player shutdown budget after the game. Default: 15.
  --transport-canary        Permit only a manifest-declared 3-step transport
                            canary. Never use for evaluation evidence.
  --validate-only           Validate paths and print a secret-free plan.
  --help                    Print this help.

The spec contains a game_config without tokens and two to twelve player specs:
{
  "schema_version": 1,
  "game_config": {
    "seed": 20260719,
    "map": "Pangaea",
    "map_size": "Normal",
    "difficulty": "Easy",
    "max_decision_steps": 120,
    "turns_per_decision_step": 100,
    "max_decision_ms": 180000,
    "episode_timeout_seconds": 1800
  },
  "players": [{
    "name": "K1Z odin free",
    "policy": "candidate",
    "cwd": "policies/candidate/app",
    "run": ["node", "llm-player.mjs"],
    "env": {"POLICY_CODENAME": "s4ntai", "AWS_EC2_METADATA_DISABLED": "true"}
  }]
}

This command never calls the RunPod API. It only runs one episode inside an
already-started amd64 Linux CPU container using the Node, game, and ProxyWar
runtime extracted from the pinned base image into this bundle. Before starting,
it rejects secret-bearing control variables, fingerprints fixed runtime files,
and verifies manifest.sha256 plus every selected policy file and symlink against
the bundle manifests. Launch the pod without API keys or credential mounts. A
passed receipt proves transport and artifact integrity only; it is not a
policy-evaluation or promotion verdict.`;
}

function parseArgs(argv) {
  const result = {
    specPath: null,
    bundleRoot: null,
    outputDir: null,
    runID: null,
    port: 0,
    startupTimeoutSeconds: 60,
    shutdownTimeoutSeconds: 15,
    transportCanary: false,
    validateOnly: false,
    help: false,
  };
  const valueOptions = new Map([
    ["--spec", "specPath"],
    ["--bundle-root", "bundleRoot"],
    ["--output-dir", "outputDir"],
    ["--run-id", "runID"],
    ["--port", "port"],
    ["--startup-timeout", "startupTimeoutSeconds"],
    ["--shutdown-timeout", "shutdownTimeoutSeconds"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--validate-only") {
      result.validateOnly = true;
      continue;
    }
    if (arg === "--transport-canary") {
      result.transportCanary = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    const key = valueOptions.get(arg);
    if (!key) throw new Error(`Unknown option: ${arg}`);
    if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
    result[key] = argv[index + 1];
    index += 1;
  }
  if (result.help) return result;
  if (!result.specPath) throw new Error("--spec is required");
  for (const key of [
    "port",
    "startupTimeoutSeconds",
    "shutdownTimeoutSeconds",
  ]) {
    const parsed = Number(result[key]);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
    result[key] = parsed;
  }
  if (result.port > 65535) throw new Error("port must be at most 65535");
  if (result.startupTimeoutSeconds < 1) {
    throw new Error("startupTimeoutSeconds must be at least 1");
  }
  if (result.shutdownTimeoutSeconds < 1) {
    throw new Error("shutdownTimeoutSeconds must be at least 1");
  }
  return result;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireInteger(value, name, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== null && value > maximum)
  ) {
    const upper = maximum === null ? "" : ` and at most ${maximum}`;
    throw new Error(`${name} must be an integer of at least ${minimum}${upper}`);
  }
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function isForbiddenEnvName(name) {
  return RESERVED_PLAYER_ENV.has(name) || SECRET_ENV_NAME.test(name);
}

export function assertSecretFreeControlEnvironment(environment = process.env) {
  const secretNames = Object.keys(environment)
    .filter((name) => SECRET_ENV_NAME.test(name))
    .sort();
  if (secretNames.length > 0) {
    throw new Error(
      `control process environment contains forbidden secret-bearing variables: ${secretNames.join(
        ", ",
      )}; launch the episode container without API keys or credential env`,
    );
  }
}

async function validatePlayer(player, index, bundleRoot, checkPaths) {
  if (!isPlainObject(player)) {
    throw new Error(`players[${index}] must be an object`);
  }
  const allowed = new Set(["name", "policy", "cwd", "run", "env"]);
  for (const key of Object.keys(player)) {
    if (!allowed.has(key)) {
      throw new Error(`players[${index}] contains unknown field ${key}`);
    }
  }
  if (typeof player.name !== "string" || player.name.trim() === "") {
    throw new Error(`players[${index}].name must be a non-empty string`);
  }
  if (
    typeof player.policy !== "string" ||
    !/^[a-zA-Z0-9._-]{1,80}$/.test(player.policy)
  ) {
    throw new Error(
      `players[${index}].policy must use only letters, numbers, dot, dash, or underscore`,
    );
  }
  if (
    typeof player.cwd !== "string" ||
    player.cwd === "" ||
    path.isAbsolute(player.cwd)
  ) {
    throw new Error(`players[${index}].cwd must be a relative path`);
  }
  let cwd = path.resolve(bundleRoot, player.cwd);
  if (!isInside(cwd, bundleRoot)) {
    throw new Error(`players[${index}].cwd escapes the bundle root`);
  }
  if (
    !Array.isArray(player.run) ||
    player.run.length < 2 ||
    player.run.some((part) => typeof part !== "string" || part === "")
  ) {
    throw new Error(
      `players[${index}].run must be a Node command argv array with at least two strings`,
    );
  }
  if (path.basename(player.run[0]) !== "node") {
    throw new Error(`players[${index}].run must launch node directly`);
  }
  const entrypoint = player.run.at(-1);
  if (
    path.isAbsolute(entrypoint) ||
    entrypoint.startsWith("-") ||
    (!entrypoint.endsWith(".js") &&
      !entrypoint.endsWith(".mjs") &&
      !entrypoint.endsWith(".cjs"))
  ) {
    throw new Error(
      `players[${index}].run must end with a JavaScript entrypoint`,
    );
  }
  let resolvedEntrypoint = path.resolve(cwd, entrypoint);
  if (!isInside(resolvedEntrypoint, cwd)) {
    throw new Error(`players[${index}] entrypoint escapes its policy cwd`);
  }
  const env = player.env ?? {};
  if (!isPlainObject(env)) {
    throw new Error(`players[${index}].env must be an object`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error(`players[${index}].env has invalid name ${name}`);
    }
    if (isForbiddenEnvName(name)) {
      throw new Error(
        `players[${index}].env may not contain reserved or secret-bearing variable ${name}`,
      );
    }
    if (!ALLOWED_PLAYER_ENV.has(name)) {
      throw new Error(
        `players[${index}].env variable ${name} is not in the non-secret allowlist`,
      );
    }
    if (typeof value !== "string" || value.length > 4096) {
      throw new Error(
        `players[${index}].env.${name} must be a string of at most 4096 characters`,
      );
    }
  }
  if (checkPaths) {
    const cwdInfo = await stat(cwd).catch(() => null);
    if (!cwdInfo?.isDirectory()) {
      throw new Error(`players[${index}].cwd does not exist: ${player.cwd}`);
    }
    cwd = await realpath(cwd);
    if (!isInside(cwd, bundleRoot)) {
      throw new Error(`players[${index}].cwd symlink escapes the bundle root`);
    }
    resolvedEntrypoint = path.resolve(cwd, entrypoint);
    const entryInfo = await stat(resolvedEntrypoint).catch(() => null);
    if (!entryInfo?.isFile()) {
      throw new Error(
        `players[${index}] entrypoint does not exist: ${path.relative(
          bundleRoot,
          resolvedEntrypoint,
        )}`,
      );
    }
    resolvedEntrypoint = await realpath(resolvedEntrypoint);
    if (!isInside(resolvedEntrypoint, cwd)) {
      throw new Error(
        `players[${index}] entrypoint symlink escapes its policy cwd`,
      );
    }
  }
  return {
    name: player.name.trim(),
    policy: player.policy,
    cwd,
    cwdRelative: path.relative(bundleRoot, cwd),
    run: [...player.run],
    env: { ...env },
  };
}

export async function validateRunSpec(
  document,
  {
    bundleRoot,
    checkPaths = true,
    gameRoot,
    proxyWarRepo,
    nodeExecutable = process.execPath,
  },
) {
  if (!isPlainObject(document)) throw new Error("run spec must be an object");
  const allowed = new Set(["schema_version", "game_config", "players"]);
  for (const key of Object.keys(document)) {
    if (!allowed.has(key)) throw new Error(`run spec contains unknown field ${key}`);
  }
  if (document.schema_version !== 1) {
    throw new Error("schema_version must be 1");
  }
  if (!isPlainObject(document.game_config)) {
    throw new Error("game_config must be an object");
  }
  if ("tokens" in document.game_config) {
    throw new Error(
      "game_config.tokens is forbidden; the orchestrator generates ephemeral tokens",
    );
  }
  if ("players" in document.game_config) {
    throw new Error(
      "game_config.players is forbidden; names come from the player specs",
    );
  }
  for (const key of Object.keys(document.game_config)) {
    if (!ALLOWED_GAME_FIELDS.has(key)) {
      throw new Error(`game_config contains unknown field ${key}`);
    }
  }
  for (const field of REQUIRED_GAME_FIELDS) {
    if (!(field in document.game_config)) {
      throw new Error(`game_config.${field} is required`);
    }
  }
  if (!MAPS.has(document.game_config.map)) {
    throw new Error(`game_config.map is not supported: ${document.game_config.map}`);
  }
  if (!new Set(["Compact", "Normal"]).has(document.game_config.map_size)) {
    throw new Error("game_config.map_size must be Compact or Normal");
  }
  if (!new Set(["Easy", "Medium"]).has(document.game_config.difficulty)) {
    throw new Error("game_config.difficulty must be Easy or Medium");
  }
  requireInteger(
    document.game_config.max_decision_steps,
    "game_config.max_decision_steps",
    1,
    600,
  );
  requireInteger(
    document.game_config.turns_per_decision_step,
    "game_config.turns_per_decision_step",
    1,
    1000,
  );
  requireInteger(
    document.game_config.max_decision_ms,
    "game_config.max_decision_ms",
    250,
    180000,
  );
  if (document.game_config.seed !== undefined) {
    requireInteger(document.game_config.seed, "game_config.seed", 0, 308915775);
  }
  if (document.game_config.replay_tail_turns !== undefined) {
    requireInteger(
      document.game_config.replay_tail_turns,
      "game_config.replay_tail_turns",
      0,
      5000,
    );
  }
  const episodeTimeout = document.game_config.episode_timeout_seconds ?? 3600;
  requireInteger(
    episodeTimeout,
    "game_config.episode_timeout_seconds",
    60,
    3600,
  );
  const connectTimeout =
    document.game_config.player_connect_timeout_seconds ?? 120;
  if (
    typeof connectTimeout !== "number" ||
    connectTimeout < 1 ||
    connectTimeout > 300
  ) {
    throw new Error(
      "game_config.player_connect_timeout_seconds must be between 1 and 300",
    );
  }
  if (
    !Array.isArray(document.players) ||
    document.players.length < 2 ||
    document.players.length > 12
  ) {
    throw new Error("players must contain between 2 and 12 entries");
  }
  const lexicalRoot = path.resolve(bundleRoot);
  const resolvedRoot = checkPaths ? await realpath(lexicalRoot) : lexicalRoot;
  const players = [];
  for (let index = 0; index < document.players.length; index += 1) {
    players.push(
      await validatePlayer(
        document.players[index],
        index,
        resolvedRoot,
        checkPaths,
      ),
    );
  }
  const names = new Set(players.map((player) => player.name));
  if (names.size !== players.length) {
    throw new Error("player names must be unique");
  }
  if (
    document.game_config.num_agents !== undefined &&
    document.game_config.num_agents !== players.length
  ) {
    throw new Error("game_config.num_agents must equal the player count");
  }
  if (checkPaths) {
    for (const [label, candidate] of [
      ["game root", gameRoot],
      ["ProxyWar repo", proxyWarRepo],
    ]) {
      const info = await stat(candidate).catch(() => null);
      if (!info?.isDirectory()) {
        throw new Error(`${label} does not exist: ${candidate}`);
      }
    }
    const nodeInfo = await stat(nodeExecutable).catch(() => null);
    if (!nodeInfo?.isFile()) {
      throw new Error(`bundled Node executable does not exist: ${nodeExecutable}`);
    }
  }
  return {
    schemaVersion: 1,
    bundleRoot: resolvedRoot,
    gameRoot: path.resolve(gameRoot),
    proxyWarRepo: path.resolve(proxyWarRepo),
    nodeExecutable: path.resolve(nodeExecutable),
    gameConfig: {
      ...document.game_config,
      episode_timeout_seconds: episodeTimeout,
      player_connect_timeout_seconds: connectTimeout,
      num_agents: players.length,
    },
    players,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalHash(value) {
  return createHash("sha256")
    .update(`${JSON.stringify(canonicalize(value))}\n`)
    .digest("hex");
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fsSync.createReadStream(filePath)) {
    hash.update(chunk);
  }
  const info = await stat(filePath);
  return {
    sha256: hash.digest("hex"),
    bytes: info.size,
  };
}

export async function verifyRuntimeFingerprint(
  { gameRoot, proxyWarRepo, nodeExecutable = process.execPath },
  expectedFiles = RUNTIME_FINGERPRINT_FILES,
) {
  const roots = {
    game: await realpath(gameRoot),
    proxywar: await realpath(proxyWarRepo),
    node: await realpath(path.dirname(nodeExecutable)),
  };
  const verified = [];
  for (const expected of expectedFiles) {
    if (
      !isPlainObject(expected) ||
      !Object.hasOwn(roots, expected.root) ||
      typeof expected.path !== "string" ||
      path.isAbsolute(expected.path) ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    ) {
      throw new Error("runtime fingerprint definition is invalid");
    }
    const root = roots[expected.root];
    const lexicalPath = path.resolve(root, expected.path);
    if (!isInside(lexicalPath, root)) {
      throw new Error(`runtime fingerprint path escapes its root: ${expected.path}`);
    }
    const resolvedPath = await realpath(lexicalPath).catch(() => null);
    if (!resolvedPath || !isInside(resolvedPath, root)) {
      throw new Error(`runtime fingerprint path is missing or escaped: ${expected.path}`);
    }
    const info = await stat(resolvedPath);
    if (!info.isFile()) {
      throw new Error(`runtime fingerprint path is not a file: ${expected.path}`);
    }
    const actual = await hashFile(resolvedPath);
    if (actual.sha256 !== expected.sha256) {
      throw new Error(
        `runtime fingerprint mismatch: ${expected.root}/${expected.path}`,
      );
    }
    verified.push({
      root: expected.root,
      path: expected.path,
      sha256: actual.sha256,
      bytes: actual.bytes,
    });
  }
  return {
    status: "verified",
    base_image: BASE_IMAGE,
    fingerprint_sha256: canonicalHash(
      verified.map(({ root, path: filePath, sha256 }) => ({
        root,
        path: filePath,
        sha256,
      })),
    ),
    files: verified,
  };
}

export function validateEpisodeResults(results, validated) {
  if (!isPlainObject(results)) {
    throw new Error("results must be an object");
  }
  if (results.seed !== validated.gameConfig.seed) {
    throw new Error(
      `results seed mismatch: expected ${validated.gameConfig.seed}, got ${results.seed}`,
    );
  }
  if (typeof results.game_id !== "string" || results.game_id.trim() === "") {
    throw new Error("results.game_id must be a non-empty string");
  }
  if (
    results.winner_slot !== null &&
    (!Number.isInteger(results.winner_slot) ||
      results.winner_slot < 0 ||
      results.winner_slot >= validated.players.length)
  ) {
    throw new Error("results.winner_slot must be null or a valid player slot");
  }
  const counters = [
    "turn_count",
    "tick",
    "decision_count",
    "accepted_decision_count",
    "fallback_count",
    "degraded_count",
  ];
  for (const field of counters) {
    if (!Number.isInteger(results[field]) || results[field] < 0) {
      throw new Error(`results.${field} must be a non-negative integer`);
    }
  }
  if (results.accepted_decision_count > results.decision_count) {
    throw new Error(
      "results.accepted_decision_count cannot exceed decision_count",
    );
  }
  for (const field of ["fallback_count", "degraded_count"]) {
    if (results[field] > results.decision_count) {
      throw new Error(`results.${field} cannot exceed decision_count`);
    }
  }
  if (
    !Array.isArray(results.scores) ||
    results.scores.length !== validated.players.length ||
    results.scores.some((score) => !Number.isFinite(score))
  ) {
    throw new Error(
      "results.scores must contain one finite numeric score per player",
    );
  }
  if (
    !Array.isArray(results.players) ||
    results.players.length !== validated.players.length
  ) {
    throw new Error("results.players must match the run-spec player count");
  }
  for (let slot = 0; slot < validated.players.length; slot += 1) {
    const actual = results.players[slot];
    const expected = validated.players[slot];
    if (
      !isPlainObject(actual) ||
      actual.slot !== slot ||
      actual.name !== expected.name
    ) {
      throw new Error(`results player identity/order mismatch at slot ${slot}`);
    }
    if (
      !Number.isFinite(actual.score) ||
      actual.score !== results.scores[slot]
    ) {
      throw new Error(`results player score mismatch at slot ${slot}`);
    }
  }
  return {
    game_id: results.game_id,
    seed: results.seed,
    winner_slot: results.winner_slot,
    turn_count: results.turn_count,
    tick: results.tick,
    decision_count: results.decision_count,
    accepted_decision_count: results.accepted_decision_count,
    fallback_count: results.fallback_count,
    degraded_count: results.degraded_count,
    scores: results.scores,
    players: results.players,
  };
}

function parseSingleHash(body, expectedName) {
  const match = body.trim().match(/^([a-f0-9]{64})  (.+)$/);
  if (!match || match[2] !== expectedName) {
    throw new Error(`invalid SHA-256 receipt for ${expectedName}`);
  }
  return match[1];
}

function parseFileManifest(body) {
  const entries = new Map();
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || entries.has(match[2])) {
      throw new Error("files.sha256 contains an invalid or duplicate entry");
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

function parseLinkManifest(body) {
  const entries = new Map();
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    if (firstTab !== 64 || secondTab < 66) {
      throw new Error("links.tsv contains an invalid entry");
    }
    const digest = line.slice(0, firstTab);
    const relative = line.slice(firstTab + 1, secondTab);
    const target = line.slice(secondTab + 1);
    if (!/^[a-f0-9]{64}$/.test(digest) || entries.has(relative)) {
      throw new Error("links.tsv contains an invalid or duplicate entry");
    }
    entries.set(relative, { digest, target });
  }
  return entries;
}

async function walkBundleEntries(root, relative = "") {
  const current = path.join(root, relative);
  const children = await readdir(current, { withFileTypes: true });
  const entries = [];
  for (const child of children.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = path.join(relative, child.name);
    if (child.isDirectory()) {
      entries.push(...(await walkBundleEntries(root, childRelative)));
    } else if (child.isFile()) {
      entries.push({ type: "file", relative: childRelative });
    } else if (child.isSymbolicLink()) {
      entries.push({ type: "symlink", relative: childRelative });
    } else {
      throw new Error(`unsupported bundle entry type: ${childRelative}`);
    }
  }
  return entries;
}

export async function verifyBundleManifest(
  bundleRoot,
  players,
  { orchestratorPath = SCRIPT_PATH } = {},
) {
  const root = await realpath(bundleRoot);
  const manifestPath = path.join(root, "manifest.json");
  const manifestReceiptPath = path.join(root, "manifest.sha256");
  const fileManifestPath = path.join(root, "files.sha256");
  const linkManifestPath = path.join(root, "links.tsv");
  const [
    manifestBody,
    manifestReceiptBody,
    fileManifestBody,
    linkManifestBody,
  ] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(manifestReceiptPath, "utf8"),
    readFile(fileManifestPath, "utf8"),
    readFile(linkManifestPath, "utf8"),
  ]);
  const manifestSha256 = (await hashFile(manifestPath)).sha256;
  if (
    parseSingleHash(manifestReceiptBody, "manifest.json") !== manifestSha256
  ) {
    throw new Error("manifest.json does not match manifest.sha256");
  }
  const manifest = JSON.parse(manifestBody);
  if (
    manifest.schema_version !== 1 ||
    manifest.base_image !== BASE_IMAGE ||
    manifest.contains_credentials !== false ||
    manifest.invokes_runpod_api !== false ||
    manifest.runtime?.mode !== "self_contained_bundle" ||
    manifest.runtime?.source_base_image !== BASE_IMAGE ||
    manifest.runtime?.architecture !== "amd64" ||
    manifest.runtime?.node_version !== "24.18.0" ||
    manifest.runtime?.node_sha256 !==
      "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c" ||
    JSON.stringify(manifest.runtime?.bundle_roots) !==
      JSON.stringify([
        "runtime/integration",
        "runtime/proxywar",
        "runtime/node",
      ])
  ) {
    throw new Error("bundle manifest identity or credential boundary is invalid");
  }
  const filesSha256 = (await hashFile(fileManifestPath)).sha256;
  const linksSha256 = (await hashFile(linkManifestPath)).sha256;
  if (
    filesSha256 !== manifest.file_manifest?.sha256 ||
    linksSha256 !== manifest.symlink_manifest?.sha256
  ) {
    throw new Error("bundle file/link manifest hash mismatch");
  }
  const orchestratorSha256 = (await hashFile(orchestratorPath)).sha256;
  if (orchestratorSha256 !== manifest.orchestrator_sha256) {
    throw new Error("orchestrator does not match the bundle manifest");
  }
  const fileEntries = parseFileManifest(fileManifestBody);
  const linkEntries = parseLinkManifest(linkManifestBody);
  const requiredSourceFiles = new Set([
    "scripts/prepare-runpod-proxywar-bundle.sh",
    "scripts/runpod-proxywar-episode.mjs",
    "scripts/extract_runpod_proxywar_bundle.py",
    "test/runpod-proxywar-episode.test.mjs",
    "test/test_extract_runpod_proxywar_bundle.py",
  ]);
  const sourceFileEntries = Object.entries(manifest.source?.files ?? {});
  if (
    !/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? "") ||
    !/^[a-f0-9]{40}$/.test(manifest.source?.formal_specs_commit ?? "") ||
    sourceFileEntries.length < requiredSourceFiles.size ||
    sourceFileEntries.some(
      ([sourcePath, digest]) =>
        !/^[a-zA-Z0-9._/-]+$/.test(sourcePath) ||
        path.posix.isAbsolute(sourcePath) ||
        sourcePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
        !/^[a-f0-9]{64}$/.test(digest),
    ) ||
    [...requiredSourceFiles].some(
      (sourcePath) => !Object.hasOwn(manifest.source.files, sourcePath),
    ) ||
    manifest.source.files["scripts/runpod-proxywar-episode.mjs"] !==
      manifest.orchestrator_sha256 ||
    manifest.source.files["scripts/extract_runpod_proxywar_bundle.py"] !==
      fileEntries.get("bin/extract_runpod_proxywar_bundle.py")
  ) {
    throw new Error("bundle source provenance is invalid");
  }
  if (
    manifest.file_manifest?.file_count !== fileEntries.size ||
    manifest.symlink_manifest?.symlink_count !== linkEntries.size
  ) {
    throw new Error("bundle manifest entry count mismatch");
  }
  if (
    !Array.isArray(manifest.experiment_specs) ||
    manifest.experiment_specs.length < 2 ||
    manifest.experiment_specs.length > 128
  ) {
    throw new Error("bundle must declare at least one matched experiment pair");
  }
  const seenSpecLabels = new Set();
  const seenSpecPaths = new Set();
  const seenSpecRoles = new Set();
  const formalHorizons = new Set();
  for (const spec of manifest.experiment_specs) {
    if (
      !isPlainObject(spec) ||
      typeof spec.label !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(spec.label) ||
      seenSpecLabels.has(spec.label) ||
      (spec.role !== "candidate" && spec.role !== "exact-parent") ||
      typeof spec.path !== "string" ||
      !/^specs\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/.test(spec.path) ||
      path.posix.isAbsolute(spec.path) ||
      spec.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      seenSpecPaths.has(spec.path) ||
      !/^[a-f0-9]{64}$/.test(spec.sha256) ||
      !Number.isInteger(spec.max_decision_steps) ||
      spec.max_decision_steps < 1 ||
      spec.max_decision_steps > 600 ||
      fileEntries.get(spec.path) !== spec.sha256
    ) {
      throw new Error("formal matched experiment spec identity is invalid");
    }
    let specDocument;
    try {
      specDocument = JSON.parse(await readFile(path.join(root, spec.path), "utf8"));
    } catch {
      throw new Error("formal matched experiment spec is not valid JSON");
    }
    if (
      specDocument?.game_config?.max_decision_steps !==
      spec.max_decision_steps
    ) {
      throw new Error(
        "formal matched experiment horizon disagrees with its spec",
      );
    }
    seenSpecLabels.add(spec.label);
    seenSpecPaths.add(spec.path);
    seenSpecRoles.add(spec.role);
    formalHorizons.add(spec.max_decision_steps);
  }
  if (!seenSpecRoles.has("candidate") || !seenSpecRoles.has("exact-parent")) {
    throw new Error("formal matched experiment roles are incomplete");
  }
  if (formalHorizons.size !== 1) {
    throw new Error("formal matched experiment horizons differ");
  }
  if (
    !Array.isArray(manifest.transport_canaries) ||
    manifest.transport_canaries.length !== 2
  ) {
    throw new Error("bundle must declare the exact transport canary pair");
  }
  const expectedCanaries = new Map([
    [
      "transport-canary-candidate",
      {
        role: "candidate",
        path: "specs/canary-candidate-player-specs.json",
      },
    ],
    [
      "transport-canary-control",
      {
        role: "exact-parent",
        path: "specs/canary-control-player-specs.json",
      },
    ],
  ]);
  const seenCanaryLabels = new Set();
  for (const spec of manifest.transport_canaries) {
    const expected = expectedCanaries.get(spec?.label);
    if (
      !isPlainObject(spec) ||
      !expected ||
      seenCanaryLabels.has(spec.label) ||
      expected.role !== spec.role ||
      expected.path !== spec.path ||
      !/^[a-f0-9]{64}$/.test(spec.sha256) ||
      fileEntries.get(spec.path) !== spec.sha256
    ) {
      throw new Error("transport canary spec identity is invalid");
    }
    seenCanaryLabels.add(spec.label);
  }
  if (seenCanaryLabels.size !== expectedCanaries.size) {
    throw new Error("transport canary pair is incomplete");
  }
  const selectedRoots = new Set([...manifest.runtime.bundle_roots, "specs"]);
  const selectedPolicies = [];
  for (const player of players) {
    const policy = manifest.policies?.find(
      (candidate) => candidate.key === player.policy,
    );
    if (!policy) {
      throw new Error(`policy ${player.policy} is absent from manifest.json`);
    }
    if (
      policy.bundle_root !== player.cwdRelative.split(path.sep).join("/") ||
      JSON.stringify(policy.run) !== JSON.stringify(player.run) ||
      typeof policy.image_id !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(policy.image_id) ||
      policy.architecture !== "amd64"
    ) {
      throw new Error(`policy ${player.policy} does not match manifest.json`);
    }
    selectedRoots.add(policy.bundle_root);
    selectedPolicies.push({
      key: policy.key,
      image_id: policy.image_id,
      architecture: policy.architecture,
      bundle_root: policy.bundle_root,
      run: policy.run,
    });
  }
  const verifiedFiles = new Set();
  const verifiedLinks = new Set();
  for (const selectedRoot of selectedRoots) {
    const absoluteRoot = path.join(root, selectedRoot);
    const actualEntries = await walkBundleEntries(absoluteRoot);
    for (const entry of actualEntries) {
      const relative = path.posix.join(
        selectedRoot,
        entry.relative.split(path.sep).join("/"),
      );
      if (entry.type === "file") {
        const expected = fileEntries.get(relative);
        if (!expected) {
          throw new Error(`unmanifested policy file: ${relative}`);
        }
        const actual = (await hashFile(path.join(root, relative))).sha256;
        if (actual !== expected) {
          throw new Error(`policy file hash mismatch: ${relative}`);
        }
        verifiedFiles.add(relative);
      } else {
        const expected = linkEntries.get(relative);
        if (!expected) {
          throw new Error(`unmanifested policy symlink: ${relative}`);
        }
        const target = await readlink(path.join(root, relative));
        const resolvedTarget = path.resolve(
          path.dirname(path.join(root, relative)),
          target,
        );
        if (!isInside(resolvedTarget, root)) {
          throw new Error(`bundle symlink escapes the bundle root: ${relative}`);
        }
        const digest = createHash("sha256")
          .update(`symlink\0${target}`)
          .digest("hex");
        if (target !== expected.target || digest !== expected.digest) {
          throw new Error(`policy symlink mismatch: ${relative}`);
        }
        verifiedLinks.add(relative);
      }
    }
    const prefix = `${selectedRoot}/`;
    for (const relative of fileEntries.keys()) {
      if (relative.startsWith(prefix) && !verifiedFiles.has(relative)) {
        throw new Error(`manifested policy file is missing: ${relative}`);
      }
    }
    for (const relative of linkEntries.keys()) {
      if (relative.startsWith(prefix) && !verifiedLinks.has(relative)) {
        throw new Error(`manifested policy symlink is missing: ${relative}`);
      }
    }
  }
  return {
    status: "verified",
    manifest_sha256: manifestSha256,
    files_sha256: filesSha256,
    links_sha256: linksSha256,
    orchestrator_sha256: orchestratorSha256,
    selected_file_count: verifiedFiles.size,
    selected_symlink_count: verifiedLinks.size,
    source: {
      commit: manifest.source.commit,
      formal_specs_commit: manifest.source.formal_specs_commit,
      files: { ...manifest.source.files },
    },
    experiment_specs: manifest.experiment_specs.map((spec) => ({ ...spec })),
    transport_canaries: manifest.transport_canaries.map((spec) => ({ ...spec })),
    policies: selectedPolicies,
  };
}

export async function bindRunSpec(
  specPath,
  bundleRoot,
  rawSha256,
  bundleVerification,
  { transportCanary = false } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(rawSha256)) {
    throw new Error("run spec raw SHA-256 is invalid");
  }
  const lexicalRoot = path.resolve(bundleRoot);
  const root = await realpath(lexicalRoot);
  const lexicalPath = path.resolve(specPath);
  const resolvedSpecPath = await realpath(lexicalPath);
  const lexicalInside = isInside(lexicalPath, lexicalRoot);
  const resolvedInside = isInside(resolvedSpecPath, root);
  if (lexicalInside && !resolvedInside) {
    throw new Error("run spec symlink escapes the bundle root");
  }
  const relative = resolvedInside
    ? path.relative(root, resolvedSpecPath).split(path.sep).join("/")
    : null;
  const formal = bundleVerification.experiment_specs?.find(
    (spec) => spec.path === relative,
  );
  const canary = bundleVerification.transport_canaries?.find(
    (spec) => spec.path === relative,
  );
  if (formal && formal.sha256 !== rawSha256) {
    throw new Error(
      `formal run spec does not match manifest.json: ${formal.label}`,
    );
  }
  if (relative?.startsWith("specs/") && relative?.endsWith(".json") && !formal && !canary) {
    throw new Error("undeclared bundled run spec");
  }
  if (formal && transportCanary) {
    throw new Error(
      "--transport-canary cannot be used with a formal experiment spec",
    );
  }
  if (canary && canary.sha256 !== rawSha256) {
    throw new Error(
      `transport canary does not match manifest.json: ${canary.label}`,
    );
  }
  if (canary && !transportCanary) {
    throw new Error(
      "transport canary requires the explicit --transport-canary mode",
    );
  }
  if (!formal && !canary) {
    throw new Error("external or undeclared run specs are forbidden");
  }
  const declared = formal ?? canary;
  return {
    location: "bundle",
    relative_path: relative,
    sha256: rawSha256,
    manifest_label: declared.label,
    manifest_role: declared.role,
    execution_class: formal ? "formal_evaluation" : "transport_canary",
  };
}

function publicPlan(validated) {
  return {
    schema_version: validated.schemaVersion,
    base_image: BASE_IMAGE,
    game_config: { ...validated.gameConfig },
    players: validated.players.map((player, slot) => ({
      slot,
      name: player.name,
      policy: player.policy,
      cwd: player.cwdRelative,
      run: player.run,
      env: Object.fromEntries(
        Object.entries(player.env).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    })),
  };
}

function baseChildEnv(tempDir) {
  return {
    PATH:
      process.env.PATH ??
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    // Deliberately isolate HOME and the AWS provider chain. A RunPod control
    // credential or a developer's shared AWS profile must never enter a policy
    // subprocess merely because it exists in the parent container.
    HOME: tempDir,
    TMPDIR: tempDir,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TZ: process.env.TZ ?? "UTC",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_SHARED_CREDENTIALS_FILE: path.join(tempDir, "no-aws-credentials"),
    AWS_CONFIG_FILE: path.join(tempDir, "no-aws-config"),
  };
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("failed to allocate a loopback port");
  return port;
}

function spawnLogged({ label, command, args, cwd, env, rawLogDir }) {
  const stdoutPath = path.join(rawLogDir, `${label}.stdout.log`);
  const stderrPath = path.join(rawLogDir, `${label}.stderr.log`);
  const stdout = fsSync.createWriteStream(stdoutPath, {
    flags: "wx",
    mode: 0o600,
  });
  const stderr = fsSync.createWriteStream(stderrPath, {
    flags: "wx",
    mode: 0o600,
  });
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const exit = new Promise((resolve) => {
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        error: spawnError?.message ?? null,
      });
    });
  });
  return {
    label,
    child,
    exit,
    stdoutPath,
    stderrPath,
  };
}

async function terminateProcess(processRecord, graceMs = 3000) {
  if (!processRecord || processRecord.child.exitCode !== null) return;
  const pid = processRecord.child.pid;
  const signal = (name) => {
    try {
      if (pid && process.platform !== "win32") process.kill(-pid, name);
      else processRecord.child.kill(name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const exited = await Promise.race([
    processRecord.exit.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (!exited) {
    signal("SIGKILL");
    await processRecord.exit;
  }
}

async function waitForHealth(port, gameProcess, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gameProcess.child.exitCode !== null) {
      const outcome = await gameProcess.exit;
      throw new Error(
        `game runner exited before health check: code=${outcome.code} signal=${outcome.signal}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The game imports the engine before binding. Retry inside the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`game runner did not become healthy on port ${port}`);
}

function timeoutAfter(ms, label) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout", label }), ms);
  });
  return {
    promise,
    clear: () => clearTimeout(timer),
  };
}

export async function classifyEarlyPlayerExit(
  label,
  outcome,
  isGameCompleted,
  graceMs = 1000,
) {
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  return isGameCompleted()
    ? null
    : {
        kind: "player-exit",
        label,
        outcome,
      };
}

export function forceFailureStatus(status, failure, receivedSignal) {
  return failure !== null || receivedSignal !== null ? "failed" : status;
}

export function redactSecrets(value, secrets) {
  let redacted = String(value);
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(
    /(\/player\?slot=\d+&token=)[^&\s"']+/g,
    "$1[REDACTED]",
  );
}

async function sanitizeLogs(rawLogDir, finalLogDir, secrets) {
  await mkdir(finalLogDir, { recursive: true, mode: 0o700 });
  const entries = await readdir(rawLogDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(rawLogDir, entry.name);
    const target = path.join(finalLogDir, entry.name);
    const body = await readFile(source, "utf8");
    await writeFile(target, redactSecrets(body, secrets), {
      mode: 0o600,
    });
  }
}

async function walkFiles(root, relative = "") {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = path.join(relative, entry.name);
    if (childRelative === "receipt.json" || childRelative.startsWith(".private")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, childRelative)));
    } else if (entry.isFile()) {
      files.push(childRelative);
    }
  }
  return files;
}

async function artifactHashes(outputDir) {
  const files = await walkFiles(outputDir);
  const result = [];
  for (const relative of files) {
    result.push({
      path: relative.split(path.sep).join("/"),
      ...(await hashFile(path.join(outputDir, relative))),
    });
  }
  return result;
}

async function assertSecretsAbsent(outputDir, secrets) {
  const secretBuffers = secrets
    .filter(Boolean)
    .map((secret) => Buffer.from(secret));
  const overlap = Math.max(0, ...secretBuffers.map((secret) => secret.length - 1));
  const files = await walkFiles(outputDir);
  for (const relative of files) {
    let carry = Buffer.alloc(0);
    for await (const chunk of fsSync.createReadStream(path.join(outputDir, relative))) {
      const combined =
        carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      for (const secret of secretBuffers) {
        if (combined.includes(secret)) {
          throw new Error(
            `ephemeral player token leaked into output artifact ${relative}`,
          );
        }
      }
      carry =
        overlap === 0
          ? Buffer.alloc(0)
          : combined.subarray(Math.max(0, combined.length - overlap));
    }
  }
}

async function createNewOutputDir(outputDir) {
  await mkdir(path.dirname(outputDir), { recursive: true, mode: 0o700 });
  try {
    await mkdir(outputDir, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`output directory already exists: ${outputDir}`);
    }
    throw error;
  }
  await chmod(outputDir, 0o700);
}

export function assertAttestationStable(label, before, after) {
  if (canonicalHash(before) !== canonicalHash(after)) {
    throw new Error(`${label} changed during episode execution`);
  }
}

async function reattestAfterEpisode(
  validated,
  bundleVerification,
  runtimeFingerprint,
  runSpec,
) {
  const postBundleVerification = await verifyBundleManifest(
    validated.bundleRoot,
    validated.players,
  );
  const postRuntimeFingerprint = await verifyRuntimeFingerprint({
    gameRoot: validated.gameRoot,
    proxyWarRepo: validated.proxyWarRepo,
    nodeExecutable: validated.nodeExecutable,
  });
  const specPath = path.join(validated.bundleRoot, runSpec.relative_path);
  const postSpecSha256 = (await hashFile(specPath)).sha256;
  const postRunSpec = await bindRunSpec(
    specPath,
    validated.bundleRoot,
    postSpecSha256,
    postBundleVerification,
    { transportCanary: runSpec.execution_class === "transport_canary" },
  );
  assertAttestationStable(
    "bundle verification",
    bundleVerification,
    postBundleVerification,
  );
  assertAttestationStable(
    "runtime fingerprint",
    runtimeFingerprint,
    postRuntimeFingerprint,
  );
  assertAttestationStable("run spec", runSpec, postRunSpec);
  return {
    status: "stable",
    bundle_verification: postBundleVerification,
    runtime_fingerprint: postRuntimeFingerprint,
    run_spec: postRunSpec,
  };
}

async function runEpisode(
  options,
  validated,
  bundleVerification,
  runtimeFingerprint,
  runSpec,
) {
  const runID =
    options.runID ??
    `runpod-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()
      .replace(/-/g, "")
      .slice(0, 8)}`;
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(runID)) {
    throw new Error("--run-id contains unsupported characters");
  }
  const volumeRoot = process.env.RUNPOD_VOLUME_PATH ?? "/workspace";
  const outputDir = path.resolve(
    options.outputDir ??
      path.join(volumeRoot, "proxywar-episodes", runID),
  );
  await createNewOutputDir(outputDir);
  const privateDir = path.join(outputDir, ".private");
  const rawLogDir = path.join(privateDir, "raw-logs");
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const tempDir = await mkdtemp(path.join(privateDir, "tmp-"));
  await mkdir(rawLogDir, { recursive: true, mode: 0o700 });

  const tokens = validated.players.map(() => randomBytes(24).toString("base64url"));
  const gameConfig = {
    ...validated.gameConfig,
    tokens,
    players: validated.players.map((player) => ({ name: player.name })),
  };
  const gameConfigPath = path.join(privateDir, "game-config.json");
  const resultsPath = path.join(outputDir, "results.json");
  const replayPath = path.join(outputDir, "replay");
  await writeFile(gameConfigPath, `${JSON.stringify(gameConfig, null, 2)}\n`, {
    mode: 0o600,
  });

  const port = options.port || (await unusedLoopbackPort());
  const childBase = baseChildEnv(tempDir);
  const processRecords = [];
  const processOutcomes = {};
  let status = "failed";
  let failure = null;
  let resultsSummary = null;
  let primaryArtifactHashes = null;
  let resolveSignalAbort;
  const signalAbort = new Promise((resolve) => {
    resolveSignalAbort = resolve;
  });
  let receivedSignal = null;
  const startedAt = new Date();
  const onSignal = async (signal) => {
    if (receivedSignal !== null) return;
    receivedSignal = signal;
    failure = new Error(`orchestrator received ${signal}`);
    status = "failed";
    resolveSignalAbort({ kind: "signal", signal });
    for (const record of processRecords.toReversed()) {
      await terminateProcess(record).catch(() => undefined);
    }
  };
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => void onSignal(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    const game = spawnLogged({
      label: "game",
      command: validated.nodeExecutable,
      args: [
        "--max-old-space-size=640",
        "--import",
        "tsx/esm",
        path.join(validated.gameRoot, "src", "no-docker-coworld-episode.ts"),
      ],
      // The extracted pinned runtime installs tsx below the bundled ProxyWar
      // node_modules tree. Preserve that resolution contract while executing
      // the bundled integration script by path.
      cwd: validated.proxyWarRepo,
      env: {
        ...childBase,
        GAME_ENV: "dev",
        HUSKY: "0",
        PROXYWAR_REPO: validated.proxyWarRepo,
        COGAME_CONFIG_URI: pathToFileURL(gameConfigPath).href,
        COGAME_RESULTS_URI: pathToFileURL(resultsPath).href,
        COGAME_SAVE_REPLAY_URI: pathToFileURL(replayPath).href,
        COGAME_HOST: "127.0.0.1",
        COGAME_PORT: String(port),
        COWORLD_POSTGAME_SERVER_MS: "100",
      },
      rawLogDir,
    });
    processRecords.push(game);
    await waitForHealth(
      port,
      game,
      options.startupTimeoutSeconds * 1000,
    );

    const players = validated.players.map((player, slot) => {
      const command =
        path.basename(player.run[0]) === "node"
          ? validated.nodeExecutable
          : player.run[0];
      const record = spawnLogged({
        label: `player-${String(slot).padStart(2, "0")}-${player.policy}`,
        command,
        args: player.run.slice(1),
        cwd: player.cwd,
        env: {
          ...childBase,
          ...player.env,
          PROXYWAR_REPO: validated.proxyWarRepo,
          COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}/player?slot=${slot}&token=${encodeURIComponent(
            tokens[slot],
          )}`,
        },
        rawLogDir,
      });
      processRecords.push(record);
      return record;
    });

    const episodeTimer = timeoutAfter(
      (validated.gameConfig.episode_timeout_seconds +
        validated.gameConfig.player_connect_timeout_seconds +
        30) *
        1000,
      "episode",
    );
    let gameCompleted = false;
    const gameCompletion = game.exit.then((outcome) => {
      gameCompleted = true;
      return { kind: "game-exit", outcome };
    });
    const earlyPlayerExits = players.map((player) =>
      player.exit.then(async (outcome) => {
        const earlyExit = await classifyEarlyPlayerExit(
          player.label,
          outcome,
          () => gameCompleted,
        );
        return earlyExit ?? new Promise(() => undefined);
      }),
    );
    const completion = await Promise.race([
      gameCompletion,
      episodeTimer.promise,
      signalAbort,
      ...earlyPlayerExits,
    ]);
    episodeTimer.clear();
    if (completion.kind === "timeout") {
      throw new Error("episode exceeded its orchestrator wall-clock budget");
    }
    if (completion.kind === "signal") {
      throw new Error(`episode aborted by ${completion.signal}`);
    }
    if (completion.kind === "player-exit") {
      throw new Error(
        `${completion.label} exited before the game: code=${completion.outcome.code} signal=${completion.outcome.signal}`,
      );
    }
    processOutcomes[game.label] = completion.outcome;
    if (completion.outcome.code !== 0) {
      throw new Error(
        `game runner failed: code=${completion.outcome.code} signal=${completion.outcome.signal}`,
      );
    }

    const shutdownTimer = timeoutAfter(
      options.shutdownTimeoutSeconds * 1000,
      "player shutdown",
    );
    const playerCompletion = await Promise.race([
      Promise.all(players.map((player) => player.exit)),
      shutdownTimer.promise,
    ]);
    shutdownTimer.clear();
    if (!Array.isArray(playerCompletion)) {
      throw new Error("players did not exit after the game sent final");
    }
    for (let slot = 0; slot < playerCompletion.length; slot += 1) {
      processOutcomes[players[slot].label] = playerCompletion[slot];
      if (playerCompletion[slot].code !== 0) {
        throw new Error(
          `player ${slot} failed: code=${playerCompletion[slot].code} signal=${playerCompletion[slot].signal}`,
        );
      }
    }
    await access(resultsPath, fsSync.constants.R_OK);
    await access(replayPath, fsSync.constants.R_OK);
    const results = JSON.parse(await readFile(resultsPath, "utf8"));
    resultsSummary = validateEpisodeResults(results, validated);
    const [resultsArtifact, replayArtifact] = await Promise.all([
      hashFile(resultsPath),
      hashFile(replayPath),
    ]);
    if (resultsArtifact.bytes === 0 || replayArtifact.bytes === 0) {
      throw new Error("results or replay artifact is empty");
    }
    primaryArtifactHashes = {
      "results.json": resultsArtifact,
      replay: replayArtifact,
    };
    if (failure !== null) throw failure;
    status = "passed";
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    for (const record of processRecords.toReversed()) {
      await terminateProcess(record).catch(() => undefined);
      if (!(record.label in processOutcomes)) {
        processOutcomes[record.label] = await record.exit;
      }
    }
    await sanitizeLogs(rawLogDir, path.join(outputDir, "logs"), tokens).catch(
      (error) => {
        failure ??= error;
        status = "failed";
      },
    );
    await rm(privateDir, { recursive: true, force: true });
  }

  status = forceFailureStatus(status, failure, receivedSignal);
  let postRunAttestation;
  try {
    postRunAttestation = await reattestAfterEpisode(
      validated,
      bundleVerification,
      runtimeFingerprint,
      runSpec,
    );
  } catch (error) {
    const attestationError =
      error instanceof Error ? error : new Error(String(error));
    failure ??= attestationError;
    status = "failed";
    postRunAttestation = {
      status: "failed",
      error: attestationError.message,
    };
  }
  status = forceFailureStatus(status, failure, receivedSignal);
  await assertSecretsAbsent(outputDir, tokens);
  const artifacts = await artifactHashes(outputDir);
  if (primaryArtifactHashes !== null) {
    for (const [relative, expected] of Object.entries(primaryArtifactHashes)) {
      const actual = artifacts.find((artifact) => artifact.path === relative);
      if (
        !actual ||
        actual.sha256 !== expected.sha256 ||
        actual.bytes !== expected.bytes
      ) {
        throw new Error(`primary artifact changed before receipt: ${relative}`);
      }
    }
  }
  const finishedAt = new Date();
  const plan = publicPlan(validated);
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
  const receipt = {
    schema_version: 1,
    run_id: runID,
    status,
    receipt_scope: "transport_and_artifact_integrity_only",
    evaluation_verdict: "not_evaluated",
    execution_class: runSpec.execution_class,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    base_image: BASE_IMAGE,
    runtime_fingerprint: runtimeFingerprint,
    bundle_verification: bundleVerification,
    post_run_attestation: postRunAttestation,
    run_spec: runSpec,
    orchestrator_sha256: (await hashFile(SCRIPT_PATH)).sha256,
    input_sha256: canonicalHash(plan),
    port,
    plan,
    process_outcomes: processOutcomes,
    results: resultsSummary,
    primary_artifact_hashes: primaryArtifactHashes,
    error: failure ? redactSecrets(failure.message, tokens) : null,
    artifacts,
  };
  const encodedReceipt = `${JSON.stringify(receipt, null, 2)}\n`;
  for (const token of tokens) {
    if (encodedReceipt.includes(token)) {
      throw new Error("refusing to write a receipt containing a player token");
    }
  }
  await writeFile(path.join(outputDir, "receipt.json"), encodedReceipt, {
    mode: 0o600,
  });
  if (status !== "passed") {
    throw new Error(
      `episode failed; receipt=${path.join(outputDir, "receipt.json")}: ${
        receipt.error ?? "unknown error"
      }`,
    );
  }
  return {
    ok: true,
    run_id: runID,
    output_dir: outputDir,
    receipt: path.join(outputDir, "receipt.json"),
    results: resultsPath,
    replay: replayPath,
    results_sha256: receipt.artifacts.find(
      (artifact) => artifact.path === "results.json",
    )?.sha256,
    replay_sha256: receipt.artifacts.find(
      (artifact) => artifact.path === "replay",
    )?.sha256,
  };
}

async function main() {
  assertSecretFreeControlEnvironment();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const specPath = path.resolve(options.specPath);
  const bundleRoot = path.resolve(
    options.bundleRoot ?? path.dirname(specPath),
  );
  const runtimeRoot = path.join(bundleRoot, "runtime");
  const gameRoot = path.join(runtimeRoot, "integration");
  const proxyWarRepo = path.join(runtimeRoot, "proxywar");
  const nodeExecutable = path.join(runtimeRoot, "node", "bin", "node");
  const specBody = await readFile(specPath);
  const specSha256 = createHash("sha256").update(specBody).digest("hex");
  const document = JSON.parse(specBody.toString("utf8"));
  const validated = await validateRunSpec(document, {
    bundleRoot,
    checkPaths: true,
    gameRoot,
    proxyWarRepo,
    nodeExecutable,
  });
  const bundleVerification = await verifyBundleManifest(
    bundleRoot,
    validated.players,
  );
  const runtimeFingerprint = await verifyRuntimeFingerprint({
    gameRoot: validated.gameRoot,
    proxyWarRepo: validated.proxyWarRepo,
    nodeExecutable: validated.nodeExecutable,
  });
  const runSpec = await bindRunSpec(
    specPath,
    bundleRoot,
    specSha256,
    bundleVerification,
    { transportCanary: options.transportCanary },
  );
  if (options.validateOnly) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          validation: "passed",
          execution_class: runSpec.execution_class,
          input_sha256: canonicalHash(publicPlan(validated)),
          run_spec: runSpec,
          runtime_fingerprint: runtimeFingerprint,
          bundle_verification: bundleVerification,
          plan: publicPlan(validated),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const result = await runEpisode(
    options,
    validated,
    bundleVerification,
    runtimeFingerprint,
    runSpec,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
