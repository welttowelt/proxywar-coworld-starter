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

  const selected = chooseCaptainUnderpantsRuntimeAction(
    safe,
    state,
    { strategicIntent: intent },
    history,
  );
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
