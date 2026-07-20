import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

const playerPath = fileURLToPath(
  new URL("../hrafn-chassis-player.mjs", import.meta.url),
);
const lowRisk = { level: "low" };
function request(requestID, legalActions, observation) {
  return {
    type: "decision_request",
    requestID,
    request: { legalActions, observation },
  };
}

function activeObservation(overrides = {}) {
  return {
    gameMode: "FFA",
    phase: "active",
    ownState: {
      tileShare: 0.05,
      troopRatio: 0.8,
      troops: 500000,
      gold: 250000,
      incomingAttacks: 0,
      unitCounts: {},
      ...(overrides.ownState ?? {}),
    },
    combat: { incomingAttackPlayerIDs: [] },
    visiblePlayers: [],
    ...overrides,
  };
}

function expansionMenu(extra = []) {
  return [
    {
      id: "expand:terra-nullius:10",
      kind: "attack",
      label: "Expand Terra Nullius 10%",
      metadata: { expansion: true, troopPercent: 10 },
      risk: lowRisk,
    },
    {
      id: "expand:terra-nullius:35",
      kind: "attack",
      label: "Expand Terra Nullius 35%",
      metadata: { expansion: true, troopPercent: 35 },
      risk: lowRisk,
    },
    ...extra,
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
}

function spawnPlayer(port, extraEnv = {}) {
  let stderr = "";
  let stdout = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      RECONNECT_BASE_MS: "20",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  return {
    child,
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("candidate player wiring executes the boot sequence and exact wire contract", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const city = {
    id: "build:City:100",
    kind: "build",
    label: "Build City",
    metadata: { unit: "City" },
    risk: lowRisk,
  };
  const requests = [
    request("spawn", [
      { id: "spawn:100", kind: "spawn", label: "Spawn 100", risk: lowRisk },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ], activeObservation({
      phase: "spawn",
      ownState: { tileShare: 0, troopRatio: 0.25 },
    })),
    ...[1, 2, 3, 4].map((index) =>
      request(
        `grow-${index}`,
        expansionMenu([city]),
        activeObservation({
          ownState: {
            tileShare: 0.02 * index,
            troopRatio: 0.6 + index / 20,
          },
        }),
      )
    ),
    request(
      "city",
      expansionMenu([city]),
      activeObservation({
        ownState: { tileShare: 0.1, troopRatio: 0.8 },
      }),
    ),
  ];

  const responses = [];
  const player = spawnPlayer(port);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn chassis integration timed out: ${player.stderr()}`,
      ));
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
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn chassis player exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.deepEqual(
    responses.map(({ selectedLegalActionId }) => selectedLegalActionId),
    [
      "spawn:100",
      "expand:terra-nullius:35",
      "expand:terra-nullius:35",
      "expand:terra-nullius:35",
      "expand:terra-nullius:35",
      "build:City:100",
    ],
  );
  for (const response of responses) {
    assert.equal(response.type, "decision_response");
    assert.equal(response.fallbackUsed, false);
    assert.equal(response.llmPlannerDegraded, false);
    assert.match(response.reason, /^\[K1Z\] r4vn:/);
    assert.ok(response.reason.length <= 48);
    assert.match(response.reason, /^[\x20-\x7e]+$/);
  }
  assert.equal(responses.at(-1).reason, "[K1Z] r4vn:bld:hec1");
});

test("reconnect duplicate IDs replay once and fresh IDs ignore withdrawn actions", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const repeated = request(
    "repeat",
    expansionMenu(),
    activeObservation(),
  );
  const fresh = request(
    "fresh",
    [
      {
        id: "build:City:100",
        kind: "build",
        label: "Build City",
        metadata: { unit: "City" },
        risk: lowRisk,
      },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ],
    activeObservation({
      ownState: { tileShare: 0.06, troopRatio: 0.8 },
    }),
  );

  const responses = [];
  let connections = 0;
  const player = spawnPlayer(port);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn reconnect integration timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.on("connection", (socket) => {
      connections += 1;
      if (connections === 1) {
        socket.send(JSON.stringify(repeated));
        socket.once("message", (data) => {
          responses.push(JSON.parse(String(data)));
          socket.close(1012, "test restart");
        });
        return;
      }
      socket.send(JSON.stringify(repeated));
      let secondConnectionResponses = 0;
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        secondConnectionResponses += 1;
        if (secondConnectionResponses === 1) {
          socket.send(JSON.stringify(fresh));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn chassis player exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.equal(connections, 2);
  assert.deepEqual(
    responses.map(({ selectedLegalActionId }) => selectedLegalActionId),
    [
      "expand:terra-nullius:35",
      "expand:terra-nullius:35",
      "build:City:100",
    ],
  );
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_chassis_decision");
  assert.deepEqual(
    telemetry.map(({ duplicateRequest }) => duplicateRequest),
    [false, true, false],
  );
  assert.equal(telemetry[2].actionID, "build:City:100");
});

test("withdrawn duplicate action returns a fail-closed hold without reconnecting", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const first = request("repeat-withdrawn", expansionMenu(), activeObservation());
  const withdrawn = request(
    "repeat-withdrawn",
    [
      {
        id: "build:City:100",
        kind: "build",
        label: "Build City",
        metadata: { unit: "City" },
        risk: lowRisk,
      },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ],
    activeObservation(),
  );

  let connections = 0;
  const responses = [];
  const player = spawnPlayer(port);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn fatal duplicate integration timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.on("connection", (socket) => {
      connections += 1;
      socket.send(JSON.stringify(first));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          socket.send(JSON.stringify(withdrawn));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn duplicate fallback exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.equal(connections, 1);
  assert.deepEqual(
    responses.map(({ selectedLegalActionId }) => selectedLegalActionId),
    ["expand:terra-nullius:35", "hold"],
  );
  assert.equal(responses[1].reason, "[K1Z] r4vn:h0d:hhfc");
  assert.equal(responses[1].fallbackUsed, true);
  assert.doesNotMatch(player.stderr(), /fail-closed decision error/);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_chassis_decision");
  assert.equal(telemetry[1].cacheConflict, "cached-action-withdrawn");
});

test("pipelined duplicate requests serialize before state commit", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const repeated = request("pipelined", expansionMenu(), activeObservation());
  const responses = [];
  const player = spawnPlayer(port);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn pipelined duplicate timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(repeated));
      socket.send(JSON.stringify(repeated));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 2) {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn pipelined duplicate exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.deepEqual(
    responses.map(({ selectedLegalActionId }) => selectedLegalActionId),
    ["expand:terra-nullius:35", "expand:terra-nullius:35"],
  );
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_chassis_decision");
  assert.deepEqual(
    telemetry.map(({ duplicateRequest }) => duplicateRequest),
    [false, true],
  );
});

test("wire player rejects a missing request ID before selecting or committing", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const responses = [];
  const player = spawnPlayer(port);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn request-ID rejection timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify({
        type: "decision_request",
        request: {
          legalActions: expansionMenu(),
          observation: activeObservation(),
        },
      }));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 1) resolve();
      else reject(new Error(
        `Hrafn invalid request-ID player exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.deepEqual(responses, []);
  assert.match(
    player.stderr(),
    /wire decision request had no exact non-empty string request ID/,
  );
});

test("idle no-pong socket survives until the delayed first active request", async () => {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    autoPong: false,
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const firstActiveRequest = request(
    "turn-400",
    expansionMenu(),
    activeObservation({
      turnNumber: 400,
      alivePlayerCount: 12,
      visiblePlayers: Array.from({ length: 11 }, (_, index) => ({
        id: `rival-${index + 1}`,
        name: `Rival ${index + 1}`,
        isAlive: true,
        tileShare: 0.08,
        relativeTroopRatio: 1,
      })),
    }),
  );

  let connections = 0;
  let response = null;
  let responseElapsedMs = Number.POSITIVE_INFINITY;
  let delayedRequestTimer = null;
  const player = spawnPlayer(port, { HRAFN_HEARTBEAT_MS: "50" });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn delayed-first-request test timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.on("connection", (socket) => {
      connections += 1;
      if (connections !== 1) return;
      delayedRequestTimer = setTimeout(() => {
        try {
          assert.equal(
            connections,
            1,
            "idle no-pong socket reconnected before the first active request",
          );
          assert.equal(
            socket.readyState,
            1,
            "idle no-pong socket closed before the first active request",
          );
          const requestSentAt = Date.now();
          socket.send(JSON.stringify(firstActiveRequest));
          socket.once("message", (data) => {
            responseElapsedMs = Date.now() - requestSentAt;
            response = JSON.parse(String(data));
            socket.send(JSON.stringify({ type: "final" }));
          });
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }, 175);
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn delayed-first-request player exited ${code}: ${
          player.stderr()
        }`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    if (delayedRequestTimer !== null) clearTimeout(delayedRequestTimer);
    if (player.child.exitCode === null && player.child.signalCode === null) {
      player.child.kill("SIGKILL");
      await new Promise((resolve) => player.child.once("exit", resolve));
    }
    await closeServer(server);
  }

  assert.equal(connections, 1);
  assert.equal(response?.selectedLegalActionId, "expand:terra-nullius:35");
  assert.equal(response?.reason, "[K1Z] r4vn:atk:hg35");
  assert.ok(
    responseElapsedMs < 500,
    `first active response took ${responseElapsedMs}ms`,
  );
  assert.doesNotMatch(player.stderr(), /missed heartbeat pong/);
});

test("handshake-close flapping retains exponential reconnect backoff", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const connectionTimes = [];
  let connections = 0;
  const player = spawnPlayer(port, { RECONNECT_BASE_MS: "80" });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(
        `Hrafn reconnect-backoff test timed out: ${player.stderr()}`,
      ));
    }, 8000);
    server.on("connection", (socket) => {
      connections += 1;
      connectionTimes.push(Date.now());
      if (connections < 3) {
        socket.close(1012, "handshake flap");
        return;
      }
      socket.send(JSON.stringify(
        request("backoff-stable", expansionMenu(), activeObservation()),
      ));
      socket.once("message", () => {
        socket.send(JSON.stringify({ type: "final" }));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(
        `Hrafn reconnect-backoff player exited ${code}: ${player.stderr()}`,
      ));
    });
  });

  try {
    await completed;
  } finally {
    await closeServer(server);
  }

  assert.equal(connections, 3);
  assert.ok(
    connectionTimes[2] - connectionTimes[1] >= 120,
    `second reconnect delay was only ${
      connectionTimes[2] - connectionTimes[1]
    }ms`,
  );
});

test("candidate player source hard-disables midgame support", async () => {
  const source = await readFile(playerPath, "utf8");
  assert.match(source, /enableMidgameSupport:\s*false/);
  assert.doesNotMatch(source, /AWS_|BEDROCK|ANTHROPIC/);
  assert.doesNotMatch(source, /HRAFN_RUNTIME_|hrafn-runtime-guard/);
  assert.doesNotMatch(source, /hrafnAwaitingPong|\.on\("pong"/);
  assert.doesNotMatch(source, /missed heartbeat pong/);
  assert.match(source, /activeSocket\.ping\(\)/);
});
