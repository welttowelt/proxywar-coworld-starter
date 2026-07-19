const SOCIAL_KINDS = new Set([
  "alliance_request", "alliance_extend", "break_alliance", "target_player",
  "embargo", "embargo_all", "embargo_stop", "donate_gold", "donate_troops",
  "quick_chat", "emoji",
]);

// Publicly declared reciprocal partner. Neutrality is conditional: any observed
// incoming attack revokes it, and late dominance still permits a clean finish.
//
// Canonical coalition identity, shared with katanasan v38 / santai-juryoku:v2:
// NFKC, hyphen/underscore/dot runs become spaces, whitespace collapses, one
// optional leading [K1Z]/K1Z tag is removed, then lowercase. The game itself
// also rewrites display names (e.g. "juryoku-koku" -> "juryoku koku"), so every
// name comparison routes through this canonical form.
function normalizedRivalName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\[k1z\]|k1z)(?:\s+|$)/i, "")
    .toLowerCase();
}

const RECIPROCAL_RIVALS = new Set(
  ["katanasan", "juryoku-koku", "hrafn"].map(normalizedRivalName),
);
const RECIPROCAL_RIVAL_IDS = new Set([
  "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
  "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
  "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
]);
const MIN_DESPERATE_INVASION_RATIO = 0.5;
const MIN_CONVERSION_TILE_SHARE = 0.002;
const MAP_SPAWN_TILES = new Map([
  ...[1180588, 1228670, 1216916, 1214746, 1224834, 892476, 1020678, 1450648]
    .map((tile) => [tile, "Asia"]),
  ...[1088580, 1216626, 877134, 659476, 494334, 628394, 994502, 1333674]
    .map((tile) => [tile, "World"]),
  ...[659528, 534350, 266554, 687420, 622372, 589302, 450306, 740346]
    .map((tile) => [tile, "Pangaea"]),
]);

export const PLAN_KINDS = [
  "spawn", "attack", "nuke", "build", "upgrade_structure", "boat", "boat_retreat", "retreat",
  "warship", "move_warship", "alliance_request", "alliance_extend", "break_alliance",
  "target_player", "embargo", "embargo_all", "embargo_stop", "donate_gold",
  "donate_troops", "quick_chat", "emoji", "hold",
];

export function clean(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function playerID(player) {
  return clean(
    player?.id ?? player?.playerID ?? player?.playerId ?? player?.player_id ?? "",
  );
}

function incomingAttackerIDs(value) {
  const ids = new Set();
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const direct = entry.attackerID ?? entry.attackerId ?? entry.sourcePlayerID ??
      entry.sourcePlayerId ?? entry.sourceID ?? entry.sourceId;
    if (direct !== undefined && direct !== null) ids.add(clean(direct).toLowerCase());
    if (direct === undefined) {
      for (const [key, nested] of Object.entries(entry)) {
        if (!["count", "total", "length", "amount"].includes(key.toLowerCase())) {
          if (nested && typeof nested === "object") visit(nested);
          else if (typeof nested === "number" || typeof nested === "boolean") {
            ids.add(clean(key).toLowerCase());
          }
        }
      }
    }
  };
  visit(value);
  return [...ids].filter(Boolean);
}

function currentProtocolAttackerIDs(value) {
  const structuredIDs = incomingAttackerIDs(value);
  const directIDs = (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === "string")
    .map((entry) => clean(entry).toLowerCase());
  return [...new Set([...structuredIDs, ...directIDs])].filter(Boolean);
}

export function actionText(action) {
  return `${action?.id ?? ""} ${action?.label ?? ""}`.toLowerCase();
}

export function actionPercent(action) {
  const metadataPercent = Number(action?.metadata?.troopPercent);
  if (Number.isFinite(metadataPercent)) return metadataPercent;
  const match = String(action?.id ?? "").match(/:(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

export function isNeutralExpansion(action) {
  const id = String(action?.id ?? "").toLowerCase();
  return action?.kind === "attack" && (
    action?.metadata?.expansion === true ||
    id.startsWith("expand:terra-nullius:") ||
    actionText(action).includes("terra nullius")
  );
}

export function inferMapFingerprint(observation, history = []) {
  const spawnTile = Number(observation?.ownState?.spawnTile);
  if (Number.isFinite(spawnTile) && MAP_SPAWN_TILES.has(spawnTile)) {
    return MAP_SPAWN_TILES.get(spawnTile);
  }
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]?.mapFingerprint) return history[index].mapFingerprint;
  }
  return null;
}

export function isNeutralBoat(action) {
  return action?.kind === "boat" && (
    action?.metadata?.expansion === true || actionText(action).includes("terra nullius")
  );
}

