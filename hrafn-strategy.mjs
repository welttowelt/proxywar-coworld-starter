const HARMFUL_KINDS = new Set([
  "attack",
  "boat",
  "nuke",
  "target_player",
  "embargo",
  "embargo_all",
  "break_alliance",
  "alliance_reject",
]);

const SOCIAL_KINDS = new Set([
  "alliance_request",
  "alliance_extend",
  "break_alliance",
  "alliance_reject",
  "target_player",
  "embargo",
  "embargo_all",
  "embargo_stop",
  "donate_gold",
  "donate_troops",
  "quick_chat",
  "emoji",
]);

export const HRAFN_PLAYER_ID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";

export const K1Z_MEMBERS = Object.freeze([
  {
    role: "king",
    priority: 3,
    id: "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    names: ["odin free"],
  },
  {
    role: "spear",
    priority: 2,
    id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    names: ["katanasan"],
  },
  {
    role: "shield",
    priority: 1,
    id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
    names: ["juryoku koku"],
  },
]);

export const HRAFN_DEFAULTS = Object.freeze({
  activationTileShare: 0.1,
  activationCeiling: 0.3,
  minimumRelativeTroopRatio: 1.25,
  continuingRelativeTroopRatio: 1.1,
  priorityTargetNames: Object.freeze(["auri"]),
  priorityAttackFloor: 1.35,
  leaderHandoffGap: 0.05,
  leaderPressureCooldownDecisions: 4,
  openingPercent: 25,
  pressurePercent: 10,
  priorityPressurePercent: 25,
  maximumCommitPercent: 25,
  campaignDecisions: 8,
  campaignCooldownDecisions: 6,
  allianceCooldownDecisions: 6,
  supportCooldownDecisions: 8,
  supportMinimumTileShare: 0.06,
  supportLeadGap: 0.01,
  pressureCooldownDecisions: 12,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function canonicalizeK1ZName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\[k1z\]|k1z)(?:\s+|$)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function playerID(player) {
  return String(
    player?.id ?? player?.playerID ?? player?.playerId ?? player?.player_id ?? "",
  ).trim();
}

function collectIncomingAttackerIDs(observation, rivals) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) ids.add(value.trim().toLowerCase());
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") {
      add(value);
      return;
    }
    const direct = value.attackerID ?? value.attackerId ?? value.sourcePlayerID ??
      value.sourcePlayerId ?? value.sourceID ?? value.sourceId;
    if (direct !== undefined) add(direct);
  };

  visit(observation?.combat?.incomingAttackPlayerIDs);
  visit(observation?.ownState?.incomingAttacks);
  for (const rival of rivals) {
    if (rival.incomingAttack === true && rival.id) ids.add(rival.id.toLowerCase());
  }
  return [...ids];
}

export function buildHrafnState(observation, actions = []) {
  const visiblePlayers = Array.isArray(observation?.visiblePlayers)
    ? observation.visiblePlayers
    : [];
  const rivals = visiblePlayers
    .filter((player) => player && player.isAlive !== false)
    .map((player) => ({
      id: playerID(player),
      name: String(player.name ?? "").trim(),
      canonicalName: canonicalizeK1ZName(player.name),
      tileShare: finiteNumber(player.tileShare),
      relativeTroopRatio: finiteNumber(player.relativeTroopRatio, NaN),
      sharesBorder: player.sharesBorder === true,
      canAttack: player.canAttack === true,
      isAllied: player.isAllied === true,
      incomingAttack: player.incomingAttack === true,
      relation: player.relation,
    }));
  const own = observation?.ownState ?? {};
  return {
    own: {
      tileShare: finiteNumber(own.tileShare),
      troopRatio: finiteNumber(own.troopRatio),
      troops: finiteNumber(own.troops),
      gold: finiteNumber(own.gold),
      incomingAttacks: own.incomingAttacks,
    },
    rivals,
    incomingAttackerIDs: collectIncomingAttackerIDs(observation, rivals),
    actions,
  };
}

