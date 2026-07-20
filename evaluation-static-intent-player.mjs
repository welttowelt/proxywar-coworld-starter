/**
 * EVALUATION ONLY. This credential-free runtime accepts an arm only from a
 * baked JavaScript entrypoint and feeds its deterministic schedule through
 * Mickey's production normalizer and selector. It is absent from the default
 * production image and launch.sh.
 */
import { WebSocket } from "ws";

import {
  EVALUATION_SURROGATE_SOURCE,
  createStaticIntentScheduler,
  parseStaticIntentArm,
  staticIntentArmToken,
} from "./evaluation-static-intent.mjs";
import {
  buildState,
  chooseAction,
  clean,
  recordDecision,
} from "./strategy-engine.mjs";

const PUBLIC_KIND = {
  spawn: "spn", attack: "atk", nuke: "nuk", build: "bld",
  upgrade_structure: "upg", boat: "b0t", boat_retreat: "rtr", retreat: "rtr",
  warship: "w4r", move_warship: "mvw", alliance_request: "4ly",
  alliance_extend: "4ly", break_alliance: "brk", target_player: "tgt",
  embargo: "emb", embargo_all: "emb", embargo_stop: "emb", donate_gold: "d0n",
  donate_troops: "d0n", quick_chat: "cht", emoji: "emj", hold: "h0d",
};

function actionTargetID(action) {
  return clean(action?.metadata?.targetID ?? action?.metadata?.recipientID ?? "") || null;
}

function publicReason(armToken, chosen, scheduled, reached) {
  const kind = PUBLIC_KIND[chosen.kind] || "act";
  const marker = clean(chosen.policyMarker).toLowerCase().replace(/[^a-z0-9]/g, "");
  const status = reached ? "rch" : scheduled ? "sch" : "base";
  return ["sev1", armToken, status, kind, marker]
    .filter(Boolean)
    .join(":")
    .slice(0, 48);
}

export function evaluationResponseMetadata(actionDelta) {
  return {
    confidence: actionDelta ? 0.75 : 0.4,
    fallbackUsed: !actionDelta,
    llmPlannerDegraded: false,
  };
}

export function startStaticIntentPlayer(value) {
  const arm = parseStaticIntentArm([value]);
  const armToken = staticIntentArmToken(arm);
  const scheduler = createStaticIntentScheduler(arm);
  const url = process.env.COWORLD_PLAYER_WS_URL;
  if (!url) throw new Error("COWORLD_PLAYER_WS_URL is required (the match provides it)");

  const reconnectBaseMs = Math.max(10, Number(process.env.RECONNECT_BASE_MS) || 500);
  const history = [];
  let socket = null;
  let finalReceived = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;

  function emitTelemetry(message, state, plan, schedule, baseline, chosen) {
    const actionDelta = chosen.id !== baseline.id;
    const marker = clean(chosen.policyMarker).toLowerCase();
    const reached = actionDelta && (marker === "mm1g" || marker === "mm1c");
    console.log(JSON.stringify({
      type: "evaluation_static_intent_decision",
      source: EVALUATION_SURROGATE_SOURCE,
      arm,
      requestID: clean(message.requestID),
      decisionNumber: state.decisionNumber,
      scheduled: plan !== null,
      reached,
      refreshed: schedule.refreshed,
      planAge: schedule.planAge,
      directive: plan?.intent ?? null,
      directiveTargetID: plan?.targetID ?? null,
      baselineActionID: baseline.id,
      baselineActionKind: baseline.kind,
      selectedActionID: chosen.id,
      selectedActionKind: chosen.kind,
      selectedTargetID: actionTargetID(chosen),
      actionDelta,
      policyMarker: chosen.policyMarker ?? null,
    }));
    return { actionDelta, reached };
  }

  function handleMessage(activeSocket, data) {
    if (activeSocket !== socket) return;
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
    if (message.type !== "decision_request") return;

    const actions = message.request.legalActions ?? [];
    const observation = message.request.observation ?? {};
    const state = buildState(observation, actions, history);
    const schedule = scheduler.next(state, history);
    const plan = schedule.plan;
    const baseline = chooseAction(actions, state, null, history);
    const chosen = chooseAction(actions, state, plan, history);
    const telemetry = emitTelemetry(message, state, plan, schedule, baseline, chosen);
    const reason = publicReason(armToken, chosen, plan !== null, telemetry.reached);

    recordDecision(history, chosen, state);
    const response = JSON.stringify({
      type: "decision_response",
      requestID: message.requestID,
      selectedLegalActionId: chosen.id,
      reason,
      ...evaluationResponseMetadata(telemetry.actionDelta),
    });
    if (activeSocket.readyState !== WebSocket.OPEN) return;
    activeSocket.send(response, (error) => {
      if (!error) return;
      console.error(`decision response failed: ${error.message || error}`);
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
      console.log(JSON.stringify({
        type: "evaluation_static_intent_start",
        source: EVALUATION_SURROGATE_SOURCE,
        arm,
        uploadEligible: false,
      }));
    });
    activeSocket.on("message", (data) => handleMessage(activeSocket, data));
    activeSocket.on("close", (code, reason) => {
      if (activeSocket !== socket) return;
      socket = null;
      if (finalReceived) {
        process.exit(0);
        return;
      }
      console.error(
        `match socket closed unexpectedly (${code}: ${clean(reason) || "no reason"}); reconnecting`,
      );
      scheduleReconnect();
    });
    activeSocket.on("error", (error) => {
      console.error(`match socket error: ${error.message || error}`);
      activeSocket.terminate();
    });
  }

  connect();
  const heartbeat = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.ping();
  }, 15000);
  heartbeat.unref();
}
