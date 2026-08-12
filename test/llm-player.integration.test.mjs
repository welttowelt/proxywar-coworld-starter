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
    assert.match(response.reason, /^rul:/);
    assert.ok(response.reason.length <= 48);
    assert.equal(response.reason.toLowerCase().includes("weak"), false);
    assert.equal(response.fallbackUsed, false);
    assert.equal(response.llmPlannerDegraded, false);
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

test("deployed player exposes gc1 beside the retained tactical marker", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const juryokuID = "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335";
  const katanasanID = "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba";
  const baseOwnState = {
    tileShare: 0.3,
    troopRatio: 0.9,
    troops: 500000,
    gold: 250000,
    borderTiles: 100,
    incomingAttacks: [],
    spawnTile: 1180588,
  };
  const requests = [
    request("kata", [{
      id: "alliance:kata:0",
      kind: "alliance_request",
      label: "Request alliance with K1Z katanasan",
      risk: lowRisk,
      metadata: {
        recipientID: katanasanID,
        recipientName: "K1Z katanasan",
        relation: 2,
      },
    }], {
      phase: "active",
      ownState: baseOwnState,
      combat: { incomingAttackPlayerIDs: [] },
      visiblePlayers: [{
        id: katanasanID,
        name: "K1Z katanasan",
        isAlive: true,
        tileShare: 0.12,
        relativeTroopRatio: 1.1,
        sharesBorder: true,
        canAttack: true,
        isAllied: false,
      }],
    }),
    request("gc1", [
      {
        id: "alliance:grav:1",
        kind: "alliance_request",
        label: "Request alliance with K1Z juryoku-koku",
        risk: lowRisk,
        metadata: {
          recipientID: juryokuID,
          recipientName: "K1Z juryoku-koku",
          relation: 2,
        },
      },
      {
        id: "attack:raider:10",
        kind: "attack",
        label: "Attack Raider 10%",
        risk: lowRisk,
        metadata: {
          targetID: "raider",
          targetName: "Raider",
          troopPercent: 10,
          incomingAttack: true,
        },
      },
    ], {
      phase: "active",
      ownState: baseOwnState,
      combat: { incomingAttackPlayerIDs: ["raider"] },
      visiblePlayers: [
        {
          id: juryokuID,
          name: "K1Z juryoku-koku",
          isAlive: true,
          tileShare: 0.12,
          relativeTroopRatio: 1.1,
          sharesBorder: true,
          canAttack: true,
          isAllied: false,
        },
        {
          id: "raider",
          name: "Raider",
          isAlive: true,
          tileShare: 0.15,
          relativeTroopRatio: 1.8,
          sharesBorder: true,
          canAttack: true,
          incomingAttack: true,
          isAllied: false,
        },
      ],
    }),
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
      reject(new Error(`gc1 marker integration test timed out: ${stderr}`));
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
    ["alliance:kata:0", "attack:raider:10"],
  );
  assert.match(responses[1].reason, /:gc1:ia1$/);
});

