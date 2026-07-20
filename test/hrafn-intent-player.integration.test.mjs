import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

import { publicHrafnReason } from "../hrafn-strategy.mjs";
import {
  HRAFN_COWORLD_PROTOCOL_VERSION,
  HRAFN_COWORLD_RESPONSE_CONTRACT,
} from "../hrafn-intent.mjs";

const playerPath = fileURLToPath(
  new URL("../hrafn-intent-player.mjs", import.meta.url),
);
const lowRisk = { level: "low" };

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function requestPayloadSHA256(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function request(requestID) {
  return {
    type: "decision_request",
    requestID,
    request: {
      protocolVersion: HRAFN_COWORLD_PROTOCOL_VERSION,
      agent: {
        agentID: "hrafn-runtime",
        username: "K1Z Hrafn",
        profile: "opportunistic",
      },
      match: {
        gameID: "hi1-test-game",
        phase: "active",
        turnNumber: 1000,
        tick: null,
      },
      legalActions: [
        {
          id: "attack:auri:25",
          kind: "attack",
          label: "Attack Auri 25%",
          metadata: {
            targetID: "auri",
            targetName: "Auri",
            troopPercent: 25,
          },
          risk: lowRisk,
        },
        {
          id: "expand:terra-nullius:35",
          kind: "attack",
          label: "Expand Terra Nullius 35%",
          metadata: { expansion: true, troopPercent: 35 },
          risk: lowRisk,
        },
        { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
      ],
      observation: {
        ownState: {
          tileShare: 0.12,
          tileOwned: 12000,
          troopRatio: 1,
          troops: 500000,
          gold: 250000,
          incomingAttacks: 0,
        },
        combat: { incomingAttackPlayerIDs: [] },
        visiblePlayers: [{
          id: "auri",
          name: "Auri",
          tileShare: 0.25,
          relativeTroopRatio: 1.5,
          sharesBorder: true,
          canAttack: true,
          isAlive: true,
        }],
      },
      decisionSupport: {
        actionIDsByKind: {
          attack: ["attack:auri:25", "expand:terra-nullius:35"],
          hold: ["hold"],
        },
        recommendedActionKinds: [],
        usefulNonHoldActionIDs: [
          "attack:auri:25",
          "expand:terra-nullius:35",
        ],
        avoidActionIDs: [],
        safeFallbackActionID: "hold",
        antiStallHint: "A useful non-hold action is available.",
        parityNote: "Prefer legal progress.",
      },
      responseContract: HRAFN_COWORLD_RESPONSE_CONTRACT,
      unrelatedRootMetadata: {
        traceID: `trace-${requestID}`,
        nested: { acceptedButNotSelected: true },
      },
    },
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  if (typeof server.address === "function" && server.address() === null) return;
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
}

function spawnPlayer(wsPort, plannerPort, extraEnv = {}) {
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${wsPort}`,
      HRAFN_INTENT_ENABLED: "1",
      HRAFN_INTENT_ENDPOINT: `http://127.0.0.1:${plannerPort}/api/generate`,
      HRAFN_INTENT_TIMEOUT_MS: "2000",
      RECONNECT_BASE_MS: "20",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

function waitForPlayerOutput(player, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const output = player.stdout();
      if (predicate(output)) {
        clearInterval(poll);
        resolve(output);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for player output: ${output}`));
      }
    }, 5);
  });
}

test("HI1 accepts and discards extra root metadata while planning remains nonblocking", async () => {
  let plannerCalls = 0;
  let plannerBody = null;
  const plannerServer = createServer((incoming, response) => {
    let bytes = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => {
      bytes += chunk;
    });
    incoming.on("end", () => {
      plannerCalls += 1;
      plannerBody = JSON.parse(bytes);
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: "llama3:latest",
          response: JSON.stringify({
            objective: "grow",
            targetID: null,
            horizon: 6,
          }),
        }));
      }, 200);
    });
  });
  const plannerPort = await listen(plannerServer);

  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const wsPort = wsServer.address().port;
  const player = spawnPlayer(wsPort, plannerPort);
  const responses = [];
  const responseTimes = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 integration timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      let sentAt = Date.now();
      socket.send(JSON.stringify(request("first")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        responseTimes.push(Date.now() - sentAt);
        if (responses.length === 1) {
          void waitForPlayerOutput(
            player,
            (output) => output.includes('"event":"hrafn_intent_plan","attempt":1,"ok":true'),
            4000,
          ).then(() => {
            sentAt = Date.now();
            socket.send(JSON.stringify(request("first")));
          }, reject);
        } else if (responses.length === 2) {
          sentAt = Date.now();
          socket.send(JSON.stringify(request("fresh")));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 player exited ${code}: ${player.stderr()}`));
    });
  });

  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.deepEqual(
    responses.map((entry) => entry.selectedLegalActionId),
    [
      "attack:auri:25",
      "attack:auri:25",
      "expand:terra-nullius:35",
    ],
  );
  assert.doesNotMatch(responses[0].reason, /hi1/);
  assert.equal(responses[1].reason, responses[0].reason);
  assert.match(responses[2].reason, /:hi1(?:$|\.)/);
  assert.match(responses[0].reason, /\.q[0-9a-f]{10}$/);
  assert.ok(responseTimes[0] < 150, `first response took ${responseTimes[0]}ms`);
  assert.equal(plannerCalls, 1);
  assert.doesNotMatch(plannerBody.prompt, /attack:auri:25/);
  assert.doesNotMatch(plannerBody.prompt, /Attack Auri/);
  assert.equal(responses.every((entry) => entry.fallbackUsed === false), true);
  assert.equal(
    responses.every((entry) => entry.llmPlannerDegraded === false),
    true,
  );

  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const decisions = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_decision"
  );
  assert.deepEqual(
    decisions.map((entry) => entry.duplicateRequest),
    [false, false],
  );
  const retries = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_retry"
  );
  assert.equal(retries.length, 1);
  assert.equal(retries[0].requestID, "first");
  assert.equal(decisions[1].baselineActionID, "attack:auri:25");
  assert.equal(decisions[1].actionDelta, true);
  assert.equal(decisions[1].intentObjective, "grow");
  assert.match(decisions[1].requestMarker, /^q[0-9a-f]{10}$/);
  assert.deepEqual(decisions[0].decisionInput, {
    legalActions: request("first").request.legalActions,
    observation: request("first").request.observation,
  });
  assert.equal(Object.hasOwn(decisions[0].decisionInput, "unrelatedRootMetadata"), false);
  assert.equal(
    decisions[0].requestPayloadSHA256,
    requestPayloadSHA256(decisions[0].decisionInput),
  );
  assert.equal(decisions[0].selectedAction.id, "attack:auri:25");
  assert.equal(decisions[0].selectedAction.requestMarker, decisions[0].requestMarker);
  assert.deepEqual(decisions[0].rawLlmOutput, responses[0]);
  assert.equal(
    publicHrafnReason(decisions[0].selectedAction),
    decisions[0].rawLlmOutput.reason,
  );
  assert.equal(
    decisions[0].expectedModelDigest,
    "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1",
  );
  assert.equal(Object.hasOwn(decisions[0], "modelDigest"), false);
  assert.equal(decisions[1].intentAge, 1);
  assert.equal(decisions[1].intentRemainingBeforeCommit, 5);
  assert.equal(
    telemetry.some((entry) =>
      entry.event === "hrafn_intent_plan" && entry.ok === true
    ),
    true,
  );
});

