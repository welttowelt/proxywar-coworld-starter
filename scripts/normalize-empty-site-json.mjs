import { readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

export async function normalizeEmptyJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const url = new URL(entry.name, directory);
    const source = await readFile(url, "utf8");
    const value = JSON.parse(source);
    if (Array.isArray(value) && value.length === 0 && source !== "[]\n") {
      await writeFile(url, "[]\n");
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await normalizeEmptyJsonFiles(
    new URL("../site/data/", import.meta.url),
  );
}