export function avoidActionIDs(history) {
  const recent = history.slice(-6).filter((entry) =>
    entry.kind !== "hold" && entry.kind !== "spawn"
  );
  let streakKind = null;
  let streak = 0;
  const streakIDs = [];
  for (let index = recent.length - 1; index >= 0; index--) {
    if (streakKind === null) streakKind = recent[index].kind;
    if (recent[index].kind !== streakKind) break;
    streak++;
    streakIDs.push(recent[index].actionID);
  }

  const counts = new Map();
  for (const entry of recent) {
    counts.set(entry.actionID, (counts.get(entry.actionID) || 0) + 1);
  }
  const exactRepeats = [...counts]
    .filter(([, count]) => count >= 2)
    .map(([id]) => id);
  return [...new Set([...(streak >= 2 ? streakIDs : []), ...exactRepeats])];
}

export function buildState(observation, actions, history = []) {
  const own = observation?.ownState || {};
  const mapFingerprint = inferMapFingerprint(observation, history);
  const visiblePlayers = (observation?.visiblePlayers || [])
    .filter((player) => player && player.isAlive);
  const baseIncomingAttackerIDs = incomingAttackerIDs(own.incomingAttacks);
  const currentProtocolIncomingAttackerIDs = [...new Set([
    ...baseIncomingAttackerIDs,
    ...currentProtocolAttackerIDs(observation?.combat?.incomingAttackPlayerIDs),
    ...visiblePlayers
      .filter((player) => player.incomingAttack === true)
      .map((player) => playerID(player).toLowerCase()),
  ])].filter(Boolean);
  const activeIncomingAttackerIDs = mapFingerprint === "Asia"
    ? currentProtocolIncomingAttackerIDs
    : baseIncomingAttackerIDs;
  const self = {
    tileShare: finiteNumber(own.tileShare),
    troops: finiteNumber(own.troops),
    troopRatio: finiteNumber(own.troopRatio),
    gold: own.gold,
    borderTiles: finiteNumber(own.borderTiles),
    incomingAttacks: own.incomingAttacks,
    incomingAttackerIDs: activeIncomingAttackerIDs,
    allProtocolAttackerIDs: currentProtocolIncomingAttackerIDs,
  };
  const rivals = visiblePlayers.map((player) => ({
      id: playerID(player),
      name: clean(player.name),
      tileShare: finiteNumber(player.tileShare),
      relativeTroopRatio: finiteNumber(player.relativeTroopRatio, NaN),
      sharesBorder: player.sharesBorder === true,
      isAllied: player.isAllied === true,
      relation: clean(player.relation),
      canAttack: player.canAttack === true,
    }));
  const legalActions = actions.map((action) => ({
    id: clean(action.id),
    kind: clean(action.kind),
    label: clean(action.label),
    risk: clean(action.risk?.level),
  }));
  return {
    mapFingerprint,
    phase: clean(observation?.phase),
    decisionNumber: history.length,
    self,
    rivals,
    topRivalTileShare: Math.max(0, ...rivals.map((rival) => rival.tileShare)),
    recentKinds: history.slice(-8).map((entry) => entry.kind),
    avoid: avoidActionIDs(history),
    legalActions,
  };
}

export function rivalForAction(action, state) {
  const text = actionText(action);
  const metadataID = clean(
    action?.metadata?.targetID ?? action?.metadata?.recipientID ?? "",
  ).toLowerCase();
  const metadataName = clean(
    action?.metadata?.targetName ?? action?.metadata?.recipientName ?? "",
  );
  const canonicalMetadataName = normalizedRivalName(metadataName);
  return state.rivals.find((rival) => {
    const canonicalName = normalizedRivalName(rival.name);
    const nameMatches = rival.name && (
      text.includes(rival.name.toLowerCase()) ||
      (canonicalName.length >= 3 && text.includes(canonicalName))
    );
    const idMatches = rival.id && text.includes(rival.id.toLowerCase());
    const metadataNameMatches = canonicalName.length > 0 &&
      canonicalMetadataName === canonicalName;
    const metadataIDMatches = rival.id && metadataID === rival.id.toLowerCase();
    return metadataNameMatches || metadataIDMatches || nameMatches || idMatches;
  });
}

export function consecutive(history, predicate) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    if (!predicate(history[index])) break;
    count++;
  }
  return count;
}

export function decisionsSince(history, predicate) {
  for (let index = history.length - 1; index >= 0; index--) {
    if (predicate(history[index])) return history.length - 1 - index;
  }
  return Infinity;
}

export function incomingThreatCount(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value ? 1 : 0;
}

function rivalWasIncoming(entry, rival) {
  const id = rival.id.toLowerCase();
  const name = rival.name.toLowerCase();
  return (entry?.incomingAttackerIDs || []).includes(id) ||
    (entry?.incomingAttackerNames || []).some((candidate) => candidate.toLowerCase() === name);
}

export function recentHostility(state, history, rival, window = 24) {
  const current = (state.self.incomingAttackerIDs || []).includes(rival.id.toLowerCase()) ? 1 : 0;
  return current + history.slice(-window).filter((entry) => rivalWasIncoming(entry, rival)).length;
}

