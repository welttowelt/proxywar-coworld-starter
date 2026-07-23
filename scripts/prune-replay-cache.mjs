import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function formatGiB(bytes) {
  return Number((bytes / (1024 ** 3)).toFixed(2));
}

export async function replayCachePrunePlan({
  cacheDir,
  manifestPath,
}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.replays) || manifest.replays.length === 0) {
    throw new Error("refusing replay-cache prune without a non-empty manifest.replays");
  }

  const keep = new Set(
    manifest.replays
      .map((replay) => String(replay?.episode_id ?? "").trim())
      .filter(Boolean)
      .map((episodeID) => `${episodeID}.replay`),
  );
  if (keep.size === 0) {
    throw new Error("refusing replay-cache prune without valid episode IDs");
  }

  let entries;
  try {
    entries = await readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    entries = [];
  }

  const stale = [];
  let keepBytes = 0;
  let staleBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".replay")) continue;
    const filePath = path.join(cacheDir, entry.name);
    const fileStat = await stat(filePath);
    if (keep.has(entry.name)) {
      keepBytes += fileStat.size;
      continue;
    }
    stale.push(filePath);
    staleBytes += fileStat.size;
  }

  return {
    cache_dir: cacheDir,
    manifest_path: manifestPath,
    keep_files: keep.size,
    keep_bytes: keepBytes,
    keep_gib: formatGiB(keepBytes),
    stale_files: stale.length,
    stale_bytes: staleBytes,
    stale_gib: formatGiB(staleBytes),
    stale,
  };
}

export async function pruneReplayCache({
  cacheDir,
  manifestPath,
  apply = false,
}) {
  const plan = await replayCachePrunePlan({ cacheDir, manifestPath });
  if (apply) {
    await Promise.all(plan.stale.map((filePath) => rm(filePath)));
  }
  return {
    ...plan,
    applied: apply,
    stale: undefined,
  };
}

async function main() {
  const root = process.cwd();
  const result = await pruneReplayCache({
    cacheDir: path.join(root, "data", "cache", "replays"),
    manifestPath: path.join(root, "data", "processed", "manifest.json"),
    apply: process.argv.includes("--apply"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
