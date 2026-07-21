#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HRAFN_COWORLD_MANIFEST_PROFILE = "coworld-client-0.1.28";
export const HRAFN_COWORLD_MANIFEST_SOURCE_SHA256 =
  "f64cd51b21883a434d7c5e3eef924a6312e6ca74f1cb6b9d998dc0724dca65cf";
export const HRAFN_COWORLD_MANIFEST_SOURCE_BYTES = 27479;
export const HRAFN_COWORLD_MANIFEST_SHA256 =
  "8feb5100ee63d5ccca66794c40e535f2715376e2a2cf8a3f8ed892880dfe65f3";
export const HRAFN_COWORLD_MANIFEST_BYTES = 27377;
export const HRAFN_COWORLD_GAME_IMAGE_REFERENCE =
  "coworld/cow_236e7c2e-acdb-404a-b1b9-41852e5ac658/proxywar-0.1.10-1:downloaded";
export const HRAFN_COWORLD_GAME_IMAGE_ID =
  "sha256:98cf744311d0da1cc6a1b5fee6ef588db984c66c0a0bd077a4a9a9c475f32cb4";
export const HRAFN_COWORLD_MANIFEST_SOURCE_PATH = fileURLToPath(new URL(
  "../coworld/cow_236e7c2e-acdb-404a-b1b9-41852e5ac658/coworld_manifest.json",
  import.meta.url,
));

const LEGACY_TAGS = Object.freeze([
  "strategy",
  "multiplayer",
  "ai-agents",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function option(argv, name) {
  const exact = `--${name}`;
  const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
  if (inline) return inline.slice(exact.length + 1);
  const index = argv.indexOf(exact);
  return index >= 0 ? argv[index + 1] : null;
}

export function materializeHrafnCoworldManifest(source) {
  const sourceBytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? "");
  if (
    sourceBytes.length !== HRAFN_COWORLD_MANIFEST_SOURCE_BYTES ||
    sha256(sourceBytes) !== HRAFN_COWORLD_MANIFEST_SOURCE_SHA256
  ) {
    throw new Error("Coworld 0.1.28 source manifest bytes are not pinned");
  }
  let manifest;
  try {
    manifest = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("Coworld 0.1.28 source manifest is not valid JSON");
  }
  if (
    !plainObject(manifest) ||
    !Object.hasOwn(manifest, "tags") ||
    JSON.stringify(manifest.tags) !== JSON.stringify(LEGACY_TAGS) ||
    !Object.hasOwn(manifest, "episode_timeout_minutes") ||
    manifest.episode_timeout_minutes !== 100
  ) {
    throw new Error("Coworld 0.1.28 legacy manifest fields drifted");
  }
  if (manifest?.game?.runnable?.image !== HRAFN_COWORLD_GAME_IMAGE_REFERENCE) {
    throw new Error("Coworld 0.1.28 game image reference drifted");
  }
  delete manifest.tags;
  delete manifest.episode_timeout_minutes;
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (
    bytes.length !== HRAFN_COWORLD_MANIFEST_BYTES ||
    sha256(bytes) !== HRAFN_COWORLD_MANIFEST_SHA256
  ) {
    throw new Error("materialized Coworld 0.1.28 manifest bytes drifted");
  }
  return {
    bytes,
    receipt: {
      profile: HRAFN_COWORLD_MANIFEST_PROFILE,
      source_sha256: HRAFN_COWORLD_MANIFEST_SOURCE_SHA256,
      source_bytes: HRAFN_COWORLD_MANIFEST_SOURCE_BYTES,
      output_sha256: HRAFN_COWORLD_MANIFEST_SHA256,
      output_bytes: HRAFN_COWORLD_MANIFEST_BYTES,
      removed_top_level_keys: ["tags", "episode_timeout_minutes"],
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const profile = option(argv, "profile") ?? HRAFN_COWORLD_MANIFEST_PROFILE;
  const input = option(argv, "input") ?? HRAFN_COWORLD_MANIFEST_SOURCE_PATH;
  const output = option(argv, "output");
  if (profile !== HRAFN_COWORLD_MANIFEST_PROFILE || !output) {
    throw new Error(
      "usage: materialize-hrafn-coworld-manifest --output PATH " +
        "[--input PATH] [--profile coworld-client-0.1.28]",
    );
  }
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  const materialized = materializeHrafnCoworldManifest(await readFile(inputPath));
  await writeFile(outputPath, materialized.bytes, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    ...materialized.receipt,
    input_path: inputPath,
    output_path: outputPath,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
