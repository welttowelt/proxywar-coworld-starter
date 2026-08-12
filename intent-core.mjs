import {
  actionPercent,
  clean,
  incomingThreatCount,
  isNeutralBoat,
  isNeutralExpansion,
  rivalForAction,
  rivalIsProtected,
  territoryCollapsing,
} from "./strategy-engine.mjs";

const INTENTS = new Set(["grow", "convert"]);
const HARMFUL_KINDS = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);
const PHYSICAL_KINDS = new Set(["attack", "boat", "nuke"]);
const SYMBOLIC_KINDS = new Set([
  "target_player", "embargo", "embargo_all", "embargo_stop",
  "alliance_request", "alliance_extend", "break_alliance", "quick_chat", "emoji",
]);
const MARKERS = Object.freeze({ grow: "ixexp", convert: "ixprs" });

function normalizedID(value) {
  return clean(value).toLowerCase();
}

function actionUnit(action) {
  return clean(action?.metadata?.unit ?? action?.unit ?? "").toLowerCase();
}

function isStrike(action) {
  return action?.kind === "nuke" || actionUnit(action) === "atom bomb";
}

function isPhysicalForce(action) {
  if (isNeutralExpansion(action) || isNeutralBoat(action)) return false;
  return PHYSICAL_KINDS.has(action?.kind) || isStrike(action);
}

function isInfrastructure(action) {
  return action?.kind === "build" || action?.kind === "upgrade_structure";
}

function isSymbolic(action) {
  return SYMBOLIC_KINDS.has(action?.kind);
}

function actionRival(action, state) {
  return rivalForAction(action, state);
}

function actionTargetID(action, state) {
  const direct = normalizedID(
    action?.metadata?.targetID ?? action?.metadata?.recipientID ??
    action?.targetID ?? action?.recipientID ?? "",
  );
  if (direct) return direct;
  return normalizedID(actionRival(action, state)?.id);
}

function isHarmful(action) {
  if (isNeutralExpansion(action) || isNeutralBoat(action)) return false;
  return HARMFUL_KINDS.has(action?.kind) || isStrike(action);
}

function protectedHarm(action, state, history) {
  if (!isHarmful(action)) return false;
  const rival = actionRival(action, state);
  return rival ? rivalIsProtected(state, history, rival) : false;
}

function currentAttackerIDs(state) {
  return new Set([
    ...(state?.self?.incomingAttackerIDs || []),
    ...(state?.self?.allProtocolAttackerIDs || []),
  ].map(normalizedID).filter(Boolean));
}

function bestConversionTarget(state, history) {
  const attackers = currentAttackerIDs(state);
  const candidates = (state?.rivals || [])
    .filter((rival) => !rivalIsProtected(state, history, rival))
    .sort((left, right) => {
      const leftAttacker = attackers.has(normalizedID(left.id)) ? 1 : 0;
      const rightAttacker = attackers.has(normalizedID(right.id)) ? 1 : 0;
      const leftReach = left.canAttack || left.sharesBorder ? 1 : 0;
      const rightReach = right.canAttack || right.sharesBorder ? 1 : 0;
      const leftRatio = Number.isFinite(left.relativeTroopRatio)
        ? left.relativeTroopRatio : -1;
      const rightRatio = Number.isFinite(right.relativeTroopRatio)
        ? right.relativeTroopRatio : -1;
      return rightAttacker - leftAttacker || rightReach - leftReach ||
        rightRatio - leftRatio || right.tileShare - left.tileShare ||
        normalizedID(left.id).localeCompare(normalizedID(right.id));
    });
  return normalizedID(candidates[0]?.id);
}

function mission(plan, state, history) {
  const collapsing = territoryCollapsing(state, history);
  const attacked = incomingThreatCount(state?.self?.incomingAttacks) > 0 ||
    currentAttackerIDs(state).size > 0;
  if (collapsing || attacked) {
    return { intent: "convert", targetID: bestConversionTarget(state, history) };
  }
  if (INTENTS.has(plan?.intent)) {
    return {
      intent: plan.intent,
      targetID: plan.intent === "convert" ? normalizedID(plan?.targetID) : null,
    };
  }
  return { intent: "grow", targetID: null };
}