export function coalitionMemberForRival(rival) {
  if (!rival) return null;
  const id = String(rival.id ?? "").toLowerCase();
  const name = canonicalizeK1ZName(rival.canonicalName ?? rival.name);
  return K1Z_MEMBERS.find((member) =>
    member.id.toLowerCase() === id ||
    member.names.some((candidate) => canonicalizeK1ZName(candidate) === name)
  ) ?? null;
}

export function isProtectedRival(rival) {
  return rival?.isAllied === true || coalitionMemberForRival(rival) !== null;
}

function actionText(action) {
  return `${action?.id ?? ""} ${action?.label ?? ""}`;
}

export function actionPercent(action) {
  const direct = Number(action?.metadata?.troopPercent);
  if (Number.isFinite(direct)) return direct;
  const match = String(action?.id ?? "").match(/:(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

export function isNeutralAction(action) {
  if (action?.kind !== "attack" && action?.kind !== "boat") return false;
  const text = canonicalizeK1ZName(actionText(action));
  return action?.metadata?.expansion === true ||
    String(action?.id ?? "").toLowerCase().startsWith("expand:terra-nullius:") ||
    text.includes("terra nullius");
}

export function rivalForHrafnAction(action, state) {
  const metadataID = String(
    action?.metadata?.targetID ?? action?.metadata?.targetId ??
    action?.metadata?.recipientID ?? action?.metadata?.recipientId ?? "",
  ).trim().toLowerCase();
  const metadataName = canonicalizeK1ZName(
    action?.metadata?.targetName ?? action?.metadata?.recipientName ?? "",
  );
  const text = actionText(action).toLowerCase();
  const canonicalText = canonicalizeK1ZName(actionText(action));

  return state.rivals.find((rival) => {
    const id = rival.id.toLowerCase();
    const name = rival.canonicalName;
    return Boolean(
      (metadataID && id && metadataID === id) ||
      (metadataName && name && metadataName === name) ||
      (id && text.includes(id)) ||
      (name && canonicalText.includes(name))
    );
  }) ?? null;
}

function safeActions(actions, predicate = () => true) {
  const matching = actions.filter(predicate);
  const safe = matching.filter((action) => action?.risk?.level !== "high");
  return safe.length > 0 ? safe : matching;
}

function decisionsSince(history, predicate) {
  for (let index = history.length - 1; index >= 0; index--) {
    if (predicate(history[index])) return history.length - 1 - index;
  }
  return Infinity;
}

function chooseClosestPercent(actions, desired, maximum = Infinity) {
  const bounded = actions.filter((action) => {
    const percent = actionPercent(action);
    return percent === null || percent <= maximum;
  });
  if (bounded.length === 0) return null;
  return [...bounded].sort((left, right) => {
    const leftPercent = actionPercent(left);
    const rightPercent = actionPercent(right);
    const leftDistance = leftPercent === null ? 1000 : Math.abs(leftPercent - desired);
    const rightDistance = rightPercent === null ? 1000 : Math.abs(rightPercent - desired);
    return leftDistance - rightDistance ||
      finiteNumber(leftPercent, 1000) - finiteNumber(rightPercent, 1000);
  })[0];
}

function buildAction(actions, history, defensive = false) {
  const candidates = safeActions(actions, (action) =>
    action.kind === "build" &&
    !canonicalizeK1ZName(actionText(action)).includes("defense post")
  );
  if (candidates.length === 0) return null;
  const built = history
    .filter((entry) => entry.kind === "build")
    .map((entry) => String(entry.actionID).toLowerCase());
  const preference = defensive
    ? ["sam launcher", "city", "factory", "port"]
    : [
        ...(built.some((id) => id.includes("city")) ? [] : ["city"]),
        ...(built.some((id) => id.includes("factory")) ? [] : ["factory"]),
        ...(built.some((id) => id.includes("port")) ? [] : ["port"]),
        "sam launcher",
        "city",
        "factory",
        "port",
      ];
  for (const unit of preference) {
    const match = candidates.find((action) =>
      canonicalizeK1ZName(actionText(action)).includes(unit)
    );
    if (match) return match;
  }
  return candidates[0];
}

function coalitionAllianceAction(actions, state, history, config) {
  const candidates = actions
    .filter((action) =>
      action.kind === "alliance_request" || action.kind === "alliance_extend"
    )
    .map((action) => ({
      action,
      rival: rivalForHrafnAction(action, state),
    }))
    .map((candidate) => ({
      ...candidate,
      member: coalitionMemberForRival(candidate.rival),
    }))
    .filter(({ rival, member }) => rival && member && !rival.isAllied)
    .filter(({ action, rival }) => {
      const since = decisionsSince(history, (entry) =>
        SOCIAL_KINDS.has(entry.kind) &&
        (entry.targetID === rival.id.toLowerCase() ||
          entry.targetName === rival.canonicalName)
      );
      if (since < config.allianceCooldownDecisions) return false;
      if (Number(action?.metadata?.relation) !== 2) return true;
      return actions.some((candidate) =>
        candidate.kind === "alliance_reject" &&
        rivalForHrafnAction(candidate, state)?.id.toLowerCase() === rival.id.toLowerCase()
      );
    })
    .sort((left, right) => right.member.priority - left.member.priority);
  return candidates[0]
    ? { ...candidates[0].action, policyMarker: "k1z" }
    : null;
}

function odinSupportAction(actions, state, history, config) {
  const odin = state.rivals.find((rival) =>
    coalitionMemberForRival(rival)?.role === "king" && rival.isAlive !== false
  );
  if (!odin) return null;
  if (
    state.own.tileShare < config.supportMinimumTileShare ||
    state.own.tileShare < odin.tileShare + config.supportLeadGap
  ) {
    return null;
  }
  const since = decisionsSince(history, (entry) =>
    entry.policyMarker === "dn1" && entry.targetID === odin.id.toLowerCase()
  );
  if (since < config.supportCooldownDecisions) return null;
  const candidates = safeActions(actions, (action) =>
    (action.kind === "donate_troops" || action.kind === "donate_gold") &&
    rivalForHrafnAction(action, state)?.id.toLowerCase() === odin.id.toLowerCase()
  );
  const troops = candidates.find((action) => action.kind === "donate_troops");
  const gold = candidates.find((action) => action.kind === "donate_gold");
  const selected = troops ?? gold;
  return selected ? { ...selected, policyMarker: "dn1" } : null;
}

function attackGroups(actions, state) {
  const groups = new Map();
  for (const action of safeActions(actions, (candidate) =>
    candidate.kind === "attack" && !isNeutralAction(candidate)
  )) {
    const rival = rivalForHrafnAction(action, state);
    if (!rival || isProtectedRival(rival)) continue;
    if (!groups.has(rival.id)) groups.set(rival.id, { rival, actions: [] });
    groups.get(rival.id).actions.push(action);
  }
  return [...groups.values()];
}

function latestCampaign(history) {
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.policyMarker !== "rv1" && entry.policyMarker !== "rv2") continue;
    return {
      lastIndex: index,
      startDecision: Number.isInteger(entry.campaignStartDecision)
        ? entry.campaignStartDecision
        : index,
      targetID: entry.targetID,
      targetName: entry.targetName,
    };
  }
  return null;
}

function campaignState(history, state, config) {
  const latest = latestCampaign(history);
  if (!latest) return { active: false, cooling: false, campaign: null, rival: null };
  const age = history.length - latest.startDecision;
  const sinceAction = history.length - 1 - latest.lastIndex;
  const rival = state.rivals.find((candidate) =>
    (latest.targetID && candidate.id.toLowerCase() === latest.targetID) ||
    (latest.targetName && candidate.canonicalName === latest.targetName)
  ) ?? null;
  const viable = rival && !isProtectedRival(rival) && rival.isAllied !== true;
  if (viable && age < config.campaignDecisions) {
    return { active: true, cooling: false, campaign: latest, rival };
  }
  return {
    active: false,
    cooling: sinceAction < config.campaignCooldownDecisions,
    campaign: latest,
    rival,
  };
}

function isPriorityTarget(rival, config) {
  const priorityNames = Array.isArray(config.priorityTargetNames)
    ? config.priorityTargetNames.map(canonicalizeK1ZName)
    : [];
  return priorityNames.includes(rival?.canonicalName);
}

function selectPriorityCampaign(groups, state, config) {
  if (
    state.own.tileShare < config.activationTileShare ||
    state.own.tileShare > config.activationCeiling
  ) {
    return null;
  }
  return groups
    .filter(({ rival }) =>
      isPriorityTarget(rival, config) &&
      (rival.sharesBorder || rival.canAttack)
    )
    .sort((left, right) =>
      right.rival.tileShare - left.rival.tileShare ||
      right.rival.relativeTroopRatio - left.rival.relativeTroopRatio
    )[0] ?? null;
}

function selectAdaptiveLeader(state, history, config) {
  if (
    state.own.tileShare < config.activationTileShare ||
    state.own.tileShare > config.activationCeiling
  ) {
    return null;
  }
  const outsiders = state.rivals
    .filter((rival) => !isProtectedRival(rival))
    .sort((left, right) =>
      right.tileShare - left.tileShare ||
      right.relativeTroopRatio - left.relativeTroopRatio
    );
  if (outsiders.length === 0) return null;
  const auri = outsiders.find((rival) => isPriorityTarget(rival, config)) ?? null;
  const rv3Started = history.some((entry) => entry.policyMarker === "rv3");
  if (!rv3Started && auri) return auri;
  const leader = outsiders[0];
  if (
    auri &&
    leader.tileShare - auri.tileShare <= config.leaderHandoffGap
  ) {
    return auri;
  }
  return rv3Started || auri ? leader : null;
}

function adaptiveLeaderPressureAction(actions, state, history, rival, config) {
  const since = decisionsSince(history, (entry) =>
    entry.policyMarker === "rv3" &&
    (entry.targetID === rival.id.toLowerCase() ||
      entry.targetName === rival.canonicalName)
  );
  if (since < config.leaderPressureCooldownDecisions) return null;
  const action = safeActions(actions, (candidate) =>
    candidate.kind === "target_player" &&
    rivalForHrafnAction(candidate, state)?.id.toLowerCase() === rival.id.toLowerCase()
  )[0];
  return action
    ? {
        ...action,
        policyMarker: "rv3",
        campaignStartDecision: history.length,
      }
    : null;
}

function selectNewCampaign(groups, state, config) {
  if (
    state.own.tileShare < config.activationTileShare ||
    state.own.tileShare > config.activationCeiling
  ) {
    return null;
  }
  const incoming = new Set(state.incomingAttackerIDs);
  return groups
    .filter(({ rival }) =>
      Number.isFinite(rival.relativeTroopRatio) &&
      rival.relativeTroopRatio >= config.minimumRelativeTroopRatio &&
      (rival.sharesBorder || rival.canAttack)
    )
    .map((candidate) => ({
      ...candidate,
      score: candidate.rival.tileShare * 10 +
        (incoming.has(candidate.rival.id.toLowerCase()) ? 2 : 0) +
        (candidate.rival.sharesBorder ? 0.5 : 0),
    }))
    .sort((left, right) =>
      right.score - left.score ||
      right.rival.relativeTroopRatio - left.rival.relativeTroopRatio
    )[0] ?? null;
}

function campaignAttack(
  group,
  history,
  campaignStartDecision,
  config,
  marker = "rv1",
) {
  if (!group) return null;
  const alreadyOpened = history.some((entry) =>
    (entry.policyMarker === "rv1" || entry.policyMarker === "rv2") &&
    entry.campaignStartDecision === campaignStartDecision &&
    entry.kind === "attack"
  );
  const desired = marker === "rv2"
    ? config.priorityPressurePercent
    : (alreadyOpened ? config.pressurePercent : config.openingPercent);
  const selected = chooseClosestPercent(
    group.actions,
    desired,
    config.maximumCommitPercent,
  );
  return selected
    ? {
        ...selected,
        policyMarker: marker,
        campaignStartDecision,
      }
    : null;
}

function campaignPressureAction(
  actions,
  state,
  history,
  rival,
  campaignStartDecision,
  config,
  marker = "rv1",
) {
  if (!state.rivals.some((candidate) => coalitionMemberForRival(candidate) && candidate.isAllied)) {
    return null;
  }
  if (decisionsSince(history, (entry) =>
    entry.kind === "target_player" && entry.targetID === rival.id.toLowerCase()
  ) < config.pressureCooldownDecisions) {
    return null;
  }
  const action = safeActions(actions, (candidate) => {
    if (candidate.kind !== "target_player") return false;
    return rivalForHrafnAction(candidate, state)?.id.toLowerCase() === rival.id.toLowerCase();
  })[0];
  return action
    ? { ...action, policyMarker: marker, campaignStartDecision }
    : null;
}

function neutralExpansion(actions, desired = 35) {
  return chooseClosestPercent(
    safeActions(actions, (action) => action.kind === "attack" && isNeutralAction(action)),
    desired,
    40,
  );
}

function neutralBoat(actions) {
  return chooseClosestPercent(
    safeActions(actions, (action) => action.kind === "boat" && isNeutralAction(action)),
    8,
    16,
  );
}

function safeUtility(actions, state) {
  for (const kind of ["upgrade_structure", "warship", "move_warship"]) {
    const action = safeActions(actions, (candidate) => {
      if (candidate.kind !== kind) return false;
      const rival = rivalForHrafnAction(candidate, state);
      return !rival || !isProtectedRival(rival);
    })[0];
    if (action) return action;
  }
  return null;
}

function fallbackRivalAttack(groups, state, history) {
  const incoming = new Set(state.incomingAttackerIDs);
  const recentTarget = [...history].reverse().find((entry) =>
    entry.kind === "attack" && entry.targetID
  );
  const ranked = groups
    .filter(({ rival }) =>
      Number.isFinite(rival.relativeTroopRatio) &&
      rival.relativeTroopRatio >= 1.35
    )
    .map((candidate) => ({
      ...candidate,
      score:
        (incoming.has(candidate.rival.id.toLowerCase()) ? 3 : 0) +
        (recentTarget?.targetID === candidate.rival.id.toLowerCase() ? 2 : 0) +
        candidate.rival.tileShare +
        candidate.rival.relativeTroopRatio / 10,
    }))
    .sort((left, right) => right.score - left.score)[0];
  return ranked
    ? chooseClosestPercent(ranked.actions, 10, 25)
    : null;
}

const WITHDRAWABLE_SOCIAL_KINDS = new Set([
  "quick_chat",
  "emoji",
  "embargo_stop",
  "alliance_request",
]);

function withdrawalRecoveryAction(actions, state, history) {
  const previous = history.at(-1);
  if (
    !WITHDRAWABLE_SOCIAL_KINDS.has(previous?.kind) ||
    actions.some((action) => action.id === previous.actionID)
  ) {
    return null;
  }

  const rivalAttack = chooseClosestPercent(
    safeActions(actions, (action) => {
      if (action.kind !== "attack" || isNeutralAction(action)) return false;
      const rival = rivalForHrafnAction(action, state);
      return rival && !isProtectedRival(rival);
    }),
    10,
    25,
  );
  if (rivalAttack) return { ...rivalAttack, policyMarker: "wr1" };

  // Retry menus can strip the expansion metadata from boat actions. A numeric
  // tile destination has no explicit player target; retain the smallest
  // commitment and fail closed whenever the action resolves to a K1Z rival.
  const boat = chooseClosestPercent(
    safeActions(actions, (action) => {
      if (action.kind !== "boat") return false;
      const rival = rivalForHrafnAction(action, state);
      return !rival || !isProtectedRival(rival);
    }),
    8,
    25,
  );
  return boat ? { ...boat, policyMarker: "wr1" } : null;
}

export function chooseHrafnAction(
  actions,
  observation,
  history = [],
  options = {},
) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const state = buildHrafnState(observation, actions);
  const config = { ...HRAFN_DEFAULTS, ...(options.config ?? {}) };
  const rv1Enabled = options.rv1Enabled !== false;

  const spawn = safeActions(actions, (action) => action.kind === "spawn")[0];
  if (spawn) return spawn;

  const alliance = coalitionAllianceAction(actions, state, history, config);
  if (alliance) return alliance;

  const support = odinSupportAction(actions, state, history, config);
  if (support) return support;

  const incomingCount = state.incomingAttackerIDs.length ||
    finiteNumber(state.own.incomingAttacks);
  const severePressure = incomingCount >= 2 ||
    (incomingCount > 0 && state.own.troopRatio < 0.75);
  if (severePressure) {
    const defensive = buildAction(actions, history, true);
    if (defensive) return { ...defensive, policyMarker: "sk1" };
    const retreat = safeActions(actions, (action) =>
      action.kind === "retreat" || action.kind === "boat_retreat"
    )[0];
    if (retreat) return { ...retreat, policyMarker: "sk1" };
  }

  const groups = attackGroups(actions, state);
  const campaign = campaignState(history, state, config);
  const adaptiveLeader = rv1Enabled
    ? selectAdaptiveLeader(state, history, config)
    : null;
  const leaderInterceptActive = adaptiveLeader !== null;
  if (adaptiveLeader) {
    const group = groups.find(({ rival }) =>
      rival.id.toLowerCase() === adaptiveLeader.id.toLowerCase()
    );
    if (
      group &&
      adaptiveLeader.relativeTroopRatio >= config.priorityAttackFloor
    ) {
      const attack = campaignAttack(
        group,
        history,
        history.length,
        config,
        "rv3",
      );
      if (attack) return attack;
    }
    const pressure = adaptiveLeaderPressureAction(
      actions,
      state,
      history,
      adaptiveLeader,
      config,
    );
    if (pressure) return pressure;
  }

  const priority = selectPriorityCampaign(groups, state, config);
  const activePriority = campaign.active && isPriorityTarget(campaign.rival, config);
  if (rv1Enabled && !leaderInterceptActive && priority && !activePriority) {
    if (priority.rival.relativeTroopRatio >= config.priorityAttackFloor) {
      const attack = campaignAttack(
        priority,
        history,
        history.length,
        config,
        "rv2",
      );
      if (attack) return attack;
    }
    const pressure = campaignPressureAction(
      actions,
      state,
      history,
      priority.rival,
      history.length,
      config,
      "rv2",
    );
    if (pressure) return pressure;
  }
  if (rv1Enabled && !leaderInterceptActive && campaign.active) {
    const group = groups.find(({ rival }) =>
      rival.id.toLowerCase() === campaign.rival.id.toLowerCase()
    );
    const marker = isPriorityTarget(campaign.rival, config) ? "rv2" : "rv1";
    const attackFloor = marker === "rv2"
      ? config.priorityAttackFloor
      : config.continuingRelativeTroopRatio;
    if (
      group &&
      campaign.rival.relativeTroopRatio >= attackFloor
    ) {
      const attack = campaignAttack(
        group,
        history,
        campaign.campaign.startDecision,
        config,
        marker,
      );
      if (attack) return attack;
    }
    const pressure = campaignPressureAction(
      actions,
      state,
      history,
      campaign.rival,
      campaign.campaign.startDecision,
      config,
      marker,
    );
    if (pressure) return pressure;
  }

  if (state.own.tileShare < config.activationTileShare) {
    const expansion = neutralExpansion(actions);
    if (expansion) return expansion;
  }

  const sinceBuild = decisionsSince(history, (entry) =>
    entry.kind === "build" || entry.kind === "upgrade_structure"
  );
  if (state.own.tileShare >= 0.08 && sinceBuild >= 10) {
    const build = buildAction(actions, history);
    if (build) return build;
  }

  if (
    rv1Enabled &&
    !leaderInterceptActive &&
    !campaign.active &&
    !campaign.cooling
  ) {
    const next = selectNewCampaign(groups, state, config);
    if (next) {
      const attack = campaignAttack(next, history, history.length, config);
      if (attack) return attack;
    }
  }

  const expansion = neutralExpansion(actions);
  if (expansion) return expansion;

  const build = buildAction(actions, history);
  if (build) return build;

  if (!campaign.active) {
    const fallbackAttack = fallbackRivalAttack(groups, state, history);
    if (fallbackAttack) return fallbackAttack;
  }

  const boat = neutralBoat(actions);
  if (boat) return boat;

  const utility = safeUtility(actions, state);
  if (utility) return utility;

  const retreat = safeActions(actions, (action) =>
    action.kind === "retreat" || action.kind === "boat_retreat"
  )[0];
  if (retreat) return retreat;

  const withdrawalRecovery = withdrawalRecoveryAction(actions, state, history);
  if (withdrawalRecovery) return withdrawalRecovery;

  const recentActionIDs = new Set(history.slice(-6).map((entry) => entry.actionID));
  // Quick-chat text is authored by the game, not by the player response.
  // Selecting it can therefore publish long prose that violates Hrafn's
  // short-leet public contract even though the response reason is bounded.
  const safeSocial = safeActions(actions, (action) =>
    action.kind === "embargo_stop" && !recentActionIDs.has(action.id)
  )[0];
  if (safeSocial) return safeSocial;

  return actions.find((action) => action.kind === "hold") ?? actions.find((action) => {
    if (action.kind === "donate_gold" || action.kind === "donate_troops") return false;
    if (!HARMFUL_KINDS.has(action.kind)) return true;
    if (isNeutralAction(action)) return true;
    const rival = rivalForHrafnAction(action, state);
    return rival && !isProtectedRival(rival);
  }) ?? actions[0];
}

