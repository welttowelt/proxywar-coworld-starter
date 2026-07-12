import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const canonicalAnchor = `  // Serialize decision handling: a platform retry that overlaps an in-flight
  // request must not interleave brain.decide() on shared mutable state
  // (decisionsSincePlan, opponent-ledger rising-edge counters).
  let decisionChain: Promise<void> = Promise.resolve();
  let sawFinal = false;
  socket.on("message", (data: unknown) => {`;

const importAnchor =
  `import type { LlmProvider } from "../../src/server/agents/LlmProvider";`;

test("keystone patch replaces the stale FIFO with latest-request coalescing", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "keystone-patch-"));
  const target = path.join(directory, "keystone-player.ts");
  writeFileSync(
    target,
    `${importAnchor}
${canonicalAnchor}
    decisionChain = decisionChain.then(async () => {
      socket.send(JSON.stringify(response));
    });
  });
`,
  );

  execFileSync(process.execPath, [
    "scripts/patch-keystone-latest-request.mjs",
    target,
  ]);
  const patched = readFileSync(target, "utf8");

  assert.doesNotMatch(patched, /decisionChain/);
  assert.match(patched, /pendingDecision = message/);
  assert.match(patched, /discarded superseded decision response/);
  assert.match(patched, /while \(pendingDecision !== null && !sawFinal\)/);
  assert.match(patched, /import \{ applyLeaderClamp \}/);
  assert.match(patched, /decision = applyLeaderClamp\(input, decision\)/);
  assert.doesNotMatch(patched, /applyParityPulse/);
  assert.doesNotMatch(patched, /applyWireSalvage/);
  assert.doesNotMatch(patched, /oneShotSocialKinds/);
  assert.doesNotMatch(patched, /wireVeto=/);
});
