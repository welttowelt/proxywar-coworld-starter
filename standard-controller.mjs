import {
  enforceSafety as defaultEnforceSafety,
  resolveCoalitionIdentity,
} from "./controller-safety.mjs";

const CACHE_LIMIT = 512;
const HISTORY_LIMIT = 64;
const OPENING_DECISIONS = 20;
const DESIRED_NEUTRAL_PERCENT = 35;
const MIN_CREDIBLE_COUNTER_RATIO = 1.3;

const EXCLUDED_KINDS = new Set([
  "nuke",
  "warship",
  "move_warship",
  "embargo",
  "embargo_all",
  "embargo_stop",
  "target_player",
  "donate_gold",
  "donate_troops",
  "quick_chat",
  "emoji",
]);

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\[k1z\]|k1z)(?:\s+|$)/i, "")
    .toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function actionKey(action) {
  return `${String(action?.id ?? "")}\u0000${stableValue({
    kind: action?.kind,
    type: action?.type,
    label: action?.label,
    targetID: action?.targetID ?? action?.targetId ?? action?.target_id,
    targetName: action?.targetName ?? action?.target_name,
    recipientID: action?.recipientID ?? action?.recipientId ?? action?.recipient_id,
    recipientName: action?.recipientName ?? action?.recipient_name,
    expansion: action?.expansion,
    troopPercent: action?.troopPercent ?? action?.percent ?? action?.percentage,
    metadata: action?.metadata,
    risk: action?.risk,
  })}`;
}