test("intent-core planner asks only for outcome and optional target", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(playerPath, "utf8");
  const doctrine = await readFile(
    fileURLToPath(new URL("../captain-underpants-production-doctrine.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(doctrine, /INTENT:/);
  assert.match(doctrine, /CONSTRAINTS:/);
  assert.match(doctrine, /SUCCESS:/);
  assert.match(doctrine, /FREEDOM:/);
  assert.match(doctrine, /CAPTAIN_UNDERPANTS_PRODUCTION_DOCTRINE/);
  assert.match(source, /process\.env\.PLAN_MODE === "on"/);
  assert.match(source, /"intent":/);
  assert.match(source, /"targetID":/);
  assert.match(source, /exactly these two keys/);
  assert.match(source, /\{"intent":"expand","targetID":null\}/);
  assert.match(source, /"horizon":/);
  assert.match(source, /max_tokens: 300/);
  assert.match(source, /Array\.isArray\(r\?\.content\)/);
  assert.match(source, /\.join\("\\n"\)/);
  assert.doesNotMatch(source, /"focus":/);
  assert.doesNotMatch(source, /"preferKinds":/);
  assert.doesNotMatch(source, /"avoidTargets":/);
  assert.doesNotMatch(source, /relativeTroopRatio 1\.3/);
  assert.doesNotMatch(source, /Commit 35% to neutral expansion/);
});

test("a normalized nondegraded intent reaches the deployed MM1 selector", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const legalActions = [
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
      label: "Expand Terra Nullius 10%",
      risk: lowRisk,
      metadata: { expansion: true, troopPercent: 10 },
    },
  ];
  const obs = {
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
  };
  const spawnActions = [
    { id: "spawn:100", kind: "spawn", label: "Spawn 100", risk: lowRisk },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
  const spawnObservation = {
    phase: "spawn",
    ownState: { ...obs.ownState, tileShare: 0 },
    visiblePlayers: [],
  };

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      INTENT_TEST_DIRECTIVE: JSON.stringify({
        intent: "grow",
        targetID: null,
        horizon: 4,
      }),
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`intent wiring test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      // Production planning remains nonblocking. The deterministic test packet
      // is parsed synchronously so every traced fixture decision is attributed
      // to the planner path, including spawn.
      socket.send(JSON.stringify(request("intent-1", spawnActions, spawnObservation)));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          setTimeout(() => {
            socket.send(JSON.stringify(request("intent-2", legalActions, obs)));
          }, 20);
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

  assert.equal(responses[0].selectedLegalActionId, "spawn:100");
  assert.equal(responses[0].fallbackUsed, false);
  assert.equal(responses[1].selectedLegalActionId, "expand:terra-nullius:10");
  assert.equal(responses[1].fallbackUsed, false);
  assert.match(responses[1].reason, /mm1g/);
});

test("an exact visible convert intent reaches the deployed MM1 selector", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const legalActions = [
    {
      id: "attack:weak:10",
      kind: "attack",
      label: "Attack Weak 10%",
      risk: lowRisk,
      metadata: { targetID: "weak", targetName: "Weak", troopPercent: 10 },
    },
    {
      id: "attack:large:10",
      kind: "attack",
      label: "Attack Large 10%",
      risk: lowRisk,
      metadata: { targetID: "large", targetName: "Large", troopPercent: 10 },
    },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
  const obs = {
    phase: "active",
    ownState: {
      tileShare: 0.2,
      troopRatio: 0.8,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: [],
    },
    visiblePlayers: [
      {
        id: "weak", name: "Weak", isAlive: true, tileShare: 0.08,
        relativeTroopRatio: 2.2, sharesBorder: true, canAttack: true, isAllied: false,
      },
      {
        id: "large", name: "Large", isAlive: true, tileShare: 0.2,
        relativeTroopRatio: 1.5, sharesBorder: true, canAttack: true, isAllied: false,
      },
    ],
  };

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      INTENT_TEST_DIRECTIVE: JSON.stringify({
        intent: "convert",
        targetID: "large",
        horizon: 4,
      }),
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`convert intent wiring test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(request("convert-1", legalActions, obs)));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          setTimeout(() => {
            socket.send(JSON.stringify(request("convert-2", legalActions, obs)));
          }, 20);
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

  assert.equal(responses[0].selectedLegalActionId, "attack:large:10");
  assert.equal(responses[0].fallbackUsed, false);
  assert.equal(responses[1].selectedLegalActionId, "attack:large:10");
  assert.equal(responses[1].fallbackUsed, false);
  assert.equal(responses[1].llmPlannerDegraded, false);
  assert.match(responses[1].reason, /mm1c/);
});