export function recordHrafnDecision(history, action, observation) {
  const state = buildHrafnState(observation, []);
  const rival = rivalForHrafnAction(action, state);
  history.push({
    actionID: String(action?.id ?? ""),
    kind: String(action?.kind ?? ""),
    targetID: rival?.id?.toLowerCase() ?? null,
    targetName: rival?.canonicalName ?? null,
    tileShare: state.own.tileShare,
    incomingAttackerIDs: state.incomingAttackerIDs,
    policyMarker: action?.policyMarker ?? null,
    campaignStartDecision: Number.isInteger(action?.campaignStartDecision)
      ? action.campaignStartDecision
      : null,
  });
  if (history.length > 320) history.shift();
}

const PUBLIC_KIND = Object.freeze({
  spawn: "spn",
  attack: "atk",
  build: "bld",
  upgrade_structure: "upg",
  boat: "b0t",
  boat_retreat: "rtr",
  retreat: "rtr",
  warship: "w4r",
  move_warship: "mvw",
  alliance_request: "4ly",
  alliance_extend: "4ly",
  target_player: "tgt",
  donate_troops: "dnt",
  donate_gold: "dnt",
  quick_chat: "cht",
  emoji: "emj",
  embargo_stop: "emb",
  hold: "h0d",
});

export function publicHrafnReason(action) {
  const kind = PUBLIC_KIND[action?.kind] ?? "act";
  const marker = String(action?.policyMarker ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  return `[K1Z] r4vn:${kind}${marker ? `:${marker}` : ""}`.slice(0, 48);
}