test("HI1-disabled control never contacts the planner and stays exact-v5", async () => {
  let plannerCalls = 0;
  const plannerServer = createServer((_incoming, response) => {
    plannerCalls += 1;
    response.writeHead(500);
    response.end();
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const wsPort = wsServer.address().port;
  const player = spawnPlayer(wsPort, plannerPort, {
    HRAFN_INTENT_ENABLED: "0",
  });
  let wireResponse;

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 control timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("control")));
      socket.once("message", (data) => {
        wireResponse = JSON.parse(String(data));
        socket.send(JSON.stringify({ type: "final" }));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 control exited ${code}: ${player.stderr()}`));
    });
  });

  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.equal(wireResponse.selectedLegalActionId, "attack:auri:25");
  assert.match(wireResponse.reason, /^\[K1Z\] r4vn:atk:rv3\.q[0-9a-f]{10}$/);
  assert.equal(wireResponse.llmPlannerDegraded, false);
  assert.equal(plannerCalls, 0);
});

test("malformed planner output degrades truthfully while exact-v5 keeps responding", async () => {
  let plannerCalls = 0;
  const plannerServer = createServer((_incoming, response) => {
    plannerCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "llama3:latest",
      response: "{not-json",
    }));
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const wsPort = wsServer.address().port;
  const player = spawnPlayer(wsPort, plannerPort);
  const responses = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 degradation timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("degrade-first")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          void waitForPlayerOutput(player, (output) =>
            output.split(/\r?\n/).some((line) => {
              if (!line.startsWith("{")) return false;
              const entry = JSON.parse(line);
              return entry.event === "hrafn_intent_plan" && entry.ok === false;
            }), 4000).then(() => {
              socket.send(JSON.stringify(request("degrade-second")));
            }).catch((error) => {
              player.child.kill("SIGKILL");
              reject(error);
            });
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 degradation exited ${code}: ${player.stderr()}`));
    });
  });

  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.deepEqual(
    responses.map((entry) => entry.selectedLegalActionId),
    ["attack:auri:25", "attack:auri:25"],
  );
  assert.equal(responses[0].llmPlannerDegraded, false);
  assert.equal(responses[1].llmPlannerDegraded, true);
  assert.equal(responses[1].fallbackUsed, true);
  assert.equal(plannerCalls, 1, "planner failure ignored bounded retry backoff");
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.equal(
    telemetry.some((entry) =>
      entry.event === "hrafn_intent_plan" &&
      entry.ok === false &&
      /invalid planner JSON/.test(entry.error)
    ),
    true,
  );
});

