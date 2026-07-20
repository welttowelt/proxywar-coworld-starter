import { createHash } from "node:crypto";
import { WebSocket } from "ws";

import {
  HRAFN_EXPECTED_OLLAMA_MODEL_DIGEST,
  HRAFN_OLLAMA_MODEL,
  buildHrafnIntentSnapshot,
  hrafnIntentRequestPayloadSHA256,
  chooseHrafnIntentDecision,
  createOllamaHrafnIntentPlanner,
  hrafnIntentAvailable,
  normalizeHrafnCoworldDecisionRequest,
} from "./hrafn-intent.mjs";
import {
  publicHrafnReason,
  recordHrafnDecision,
} from "./hrafn-strategy.mjs";

const url = process.env.COWORLD_PLAYER_WS_URL;
if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required");

const MAX_PLAN_AGE_DECISIONS = 12;
const intentEnabled = process.env.HRAFN_INTENT_ENABLED !== "0";
const rv1Enabled = process.env.HRAFN_RV1 !== "0";
const reconnectBaseMs = Math.max(
  10,
  Number(process.env.RECONNECT_BASE_MS) || 500,
);
const heartbeatIntervalMs = Math.max(
  50,
  Number(process.env.HRAFN_HEARTBEAT_MS) || 15000,
);
const testSendDelayMs = process.env.NODE_ENV === "test"
  ? Math.max(0, Number(process.env.HRAFN_TEST_SEND_DELAY_MS) || 0)
  : 0;
const planner = createOllamaHrafnIntentPlanner({
  endpoint: process.env.HRAFN_INTENT_ENDPOINT ||
    "http://host.docker.internal:11434/api/generate",
  model: HRAFN_OLLAMA_MODEL,
  timeoutMs: Math.max(
    100,
    Number(process.env.HRAFN_INTENT_TIMEOUT_MS) || 4000,
  ),
  seed: 240721,
});

const history = [];
const requestCache = new Map();
let committedDecisionCount = 0;
let activeIntent = null;
let activeIntentSourceDecision = null;
let intentRemaining = 0;
let intentEpoch = 0;
let intentInvalidations = 0;
let plannerPending = false;
let plannerDegraded = false;
let plannerAttempts = 0;
let plannerFailures = 0;
let consecutivePlannerFailures = 0;
let nextPlanEligibleDecision = 0;
let lastPlannerLatencyMs = null;
let lastPlannerError = null;

let socket = null;
let finalReceived = false;
let fatalDecisionError = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let decisionInFlight = false;
let decisionSocket = null;
let decisionQueue = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestMarker(requestID) {
  return `q${sha256(requestID).slice(0, 10)}`;
}

function decisionInputFromRequest(request) {
  const normalized = normalizeHrafnCoworldDecisionRequest(request);
  if (!normalized) {
    throw new Error(
      "HI1 decision request does not match the exact proxywar-agent-v1 wire contract",
    );
  }
  return normalized;
}

function plannerIntentAllowed(intent, snapshot) {
  if (intent?.objective === "grow") return snapshot.growPossible === true;
  if (intent?.objective !== "convert") return false;
  return snapshot.convertTargets.some((target) =>
    target.targetID === intent.targetID
  );
}

function retryDelayDecisions() {
  return Math.min(2 ** Math.min(consecutivePlannerFailures, 3), 12);
}

function logPlan({
  attempt,
  ok,
  result,
  sourceDecision,
  age,
  error,
}) {
  console.log(JSON.stringify({
    event: "hrafn_intent_plan",
    attempt,
    ok,
    model: result?.model ?? null,
    expectedModel: HRAFN_OLLAMA_MODEL,
    expectedModelDigest: HRAFN_EXPECTED_OLLAMA_MODEL_DIGEST,
    latencyMs: result?.latencyMs ?? null,
    intentEpoch,
    intentObjective: ok ? activeIntent?.objective ?? null : null,
    intentTargetID: ok ? activeIntent?.targetID ?? null : null,
    intentHorizon: ok ? activeIntent?.horizon ?? null : null,
    intentSourceDecision: sourceDecision,
    intentAge: age,
    nextPlanEligibleDecision,
    error,
  }));
}

