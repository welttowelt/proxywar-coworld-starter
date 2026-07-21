import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketServer } from "ws";

import { decideResponse, runPlayer } from "../llm-player.mjs";
import { createStandardController } from "../standard-controller.mjs";

function request(requestID, legalActions, observation = {}) {
  return {
    type: "decision_request",
    requestID,
    request: { protocolVersion: "proxywar-agent-v1", observation, legalActions },
  };
}

async function startServer() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

function receive(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try { resolve(JSON.parse(String(data))); }
      catch (error) { reject(error); }
    });
  });
}

function connected(server) {
  return new Promise((resolve) => server.once("connection", resolve));
}

async function withTimeout(promise, label, ms = 4_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("transport emits an offered exact ID once and replays duplicate requests exactly", async () => {
  const server = await startServer();
  const { port } = server.address();
  let calls = 0;
  const controllerFactory = () => ({
    decide({ legalActions }) {
      calls += 1;
      return {
        action: legalActions.find((action) => action.id === "expand:neutral:35"),
        route: "opening_neutral",
        markers: ["grind"],
        confidence: 0.97,
      };
    },
  });
  const connection = connected(server);
  const player = runPlayer({
    url: `ws://127.0.0.1:${port}`,
    controllerFactory,
    heartbeatMs: 1_000,
  });
  const socket = await connection;
  const actions = [
    { id: "hold", kind: "hold" },
    { id: "expand:neutral:35", kind: "attack", metadata: { expansion: true } },
  ];

  socket.send(JSON.stringify(request("req-1", actions)));
  const first = await receive(socket);
  socket.send(JSON.stringify(request("req-1", [...actions].reverse())));
  const duplicate = await receive(socket);
  socket.send(JSON.stringify({ type: "final" }));

  await withTimeout(player.completed, "clean transport completion");
  await new Promise((resolve) => server.close(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(duplicate, first);
  assert.equal(first.selectedLegalActionId, "expand:neutral:35");
  assert.equal(actions.some((action) => action.id === first.selectedLegalActionId), true);
  assert.equal(first.fallbackUsed, false);
  assert.equal(first.llmPlannerDegraded, false);
  assert.match(first.reason, /^std1:openingneutral:grind$/);
});

test("same request and action ID cannot replay after outsider target becomes K1Z Mickey", () => {
  const controller = createStandardController();
  const cache = new Map();
  const sharedID = "attack:opaque:25";
  const outsider = {
    id: sharedID,
    kind: "attack",
    label: "Attack Outsider 25%",
    metadata: {
      targetID: "outsider",
      targetName: "Outsider",
      troopPercent: 25,
    },
  };
  const mickey = {
    ...outsider,
    label: "Attack K1Z Mickey Mouse 25%",
    metadata: {
      targetID: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
      targetName: "K1Z Mickey Mouse",
      troopPercent: 25,
    },
  };
  const hold = { id: "hold", kind: "hold", label: "Hold" };
  const baseObservation = {
    phase: "active",
    alivePlayerCount: 2,
    ownState: { tileShare: 0.1, troops: 500_000, maxTroops: 1_000_000 },
    visiblePlayers: [],
  };

  const first = decideResponse(controller, request(
    "semantic-reuse",
    [outsider, hold],
    {
      ...baseObservation,
      visiblePlayers: [{
        id: "outsider",
        name: "Outsider",
        isAlive: true,
        canAttack: true,
        sharesBorder: true,
        relativeTroopRatio: 2,
        tileShare: 0.1,
      }],
    },
  ), cache);
  const changed = decideResponse(controller, request(
    "semantic-reuse",
    [mickey, hold],
    {
      ...baseObservation,
      visiblePlayers: [{
        id: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
        name: "K1Z Mickey Mouse",
        isAlive: true,
        canAttack: true,
        sharesBorder: true,
        relativeTroopRatio: 2,
        tileShare: 0.1,
      }],
    },
  ), cache);

  assert.equal(first.selectedLegalActionId, sharedID);
  assert.equal(changed.selectedLegalActionId, "hold");
  assert.equal(changed.fallbackUsed, true);
  assert.notDeepEqual(changed, first);
});

test("same request and actions cannot replay after visible target remaps to K1Z Mickey", () => {
  const controller = createStandardController();
  const cache = new Map();
  const opaqueAttack = {
    id: "attack:slot-7:25",
    kind: "attack",
    label: "Attack player 7 with 25%",
    metadata: { targetID: "slot-7", troopPercent: 25 },
  };
  const legalActions = [opaqueAttack, { id: "hold", kind: "hold", label: "Hold" }];
  const base = {
    phase: "active",
    alivePlayerCount: 2,
    ownState: { tileShare: 0.1, troops: 500_000, maxTroops: 1_000_000 },
  };
  const first = decideResponse(controller, request(
    "visible-remap",
    legalActions,
    {
      ...base,
      visiblePlayers: [{
        id: "slot-7",
        name: "Outsider",
        isAlive: true,
        canAttack: true,
        sharesBorder: true,
        relativeTroopRatio: 2,
        tileShare: 0.1,
      }],
    },
  ), cache);
  const changed = decideResponse(controller, request(
    "visible-remap",
    legalActions,
    {
      ...base,
      visiblePlayers: [{
        id: "slot-7",
        name: "K1Z Mickey Mouse",
        isAlive: true,
        canAttack: true,
        sharesBorder: true,
        relativeTroopRatio: 2,
        tileShare: 0.1,
      }],
    },
  ), cache);

  assert.equal(first.selectedLegalActionId, opaqueAttack.id);
  assert.equal(changed.selectedLegalActionId, "hold");
  assert.equal(changed.fallbackUsed, true);
  assert.notDeepEqual(changed, first);
});

test("transport rejects missing and duplicate legal-action IDs before controller dispatch", () => {
  let calls = 0;
  const controller = {
    decide() {
      calls += 1;
      return { selectedLegalActionId: "hold", route: "hold" };
    },
  };
  const duplicate = decideResponse(controller, request("dup", [
    { id: "hold", kind: "hold" },
    { id: "hold", kind: "attack" },
  ]));
  const missing = decideResponse(controller, request("missing", [
    { kind: "attack" },
  ]));

  assert.equal(calls, 0);
  assert.equal(duplicate.selectedLegalActionId, "hold");
  assert.equal(duplicate.fallbackUsed, true);
  assert.equal(missing.type, "decision_error");
  assert.equal(missing.fallbackUsed, true);
  assert.match(missing.error, /missinglegalacti/);
});

test("unexpected reconnect retains idempotence and explicit game reset clears it", async () => {
  const server = await startServer();
  const { port } = server.address();
  let calls = 0;
  let resets = 0;
  const controllerFactory = () => ({
    decide({ legalActions }) {
      calls += 1;
      const id = calls === 1 ? "attack:outsider:25" : "attack:outsider:40";
      return { action: legalActions.find((action) => action.id === id), route: "finish" };
    },
    reset() { resets += 1; },
  });
  const player = runPlayer({
    url: `ws://127.0.0.1:${port}`,
    controllerFactory,
    reconnectBaseMs: 10,
    heartbeatMs: 1_000,
  });
  const actions = [
    { id: "attack:outsider:25", kind: "attack" },
    { id: "attack:outsider:40", kind: "attack" },
    { id: "hold", kind: "hold" },
  ];
  const responses = [];
  let connections = 0;

  server.on("connection", async (socket) => {
    connections += 1;
    try {
      socket.send(JSON.stringify(request("repeat", actions)));
      responses.push(await receive(socket));
      if (connections === 1) {
        socket.close(1012, "fixture restart");
        return;
      }
      socket.send(JSON.stringify({ type: "game_reset" }));
      socket.send(JSON.stringify(request("repeat", actions)));
      responses.push(await receive(socket));
      socket.send(JSON.stringify({ type: "final" }));
    } catch (error) {
      player.close();
      throw error;
    }
  });

  await withTimeout(player.completed, "reconnect transport completion");
  await new Promise((resolve) => server.close(resolve));
  assert.equal(connections, 2);
  assert.equal(calls, 2);
  assert.equal(resets, 1);
  assert.deepEqual(
    responses.map((response) => response.selectedLegalActionId),
    ["attack:outsider:25", "attack:outsider:25", "attack:outsider:40"],
  );
});

test("invalid controller output degrades to offered HOLD and a no-HOLD fault is explicit", async () => {
  const server = await startServer();
  const { port } = server.address();
  const controllerFactory = () => ({
    decide({ requestID }) {
      if (requestID === "invalid-id") {
        return { selectedLegalActionId: "attack:not-offered:100", route: "bad" };
      }
      throw new Error("fixture_failure");
    },
  });
  const connection = connected(server);
  const player = runPlayer({
    url: `ws://127.0.0.1:${port}`,
    controllerFactory,
    heartbeatMs: 1_000,
  });
  const socket = await connection;

  socket.send(JSON.stringify(request("invalid-id", [
    { id: "attack:outsider:25", kind: "attack" },
    { id: "hold:safe", kind: "hold" },
  ])));
  const held = await receive(socket);
  socket.send(JSON.stringify(request("exception-no-hold", [
    { id: "attack:outsider:25", kind: "attack" },
  ])));
  const failed = await receive(socket);
  socket.send(JSON.stringify({ type: "final" }));

  await withTimeout(player.completed, "failure transport completion");
  await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(held, {
    type: "decision_response",
    requestID: "invalid-id",
    selectedLegalActionId: "hold:safe",
    reason: "std1:err:hold",
    confidence: 0,
    fallbackUsed: true,
    llmPlannerDegraded: true,
  });
  assert.equal(failed.type, "decision_error");
  assert.equal(failed.requestID, "exception-no-hold");
  assert.equal(failed.fallbackUsed, true);
  assert.equal(failed.llmPlannerDegraded, true);
  assert.match(failed.error, /^standard_controller_/);
});

test("controller-declared safety fallback remains loud on the wire", async () => {
  const server = await startServer();
  const { port } = server.address();
  const controllerFactory = () => ({
    decide({ legalActions }) {
      return {
        action: legalActions.find((action) => action.kind === "hold"),
        route: "cache_mismatch",
        markers: ["std1", "cache_mismatch"],
        confidence: 0,
        safety: { fallbackUsed: true },
      };
    },
  });
  const connection = connected(server);
  const player = runPlayer({
    url: `ws://127.0.0.1:${port}`,
    controllerFactory,
    heartbeatMs: 1_000,
  });
  const socket = await connection;
  socket.send(JSON.stringify(request("mismatch", [{ id: "hold", kind: "hold" }])));
  const response = await receive(socket);
  socket.send(JSON.stringify({ type: "final" }));

  await withTimeout(player.completed, "declared-fallback transport completion");
  await new Promise((resolve) => server.close(resolve));
  assert.equal(response.selectedLegalActionId, "hold");
  assert.equal(response.fallbackUsed, true);
  assert.equal(response.llmPlannerDegraded, true);
  assert.match(response.reason, /^std1:err:/);
});

test("production runtime excludes legacy planners and packages only the standard controller", async () => {
  const [source, dockerfile, packageJson, lockfile] = await Promise.all([
    readFile(new URL("../llm-player.mjs", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /Anthropic|Bedrock|strategy-engine|strategy-chassis|actions\s*\[\s*0\s*\]/i);
  assert.doesNotMatch(dockerfile, /POLICY_ENGINE|strategy-engine|strategy-chassis|planner-backoff|starter-player/);
  assert.match(dockerfile, /COPY llm-player\.mjs standard-controller\.mjs controller-safety\.mjs/);
  assert.doesNotMatch(packageJson, /anthropic|bedrock/i);
  assert.doesNotMatch(lockfile, /anthropic|bedrock/i);
});
