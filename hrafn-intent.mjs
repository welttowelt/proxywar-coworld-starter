import { createHash } from "node:crypto";

import {
  chooseHrafnAction,
} from "./hrafn-strategy.mjs";
import {
  buildHrafnChassisState,
  buildUnit,
  isNeutralAction,
  isProtectedRival,
  resolveHrafnActionTarget,
} from "./hrafn-state.mjs";
import { filterHrafnSafeActions } from "./hrafn-safety.mjs";

export const HRAFN_INTENT_SCHEMA_VERSION = "hi1";
export const HRAFN_INTENT_MARKER = "hi1";
export const HRAFN_OLLAMA_MODEL = "llama3:latest";
export const HRAFN_EXPECTED_OLLAMA_MODEL_DIGEST =
  "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1";

const INTENT_KEYS = Object.freeze(["horizon", "objective", "targetID"]);
const INTENT_OBJECTIVES = new Set(["grow", "convert"]);
const HARD_POLICY_MARKERS = new Set(["k1z", "dn1", "sk1"]);
const GROW_BUILD_UNITS = new Set(["city", "factory", "port"]);
const CONVERT_KINDS = new Set(["attack", "target_player"]);
const OMITTED_PUBLIC_TEXT_KINDS = new Set(["quick_chat", "emoji"]);
const RESERVED_ACTION_FIELDS = Object.freeze([
  "campaignStartDecision",
  "intentMarker",
  "policyMarker",
  "requestMarker",
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

// k1z-json-v1: recursively sort object keys with ECMAScript default UTF-16
// ordering; preserve array order; serialize with JSON.stringify semantics.
export function canonicalHrafnIntentJSON(value) {
  const serialized = JSON.stringify(canonicalValue(value));
  if (typeof serialized !== "string") {
    throw new Error("HI1 canonical JSON requires a serializable root value");
  }
  return serialized;
}

export function hrafnIntentRequestPayloadSHA256(request) {
  return createHash("sha256")
    .update(canonicalHrafnIntentJSON(request))
    .digest("hex");
}

export const HRAFN_OLLAMA_INTENT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["objective", "targetID", "horizon"],
  properties: {
    objective: { type: "string", enum: ["grow", "convert"] },
    targetID: { type: ["string", "null"] },
    horizon: { type: "integer", minimum: 2, maximum: 12 },
  },
});

function plainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function exactKeys(value) {
  return Object.keys(value).sort().join("\0") === INTENT_KEYS.join("\0");
}

function sanitizeWireAction(action) {
  if (!plainObject(action)) return action;
  const sanitized = { ...action };
  for (const field of RESERVED_ACTION_FIELDS) delete sanitized[field];
  return sanitized;
}

function validateLegalActionIDs(actions) {
  const ids = new Set();
  for (const action of actions) {
    if (
      typeof action?.id !== "string" ||
      action.id.length === 0 ||
      action.id.trim() !== action.id
    ) {
      throw new Error("HI1 legal action ID must be an exact non-empty string");
    }
    if (ids.has(action.id)) {
      throw new Error(`HI1 duplicate legal action ID: ${action.id}`);
    }
    ids.add(action.id);
  }
}

function prepareIntentActions(actions, observation) {
  if (!Array.isArray(actions)) {
    throw new Error("HI1 decision request had no legal action list");
  }
  validateLegalActionIDs(actions);
  const sanitized = actions.map(sanitizeWireAction);
  const state = buildHrafnChassisState(observation, sanitized);
  const safety = filterHrafnSafeActions(sanitized, state);
  const usable = safety.safe.filter((action) =>
    !OMITTED_PUBLIC_TEXT_KINDS.has(action?.kind)
  );
  return {
    actions: usable,
    state,
    safetyRejectedCount: safety.rejected.length,
    wrapperOmittedCount: safety.safe.length - usable.length,
  };
}

function decisionResult(prepared, result) {
  return {
    ...result,
    safetyRejectedCount: prepared.safetyRejectedCount,
    wrapperOmittedCount: prepared.wrapperOmittedCount,
  };
}

export function normalizeHrafnIntent(value) {
  if (!plainObject(value) || !exactKeys(value)) return null;
  if (!INTENT_OBJECTIVES.has(value.objective)) return null;
  if (
    !Number.isSafeInteger(value.horizon) ||
    value.horizon < 2 ||
    value.horizon > 12
  ) {
    return null;
  }
  if (value.objective === "grow" && value.targetID !== null) return null;
  if (
    value.objective === "convert" &&
    (typeof value.targetID !== "string" ||
      value.targetID.length === 0 ||
      value.targetID.trim() !== value.targetID)
  ) {
    return null;
  }
  return {
    objective: value.objective,
    targetID: value.targetID,
    horizon: value.horizon,
  };
}

