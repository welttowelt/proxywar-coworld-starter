#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  HRAFN_COWORLD_GAME_IMAGE_ID,
  HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
} from "./materialize-hrafn-coworld-manifest.mjs";

const execFileAsync = promisify(execFile);

export const HRAFN_INTENT_CAMPAIGN_ID = "hrafn-intent-i1";
export const HRAFN_INTENT_SOURCE_BRANCH = "feature/k1z-hrafn-fylking";
export const HRAFN_INTENT_PLAYER_RUN = Object.freeze([
  "node",
  "/app/hrafn-intent-player.mjs",
]);
export const HRAFN_INTENT_IMAGE_ENTRYPOINT = Object.freeze([
  "docker-entrypoint.sh",
]);
export const HRAFN_INTENT_MODEL = "llama3:latest";
export const HRAFN_INTENT_MODEL_DIGEST =
  "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1";
export const HRAFN_INTENT_OLLAMA_VERSION = "0.32.1";
export const HRAFN_V5_PARENT_IMAGE_ID =
  "sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d";
export const HRAFN_NEUTRAL_OPPONENT_IMAGE_ID =
  "sha256:0e0014ae54354ca2af327f9785c8c22d6a9e4c60390d02776a6fe3235b972b87";
export const HRAFN_V5_OPPONENT_IMAGE_ID = HRAFN_NEUTRAL_OPPONENT_IMAGE_ID;
export const HRAFN_EXACT_V5_PLAYER_RUN = Object.freeze([
  "node",
  "/app/hrafn-player.mjs",
]);
export const HRAFN_NEUTRAL_OPPONENT_RUN = Object.freeze([
  "node",
  "/app/hrafn-neutral-opponent-player.mjs",
]);
export const HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES = Object.freeze([
  "hrafn-neutral-opponent-player.mjs",
  "hrafn-neutral-opponent.mjs",
]);
export const HRAFN_NEUTRAL_OPPONENT_POLICY_FILES = Object.freeze([
  "hrafn-player.mjs",
  "hrafn-strategy.mjs",
  "package-lock.json",
  "package.json",
]);
export const HRAFN_INTENT_IMAGE_FILES = Object.freeze([
  "coworld/cow_236e7c2e-acdb-404a-b1b9-41852e5ac658/coworld_manifest.json",
  "Dockerfile.hrafn-neutral-opponent",
  "Dockerfile.hrafn-intent",
  "experiments/hrafn-intent-i1-preregistration-20260720.json",
  "hrafn-intent-player.mjs",
  "hrafn-intent.mjs",
  ...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
  "hrafn-operational-context.mjs",
  "hrafn-safety.mjs",
  "hrafn-state.mjs",
  "hrafn-strategy.mjs",
  "package-lock.json",
  "package.json",
  "scripts/build-hrafn-intent-job.mjs",
  "scripts/build-hrafn-intent-preflight-spec.mjs",
  "scripts/create-hrafn-intent-image-receipt.mjs",
  "scripts/materialize-hrafn-coworld-manifest.mjs",
  "scripts/preflight-hrafn-intent-run.mjs",
  "scripts/run-hrafn-supervised.mjs",
]);
export const HRAFN_INTENT_CONTAINER_FILES = Object.freeze([
  "hrafn-intent-player.mjs",
  "hrafn-intent.mjs",
  "hrafn-safety.mjs",
  "hrafn-state.mjs",
  "hrafn-strategy.mjs",
  "package-lock.json",
  "package.json",
]);
export const HRAFN_INTENT_RUNTIME_SYNTAX_FILES = Object.freeze(
  HRAFN_INTENT_CONTAINER_FILES
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => `/app/${file}`),
);
export const HRAFN_INTENT_RUNTIME_IMPORTS = Object.freeze([
  "ws",
  "file:///app/hrafn-intent.mjs",
]);

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const FORBIDDEN_IDENTITY = /(?:^|[^a-z0-9])(?:qd1n|odin)(?:$|[^a-z0-9])/i;
const CANONICALIZATION = "sorted-json-v1-excluding-integrity";
const NEUTRAL_PARENT_LABEL = "proxywar.hrafn.neutral.parent-image-id";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return plainObject(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function canonicalJSON(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJSON(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hrafnIntentReceiptContentSHA256(receipt) {
  if (!plainObject(receipt)) return null;
  const content = { ...receipt };
  delete content.integrity;
  return sha256(canonicalJSON(content));
}

function stringResult(result) {
  return Buffer.isBuffer(result) ? result.toString("utf8") : String(result ?? "");
}

async function defaultRun(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: Buffer.from(result.stdout ?? ""),
    stderr: Buffer.from(result.stderr ?? ""),
  };
}

async function git(runtime, repoPath, args) {
  return runtime.run("git", ["-C", repoPath, ...args]);
}

async function gitText(runtime, repoPath, args) {
  const result = await git(runtime, repoPath, args);
  return stringResult(result.stdout).trim();
}

function verifyDockerInspect(raw, requestedReference) {
  let parsed;
  try {
    parsed = JSON.parse(stringResult(raw));
  } catch {
    throw new Error("Docker inspect did not return JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !plainObject(parsed[0])) {
    throw new Error("Docker inspect must resolve exactly one local image");
  }
  const image = parsed[0];
  if (!IMAGE_ID.test(image.Id ?? "")) {
    throw new Error("Docker inspect image ID is not an exact sha256 digest");
  }
  if (image.Os !== "linux" || image.Architecture !== "amd64") {
    throw new Error("HI1 subject image must be linux/amd64");
  }
  if (image.Id === HRAFN_V5_OPPONENT_IMAGE_ID ||
    image.Id === HRAFN_V5_PARENT_IMAGE_ID
  ) {
    throw new Error("HI1 subject image cannot equal an opponent image");
  }
  if (!plainObject(image.Config) || image.Config.WorkingDir !== "/app" ||
    canonicalJSON(image.Config.Entrypoint) !==
      canonicalJSON(HRAFN_INTENT_IMAGE_ENTRYPOINT) ||
    canonicalJSON(image.Config.Cmd) !== canonicalJSON(HRAFN_INTENT_PLAYER_RUN)
  ) {
    throw new Error("HI1 subject image runtime metadata is invalid");
  }
  return {
    requested_reference: requestedReference,
    id: image.Id,
    os: image.Os,
    architecture: image.Architecture,
    working_dir: image.Config.WorkingDir,
    entrypoint: image.Config.Entrypoint,
    cmd: [...image.Config.Cmd],
  };
}

function parseDockerImageInspect(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(stringResult(raw));
  } catch {
    throw new Error(`${label} Docker inspect did not return JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !plainObject(parsed[0])) {
    throw new Error(`${label} Docker inspect must resolve exactly one local image`);
  }
  const image = parsed[0];
  const layers = image?.RootFS?.Layers;
  if (!IMAGE_ID.test(image.Id ?? "") || image.Os !== "linux" ||
    image.Architecture !== "amd64" || !Array.isArray(layers) ||
    layers.length === 0 || layers.some((layer) => !IMAGE_ID.test(layer ?? ""))
  ) {
    throw new Error(`${label} image observation is not exact linux/amd64 evidence`);
  }
  return image;
}

async function observeCoworldGameImage(runtime) {
  const result = await runtime.run("docker", [
    "image",
    "inspect",
    HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(stringResult(result.stdout));
  } catch {
    throw new Error("Coworld game Docker inspect did not return JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !plainObject(parsed[0])) {
    throw new Error("Coworld game Docker inspect must resolve exactly one image");
  }
  const image = parsed[0];
  if (image.Id !== HRAFN_COWORLD_GAME_IMAGE_ID || image.Os !== "linux" ||
    image.Architecture !== "amd64"
  ) {
    throw new Error("Coworld game tag is not the exact pinned linux/amd64 image");
  }
  return {
    reference: HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
    id: image.Id,
    os: image.Os,
    architecture: image.Architecture,
  };
}

async function observeHashes(runtime, imageID, files, label) {
  const sorted = [...files].sort();
  const result = await runtime.run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "/usr/bin/sha256sum",
    imageID,
    ...sorted.map((file) => `/app/${file}`),
  ]);
  const observed = new Map();
  for (const line of stringResult(result.stdout).trim().split("\n")) {
    const match = line.match(/^([a-f0-9]{64})\s+\/app\/(.+)$/);
    if (!match || observed.has(match[2]) || !sorted.includes(match[2])) {
      throw new Error(`${label} file-hash probe returned invalid output`);
    }
    observed.set(match[2], match[1]);
  }
  if (observed.size !== sorted.length) {
    throw new Error(`${label} file-hash probe is incomplete`);
  }
  return sorted.map((file) => ({
    path: `/app/${file}`,
    sha256: observed.get(file),
  }));
}

async function observeContainerFiles(runtime, imageID, committedFiles) {
  const paths = [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) =>
    `/app/${file}`
  );
  const result = await runtime.run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "/usr/bin/sha256sum",
    imageID,
    ...paths,
  ]);
  const observed = new Map();
  for (const line of stringResult(result.stdout).trim().split("\n")) {
    const match = line.match(/^([a-f0-9]{64})\s+\/app\/(.+)$/);
    if (!match || observed.has(match[2])) {
      throw new Error("subject image file-hash probe returned invalid output");
    }
    observed.set(match[2], match[1]);
  }
  const committed = new Map(committedFiles.map((entry) => [entry.path, entry.sha256]));
  const containerFiles = [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) => {
    const digest = observed.get(file);
    if (!digest || digest !== committed.get(file)) {
      throw new Error(`subject image does not contain committed bytes: ${file}`);
    }
    return { path: `/app/${file}`, sha256: digest };
  });
  if (observed.size !== containerFiles.length) {
    throw new Error("subject image file-hash probe returned extra paths");
  }
  return containerFiles;
}

async function observeImageRuntime(runtime, imageID) {
  for (const target of HRAFN_INTENT_RUNTIME_SYNTAX_FILES) {
    await runtime.run("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "node",
      imageID,
      "--check",
      target,
    ]);
  }
  const smokeSource = [
    'const ws = await import("ws");',
    'if (typeof ws.WebSocket !== "function") throw new Error("ws import is invalid");',
    'await import("file:///app/hrafn-intent.mjs");',
    `process.stdout.write(JSON.stringify({node_version:process.version,module_imports:${JSON.stringify(HRAFN_INTENT_RUNTIME_IMPORTS)}})+"\\n");`,
  ].join("");
  const result = await runtime.run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    imageID,
    "--input-type=module",
    "--eval",
    smokeSource,
  ]);
  let observation;
  try {
    observation = JSON.parse(stringResult(result.stdout));
  } catch {
    throw new Error("subject image Node/import smoke did not return JSON");
  }
  if (!exactKeys(observation, ["node_version", "module_imports"]) ||
    !/^v24\.\d+\.\d+$/.test(observation.node_version ?? "") ||
    canonicalJSON(observation.module_imports) !==
      canonicalJSON(HRAFN_INTENT_RUNTIME_IMPORTS)
  ) {
    throw new Error("subject image Node/import smoke is invalid");
  }
  return {
    node_version: observation.node_version,
    syntax_files: [...HRAFN_INTENT_RUNTIME_SYNTAX_FILES],
    module_imports: [...HRAFN_INTENT_RUNTIME_IMPORTS],
  };
}

async function observeNeutralOpponent(runtime, committedFiles) {
  const neutralInspect = await runtime.run("docker", [
    "image",
    "inspect",
    HRAFN_NEUTRAL_OPPONENT_IMAGE_ID,
  ]);
  const parentInspect = await runtime.run("docker", [
    "image",
    "inspect",
    HRAFN_V5_PARENT_IMAGE_ID,
  ]);
  const neutral = parseDockerImageInspect(neutralInspect.stdout, "neutral opponent");
  const parent = parseDockerImageInspect(parentInspect.stdout, "exact-v5 parent");
  const neutralLayers = neutral.RootFS.Layers;
  const parentLayers = parent.RootFS.Layers;
  if (neutral.Id !== HRAFN_NEUTRAL_OPPONENT_IMAGE_ID ||
    parent.Id !== HRAFN_V5_PARENT_IMAGE_ID || neutral.Id === parent.Id
  ) {
    throw new Error("neutral opponent or exact-v5 parent image ID drifted");
  }
  if (neutral.Config?.WorkingDir !== "/app" ||
    canonicalJSON(neutral.Config?.Entrypoint) !==
      canonicalJSON(HRAFN_INTENT_IMAGE_ENTRYPOINT) ||
    canonicalJSON(neutral.Config?.Cmd) !==
      canonicalJSON(HRAFN_NEUTRAL_OPPONENT_RUN) ||
    neutral.Config?.Labels?.[NEUTRAL_PARENT_LABEL] !== HRAFN_V5_PARENT_IMAGE_ID
  ) {
    throw new Error("neutral opponent runtime metadata is invalid");
  }
  if (neutralLayers.length <= parentLayers.length ||
    canonicalJSON(neutralLayers.slice(0, parentLayers.length)) !==
      canonicalJSON(parentLayers)
  ) {
    throw new Error("neutral opponent is not derived from the exact-v5 rootfs");
  }

  const neutralFiles = await observeHashes(
    runtime,
    neutral.Id,
    [
      ...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
      ...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
    ],
    "neutral opponent",
  );
  const parentPolicyFiles = await observeHashes(
    runtime,
    parent.Id,
    HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
    "exact-v5 parent",
  );
  const neutralByPath = new Map(
    neutralFiles.map((entry) => [entry.path, entry.sha256]),
  );
  for (const entry of parentPolicyFiles) {
    if (neutralByPath.get(entry.path) !== entry.sha256) {
      throw new Error(`neutral opponent changed exact-v5 policy bytes: ${entry.path}`);
    }
  }
  const committed = new Map(
    committedFiles.map((entry) => [entry.path, entry.sha256]),
  );
  for (const file of HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES) {
    if (neutralByPath.get(`/app/${file}`) !== committed.get(file)) {
      throw new Error(`neutral opponent runner differs from committed bytes: ${file}`);
    }
  }

  const syntaxFiles = [...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES]
    .sort()
    .map((file) => `/app/${file}`);
  for (const target of syntaxFiles) {
    await runtime.run("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "node",
      neutral.Id,
      "--check",
      target,
    ]);
  }
  const moduleImports = ["ws", "file:///app/hrafn-neutral-opponent.mjs"];
  const smokeSource = [
    'const ws = await import("ws");',
    'if (typeof ws.WebSocket !== "function") throw new Error("ws import is invalid");',
    'const neutral = await import("file:///app/hrafn-neutral-opponent.mjs");',
    'if (typeof neutral.chooseNeutralOpponentAction !== "function") throw new Error("neutral chooser is invalid");',
    'const sampleReason = neutral.publicNeutralOpponentReason({kind:"hold"});',
    `process.stdout.write(JSON.stringify({node_version:process.version,module_imports:${JSON.stringify(moduleImports)},sample_reason:sampleReason})+"\\n");`,
  ].join("");
  const smoke = await runtime.run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    neutral.Id,
    "--input-type=module",
    "--eval",
    smokeSource,
  ]);
  let observation;
  try {
    observation = JSON.parse(stringResult(smoke.stdout));
  } catch {
    throw new Error("neutral opponent Node/import smoke did not return JSON");
  }
  if (!exactKeys(observation, ["node_version", "module_imports", "sample_reason"]) ||
    !/^v24\.\d+\.\d+$/.test(observation.node_version ?? "") ||
    canonicalJSON(observation.module_imports) !== canonicalJSON(moduleImports) ||
    !/^\[0UT\] v5:[a-z0-9]{3}(?::[a-z0-9.]+)?$/.test(observation.sample_reason ?? "") ||
    String(observation.sample_reason).includes("[K1Z]")
  ) {
    throw new Error("neutral opponent Node/import smoke is invalid");
  }

  return {
    image_id: neutral.Id,
    parent_image_id: parent.Id,
    os: neutral.Os,
    architecture: neutral.Architecture,
    working_dir: neutral.Config.WorkingDir,
    entrypoint: neutral.Config.Entrypoint,
    cmd: [...neutral.Config.Cmd],
    coworld_player_run: [...HRAFN_NEUTRAL_OPPONENT_RUN],
    parent_coworld_player_run: [...HRAFN_EXACT_V5_PLAYER_RUN],
    rootfs_layers: [...neutralLayers],
    parent_rootfs_layers: [...parentLayers],
    container_files: neutralFiles,
    parent_policy_files: parentPolicyFiles,
    runtime_smoke: {
      node_version: observation.node_version,
      syntax_files: syntaxFiles,
      module_imports: moduleImports,
      sample_reason: observation.sample_reason,
    },
  };
}

export function verifyHrafnIntentImageReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, [
    "schema_version",
    "record_type",
    "campaign_id",
    "created_at",
    "source",
    "image",
    "coworld_player_run",
    "files",
    "tests",
    "planner",
    "game",
    "opponent",
    "integrity",
  ])) {
    errors.push("receipt top-level fields are not exact");
  }
  if (receipt?.schema_version !== 2) errors.push("schema_version must be 2");
  if (receipt?.record_type !== "hrafn_intent_i1_image_receipt") {
    errors.push("record_type is invalid");
  }
  if (receipt?.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID) {
    errors.push("campaign_id is invalid");
  }
  if (
    typeof receipt?.created_at !== "string" ||
    !Number.isFinite(Date.parse(receipt.created_at))
  ) {
    errors.push("created_at is invalid");
  }

  const source = receipt?.source;
  if (!exactKeys(source, [
    "commit",
    "branch",
    "upstream_ref",
    "remote_name",
    "remote_ref",
    "upstream_commit",
    "remote_commit",
    "clean",
    "pushed",
  ])) {
    errors.push("source fields are not exact");
  } else {
    if (!COMMIT.test(source.commit ?? "")) errors.push("source commit is invalid");
    if (source.branch !== HRAFN_INTENT_SOURCE_BRANCH) {
      errors.push("source branch is invalid");
    }
    if (source.upstream_ref !== `origin/${HRAFN_INTENT_SOURCE_BRANCH}`) {
      errors.push("source upstream is invalid");
    }
    if (source.remote_name !== "origin") errors.push("source remote is invalid");
    if (source.remote_ref !== `refs/heads/${HRAFN_INTENT_SOURCE_BRANCH}`) {
      errors.push("source remote ref is invalid");
    }
    if (
      source.upstream_commit !== source.commit ||
      source.remote_commit !== source.commit ||
      source.clean !== true ||
      source.pushed !== true
    ) {
      errors.push("source is not clean, committed, and pushed");
    }
  }

  if (!exactKeys(receipt?.image, [
    "requested_reference",
    "id",
    "os",
    "architecture",
    "working_dir",
    "entrypoint",
    "cmd",
    "container_files",
    "runtime_smoke",
  ])) {
    errors.push("image fields are not exact");
  } else if (
    !IMAGE_ID.test(receipt.image.id ?? "") ||
    receipt.image.os !== "linux" ||
    receipt.image.architecture !== "amd64" ||
    receipt.image.working_dir !== "/app" ||
    canonicalJSON(receipt.image.entrypoint) !==
      canonicalJSON(HRAFN_INTENT_IMAGE_ENTRYPOINT) ||
    canonicalJSON(receipt.image.cmd) !== canonicalJSON(HRAFN_INTENT_PLAYER_RUN) ||
    receipt.image.id === HRAFN_V5_OPPONENT_IMAGE_ID ||
    receipt.image.id === HRAFN_V5_PARENT_IMAGE_ID
  ) {
    errors.push("image observation is invalid");
  }
  if (!exactKeys(receipt?.image?.runtime_smoke, [
    "node_version",
    "syntax_files",
    "module_imports",
  ]) ||
    !/^v24\.\d+\.\d+$/.test(receipt?.image?.runtime_smoke?.node_version ?? "") ||
    canonicalJSON(receipt?.image?.runtime_smoke?.syntax_files) !==
      canonicalJSON(HRAFN_INTENT_RUNTIME_SYNTAX_FILES) ||
    canonicalJSON(receipt?.image?.runtime_smoke?.module_imports) !==
      canonicalJSON(HRAFN_INTENT_RUNTIME_IMPORTS)
  ) {
    errors.push("image Node/import smoke evidence is invalid");
  }
  if (!Array.isArray(receipt?.image?.container_files) ||
    receipt.image.container_files.length !== HRAFN_INTENT_CONTAINER_FILES.length
  ) {
    errors.push("image container file evidence is invalid");
  } else {
    const expected = [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) =>
      `/app/${file}`
    );
    if (JSON.stringify(receipt.image.container_files.map((entry) => entry?.path)) !==
      JSON.stringify(expected)
    ) {
      errors.push("image container file set is invalid");
    }
    const committed = new Map(
      Array.isArray(receipt?.files)
        ? receipt.files.map((entry) => [entry?.path, entry?.sha256])
        : [],
    );
    for (const entry of receipt.image.container_files) {
      const file = String(entry?.path ?? "").replace(/^\/app\//, "");
      if (!exactKeys(entry, ["path", "sha256"]) ||
        !SHA256.test(entry.sha256 ?? "") || committed.get(file) !== entry.sha256
      ) {
        errors.push("image container file hash does not match committed source");
      }
    }
  }
  if (
    JSON.stringify(receipt?.coworld_player_run) !==
      JSON.stringify(HRAFN_INTENT_PLAYER_RUN)
  ) {
    errors.push("Coworld player run is invalid");
  }

  if (!Array.isArray(receipt?.files)) {
    errors.push("files must be an array");
  } else {
    const expected = [...HRAFN_INTENT_IMAGE_FILES].sort();
    const actual = receipt.files.map((entry) => entry?.path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push("committed file set is invalid");
    }
    for (const entry of receipt.files) {
      if (!exactKeys(entry, ["path", "sha256"]) || !SHA256.test(entry.sha256 ?? "")) {
        errors.push("committed file hash is invalid");
      }
    }
  }

  if (!exactKeys(receipt?.tests, [
    "argv",
    "exit_code",
    "stdout_sha256",
    "stderr_sha256",
  ]) ||
    JSON.stringify(receipt?.tests?.argv) !== JSON.stringify(["npm", "test"]) ||
    receipt?.tests?.exit_code !== 0 ||
    !SHA256.test(receipt?.tests?.stdout_sha256 ?? "") ||
    !SHA256.test(receipt?.tests?.stderr_sha256 ?? "")
  ) {
    errors.push("test evidence is invalid");
  }

  if (!exactKeys(receipt?.planner, [
    "model",
    "model_digest",
    "ollama_version",
  ]) ||
    receipt?.planner?.model !== HRAFN_INTENT_MODEL ||
    receipt?.planner?.model_digest !== HRAFN_INTENT_MODEL_DIGEST ||
    receipt?.planner?.ollama_version !== HRAFN_INTENT_OLLAMA_VERSION
  ) {
    errors.push("planner binding is invalid");
  }
  if (!exactKeys(receipt?.game, [
    "reference",
    "id",
    "os",
    "architecture",
  ]) ||
    receipt?.game?.reference !== HRAFN_COWORLD_GAME_IMAGE_REFERENCE ||
    receipt?.game?.id !== HRAFN_COWORLD_GAME_IMAGE_ID ||
    receipt?.game?.os !== "linux" || receipt?.game?.architecture !== "amd64"
  ) {
    errors.push("Coworld game image binding is invalid");
  }
  const opponent = receipt?.opponent;
  const opponentKeys = [
    "image_id",
    "parent_image_id",
    "os",
    "architecture",
    "working_dir",
    "entrypoint",
    "cmd",
    "coworld_player_run",
    "parent_coworld_player_run",
    "rootfs_layers",
    "parent_rootfs_layers",
    "container_files",
    "parent_policy_files",
    "runtime_smoke",
  ];
  if (!exactKeys(opponent, opponentKeys) ||
    opponent?.image_id !== HRAFN_NEUTRAL_OPPONENT_IMAGE_ID ||
    opponent?.parent_image_id !== HRAFN_V5_PARENT_IMAGE_ID ||
    opponent?.image_id === opponent?.parent_image_id ||
    opponent?.os !== "linux" || opponent?.architecture !== "amd64" ||
    opponent?.working_dir !== "/app" ||
    canonicalJSON(opponent?.entrypoint) !==
      canonicalJSON(HRAFN_INTENT_IMAGE_ENTRYPOINT) ||
    canonicalJSON(opponent?.cmd) !==
      canonicalJSON(HRAFN_NEUTRAL_OPPONENT_RUN) ||
    canonicalJSON(opponent?.coworld_player_run) !==
      canonicalJSON(HRAFN_NEUTRAL_OPPONENT_RUN) ||
    canonicalJSON(opponent?.parent_coworld_player_run) !==
      canonicalJSON(HRAFN_EXACT_V5_PLAYER_RUN)
  ) {
    errors.push("neutral exact-v5 opponent binding is invalid");
  }
  const validLayers = (layers) => Array.isArray(layers) && layers.length > 0 &&
    layers.every((layer) => IMAGE_ID.test(layer ?? ""));
  if (!validLayers(opponent?.rootfs_layers) ||
    !validLayers(opponent?.parent_rootfs_layers) ||
    opponent.rootfs_layers.length <= opponent.parent_rootfs_layers.length ||
    canonicalJSON(opponent.rootfs_layers.slice(0, opponent.parent_rootfs_layers.length)) !==
      canonicalJSON(opponent.parent_rootfs_layers)
  ) {
    errors.push("neutral opponent rootfs parent evidence is invalid");
  }
  const neutralFileNames = [
    ...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
    ...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
  ].sort();
  const expectedNeutralPaths = neutralFileNames.map((file) => `/app/${file}`);
  const expectedParentPaths = [...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES]
    .sort()
    .map((file) => `/app/${file}`);
  const validFileArray = (entries, expectedPaths) =>
    Array.isArray(entries) &&
    canonicalJSON(entries.map((entry) => entry?.path)) === canonicalJSON(expectedPaths) &&
    entries.every((entry) =>
      exactKeys(entry, ["path", "sha256"]) && SHA256.test(entry.sha256 ?? "")
    );
  if (!validFileArray(opponent?.container_files, expectedNeutralPaths) ||
    !validFileArray(opponent?.parent_policy_files, expectedParentPaths)
  ) {
    errors.push("neutral opponent file evidence is invalid");
  } else {
    const neutralHashes = new Map(
      opponent.container_files.map((entry) => [entry.path, entry.sha256]),
    );
    const committedHashes = new Map(
      Array.isArray(receipt?.files)
        ? receipt.files.map((entry) => [entry?.path, entry?.sha256])
        : [],
    );
    for (const entry of opponent.parent_policy_files) {
      if (neutralHashes.get(entry.path) !== entry.sha256) {
        errors.push("neutral opponent changed exact-v5 policy bytes");
      }
    }
    for (const file of HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES) {
      if (neutralHashes.get(`/app/${file}`) !== committedHashes.get(file)) {
        errors.push("neutral opponent runner differs from committed source");
      }
    }
  }
  const expectedNeutralSyntax = [...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES]
    .sort()
    .map((file) => `/app/${file}`);
  const expectedNeutralImports = ["ws", "file:///app/hrafn-neutral-opponent.mjs"];
  if (!exactKeys(opponent?.runtime_smoke, [
    "node_version",
    "syntax_files",
    "module_imports",
    "sample_reason",
  ]) ||
    !/^v24\.\d+\.\d+$/.test(opponent?.runtime_smoke?.node_version ?? "") ||
    canonicalJSON(opponent?.runtime_smoke?.syntax_files) !==
      canonicalJSON(expectedNeutralSyntax) ||
    canonicalJSON(opponent?.runtime_smoke?.module_imports) !==
      canonicalJSON(expectedNeutralImports) ||
    !/^\[0UT\] v5:[a-z0-9]{3}(?::[a-z0-9.]+)?$/.test(
      opponent?.runtime_smoke?.sample_reason ?? "",
    ) || String(opponent?.runtime_smoke?.sample_reason ?? "").includes("[K1Z]")
  ) {
    errors.push("neutral opponent runtime evidence is invalid");
  }
  if (!exactKeys(receipt?.integrity, [
    "algorithm",
    "canonicalization",
    "content_sha256",
  ]) ||
    receipt?.integrity?.algorithm !== "sha256" ||
    receipt?.integrity?.canonicalization !== CANONICALIZATION ||
    !SHA256.test(receipt?.integrity?.content_sha256 ?? "") ||
    receipt?.integrity?.content_sha256 !== hrafnIntentReceiptContentSHA256(receipt)
  ) {
    errors.push("receipt content integrity is invalid");
  }
  const serialized = (() => {
    try {
      return JSON.stringify(receipt);
    } catch {
      return "";
    }
  })();
  if (FORBIDDEN_IDENTITY.test(serialized)) {
    errors.push("receipt contains forbidden identity material");
  }
  return { valid: errors.length === 0, errors };
}

export function serializeHrafnIntentImageReceipt(receipt) {
  const report = verifyHrafnIntentImageReceipt(receipt);
  if (!report.valid) throw new Error(report.errors.join("; "));
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export async function createHrafnIntentImageReceipt({
  repoPath,
  imageReference,
} = {}, runtimeOverrides = {}) {
  if (!path.isAbsolute(repoPath ?? "")) {
    throw new Error("repoPath must be absolute");
  }
  if (typeof imageReference !== "string" || !imageReference ||
    FORBIDDEN_IDENTITY.test(imageReference)
  ) {
    throw new Error("subject image reference is invalid");
  }
  const runtime = {
    run: defaultRun,
    now: () => new Date(),
    ...runtimeOverrides,
  };

  const status = await gitText(runtime, repoPath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (status !== "") throw new Error("source tree must be clean before receipt creation");

  const commit = await gitText(runtime, repoPath, ["rev-parse", "HEAD"]);
  const branch = await gitText(runtime, repoPath, ["branch", "--show-current"]);
  const upstreamRef = await gitText(runtime, repoPath, [
    "rev-parse",
    "--abbrev-ref",
    "@{upstream}",
  ]);
  const upstreamCommit = await gitText(runtime, repoPath, [
    "rev-parse",
    "@{upstream}",
  ]);
  if (!COMMIT.test(commit)) throw new Error("source HEAD is not a full commit");
  if (branch !== HRAFN_INTENT_SOURCE_BRANCH) {
    throw new Error(`source branch must be ${HRAFN_INTENT_SOURCE_BRANCH}`);
  }
  if (upstreamRef !== `origin/${HRAFN_INTENT_SOURCE_BRANCH}`) {
    throw new Error("source upstream branch is not the pinned origin branch");
  }
  if (upstreamCommit !== commit) {
    throw new Error("source commit is not pushed to the tracked upstream");
  }
  const remoteName = await gitText(runtime, repoPath, [
    "config",
    "--get",
    `branch.${branch}.remote`,
  ]);
  const remoteRef = await gitText(runtime, repoPath, [
    "config",
    "--get",
    `branch.${branch}.merge`,
  ]);
  if (remoteName !== "origin" || remoteRef !== `refs/heads/${branch}`) {
    throw new Error("source branch remote binding is invalid");
  }
  const remoteRaw = await gitText(runtime, repoPath, [
    "ls-remote",
    "--exit-code",
    remoteName,
    remoteRef,
  ]);
  const remoteMatch = remoteRaw.match(/^([a-f0-9]{40})\s+/);
  const remoteCommit = remoteMatch?.[1] ?? "";
  if (remoteCommit !== commit) {
    throw new Error("source commit is not pushed to the observed remote ref");
  }

  const files = [];
  for (const file of [...HRAFN_INTENT_IMAGE_FILES].sort()) {
    const result = await git(runtime, repoPath, ["show", `${commit}:${file}`]);
    const bytes = Buffer.from(result.stdout ?? "");
    if (bytes.length === 0) throw new Error(`committed file is empty: ${file}`);
    files.push({ path: file, sha256: sha256(bytes) });
  }

  const inspected = await runtime.run("docker", [
    "image",
    "inspect",
    imageReference,
  ]);
  const image = verifyDockerInspect(inspected.stdout, imageReference);
  image.container_files = await observeContainerFiles(
    runtime,
    image.id,
    files,
  );
  image.runtime_smoke = await observeImageRuntime(runtime, image.id);
  const game = await observeCoworldGameImage(runtime);
  const opponent = await observeNeutralOpponent(runtime, files);

  const testResult = await runtime.run("npm", ["test"], { cwd: repoPath });
  const testStdout = Buffer.from(testResult.stdout ?? "");
  const testStderr = Buffer.from(testResult.stderr ?? "");
  const receipt = {
    schema_version: 2,
    record_type: "hrafn_intent_i1_image_receipt",
    campaign_id: HRAFN_INTENT_CAMPAIGN_ID,
    created_at: runtime.now().toISOString(),
    source: {
      commit,
      branch,
      upstream_ref: upstreamRef,
      remote_name: remoteName,
      remote_ref: remoteRef,
      upstream_commit: upstreamCommit,
      remote_commit: remoteCommit,
      clean: true,
      pushed: true,
    },
    image,
    coworld_player_run: [...HRAFN_INTENT_PLAYER_RUN],
    files,
    tests: {
      argv: ["npm", "test"],
      exit_code: 0,
      stdout_sha256: sha256(testStdout),
      stderr_sha256: sha256(testStderr),
    },
    planner: {
      model: HRAFN_INTENT_MODEL,
      model_digest: HRAFN_INTENT_MODEL_DIGEST,
      ollama_version: HRAFN_INTENT_OLLAMA_VERSION,
    },
    game,
    opponent,
  };
  receipt.integrity = {
    algorithm: "sha256",
    canonicalization: CANONICALIZATION,
    content_sha256: hrafnIntentReceiptContentSHA256(receipt),
  };
  const report = verifyHrafnIntentImageReceipt(receipt);
  if (!report.valid) throw new Error(report.errors.join("; "));
  return receipt;
}

export async function verifyHrafnIntentImageReceiptEnvironment(
  receipt,
  { repoPath } = {},
  runtimeOverrides = {},
) {
  const report = verifyHrafnIntentImageReceipt(receipt);
  if (!report.valid) throw new Error(report.errors.join("; "));
  if (!path.isAbsolute(repoPath ?? "")) {
    throw new Error("repoPath must be absolute");
  }
  const runtime = { run: defaultRun, ...runtimeOverrides };
  const status = await gitText(runtime, repoPath, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  const commit = await gitText(runtime, repoPath, ["rev-parse", "HEAD"]);
  const branch = await gitText(runtime, repoPath, ["branch", "--show-current"]);
  const upstream = await gitText(runtime, repoPath, [
    "rev-parse",
    "--abbrev-ref",
    "@{upstream}",
  ]);
  const upstreamCommit = await gitText(runtime, repoPath, [
    "rev-parse",
    "@{upstream}",
  ]);
  const remoteRaw = await gitText(runtime, repoPath, [
    "ls-remote",
    "--exit-code",
    receipt.source.remote_name,
    receipt.source.remote_ref,
  ]);
  const remoteCommit = remoteRaw.match(/^([a-f0-9]{40})\s+/)?.[1] ?? "";
  if (status !== "" || commit !== receipt.source.commit ||
    branch !== receipt.source.branch || upstream !== receipt.source.upstream_ref ||
    upstreamCommit !== receipt.source.commit || remoteCommit !== receipt.source.commit
  ) {
    throw new Error("live Git state no longer matches the image receipt");
  }
  for (const entry of receipt.files) {
    const result = await git(runtime, repoPath, [
      "show",
      `${receipt.source.commit}:${entry.path}`,
    ]);
    if (sha256(Buffer.from(result.stdout ?? "")) !== entry.sha256) {
      throw new Error(`live committed file hash mismatch: ${entry.path}`);
    }
  }
  const inspected = await runtime.run("docker", [
    "image",
    "inspect",
    receipt.image.id,
  ]);
  const image = verifyDockerInspect(inspected.stdout, receipt.image.id);
  if (image.id !== receipt.image.id || image.working_dir !== receipt.image.working_dir ||
    canonicalJSON(image.entrypoint) !== canonicalJSON(receipt.image.entrypoint) ||
    canonicalJSON(image.cmd) !== canonicalJSON(receipt.image.cmd)
  ) {
    throw new Error("live subject image ID no longer matches the receipt");
  }
  const containerFiles = await observeContainerFiles(
    runtime,
    image.id,
    receipt.files,
  );
  if (canonicalJSON(containerFiles) !== canonicalJSON(receipt.image.container_files)) {
    throw new Error("live subject image file hashes no longer match the receipt");
  }
  const runtimeSmoke = await observeImageRuntime(runtime, image.id);
  if (canonicalJSON(runtimeSmoke) !== canonicalJSON(receipt.image.runtime_smoke)) {
    throw new Error("live subject image runtime smoke no longer matches the receipt");
  }
  const game = await observeCoworldGameImage(runtime);
  if (canonicalJSON(game) !== canonicalJSON(receipt.game)) {
    throw new Error("live Coworld game image no longer matches the receipt");
  }
  const opponent = await observeNeutralOpponent(runtime, receipt.files);
  if (canonicalJSON(opponent) !== canonicalJSON(receipt.opponent)) {
    throw new Error("live neutral opponent evidence no longer matches the receipt");
  }
  return {
    valid: true,
    source_commit: commit,
    subject_image: image.id,
    game_image: game.id,
    opponent_image: opponent.image_id,
    opponent_parent_image: opponent.parent_image_id,
  };
}

function option(argv, name) {
  const exact = `--${name}`;
  const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
  if (inline) return inline.slice(exact.length + 1);
  const index = argv.indexOf(exact);
  return index >= 0 ? argv[index + 1] : null;
}

async function main(argv) {
  const repoPath = option(argv, "repo");
  const imageReference = option(argv, "image");
  const outputPath = option(argv, "output");
  if (!repoPath || !imageReference || !path.isAbsolute(outputPath ?? "")) {
    throw new Error(
      "usage: create-hrafn-intent-image-receipt --repo ABS_REPO " +
      "--image IMAGE --output ABS_JSON",
    );
  }
  const relative = path.relative(path.resolve(repoPath), path.resolve(outputPath));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("image receipt output must be outside the source repository");
  }
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: path.resolve(repoPath),
    imageReference,
  });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, serializeHrafnIntentImageReceipt(receipt), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, outputPath);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