test("an intent that becomes unreachable falls back and degrades truthfully", async () => {
  const plannerServer = createServer((_incoming, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "llama3:latest",
      response: JSON.stringify({ objective: "grow", targetID: null, horizon: 6 }),
    }));
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort);
  const responses = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 unreachable test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("reachable-source")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          void waitForPlayerOutput(player, (output) =>
            output.split(/\r?\n/).some((line) => {
              if (!line.startsWith("{")) return false;
              const entry = JSON.parse(line);
              return entry.event === "hrafn_intent_plan" && entry.ok === true;
            }), 4000).then(() => {
            const noGrowth = request("growth-vanished");
            noGrowth.request.legalActions = [
              noGrowth.request.legalActions[0],
              noGrowth.request.legalActions[2],
            ];
            socket.send(JSON.stringify(noGrowth));
          }).catch((error) => {
            player.child.kill("SIGKILL");
            reject(error);
          });
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 unreachable player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.equal(responses[1].selectedLegalActionId, "attack:auri:25");
  assert.equal(responses[1].fallbackUsed, true);
  assert.equal(responses[1].llmPlannerDegraded, true);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const lastDecision = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_decision"
  ).at(-1);
  assert.equal(lastDecision.intentReason, "intent_unreachable");
  assert.equal(lastDecision.intentValid, false);
});

test("a plan older than twelve committed decisions is rejected", async () => {
  const plannerServer = createServer((_incoming, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "llama3:latest",
        response: JSON.stringify({ objective: "grow", targetID: null, horizon: 6 }),
      }));
    }, 250);
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort);
  const responses = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 stale-plan test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("stale-0")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length < 14) {
          socket.send(JSON.stringify(request(`stale-${responses.length}`)));
        } else if (responses.length === 14) {
          setTimeout(() => {
            socket.send(JSON.stringify(request("after-stale")));
          }, 350);
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 stale-plan player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.equal(responses.at(-1).selectedLegalActionId, "attack:auri:25");
  assert.doesNotMatch(responses.at(-1).reason, /hi1/);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.equal(
    telemetry.some((entry) =>
      entry.event === "hrafn_intent_plan" &&
      entry.ok === false &&
      /stale/.test(entry.error)
    ),
    true,
  );
});

