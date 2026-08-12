import { clean } from "./strategy-engine.mjs";

export const MIN_INTENT_HORIZON = 2;
export const MAX_INTENT_HORIZON = 12;
export const INTENTS = Object.freeze(["expand", "consolidate", "convert"]);

const TARGETED_INTENTS = new Set(["convert"]);

const OUTCOME_DIRECTIVE_KEYS = Object.freeze(["intent"]);
const LEGACY_DIRECTIVE_KEYS = Object.freeze(["horizon", "intent", "targetID"]);

function exactKeys(value, expected) {
  return Object.keys(value).sort().join("\0") === expected.join("\0");
}

function usesOutcomeContract(allowedIntents) {
  return allowedIntents.includes("expand") || allowedIntents.includes("consolidate");
}

function eligibleTarget(state, targetID) {
  if (typeof targetID !== "string" || clean(targetID) !== targetID || targetID.length === 0) {
    return false;
  }
  return state?.rivals?.some((rival) => clean(rival.id) === targetID) === true;
}

// Accept only a small mission-command packet. Unknown keys, coerced numbers,
// target names, and tactical instructions are rejected instead of repaired.
export function normalizeIntentDirective(
  value,
  state,
  model = "unknown",
  allowedIntents = INTENTS,
) {
  const outcomeContract = usesOutcomeContract(allowedIntents);
  const expectedKeys = outcomeContract ? OUTCOME_DIRECTIVE_KEYS : LEGACY_DIRECTIVE_KEYS;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, expectedKeys)) {
    return null;
  }
  if (typeof value.intent !== "string" || !allowedIntents.includes(value.intent)) return null;
  const intent = value.intent;
  if (!outcomeContract && (!Number.isInteger(value.horizon) ||
      value.horizon < MIN_INTENT_HORIZON ||
      value.horizon > MAX_INTENT_HORIZON)) {
    return null;
  }

  if (!outcomeContract) {
    if (!TARGETED_INTENTS.has(intent) && value.targetID !== null) return null;
    if (TARGETED_INTENTS.has(intent) &&
        (typeof value.targetID !== "string" || !eligibleTarget(state, value.targetID))) {
      return null;
    }
  }

  const directive = { intent, model: clean(model) || "unknown" };
  if (!outcomeContract) {
    directive.targetID = TARGETED_INTENTS.has(intent) ? value.targetID : null;
    directive.horizon = value.horizon;
  }
  return directive;
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
export function parseIntentDirective(
  text,
  state,
  model = "unknown",
  allowedIntents = INTENTS,
) {
  if (typeof text !== "string") return null;
  const payload = singleJsonObjectPayload(text);
  if (payload === null) return null;
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  return normalizeIntentDirective(value, state, model, allowedIntents);
}

export function intentRefreshInterval(plan, configuredMaximum = 8) {
  const maximum = Math.max(1, Math.trunc(Number(configuredMaximum)) || 8);
  if (!Number.isInteger(plan?.horizon)) return maximum;
  return Math.min(maximum, plan.horizon);
}

// Horizon schedules the next planner refresh. The last valid outcome stays in
// force until the planner replaces it; the executor never silently changes it.
export function executableIntentPlan(plan, allowedIntents = INTENTS) {
  const accepted = Array.isArray(allowedIntents) ? allowedIntents : INTENTS;
  const outcomeContract = usesOutcomeContract(accepted);
  const validShape = plan && accepted.includes(plan.intent) &&
    (outcomeContract
      ? !Object.hasOwn(plan, "targetID") && !Object.hasOwn(plan, "horizon")
      : (Number.isInteger(plan.horizon) &&
        plan.horizon >= MIN_INTENT_HORIZON && plan.horizon <= MAX_INTENT_HORIZON)) &&
    (outcomeContract || (!TARGETED_INTENTS.has(plan.intent)
      ? plan.targetID === null
      : typeof plan.targetID === "string" && plan.targetID.length > 0 &&
        clean(plan.targetID) === plan.targetID));
  if (!validShape) return null;
  return plan;
}

// The commander sees board-level affordances but never legal action IDs or
// labels. Intent-only planners also leave rival identity private to the
// deterministic executor.
export function buildIntentSnapshot(state, includeTargetIdentity = true) {
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
      ...(includeTargetIdentity ? { id: rival.id, name: rival.name } : {}),
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
