import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketServer } from "ws";

const playerPath = fileURLToPath(new URL("../llm-player.mjs", import.meta.url));

test("transport-framed fixture is executable on the first K1Z-bearing decision", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const katanasanID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";
  const lowRisk = { level: "low" };
  const message = {
    type: "decision_request",
    requestID: "planner-transport-first-decision",
    request: {
      legalActions: [
        {
          id: "alliance:katanasan",
          kind: "alliance_request",
          label: "Alliance with K1Z katanasan",
          risk: lowRisk,
          metadata: {
            recipientID: katanasanID,
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
        { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
      ],
      observation: {
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
          id: katanasanID,
          name: "K1Z katanasan",
          isAlive: true,
          tileShare: 0.08,
          relativeTroopRatio: 1.2,
          sharesBorder: true,
          canAttack: true,
          isAllied: false,
        }],
      },
    },
  };

  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      INTENT_TEST_DIRECTIVE:
        'Planner packet:\n```json\n{"intent":"grow","targetID":null,"horizon":4}\n```',
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  let response;
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`planner transport runtime test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(message));
      socket.once("message", (data) => {
        response = JSON.parse(String(data));
        socket.send(JSON.stringify({ type: "final" }));
      });
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`player exited ${code}: ${stderr}`));
    });
  });

  try {
    await completed;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(response.selectedLegalActionId, "expand:terra-nullius:10");
  assert.equal(response.reason, "pln:atk:mm1g");
  assert.equal(response.fallbackUsed, false);
  assert.equal(response.llmPlannerDegraded, false);
});