function exactV5Action(actions, observation, history, rv1Enabled) {
  return chooseHrafnAction(actions, observation, history, {
    exactV5: true,
    rv1Enabled,
  });
}

function severePressure(state) {
  const incomingCount = state.incomingCount;
  return incomingCount >= 2 ||
    (incomingCount > 0 && state.own.troopRatio < 0.75);
}

function hardIntentGuard(baseline, state) {
  return baseline?.kind === "spawn" ||
    HARD_POLICY_MARKERS.has(baseline?.policyMarker) ||
    severePressure(state);
}

function exactTarget(state, targetID) {
  const matches = state.rivals.filter((rival) => rival.id === targetID);
  return matches.length === 1 ? matches[0] : null;
}

function isGrowAction(action) {
  if (action.kind === "attack" || action.kind === "boat") {
    return isNeutralAction(action);
  }
  return action?.kind === "build" && GROW_BUILD_UNITS.has(buildUnit(action));
}

function intentSubset(actions, state, intent) {
  const hold = actions.find((action) => action?.kind === "hold");
  if (!hold) return null;
  if (intent.objective === "grow") {
    return actions.filter((action) => action === hold || isGrowAction(action));
  }

  const target = exactTarget(state, intent.targetID);
  if (!target || isProtectedRival(target)) return null;
  return actions.filter((action) => {
    if (action === hold) return true;
    if (!CONVERT_KINDS.has(action?.kind)) return false;
    return resolveHrafnActionTarget(action, state).rival?.id === target.id;
  });
}

function intentCandidate({
  actions,
  observation,
  history,
  state,
  intent,
  rv1Enabled,
}) {
  const subset = intentSubset(actions, state, intent);
  if (!subset || subset.length < 2) return null;
  const candidate = exactV5Action(subset, observation, history, rv1Enabled);
  if (!actions.some((action) => action?.id === candidate?.id)) return null;
  if (candidate?.kind === "hold") return null;

  if (intent.objective === "grow") {
    return isGrowAction(candidate) ? candidate : null;
  }
  if (!CONVERT_KINDS.has(candidate?.kind)) return null;
  return resolveHrafnActionTarget(candidate, state).rival?.id === intent.targetID
    ? candidate
    : null;
}

export function chooseHrafnIntentDecision({
  actions,
  observation,
  history = [],
  intent = null,
  rv1Enabled = true,
} = {}) {
  const prepared = prepareIntentActions(actions, observation);
  const { state } = prepared;
  if (prepared.actions.length === 0) {
    throw new Error("HI1 decision request contained no safe action");
  }
  const baseline = exactV5Action(
    prepared.actions,
    observation,
    history,
    rv1Enabled,
  );
  const normalized = normalizeHrafnIntent(intent);
  if (!normalized) {
    return decisionResult(prepared, {
      baseline,
      action: baseline,
      intent: null,
      intentValid: false,
      intentApplied: false,
      actionDelta: false,
      reason: "intent_missing_or_invalid",
    });
  }
  if (hardIntentGuard(baseline, state)) {
    return decisionResult(prepared, {
      baseline,
      action: baseline,
      intent: normalized,
      intentValid: true,
      intentApplied: false,
      actionDelta: false,
      reason: "intent_hard_guard",
    });
  }

  const candidate = intentCandidate({
    actions: prepared.actions,
    observation,
    history,
    state,
    intent: normalized,
    rv1Enabled,
  });
  if (!candidate) {
    return decisionResult(prepared, {
      baseline,
      action: baseline,
      intent: normalized,
      intentValid: false,
      intentApplied: false,
      actionDelta: false,
      reason: "intent_unreachable",
    });
  }

  const actionDelta = candidate.id !== baseline.id;
  if (!actionDelta) {
    return decisionResult(prepared, {
      baseline,
      action: baseline,
      intent: normalized,
      intentValid: true,
      intentApplied: false,
      actionDelta: false,
      reason: "intent_same_as_baseline",
    });
  }
  return decisionResult(prepared, {
    baseline,
    action: { ...candidate, intentMarker: HRAFN_INTENT_MARKER },
    intent: normalized,
    intentValid: true,
    intentApplied: true,
    actionDelta: true,
    reason: "intent_applied",
  });
}

