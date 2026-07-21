import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const benchmarkPath = fileURLToPath(
  new URL("../scripts/benchmark-standard-controller.mjs", import.meta.url),
);

test("benchmark binds provenance and exercises the 47-action production wire path", async () => {
  const sourceCommit = "a".repeat(40);
  const imageID = `sha256:${"b".repeat(64)}`;
  const { stdout } = await execFileAsync(process.execPath, [
    benchmarkPath,
    "--iterations", "10000",
    "--source-commit", sourceCommit,
    "--image-id", imageID,
  ], { timeout: 30_000, maxBuffer: 1_000_000 });
  const receipt = JSON.parse(stdout);
  const producerHash = createHash("sha256")
    .update(await readFile(benchmarkPath))
    .digest("hex");

  assert.equal(receipt.schema_version, "proxywar-standard-controller-benchmark-v2");
  assert.equal(receipt.source_commit, sourceCommit);
  assert.equal(receipt.image_id, imageID);
  assert.equal(receipt.producer.sha256, producerHash);
  for (const name of [
    "llm-player.mjs",
    "standard-controller.mjs",
    "controller-safety.mjs",
  ]) {
    const expected = createHash("sha256")
      .update(await readFile(fileURLToPath(new URL(`../${name}`, import.meta.url))))
      .digest("hex");
    assert.equal(receipt.executed_runtime.files[name], expected);
  }
  assert.equal(receipt.executed_runtime.image_id, imageID);
  assert.equal(receipt.iterations, 10_000);
  assert.equal(receipt.production.action_count, 47);
  assert.deepEqual(receipt.production.measured_path, [
    "JSON.parse", "decideResponse", "JSON.stringify",
  ]);
  assert.equal(receipt.microbenchmark.iterations, 10_000);
  assert.ok(receipt.production.p95_ms > 0);
  assert.ok(receipt.microbenchmark.p95_ms > 0);
});
