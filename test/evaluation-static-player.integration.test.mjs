import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketServer } from "ws";
import { evaluationResponseMetadata } from "../evaluation-static-intent-player.mjs";

const playerPaths = Object.freeze({
  m0: fileURLToPath(new URL("../evaluation-m0-player.mjs", import.meta.url)),
  "grow-opening": fileURLToPath(
    new URL("../evaluation-grow-opening-player.mjs", import.meta.url),
  ),
});
const coalitionID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";
const lowRisk = { level: "low" };

const legalActions = [
  {
    id: "alliance:katanasan",
    kind: "alliance_request",
    label: "Alliance with K1Z katanasan",
    risk: lowRisk,
    metadata: {
      recipientID: coalitionID,
      recipientName: "K1Z katanasan",
      relation: 2,
    },
  },
  {
    id: "expand:terra-nullius:10",
    kind: "attack",
    label: "Expand Terra Nullius 10%",
    risk: lowRisk,
    metadata: { expansion: true, troopPercent: 10 },
  },
];

const observation = {
  phase: "active",
  ownState: {
    tileShare: 0.05,
    troopRatio: 0.8,
    troops: 500000,
    gold: 250000,
    borderTiles: 100,
    incomingAttacks: [],
  },
  visiblePlayers: [{
    id: coalitionID,
    name: "K1Z katanasan",
    isAlive: true,
    tileShare: 0.08,
    relativeTroopRatio: 1.2,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
  }],
};

async function runArm(arm) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  let stdout = "";
  let stderr = "";
  let response;
  const child = spawn(process.execPath, [playerPaths[arm]], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`static evaluation player timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify({
        type: "decision_request",
        requestID: `${arm}-1`,
        request: { legalActions, observation },
      }));
      socket.once("message", (data) => {
        response = JSON.parse(String(data));
        socket.send(JSON.stringify({ type: "final" }));
      });
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`static evaluation player exited ${code}: ${stderr}`));
    });
  });

  try {
    await completed;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    response,
    telemetry: stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test("static response flags cannot satisfy the production planner-health gate", () => {
  assert.deepEqual(evaluationResponseMetadata(false), {
    confidence: 0.4,
    fallbackUsed: true,
    llmPlannerDegraded: true,
  });
  assert.deepEqual(evaluationResponseMetadata(true), evaluationResponseMetadata(false));
});

test("M0 runtime reports static source and remains exact baseline", async () => {
  const { response, telemetry } = await runArm("m0");
  assert.equal(response.selectedLegalActionId, "alliance:katanasan");
  assert.equal(response.reason, "sev1:m0:base:4ly:kp2");
  assert.equal(response.fallbackUsed, true);
  assert.equal(response.llmPlannerDegraded, true);
  assert.deepEqual(telemetry[0], {
    type: "evaluation_static_intent_start",
    source: "static-eval-v1",
    arm: "m0",
    uploadEligible: false,
  });
  assert.equal(telemetry[1].actionDelta, false);
  assert.equal(telemetry[1].requestID, "m0-1");
  assert.equal(telemetry[1].scheduled, false);
  assert.equal(telemetry[1].reached, false);
  assert.equal(telemetry[1].baselineActionID, "alliance:katanasan");
  assert.equal(telemetry[1].selectedActionID, "alliance:katanasan");
  assert.equal(telemetry[1].selectedActionKind, "alliance_request");
  assert.equal(telemetry[1].policyMarker, "kp2");
});

test("grow-opening runtime reports a real mm1g action delta", async () => {
  const { response, telemetry } = await runArm("grow-opening");
  assert.equal(response.selectedLegalActionId, "expand:terra-nullius:10");
  assert.equal(response.reason, "sev1:go1:rch:atk:mm1g");
  assert.equal(response.fallbackUsed, true);
  assert.equal(response.llmPlannerDegraded, true);
  assert.equal(telemetry[0].source, "static-eval-v1");
  assert.equal(telemetry[0].arm, "grow-opening");
  assert.equal(telemetry[0].uploadEligible, false);
  assert.equal(telemetry[1].directive, "grow");
  assert.equal(telemetry[1].scheduled, true);
  assert.equal(telemetry[1].reached, true);
  assert.equal(telemetry[1].directiveTargetID, null);
  assert.equal(telemetry[1].actionDelta, true);
  assert.equal(telemetry[1].baselineActionID, "alliance:katanasan");
  assert.equal(telemetry[1].selectedActionID, "expand:terra-nullius:10");
  assert.equal(telemetry[1].selectedActionKind, "attack");
  assert.equal(telemetry[1].policyMarker, "mm1g");
});