test("intent-core wiring executes the planner outcome without the legacy selector", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const mickeyID = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";
  const baseOwnState = {
    troops: 500000,
    troopRatio: 0.8,
    gold: 250000,
    borderTiles: 100,
    incomingAttacks: [],
  };
  const spawnRequest = request("intent-core-spawn", [
    { id: "spawn:100", kind: "spawn", label: "Spawn 100", risk: lowRisk },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ], {
    phase: "spawn",
    ownState: { ...baseOwnState, tileShare: 0 },
    visiblePlayers: [],
  });
  const active = request("intent-core-expand", [
    {
      id: `alliance:${mickeyID}`,
      kind: "alliance_request",
      label: "Request alliance with K1Z Mickey Mouse",
      risk: lowRisk,
      metadata: {
        recipientID: mickeyID,
        recipientName: "K1Z Mickey Mouse",
        relation: 2,
      },
    },
    {
      id: "expand:terra-nullius:35",
      kind: "attack",
      label: "Expand Terra Nullius 35%",
      risk: lowRisk,
      metadata: { expansion: true, troopPercent: 35 },
    },
  ], {
    phase: "active",
    ownState: { ...baseOwnState, tileShare: 0.05 },
    visiblePlayers: [{
      id: mickeyID,
      name: "K1Z Mickey Mouse",
      isAlive: true,
      tileShare: 0.08,
      relativeTroopRatio: 1.2,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
    }],
  });

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      POLICY_ENGINE: "intent-core",
      INTENT_TEST_DIRECTIVE: JSON.stringify({
        intent: "expand",
        targetID: null,
      }),
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`intent-core wiring test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(spawnRequest));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) socket.send(JSON.stringify(active));
        else socket.send(JSON.stringify({ type: "final" }));
      });
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`intent-core player exited ${code}: ${stderr}`));
    });
  });

  try {
    await completed;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(responses[0].selectedLegalActionId, "spawn:100");
  assert.equal(responses[0].fallbackUsed, false);
  assert.equal(responses[1].selectedLegalActionId, "expand:terra-nullius:35");
  assert.equal(responses[1].fallbackUsed, false);
  assert.match(responses[1].reason, /^pln:atk:ixexp$/);
});

test("intent-core starts from an honest expand outcome while the planner is pending", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const active = request("intent-core-bootstrap", [
    {
      id: "expand:terra-nullius:35",
      kind: "attack",
      label: "Expand Terra Nullius 35%",
      risk: lowRisk,
      metadata: { expansion: true, troopPercent: 35 },
    },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ], {
    phase: "active",
    ownState: {
      tileShare: 0.05, troopRatio: 0.8, troops: 500000, gold: 250000,
      borderTiles: 100, incomingAttacks: [],
    },
    visiblePlayers: [],
  });

  let response;
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      PLAN_MODE: "on",
      POLICY_ENGINE: "intent-core",
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
      reject(new Error(`intent bootstrap test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(active));
      socket.on("message", (data) => {
        response = JSON.parse(String(data));
        socket.send(JSON.stringify({ type: "final" }));
      });
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`intent bootstrap player exited ${code}: ${stderr}`));
    });
  });

  try {
    await completed;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(response.selectedLegalActionId, "expand:terra-nullius:35");
  assert.equal(response.fallbackUsed, false);
  assert.equal(response.llmPlannerDegraded, false);
  assert.match(response.reason, /^dft:atk:ixexp$/);
});

test("a single transport-framed planner reply reaches the deployed player", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const legalActions = [
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
      label: "Expand Terra Nullius 10%",
      risk: lowRisk,
      metadata: { expansion: true, troopPercent: 10 },
    },
  ];
  const obs = {
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
  };

  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      INTENT_TEST_DIRECTIVE:
        'plan: {"intent":"grow","targetID":null,"horizon":4}',
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`transport-framed planner test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(request("invalid-1", legalActions, obs)));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          setTimeout(() => {
            socket.send(JSON.stringify(request("invalid-2", legalActions, obs)));
          }, 20);
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
    ["expand:terra-nullius:10", "expand:terra-nullius:10"],
  );
  assert.equal(responses[0].fallbackUsed, false);
  assert.equal(responses[1].fallbackUsed, false);
  assert.equal(responses[1].llmPlannerDegraded, false);
  assert.match(responses[1].reason, /^pln:/);
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