function actionIntent(action) {
  if (!action || action.kind === "hold" || isSymbolic(action)) return null;
  if (isNeutralExpansion(action) || isNeutralBoat(action) || isInfrastructure(action)) {
    return "grow";
  }
  if (isPhysicalForce(action)) return "convert";
  return null;
}

function offeredMenu(actions, state, history, requested) {
  const legal = actions.filter((action) =>
    action && typeof action.id === "string" && action.id.length > 0 &&
    !protectedHarm(action, state, history)
  );
  const aligned = legal.filter((action) => actionIntent(action) === requested.intent);
  if (aligned.length > 0) return { directive: requested, actions: aligned };

  const fallbackIntent = requested.intent === "grow" ? "convert" : "grow";
  const fallback = legal.filter((action) => actionIntent(action) === fallbackIntent);
  if (fallback.length > 0) {
    return {
      directive: {
        intent: fallbackIntent,
        targetID: fallbackIntent === "convert"
          ? bestConversionTarget(state, history) : null,
      },
      actions: fallback,
    };
  }

  const hold = legal.find((action) => action.kind === "hold");
  return { directive: requested, actions: hold ? [hold] : [] };
}

function sameTarget(action, targetID, state) {
  return targetID.length > 0 && actionTargetID(action, state) === targetID;
}

function missionScore(action, directive, state) {
  const neutralLand = isNeutralExpansion(action);
  const neutralBoat = isNeutralBoat(action);
  const infrastructure = isInfrastructure(action);
  const physical = isPhysicalForce(action);
  const exactTarget = directive.targetID
    ? sameTarget(action, directive.targetID, state) : false;

  if (directive.intent === "grow") {
    if (neutralLand) return 300;
    if (neutralBoat) return 260;
    if (infrastructure) return 220;
    return action.kind === "hold" ? -200 : -1000;
  }

  if (physical && exactTarget) return 340;
  if (physical) return 280;
  return action.kind === "hold" ? -200 : -1000;
}

function repetitionPenalty(action, history) {
  let penalty = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.kind !== action.kind) break;
    penalty += 4;
    if (penalty >= 28) break;
  }
  if (history.at(-1)?.actionID === action.id) penalty += 20;
  return penalty;
}

function commitmentTieBreak(action, directive, state) {
  const percent = actionPercent(action);
  if (!Number.isFinite(percent)) return 0;
  if (directive.intent === "grow" && isNeutralExpansion(action)) return percent / 10;
  if (directive.intent === "convert" && isPhysicalForce(action)) {
    const rival = actionRival(action, state);
    const ratio = Number(rival?.relativeTroopRatio);
    return Number.isFinite(ratio) && ratio >= 1.2 ? percent / 20 : -percent / 20;
  }
  return 0;
}

function riskPenalty(action, directive) {
  if (action?.risk?.level !== "high") return 0;
  return directive.intent === "convert" && isPhysicalForce(action) ? 40 : 120;
}

export function chooseIntentCoreAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const spawn = actions.find((action) => action?.kind === "spawn");
  if (spawn) return spawn;

  const requested = mission(plan, state, history);
  const { directive, actions: menu } = offeredMenu(
    actions, state, history, requested,
  );
  if (menu.length === 0) throw new Error("intent core found no safe intent action");

  const ranked = menu.map((action) => ({
    action,
    score: missionScore(action, directive, state) - repetitionPenalty(action, history) -
      riskPenalty(action, directive) + commitmentTieBreak(action, directive, state),
  })).sort((left, right) =>
    right.score - left.score || left.action.id.localeCompare(right.action.id)
  );
  return { ...ranked[0].action, policyMarker: MARKERS[directive.intent] };
}
