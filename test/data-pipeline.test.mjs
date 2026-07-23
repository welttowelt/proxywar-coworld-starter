import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { normalizeEmptyJsonFiles } from "../scripts/normalize-empty-site-json.mjs";

test("generated empty JSON arrays are normalized without rewriting populated data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "proxywar-json-"));
  const url = pathToFileURL(`${directory}${path.sep}`);
  try {
    const empty = new URL("empty.json", url);
    const populated = new URL("populated.json", url);
    const populatedSource = '[\n\t{"round":709}\n]\n';
    await writeFile(empty, "[\n\t\n]\n");
    await writeFile(populated, populatedSource);

    await normalizeEmptyJsonFiles(url);

    assert.equal(await readFile(empty, "utf8"), "[]\n");
    assert.equal(await readFile(populated, "utf8"), populatedSource);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