function recentDistinctAttackerCount(state, history, window = 12) {
  const ids = new Set(
    (state.self.allProtocolAttackerIDs || state.self.incomingAttackerIDs || [])
      .map((id) => String(id).toLowerCase()),
  );
  for (const entry of history.slice(-window)) {
    for (const id of entry?.allProtocolAttackerIDs || entry?.incomingAttackerIDs || []) {
      ids.add(String(id).toLowerCase());
    }
    for (const name of entry?.incomingAttackerNames || []) {
      const rival = state.rivals.find(
        (candidate) => candidate.name.toLowerCase() === String(name).toLowerCase(),
      );
      ids.add(rival ? rival.id.toLowerCase() : String(name).toLowerCase());
    }
  }
  return ids.size;
}

function isReciprocalRival(rival) {
  return RECIPROCAL_RIVALS.has(normalizedRivalName(rival?.name)) ||
    RECIPROCAL_RIVAL_IDS.has(String(rival?.id ?? "").toLowerCase());
}

function reciprocalTrustIntact(state, history, rival) {
  return isReciprocalRival(rival) && recentHostility(state, history, rival, history.length) === 0;
}

function rivalIsProtected(state, history, rival) {
  if (rival.isAllied) return true;
  if (reciprocalTrustIntact(state, history, rival)) return true;
  if (state.self.tileShare >= 0.35) return false;
  if ((state.self.incomingAttackerIDs || []).includes(rival.id.toLowerCase())) return false;

  for (let index = history.length - 1; index >= Math.max(0, history.length - 24); index--) {
    const entry = history[index];
    const requested = entry.kind === "alliance_request" && (
      entry.targetID === rival.id.toLowerCase() || targetName(entry) === rival.name.toLowerCase()
    );
    if (!requested) continue;
    return !history.slice(index + 1).some((later) => rivalWasIncoming(later, rival));
  }
  return false;
}

export function stableAllianceRequests(actions) {
  // Legacy survival-path filter from the transient-hold incident (635be1d9).
  // Note: per the game source, metadata.relation is the Relation enum
  // (0 Hostile, 1 Distrustful, 2 Neutral, 3 Friendly), so this excludes
  // Neutral candidates — kept for the generic survival path only. The
  // coalition kingmaker path deliberately accepts partners at any relation.
  return safeActions(actions, (action) =>
    action.kind === "alliance_request" && Number(action?.metadata?.relation) !== 2
  );
}

export function bestAllianceRequest(actions, state, history, allowPending = false) {
  const candidates = allowPending
    ? safeActions(actions, (action) => action.kind === "alliance_request")
    : stableAllianceRequests(actions);
  const ranked = candidates
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival }) => rival && !rival.isAllied)
    .map((candidate) => ({
      ...candidate,
      hostility: recentHostility(state, history, candidate.rival),
      reciprocal: reciprocalTrustIntact(state, history, candidate.rival),
    }));
  const peaceful = ranked.filter((candidate) => candidate.hostility === 0);
  return (peaceful.length > 0 ? peaceful : ranked)
    .sort((left, right) => {
      const leftPending = Number(left.action?.metadata?.relation) === 2 ? 1 : 0;
      const rightPending = Number(right.action?.metadata?.relation) === 2 ? 1 : 0;
      return leftPending - rightPending || Number(right.reciprocal) - Number(left.reciprocal) ||
        left.hostility - right.hostility ||
        right.rival.tileShare - left.rival.tileShare;
    })[0]?.action ?? null;
}

function chooseAllianceMove(actions, state, history, threatCount, collapsing, activeDecisions) {
  const sinceAllianceMove = decisionsSince(
    history,
    (entry) => entry.kind === "alliance_request" || entry.kind === "break_alliance",
  );
  const allies = state.rivals.filter((rival) => rival.isAllied);

  if (allies.length > 0) {
    if (state.self.tileShare < 0.45 || sinceAllianceMove < 10) return null;
    const breaks = safeActions(actions, (action) => {
      if (action.kind !== "break_alliance") return false;
      const rival = rivalForAction(action, state);
      return rival?.isAllied === true && !isReciprocalRival(rival);
    });
    return breaks[0] ?? null;
  }

  const trailing = state.self.tileShare <= state.topRivalTileShare + 0.02;
  if (
    state.rivals.length < 2 || threatCount === 0 || activeDecisions < 18 ||
    sinceAllianceMove < 18 || (!collapsing && !trailing)
  ) {
    return null;
  }

  return bestAllianceRequest(actions, state, history, true);
}

export function safeActions(actions, predicate = () => true) {
  const matching = actions.filter(predicate);
  const safe = matching.filter((action) => action.risk?.level !== "high");
  return safe.length > 0 ? safe : matching;
}

function hasReliableTacticalAction(actions) {
  return actions.some((action) => {
    if (action.kind === "build") return !actionText(action).includes("defense post");
    return [
      "attack", "boat", "boat_retreat", "retreat", "nuke", "upgrade_structure",
      "warship", "move_warship",
    ].includes(action.kind);
  });
}

