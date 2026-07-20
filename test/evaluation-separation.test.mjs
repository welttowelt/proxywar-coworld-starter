import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

test("production player has no static-surrogate activation path", async () => {
  const production = await readFile(`${root}/llm-player.mjs`, "utf8");
  assert.doesNotMatch(production, /evaluation-static-intent/i);
  assert.doesNotMatch(production, /static[_-]intent[_-]arm/i);
  assert.doesNotMatch(production, /evaluation[_-]surrogate/i);
});

test("default Docker target is hardened production and excludes evaluation source", async () => {
  const dockerfile = await readFile(`${root}/Dockerfile`, "utf8");
  const launch = await readFile(`${root}/launch.sh`, "utf8");
  const stages = [...dockerfile.matchAll(/^FROM\s+.+?\s+AS\s+(\S+)\s*$/gmi)]
    .map((match) => match[1].toLowerCase());

  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /^FROM node:24-bookworm-slim@sha256:[a-f0-9]{64}\s+AS\s+/m);
  assert.match(dockerfile, /--mount=type=cache/);
  assert.match(dockerfile, /node --check intent-controller\.mjs/);
  assert.match(dockerfile, /^USER node$/m);
  assert.equal(stages.at(-1), "production");
  assert.match(
    dockerfile,
    /FROM production-source AS production\s+CMD \["node", "\/app\/llm-player\.mjs"\]\s*$/,
  );
  assert.match(dockerfile, /upload-eligible="false"/);
  assert.match(launch, /--run \/app\/llm-player\.mjs/);
  assert.doesNotMatch(launch, /evaluation-static-intent-player/);
});

test("evaluation arms use baked one-file entrypoints, never environment selection", async () => {
  const runtime = await readFile(`${root}/evaluation-static-intent-player.mjs`, "utf8");
  const entrypoints = {
    m0: "evaluation-m0-player.mjs",
    "grow-opening": "evaluation-grow-opening-player.mjs",
    "grow-low-share": "evaluation-grow-low-share-player.mjs",
    "grow-calm": "evaluation-grow-calm-player.mjs",
    "grow-conjunction": "evaluation-grow-conjunction-player.mjs",
    "convert-weakest": "evaluation-convert-weakest-player.mjs",
    "convert-largest": "evaluation-convert-largest-player.mjs",
  };
  assert.match(runtime, /export function startStaticIntentPlayer/);
  assert.doesNotMatch(runtime, /process\.argv/);
  assert.doesNotMatch(runtime, /process\.env\.(?:EVALUATION|STATIC|SURROGATE).*ARM/i);

  const dockerfile = await readFile(`${root}/Dockerfile`, "utf8");
  for (const [arm, filename] of Object.entries(entrypoints)) {
    const source = await readFile(`${root}/${filename}`, "utf8");
    assert.match(source, new RegExp(`startStaticIntentPlayer\\(\"${arm}\"\\)`));
    assert.doesNotMatch(source, /process\.env|process\.argv/);
    assert.match(
      dockerfile,
      new RegExp(`CMD \\[\"node\", \"/app/${filename}\\"\\]`),
    );
  }
});
