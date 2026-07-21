import { WebSocket } from "ws";
import {
  chooseNeutralOpponentAction,
  publicNeutralOpponentReason,
} from "./hrafn-neutral-opponent.mjs";

const url = process.env.COWORLD_PLAYER_WS_URL;
if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required");

const history = [];
const rv1Enabled = process.env.HRAFN_RV1 !== "0";
const reconnectBaseMs = Math.max(10, Number(process.env.RECONNECT_BASE_MS) || 500);
let socket = null;
let finalReceived = false;
let reconnectAttempt = 0;
let reconnectTimer = null;

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

  const actions = message.request?.legalActions ?? [];
  const observation = message.request?.observation ?? {};
  const chosen = chooseNeutralOpponentAction(actions, observation, history, {
    rv1Enabled,
  });
  activeSocket.send(JSON.stringify({
    type: "decision_response",
    requestID: message.requestID,
    selectedLegalActionId: chosen.id,
    reason: publicNeutralOpponentReason(chosen),
    confidence: chosen.kind === "hold" ? 0.5 : 0.82,
    fallbackUsed: false,
    llmPlannerDegraded: false,
  }), (error) => {
    if (!error) return;
    console.error(`decision response failed: ${error?.message || error}`);
    activeSocket.terminate();
  });
}

function scheduleReconnect() {
  if (finalReceived || reconnectTimer !== null) return;
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
    reconnectAttempt = 0;
    console.log(`connected to match (neutral-v5=on,rv1=${rv1Enabled ? "on" : "off"})`);
  });
  activeSocket.on("message", (data) => handleMessage(activeSocket, data));
  activeSocket.on("close", (code, reason) => {
    if (activeSocket !== socket) return;
    socket = null;
    if (finalReceived) {
      process.exit(0);
      return;
    }
    console.error(`match socket closed (${code}: ${String(reason) || "none"}); reconnecting`);
    scheduleReconnect();
  });
  activeSocket.on("error", (error) => {
    console.error(`match socket error: ${error?.message || error}`);
    activeSocket.terminate();
  });
}

connect();
const heartbeat = setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.ping();
}, 15000);
heartbeat.unref();
