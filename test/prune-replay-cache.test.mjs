import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneReplayCache } from "../scripts/prune-replay-cache.mjs";

function fixture(replays) {
  const root = mkdtempSync(path.join(tmpdir(), "proxywar-replay-prune-"));
  const cacheDir = path.join(root, "data", "cache", "replays");
  const processedDir = path.join(root, "data", "processed");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(processedDir, { recursive: true });
  const manifestPath = path.join(processedDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ replays }));
  return { root, cacheDir, manifestPath };
}

test("replay cache prune keeps manifest files and removes only stale replays", async () => {
  const { cacheDir, manifestPath } = fixture([{ episode_id: "keep-me" }]);
  const keep = path.join(cacheDir, "keep-me.replay");
  const stale = path.join(cacheDir, "stale.replay");
  const unrelated = path.join(cacheDir, "notes.txt");
  writeFileSync(keep, "keep");
  writeFileSync(stale, "stale");
  writeFileSync(unrelated, "notes");

  const dryRun = await pruneReplayCache({ cacheDir, manifestPath });
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.keep_files, 1);
  assert.equal(dryRun.stale_files, 1);
  assert.equal(existsSync(stale), true);

  const applied = await pruneReplayCache({ cacheDir, manifestPath, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.stale_files, 1);
  assert.equal(existsSync(keep), true);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(unrelated), true);
});

test("replay cache prune refuses an empty manifest", async () => {
  const { cacheDir, manifestPath } = fixture([]);
  await assert.rejects(
    pruneReplayCache({ cacheDir, manifestPath, apply: true }),
    /refusing replay-cache prune/,
  );
});

test("replay cache prune is a no-op when the cache directory is absent", async () => {
  const { root, manifestPath } = fixture([{ episode_id: "keep-me" }]);
  const cacheDir = path.join(root, "missing-cache");
  const result = await pruneReplayCache({ cacheDir, manifestPath, apply: true });
  assert.equal(result.applied, true);
  assert.equal(result.keep_files, 1);
  assert.equal(result.stale_files, 0);
  assert.equal(result.stale_bytes, 0);
});
