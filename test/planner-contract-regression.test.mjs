// Red regression for the round-1325 planner-protocol failure of
// "odinfree max underpants / underpants switch speed:v2" (engine 0.1.25,
// 2026-08-08): 464/488 decisions degraded with
//   BOOTSTRAP RULE (plan refresh failed: plan reply violated the typed contract)
// and six decisions emitted a stale alliance action ID and fell back to hold.
//
// Run against the pre-repair parser, the transport-recovery block below FAILS
// (red), reproducing the deployed rejection of provider-framed packets. Run
// against the repaired parser it passes, while every semantic violation and
// every ambiguous transport stays rejected (fail closed).
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

import { parseIntentDirective } from "../intent-controller.mjs";

const playerPath = fileURLToPath(new URL("../llm-player.mjs", import.meta.url));

const state = {
  mapFingerprint: "World",
  phase: "active",
  decisionNumber: 34,
  self: { tileShare: 0.02, troopRatio: 0.8, allProtocolAttackerIDs: [] },
  rivals: [
    {
      id: "c4o8gv6v", name: "CYAN HELLSTAR", tileShare: 0.05,
      relativeTroopRatio: 1.2, sharesBorder: false, isAllied: false, canAttack: false,
    },
    {
      id: "2rmhbq4h", name: "Auri", tileShare: 0.2,
      relativeTroopRatio: 1.8, sharesBorder: true, isAllied: false, canAttack: true,
    },
  ],
  legalActions: [
    { id: "expand:terra-nullius:10", kind: "attack" },
    { id: "alliance:c4o8gv6v", kind: "alliance_request" },
    { id: "hold", kind: "hold" },
  ],
  recentKinds: ["attack", "boat"],
};

const growPacket = '{"intent":"grow","targetID":null,"horizon":4}';
const convertPacket = '{"intent":"convert","targetID":"2rmhbq4h","horizon":6}';

test("round-1325 class: transport-framed packets are recovered, not rejected", () => {
  const grow = { intent: "grow", targetID: null, horizon: 4, model: "us.anthropic.claude-sonnet-4-6" };
  const convert = { intent: "convert", targetID: "2rmhbq4h", horizon: 6, model: "us.anthropic.claude-sonnet-4-6" };
  const framedReplies = [
    ["```json\n" + growPacket + "\n```", grow],
    ["```\n" + growPacket + "\n```", grow],
    [`Here is my mission packet: ${growPacket}`, grow],
    [`${growPacket}\n\nThis keeps expansion compounding.`, grow],
    ["```json\n" + convertPacket + "\n```", convert],
    [`I will pressure the leader.\n${convertPacket}`, convert],
  ];
  for (const [reply, expected] of framedReplies) {
    assert.deepEqual(
      parseIntentDirective(reply, state, "us.anthropic.claude-sonnet-4-6"),
      expected,
      `reply must be recovered: ${JSON.stringify(reply.slice(0, 60))}`,
    );
  }
});

test("typed discipline is preserved: semantic violations still fail closed", () => {
  const rejected = [
    // extra keys, including tactical instructions, are rejected not repaired
    '{"intent":"grow","targetID":null,"horizon":4,"reason":"expand fast"}',
    '{"intent":"convert","targetID":"2rmhbq4h","horizon":6,"actionID":"attack:2rmhbq4h:100"}',
    // rival names are not IDs
    '{"intent":"convert","targetID":"Auri","horizon":6}',
    // invisible or empty targets
    '{"intent":"convert","targetID":"missing","horizon":6}',
    '{"intent":"convert","targetID":"","horizon":6}',
    // coerced or out-of-band horizons
    '{"intent":"grow","targetID":null,"horizon":"4"}',
    '{"intent":"grow","targetID":null,"horizon":1}',
    '{"intent":"grow","targetID":null,"horizon":13}',
    // unknown intent vocabulary (the deployed compound dialect is not committed)
    '{"intent":"grow>compound","targetID":null,"horizon":4}',
    // ambiguous or truncated transport
    growPacket + growPacket,
    "```json\n" + growPacket.slice(0, 30),
    '{"intent":"grow","targetID":null,"horizon":4',
  ];
  for (const reply of rejected) {
    assert.equal(
      parseIntentDirective(reply, state, "test"),
      null,
      `reply must stay rejected: ${JSON.stringify(reply.slice(0, 60))}`,
    );
  }
});

