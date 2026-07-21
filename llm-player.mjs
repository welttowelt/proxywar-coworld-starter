/**
 * ProxyWar standard-controller transport.
 *
 * The game offers exact legal-action IDs.  This process owns only the socket
 * lifecycle and response contract; standard-controller.mjs owns every policy
 * decision.  No model, network planner, or legacy selector is on the hot path.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";

import { createStandardController } from "./standard-controller.mjs";

const DEFAULT_RECONNECT_BASE_MS = 500;
const RESPONSE_CACHE_LIMIT = 512;

function token(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16);
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestFingerprint(legalActions, observation) {
  if (!Array.isArray(legalActions)) throw new Error("invalid_legal_actions");
  const ids = new Set();
  const semantics = legalActions.map((action) => {
    if (!action || typeof action !== "object") throw new Error("invalid_legal_action");
    if (typeof action.id !== "string" || action.id.trim() === "") {
      throw new Error("missing_legal_action_id");
    }
    if (ids.has(action.id)) throw new Error("duplicate_legal_action_id");
    ids.add(action.id);
    // Bind every field consulted by the controller/safety layer. Keeping the
    // full metadata and risk objects also fails closed when the game adds a
    // new target or safety signal without changing the action ID.
    return {
      id: action.id,
      kind: action.kind,
      type: action.type,
      label: action.label,
      targetID: action.targetID ?? action.targetId ?? action.target_id,
      targetName: action.targetName ?? action.target_name,
      recipientID: action.recipientID ?? action.recipientId ?? action.recipient_id,
      recipientName: action.recipientName ?? action.recipient_name,
      expansion: action.expansion,
      troopPercent: action.troopPercent ?? action.percent ?? action.percentage,
      metadata: action.metadata,
      risk: action.risk,
    };
  });
  semantics.sort((left, right) => left.id.localeCompare(right.id));
  return stableValue({
    legalActions: semantics,
    // Request IDs are retry keys, not authority to reuse an action after the
    // match-local player map or pressure state changed underneath that ID.
    observation: observation ?? {},
  });
}

function offeredHold(legalActions) {
  if (!Array.isArray(legalActions)) return null;
  return legalActions.find((action) =>
    typeof action?.id === "string" &&
    (String(action?.kind ?? "").toLowerCase() === "hold" || action.id.toLowerCase() === "hold"),
  ) ?? null;
}

function compactReason(decision, degraded = false) {
  const markers = Array.isArray(decision?.markers) ? decision.markers : [];
  const parts = [
    "std1",
    degraded ? "err" : decision?.route,
    ...markers,
  ].map(token).filter(Boolean);
  return [...new Set(parts)].join(":").slice(0, 48) || "std1:act";
}

function cacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > RESPONSE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function controlledError(requestID, code) {
  return {
    type: "decision_error",
    requestID,
    error: code,
    fallbackUsed: true,
    llmPlannerDegraded: true,
  };
}

/** Build one protocol response. Exported so the failure contract stays testable. */
export function decideResponse(controller, message, responseCache = new Map()) {
  const requestID = message?.requestID;
  const request = message?.request ?? {};
  const legalActions = request.legalActions;

  try {
    if (typeof requestID !== "string" || requestID.length === 0) {
      throw new Error("missing_request_id");
    }
    const fingerprint = requestFingerprint(legalActions, request.observation);
    const cached = responseCache.get(requestID);
    if (cached?.fingerprint === fingerprint) return cached.response;

    const decision = controller.decide({
      requestID,
      observation: request.observation ?? {},
      legalActions,
    });
    const selectedLegalActionId = decision?.selectedLegalActionId ?? decision?.action?.id;
    const offered = legalActions.some((action) => action?.id === selectedLegalActionId);
    if (typeof selectedLegalActionId !== "string" || !offered) {
      throw new Error("controller_selected_unoffered_action");
    }

    const degraded = decision?.safety?.fallbackUsed === true;
    const response = {
      type: "decision_response",
      requestID,
      selectedLegalActionId,
      reason: compactReason(decision, degraded),
      confidence: Number.isFinite(decision?.confidence)
        ? Math.max(0, Math.min(1, decision.confidence))
        : 0.9,
      fallbackUsed: degraded,
      llmPlannerDegraded: degraded,
    };
    if (!cached) cacheSet(responseCache, requestID, { fingerprint, response });
    return response;
  } catch (error) {
    const hold = offeredHold(legalActions);
    const code = token(error?.message || "controller_failure") || "controllerfailure";
    console.error(`standard controller failure (${code})`);
    if (!hold) return controlledError(requestID, `standard_controller_${code}`);
    return {
      type: "decision_response",
      requestID,
      selectedLegalActionId: hold.id,
      reason: "std1:err:hold",
      confidence: 0,
      fallbackUsed: true,
      llmPlannerDegraded: true,
    };
  }
}

