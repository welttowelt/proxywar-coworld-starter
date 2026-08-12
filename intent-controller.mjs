import { clean } from "./strategy-engine.mjs";

export const MIN_INTENT_HORIZON = 2;
export const MAX_INTENT_HORIZON = 12;
export const INTENTS = Object.freeze(["grow", "convert"]);

const DIRECTIVE_KEYS = Object.freeze(["horizon", "intent", "targetID"]);

function exactKeys(value) {
  return Object.keys(value).sort().join("\0") === DIRECTIVE_KEYS.join("\0");
}

function eligibleTarget(state, targetID) {
  if (typeof targetID !== "string" || clean(targetID) !== targetID || targetID.length === 0) {
    return false;
  }
  return state?.rivals?.some((rival) => clean(rival.id) === targetID) === true;
}

// Accept only a small mission-command packet. Unknown keys, coerced numbers,
// target names, and tactical instructions are rejected instead of repaired.
export function normalizeIntentDirective(value, state, model = "unknown") {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value)) {
    return null;
  }
  if (typeof value.intent !== "string" || !INTENTS.includes(value.intent)) return null;
  const intent = value.intent;
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
    targetID: intent === "convert" ? value.targetID : null,
    horizon: value.horizon,
    model: clean(model) || "unknown",
  };
}

// Recover exactly one complete top-level JSON object from provider framing.
// Multiple objects, stray braces, and truncation remain fail-closed.
function singleJsonObjectPayload(text) {
  let source = text.trim();
  const fence = source.match(/^```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/);
  if (fence) source = fence[1].trim();

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let found = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (depth > 0 && character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        if (found !== null) return null;
        start = index;
      }
      depth += 1;
    } else if (character === "}") {
      if (depth === 0) return null;
      depth -= 1;
      if (depth === 0) found = source.slice(start, index + 1);
    }
  }
  if (depth !== 0) return null;
  return found;
}

// The production planner response is a protocol packet, not prose. Strip only
// transport framing, then retain the exact semantic validation below.
export function parseIntentDirective(text, state, model = "unknown") {
  if (typeof text !== "string") return null;
  const payload = singleJsonObjectPayload(text);
  if (payload === null) return null;
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  return normalizeIntentDirective(value, state, model);
}

export function intentRefreshInterval(plan, configuredMaximum = 8) {
  const maximum = Math.max(1, Math.trunc(Number(configuredMaximum)) || 8);
  if (!Number.isInteger(plan?.horizon)) return maximum;
  return Math.min(maximum, plan.horizon);
}

export function executableIntentPlan(plan, decisionAge, degraded = false) {
  const validShape = plan && INTENTS.includes(plan.intent) &&
    Number.isInteger(plan.horizon) &&
    plan.horizon >= MIN_INTENT_HORIZON && plan.horizon <= MAX_INTENT_HORIZON &&
    (plan.intent === "grow"
      ? plan.targetID === null
      : typeof plan.targetID === "string" && plan.targetID.length > 0 &&
        clean(plan.targetID) === plan.targetID);
  if (!validShape || degraded || !Number.isInteger(decisionAge) || decisionAge < 0 ||
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