test("a delayed plan spends elapsed lifetime and later decisions return to epoch zero", async () => {
  let plannerCalls = 0;
  let releaseFirstPlan = false;
  let pendingFirstPlanResponse = null;
  const respondWithPlan = (response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "llama3:latest",
      response: JSON.stringify({
        objective: "grow",
        targetID: null,
        horizon: 4,
      }),
    }));
  };
  const plannerServer = createServer((_incoming, response) => {
    plannerCalls += 1;
    if (plannerCalls === 1) {
      if (releaseFirstPlan) respondWithPlan(response);
      else pendingFirstPlanResponse = response;
    }
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort);
  const responses = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 residual-horizon test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("residual-0")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length < 3) {
          socket.send(JSON.stringify(request(`residual-${responses.length}`)));
        } else if (responses.length === 3) {
          releaseFirstPlan = true;
          if (pendingFirstPlanResponse) {
            respondWithPlan(pendingFirstPlanResponse);
            pendingFirstPlanResponse = null;
          }
          void waitForPlayerOutput(player, (output) =>
            /"event":"hrafn_intent_plan".*"ok":true/.test(output)
          ).then(() => {
            socket.send(JSON.stringify(request("residual-apply")));
          }).catch(reject);
        } else if (responses.length === 4) {
          socket.send(JSON.stringify(request("residual-inactive")));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 residual-horizon player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.deepEqual(
    responses.map((entry) => entry.selectedLegalActionId),
    [
      "attack:auri:25",
      "attack:auri:25",
      "attack:auri:25",
      "expand:terra-nullius:35",
      "attack:auri:25",
    ],
  );
  assert.ok(plannerCalls >= 1);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const firstPlan = telemetry.find((entry) =>
    entry.event === "hrafn_intent_plan" && entry.ok === true
  );
  const decisions = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_decision"
  );
  assert.equal(firstPlan.intentSourceDecision, 0);
  assert.equal(firstPlan.intentAge, 3);
  assert.equal(decisions[3].intentEpoch, 1);
  assert.equal(decisions[3].intentAge, 3);
  assert.equal(decisions[3].intentRemainingBeforeCommit, 1);
  assert.equal(decisions[3].actionDelta, true);
  assert.equal(decisions[4].intentEpoch, 0);
  assert.equal(decisions[4].intentObjective, null);
  assert.equal(decisions[4].intentSourceDecision, null);
  assert.equal(decisions[4].intentAge, null);
  assert.equal(decisions[4].intentRemainingBeforeCommit, 0);
  assert.equal(decisions[4].actionDelta, false);
});

test("a delayed plan expires when its horizon has no remaining decisions", async () => {
  let releasePlan = false;
  let pendingPlanResponse = null;
  const respondWithPlan = (response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "llama3:latest",
      response: JSON.stringify({
        objective: "grow",
        targetID: null,
        horizon: 2,
      }),
    }));
  };
  const plannerServer = createServer((_incoming, response) => {
    if (releasePlan) respondWithPlan(response);
    else pendingPlanResponse = response;
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort);
  const responses = [];

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 expired-horizon test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("expired-0")));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length === 1) {
          socket.send(JSON.stringify(request("expired-1")));
        } else if (responses.length === 2) {
          releasePlan = true;
          if (pendingPlanResponse) {
            respondWithPlan(pendingPlanResponse);
            pendingPlanResponse = null;
          }
          void waitForPlayerOutput(player, (output) =>
            /"event":"hrafn_intent_plan".*"ok":false.*expired/.test(output)
          ).then(() => {
            socket.send(JSON.stringify(request("expired-after-arrival")));
          }).catch(reject);
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 expired-horizon player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.deepEqual(
    responses.map((entry) => entry.selectedLegalActionId),
    ["attack:auri:25", "attack:auri:25", "attack:auri:25"],
  );
  assert.equal(responses[2].fallbackUsed, true);
  assert.equal(responses[2].llmPlannerDegraded, true);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const expired = telemetry.find((entry) =>
    entry.event === "hrafn_intent_plan" && entry.ok === false
  );
  const lastDecision = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_decision"
  ).at(-1);
  assert.match(expired.error, /expired.*horizon/i);
  assert.equal(expired.intentSourceDecision, 0);
  assert.equal(expired.intentAge, 2);
  assert.equal(lastDecision.intentEpoch, 0);
  assert.equal(lastDecision.intentObjective, null);
  assert.equal(lastDecision.actionDelta, false);
});