/**
 * Start the player transport.  The injectable controller factory is used only
 * by integration tests; production calls this with the deterministic default.
 */
export function runPlayer({
  url = process.env.COWORLD_PLAYER_WS_URL,
  controllerFactory = createStandardController,
  reconnectBaseMs = Number(process.env.RECONNECT_BASE_MS) || DEFAULT_RECONNECT_BASE_MS,
  heartbeatMs = 15_000,
} = {}) {
  if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required (the match provides it)");
  const controller = controllerFactory();
  const responseCache = new Map();
  let socket = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let stopping = false;
  let finalReceived = false;
  let resolveCompleted;
  let rejectCompleted;
  const completed = new Promise((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });

  function finish(error = null) {
    if (stopping) return;
    stopping = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    clearInterval(heartbeat);
    if (error) rejectCompleted(error);
    else resolveCompleted();
  }

  function send(activeSocket, response) {
    if (activeSocket.readyState !== WebSocket.OPEN) return;
    activeSocket.send(JSON.stringify(response), (error) => {
      if (!error) return;
      console.error(`decision response failed: ${error.message || error}`);
      activeSocket.terminate();
    });
  }

  function handleMessage(activeSocket, data) {
    if (activeSocket !== socket || stopping) return;
    let message;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      console.error(`unparseable message from match: ${error?.message || error}`);
      return;
    }

    if (message.type === "final") {
      finalReceived = true;
      activeSocket.close(1000, "match complete");
      return;
    }
    if (message.type === "reset" || message.type === "game_reset") {
      controller.reset?.();
      responseCache.clear();
      return;
    }
    if (message.type !== "decision_request") return;
    send(activeSocket, decideResponse(controller, message, responseCache));
  }

  function scheduleReconnect() {
    if (stopping || finalReceived || reconnectTimer !== null) return;
    const delay = Math.min(
      Math.max(10, reconnectBaseMs) * (2 ** reconnectAttempt),
      5_000,
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (stopping) return;
    const activeSocket = new WebSocket(url);
    socket = activeSocket;
    activeSocket.on("open", () => {
      reconnectAttempt = 0;
      console.log("connected to match (controller=std1)");
    });
    activeSocket.on("message", (data) => handleMessage(activeSocket, data));
    activeSocket.on("close", (code, reason) => {
      if (activeSocket !== socket) return;
      socket = null;
      if (finalReceived) {
        finish();
        return;
      }
      if (stopping) return;
      console.error(`match socket closed unexpectedly (${code}: ${token(reason) || "noreason"}); reconnecting`);
      scheduleReconnect();
    });
    activeSocket.on("error", (error) => {
      console.error(`match socket error: ${error.message || error}`);
      activeSocket.terminate();
    });
  }

  const heartbeat = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.ping();
  }, Math.max(100, heartbeatMs));
  heartbeat.unref();
  connect();

  return {
    completed,
    close() {
      if (stopping) return;
      if (socket?.readyState === WebSocket.OPEN) socket.close(1000, "player stopped");
      finish();
    },
  };
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  let player;
  try {
    player = runPlayer();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
  player?.completed.then(
    () => { process.exitCode = 0; },
    (error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    },
  );
}
