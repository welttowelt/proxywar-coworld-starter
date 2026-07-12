const SOCIAL_KINDS = new Set([
  "alliance_request", "alliance_extend", "break_alliance", "target_player",
  "embargo", "embargo_all", "embargo_stop", "donate_gold", "donate_troops",
  "quick_chat", "emoji",
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

function isNeutralBoat(action) {
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

export function buildState(observation, actions, history = [], context = {}) {
  const own = observation?.ownState || {};
  const combat = observation?.combat || {};
  const tactical = observation?.tacticalAffordances || {};
  const incomingAttacks = Math.max(
    incomingThreatCount(own.incomingAttacks),
    Array.isArray(combat.incomingAttackPlayerIDs) ? combat.incomingAttackPlayerIDs.length : 0,
    Array.isArray(combat.incomingAttacks) ? combat.incomingAttacks.length : 0,
  );
  const self = {
    tileShare: finiteNumber(own.tileShare),
    troops: finiteNumber(own.troops),
    troopRatio: finiteNumber(own.troopRatio),
    gold: finiteNumber(own.gold),
    borderTiles: finiteNumber(own.borderTiles),
    incomingAttacks,
  };
  const rivals = (observation?.visiblePlayers || [])
    .filter((player) => player && player.isAlive)
    .map((player) => ({
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
    phase: clean(observation?.phase),
    profile: (clean(observation?.profile) || clean(context?.profile)).toLowerCase(),
    decisionNumber: history.length,
    self,
    rivals,
    topRivalTileShare: Math.max(0, ...rivals.map((rival) => rival.tileShare)),
    recentKinds: history.slice(-8).map((entry) => entry.kind),
    avoid: avoidActionIDs(history),
    legalActions,
    homeDanger: clean(
      tactical?.transportTroopBanking?.homeDanger ??
      tactical?.frontierFinishPressure?.homeDanger ??
      "low",
    ).toLowerCase(),
    incomingThreatRatio: finiteNumber(
      tactical?.transportTroopBanking?.incomingThreatRatio,
    ),
    survivalAllianceRecommended: tactical?.survivalAlliance?.recommended === true,
    survivalAllianceTargetID: clean(tactical?.survivalAlliance?.bestAllyTargetID),
    survivalAllianceTargetName: clean(tactical?.survivalAlliance?.bestAllyName),
  };
}

export function rivalForAction(action, state) {
  const text = actionText(action);
  const metadataID = clean(
    action?.metadata?.targetID ?? action?.metadata?.recipientID ?? "",
  ).toLowerCase();
  const metadataName = clean(
    action?.metadata?.targetName ?? action?.metadata?.recipientName ?? "",
  ).toLowerCase();
  return state.rivals.find((rival) => {
    const nameMatches = rival.name && text.includes(rival.name.toLowerCase());
    const idMatches = rival.id && text.includes(rival.id.toLowerCase());
    const metadataNameMatches = rival.name && metadataName === rival.name.toLowerCase();
    const metadataIDMatches = rival.id && metadataID === rival.id.toLowerCase();
    return metadataNameMatches || metadataIDMatches || nameMatches || idMatches;
  });
}

function consecutive(history, predicate) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    if (!predicate(history[index])) break;
    count++;
  }
  return count;
}

function decisionsSince(history, predicate) {
  for (let index = history.length - 1; index >= 0; index--) {
    if (predicate(history[index])) return history.length - 1 - index;
  }
  return Infinity;
}

function incomingThreatCount(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value ? 1 : 0;
}

function stableAllianceRequests(actions) {
  // Relation 2 is a transient pending-request action. It can disappear while the
  // simultaneous turn is resolving, which makes the game replace it with HOLD.
  return safeActions(actions, (action) =>
    action.kind === "alliance_request" && Number(action?.metadata?.relation) !== 2
  );
}

function preferredAllianceRequest(actions, targetID) {
  const preferred = clean(targetID).toLowerCase();
  if (!preferred) return null;
  return stableAllianceRequests(actions).find((action) => {
    const recipientID = clean(
      action?.metadata?.recipientID ?? action?.metadata?.targetID,
    ).toLowerCase();
    return recipientID === preferred || clean(action?.id).toLowerCase() === `alliance:${preferred}`;
  }) ?? null;
}

function bestAllianceRequest(actions, state, allowPending = false, preferredTargetName = null) {
  const candidates = allowPending
    ? safeActions(actions, (action) => action.kind === "alliance_request")
    : stableAllianceRequests(actions);
  return candidates
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival }) => rival && !rival.isAllied)
    .sort((left, right) => {
      const preferred = String(preferredTargetName ?? "").toLowerCase();
      const leftPreferred = left.rival.name.toLowerCase() === preferred ? 0 : 1;
      const rightPreferred = right.rival.name.toLowerCase() === preferred ? 0 : 1;
      const leftPending = Number(left.action?.metadata?.relation) === 2 ? 1 : 0;
      const rightPending = Number(right.action?.metadata?.relation) === 2 ? 1 : 0;
      return leftPreferred - rightPreferred || leftPending - rightPending ||
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
      return rival?.isAllied === true;
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

  return bestAllianceRequest(actions, state, !collapsing);
}

function safeActions(actions, predicate = () => true) {
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

function pickPercent(candidates, desiredPercent, avoid) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const leftPercent = actionPercent(left);
    const rightPercent = actionPercent(right);
    const leftDistance = leftPercent === null ? 1000 : Math.abs(leftPercent - desiredPercent);
    const rightDistance = rightPercent === null ? 1000 : Math.abs(rightPercent - desiredPercent);
    const leftAvoided = avoid.has(left.id) ? 1 : 0;
    const rightAvoided = avoid.has(right.id) ? 1 : 0;
    return leftDistance - rightDistance || leftAvoided - rightAvoided ||
      finiteNumber(leftPercent) - finiteNumber(rightPercent);
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
  return vulnerability + landValue + leaderPressure + finishBonus + weakTargetBonus +
    (planTarget ? 0.25 : 0);
}

function chooseRivalAttack(actions, state, plan, history, avoid) {
  const grouped = new Map();
  for (const action of safeActions(actions, (candidate) =>
    candidate.kind === "attack" && !isNeutralExpansion(candidate)
  )) {
    const rival = rivalForAction(action, state);
    if (!rival || rival.isAllied) continue;
    if (!grouped.has(rival.name)) grouped.set(rival.name, { rival, actions: [] });
    grouped.get(rival.name).actions.push(action);
  }

  const options = [...grouped.values()]
    .map((option) => ({
      ...option,
      score: attackScore(option.rival, state, plan, history),
    }))
    .filter((option) => Number.isFinite(option.score))
    .sort((left, right) => right.score - left.score);
  if (options.length === 0) return null;

  const best = options[0];
  const streak = consecutive(
    history,
    (entry) => entry.kind === "attack" && targetName(entry) === best.rival.name.toLowerCase(),
  );
  let desiredPercent = 10;
  if (streak >= 1 && best.rival.relativeTroopRatio >= 1.1) desiredPercent = 25;
  if (streak >= 2 && best.rival.relativeTroopRatio >= 1.5) desiredPercent = 40;
  const underPressure = incomingThreatCount(state.self.incomingAttacks) > 0 ||
    state.self.troopRatio < 0.85;
  const decisiveFinish = best.rival.tileShare <= 0.05 &&
    best.rival.relativeTroopRatio >= 1.8;
  if (underPressure && !decisiveFinish) desiredPercent = 10;
  return {
    action: pickPercent(best.actions, desiredPercent, avoid),
    rival: best.rival,
    streak,
  };
}

function chooseNeutralAttack(actions, history, avoid) {
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
  return territoryDrawdown(state, history) >= 0.15;
}

function territoryDrawdown(state, history) {
  const currentShare = finiteNumber(state?.self?.tileShare, NaN);
  if (!Number.isFinite(currentShare)) return 0;
  const recentShares = history.slice(-8)
    .map((entry) => finiteNumber(entry?.tileShare, NaN))
    .filter(Number.isFinite);
  if (recentShares.length < 3) return 0;
  const recentPeak = Math.max(...recentShares);
  if (recentPeak <= 0) return 0;
  return Math.max(0, (recentPeak - currentShare) / recentPeak);
}

function builtUnits(history) {
  return history
    .filter((entry) => entry.kind === "build")
    .map((entry) => String(entry.actionID).toLowerCase());
}

function builtCount(built, unit) {
  return built.filter((id) => id.includes(unit)).length;
}

function coreEconomyBuilt(history) {
  const built = builtUnits(history);
  return builtCount(built, "city") > 0 && builtCount(built, "factory") > 0 &&
    builtCount(built, "port") > 0;
}

function hasBuilt(history, unit) {
  return builtUnits(history).some((id) => id.includes(unit));
}

function chooseBuild(actions, history, defend = false, lowRiskOnly = false) {
  const matching = actions.filter((action) =>
    action.kind === "build" && !actionText(action).includes("defense post")
  );
  const lowRisk = matching.filter((action) =>
    !action.risk?.level || action.risk.level === "none" || action.risk.level === "low"
  );
  const candidates = lowRiskOnly ? lowRisk : safeActions(matching);
  if (candidates.length === 0) return null;
  const built = builtUnits(history);
  const coreOrder = ["city", "factory", "port"];
  const missingCore = coreOrder.filter((unit) => builtCount(built, unit) === 0);
  const balancedCore = [...coreOrder].sort(
    (left, right) => builtCount(built, left) - builtCount(built, right),
  );
  const preferences = defend
    ? ["city", "factory", "port", "sam launcher", "missile silo"]
    : missingCore.length > 0
      ? [...missingCore, ...balancedCore, "missile silo", "sam launcher"]
      : [
          ...(builtCount(built, "missile silo") > 0 ? [] : ["missile silo"]),
          ...(builtCount(built, "sam launcher") > 0 ? [] : ["sam launcher"]),
          ...balancedCore,
        ];
  for (const unit of preferences) {
    const action = candidates.find((candidate) => actionText(candidate).includes(unit));
    if (action) return action;
  }
  return candidates[0];
}

function chooseRetreat(actions) {
  return safeActions(actions, (action) => action.kind === "retreat")[0] ??
    safeActions(actions, (action) => action.kind === "boat_retreat")[0] ?? null;
}

function chooseNuke(actions, state) {
  return safeActions(actions, (action) => action.kind === "nuke")
    .map((action) => {
      const rival = rivalForAction(action, state);
      if (rival?.isAllied) return { action, score: -Infinity };
      const targetShare = finiteNumber(
        action?.metadata?.targetTileShare,
        rival?.tileShare ?? 0,
      );
      const targetPriority = finiteNumber(action?.metadata?.nuclearTargetPriority, 0);
      const structurePriority = finiteNumber(action?.metadata?.targetStructurePriority, 0);
      const leaderBonus = rival && rival.tileShare >= state.topRivalTileShare - 0.005 ? 4 : 0;
      return {
        action,
        score: targetPriority * 3 + structurePriority + targetShare * 10 + leaderBonus,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)[0]?.action ?? null;
}

function chooseLeaderInvasion(actions, state, history, avoid) {
  const activeDecisions = history.filter((entry) => entry.kind !== "spawn").length;
  if (activeDecisions < 60 || state.self.tileShare < 0.18) return null;

  const targets = state.rivals
    .filter((rival) => !rival.isAllied)
    .sort((left, right) => right.tileShare - left.tileShare);
  const target = targets[0];
  if (!target || !Number.isFinite(target.relativeTroopRatio)) return null;

  const narrowedField = targets.length <= 2;
  const leaderGap = target.tileShare - state.self.tileShare;
  const minimumRatio = narrowedField ? 0.9 : leaderGap >= 0.06 ? 0.95 : 1.1;
  if (target.relativeTroopRatio < minimumRatio) return null;

  const candidates = safeActions(actions, (action) => {
    if (action.kind !== "boat" || isNeutralBoat(action)) return false;
    return rivalForAction(action, state)?.name === target.name;
  });
  const streak = consecutive(
    history,
    (entry) => entry.kind === "boat" && targetName(entry) === target.name.toLowerCase(),
  );
  const desiredPercent = streak >= 2 && target.relativeTroopRatio >= 1.3
    ? 25
    : streak >= 1
      ? 16
      : 8;
  return pickPercent(candidates, desiredPercent, avoid);
}

function shouldBankForSilo(actions, state, history, activeDecisions) {
  if (activeDecisions < 70 || state.self.tileShare < 0.18 || state.rivals.length > 2) {
    return false;
  }
  if (!coreEconomyBuilt(history) || hasBuilt(history, "missile silo")) return false;
  const siloIsLegal = actions.some((action) =>
    action.kind === "build" && actionText(action).includes("missile silo")
  );
  return !siloIsLegal;
}

function chooseBoat(actions, state, history, avoid, allowDesperateInvasion = false) {
  const candidates = safeActions(actions, (action) => action.kind === "boat");
  if (candidates.length === 0) return null;

  const invasionOptions = candidates.map((action) => {
    if (isNeutralBoat(action)) return false;
    const rival = rivalForAction(action, state);
    return rival && !rival.isAllied ? { action, rival } : null;
  }).filter(Boolean);
  const favorableInvasions = invasionOptions.filter(({ rival }) =>
    Number.isFinite(rival.relativeTroopRatio) && rival.relativeTroopRatio >= 1.15
  );
  const neutral = candidates.filter(isNeutralBoat);
  let pool = neutral;
  if (state.self.tileShare >= 0.15 && favorableInvasions.length > 0) {
    pool = favorableInvasions.map(({ action }) => action);
  } else if (neutral.length === 0 && allowDesperateInvasion && invasionOptions.length > 0) {
    const bestRatio = Math.max(...invasionOptions.map(({ rival }) =>
      Number.isFinite(rival.relativeTroopRatio) ? rival.relativeTroopRatio : -Infinity
    ));
    pool = invasionOptions
      .filter(({ rival }) => !Number.isFinite(bestRatio) || rival.relativeTroopRatio === bestRatio)
      .map(({ action }) => action);
  }
  if (pool.length === 0) return null;
  const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
  return pickPercent(pool, boatStreak === 0 ? 8 : 16, avoid);
}

function chooseUtility(actions, plan, history) {
  const preferredKinds = (plan?.preferKinds || []).filter((kind) =>
    ["nuke", "upgrade_structure", "warship", "move_warship"].includes(kind)
  );
  const order = [...new Set([
    "nuke", ...preferredKinds, "upgrade_structure", "warship", "move_warship",
  ])];
  for (const kind of order) {
    const action = safeActions(actions, (candidate) => candidate.kind === kind)[0];
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

  const activeDecisions = history.filter((entry) => entry.kind !== "spawn").length;
  const protectiveProfile = state.profile === "defensive" || state.profile === "diplomatic";
  const sinceAllianceMove = decisionsSince(
    history,
    (entry) => entry.kind === "alliance_request" || entry.kind === "break_alliance",
  );
  if (state.survivalAllianceRecommended && activeDecisions <= 2 && sinceAllianceMove >= 18) {
    const openingAlliance = preferredAllianceRequest(
      actions,
      state.survivalAllianceTargetID,
    ) ?? bestAllianceRequest(actions, state, false, state.survivalAllianceTargetName);
    if (openingAlliance) return openingAlliance;
  }

  const threatCount = incomingThreatCount(state.self.incomingAttacks);
  const collapsing = territoryCollapsing(state, history);
  const retreat = chooseRetreat(actions);
  const protectiveSlip = protectiveProfile && territoryDrawdown(state, history) >= 0.06;
  if ((collapsing || protectiveSlip) && retreat) return retreat;

  const defensiveBuild = threatCount > 0 && state.self.troopRatio < 0.8
    ? chooseBuild(actions, history, true, true)
    : null;
  if (defensiveBuild) return defensiveBuild;

  const rivalAttack = chooseRivalAttack(actions, state, plan, history, avoid);
  const neutralAttack = chooseNeutralAttack(actions, history, avoid);
  const sinceBuild = decisionsSince(history, (entry) =>
    entry.kind === "build" || entry.kind === "upgrade_structure"
  );
  const bankingForSilo = shouldBankForSilo(actions, state, history, activeDecisions);
  const build = bankingForSilo ? null : chooseBuild(actions, history, false, collapsing);
  const cadenceBuild = build && state.self.tileShare >= 0.08 && activeDecisions >= 6 &&
    sinceBuild >= 14;
  const finishingTarget = rivalAttack && rivalAttack.streak > 0 &&
    rivalAttack.rival.relativeTroopRatio >= 1.5;
  const nuke = chooseNuke(actions, state);

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
    (
      allianceMove.kind === "break_alliance" ||
      !hasReliableTacticalAction(actions)
    )
  ) {
    return allianceMove;
  }

  if (nuke && activeDecisions >= 50 && (state.self.tileShare >= 0.15 || state.rivals.length <= 2)) {
    return nuke;
  }

  if (neutralExpansionStalled(state, history)) {
    if (rivalAttack?.action) return rivalAttack.action;
    const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
    if (boatStreak >= 2 && build) return build;
    const escapeBoat = chooseBoat(actions, state, history, avoid);
    if (escapeBoat) return escapeBoat;
    if (build) return build;
  }

  if (cadenceBuild && !finishingTarget) return build;
  if (state.self.tileShare < 0.12 && neutralAttack && threatCount === 0 && !collapsing) {
    return neutralAttack;
  }
  if (rivalAttack?.action) return rivalAttack.action;
  const leaderInvasion = chooseLeaderInvasion(actions, state, history, avoid);
  if (leaderInvasion) return leaderInvasion;
  if (neutralAttack && !collapsing) return neutralAttack;
  if (build && sinceBuild >= 5) return build;

  if (collapsing) {
    const emergencyNeutral = pickPercent(
      safeActions(actions, isNeutralExpansion),
      10,
      new Set(),
    );
    if (emergencyNeutral) return emergencyNeutral;
  }

  const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
  if (boatStreak >= 2 && build) return build;
  const desperateInvasion = !neutralAttack && !rivalAttack?.action && !build;
  const boat = chooseBoat(actions, state, history, avoid, desperateInvasion);
  if (boat) return boat;

  const utility = chooseUtility(actions, plan, history);
  if (utility) return utility;

  const donation = safeActions(actions, (action) => {
    if (action.kind !== "donate_gold" && action.kind !== "donate_troops") return false;
    const rival = rivalForAction(action, state);
    return plan?.focus === "ally" && rival?.isAllied === true;
  })[0];
  if (donation) return donation;

  // Holding while legal tactical actions remain turns a weak position into a certain loss.
  if (build) return build;
  const fallbackRetreat = safeActions(
    actions,
    (action) => action.kind === "boat_retreat" || action.kind === "retreat",
  )[0];
  if (fallbackRetreat) return fallbackRetreat;
  const emergencyAttacks = safeActions(actions, (action) => {
    if (action.kind !== "attack" || isNeutralExpansion(action)) return false;
    const rival = rivalForAction(action, state);
    return rival && !rival.isAllied;
  });
  const emergencyAttack = pickPercent(emergencyAttacks, 10, avoid);
  if (emergencyAttack) return emergencyAttack;

  const survivalAlliance = bestAllianceRequest(actions, state);
  if (survivalAlliance) return survivalAlliance;
  const pressure = safeActions(actions, (action) => action.kind === "target_player")
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival }) => rival && !rival.isAllied)
    .sort((left, right) => right.rival.tileShare - left.rival.tileShare)[0]?.action;
  if (pressure) return pressure;

  return actions.find((action) => action.kind === "hold") ?? actions[0];
}

export function recordDecision(history, action, state) {
  const rival = rivalForAction(action, state);
  history.push({
    actionID: action.id,
    kind: action.kind,
    neutral: isNeutralExpansion(action) || isNeutralBoat(action),
    targetName: rival?.name ?? null,
    tileShare: state.self.tileShare,
  });
  if (history.length > 320) history.shift();
}
