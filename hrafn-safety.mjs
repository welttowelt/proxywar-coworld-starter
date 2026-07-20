import {
  coalitionMemberForRival,
  hasLeadingK1ZTag,
  hrafnActionTargetRawNames,
  isK1ZRival,
  isNeutralAction,
  isProtectedRival,
  resolveHrafnActionTarget,
} from "./hrafn-state.mjs";

export const HRAFN_HARMFUL_KINDS = new Set([
  "attack",
  "boat",
  "nuke",
  "target_player",
  "embargo",
  "embargo_all",
  "break_alliance",
  "alliance_reject",
]);

export const HRAFN_OMITTED_SOCIAL_KINDS = new Set([
  "target_player",
  "embargo",
  "embargo_all",
  "embargo_stop",
  "break_alliance",
  "alliance_reject",
  "quick_chat",
  "emoji",
]);

const DONATION_KINDS = new Set(["donate_troops", "donate_gold"]);

export function classifyHrafnActionSafety(action, state) {
  if (!action || typeof action !== "object") {
    return { safe: false, reason: "invalid-action", rival: null };
  }
  if (!String(action.id ?? "").trim() || !String(action.kind ?? "").trim()) {
    return { safe: false, reason: "missing-action-identity", rival: null };
  }

  if (isNeutralAction(action)) {
    return { safe: true, reason: "neutral-territory", rival: null };
  }

  if (
    HRAFN_HARMFUL_KINDS.has(action.kind) &&
    hrafnActionTargetRawNames(action).some(hasLeadingK1ZTag)
  ) {
    return { safe: false, reason: "k1z-protected", rival: null };
  }

  const resolution = resolveHrafnActionTarget(action, state);
  const rival = resolution.rival;

  if (DONATION_KINDS.has(action.kind)) {
    if (!rival) {
      return {
        safe: false,
        reason: resolution.ambiguous
          ? "ambiguous-donation-target"
          : "unresolved-donation-target",
        rival: null,
      };
    }
    const member = coalitionMemberForRival(rival);
    return member?.role === "king"
      ? { safe: true, reason: "odin-support", rival }
      : { safe: false, reason: "non-odin-donation", rival };
  }

  if (!HRAFN_HARMFUL_KINDS.has(action.kind)) {
    return { safe: true, reason: "non-harmful", rival };
  }

  if (action.kind === "embargo_all") {
    return { safe: false, reason: "indiscriminate-harm", rival: null };
  }
  if (resolution.ambiguous) {
    return { safe: false, reason: "ambiguous-harm-target", rival: null };
  }
  if (!rival) {
    return {
      safe: false,
      reason: resolution.signaled
        ? "unresolved-harm-target"
        : "missing-harm-target",
      rival: null,
    };
  }
  if (isProtectedRival(rival)) {
    return {
      safe: false,
      reason: isK1ZRival(rival)
        ? "k1z-protected"
        : "allied-protected",
      rival,
    };
  }
  return { safe: true, reason: "resolved-outsider", rival };
}

export function filterHrafnSafeActions(actions, state) {
  const safe = [];
  const rejected = [];
  for (const action of actions) {
    const classification = classifyHrafnActionSafety(action, state);
    if (classification.safe) {
      safe.push(action);
    } else {
      rejected.push({ action, ...classification });
    }
  }
  return { safe, rejected };
}

export function assertFreshHrafnAction(action, state) {
  const id = String(action?.id ?? "");
  if (!id || !state?.legalActionIDs?.has(id)) {
    throw new Error(`Hrafn selected a stale or unknown legal action: ${id || "<empty>"}`);
  }
  const safety = classifyHrafnActionSafety(action, state);
  if (!safety.safe) {
    throw new Error(
      `Hrafn selected an unsafe action ${id}: ${safety.reason}`,
    );
  }
  return action;
}

export function failClosedHrafnHold(actions, state) {
  const hold = actions.find((action) => action?.kind === "hold");
  if (!hold) {
    throw new Error("Hrafn fail-closed path had no legal hold");
  }
  return assertFreshHrafnAction(hold, state);
}
