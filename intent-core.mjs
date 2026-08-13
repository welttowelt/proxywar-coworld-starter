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
const MATERIAL_KINDS = new Set([
  "spawn", "attack", "nuke", "build", "upgrade_structure", "boat",
  "boat_retreat", "retreat", "warship", "move_warship",
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

function materialIntentMenu(actions) {
  const material = actions.filter((action) => MATERIAL_KINDS.has(action.kind));
  if (material.length > 0) return material;
  const holds = actions.filter((action) => action.kind === "hold");
  return holds.length > 0 ? holds : actions;
}

function hasIncomingPressure(state) {
  const attackers = state?.self?.allProtocolAttackerIDs;
  if (Array.isArray(attackers) && attackers.length > 0) return true;
  const incoming = state?.self?.incomingAttacks;
  return Array.isArray(incoming) ? incoming.length > 0 : Number(incoming) > 0;
}

function intentMenu(actions, intent, state) {
  const spawn = actions.filter((action) => action.kind === "spawn");
  if (spawn.length > 0) return spawn;
  if (hasIncomingPressure(state)) return actions;

  const matching = actions.filter((action) => {
    if (intent === "grow") {
      return ((action.kind === "attack" || action.kind === "boat") && !isStrike(action)) ||
        ((action.kind === "build" || action.kind === "upgrade_structure") && !isStrike(action));
    }
    return !isNeutral(action) && (
      isStrike(action) ||
      ["attack", "boat", "nuke", "warship", "move_warship"].includes(action.kind)
    );
  });
  if (intent === "grow") {
    const direct = matching.filter((action) =>
      action.kind === "build" || isNeutral(action)
    );
    if (direct.length > 0) return direct;
  }
  return matching.length > 0 ? matching : actions;
}

// The planner chooses one outcome: grow or finish. That intent defines
// only the eligible action family; the mature executor still owns the exact
// action and target. Incoming pressure reopens the full safe material menu.
// When the requested family is absent, execution stays productive instead of
// stalling, and when no material action exists, hold is preferred.
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

  const material = materialIntentMenu(safe);
  const selected = chooseCaptainUnderpantsRuntimeAction(
    intentMenu(material, intent, state),
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