test("the request cache retains the full match and rejects semantic ID reuse", async () => {
  let plannerCalls = 0;
  const plannerServer = createServer((_incoming, response) => {
    plannerCalls += 1;
    response.writeHead(500);
    response.end();
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort, {
    HRAFN_INTENT_ENABLED: "0",
  });
  let responseCount = 0;

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 cache-retention test timed out: ${player.stderr()}`));
    }, 15000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("cache-0")));
      socket.on("message", () => {
        responseCount += 1;
        if (responseCount <= 519) {
          socket.send(JSON.stringify(request(`cache-${responseCount}`)));
        } else if (responseCount === 520) {
          socket.send(JSON.stringify(request("cache-0")));
        } else {
          socket.send(JSON.stringify({ type: "final" }));
        }
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 cache-retention player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.equal(responseCount, 521);
  assert.equal(plannerCalls, 0);
  const decisions = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_intent_decision");
  assert.equal(decisions.length, 520);
  const retries = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_intent_retry");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].requestID, "cache-0");
});

test("a duplicate request ID with changed selector input fails closed", async (t) => {
  for (const [name, mutate] of [
    ["observation", (message) => {
      message.request.observation.ownState.gold += 1;
    }],
    ["unmodeled action field", (message) => {
      message.request.legalActions[0].unmodeled = "drift";
    }],
  ]) await t.test(name, async () => {
  const plannerServer = createServer((_incoming, response) => {
    response.writeHead(500);
    response.end();
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort, {
    HRAFN_INTENT_ENABLED: "0",
  });

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 cache-conflict test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("semantic-conflict")));
      socket.once("message", () => {
        const changed = request("semantic-conflict");
        mutate(changed);
        socket.send(JSON.stringify(changed));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 1) resolve();
      else reject(new Error(`HI1 cache-conflict player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.match(
    player.stderr(),
    /duplicate request semantic conflict|requires a legalActions array/,
  );
  });
});

test("queued decisions measure latency from their original arrival", async () => {
  const plannerServer = createServer((_incoming, response) => {
    response.writeHead(500);
    response.end();
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort, {
    HRAFN_INTENT_ENABLED: "0",
    NODE_ENV: "test",
    HRAFN_TEST_SEND_DELAY_MS: "80",
  });
  let responses = 0;

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 arrival-timestamp test timed out: ${player.stderr()}`));
    }, 8000);
    wsServer.once("connection", (socket) => {
      socket.send(JSON.stringify(request("queued-first")));
      socket.send(JSON.stringify(request("queued-second")));
      socket.on("message", () => {
        responses += 1;
        if (responses === 2) socket.send(JSON.stringify({ type: "final" }));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`HI1 arrival-timestamp player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  const decisions = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "hrafn_intent_decision");
  assert.equal(decisions.length, 2);
  assert.ok(decisions[0].responseLatencyMs >= 60);
  assert.ok(
    decisions[1].responseLatencyMs >= 130,
    `queued latency started late: ${decisions[1].responseLatencyMs}`,
  );
  assert.ok(
    decisions[1].requestArrivalTimestampMs <= decisions[0].responseTimestampMs,
  );
});

test("reconnect retries an unresolved exact payload once and rejects later drift", async () => {
  const plannerServer = createServer((_incoming, response) => {
    response.writeHead(500);
    response.end();
  });
  const plannerPort = await listen(plannerServer);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wsServer.once("listening", resolve));
  const player = spawnPlayer(wsServer.address().port, plannerPort, {
    HRAFN_INTENT_ENABLED: "0",
    NODE_ENV: "test",
    HRAFN_TEST_SEND_DELAY_MS: "120",
  });
  let connections = 0;
  let retryResponse = null;

  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      player.child.kill("SIGKILL");
      reject(new Error(`HI1 reconnect test timed out: ${player.stderr()}`));
    }, 10000);
    wsServer.on("connection", (socket) => {
      connections += 1;
      socket.send(JSON.stringify(request("reconnect-once")));
      if (connections === 1) {
        setTimeout(() => socket.terminate(), 25);
        return;
      }
      socket.once("message", (data) => {
        retryResponse = JSON.parse(String(data));
        const changed = request("reconnect-once");
        changed.request.observation.ownState.gold += 1;
        socket.send(JSON.stringify(changed));
      });
    });
    player.child.once("error", reject);
    player.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 1) resolve();
      else reject(new Error(`HI1 reconnect player exited ${code}: ${player.stderr()}`));
    });
  });
  try {
    await completed;
  } finally {
    await close(wsServer);
    await close(plannerServer);
  }

  assert.ok(connections >= 2);
  assert.equal(retryResponse.selectedLegalActionId, "attack:auri:25");
  assert.match(player.stderr(), /duplicate request semantic conflict/);
  const telemetry = player.stdout()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const decisions = telemetry.filter((entry) =>
    entry.event === "hrafn_intent_decision"
  );
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].wireRetry, true);
  assert.equal(decisions[0].decisionIndex, 1);
  assert.equal(
    telemetry.filter((entry) => entry.event === "hrafn_intent_retry").length,
    0,
  );
});
