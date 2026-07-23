import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runReport = (...args) => spawnSync(
  process.execPath,
  ["scripts/rci-report.mjs", ...args],
  {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  },
);

test("inactive tracked player is reported without breaking a routine refresh", () => {
  const result = runReport();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "RCI INACTIVE: no tracked policy performance in current window\n",
  );
});

test("strict RCI still rejects an inactive tracked player", () => {
  const result = runReport("--strict");

  assert.equal(result.status, 1);
  assert.equal(
    result.stdout,
    "RCI INACTIVE: no tracked policy performance in current window\n",
  );
});
