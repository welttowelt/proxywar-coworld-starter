import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
  HRAFN_COWORLD_MANIFEST_BYTES,
  HRAFN_COWORLD_MANIFEST_PROFILE,
  HRAFN_COWORLD_MANIFEST_SHA256,
  HRAFN_COWORLD_MANIFEST_SOURCE_PATH,
  materializeHrafnCoworldManifest,
} from "../scripts/materialize-hrafn-coworld-manifest.mjs";

const cli = fileURLToPath(new URL(
  "../scripts/materialize-hrafn-coworld-manifest.mjs",
  import.meta.url,
));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("materializer reproduces the exact pinned Coworld 0.1.28 bytes", () => {
  const materialized = materializeHrafnCoworldManifest(
    readFileSync(HRAFN_COWORLD_MANIFEST_SOURCE_PATH),
  );
  assert.equal(materialized.bytes.length, HRAFN_COWORLD_MANIFEST_BYTES);
  assert.equal(sha256(materialized.bytes), HRAFN_COWORLD_MANIFEST_SHA256);
  assert.equal(materialized.bytes.at(-1), 10);
  const parsed = JSON.parse(materialized.bytes);
  assert.equal(Object.hasOwn(parsed, "tags"), false);
  assert.equal(Object.hasOwn(parsed, "episode_timeout_minutes"), false);
  assert.equal(parsed.game.runnable.image, HRAFN_COWORLD_GAME_IMAGE_REFERENCE);
  assert.equal(materialized.receipt.profile, HRAFN_COWORLD_MANIFEST_PROFILE);
});

test("materializer rejects source drift before producing bytes", () => {
  const drifted = Buffer.from(readFileSync(HRAFN_COWORLD_MANIFEST_SOURCE_PATH));
  drifted[0] ^= 1;
  assert.throws(
    () => materializeHrafnCoworldManifest(drifted),
    /source manifest bytes are not pinned/,
  );
});

test("CLI is cwd-independent and never overwrites an existing output", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "hrafn-manifest-"));
  const output = path.join(directory, "manifest.json");
  try {
    const result = spawnSync(process.execPath, [cli, "--output", output], {
      cwd: os.tmpdir(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sha256(readFileSync(output)), HRAFN_COWORLD_MANIFEST_SHA256);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.output_sha256, HRAFN_COWORLD_MANIFEST_SHA256);

    writeFileSync(output, "preserve-me\n");
    const second = spawnSync(process.execPath, [cli, "--output", output], {
      cwd: directory,
      encoding: "utf8",
    });
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(output, "utf8"), "preserve-me\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
