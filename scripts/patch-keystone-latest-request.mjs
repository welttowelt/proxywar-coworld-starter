import { readFile, writeFile } from "node:fs/promises";

const target = process.argv[2];
if (!target) {
  throw new Error("usage: node patch-keystone-latest-request.mjs <keystone-player.ts>");
}

const source = await readFile(target, "utf8");
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
  const oneShotSocialKinds = new Set([
    "alliance_request",
    "alliance_extend",
    "alliance_reject",
    "break_alliance",
    "target_player",
    "embargo",
    "embargo_stop",
    "embargo_all",
    "donate_gold",
    "donate_troops",
    "quick_chat",
    "emoji",
  ]);
  const vetoBackoff = new Map<string, number>();
  const vetoRemaining = new Map<string, number>();
  let submittedSocialIDs: string[] = [];

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
          for (const [id, remaining] of vetoRemaining) {
            if (remaining <= 1) vetoRemaining.delete(id);
            else vetoRemaining.set(id, remaining - 1);
          }
          const offeredIDs = new Set(input.legalActions.map((action) => action.id));
          for (const id of submittedSocialIDs) {
            if (offeredIDs.has(id)) {
              const window = Math.min(64, (vetoBackoff.get(id) ?? 4) * 2);
              vetoBackoff.set(id, window);
              vetoRemaining.set(id, window);
            } else {
              vetoBackoff.delete(id);
              vetoRemaining.delete(id);
            }
          }
          submittedSocialIDs = [];
          const vetoedActionIDs = input.legalActions
            .filter((action) => vetoRemaining.has(action.id))
            .map((action) => action.id);
          const filteredInput = {
            ...input,
            legalActions: input.legalActions.filter(
              (action) => !vetoRemaining.has(action.id),
            ),
          };
          let decision = await brain.decide(filteredInput);
          const filteredIDs = new Set(
            filteredInput.legalActions.map((action) => action.id),
          );
          const requestedIDs =
            decision.actionIDs !== undefined && decision.actionIDs.length > 0
              ? decision.actionIDs
              : [decision.actionID];
          const knownIDs = requestedIDs.filter((id) => filteredIDs.has(id));
          if (knownIDs.length === 0) {
            const fallback =
              filteredInput.legalActions.find((action) => action.kind === "hold") ??
              filteredInput.legalActions[0];
            if (fallback === undefined) {
              throw new Error("wire guard found no filtered legal action");
            }
            decision = {
              ...decision,
              actionID: fallback.id,
              actionIDs: undefined,
              reason: \`wire guard replaced unknown action ids \${requestedIDs.join(",")} with \${fallback.id}; \${decision.reason}\`,
            };
          } else if (knownIDs.length !== requestedIDs.length) {
            decision = {
              ...decision,
              actionID: knownIDs[0]!,
              actionIDs: knownIDs,
              reason: \`wire guard removed unknown action ids; \${decision.reason}\`,
            };
          }
          const submittedIDs =
            decision.actionIDs !== undefined && decision.actionIDs.length > 0
              ? decision.actionIDs
              : [decision.actionID];
          const nextSubmittedSocialIDs = submittedIDs.filter((id) => {
            const action = filteredInput.legalActions.find(
              (candidate) => candidate.id === id,
            );
            return action !== undefined && oneShotSocialKinds.has(action.kind);
          });
          response = decisionToResponse(requestID, decision);
          if (vetoedActionIDs.length > 0) {
            response.reason = \`wireVeto=\${vetoedActionIDs.join(",")} || \${String(response.reason ?? "")}\`;
          }
          if (pendingDecision === null) {
            submittedSocialIDs = nextSubmittedSocialIDs;
          }
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

if (!source.includes(oldBlock)) {
  throw new Error("canonical keystone decision-loop anchor was not found");
}

const withDrain = source.replace(oldBlock, newBlock);
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
