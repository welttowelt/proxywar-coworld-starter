import { clean } from "./strategy-engine.mjs";

export const MIN_INTENT_HORIZON = 2;
export const MAX_INTENT_HORIZON = 12;
export const INTENTS = Object.freeze(["grow", "convert"]);

const DIRECTIVE_KEYS = Object.freeze(["horizon", "intent", "targetID"]);

function exactKeys(value) {
  return Object.keys(value).sort().join("\0") === DIRECTIVE_KEYS.join("\0");
}

function eligibleTarget(state, targetID) {
  const normalized = clean(targetID).toLowerCase();
  return normalized.length > 0 && state?.rivals?.some((rival) => {
    const rivalID = clean(rival.id).toLowerCase();
    return rivalID.length > 0 && rivalID === normalized;
  });
}

// Accept only a small mission-command packet. Unknown keys, coerced numbers,
// target names, and tactical instructions are rejected instead of repaired.
export function normalizeIntentDirective(value, state, model = "unknown") {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value)) {
    return null;
  }
  const intent = clean(value.intent).toLowerCase();
  if (!INTENTS.includes(intent)) return null;
  if (!Number.isInteger(value.horizon) ||
      value.horizon < MIN_INTENT_HORIZON ||
      value.horizon > MAX_INTENT_HORIZON) {
    return null;
  }

  if (intent === "grow" && value.targetID !== null) return null;
  if (intent === "convert" &&
      (typeof value.targetID !== "string" || !eligibleTarget(state, value.targetID))) {
    return null;
  }

  return {
    intent,
    targetID: intent === "convert" ? clean(value.targetID) : null,
    horizon: value.horizon,
    model: clean(model) || "unknown",
  };
}

export function intentRefreshInterval(plan, configuredMaximum = 8) {
  const maximum = Math.max(1, Math.trunc(Number(configuredMaximum)) || 8);
  if (!Number.isInteger(plan?.horizon)) return maximum;
  return Math.min(maximum, plan.horizon);
}

export function executableIntentPlan(plan, decisionAge, degraded = false) {
  if (!plan || degraded || !Number.isInteger(decisionAge) || decisionAge < 0 ||
      !Number.isInteger(plan.horizon) || decisionAge > plan.horizon) {
    return null;
  }
  return plan;
}

// The commander sees board-level affordances and exact rival IDs, but never
// legal action IDs or labels. Those remain private to the deterministic layer.
export function buildIntentSnapshot(state) {
  return {
    map: state?.mapFingerprint ?? null,
    phase: state?.phase ?? null,
    decisionNumber: state?.decisionNumber ?? 0,
    self: {
      tileShare: state?.self?.tileShare ?? 0,
      troopRatio: state?.self?.troopRatio ?? 0,
      incomingPressure: Array.isArray(state?.self?.allProtocolAttackerIDs)
        ? state.self.allProtocolAttackerIDs.length
        : 0,
    },
    rivals: (state?.rivals || []).map((rival) => ({
      id: rival.id,
      name: rival.name,
      tileShare: rival.tileShare,
      relativeTroopRatio: rival.relativeTroopRatio,
      sharesBorder: rival.sharesBorder,
      isAllied: rival.isAllied,
      canAttack: rival.canAttack,
    })),
    legalActionKinds: [...new Set((state?.legalActions || []).map((action) => action.kind))],
    recentKinds: state?.recentKinds || [],
  };
}
