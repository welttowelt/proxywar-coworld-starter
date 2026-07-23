import { createRequire } from "node:module";

import {
  buildState,
  chooseAction,
  clean,
  recordDecision,
} from "./strategy-engine.mjs";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const url = process.env.COWORLD_PLAYER_WS_URL;
if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required");

const history = [];
const kindCode = {
  spawn: "spn",
  attack: "atk",
  nuke: "nuk",
  build: "bld",
  upgrade_structure: "upg",
  boat: "b0t",
  boat_retreat: "rtr",
  retreat: "rtr",
  warship: "w4r",
  move_warship: "mvw",
  alliance_request: "4ly",
  alliance_extend: "4ly",
  break_alliance: "brk",
  target_player: "tgt",
  embargo: "emb",
  donate_gold: "d0n",
  donate_troops: "d0n",
  hold: "h0d"
};

const socket = new WebSocket(url);
socket.on("open", () => console.log("kiz1 selector connected"));
socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message.type === "final") {
    socket.close(1000, "match complete");
    return;
  }
  if (message.type !== "decision_request") return;

  const actions = message.request.legalActions ?? [];
  const state = buildState(message.request.observation ?? {}, actions, history);
  const chosen = chooseAction(actions, state, null, history);
  recordDecision(history, chosen, state);
  const marker = clean(chosen.policyMarker)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const reason = `rul:${kindCode[chosen.kind] ?? "act"}${marker ? `:${marker}` : ""}`;

  socket.send(JSON.stringify({
    type: "decision_response",
    requestID: message.requestID,
    selectedLegalActionId: chosen.id,
    reason,
    confidence: 0.75,
    fallbackUsed: false,
    llmPlannerDegraded: false
  }));
});
socket.on("close", () => process.exit(0));
socket.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
