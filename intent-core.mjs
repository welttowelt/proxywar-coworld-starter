import {
  chooseCaptainUnderpantsRuntimeAction,
  clean,
  rivalForAction,
  rivalIsProtected,
} from "./strategy-engine.mjs";

const INTENTS = new Set(["grow", "secure", "finish"]);
const HARMFUL_KINDS = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);
const MATERIAL_KINDS = new Set([
  "spawn", "attack", "nuke", "build", "upgrade_structure", "boat",
  "boat_retreat", "retreat", "warship", "move_warship",
]);
const MARKERS = Object.freeze({
  grow: "ixgrw",
  secure: "ixsec",
  finish: "ixfin",
});
const EXECUTOR_MARKER = "id1";

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

function materialIntentMenu(actions) {
  const material = actions.filter((action) => MATERIAL_KINDS.has(action.kind));
  if (material.length > 0) return material;
  const holds = actions.filter((action) => action.kind === "hold");
  return holds.length > 0 ? holds : actions;
}

// The planner chooses one outcome: grow, secure, or finish. The mature
// executor owns every action and target inside the safe material menu. This
// keeps one tactical system and prevents diplomacy or chat from impersonating
// execution; when no material action exists, hold is preferred.
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
    materialIntentMenu(safe),
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
