import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketServer } from "ws";

const playerPath = fileURLToPath(new URL("../llm-player.mjs", import.meta.url));

function request(requestID, legalActions, observation) {
  return {
    type: "decision_request",
    requestID,
    request: { legalActions, observation },
  };
}

test("deployed player wiring expands first and converts a weak rival next", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const baseOwnState = {
    troops: 500000,
    troopRatio: 0.8,
    gold: 250000,
    borderTiles: 100,
    incomingAttacks: [],
  };
  const rival = {
    id: "weak",
    name: "Weak",
    isAlive: true,
    tileShare: 0.08,
    relativeTroopRatio: 1.05,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
  };
  const requests = [
    request("spawn", [
      { id: "spawn:100", kind: "spawn", label: "Spawn 100", risk: lowRisk },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ], { phase: "spawn", ownState: { ...baseOwnState, tileShare: 0 }, visiblePlayers: [] }),
    request("expand", [
      { id: "boat:123:8", kind: "boat", label: "Boat to Terra Nullius 8%", risk: lowRisk },
      {
        id: "expand:terra-nullius:10",
        kind: "attack",
        label: "Expand into neutral land with 10% troops",
        risk: lowRisk,
        metadata: { expansion: true, troopPercent: 10 },
      },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ], { phase: "active", ownState: { ...baseOwnState, tileShare: 0.05 }, visiblePlayers: [] }),
    request("convert", [
      { id: "boat:456:8", kind: "boat", label: "Boat to Terra Nullius 8%", risk: lowRisk },
      { id: "attack:weak:10", kind: "attack", label: "Attack Weak 10%", risk: lowRisk },
      { id: "attack:weak:25", kind: "attack", label: "Attack Weak 25%", risk: lowRisk },
      {
        id: "expand:terra-nullius:10",
        kind: "attack",
        label: "Expand into neutral land with 10% troops",
        risk: lowRisk,
        metadata: { expansion: true, troopPercent: 10 },
      },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ], { phase: "active", ownState: { ...baseOwnState, tileShare: 0.2 }, visiblePlayers: [rival] }),
  ];

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_EC2_METADATA_DISABLED: "true",
      BEDROCK_MODEL: "invalid-test-model",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`player integration test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(requests[0]));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length < requests.length) {
          socket.send(JSON.stringify(requests[responses.length]));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
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

  assert.deepEqual(
    responses.map((response) => response.selectedLegalActionId),
    ["spawn:100", "expand:terra-nullius:10", "attack:weak:10"],
  );
});

test("deployed player reconnects after an unexpected match socket close", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const responses = [];
  let connections = 0;
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_EC2_METADATA_DISABLED: "true",
      BEDROCK_MODEL: "invalid-test-model",
      RECONNECT_BASE_MS: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`player reconnect test timed out: ${stderr}`));
    }, 8000);
    server.on("connection", (activeSocket) => {
      connections += 1;
      const decision = connections === 1
        ? request("first", [
            { id: "spawn:200", kind: "spawn", label: "Spawn 200", risk: lowRisk },
          ], { phase: "spawn", ownState: { tileShare: 0 }, visiblePlayers: [] })
        : request("second", [
            {
              id: "expand:terra-nullius:10",
              kind: "attack",
              label: "Expand into neutral land with 10% troops",
              risk: lowRisk,
              metadata: { expansion: true, troopPercent: 10 },
            },
          ], { phase: "active", ownState: { tileShare: 0.04 }, visiblePlayers: [] });
      activeSocket.send(JSON.stringify(decision));
      activeSocket.once("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (connections === 1) activeSocket.close(1012, "test restart");
        else activeSocket.send(JSON.stringify({ type: "final" }));
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

  assert.equal(connections, 2);
  assert.deepEqual(
    responses.map((response) => response.selectedLegalActionId),
    ["spawn:200", "expand:terra-nullius:10"],
  );
});