export function pickPercent(candidates, desiredPercent, avoid) {
  if (candidates.length === 0) return null;
  const fresh = candidates.filter((action) => !avoid.has(action.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  return [...pool].sort((left, right) => {
    const leftPercent = actionPercent(left);
    const rightPercent = actionPercent(right);
    const leftDistance = leftPercent === null ? 1000 : Math.abs(leftPercent - desiredPercent);
    const rightDistance = rightPercent === null ? 1000 : Math.abs(rightPercent - desiredPercent);
    return leftDistance - rightDistance || finiteNumber(leftPercent) - finiteNumber(rightPercent);
  })[0];
}

function targetName(entry) {
  return String(entry?.targetName ?? "").toLowerCase();
}

function attackThreshold(rival, state) {
  const isTopRival = rival.tileShare >= state.topRivalTileShare - 0.005;
  const leaderGap = rival.tileShare - state.self.tileShare;
  if (isTopRival && leaderGap >= 0.08 && state.self.tileShare >= 0.12) return 0.9;
  return 1.0;
}

function attackScore(rival, state, plan, history) {
  const ratio = rival.relativeTroopRatio;
  if (!Number.isFinite(ratio) || ratio < attackThreshold(rival, state)) return -Infinity;

  const recentTarget = consecutive(
    history,
    (entry) => entry.kind === "attack" && targetName(entry) === rival.name.toLowerCase(),
  );
  const avoided = (plan?.avoidTargets || [])
    .map((name) => String(name).toLowerCase())
    .includes(rival.name.toLowerCase());
  if (avoided && !(recentTarget > 0 && ratio >= 1.5)) return -Infinity;

  const isTopRival = rival.tileShare >= state.topRivalTileShare - 0.005;
  const planTarget = String(plan?.target ?? "").toLowerCase() === rival.name.toLowerCase();
  const vulnerability = Math.min(Math.max(ratio - 1, 0), 3) * 2;
  const landValue = rival.tileShare * 2;
  const leaderPressure = isTopRival ? 0.6 : 0;
  const finishBonus = recentTarget > 0 ? 0.9 : 0;
  const weakTargetBonus = rival.tileShare <= 0.12 && ratio >= 1.3 ? 0.4 : 0;
  const retaliationBonus = Math.min(recentHostility(state, history, rival), 4) * 0.35;
  return vulnerability + landValue + leaderPressure + finishBonus + weakTargetBonus +
    retaliationBonus + (planTarget ? 0.25 : 0);
}

function chooseRivalAttack(actions, state, plan, history, avoid, threatCount = 0) {
  const grouped = new Map();
  for (const action of safeActions(actions, (candidate) =>
    candidate.kind === "attack" && !isNeutralExpansion(candidate)
  )) {
    const rival = rivalForAction(action, state);
    if (!rival) continue;
    if (!grouped.has(rival.name)) grouped.set(rival.name, { rival, actions: [] });
    grouped.get(rival.name).actions.push(action);
  }

  const options = [...grouped.values()]
    .map((option) => ({
      ...option,
      protected: rivalIsProtected(state, history, option.rival),
      score: attackScore(option.rival, state, plan, history),
    }))
    .filter((option) => Number.isFinite(option.score))
    .sort((left, right) => right.score - left.score);
  if (options.length === 0) return null;

  const peaceRedirect = options[0].protected;
  const best = options.find((option) => !option.protected);
  if (!best) return { action: null, rival: null, streak: 0, peaceRedirect: true };
  const streak = consecutive(
    history,
    (entry) => entry.kind === "attack" && targetName(entry) === best.rival.name.toLowerCase(),
  );
  const pressureCounter = state.mapFingerprint === "World" && threatCount > 0 &&
    best.rival.relativeTroopRatio >= 1 && best.rival.relativeTroopRatio < 1.1 &&
    best.actions.some((action) => action?.metadata?.incomingAttack === true);
  let desiredPercent = pressureCounter ? 40 : 10;
  if (!pressureCounter && streak >= 1 && best.rival.relativeTroopRatio >= 1.1) {
    desiredPercent = 25;
  }
  if (!pressureCounter && streak >= 2 && best.rival.relativeTroopRatio >= 1.5) {
    desiredPercent = 40;
  }
  const action = pickPercent(best.actions, desiredPercent, avoid);
  const marker = pressureCounter ? "pc1" : peaceRedirect ? "kp1" : null;
  return {
    action: marker ? { ...action, policyMarker: marker } : action,
    rival: best.rival,
    streak,
    peaceRedirect: false,
  };
}

const KINGMAKER_RETRY_COOLDOWN = 6;

// Reciprocal partners come from two channels: visible rivals, and
// alliance_request metadata when the partner is outside the visible set.
// The game offers alliance actions for players fog-of-war hides from
// visiblePlayers, so the contract must not depend on visibility alone. A
// partner already visible (allied or not) is never re-added from metadata.
function reciprocalPartners(actions, state) {
  const partners = state.rivals.filter((rival) => isReciprocalRival(rival) && !rival.isAllied);
  const seen = new Set();
  for (const rival of state.rivals) {
    if (rival.id) seen.add(`id:${rival.id.toLowerCase()}`);
    const canonical = normalizedRivalName(rival.name);
    if (canonical) seen.add(`name:${canonical}`);
  }
  for (const action of actions) {
    if (action?.kind !== "alliance_request") continue;
    const recipientID = clean(
      action?.metadata?.recipientID ?? action?.metadata?.targetID ?? "",
    ).toLowerCase();
    const recipientName = clean(
      action?.metadata?.recipientName ?? action?.metadata?.targetName ?? "",
    );
    const canonical = normalizedRivalName(recipientName);
    const reciprocal = RECIPROCAL_RIVAL_IDS.has(recipientID) ||
      (canonical.length > 0 && RECIPROCAL_RIVALS.has(canonical));
    if (!reciprocal) continue;
    if ((recipientID && seen.has(`id:${recipientID}`)) ||
      (canonical && seen.has(`name:${canonical}`))) continue;
    if (recipientID) seen.add(`id:${recipientID}`);
    if (canonical) seen.add(`name:${canonical}`);
    partners.push({
      id: recipientID || recipientName,
      name: recipientName || recipientID,
      tileShare: 0,
      relativeTroopRatio: NaN,
      isAllied: false,
    });
  }
  return partners;
}

function matchesKingmakerPartner(action, partner, state) {
  const rival = rivalForAction(action, state);
  if (rival) {
    return isReciprocalRival(rival) &&
      (rival.id.toLowerCase() === partner.id.toLowerCase() ||
        normalizedRivalName(rival.name) === normalizedRivalName(partner.name));
  }
  const recipientID = clean(
    action?.metadata?.recipientID ?? action?.metadata?.targetID ?? "",
  ).toLowerCase();
  const recipientName = clean(
    action?.metadata?.recipientName ?? action?.metadata?.targetName ?? "",
  );
  return (recipientID.length > 0 && recipientID === partner.id.toLowerCase()) ||
    (recipientName.length > 0 &&
      normalizedRivalName(recipientName) === normalizedRivalName(partner.name));
}

function kingmakerAllianceAction(actions, state, history) {
  const partners = reciprocalPartners(actions, state);
  for (const partner of partners) {
    const candidates = safeActions(actions, (action) =>
      action.kind === "alliance_request" && matchesKingmakerPartner(action, partner, state)
    );
    if (candidates.length === 0) continue;
    const lastAttempt = decisionsSince(history, (entry) =>
      entry.kind === "alliance_request" &&
      (entry.targetID === partner.id.toLowerCase() ||
        normalizedRivalName(targetName(entry)) === normalizedRivalName(partner.name)));
    if (lastAttempt < KINGMAKER_RETRY_COOLDOWN) continue;
    // metadata.relation is the game's Relation enum (0 Hostile, 1 Distrustful,
    // 2 Neutral, 3 Friendly), not a pending-state flag: coalition partners are
    // requested at any relation, and selecting the request also accepts the
    // partner's own pending offer (reverse handshake).
    return { ...candidates[0], policyMarker: "kp2" };
  }
  return null;
}

function chooseAtomBomb(actions, state, history) {
  const candidates = safeActions(actions, (action) =>
    action.kind === "build" && String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb"
  ).map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ action, rival }) =>
      rival &&
      !rivalIsProtected(state, history, rival) &&
      Number(action?.metadata?.targetSamCoverage ?? 1) === 0 &&
      (Number(action?.metadata?.targetTileShare ?? 0) >= 0.12 ||
        (state.self.incomingAttackerIDs || []).includes(rival.id.toLowerCase()))
    );
  const best = candidates.sort((left, right) =>
    Number(right.action?.metadata?.targetTileShare ?? 0) -
    Number(left.action?.metadata?.targetTileShare ?? 0)
  )[0];
  return best ? { ...best.action, policyMarker: "nk1" } : null;
}

