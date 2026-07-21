import { WebSocket } from "ws";
import { buildState, chooseAction, recordDecision } from "./strategy-engine.mjs";

const history = [];
const socket = new WebSocket(process.env.COWORLD_PLAYER_WS_URL);

function percent(action) {
  const value = Number(action?.metadata?.troopPercent);
  if (Number.isFinite(value)) return value;
  const match = String(action?.id ?? "").match(/:(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : -1;
}

function isOdinAttack(action) {
  const name = String(action?.metadata?.targetName ?? "")
    .normalize("NFKC")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return action?.kind === "attack" && name === "k1z odin free";
}

socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message.type === "final") return socket.close();
  if (message.type !== "decision_request") return;
  const actions = message.request?.legalActions ?? [];
  const state = buildState(message.request?.observation ?? {}, actions, history);
  const forced = actions
    .filter(isOdinAttack)
    .sort((left, right) => percent(left) - percent(right))[0];
  const action = forced ?? chooseAction(actions, state, null, history);
  recordDecision(history, action, state);
  socket.send(JSON.stringify({
    type: "decision_response",
    requestID: message.requestID,
    selectedLegalActionId: action.id,
    reason: forced ? "pressure:atk:odin10" : `pressure:${action.kind}`,
    confidence: 0.99,
  }));
});

socket.on("close", () => process.exit(0));
socket.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
