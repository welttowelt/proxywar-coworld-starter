import {
  actionPercent,
  clean,
  incomingThreatCount,
  isNeutralBoat,
  isNeutralExpansion,
  rivalForAction,
  rivalIsProtected,
} from "./strategy-engine.mjs";

const INTENTS = new Set(["expand", "fortify", "defend", "ally", "pressure"]);
const TARGETED_INTENTS = new Set(["ally", "pressure"]);
const HARMFUL_KINDS = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);
const PHYSICAL_PRESSURE_KINDS = new Set(["attack", "boat", "nuke"]);
const PRESSURE_SIGNAL_KINDS = new Set([
  "target_player", "embargo", "embargo_all", "embargo_stop",
]);
const MARKERS = Object.freeze({
  expand: "ixexp",
  fortify: "ixfor",
  defend: "ixdef",
  ally: "ixaly",
  pressure: "ixprs",
});

function normalizedID(value) {
  return clean(value).toLowerCase();
}

function actionUnit(action) {
  return clean(action?.metadata?.unit ?? action?.unit ?? "").toLowerCase();
}

function isStrike(action) {
  return action?.kind === "nuke" || actionUnit(action) === "atom bomb";
}

function isPhysicalPressure(action) {
  if (isNeutralExpansion(action) || isNeutralBoat(action)) return false;
  return PHYSICAL_PRESSURE_KINDS.has(action?.kind) || isStrike(action);
}

function isPressureSignal(action) {
  return PRESSURE_SIGNAL_KINDS.has(action?.kind);
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

function offeredMenu(actions, state, history) {
  const legal = actions.filter((action) =>
    action && typeof action.id === "string" && action.id.length > 0 &&
    !protectedHarm(action, state, history)
  );
  const active = legal.filter((action) => action?.kind !== "hold");
  const lowerRisk = active.filter((action) => action?.risk?.level !== "high");
  if (lowerRisk.length > 0) return lowerRisk;
  if (active.length > 0) return active;
  return legal;
}

function currentAttackerIDs(state) {
  return new Set([
    ...(state?.self?.incomingAttackerIDs || []),
    ...(state?.self?.allProtocolAttackerIDs || []),
  ].map(normalizedID).filter(Boolean));
}

function planIntent(plan, state) {
  const legacy = plan?.intent === "grow"
    ? "expand"
    : plan?.intent === "convert"
      ? "pressure"
      : plan?.intent;
  if (INTENTS.has(legacy)) {
    return {
      intent: legacy,
      targetID: TARGETED_INTENTS.has(legacy) ? normalizedID(plan?.targetID) : null,
    };
  }
  const pressured = incomingThreatCount(state?.self?.incomingAttacks) > 0 ||
    currentAttackerIDs(state).size > 0;
  if (pressured) return { intent: "defend", targetID: null };
  if (Number(state?.self?.tileShare ?? 0) < 0.15) {
    return { intent: "expand", targetID: null };
  }
  return { intent: "fortify", targetID: null };
}

function isAllianceAction(action) {
  return action?.kind === "alliance_request" || action?.kind === "alliance_extend";
}

function isRetreat(action) {
  return action?.kind === "retreat" || action?.kind === "boat_retreat";
}

function isInfrastructure(action) {
  return action?.kind === "build" || action?.kind === "upgrade_structure" || isStrike(action);
}

function sameTarget(action, targetID, state) {
  return targetID.length > 0 && actionTargetID(action, state) === targetID;
}

function intentScore(action, directive, state) {
  const { intent, targetID } = directive;
  const neutralLand = isNeutralExpansion(action);
  const neutralBoat = isNeutralBoat(action);
  const alliance = isAllianceAction(action);
  const retreat = isRetreat(action);
  const infrastructure = isInfrastructure(action);
  const harmful = isHarmful(action);
  const exactTarget = targetID ? sameTarget(action, targetID, state) : false;
  const attackers = currentAttackerIDs(state);
  const answersAttacker = harmful && attackers.has(actionTargetID(action, state));

  if (intent === "expand") {
    if (neutralLand) return 240;
    if (neutralBoat) return 220;
    if (infrastructure) return 100;
    if (retreat) return 70;
    if (harmful) return 50;
    if (alliance) return 20;
    return action.kind === "hold" ? -200 : 10;
  }

  if (intent === "fortify") {
    if (infrastructure) return isStrike(action) ? 230 : 240;
    if (retreat) return 130;
    if (neutralLand || neutralBoat) return 100;
    if (harmful) return 60;
    if (alliance) return 30;
    return action.kind === "hold" ? -200 : 20;
  }

  if (intent === "defend") {
    if (answersAttacker) return 260;
    if (retreat) return 240;
    if (infrastructure) return 180;
    if (neutralLand || neutralBoat) return 80;
    if (alliance) return 60;
    if (harmful) return 20;
    return action.kind === "hold" ? -200 : 30;
  }

  if (intent === "ally") {
    if (alliance && exactTarget) return 280;
    if (alliance || harmful) return -120;
    if (infrastructure) return 100;
    if (neutralLand || neutralBoat) return 80;
    if (retreat) return 70;
    return action.kind === "hold" ? -200 : 20;
  }

  // Pressure is an outcome, not a declaration. Prefer actions that change
  // territory or force over target/embargo toggles, even when the toggle is
  // aimed at the requested rival.
  if (isPhysicalPressure(action) && exactTarget) return 300;
  if (isPhysicalPressure(action)) return -120;
  if (infrastructure) return 180;
  if (neutralLand || neutralBoat) return 160;
  if (isPressureSignal(action) && exactTarget) return 40;
  if (isPressureSignal(action) || harmful) return -120;
  if (alliance) return 20;
  if (retreat) return 70;
  return action.kind === "hold" ? -200 : 30;
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
  if (directive.intent === "expand" && isNeutralExpansion(action)) return percent / 10;
  if ((directive.intent === "pressure" || directive.intent === "defend") &&
      isHarmful(action)) {
    const rival = actionRival(action, state);
    const ratio = Number(rival?.relativeTroopRatio);
    return Number.isFinite(ratio) && ratio >= 1.2 ? percent / 20 : -percent / 20;
  }
  return 0;
}

export function chooseIntentCoreAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const spawn = actions.find((action) => action?.kind === "spawn");
  if (spawn) return spawn;

  const directive = planIntent(plan, state);
  const menu = offeredMenu(actions, state, history);
  if (menu.length === 0) {
    const hold = actions.find((action) => action?.kind === "hold");
    if (hold) return { ...hold, policyMarker: MARKERS[directive.intent] };
    throw new Error("intent core found no safe offered action");
  }

  const ranked = menu.map((action) => ({
    action,
    score: intentScore(action, directive, state) - repetitionPenalty(action, history) +
      commitmentTieBreak(action, directive, state),
  })).sort((left, right) =>
    right.score - left.score || left.action.id.localeCompare(right.action.id)
  );
  return { ...ranked[0].action, policyMarker: MARKERS[directive.intent] };
}
