import {
  actionPercent,
  clean,
  rivalForAction,
  rivalIsProtected,
} from "./strategy-engine.mjs";

const INTENTS = new Set(["grow", "secure", "finish"]);
const HARMFUL_KINDS = new Set([
  "attack", "boat", "nuke", "target_player", "embargo", "embargo_all",
]);
const PHYSICAL_KINDS = new Set(["attack", "boat", "nuke"]);
const SYMBOLIC_KINDS = new Set([
  "target_player", "embargo", "embargo_all", "embargo_stop",
  "alliance_request", "alliance_extend", "break_alliance", "quick_chat", "emoji",
]);
const MARKERS = Object.freeze({
  grow: "ixgrw",
  secure: "ixsec",
  finish: "ixfin",
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

function isExplicitNeutralGain(action, state) {
  if (action?.kind !== "attack" && action?.kind !== "boat") return false;
  if (actionRival(action, state)) return false;
  const targetID = normalizedID(
    action?.metadata?.targetID ?? action?.targetID ?? "",
  );
  if (targetID) return false;
  const targetName = clean(action?.metadata?.targetName ?? "").toLowerCase();
  const text = `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
  return targetName === "terra nullius" || text.includes("terra nullius");
}

function isPhysicalForce(action, state) {
  if (isExplicitNeutralGain(action, state)) return false;
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

function isHarmful(action, state) {
  if (isExplicitNeutralGain(action, state)) return false;
  return HARMFUL_KINDS.has(action?.kind) || isStrike(action);
}

function protectedHarm(action, state, history) {
  if (!isHarmful(action, state)) return false;
  const rival = actionRival(action, state);
  return rival ? rivalIsProtected(state, history, rival) : false;
}

function mission(plan) {
  if (INTENTS.has(plan?.intent)) {
    return { intent: plan.intent };
  }
  return { intent: "grow" };
}

function actionIntent(action, state) {
  if (!action || action.kind === "hold" || isSymbolic(action)) return null;
  if (isExplicitNeutralGain(action, state)) return "grow";
  if (isInfrastructure(action)) return "secure";
  if (isPhysicalForce(action, state)) return "finish";
  return null;
}

function offeredMenu(actions, state, history, requested) {
  const legal = actions.filter((action) =>
    action && typeof action.id === "string" && action.id.length > 0 &&
    !protectedHarm(action, state, history)
  );
  const actionable = legal.filter((action) => actionIntent(action, state) !== null);
  const allowedOutcomes = requested.intent === "finish"
    ? new Set(["finish", "grow", "secure"])
    : new Set(["grow", "secure"]);
  const aligned = actionable.filter((action) =>
    allowedOutcomes.has(actionIntent(action, state))
  );
  if (requested.intent === "finish") {
    const previousTarget = [...history].reverse().find((entry) =>
      entry?.policyMarker === MARKERS.finish && typeof entry?.targetID === "string"
    )?.targetID;
    if (previousTarget) {
      const continued = aligned.filter((action) =>
        actionIntent(action, state) === "finish" && sameTarget(action, previousTarget, state)
      );
      if (continued.length > 0) {
        return {
          directive: requested,
          actions: [
            ...continued,
            ...aligned.filter((action) => actionIntent(action, state) !== "finish"),
          ],
        };
      }
    }
  }
  if (aligned.length > 0) return { directive: requested, actions: aligned };
  const hold = legal.find((action) => action.kind === "hold");
  return { directive: requested, actions: hold ? [hold] : [] };
}

function sameTarget(action, targetID, state) {
  return targetID.length > 0 && actionTargetID(action, state) === targetID;
}

function missionScore(action, directive, state) {
  if (action.kind === "hold") return -200;
  const outcome = actionIntent(action, state);
  const preferences = {
    grow: { grow: 300, secure: 180, finish: 80 },
    secure: { secure: 300, grow: 240, finish: 80 },
    finish: { finish: 340, grow: 180, secure: 140 },
  };
  return preferences[directive.intent]?.[outcome] ?? -1000;
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
  if (directive.intent === "grow" && isExplicitNeutralGain(action, state)) return percent / 10;
  if (directive.intent === "finish" && isPhysicalForce(action, state)) {
    const rival = actionRival(action, state);
    const ratio = Number(rival?.relativeTroopRatio);
    return Number.isFinite(ratio) && ratio >= 1.2 ? percent / 20 : -percent / 20;
  }
  return 0;
}

function riskPenalty(action, directive, state) {
  if (action?.risk?.level !== "high") return 0;
  return directive.intent === "finish" && isPhysicalForce(action, state) ? 40 : 120;
}

export function chooseIntentCoreAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const spawn = actions.find((action) => action?.kind === "spawn");
  if (spawn) return spawn;

  const requested = mission(plan);
  const { directive, actions: menu } = offeredMenu(
    actions, state, history, requested,
  );
  if (menu.length === 0) throw new Error("intent core found no safe intent action");

  const ranked = menu.map((action) => ({
    action,
    score: missionScore(action, directive, state) - repetitionPenalty(action, history) -
      riskPenalty(action, directive, state) + commitmentTieBreak(action, directive, state),
  })).sort((left, right) =>
    right.score - left.score || left.action.id.localeCompare(right.action.id)
  );
  return { ...ranked[0].action, policyMarker: MARKERS[directive.intent] };
}