export function buildHrafnIntentSnapshot({
  actions,
  observation,
  history = [],
  rv1Enabled = true,
} = {}) {
  const prepared = prepareIntentActions(actions, observation);
  const { state } = prepared;
  if (prepared.actions.length === 0) {
    return {
      schemaVersion: HRAFN_INTENT_SCHEMA_VERSION,
      decisionCount: history.length,
      own: {
        tileShare: finiteOrNull(state.own.tileShare),
        troopRatio: finiteOrNull(state.own.troopRatio),
        incomingAttackerCount: state.incomingCount,
      },
      growPossible: false,
      convertTargets: [],
      hardGuard: true,
    };
  }
  const baseline = exactV5Action(
    prepared.actions,
    observation,
    history,
    rv1Enabled,
  );
  if (hardIntentGuard(baseline, state)) {
    return {
      schemaVersion: HRAFN_INTENT_SCHEMA_VERSION,
      decisionCount: history.length,
      own: {
        tileShare: finiteOrNull(state.own.tileShare),
        troopRatio: finiteOrNull(state.own.troopRatio),
        incomingAttackerCount: state.incomingCount,
      },
      growPossible: false,
      convertTargets: [],
      hardGuard: true,
    };
  }

  const growIntent = { objective: "grow", targetID: null, horizon: 6 };
  const growPossible = intentCandidate({
    actions: prepared.actions,
    observation,
    history,
    state,
    intent: growIntent,
    rv1Enabled,
  }) !== null;
  const convertTargets = state.rivals
    .filter((candidate) => candidate.id && !isProtectedRival(candidate))
    .filter((candidate) => intentCandidate({
      actions: prepared.actions,
      observation,
      history,
      state,
      intent: {
        objective: "convert",
        targetID: candidate.id,
        horizon: 6,
      },
      rv1Enabled,
    }) !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((candidate) => ({
      targetID: candidate.id,
      tileShare: finiteOrNull(candidate.tileShare),
      relativeTroopRatio: finiteOrNull(candidate.relativeTroopRatio),
      sharesBorder: candidate.sharesBorder === true,
      canAttack: candidate.canAttack === true,
    }));
  return {
    schemaVersion: HRAFN_INTENT_SCHEMA_VERSION,
    decisionCount: history.length,
    own: {
      tileShare: finiteOrNull(state.own.tileShare),
      troopRatio: finiteOrNull(state.own.troopRatio),
      incomingAttackerCount: state.incomingCount,
    },
    growPossible,
    convertTargets,
    hardGuard: false,
  };
}

export function hrafnIntentAvailable(snapshot) {
  return snapshot?.growPossible === true ||
    (Array.isArray(snapshot?.convertTargets) &&
      snapshot.convertTargets.length > 0);
}

export function buildHrafnIntentPrompt(snapshot) {
  return [
    "You set one short strategic intent for K1Z Hrafn.",
    "Return exactly one root JSON object matching the supplied schema.",
    "Choose grow only when growPossible is true; grow requires targetID null.",
    "Choose convert only when convertTargets is nonempty; targetID must exactly match one listed targetID.",
    "troopRatio is Hrafn troops divided by Hrafn capacity; higher means less spare capacity.",
    "relativeTroopRatio is Hrafn troops divided by target troops; higher is safer for conversion.",
    "Use horizon 2 through 12. Prefer durable progress without stalling.",
    `State: ${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function plannerError(error) {
  if (error instanceof Error && error.name === "AbortError") {
    return "planner timeout";
  }
  return error instanceof Error ? error.message : String(error);
}

export function createOllamaHrafnIntentPlanner({
  endpoint = "http://host.docker.internal:11434/api/generate",
  model = HRAFN_OLLAMA_MODEL,
  timeoutMs = 4000,
  seed = 240721,
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("HI1 planner requires fetch");
  }
  if (model !== HRAFN_OLLAMA_MODEL) {
    throw new Error(`HI1 planner model must be ${HRAFN_OLLAMA_MODEL}`);
  }
  return Object.freeze({
    endpoint,
    model,
    async plan(snapshot) {
      const started = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let returnedModel = null;
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: false,
            keep_alive: "30m",
            format: HRAFN_OLLAMA_INTENT_SCHEMA,
            options: {
              temperature: 0,
              seed,
              num_predict: 64,
            },
            prompt: buildHrafnIntentPrompt(snapshot),
          }),
        });
        if (!response?.ok) {
          throw new Error(`planner HTTP ${response?.status ?? "unknown"}`);
        }
        const body = await response.json();
        returnedModel = typeof body?.model === "string" ? body.model : null;
        if (returnedModel === null || returnedModel.length === 0) {
          throw new Error("planner response missing returned model");
        }
        if (returnedModel !== HRAFN_OLLAMA_MODEL) {
          throw new Error(
            `planner returned model mismatch: expected ${HRAFN_OLLAMA_MODEL}, got ${returnedModel}`,
          );
        }
        let parsed;
        try {
          parsed = JSON.parse(String(body?.response ?? ""));
        } catch (error) {
          throw new Error(
            `invalid planner JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const intent = normalizeHrafnIntent(parsed);
        if (!intent) throw new Error("invalid planner intent schema");
        return {
          ok: true,
          intent,
          model: returnedModel,
          latencyMs: Math.max(0, now() - started),
          error: null,
        };
      } catch (error) {
        return {
          ok: false,
          intent: null,
          model: returnedModel,
          latencyMs: Math.max(0, now() - started),
          error: plannerError(error),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
