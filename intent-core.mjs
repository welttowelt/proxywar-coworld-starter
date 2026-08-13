import {
  chooseCaptainUnderpantsRuntimeAction,
  clean,
  rivalForAction,
  rivalIsProtected,
} from "./strategy-engine.mjs";

const INTENTS = new Set(["grow", "finish"]);
const HARMFUL_KINDS = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);
const MARKERS = Object.freeze({
  grow: "ixgrw",
  finish: "ixfin",
});
const EXECUTOR_MARKER = "ib2";

function isNeutral(action) {
  const targetID = clean(action?.metadata?.targetID ?? action?.targetID ?? "");
  const targetName = clean(action?.metadata?.targetName ?? "").toLowerCase();
  const text = `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
  return !targetID && (targetName === "terra nullius" || text.includes("terra nullius"));
}

function isStrike(action) {
  const unit = clean(action?.metadata?.unit ?? action?.unit ?? "").toLowerCase();
  return action?.kind === "nuke" || unit === "atom bomb";
}

function canHarmProtectedRival(action, state, history) {
  if ((!HARMFUL_KINDS.has(action?.kind) && !isStrike(action)) || isNeutral(action)) {
    return false;
  }
  const rival = rivalForAction(action, state);
  return rival ? rivalIsProtected(state, history, rival) : false;
}

function intentOf(plan) {
  return INTENTS.has(plan?.intent) ? plan.intent : "grow";
}

function allianceCounterparty(action) {
  return {
    id: clean(action?.metadata?.recipientID ?? action?.metadata?.targetID ?? "")
      .toLowerCase(),
    name: clean(action?.metadata?.recipientName ?? action?.metadata?.targetName ?? "")
      .toLowerCase(),
  };
}

function isPendingInboundAlliance(actions, selected) {
  const counterparty = allianceCounterparty(selected);
  return actions.some((action) => {
    if (action?.kind !== "alliance_reject") return false;
    const pending = allianceCounterparty(action);
    return (counterparty.id && pending.id === counterparty.id) ||
      (counterparty.name && pending.name === counterparty.name);
  });
}

// The planner chooses one outcome: grow or finish. The complete safe legal
// menu is delegated to the mature executor, which owns how to express that
// intent and selects every exact action and target.
export function chooseIntentCoreAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const intent = intentOf(plan);
  const safe = actions.filter((action) =>
    action && typeof action.id === "string" && action.id.length > 0 &&
    !canHarmProtectedRival(action, state, history)
  );
  if (safe.length === 0) throw new Error("intent selector found no safe legal action");

  // Grow describes the outcome, not a preferred action family. The mature
  // executor already owns growth; only finish changes its strategic mode.
  const executorPlan = intent === "finish" ? { strategicIntent: "finish" } : null;
  let selected = chooseCaptainUnderpantsRuntimeAction(safe, state, executorPlan, history);
  // Hosted decisions can invalidate a proactive alliance request before it is
  // applied, turning an otherwise legal response into a fallback hold. Grow
  // keeps real inbound handshakes immediate, but delegates again without
  // optional outgoing requests when another productive move is available.
  if (intent === "grow" && selected.kind === "alliance_request" &&
      !isPendingInboundAlliance(safe, selected)) {
    const withoutProactiveAlliance = safe.filter((action) =>
      action.kind !== "alliance_request"
    );
    if (withoutProactiveAlliance.length > 0) {
      const replacement = chooseCaptainUnderpantsRuntimeAction(
        withoutProactiveAlliance,
        state,
        executorPlan,
        history,
      );
      if (replacement?.kind !== "hold") {
        selected = {
          ...replacement,
          policyMarkers: [...new Set([
            ...(Array.isArray(replacement.policyMarkers) ? replacement.policyMarkers : []),
            replacement.policyMarker,
            "iax",
          ].filter(Boolean))],
        };
      }
    }
  }
  const policyMarkers = [...new Set([
    ...(Array.isArray(selected.policyMarkers) ? selected.policyMarkers : []),
    selected.policyMarker,
    EXECUTOR_MARKER,
    MARKERS[intent],
  ].filter(Boolean))];
  return {
    ...selected,
    policyMarker: selected.policyMarker ?? MARKERS[intent],
    policyMarkers,
  };
}