export function chooseNeutralAttack(actions, history, avoid) {
  const candidates = safeActions(actions, isNeutralExpansion);
  const streak = consecutive(history, (entry) => entry.neutral === true && entry.kind === "attack");
  const cadence = [10, 10, 20, 35];
  return pickPercent(candidates, cadence[Math.min(streak, cadence.length - 1)], avoid);
}

export function neutralExpansionStalled(state, history) {
  const currentShare = finiteNumber(state?.self?.tileShare, NaN);
  if (!Number.isFinite(currentShare)) return false;

  const stagnant = [];
  for (let index = history.length - 1; index >= 0; index--) {
    const previousShare = finiteNumber(history[index]?.tileShare, NaN);
    if (!Number.isFinite(previousShare) || Math.abs(currentShare - previousShare) > 0.0005) break;
    stagnant.push(history[index]);
  }
  if (stagnant.length < 4) return false;
  return stagnant.filter((entry) => entry.kind === "attack" && entry.neutral === true).length >= 3;
}

export function territoryCollapsing(state, history) {
  const currentShare = finiteNumber(state?.self?.tileShare, NaN);
  if (!Number.isFinite(currentShare)) return false;
  const recentShares = history.slice(-8)
    .map((entry) => finiteNumber(entry?.tileShare, NaN))
    .filter(Number.isFinite);
  if (recentShares.length < 3) return false;
  const recentPeak = Math.max(...recentShares);
  const meaningfulDrop = Math.max(0.005, recentPeak * 0.15);
  return recentPeak - currentShare >= meaningfulDrop;
}