function compareKey(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requestFingerprint(actions, observation) {
  return `${actions.map(actionKey).sort().join("\u0001")}\u0002${stableValue(
    observation ?? {},
  )}`;
}

function actionText(action) {
  return `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
}

function actionPercent(action) {
  const metadataPercent = Number(action?.metadata?.troopPercent);
  if (Number.isFinite(metadataPercent)) return metadataPercent;
  const match = String(action?.id ?? "").match(/:(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

function isNeutral(action) {
  const text = actionText(action);
  return action?.metadata?.expansion === true ||
    text.includes("terra nullius") || text.includes("neutral land");
}

function isAtomBomb(action) {
  return String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb" ||
    actionText(action).includes("atom bomb");
}

function targetOf(action) {
  return {
    id: String(action?.metadata?.targetID ?? action?.metadata?.recipientID ?? "")
      .trim().toLowerCase(),
    name: canonicalName(
      action?.metadata?.targetName ?? action?.metadata?.recipientName ?? "",
    ),
  };
}

function playerID(player) {
  return String(
    player?.id ?? player?.playerID ?? player?.playerId ?? player?.player_id ?? "",
  ).trim().toLowerCase();
}

function isK1ZTarget(action, observation = {}) {
  const identity = resolveCoalitionIdentity(
    targetOf(action),
    observation?.visiblePlayers ?? [],
  );
  return identity.resolved && !identity.conflict && identity.member !== null;
}

function targetMatches(action, target) {
  if (!target) return false;
  const candidate = targetOf(action);
  return sameTarget(candidate, target);
}

function sameTarget(left, right) {
  if (!left || !right) return false;
  return Boolean(
    (right.id && left.id === right.id) ||
    (right.name && left.name === right.name),
  );
}

function visibleRival(action, observation) {
  const target = targetOf(action);
  const text = actionText(action);
  return (observation?.visiblePlayers ?? []).find((player) => {
    if (!player || player.isAlive === false) return false;
    const id = playerID(player);
    const name = canonicalName(player.name);
    return (target.id && id === target.id) ||
      (target.name && name === target.name) ||
      (id && text.includes(id)) ||
      (name.length >= 3 && text.includes(name));
  }) ?? null;
}

function incomingIDs(observation) {
  const ids = new Set(
    (observation?.combat?.incomingAttackPlayerIDs ?? [])
      .map((id) => String(id).toLowerCase()),
  );
  const incoming = observation?.ownState?.incomingAttacks;
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const id = value.attackerID ?? value.attackerId ?? value.sourcePlayerID ??
      value.sourcePlayerId;
    if (id) ids.add(String(id).toLowerCase());
  };
  visit(incoming);
  for (const player of observation?.visiblePlayers ?? []) {
    if (player?.incomingAttack === true) ids.add(playerID(player));
  }
  return ids;
}

function pressureCount(observation) {
  const incoming = observation?.ownState?.incomingAttacks;
  const explicit = typeof incoming === "number" ? incoming : 0;
  return Math.max(explicit, incomingIDs(observation).size);
}

function troopCapFill(observation) {
  const own = observation?.ownState ?? {};
  for (const value of [own.troopCapFill, own.troopCapacityRatio, own.capacityFill]) {
    const ratio = Number(value);
    if (Number.isFinite(ratio)) return ratio > 1 ? ratio / 100 : ratio;
  }
  const troops = Number(own.troops);
  const maximum = Number(own.maxTroops ?? own.troopCapacity);
  return Number.isFinite(troops) && Number.isFinite(maximum) && maximum > 0
    ? troops / maximum
    : 0;
}

function unitName(action) {
  const metadata = canonicalName(action?.metadata?.unit);
  if (metadata) return metadata;
  const text = actionText(action);
  return ["defense post", "city", "factory", "port"]
    .find((unit) => text.includes(unit)) ?? "other";
}

function isPendingHandshake(action, actions, observation) {
  if (action?.kind !== "alliance_request" || !isK1ZTarget(action, observation)) return false;
  const metadata = action.metadata ?? {};
  if (
    metadata.pending === true || metadata.incomingRequest === true ||
    metadata.reverseHandshake === true || metadata.requestPending === true ||
    metadata.canAccept === true
  ) return true;
  return actions.some((candidate) =>
    candidate?.kind === "alliance_reject" && targetMatches(candidate, targetOf(action))
  );
}

function selectHold(actions) {
  return [...actions]
    .filter((action) => action?.kind === "hold")
    .sort((left, right) => compareKey(actionKey(left), actionKey(right)))[0] ?? null;
}

function makeState() {
  return {
    activeDecisionCount: 0,
    conquestCount: 0,
    earlyHandshakeCount: 0,
    buildCount: 0,
    lastBuildDecision: -1_000_000,
    lastCoalitionDecision: -1_000_000,
    lastTileShare: null,
    neutralStall: 0,
    stickyTarget: null,
    stickyTargetStreak: 0,
    lastActionKind: null,
    lastActionID: null,
    lastRoute: null,
    builtUnits: new Set(),
    history: [],
    cache: new Map(),
    cacheOrder: [],
  };
}

function snapshot(state) {
  return {
    activeDecisionCount: state.activeDecisionCount,
    conquestCount: state.conquestCount,
    earlyHandshakeCount: state.earlyHandshakeCount,
    buildCount: state.buildCount,
    lastBuildDecision: state.lastBuildDecision,
    lastCoalitionDecision: state.lastCoalitionDecision,
    neutralStall: state.neutralStall,
    stickyTarget: state.stickyTarget ? { ...state.stickyTarget } : null,
    stickyTargetStreak: state.stickyTargetStreak,
    lastActionKind: state.lastActionKind,
    lastActionID: state.lastActionID,
    lastRoute: state.lastRoute,
    builtUnits: [...state.builtUnits].sort(),
    historySize: state.history.length,
    cacheSize: state.cache.size,
  };
}

function noteObservedOutcome(state, observation) {
  const currentShare = Number(observation?.ownState?.tileShare);
  if (!Number.isFinite(currentShare)) return;
  if (state.lastTileShare !== null && ["attack", "boat"].includes(state.lastActionKind)) {
    if (currentShare <= state.lastTileShare + 0.0005) state.neutralStall += 1;
    else state.neutralStall = 0;
  }
}

function rankActions(actions, observation, state) {
  const opening = state.activeDecisionCount < OPENING_DECISIONS;
  const incoming = incomingIDs(observation);
  const threats = pressureCount(observation);
  const capFill = troopCapFill(observation);
  const hasNeutralLand = actions.some((action) =>
    String(action?.kind ?? "").toLowerCase() === "attack" && isNeutral(action)
  );
  const buildDue = state.conquestCount >= 5 && (
    state.buildCount === 0 || state.activeDecisionCount - state.lastBuildDecision >= 14
  );
  const escapeReady = !opening && (state.neutralStall >= 3 || capFill >= 0.9);

  const descriptors = actions.map((action) => {
    const kind = String(action?.kind ?? "");
    const percent = actionPercent(action);
    const rival = visibleRival(action, observation);
    const metadataTarget = targetOf(action);
    const ratio = finite(rival?.relativeTroopRatio, NaN);
    const targetShare = finite(rival?.tileShare);
    const neutral = isNeutral(action);
    const target = {
      id: metadataTarget.id || playerID(rival),
      name: metadataTarget.name || canonicalName(rival?.name),
    };
    const sticky = sameTarget(target, state.stickyTarget);
    const counter = action?.metadata?.incomingAttack === true ||
      (target.id && incoming.has(target.id)) || rival?.incomingAttack === true;
    let score = -5000;
    let route = "excluded";

    if (kind === "spawn") {
      score = 10000;
      route = "spawn";
    } else if (
      isPendingHandshake(action, actions, observation) &&
      (!opening || state.earlyHandshakeCount === 0)
    ) {
      score = 9500;
      route = "reverse_handshake";
    } else if (
      threats > 0 && kind === "attack" && !neutral && counter &&
      Number.isFinite(ratio) && ratio >= MIN_CREDIBLE_COUNTER_RATIO
    ) {
      score = 9300 + (Number.isFinite(ratio) ? Math.min(ratio, 4) * 10 : 0) -
        Math.abs((percent ?? 25) - (Number.isFinite(ratio) && ratio >= 1.5 ? 40 : 25));
      route = "pressure_counter";
    } else if (
      threats > 0 && kind === "build" && unitName(action) === "defense post"
    ) {
      score = 9200;
      route = "pressure_defense";
    } else if (threats > 0 && ["retreat", "boat_retreat"].includes(kind)) {
      score = 9100;
      route = "pressure_retreat";
    } else if (
      opening && buildDue && state.buildCount === 0 && kind === "build" &&
      !isAtomBomb(action) && unitName(action) !== "defense post"
    ) {
      const preference = { city: 3, factory: 2, port: 1 }[unitName(action)] ?? 0;
      score = 8950 + preference;
      route = "opening_build";
    } else if (kind === "attack" && neutral) {
      score = (opening ? 8900 : state.stickyTarget ? 8400 : 8700) -
        Math.abs((percent ?? 0) - DESIRED_NEUTRAL_PERCENT);
      route = opening ? "opening_grind" : "neutral_grind";
    } else if (
      kind === "attack" && !neutral && sticky &&
      (!Number.isFinite(ratio) || ratio >= 1)
    ) {
      const desired = state.stickyTargetStreak >= 1 ? 40 : 25;
      score = (opening ? 8600 : 9000) + Math.min(targetShare, 0.5) * 100 -
        Math.abs((percent ?? desired) - desired);
      route = "finish";
    } else if (
      kind === "attack" && !neutral &&
      (!Number.isFinite(ratio) || ratio >= 1)
    ) {
      const efficiency = Number.isFinite(ratio) ? Math.min(ratio, 4) * 20 : 0;
      const weakBonus = Math.max(0, 0.15 - targetShare) * 200;
      score = (opening ? 8500 : 8800) + efficiency + weakBonus -
        Math.abs((percent ?? 25) - 25);
      route = "convert";
    } else if (
      !opening && buildDue && kind === "build" && !isAtomBomb(action) &&
      unitName(action) !== "defense post"
    ) {
      const missingBonus = state.builtUnits.has(unitName(action)) ? 0 : 5;
      const preference = { city: 3, factory: 2, port: 1 }[unitName(action)] ?? 0;
      score = 8300 + missingBonus + preference;
      route = "economy";
    } else if (opening && !hasNeutralLand && kind === "boat" && neutral) {
      score = 8700 - Math.abs((percent ?? 16) - 16);
      route = "opening_boat";
    } else if (kind === "boat" && escapeReady) {
      const invasionBonus = neutral ? 0 : 10;
      score = 8100 + invasionBonus - Math.abs((percent ?? 25) - (neutral ? 16 : 25));
      route = "naval_escape";
    } else if (
      ["alliance_request", "alliance_extend"].includes(kind) &&
      isK1ZTarget(action, observation)
    ) {
      score = state.activeDecisionCount - state.lastCoalitionDecision >= 8 ? 7000 : 500;
      route = "coalition_idle";
    } else if (kind === "upgrade_structure") {
      score = state.lastActionKind === "upgrade_structure" ? 400 : 6500;
      route = "upgrade_idle";
    } else if (
      kind === "build" && !isAtomBomb(action) && unitName(action) !== "defense post"
    ) {
      score = 6400;
      route = "build_idle";
    } else if (["retreat", "boat_retreat"].includes(kind)) {
      score = 6000;
      route = "retreat";
    } else if (kind === "hold") {
      score = 100;
      route = "hold";
    }

    if (EXCLUDED_KINDS.has(kind) || isAtomBomb(action)) {
      score = -1000;
      route = "excluded";
    }
    if (action?.risk?.level === "high") score -= 25;
    return { action, score, route, key: actionKey(action) };
  });

  return descriptors.sort((left, right) =>
    right.score - left.score || compareKey(left.key, right.key)
  );
}

function remember(state, result, observation) {
  const action = result.action;
  const kind = String(action?.kind ?? "");
  const tileShare = Number(observation?.ownState?.tileShare);
  if (kind !== "spawn") state.activeDecisionCount += 1;
  if (kind === "attack" || (kind === "boat" && isNeutral(action))) {
    state.conquestCount += 1;
  }
  if (result.route === "reverse_handshake") state.earlyHandshakeCount += 1;
  if (["alliance_request", "alliance_extend"].includes(kind)) {
    state.lastCoalitionDecision = state.activeDecisionCount;
  }
  if (kind === "build") {
    state.buildCount += 1;
    state.lastBuildDecision = state.activeDecisionCount;
    state.builtUnits.add(unitName(action));
  }

  if (kind === "attack" && !isNeutral(action)) {
    const metadataTarget = targetOf(action);
    const rival = visibleRival(action, observation);
    const target = {
      id: metadataTarget.id || playerID(rival),
      name: metadataTarget.name || canonicalName(rival?.name),
    };
    if (target.id || target.name) {
      if (sameTarget(target, state.stickyTarget)) state.stickyTargetStreak += 1;
      else state.stickyTargetStreak = 1;
      state.stickyTarget = target;
    }
  } else if (kind === "spawn") {
    state.stickyTarget = null;
    state.stickyTargetStreak = 0;
  }

  state.lastActionKind = kind;
  state.lastActionID = String(action?.id ?? "");
  state.lastRoute = result.route;
  if (Number.isFinite(tileShare)) state.lastTileShare = tileShare;
  state.history.push({
    decision: state.activeDecisionCount,
    actionID: state.lastActionID,
    kind,
    route: result.route,
    tileShare: Number.isFinite(tileShare) ? tileShare : null,
  });
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
}

function cacheDecision(state, requestID, fingerprint, result) {
  if (state.cache.has(requestID)) return;
  state.cache.set(requestID, { fingerprint, result });
  state.cacheOrder.push(requestID);
  while (state.cacheOrder.length > CACHE_LIMIT) {
    const oldest = state.cacheOrder.shift();
    state.cache.delete(oldest);
  }
}

function mismatchResult(actions) {
  const hold = selectHold(actions);
  if (!hold) throw new Error("request ID changed its semantics without a hold");
  return {
    action: hold,
    selectedLegalActionId: String(hold.id),
    route: "cache_mismatch",
    markers: ["std1", "cache_mismatch"],
    reason: "std1:cache_mismatch",
    confidence: 0,
    safety: {
      mode: "fallback",
      fallbackUsed: true,
      rerouted: true,
      reason: "request ID reused with different action or observation semantics",
    },
  };
}

export function createStandardController(options = {}) {
  const enforceSafety = typeof options.enforceSafety === "function"
    ? options.enforceSafety
    : defaultEnforceSafety;
  let state = makeState();

  return {
    decide({ requestID, observation = {}, legalActions }) {
      if (!Array.isArray(legalActions) || legalActions.length === 0) {
        throw new Error("decision request had no legal actions");
      }
      const id = String(requestID ?? "");
      const fingerprint = requestFingerprint(legalActions, observation);
      const cached = state.cache.get(id);
      if (cached) {
        return cached.fingerprint === fingerprint
          ? cached.result
          : mismatchResult(legalActions);
      }

      noteObservedOutcome(state, observation);
      const descriptors = rankActions(legalActions, observation, state);
      // Excluded doctrine actions stay in the total ordering for auditability,
      // but are not candidates for the safety gate to authorize.
      const ranked = descriptors
        .filter(({ route }) => route !== "excluded")
        .map(({ action }) => action);
      let safety;
      try {
        safety = enforceSafety({ ranked, legalActions, observation, state }) ?? {};
      } catch (error) {
        safety = {
          action: selectHold(legalActions),
          fallbackUsed: true,
          marker: "sv1",
          mode: "error",
          rerouted: true,
          reason: `safety error: ${error?.message ?? error}`,
        };
      }

      const selectedID = String(safety.action?.id ?? "");
      const offered = legalActions.find((action) => String(action?.id ?? "") === selectedID);
      const chosen = offered ?? selectHold(legalActions);
      if (!chosen) throw new Error("safety returned no offered action and no hold was offered");
      if (!offered) {
        safety = {
          ...safety,
          action: chosen,
          fallbackUsed: true,
          marker: "sv1",
          mode: "invalid_selection",
          rerouted: true,
          reason: "safety returned an action outside the offered set",
        };
      }

      const descriptor = descriptors.find(({ action }) => action === chosen) ??
        descriptors.find(({ action }) => String(action.id) === String(chosen.id));
      const route = descriptor?.route ?? "fallback";
      const markers = [...new Set(["std1", safety.marker].filter(Boolean))];
      const result = {
        action: chosen,
        selectedLegalActionId: String(chosen.id),
        route,
        markers,
        reason: `std1:${route}${safety.rerouted ? ":sv1" : ""}`,
        confidence: safety.fallbackUsed ? 0.2 : 0.99,
        safety: {
          mode: safety.mode ?? "normal",
          fallbackUsed: safety.fallbackUsed === true,
          rerouted: safety.rerouted === true,
          rejectedActionIDs: Array.isArray(safety.rejectedActionIDs)
            ? [...safety.rejectedActionIDs]
            : [],
          reason: String(safety.reason ?? ""),
        },
      };
      remember(state, result, observation);
      cacheDecision(state, id, fingerprint, result);
      return result;
    },

    reset() {
      state = makeState();
    },

    snapshot() {
      return snapshot(state);
    },
  };
}
