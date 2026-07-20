import { WebSocket } from "ws";

import {
  decideHrafn,
  publicHrafnChassisReason,
} from "./hrafn-chassis.mjs";
import { createHrafnPersistentState } from "./hrafn-state.mjs";

const url = process.env.COWORLD_PLAYER_WS_URL;
if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required");

const reconnectBaseMs = Math.max(
  10,
  Number(process.env.RECONNECT_BASE_MS) || 500,
);
const heartbeatIntervalMs = Math.max(
  50,
  Number(process.env.HRAFN_HEARTBEAT_MS) || 15000,
);
const chassisConfig = Object.freeze({
  enableGrow: process.env.HRAFN_GROW !== "0",
  enableConvert: process.env.HRAFN_CONVERT !== "0",
  enableNaval: process.env.HRAFN_NAVAL !== "0",
  enableAlliance: process.env.HRAFN_ALLIANCE !== "0",
  enableKF1: process.env.HRAFN_KF1 !== "0",
  enableMidgameSupport: false,
});

let persistentState = createHrafnPersistentState();
let socket = null;
let finalReceived = false;
let fatalDecisionError = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let decisionInFlight = false;
let decisionSocket = null;
let decisionQueue = [];

function drainDecisionQueue() {
  if (decisionInFlight || fatalDecisionError || decisionQueue.length === 0) {
    return;
  }
  const next = decisionQueue.shift();
  if (next.socket !== socket) {
    drainDecisionQueue();
    return;
  }
  processDecision(next.socket, next.message);
}

function handleDecision(activeSocket, message) {
  const actions = message.request?.legalActions ?? [];
  const observation = message.request?.observation ?? {};
  const decision = decideHrafn({
    actions,
    observation,
    state: persistentState,
    requestID: message.requestID,
    config: chassisConfig,
  });
  const response = {
    type: "decision_response",
    requestID: message.requestID,
    selectedLegalActionId: decision.action.id,
    reason: publicHrafnChassisReason(decision.action),
    confidence: decision.action.kind === "hold" ? 0.5 : 0.88,
    fallbackUsed: decision.fallbackUsed === true,
    llmPlannerDegraded: false,
  };
  activeSocket.send(JSON.stringify(response), (error) => {
    if (activeSocket !== socket) return;
    if (error) {
      console.error(`decision response failed: ${error?.message || error}`);
      decisionInFlight = false;
      decisionSocket = null;
      decisionQueue = [];
      activeSocket.terminate();
      return;
    }
    persistentState = decision.nextState;
    reconnectAttempt = 0;
    console.log(JSON.stringify({
      event: "hrafn_chassis_decision",
      requestID: message.requestID,
      actionID: decision.action.id,
      ...decision.telemetry,
    }));
    decisionInFlight = false;
    decisionSocket = null;
    drainDecisionQueue();
  });
}

function processDecision(activeSocket, message) {
  if (decisionInFlight) {
    if (decisionSocket !== activeSocket) {
      throw new Error("decision queue crossed socket generations");
    }
    if (decisionQueue.length >= 64) {
      throw new Error("decision queue exceeded fail-closed bound");
    }
    decisionQueue.push({ socket: activeSocket, message });
    return;
  }
  decisionInFlight = true;
  decisionSocket = activeSocket;
  try {
    handleDecision(activeSocket, message);
  } catch (error) {
    decisionInFlight = false;
    decisionSocket = null;
    decisionQueue = [];
    throw error;
  }
}

function handleMessage(activeSocket, data) {
  if (activeSocket !== socket) return;
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
    processDecision(activeSocket, message);
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
      `connected to match (grow=${chassisConfig.enableGrow ? "on" : "off"},` +
      `convert=${chassisConfig.enableConvert ? "on" : "off"},` +
      `naval=${chassisConfig.enableNaval ? "on" : "off"},` +
      "host-authority=external)",
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