export function boatConversionStalled(state, history) {
  const currentShare = finiteNumber(state?.self?.tileShare, NaN);
  if (!Number.isFinite(currentShare) || currentShare < MIN_CONVERSION_TILE_SHARE) return false;
  const recent = history.slice(-10);
  if (recent.length < 8 || recent.filter((entry) => entry.kind === "boat").length < 6) {
    return false;
  }
  const shares = recent
    .map((entry) => finiteNumber(entry?.tileShare, NaN))
    .filter(Number.isFinite);
  if (shares.length < 6) return false;
  return currentShare <= shares[0] + 0.002;
}

function builtUnits(history) {
  return history
    .filter((entry) => entry.kind === "build")
    .map((entry) => String(entry.actionID).toLowerCase());
}

export function chooseBuild(actions, history, defend = false) {
  const candidates = safeActions(actions, (action) =>
    action.kind === "build" && !actionText(action).includes("defense post")
  );
  if (candidates.length === 0) return null;
  const built = builtUnits(history);
  const preferences = defend
    ? ["city", "factory", "port", "sam launcher", "missile silo"]
    : [
        ...(built.some((id) => id.includes("city")) ? [] : ["city"]),
        ...(built.some((id) => id.includes("factory")) ? [] : ["factory"]),
        ...(built.some((id) => id.includes("port")) ? [] : ["port"]),
        ...(built.some((id) => id.includes("missile silo")) ? [] : ["missile silo"]),
        "city", "factory", "port", "missile silo", "sam launcher",
      ];
  for (const unit of preferences) {
    const action = candidates.find((candidate) => actionText(candidate).includes(unit));
    if (action) return action;
  }
  return candidates[0];
}

export function choosePangaeaDefensePost(actions, state, history, threatCount) {
  if (
    state.mapFingerprint !== "Pangaea" ||
    threatCount < 1 ||
    state.self.tileShare < 0.02 ||
    state.self.tileShare > 0.2 ||
    state.self.troopRatio > 0.95 ||
    decisionsSince(history, (entry) => entry.policyMarker === "dp1") < 8
  ) {
    return null;
  }
  const defensePost = safeActions(actions, (action) =>
    action.kind === "build" && actionText(action).includes("defense post")
  )[0];
  return defensePost ? { ...defensePost, policyMarker: "dp1" } : null;
}

function recentBoatTargetCount(history, rival) {
  const name = rival.name.toLowerCase();
  return history.slice(-8).filter((entry) =>
    entry.kind === "boat" && targetName(entry) === name
  ).length;
}

function boatTargetStalled(state, history, rival) {
  const currentShare = finiteNumber(state?.self?.tileShare, NaN);
  if (!Number.isFinite(currentShare)) return false;
  const recent = history.slice(-10);
  if (recent.filter((entry) =>
    entry.kind === "boat" && targetName(entry) === rival.name.toLowerCase()
  ).length < 6) {
    return false;
  }
  const baseline = recent
    .map((entry) => finiteNumber(entry?.tileShare, NaN))
    .find(Number.isFinite);
  return Number.isFinite(baseline) && currentShare <= baseline + 0.002;
}

export function chooseBoat(
  actions,
  state,
  history,
  avoid,
  allowDesperateInvasion = false,
  forceConversion = false,
) {
  const candidates = safeActions(actions, (action) => action.kind === "boat");
  if (candidates.length === 0) return null;

  const invasionOptions = candidates.map((action) => {
    if (isNeutralBoat(action)) return false;
    const rival = rivalForAction(action, state);
    return rival && !rivalIsProtected(state, history, rival) &&
      !boatTargetStalled(state, history, rival) ? { action, rival } : null;
  }).filter(Boolean);
  const favorableInvasions = invasionOptions.filter(({ rival }) =>
    Number.isFinite(rival.relativeTroopRatio) &&
      rival.relativeTroopRatio >= (forceConversion ? 1.0 : 1.15)
  ).sort((left, right) =>
    recentHostility(state, history, right.rival) - recentHostility(state, history, left.rival) ||
    recentBoatTargetCount(history, left.rival) - recentBoatTargetCount(history, right.rival) ||
    right.rival.relativeTroopRatio - left.rival.relativeTroopRatio ||
    right.rival.tileShare - left.rival.tileShare
  );
  const neutral = candidates.filter(isNeutralBoat);
  let pool = neutral;
  if ((forceConversion || state.self.tileShare >= 0.15) && favorableInvasions.length > 0) {
    const target = favorableInvasions[0].rival.name;
    pool = favorableInvasions
      .filter(({ rival }) => rival.name === target)
      .map(({ action }) => action);
  } else if (neutral.length === 0 && allowDesperateInvasion && invasionOptions.length > 0) {
    const viable = invasionOptions.filter(({ rival }) =>
      Number.isFinite(rival.relativeTroopRatio) &&
      rival.relativeTroopRatio >= MIN_DESPERATE_INVASION_RATIO
    );
    const target = [...viable].sort((left, right) =>
      recentBoatTargetCount(history, left.rival) - recentBoatTargetCount(history, right.rival) ||
      right.rival.relativeTroopRatio - left.rival.relativeTroopRatio ||
      right.rival.tileShare - left.rival.tileShare
    )[0]?.rival.name;
    pool = viable
      .filter(({ rival }) => rival.name === target)
      .map(({ action }) => action);
  }
  if (pool.length === 0) return null;
  const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
  return pickPercent(pool, boatStreak === 0 ? 8 : 16, avoid);
}