function failPlan({ attempt, result, sourceDecision, age, error }) {
  activeIntent = null;
  activeIntentSourceDecision = null;
  intentRemaining = 0;
  plannerFailures += 1;
  consecutivePlannerFailures += 1;
  plannerDegraded = true;
  lastPlannerError = error;
  nextPlanEligibleDecision = committedDecisionCount + retryDelayDecisions();
  logPlan({
    attempt,
    ok: false,
    result,
    sourceDecision,
    age,
    error,
  });
}

function startIntentPlan(snapshot) {
  if (
    !intentEnabled ||
    plannerPending ||
    activeIntent ||
    !hrafnIntentAvailable(snapshot) ||
    committedDecisionCount < nextPlanEligibleDecision
  ) {
    return;
  }
  const sourceDecision = snapshot.decisionCount;
  plannerPending = true;
  plannerAttempts += 1;
  const attempt = plannerAttempts;
  void planner.plan(snapshot).then((result) => {
    plannerPending = false;
    lastPlannerLatencyMs = result.latencyMs;
    const age = Math.max(0, committedDecisionCount - sourceDecision);
    if (!result.ok) {
      failPlan({
        attempt,
        result,
        sourceDecision,
        age,
        error: result.error,
      });
      return;
    }
    if (!plannerIntentAllowed(result.intent, snapshot)) {
      failPlan({
        attempt,
        result,
        sourceDecision,
        age,
        error: "planner intent unavailable in source snapshot",
      });
      return;
    }
    if (age > MAX_PLAN_AGE_DECISIONS) {
      failPlan({
        attempt,
        result,
        sourceDecision,
        age,
        error: `stale planner intent age ${age}`,
      });
      return;
    }
    const remainingHorizon = result.intent.horizon - age;
    if (remainingHorizon <= 0) {
      failPlan({
        attempt,
        result,
        sourceDecision,
        age,
        error: `planner intent expired at age ${age} for horizon ${result.intent.horizon}`,
      });
      return;
    }

    activeIntent = result.intent;
    activeIntentSourceDecision = sourceDecision;
    intentRemaining = remainingHorizon;
    intentEpoch += 1;
    consecutivePlannerFailures = 0;
    plannerDegraded = false;
    lastPlannerError = null;
    nextPlanEligibleDecision = committedDecisionCount;
    logPlan({
      attempt,
      ok: true,
      result,
      sourceDecision,
      age,
      error: null,
    });
  }).catch((error) => {
    plannerPending = false;
    const age = Math.max(0, committedDecisionCount - sourceDecision);
    lastPlannerLatencyMs = null;
    failPlan({
      attempt,
      result: null,
      sourceDecision,
      age,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function intentContextForDecision() {
  if (!intentEnabled || !activeIntent || intentRemaining <= 0) {
    return {
      intent: null,
      sourceDecision: null,
      age: null,
      failure: null,
    };
  }
  const age = Math.max(
    0,
    committedDecisionCount - activeIntentSourceDecision,
  );
  if (age > MAX_PLAN_AGE_DECISIONS) {
    return {
      intent: null,
      sourceDecision: activeIntentSourceDecision,
      age,
      failure: `intent_stale_age_${age}`,
    };
  }
  return {
    intent: activeIntent,
    sourceDecision: activeIntentSourceDecision,
    age,
    failure: null,
  };
}

function clearActiveIntent() {
  activeIntent = null;
  activeIntentSourceDecision = null;
  intentRemaining = 0;
}

function commitIntentOutcome(commit) {
  if (commit.intentFailure) {
    if (
      activeIntentSourceDecision === commit.intentSourceDecision ||
      commit.intentSourceDecision === null
    ) {
      clearActiveIntent();
    }
    intentInvalidations += 1;
    plannerDegraded = true;
    lastPlannerError = commit.intentFailure;
    consecutivePlannerFailures += 1;
    nextPlanEligibleDecision = Math.max(
      nextPlanEligibleDecision,
      committedDecisionCount + retryDelayDecisions(),
    );
    return;
  }
  if (!commit.intent) return;
  if (activeIntentSourceDecision !== commit.intentSourceDecision) return;
  intentRemaining = Math.max(0, intentRemaining - 1);
  if (intentRemaining === 0) clearActiveIntent();
}

function turnNumber(observation) {
  const value = Number(observation?.turnNumber ?? observation?.turn);
  return Number.isFinite(value) ? value : null;
}

function emitDecisionTelemetry(entry, {
  wireRetry,
  responseLatencyMs,
  requestArrivalTimestampMs,
  responseTimestampMs,
}) {
  const summary = entry.summary;
  console.log(JSON.stringify({
    event: "hrafn_intent_decision",
    requestID: entry.requestID,
    requestMarker: entry.requestMarker,
    requestPayloadSHA256: entry.requestPayloadSHA256,
    decisionInput: entry.decisionInput,
    selectedAction: entry.selectedAction,
    rawLlmOutput: entry.response,
    requestArrivalTimestampMs,
    originalRequestArrivalTimestampMs: entry.originalArrivalTimestampMs,
    responseTimestampMs,
    turnNumber: summary.turnNumber,
    decisionIndex: summary.decisionIndex,
    actionID: summary.actionID,
    baselineActionID: summary.baselineActionID,
    actionDelta: summary.actionDelta,
    intentEnabled,
    intentEpoch: summary.intentEpoch,
    intentObjective: summary.intentObjective,
    intentTargetID: summary.intentTargetID,
    intentHorizon: summary.intentHorizon,
    intentSourceDecision: summary.intentSourceDecision,
    intentAge: summary.intentAge,
    planAgeDecisions: summary.intentValid ? summary.intentAge : null,
    intentRemaining: summary.intentRemainingBeforeCommit,
    intentRemainingBeforeCommit: summary.intentRemainingBeforeCommit,
    intentValid: summary.intentValid,
    intentApplied: summary.intentApplied,
    intentReason: summary.intentReason,
    intentFailure: summary.intentFailure,
    intentFallback: summary.intentFailure !== null,
    intentInvalidations,
    plannerPending,
    plannerDegraded: summary.responseDegraded,
    plannerAttempts,
    plannerFailures,
    plannerLatencyMs: lastPlannerLatencyMs,
    plannerError: summary.responsePlannerError,
    model: HRAFN_OLLAMA_MODEL,
    expectedModelDigest: HRAFN_EXPECTED_OLLAMA_MODEL_DIGEST,
    safetyRejectedCount: summary.safetyRejectedCount,
    wrapperOmittedCount: summary.wrapperOmittedCount,
    legalActionCount: summary.legalActionCount,
    fallbackUsed: summary.fallbackUsed,
    duplicateRequest: false,
    wireRetry,
    cacheConflict: null,
    responseLatencyMs,
  }));
}

function emitRetryTelemetry(entry, {
  responseLatencyMs,
  requestArrivalTimestampMs,
  responseTimestampMs,
}) {
  console.log(JSON.stringify({
    event: "hrafn_intent_retry",
    requestID: entry.requestID,
    requestMarker: entry.requestMarker,
    requestPayloadSHA256: entry.requestPayloadSHA256,
    decisionIndex: entry.summary.decisionIndex,
    actionID: entry.summary.actionID,
    duplicateRequest: true,
    wireRetry: false,
    requestArrivalTimestampMs,
    originalRequestArrivalTimestampMs: entry.originalArrivalTimestampMs,
    responseTimestampMs,
    responseLatencyMs,
  }));
}

function commitResponse(entry, arrival, wireRetry) {
  const responseTimestampMs = Date.now();
  const responseLatencyMs = performance.now() - arrival.monotonicMs;
  if (!entry.committed) {
    const commit = entry.commit;
    recordHrafnDecision(history, commit.action, commit.observation);
    committedDecisionCount += 1;
    commitIntentOutcome(commit);
    entry.committed = true;
    reconnectAttempt = 0;
    emitDecisionTelemetry(entry, {
      wireRetry,
      responseLatencyMs,
      requestArrivalTimestampMs: arrival.unixMs,
      responseTimestampMs,
    });
    const snapshot = commit.snapshot;
    entry.commit = null;
    startIntentPlan(snapshot);
    return;
  }
  emitRetryTelemetry(entry, {
    responseLatencyMs,
    requestArrivalTimestampMs: arrival.unixMs,
    responseTimestampMs,
  });
}

function sendEntry(activeSocket, entry, arrival, wireRetry) {
  const dispatch = () => {
    if (activeSocket !== socket) return;
    activeSocket.send(JSON.stringify(entry.response), (error) => {
      if (activeSocket !== socket) return;
      if (error) {
        failDecisionSend(activeSocket, error);
        return;
      }
      commitResponse(entry, arrival, wireRetry);
      finishDecision();
    });
  };
  if (testSendDelayMs > 0) {
    setTimeout(dispatch, testSendDelayMs);
  } else {
    dispatch();
  }
}

function sendCachedDecision(activeSocket, message, cached, arrival) {
  decisionInputFromRequest(message.request);
  const payloadSHA256 = hrafnIntentRequestPayloadSHA256(message.request);
  if (payloadSHA256 !== cached.requestPayloadSHA256) {
    throw new Error(
      `duplicate request semantic conflict for ${message.requestID}`,
    );
  }
  sendEntry(activeSocket, cached, arrival, !cached.committed);
}

function failDecisionSend(activeSocket, error) {
  console.error(`decision response failed: ${error?.message || error}`);
  decisionInFlight = false;
  decisionSocket = null;
  decisionQueue = [];
  activeSocket.terminate();
}

function finishDecision() {
  decisionInFlight = false;
  decisionSocket = null;
  drainDecisionQueue();
}

function handleDecision(activeSocket, message, arrival) {
  const cached = requestCache.get(message.requestID);
  if (cached) {
    sendCachedDecision(activeSocket, message, cached, arrival);
    return;
  }

  const unresolved = [...requestCache.values()].find((entry) =>
    entry.committed === false
  );
  if (unresolved) {
    throw new Error(
      `fresh request ${message.requestID} arrived before unresolved ${unresolved.requestID}`,
    );
  }

  const decisionInput = decisionInputFromRequest(message.request);
  const requestPayloadSHA256 = hrafnIntentRequestPayloadSHA256(message.request);
  const { legalActions: actions, observation } = decisionInput;

  const snapshot = {
    ...buildHrafnIntentSnapshot({
      actions,
      observation,
      history,
      rv1Enabled,
    }),
    decisionCount: committedDecisionCount,
  };
  const intentContext = intentContextForDecision();
  let decision = chooseHrafnIntentDecision({
    actions,
    observation,
    history,
    intent: intentContext.intent,
    rv1Enabled,
  });
  let intentFailure = intentContext.failure;
  if (!intentFailure && intentContext.intent && !decision.intentValid) {
    intentFailure = decision.reason;
  }
  if (intentContext.failure) {
    decision = {
      ...decision,
      reason: intentContext.failure,
      intentValid: false,
    };
  }

  const chosen = decision.action;
  if (!actions.some((action) => action?.id === chosen?.id)) {
    throw new Error("HI1 selected an action outside the current legal menu");
  }
  const marker = requestMarker(message.requestID);
  const wireAction = { ...chosen, requestMarker: marker };
  const responseDegraded = plannerDegraded || intentFailure !== null;
  const response = {
    type: "decision_response",
    requestID: message.requestID,
    selectedLegalActionId: wireAction.id,
    reason: publicHrafnReason(wireAction),
    confidence: wireAction.kind === "hold" ? 0.5 : 0.82,
    fallbackUsed: responseDegraded,
    llmPlannerDegraded: responseDegraded,
  };
  const entry = {
    requestID: message.requestID,
    requestMarker: marker,
    requestPayloadSHA256,
    decisionInput,
    selectedAction: structuredClone(wireAction),
    response: structuredClone(response),
    committed: false,
    originalArrivalTimestampMs: arrival.unixMs,
    summary: {
      turnNumber: turnNumber(observation),
      decisionIndex: committedDecisionCount + 1,
      actionID: wireAction.id,
      baselineActionID: decision.baseline.id,
      actionDelta: decision.actionDelta === true,
      intentEpoch: intentContext.intent ? intentEpoch : 0,
      intentObjective: intentContext.intent?.objective ?? null,
      intentTargetID: intentContext.intent?.targetID ?? null,
      intentHorizon: intentContext.intent?.horizon ?? null,
      intentSourceDecision: intentContext.sourceDecision,
      intentAge: intentContext.age,
      intentRemainingBeforeCommit: intentRemaining,
      intentValid: decision.intentValid === true,
      intentApplied: decision.intentApplied === true,
      intentReason: decision.reason,
      intentFailure,
      responseDegraded,
      responsePlannerError: intentFailure ?? lastPlannerError,
      safetyRejectedCount: decision.safetyRejectedCount,
      wrapperOmittedCount: decision.wrapperOmittedCount,
      legalActionCount: actions.length,
      fallbackUsed: responseDegraded,
    },
    commit: {
      action: wireAction,
      observation,
      intent: intentContext.intent,
      intentSourceDecision: intentContext.sourceDecision,
      intentFailure,
      snapshot,
    },
  };
  requestCache.set(message.requestID, entry);
  sendEntry(activeSocket, entry, arrival, false);
}

function drainDecisionQueue() {
  if (decisionInFlight || fatalDecisionError || decisionQueue.length === 0) {
    return;
  }
  const next = decisionQueue.shift();
  if (next.socket !== socket) {
    drainDecisionQueue();
    return;
  }
  processDecision(next.socket, next.message, next.arrival);
}

function processDecision(activeSocket, message, arrival) {
  if (decisionInFlight) {
    if (decisionSocket !== activeSocket) {
      throw new Error("HI1 decision queue crossed socket generations");
    }
    if (decisionQueue.length >= 64) {
      throw new Error("HI1 decision queue exceeded fail-closed bound");
    }
    decisionQueue.push({ socket: activeSocket, message, arrival });
    return;
  }
  decisionInFlight = true;
  decisionSocket = activeSocket;
  try {
    handleDecision(activeSocket, message, arrival);
  } catch (error) {
    decisionInFlight = false;
    decisionSocket = null;
    decisionQueue = [];
    throw error;
  }
}

function handleMessage(activeSocket, data) {
  if (activeSocket !== socket) return;
  const arrival = {
    monotonicMs: performance.now(),
    unixMs: Date.now(),
  };
  let message;
  try {
    message = JSON.parse(String(data));
  } catch (error) {
    console.error(`unparseable match message: ${error?.message || error}`);
    return;
  }
  if (message.type === "final") {
    finalReceived = true;
    activeSocket.close(1000, "match complete");
    return;
  }
  if (message.type !== "decision_request") return;

  try {
    if (
      typeof message.requestID !== "string" ||
      !message.requestID ||
      message.requestID.trim() !== message.requestID
    ) {
      throw new Error(
        "wire decision request had no exact non-empty string request ID",
      );
    }
    processDecision(activeSocket, message, arrival);
  } catch (error) {
    console.error(`fail-closed decision error: ${error?.stack || error}`);
    fatalDecisionError = true;
    activeSocket.close(1011, "fail-closed decision error");
  }
}

function scheduleReconnect() {
  if (finalReceived || fatalDecisionError || reconnectTimer !== null) return;
  const delay = Math.min(reconnectBaseMs * (2 ** reconnectAttempt), 5000);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  const activeSocket = new WebSocket(url);
  socket = activeSocket;
  activeSocket.on("open", () => {
    console.log(
      `connected to match (exact-v5=on,intent=${intentEnabled ? "on" : "off"})`,
    );
  });
  activeSocket.on("message", (data) => handleMessage(activeSocket, data));
  activeSocket.on("close", (code, reason) => {
    if (activeSocket !== socket) return;
    socket = null;
    decisionInFlight = false;
    decisionSocket = null;
    decisionQueue = [];
    if (finalReceived || fatalDecisionError) {
      process.exit(fatalDecisionError ? 1 : 0);
      return;
    }
    console.error(
      `match socket closed (${code}: ${String(reason) || "none"}); reconnecting`,
    );
    scheduleReconnect();
  });
  activeSocket.on("error", (error) => {
    console.error(`match socket error: ${error?.message || error}`);
    activeSocket.terminate();
  });
}

connect();
const heartbeat = setInterval(() => {
  const activeSocket = socket;
  if (activeSocket?.readyState !== WebSocket.OPEN) return;
  activeSocket.ping();
}, heartbeatIntervalMs);
heartbeat.unref();
