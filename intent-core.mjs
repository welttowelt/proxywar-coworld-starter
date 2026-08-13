import {
  actionPercent,
  clean,
  isNeutralBoat,
  isNeutralExpansion,
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
const RANKER_MARKERS = Object.freeze({
  grow: "iu1g",
  secure: "iu1s",
  finish: "iu1f",
});
const INTENT_WEIGHTS = Object.freeze({
  grow: Object.freeze({ progress: 4, safety: 1.2, closure: 0.8 }),
  secure: Object.freeze({ progress: 1.8, safety: 4, closure: 0.8 }),
  finish: Object.freeze({ progress: 1.2, safety: 1.2, closure: 4 }),
});

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

function recentCount(history, action, target) {
  return history.slice(-8).reduce((count, entry) => count + Number(
    entry.kind === action.kind &&
    (!target || entry.targetID === target.id.toLowerCase()),
  ), 0);
}

function actionFeatures(action, state, history) {
  const target = rivalForAction(action, state);
  const targetID = target?.id?.toLowerCase() ?? null;
  const attackerIDs = [
    ...(state.self.incomingAttackerIDs || []),
    ...(state.self.allProtocolAttackerIDs || []),
  ];
  const incoming = targetID !== null && attackerIDs.includes(targetID);
  const pressure = attackerIDs.length > 0 || Number(state.self.incomingAttacks) > 0;
  const text = `${action.id} ${action.label ?? ""}`.toLowerCase();
  const unit = clean(action?.metadata?.unit ?? "").toLowerCase();
  const neutral = isNeutralExpansion(action) || isNeutralBoat(action);
  const ratio = Number(target?.relativeTroopRatio);
  const share = Number(target?.tileShare) || 0;
  const percent = actionPercent(action);
  const repeated = recentCount(history, action, target);
  let progress = 0;
  let safety = 0;
  let closure = 0;
  let friction = action.risk?.level === "high" ? 3 : 0;

  switch (action.kind) {
    case "spawn":
      return { progress: 1_000_000, safety: 0, closure: 0, friction: 0 };
    case "attack":
      if (neutral) {
        progress += 4 + (percent === null ? 0 : 1 - Math.abs(percent - 20) / 40);
      } else if (target) {
        const viable = Number.isFinite(ratio) ? ratio : 0;
        progress += viable >= 1 ? 1 + Math.min(viable - 1, 2) : -2;
        closure += viable >= 1
          ? 2 + Math.min(viable - 1, 2) + Math.min(share * 4, 2)
          : -4;
        if (incoming) safety += 11;
      }
      break;
    case "nuke":
      closure += 7 + Math.min(share * 4, 2);
      if (incoming) safety += 2;
      break;
    case "build":
      progress += unit === "atom bomb" ? 1 : 2.5;
      safety += text.includes("defense") || text.includes("sam") ? 4 : 1.5;
      if (unit === "atom bomb") closure += 5;
      if (pressure) safety += 1.5;
      break;
    case "upgrade_structure":
      progress += 2.5;
      safety += 1;
      break;
    case "boat":
      progress += neutral ? 2.5 : 1;
      closure += neutral ? 0 : (Number.isFinite(ratio) && ratio >= 1 ? 1.5 : -1);
      break;
    case "boat_retreat":
    case "retreat":
      safety += pressure ? 7 : 2;
      break;
    case "warship":
    case "move_warship":
      progress += 1;
      safety += 1.5;
      closure += 1;
      break;
    case "alliance_request":
    case "alliance_extend":
      safety += pressure ? 5 : 2;
      progress += 0.5;
      friction += repeated * 3;
      break;
    case "break_alliance":
      closure += target && target.tileShare >= state.topRivalTileShare - 0.005 ? 2 : 0;
      friction += repeated * 4;
      break;
    case "target_player":
      closure += target ? 0.5 + Math.min(share, 0.5) : 0;
      friction += 2 + repeated * 5;
      break;
    case "embargo":
    case "embargo_all":
      closure += 1.5;
      friction += 1 + repeated * 3;
      break;
    case "embargo_stop":
      safety += 1;
      break;
    case "donate_gold":
    case "donate_troops":
      safety += target?.isAllied ? 0.5 : 0;
      friction += 3 + repeated * 3;
      break;
    case "quick_chat":
    case "emoji":
      friction += 5 + repeated * 4;
      break;
    case "hold":
      friction += 100;
      break;
    default:
      friction += 1;
  }

  if (pressure && !incoming && ![
    "build", "boat_retreat", "retreat", "alliance_request", "alliance_extend",
  ].includes(action.kind)) {
    safety -= 1.5;
  }
  if (["boat", "build", "upgrade_structure", "warship", "move_warship"].includes(action.kind)) {
    friction += repeated * 1.5;
  } else if (action.kind === "attack" && !neutral) {
    friction += Math.max(0, repeated - 3) * 1.5;
  }
  return { progress, safety, closure, friction };
}

function rankAction(action, state, intent, history) {
  const features = actionFeatures(action, state, history);
  const weights = INTENT_WEIGHTS[intent];
  return features.progress * weights.progress +
    features.safety * weights.safety +
    features.closure * weights.closure - features.friction;
}

function chooseIntentUtilityAction(actions, state, intent, history) {
  return actions
    .map((action, index) => ({
      action,
      index,
      score: rankAction(action, state, intent, history),
    }))
    .sort((left, right) =>
      right.score - left.score || left.index - right.index
    )[0].action;
}

function materialIntentMenu(actions) {
  const material = actions.filter((action) => MATERIAL_KINDS.has(action.kind));
  if (material.length > 0) return material;
  const holds = actions.filter((action) => action.kind === "hold");
  return holds.length > 0 ? holds : actions;
}

// The planner owns one decision only: grow, secure, or finish. A single
// utility function ranks material legal actions through four reusable
// features: progress, safety, closure, and repetition friction. Diplomacy and
// chat cannot substitute for execution; when no material move exists, hold is
// preferred. Safety and legal-ID checks stay outside the planner contract.
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

  const selected = chooseIntentUtilityAction(materialIntentMenu(safe), state, intent, history);
  const policyMarkers = [...new Set([
    ...(Array.isArray(selected.policyMarkers) ? selected.policyMarkers : []),
    selected.policyMarker,
    RANKER_MARKERS[intent],
    MARKERS[intent],
  ].filter(Boolean))];
  return {
    ...selected,
    policyMarker: selected.policyMarker ?? MARKERS[intent],
    policyMarkers,
  };
}