export function chooseUtility(actions, state, plan, history) {
  const preferredKinds = (plan?.preferKinds || []).filter((kind) =>
    ["nuke", "upgrade_structure", "warship", "move_warship"].includes(kind)
  );
  const order = [...new Set([
    "nuke", ...preferredKinds, "upgrade_structure", "warship", "move_warship",
  ])];
  for (const kind of order) {
    const action = safeActions(actions, (candidate) => {
      if (candidate.kind !== kind) return false;
      const rival = rivalForAction(candidate, state);
      return !rival || !rivalIsProtected(state, history, rival);
    })[0];
    if (action) return action;
  }

  const recentSocial = decisionsSince(history, (entry) => SOCIAL_KINDS.has(entry.kind));
  if (recentSocial >= 12 && plan?.focus === "ally") {
    const alliance = stableAllianceRequests(actions)[0];
    if (alliance) return alliance;
  }
  return null;
}

export function chooseAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const avoid = new Set(avoidActionIDs(history));
  const spawn = safeActions(actions, (action) => action.kind === "spawn")
    .find((action) => !avoid.has(action.id));
  if (spawn) return spawn;

  const threatCount = incomingThreatCount(state.self.incomingAttacks);
  const pangaeaDefensePost = choosePangaeaDefensePost(
    actions,
    state,
    history,
    threatCount,
  );
  if (pangaeaDefensePost) return pangaeaDefensePost;

  const defensiveBuild = threatCount > 0 && state.self.troopRatio < 0.8
    ? chooseBuild(actions, history, true)
    : null;
  if (defensiveBuild) return defensiveBuild;

  const kingmakerAlliance = kingmakerAllianceAction(actions, state, history);
  if (kingmakerAlliance) return kingmakerAlliance;

  const atomBomb = chooseAtomBomb(actions, state, history);
  if (atomBomb) return atomBomb;

  const rivalAttack = chooseRivalAttack(actions, state, plan, history, avoid, threatCount);
  const peaceRedirect = rivalAttack?.peaceRedirect === true;
  const withPeace = (action) =>
    peaceRedirect && action && !action.policyMarker ? { ...action, policyMarker: "kp1" } : action;
  const routedRivalAttack = state.mapFingerprint === "Asia" && rivalAttack?.action &&
    (state.self.incomingAttackerIDs || []).includes(rivalAttack.rival.id.toLowerCase())
    ? { ...rivalAttack.action, policyMarker: "ia1" }
    : rivalAttack?.action;
  const pc1Band = state.mapFingerprint === "World" && rivalAttack?.action &&
    (state.self.incomingAttackerIDs || []).includes(rivalAttack.rival.id.toLowerCase()) &&
    rivalAttack.rival.relativeTroopRatio >= 1 && rivalAttack.rival.relativeTroopRatio < 1.1;
  const pileOnDiscipline = recentDistinctAttackerCount(state, history) >= 2 &&
    rivalAttack?.action && Number.isFinite(rivalAttack.rival.relativeTroopRatio) &&
    rivalAttack.rival.relativeTroopRatio < 1.3 && !pc1Band;
  const disciplinedAttack = pileOnDiscipline ? null : routedRivalAttack;
  const withDiscipline = (action) =>
    pileOnDiscipline && action && !action.policyMarker
      ? { ...action, policyMarker: "pd2" }
      : action;
  const neutralAttack = chooseNeutralAttack(actions, history, avoid);
  const build = chooseBuild(actions, history);
  const sinceBuild = decisionsSince(history, (entry) =>
    entry.kind === "build" || entry.kind === "upgrade_structure"
  );
  const activeDecisions = history.filter((entry) => entry.kind !== "spawn").length;
  const cadenceBuild = build && state.self.tileShare >= 0.08 && activeDecisions >= 6 &&
    sinceBuild >= 14;
  const finishingTarget = rivalAttack && rivalAttack.streak > 0 &&
    rivalAttack.rival.relativeTroopRatio >= 1.5;
  const collapsing = territoryCollapsing(state, history);

  if (collapsing && build && sinceBuild >= 3 && !finishingTarget) return build;

  const allianceMove = chooseAllianceMove(
    actions,
    state,
    history,
    threatCount,
    collapsing,
    activeDecisions,
  );
  if (
    allianceMove && !finishingTarget &&
    (allianceMove.kind === "break_alliance" || !hasReliableTacticalAction(actions))
  ) {
    return allianceMove;
  }

  const conversionReady = decisionsSince(
    history,
    (entry) => entry.policyMarker === "cv1",
  ) >= 6;
  if (!collapsing && conversionReady && boatConversionStalled(state, history)) {
    const conversion = disciplinedAttack || chooseUtility(actions, state, plan, history) ||
      (sinceBuild >= 3 ? build : null) ||
      chooseBoat(actions, state, history, avoid, false, true);
    if (conversion) return { ...conversion, policyMarker: "cv1" };
  }

  if (neutralExpansionStalled(state, history)) {
    if (disciplinedAttack) return disciplinedAttack;
    const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
    if (boatStreak >= 2 && build) return withDiscipline(withPeace(build));
    const escapeBoat = chooseBoat(actions, state, history, avoid);
    if (escapeBoat) return withDiscipline(withPeace(escapeBoat));
    if (build) return withDiscipline(withPeace(build));
  }

  if (cadenceBuild && !finishingTarget) return withDiscipline(withPeace(build));
  if (state.self.tileShare < 0.12 && neutralAttack && threatCount === 0 && !collapsing) {
    return neutralAttack;
  }
  if (disciplinedAttack) return disciplinedAttack;
  if (neutralAttack) return withDiscipline(withPeace(neutralAttack));
  if (build && sinceBuild >= 5) return withDiscipline(withPeace(build));

  const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
  if (boatStreak >= 2 && build) return withDiscipline(build);
  const boat = chooseBoat(actions, state, history, avoid);
  if (boat) return withDiscipline(withPeace(boat));

  const utility = chooseUtility(actions, state, plan, history);
  if (utility) return withDiscipline(withPeace(utility));

  const desperateInvasion = !neutralAttack && !rivalAttack?.action && !build;
  if (desperateInvasion) {
    const desperateBoat = chooseBoat(actions, state, history, avoid, true);
    if (desperateBoat) return withDiscipline(desperateBoat);
  }

  const donation = safeActions(actions, (action) => {
    if (action.kind !== "donate_gold" && action.kind !== "donate_troops") return false;
    const rival = rivalForAction(action, state);
    return plan?.focus === "ally" && rival?.isAllied === true;
  })[0];
  if (donation) return donation;

  // Holding while legal tactical actions remain turns a weak position into a certain loss.
  if (build) return withDiscipline(withPeace(build));
  const retreat = safeActions(
    actions,
    (action) => action.kind === "boat_retreat" || action.kind === "retreat",
  )[0];
  if (retreat) return withDiscipline(withPeace(retreat));
  const emergencyAttacks = safeActions(actions, (action) => {
    if (action.kind !== "attack" || isNeutralExpansion(action)) return false;
    const rival = rivalForAction(action, state);
    return rival && !rivalIsProtected(state, history, rival);
  });
  const emergencyAttack = pickPercent(emergencyAttacks, 10, avoid);
  if (emergencyAttack) return emergencyAttack;

  const survivalAlliance = bestAllianceRequest(actions, state, history);
  if (survivalAlliance) return survivalAlliance;
  const pressure = safeActions(actions, (action) => action.kind === "target_player")
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival }) => rival && !rivalIsProtected(state, history, rival))
    .sort((left, right) => right.rival.tileShare - left.rival.tileShare)[0]?.action;
  if (pressure) return pressure;

  return actions.find((action) => action.kind === "hold") ?? actions[0];
}

export function recordDecision(history, action, state) {
  const rival = rivalForAction(action, state);
  const metadataTargetID = clean(
    action?.metadata?.recipientID ?? action?.metadata?.targetID ?? "",
  ).toLowerCase();
  const metadataTargetName = clean(
    action?.metadata?.recipientName ?? action?.metadata?.targetName ?? "",
  );
  const incomingAttackerIDs = state.self.incomingAttackerIDs || [];
  const incomingAttackerNames = state.rivals
    .filter((candidate) => incomingAttackerIDs.includes(candidate.id.toLowerCase()))
    .map((candidate) => candidate.name);
  history.push({
    actionID: action.id,
    kind: action.kind,
    neutral: isNeutralExpansion(action) || isNeutralBoat(action),
    targetName: rival?.name ?? (metadataTargetName || null),
    targetID: rival?.id?.toLowerCase() ?? (metadataTargetID || null),
    tileShare: state.self.tileShare,
    incomingAttackerIDs,
    allProtocolAttackerIDs: state.self.allProtocolAttackerIDs || [],
    incomingAttackerNames,
    mapFingerprint: state.mapFingerprint,
    policyMarker: action.policyMarker ?? null,
  });
  if (history.length > 320) history.shift();
}
