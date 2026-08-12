import {
  executableIntentPlan,
  intentRefreshInterval,
  normalizeIntentDirective,
} from "./intent-controller.mjs";

const LEGACY_EVALUATION_INTENTS = Object.freeze(["grow", "convert"]);
import {
  clean,
  rivalIsProtected,
} from "./strategy-engine.mjs";

export const EVALUATION_SURROGATE_SOURCE = "static-eval-v1";
export const STATIC_INTENT_ARMS = Object.freeze([
  "m0",
  "grow-opening",
  "grow-low-share",
  "convert-weakest",
  "convert-largest",
]);

const STATIC_INTENT_ARM_SET = new Set(STATIC_INTENT_ARMS);
const STATIC_INTENT_HORIZON = 4;
const OPENING_DECISION_LIMIT = 20;
const LOW_SHARE_LIMIT = 0.12;
const MIN_CONVERSION_RATIO = 1.3;

const ARM_TOKENS = Object.freeze({
  m0: "m0",
  "grow-opening": "go1",
  "grow-low-share": "gl1",
  "convert-weakest": "cw1",
  "convert-largest": "cl1",
});

export function isStaticIntentArm(value) {
  return typeof value === "string" && STATIC_INTENT_ARM_SET.has(value);
}

export function staticIntentArmToken(arm) {
  return isStaticIntentArm(arm) ? ARM_TOKENS[arm] : null;
}

export function parseStaticIntentArm(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !isStaticIntentArm(argv[0])) {
    throw new Error(
      `evaluation-only static intent requires exactly one baked arm: ${STATIC_INTENT_ARMS.join(", ")}`,
    );
  }
  return argv[0];
}

// Evaluation packets pass through the exact production validator. Tagging is
// added only after successful validation, so malformed fixtures fail closed.
export function normalizeEvaluationDirective(value, state, arm) {
  if (!isStaticIntentArm(arm) || arm === "m0") return null;
  const normalized = normalizeIntentDirective(
    value,
    state,
    `${EVALUATION_SURROGATE_SOURCE}:${arm}`,
    LEGACY_EVALUATION_INTENTS,
  );
  if (!normalized) return null;
  return {
    ...normalized,
    surrogateSource: EVALUATION_SURROGATE_SOURCE,
    surrogateArm: arm,
  };
}

function isOpening(state, history) {
  const activeDecisions = Array.isArray(history)
    ? history.filter((entry) => entry?.kind !== "spawn").length
    : state?.decisionNumber;
  return Number.isInteger(activeDecisions) &&
    activeDecisions >= 0 &&
    activeDecisions < OPENING_DECISION_LIMIT;
}

function isLowShare(state) {
  return Number.isFinite(state?.self?.tileShare) && state.self.tileShare < LOW_SHARE_LIMIT;
}

function growDirective() {
  return { intent: "grow", targetID: null, horizon: STATIC_INTENT_HORIZON };
}

function eligibleConversionTargets(state, history) {
  // Conversion arms require a mixed roster with at least one visible outsider.
  // An all-K1Z roster deliberately produces no directive and cannot measure
  // either conversion ranking.
  if (!Number.isFinite(state?.self?.tileShare) || state.self.tileShare < LOW_SHARE_LIMIT) {
    return [];
  }
  return (state?.rivals || []).filter((rival) => {
    const id = clean(rival?.id);
    return id.length > 0 &&
      rival?.canAttack === true &&
      Number.isFinite(rival?.relativeTroopRatio) &&
      rival.relativeTroopRatio >= MIN_CONVERSION_RATIO &&
      !rivalIsProtected(state, history, rival);
  });
}

function stableID(left, right) {
  const leftID = clean(left?.id);
  const rightID = clean(right?.id);
  return leftID < rightID ? -1 : leftID > rightID ? 1 : 0;
}

function conversionDirective(arm, state, history) {
  const candidates = eligibleConversionTargets(state, history);
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(arm === "convert-weakest"
    ? (left, right) =>
        right.relativeTroopRatio - left.relativeTroopRatio ||
        left.tileShare - right.tileShare ||
        stableID(left, right)
    : (left, right) =>
        right.tileShare - left.tileShare ||
        right.relativeTroopRatio - left.relativeTroopRatio ||
        stableID(left, right));
  return {
    intent: "convert",
    targetID: clean(ranked[0].id),
    horizon: STATIC_INTENT_HORIZON,
  };
}

// Every arm is a deterministic state schedule. No legal action ID, action
// label, model response, credential, clock, randomness, or runtime environment
// variable participates in directive generation.
export function staticIntentPlan(arm, state, history = []) {
  if (!isStaticIntentArm(arm) || arm === "m0") return null;

  let directive = null;
  if (arm === "grow-opening" && isOpening(state, history)) {
    directive = growDirective();
  } else if (arm === "grow-low-share" && isLowShare(state)) {
    directive = growDirective();
  } else if (arm === "convert-weakest" || arm === "convert-largest") {
    directive = conversionDirective(arm, state, history);
  }

  return directive ? normalizeEvaluationDirective(directive, state, arm) : null;
}

// Static plans use a real four-decision horizon instead of retargeting on every
// request. A null schedule is reevaluated next decision so a predicate may
// become eligible later in the same episode.
export function createStaticIntentScheduler(value) {
  const arm = parseStaticIntentArm([value]);
  let currentPlan = null;
  let decisionsOnPlan = 0;
  let initialized = false;

  return Object.freeze({
    next(state, history = []) {
      if (arm === "m0") {
        return { plan: null, planAge: null, refreshed: false };
      }

      let refreshed = false;
      if (!initialized || currentPlan === null ||
          decisionsOnPlan >= intentRefreshInterval(currentPlan, STATIC_INTENT_HORIZON)) {
        currentPlan = staticIntentPlan(arm, state, history);
        decisionsOnPlan = 0;
        initialized = true;
        refreshed = true;
      }

      const planAge = currentPlan === null ? null : decisionsOnPlan;
      const plan = executableIntentPlan(currentPlan, LEGACY_EVALUATION_INTENTS);
      if (plan !== null) decisionsOnPlan += 1;
      return { plan, planAge, refreshed };
    },
  });
}
