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
  for (const response of responses) {
    assert.match(response.reason, /^[a-z0-9:]+$/);
    assert.ok(response.reason.length <= 48);
    assert.equal(response.reason.toLowerCase().includes("weak"), false);
  }
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

test("planner contract communicates intent instead of a tactical playbook", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(playerPath, "utf8");
  assert.match(source, /INTENT:/);
  assert.match(source, /CONSTRAINTS:/);
  assert.match(source, /SUCCESS:/);
  assert.match(source, /FREEDOM:/);
  assert.match(source, /"intent":/);
  assert.doesNotMatch(source, /relativeTroopRatio 1\.3/);
  assert.doesNotMatch(source, /Commit 35% to neutral expansion/);
});

test("id1 wiring isolates the adapter from its static-grow parent", async () => {
  const lowRisk = { level: "low" };
  const decision = request("intent-grow", [
    {
      id: "alliance:katanasan",
      kind: "alliance_request",
      label: "Alliance with K1Z katanasan",
      risk: lowRisk,
      metadata: {
        recipientID: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
        recipientName: "K1Z katanasan",
        relation: 2,
      },
    },
    {
      id: "expand:terra-nullius:10",
      kind: "attack",
      label: "Expand into neutral land with 10% troops",
      risk: lowRisk,
      metadata: { expansion: true, troopPercent: 10 },
    },
  ], {
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
      id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
      name: "K1Z katanasan",
      isAlive: true,
      tileShare: 0.08,
      relativeTroopRatio: 1.2,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    }],
  });
  const cases = [
    {
      engine: "id1",
      selectedLegalActionId: "expand:terra-nullius:10",
      reason: /id1/,
    },
    {
      engine: "id1-static-parent",
      selectedLegalActionId: "alliance:katanasan",
      reason: /kp2/,
    },
  ];

  for (const expected of cases) {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const responses = [];
    let stderr = "";
    const child = spawn(process.execPath, [playerPath], {
      env: {
        ...process.env,
        COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
        POLICY_ENGINE: expected.engine,
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
        reject(new Error(`${expected.engine} wiring test timed out: ${stderr}`));
      }, 8000);
      server.once("connection", (socket) => {
        socket.send(JSON.stringify(decision));
        socket.on("message", (data) => {
          responses.push(JSON.parse(String(data)));
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

    assert.equal(responses[0].selectedLegalActionId, expected.selectedLegalActionId);
    assert.match(responses[0].reason, expected.reason);
    assert.equal(responses[0].fallbackUsed, false);
    assert.equal(responses[0].llmPlannerDegraded, false);
  }
});

test("qd2n engine wiring grinds the opening at 35 percent", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const requests = [
    request("grind", [
      {
        id: "expand:terra-nullius:10",
        kind: "attack",
        label: "Expand into neutral land with 10% troops",
        risk: lowRisk,
        metadata: { expansion: true, troopPercent: 10 },
      },
      {
        id: "expand:terra-nullius:20",
        kind: "attack",
        label: "Expand into neutral land with 20% troops",
        risk: lowRisk,
        metadata: { expansion: true, troopPercent: 20 },
      },
      {
        id: "expand:terra-nullius:35",
        kind: "attack",
        label: "Expand into neutral land with 35% troops",
        risk: lowRisk,
        metadata: { expansion: true, troopPercent: 35 },
      },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ], {
      phase: "active",
      ownState: {
        tileShare: 0.08, troopRatio: 0.8, troops: 500000, gold: 250000,
        borderTiles: 100, incomingAttacks: [], spawnTile: 1180588,
      },
      visiblePlayers: [],
    }),
  ];

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      POLICY_ENGINE: "qd2n",
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
      reject(new Error(`qd2n wiring test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(requests[0]));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
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

  assert.equal(responses[0].selectedLegalActionId, "expand:terra-nullius:35");
  assert.match(responses[0].reason, /ch1/);
});
