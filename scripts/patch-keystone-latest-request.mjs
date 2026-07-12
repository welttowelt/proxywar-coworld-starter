import { readFile, writeFile } from "node:fs/promises";

const target = process.argv[2];
if (!target) {
  throw new Error("usage: node patch-keystone-latest-request.mjs <keystone-player.ts>");
}

const source = await readFile(target, "utf8");
const importAnchor =
  `import type { LlmProvider } from "../../src/server/agents/LlmProvider";`;
const leaderClampImport =
  `import { applyLeaderClamp } from "./keystone-leader-clamp.mjs";`;
if (!source.includes(importAnchor)) {
  throw new Error("canonical keystone import anchor was not found");
}
const withLeaderClampImport = source.replace(
  importAnchor,
  `${importAnchor}\n${leaderClampImport}`,
);

const oldBlock = `  // Serialize decision handling: a platform retry that overlaps an in-flight
  // request must not interleave brain.decide() on shared mutable state
  // (decisionsSincePlan, opponent-ledger rising-edge counters).
  let decisionChain: Promise<void> = Promise.resolve();
  let sawFinal = false;
  socket.on("message", (data: unknown) => {`;
const newBlock = `  // Keep shared brain state serialized, but coalesce overlapping platform retries.
  // A queued request can become stale before it reaches the executor; sending its
  // formerly legal action then makes the game validator fall back to hold.
  type DecisionMessage = {
    type?: unknown;
    requestID?: unknown;
    request?: unknown;
  };
  let decisionRunning = false;
  let pendingDecision: DecisionMessage | null = null;
  let sawFinal = false;

  const drainDecisions = async (): Promise<void> => {
    if (decisionRunning) return;
    decisionRunning = true;
    try {
      while (pendingDecision !== null && !sawFinal) {
        const current = pendingDecision;
        pendingDecision = null;
        const requestID = String(current.requestID ?? "");
        const startedAt = Date.now();
        let response: Record<string, unknown>;
        try {
          const input = requestToBrainInput(current.request);
          let decision = await brain.decide(input);
          decision = applyLeaderClamp(input, decision);
          response = decisionToResponse(requestID, decision);
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error);
          console.error(\`keystone decide failed: \${messageText}\`);
          response = transportFallbackResponse(
            requestID,
            current.request,
            messageText,
          );
        }
        if (bedrockDiag) {
          response.reason = \`\${bedrockDiag} || \${String(response.reason ?? "")}\`;
        }
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 5000) {
          console.warn(
            \`keystone decision took \${elapsedMs}ms — investigate before the clock bites\`,
          );
        }
        if (pendingDecision !== null) {
          console.warn(
            \`keystone: discarded superseded decision response \${requestID}\`,
          );
          continue;
        }
        socket.send(JSON.stringify(response));
      }
    } finally {
      decisionRunning = false;
      if (pendingDecision !== null && !sawFinal) void drainDecisions();
    }
  };

  socket.on("message", (data: unknown) => {`;

if (!withLeaderClampImport.includes(oldBlock)) {
  throw new Error("canonical keystone decision-loop anchor was not found");
}

const withDrain = withLeaderClampImport.replace(oldBlock, newBlock);
const queueStart = `    decisionChain = decisionChain.then(async () => {`;
const queueEnd = `      socket.send(JSON.stringify(response));
    });`;
const start = withDrain.indexOf(queueStart);
const end = withDrain.indexOf(queueEnd, start);
if (start === -1 || end === -1) {
  throw new Error("canonical keystone queued-decision block was not found");
}

const replacement = `    pendingDecision = message;
    void drainDecisions();`;
const patched =
  withDrain.slice(0, start) +
  replacement +
  withDrain.slice(end + queueEnd.length);

await writeFile(target, patched);