function request(requestID, legalActions, observation) {
  return {
    type: "decision_request",
    requestID,
    request: { legalActions, observation },
  };
}

// Round-1325 identity class: six decisions selected alliance IDs that the
// match no longer offered and became holds. The wire boundary must only ever
// emit an ID from the current legal set, and a stale plan target must fall
// through to a tactical action, not a synthetic hold.
test("stale plan targets never emit unknown IDs or synthetic holds", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const ownState = {
    tileShare: 0.2, troopRatio: 0.8, troops: 500000, gold: 250000,
    borderTiles: 100, incomingAttacks: [],
  };
  const large = {
    id: "large", name: "Large", isAlive: true, tileShare: 0.2,
    relativeTroopRatio: 1.5, sharesBorder: true, canAttack: true, isAllied: false,
  };
  const weak = {
    id: "weak", name: "Weak", isAlive: true, tileShare: 0.08,
    relativeTroopRatio: 2.2, sharesBorder: true, canAttack: true, isAllied: false,
  };
  const withTarget = [
    { id: "attack:large:10", kind: "attack", label: "Attack Large 10%", risk: lowRisk,
      metadata: { targetID: "large", targetName: "Large", troopPercent: 10 } },
    { id: "attack:weak:10", kind: "attack", label: "Attack Weak 10%", risk: lowRisk,
      metadata: { targetID: "weak", targetName: "Weak", troopPercent: 10 } },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
  // The plan target's actions vanish while tactical alternatives remain.
  const targetGone = [
    { id: "attack:weak:10", kind: "attack", label: "Attack Weak 10%", risk: lowRisk,
      metadata: { targetID: "weak", targetName: "Weak", troopPercent: 10 } },
    { id: "expand:terra-nullius:10", kind: "attack", risk: lowRisk,
      label: "Expand into neutral land with 10% troops",
      metadata: { expansion: true, troopPercent: 10 } },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
  const observations = [
    { phase: "active", ownState, visiblePlayers: [large, weak] },
    { phase: "active", ownState, visiblePlayers: [large, weak] },
    { phase: "active", ownState, visiblePlayers: [weak] },
  ];
  const requests = [
    request("warm", withTarget, observations[0]),
    request("planned", withTarget, observations[1]),
    request("stale", targetGone, observations[2]),
  ];

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
        horizon: 8,
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
      reject(new Error(`stale-target identity test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(requests[0]));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length < requests.length) {
          setTimeout(() => {
            socket.send(JSON.stringify(requests[responses.length]));
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

  const offeredIDs = [
    new Set(withTarget.map((action) => action.id)),
    new Set(withTarget.map((action) => action.id)),
    new Set(targetGone.map((action) => action.id)),
  ];
  responses.forEach((response, index) => {
    assert.ok(
      offeredIDs[index].has(response.selectedLegalActionId),
      `decision ${index} must select an offered ID, got ${response.selectedLegalActionId}`,
    );
  });
  // The planned decision converts the plan target; the stale decision keeps
  // playing tactically instead of holding.
  assert.equal(responses[1].selectedLegalActionId, "attack:large:10");
  assert.notEqual(responses[2].selectedLegalActionId, "hold");
});

// Selector preservation: the same packet delivered bare and fence-framed must
// produce identical tactical selections. The repair changes reply transport
// handling only, never the deterministic selector.
test("transport framing does not change tactical selection", async () => {
  async function runWithDirective(directive) {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const lowRisk = { level: "low" };
    const legalActions = [
      { id: "expand:terra-nullius:10", kind: "attack", risk: lowRisk,
        label: "Expand into neutral land with 10% troops",
        metadata: { expansion: true, troopPercent: 10 } },
      { id: "expand:terra-nullius:20", kind: "attack", risk: lowRisk,
        label: "Expand into neutral land with 20% troops",
        metadata: { expansion: true, troopPercent: 20 } },
      { id: "boat:255036:16", kind: "boat", label: "Send 16% transport", risk: lowRisk },
      { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
    ];
    const obs = {
      phase: "active",
      ownState: {
        tileShare: 0.05, troopRatio: 0.8, troops: 500000, gold: 250000,
        borderTiles: 100, incomingAttacks: [],
      },
      visiblePlayers: [],
    };
    const requests = [
      request("one", legalActions, obs),
      request("two", legalActions, obs),
      request("three", legalActions, obs),
    ];
    const responses = [];
    let stderr = "";
    const child = spawn(process.execPath, [playerPath], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PLAN_MODE: "on",
        INTENT_TEST_DIRECTIVE: directive,
        COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
        AWS_EC2_METADATA_DISABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const completed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`framing invariance run timed out: ${stderr}`));
      }, 8000);
      server.once("connection", (socket) => {
        socket.send(JSON.stringify(requests[0]));
        socket.on("message", (data) => {
          responses.push(JSON.parse(String(data)));
          if (responses.length < requests.length) {
            setTimeout(() => {
              socket.send(JSON.stringify(requests[responses.length]));
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
    return responses;
  }

  const bare = await runWithDirective(growPacket);
  const fenced = await runWithDirective("```json\n" + growPacket + "\n```");
  assert.deepEqual(
    fenced.map((response) => response.selectedLegalActionId),
    bare.map((response) => response.selectedLegalActionId),
  );
  // Once the plan lands, neither run reports planner degradation.
  assert.equal(bare.at(-1).llmPlannerDegraded, false);
  assert.equal(fenced.at(-1).llmPlannerDegraded, false);
});

// Degradation telemetry: a failing refresh must expose its error head on the
// wire so public replays diagnose the planner without pod-log access.
test("degraded decisions carry the refresh-error snippet on the wire", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const lowRisk = { level: "low" };
  const legalActions = [
    { id: "expand:terra-nullius:10", kind: "attack", risk: lowRisk,
      label: "Expand into neutral land with 10% troops",
      metadata: { expansion: true, troopPercent: 10 } },
    { id: "hold", kind: "hold", label: "Hold", risk: lowRisk },
  ];
  const obs = {
    phase: "active",
    ownState: {
      tileShare: 0.05, troopRatio: 0.8, troops: 500000, gold: 250000,
      borderTiles: 100, incomingAttacks: [],
    },
    visiblePlayers: [],
  };
  const requests = [
    request("t1", legalActions, obs),
    request("t2", legalActions, obs),
  ];
  const responses = [];
  let stderr = "";
  const child = spawn(process.execPath, [playerPath], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAN_MODE: "on",
      INTENT_TEST_DIRECTIVE: "no packet here at all",
      COWORLD_PLAYER_WS_URL: `ws://127.0.0.1:${port}`,
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`telemetry test timed out: ${stderr}`));
    }, 8000);
    server.once("connection", (socket) => {
      socket.send(JSON.stringify(requests[0]));
      socket.on("message", (data) => {
        responses.push(JSON.parse(String(data)));
        if (responses.length < requests.length) {
          setTimeout(() => {
            socket.send(JSON.stringify(requests[responses.length]));
          }, 30);
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
  assert.match(responses[1].reason, /^dgd:err:/);
  assert.ok(
    responses[1].reason.includes("|plan reply had no valid intent".slice(0, 48 - "dgd:err:atk".length)),
    `reason must carry the error snippet, got: ${responses[1].reason}`,
  );
  assert.ok(responses[1].reason.length <= 48);
  // Bootstrap decisions under planner-on expose the credential-env
  // fingerprint (names only) for public-replay diagnosis.
  assert.match(responses[0].reason, /\|env:/);
});
