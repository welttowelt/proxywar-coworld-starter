import {
  HRAFN_PHASES,
  actionPercent,
  buildHrafnChassisState,
  buildUnit,
  coalitionMemberForRival,
  createHrafnPersistentState,
  hasStrictK1ZEndgameProof,
  isNeutralAction,
  isProtectedRival,
  resolveHrafnActionTarget,
} from "./hrafn-state.mjs";
import {
  assertFreshHrafnAction,
  failClosedHrafnHold,
  filterHrafnSafeActions,
} from "./hrafn-safety.mjs";

export const HRAFN_CHASSIS_DEFAULTS = Object.freeze({
  dispatcherEnabled: true,
  enableGrow: true,
  enableConvert: true,
  enableNaval: true,
  enableAlliance: true,
  enableKF1: true,
  enableMidgameSupport: false,
  neutralPercent: 35,
  pressurePercent: 10,
  warPercent: 25,
  finishPercent: 40,
  neutralBoatPercent: 16,
  invasionPercent: 25,
  cityAfterNeutralActions: 4,
  bootNeutralActions: 6,
  factoryAfterNeutralActions: 6,
  neutralStallLimit: 2,
  frontierProgressEpsilon: 0.00005,
  warReserveFloor: 0.75,
  finishReserveFloor: 0.9,
  warRatioFloor: 1.2,
  finishRatioFloor: 1.5,
  pressureRatioFloor: 0.85,
  finishTileShareFloor: 0.05,
  finishOwnShareFraction: 0.4,
  severeDefenseReserve: 0.55,
  defenseBuildCooldownDecisions: 4,
  structurePendingGraceDecisions: 3,
  structureRetryCooldownDecisions: 6,
  navalAttemptLimit: 2,
  primaryPreyBonus: 1.5,
  primaryPreyMaximumAge: 8,
  allianceCooldownDecisions: 8,
  historyLimit: 96,
  requestCacheLimit: null,
});

export const HRAFN_PRIMARY_MARKERS = new Set([
  "hg35",
  "hec1",
  "hef1",
  "hc10",
  "hc25",
  "hc40",
  "hn16",
  "hni25",
  "hncap",
  "hdef",
  "hka1",
  "hkf1",
  "hhfc",
]);

export const HRAFN_EVIDENCE_MARKERS = new Set([
  "hctr",
  "hpri",
  "hint",
  "hncap",
]);

const HRAFN_COMBAT_MARKERS = new Set([
  "hc10",
  "hc25",
  "hc40",
  "hni25",
]);

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
  donate_troops: "dnt",
  donate_gold: "dnt",
  hold: "h0d",
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stableByID(left, right) {
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function lowRiskFirst(actions) {
  return [...actions].sort((left, right) => {
    const leftHigh = left?.risk?.level === "high" ? 1 : 0;
    const rightHigh = right?.risk?.level === "high" ? 1 : 0;
    return leftHigh - rightHigh || stableByID(left, right);
  });
}

function chooseExactPercent(actions, expected) {
  return lowRiskFirst(
    actions.filter((action) => actionPercent(action) === expected),
  )[0] ?? null;
}

function routeID(action) {
  const id = String(action?.id ?? "");
  return id.replace(/:\d+(?:\.\d+)?$/, "");
}

function hasStructure(state, persistent, unit) {
  return finiteNumber(state.own.unitCounts[unit]) > 0 ||
    persistent.selectedStructures.includes(unit);
}

function structureSelectionBlocked(persistent, unit, config) {
  if (!persistent || !config) return false;
  if (Object.hasOwn(persistent.pendingStructures ?? {}, unit)) return true;
  const latest = [...(persistent.recent ?? [])].reverse().find((entry) =>
    entry.buildUnit === unit
  );
  return Boolean(
    latest &&
    persistent.decisionCount - latest.decision <
      config.structureRetryCooldownDecisions
  );
}

function buildAction(actions, units, persistent = null, config = null) {
  const candidates = lowRiskFirst(
    actions.filter((action) => action?.kind === "build"),
  );
  for (const unit of units) {
    if (structureSelectionBlocked(persistent, unit, config)) continue;
    const found = candidates.find((action) => buildUnit(action) === unit);
    if (found) return found;
  }
  return null;
}

function neutralLandAction(actions, config) {
  return chooseExactPercent(
    actions.filter((action) =>
      action?.kind === "attack" && isNeutralAction(action)
    ),
    config.neutralPercent,
  );
}

function neutralBoatActions(actions) {
  return actions.filter((action) =>
    action?.kind === "boat" && isNeutralAction(action)
  );
}

function hostileGroups(actions, state, kind = "attack") {
  const groups = new Map();
  for (const action of actions) {
    if (action?.kind !== kind || isNeutralAction(action)) continue;
    const { rival } = resolveHrafnActionTarget(action, state);
    if (!rival || isProtectedRival(rival)) continue;
    const key = rival.id.toLowerCase() || rival.canonicalName;
    if (!groups.has(key)) groups.set(key, { rival, actions: [] });
    groups.get(key).actions.push(action);
  }
  return [...groups.values()];
}

function incomingIDSet(state) {
  return new Set(state.incomingAttackerIDs.map((id) => id.toLowerCase()));
}

function groupIsCurrentAttacker(group, state) {
  const incoming = incomingIDSet(state);
  return group.rival.incomingAttack === true ||
    (group.rival.id && incoming.has(group.rival.id.toLowerCase()));
}

function isFinishable(rival, state, config) {
  const threshold = Math.max(
    config.finishTileShareFloor,
    state.own.tileShare * config.finishOwnShareFraction,
  );
  return Number.isFinite(rival.tileShare) &&
    Number.isFinite(rival.relativeTroopRatio) &&
    rival.relativeTroopRatio >= config.finishRatioFloor &&
    rival.tileShare <= threshold;
}

function targetScore(group, state, persistent, config, finishOnly = false) {
  const rival = group.rival;
  if (!Number.isFinite(rival.relativeTroopRatio)) return -Infinity;
  if (finishOnly && !isFinishable(rival, state, config)) return -Infinity;

  const currentAttacker = groupIsCurrentAttacker(group, state);
  const samePrimary = Boolean(
    (persistent.primaryPreyID &&
      rival.id.toLowerCase() === persistent.primaryPreyID) ||
    (persistent.primaryPreyName &&
      rival.canonicalName === persistent.primaryPreyName),
  );
  const finishBonus = isFinishable(rival, state, config) ? 20 : 0;
  const exposureBonus = rival.sharesBorder || rival.canAttack ? 2 : 0;
  const attackerBonus = currentAttacker ? 5 : 0;
  const primaryBonus = samePrimary &&
      persistent.primaryPreyAge <= config.primaryPreyMaximumAge
    ? config.primaryPreyBonus
    : 0;
  return finishBonus +
    rival.relativeTroopRatio * 4 +
    Math.min(rival.tileShare, 0.5) * 5 +
    exposureBonus +
    attackerBonus +
    primaryBonus;
}

function rankGroups(groups, state, persistent, config, finishOnly = false) {
  return groups
    .map((group) => ({
      ...group,
      score: targetScore(group, state, persistent, config, finishOnly),
    }))
    .filter((group) => Number.isFinite(group.score))
    .sort((left, right) =>
      right.score - left.score ||
      right.rival.relativeTroopRatio - left.rival.relativeTroopRatio ||
      right.rival.tileShare - left.rival.tileShare ||
      left.rival.canonicalName.localeCompare(right.rival.canonicalName)
    );
}

function evidenceForTarget(group, state, persistent) {
  if (groupIsCurrentAttacker(group, state)) return ["hctr"];
  const samePrimary = Boolean(
    (persistent.primaryPreyID &&
      group.rival.id.toLowerCase() === persistent.primaryPreyID) ||
    (persistent.primaryPreyName &&
      group.rival.canonicalName === persistent.primaryPreyName),
  );
  if (samePrimary || (!persistent.primaryPreyID && !persistent.primaryPreyName)) {
    return ["hpri"];
  }
  return ["hint"];
}

function selectFinish(groups, state, persistent, config) {
  if (
    !config.enableConvert ||
    state.own.troopRatio < config.finishReserveFloor
  ) {
    return null;
  }
  const group = rankGroups(
    groups,
    state,
    persistent,
    config,
    true,
  )[0];
  if (!group) return null;
  const action = chooseExactPercent(
    group.actions,
    config.finishPercent,
  );
  return action
    ? {
        action,
        marker: "hc40",
        evidenceMarkers: evidenceForTarget(group, state, persistent),
        phase: HRAFN_PHASES.FINISH,
        target: group.rival,
      }
    : null;
}

function selectCounter(groups, state, persistent, config) {
  if (!config.enableConvert) return null;
  const attackers = rankGroups(
    groups.filter((group) => groupIsCurrentAttacker(group, state)),
    state,
    persistent,
    config,
  );
  const group = attackers[0];
  if (!group) return null;
  const canWar = state.own.troopRatio >= config.warReserveFloor &&
    group.rival.relativeTroopRatio >= config.warRatioFloor;
  const desired = canWar ? config.warPercent : config.pressurePercent;
  const action = chooseExactPercent(group.actions, desired);
  return action
    ? {
        action,
        marker: canWar ? "hc25" : "hc10",
        evidenceMarkers: ["hctr"],
        phase: HRAFN_PHASES.DEFENSE,
        target: group.rival,
      }
    : null;
}

function selectWar(groups, state, persistent, config) {
  if (
    !config.enableConvert ||
    state.own.troopRatio < config.warReserveFloor
  ) {
    return null;
  }
  const ranked = rankGroups(groups, state, persistent, config)
    .filter((group) =>
      group.rival.relativeTroopRatio >= config.warRatioFloor
    );
  const group = ranked[0];
  if (!group) return null;
  const action = chooseExactPercent(
    group.actions,
    config.warPercent,
  );
  return action
    ? {
        action,
        marker: "hc25",
        evidenceMarkers: evidenceForTarget(group, state, persistent),
        phase: HRAFN_PHASES.CONTEST,
        target: group.rival,
      }
    : null;
}

function selectPressure(groups, state, persistent, config) {
  if (!config.enableConvert) return null;
  const group = rankGroups(groups, state, persistent, config)
    .filter((candidate) =>
      candidate.rival.relativeTroopRatio >= config.pressureRatioFloor
    )[0];
  if (!group) return null;
  const action = chooseExactPercent(
    group.actions,
    config.pressurePercent,
  );
  return action
    ? {
        action,
        marker: "hc10",
        evidenceMarkers: evidenceForTarget(group, state, persistent),
        phase: HRAFN_PHASES.RACE,
        target: group.rival,
      }
    : null;
}

function selectDefensiveAction(actions, state, persistent, config, groups) {
  const severe = state.incomingCount >= 2 ||
    (state.incomingCount > 0 &&
      state.own.troopRatio < config.severeDefenseReserve);
  if (!severe) return null;
  const latestDefenseBuild = [...persistent.recent].reverse().find((entry) =>
    entry.marker === "hdef" && entry.kind === "build"
  );
  const defenseBuildReady = !latestDefenseBuild ||
    persistent.decisionCount - latestDefenseBuild.decision >=
      config.defenseBuildCooldownDecisions;
  const build = defenseBuildReady
    ? buildAction(actions, [
        "sam launcher",
        "city",
        "factory",
      ], persistent, config)
    : null;
  if (build) {
    return {
      action: build,
      marker: "hdef",
      evidenceMarkers: [],
      phase: HRAFN_PHASES.DEFENSE,
      target: null,
    };
  }
  const retreat = lowRiskFirst(actions.filter((action) =>
    action?.kind === "retreat" || action?.kind === "boat_retreat"
  ))[0];
  if (retreat) {
    return {
      action: retreat,
      marker: "hdef",
      evidenceMarkers: [],
      phase: HRAFN_PHASES.RECOVERY,
      target: null,
    };
  }
  return selectCounter(groups, state, persistent, config);
}

function pendingK1ZAlliance(actions, state, persistent, config) {
  if (!config.enableAlliance) return null;
  const candidates = actions
    .filter((action) =>
      action?.kind === "alliance_request" ||
      action?.kind === "alliance_extend"
    )
    .map((action) => {
      const { rival } = resolveHrafnActionTarget(action, state);
      return {
        action,
        rival,
        member: coalitionMemberForRival(rival),
      };
    })
    .filter(({ action, rival, member }) =>
      rival &&
      member &&
      (
        (action.kind === "alliance_request" && !rival.isAllied) ||
        (action.kind === "alliance_extend" && rival.isAllied)
      )
    )
    .filter(({ action, rival }) => {
      if (action.kind === "alliance_extend") return true;
      const metadata = action?.metadata ?? {};
      if (
        metadata.incoming === true ||
        metadata.pendingOffer === true ||
        String(metadata.direction ?? "").toLowerCase() === "incoming"
      ) {
        return true;
      }
      return state.actions.some((candidate) => {
        if (candidate?.kind !== "alliance_reject") return false;
        return resolveHrafnActionTarget(candidate, state).rival?.id.toLowerCase() ===
          rival.id.toLowerCase();
      });
    })
    .sort((left, right) =>
      right.member.priority - left.member.priority ||
      stableByID(left.action, right.action)
    );
  const selected = candidates[0];
  if (!selected) return null;
  return {
    action: selected.action,
    marker: "hka1",
    evidenceMarkers: [],
    phase: HRAFN_PHASES.CONTEST,
    target: selected.rival,
  };
}

function stableK1ZAlliance(actions, state, persistent, config) {
  if (!config.enableAlliance) return null;
  const latestAlliance = [...persistent.recent].reverse().find((entry) =>
    entry.marker === "hka1"
  );
  if (
    latestAlliance &&
    persistent.decisionCount - latestAlliance.decision <
      config.allianceCooldownDecisions
  ) {
    return null;
  }
  const candidates = actions
    .filter((action) =>
      action?.kind === "alliance_request" ||
      action?.kind === "alliance_extend"
    )
    .map((action) => {
      const { rival } = resolveHrafnActionTarget(action, state);
      return {
        action,
        rival,
        member: coalitionMemberForRival(rival),
      };
    })
    .filter(({ action, rival, member }) =>
      rival &&
      member &&
      (
        (action.kind === "alliance_request" && !rival.isAllied) ||
        (action.kind === "alliance_extend" && rival.isAllied)
      )
    )
    .sort((left, right) =>
      right.member.priority - left.member.priority ||
      stableByID(left.action, right.action)
    );
  const selected = candidates[0];
  return selected
    ? {
        action: selected.action,
        marker: "hka1",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.CONTEST,
        target: selected.rival,
      }
    : null;
}

function terminalHandoff(actions, state, config) {
  if (!config.enableKF1 || !hasStrictK1ZEndgameProof(state)) return null;
  const odin = state.confirmedAliveRivals.find((rival) =>
    coalitionMemberForRival(rival)?.role === "king"
  );
  const alliance = config.enableAlliance
    ? lowRiskFirst(actions.filter((action) => {
        if (
          action?.kind !== "alliance_request" &&
          action?.kind !== "alliance_extend"
        ) {
          return false;
        }
        const { rival } = resolveHrafnActionTarget(action, state);
        return rival &&
          (
            (action.kind === "alliance_request" && !odin.isAllied) ||
            (action.kind === "alliance_extend" && odin.isAllied)
          ) &&
          (
            (odin.id && rival.id.toLowerCase() === odin.id.toLowerCase()) ||
            rival.canonicalName === odin.canonicalName
          );
      }))[0]
    : null;
  if (alliance) {
    return {
      action: alliance,
      marker: "hka1",
      evidenceMarkers: [],
      phase: HRAFN_PHASES.ENDGAME,
      target: odin,
    };
  }
  const donation = lowRiskFirst(actions.filter((action) => {
    if (
      action?.kind !== "donate_troops" &&
      action?.kind !== "donate_gold"
    ) {
      return false;
    }
    const { rival } = resolveHrafnActionTarget(action, state);
    return rival &&
      (
        (odin.id && rival.id.toLowerCase() === odin.id.toLowerCase()) ||
        rival.canonicalName === odin.canonicalName
      );
  })).sort((left, right) => {
    const leftRank = left.kind === "donate_troops" ? 0 : 1;
    const rightRank = right.kind === "donate_troops" ? 0 : 1;
    return leftRank - rightRank || stableByID(left, right);
  })[0];
  const action = donation ?? failClosedHrafnHold(actions, state);
  return {
    action,
    marker: "hkf1",
    evidenceMarkers: [],
    phase: HRAFN_PHASES.ENDGAME,
    target: donation ? odin : null,
  };
}

function observeProgress(persistentState, state, config) {
  const persistent = createHrafnPersistentState(persistentState);
  if (state.own.unitCountsObserved) {
    const observed = Object.entries(state.own.unitCounts)
      .filter(([, count]) => finiteNumber(count) > 0)
      .map(([unit]) => unit);
    for (const unit of observed) {
      delete persistent.pendingStructures[unit];
    }
    for (const [unit, selectedAt] of Object.entries(
      persistent.pendingStructures,
    )) {
      const age = persistent.decisionCount - finiteNumber(selectedAt);
      if (age >= config.structurePendingGraceDecisions) {
        delete persistent.pendingStructures[unit];
      }
    }
    persistent.selectedStructures = [
      ...new Set([
        ...observed,
        ...Object.keys(persistent.pendingStructures),
      ]),
    ];
  }
  const ownShareProgress = Number.isFinite(persistent.lastOwnTileShare) &&
    state.own.tileShare >
      persistent.lastOwnTileShare + config.frontierProgressEpsilon;
  const ownTileProgress = Number.isFinite(persistent.lastOwnTilesOwned) &&
    state.own.tilesOwned > persistent.lastOwnTilesOwned;
  const ownProgress = ownShareProgress || ownTileProgress;
  const hasOwnProgressBaseline =
    Number.isFinite(persistent.lastOwnTileShare) ||
    Number.isFinite(persistent.lastOwnTilesOwned);

  if (
    persistent.lastPrimaryMarker === "hg35" &&
    hasOwnProgressBaseline
  ) {
    persistent.neutralStallCount = ownProgress
      ? 0
      : persistent.neutralStallCount + 1;
  } else if (ownProgress) {
    persistent.neutralStallCount = 0;
  }

  const preyAlive = state.rivals.some((rival) =>
    (persistent.primaryPreyID &&
      rival.id.toLowerCase() === persistent.primaryPreyID) ||
    (persistent.primaryPreyName &&
      rival.canonicalName === persistent.primaryPreyName)
  );
  if (preyAlive) {
    persistent.primaryPreyAge += 1;
  } else {
    persistent.primaryPreyID = null;
    persistent.primaryPreyName = null;
    persistent.primaryPreyAge = 0;
  }
  return persistent;
}

function selectNeutralBoat(actions, persistent, config) {
  if (!config.enableNaval) return null;
  const boats = neutralBoatActions(actions);
  if (boats.length === 0) return null;
  if (navalCapReached(persistent, config)) return null;

  const routes = new Map();
  for (const boat of boats) {
    const key = routeID(boat);
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(boat);
  }
  const preferredRoutes = [...routes.entries()].sort(([left], [right]) => {
    const leftRepeated = left === persistent.naval.routeID ? 1 : 0;
    const rightRepeated = right === persistent.naval.routeID ? 1 : 0;
    return leftRepeated - rightRepeated || left.localeCompare(right);
  });
  const [selectedRoute, routeActions] = preferredRoutes[0];
  const action = chooseExactPercent(
    routeActions,
    config.neutralBoatPercent,
  );
  return action
    ? {
        action,
        marker: "hn16",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.EXPAND,
        target: null,
        routeID: selectedRoute,
      }
    : null;
}

function navalCapReached(persistent, config) {
  return persistent.naval.blocked === true ||
    (
      persistent.naval.attempts >= config.navalAttemptLimit &&
      persistent.naval.noProgress >= config.navalAttemptLimit
    );
}

function selectNavalCapRecovery(
  actions,
  state,
  persistent,
  config,
  groups,
) {
  if (!navalCapReached(persistent, config)) return null;
  const credibleNavalRoute = neutralBoatActions(actions).length > 0 ||
    hostileGroups(actions, state, "boat").length > 0;
  const build = buildAction(actions, [
    ...(hasStructure(state, persistent, "city") ? [] : ["city"]),
    ...(hasStructure(state, persistent, "factory") ? [] : ["factory"]),
    ...(
      credibleNavalRoute &&
      hasStructure(state, persistent, "city") &&
      hasStructure(state, persistent, "factory") &&
      !hasStructure(state, persistent, "port")
        ? ["port"]
        : []
    ),
  ], persistent, config);
  if (build) {
    return {
      action: build,
      marker: "hncap",
      evidenceMarkers: [],
      phase: HRAFN_PHASES.RECOVERY,
      target: null,
    };
  }
  const neutralGrowth = chooseExactPercent(
    actions.filter((action) =>
      action?.kind === "attack" && isNeutralAction(action)
    ),
    config.neutralPercent,
  );
  if (neutralGrowth) {
    return {
      action: neutralGrowth,
      marker: "hg35",
      evidenceMarkers: ["hncap"],
      phase: HRAFN_PHASES.RECOVERY,
      target: null,
    };
  }
  const conversion = selectWar(groups, state, persistent, config) ??
    selectPressure(groups, state, persistent, config);
  if (conversion) {
    return {
      ...conversion,
      evidenceMarkers: [
        ...new Set([...conversion.evidenceMarkers, "hncap"]),
      ],
    };
  }
  return null;
}

function selectInvasion(actions, state, persistent, config) {
  if (
    !config.enableNaval ||
    navalCapReached(persistent, config) ||
    state.own.troopRatio < config.warReserveFloor
  ) {
    return null;
  }
  const groups = rankGroups(
    hostileGroups(actions, state, "boat"),
    state,
    persistent,
    config,
  ).filter((group) =>
    group.rival.relativeTroopRatio >= config.warRatioFloor
  );
  const group = groups.find((candidate) => {
    const sameTarget = Boolean(
      persistent.naval.targetID &&
      candidate.rival.id.toLowerCase() === persistent.naval.targetID
    );
    return !sameTarget ||
      persistent.naval.noProgress < config.navalAttemptLimit;
  });
  if (!group) return null;
  const action = chooseExactPercent(
    group.actions,
    config.invasionPercent,
  );
  return action
    ? {
        action,
        marker: "hni25",
        evidenceMarkers: evidenceForTarget(group, state, persistent),
        phase: HRAFN_PHASES.RACE,
        target: group.rival,
        routeID: routeID(action),
      }
    : null;
}

function selectEconomy(actions, state, persistent, config) {
  if (
    persistent.bootNeutralCount >= config.factoryAfterNeutralActions &&
    hasStructure(state, persistent, "city") &&
    !hasStructure(state, persistent, "factory")
  ) {
    const factory = buildAction(actions, ["factory"], persistent, config);
    if (factory) {
      return {
        action: factory,
        marker: "hef1",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.EXPAND,
        target: null,
      };
    }
  }
  if (!hasStructure(state, persistent, "city")) {
    const city = buildAction(actions, ["city"], persistent, config);
    if (city) {
      return {
        action: city,
        marker: "hec1",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.BOOT,
        target: null,
      };
    }
  }
  const credibleNavalRoute = config.enableNaval &&
    (
      neutralBoatActions(actions).length > 0 ||
      hostileGroups(actions, state, "boat").length > 0
    );
  if (
    credibleNavalRoute &&
    hasStructure(state, persistent, "city") &&
    hasStructure(state, persistent, "factory") &&
    !hasStructure(state, persistent, "port")
  ) {
    const port = buildAction(actions, ["port"], persistent, config);
    if (port) {
      return {
        action: port,
        marker: "hef1",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.EXPAND,
        target: null,
      };
    }
  }
  return null;
}

function selectUtility(actions, persistent, config) {
  const recentNaval = persistent.recent.slice(-4).some((entry) =>
    entry.marker === "hn16" || entry.marker === "hni25"
  );
  const orderedKinds = [
    "upgrade_structure",
    ...(config.enableNaval && recentNaval
      ? ["warship", "move_warship"]
      : []),
    "boat_retreat",
    "retreat",
  ];
  for (const kind of orderedKinds) {
    const selected = lowRiskFirst(
      actions.filter((action) => action?.kind === kind),
    )[0];
    if (selected) return selected;
  }
  return null;
}

function selectAblationControl(actions, state) {
  const spawn = lowRiskFirst(actions.filter((action) =>
    action?.kind === "spawn"
  ))[0];
  if (spawn) return spawn;
  const neutral = chooseExactPercent(
    actions.filter((action) =>
      action?.kind === "attack" && isNeutralAction(action)
    ),
    10,
  );
  if (neutral) return neutral;
  const build = buildAction(actions, ["city", "factory", "port"]);
  if (build) return build;
  const attack = chooseExactPercent(
    hostileGroups(actions, state).flatMap((group) => group.actions),
    10,
  );
  if (attack) return attack;
  return failClosedHrafnHold(actions, state);
}

function decorateAction(selection) {
  return {
    ...selection.action,
    policyMarker: selection.marker,
    evidenceMarkers: [...new Set(selection.evidenceMarkers ?? [])],
    policyPhase: selection.phase,
  };
}

function decisionContextGeneration(state) {
  const rivals = [...state.rivals]
    .sort((left, right) =>
      left.id.localeCompare(right.id) ||
      left.canonicalName.localeCompare(right.canonicalName)
    )
    .map((rival) => [
      rival.id,
      rival.canonicalName,
      rival.isAlive,
      rival.tileShare,
      rival.tilesOwned,
      rival.relativeTroopRatio,
      rival.sharesBorder,
      rival.canAttack,
      rival.isAllied,
      rival.incomingAttack,
      rival.relation,
    ]);
  return JSON.stringify({
    gameMode: state.gameMode,
    phase: state.phase,
    turn: state.turn,
    alivePlayerCount: state.alivePlayerCount,
    livenessComplete: state.livenessComplete,
    incomingAttackerIDs: [...state.incomingAttackerIDs].sort(),
    incomingCount: state.incomingCount,
    own: state.own,
    rivals,
  });
}

function assertCandidateSelection(action, state, requirePrimary = true) {
  assertFreshHrafnAction(action, state);
  const semantics = validateHrafnMarkerSemantics(action, {
    state,
    requirePrimary,
  });
  if (!semantics.valid) {
    throw new Error(
      `Hrafn marker contract failed for ${action.id}: ${semantics.failures.join("; ")}`,
    );
  }
  return action;
}

function commitDecision({
  selection,
  decorated,
  state,
  persistent,
  requestID,
  config,
  safetyRejectedCount,
}) {
  const target = selection.target ??
    resolveHrafnActionTarget(decorated, state).rival;
  const next = createHrafnPersistentState(persistent);
  next.decisionCount += 1;
  next.lastOwnTileShare = state.own.tileShare;
  next.lastOwnTilesOwned = state.own.tilesOwned;
  next.lastActionID = decorated.id;
  next.lastPrimaryMarker = selection.marker;
  next.lastEvidenceMarkers = [...new Set(selection.evidenceMarkers ?? [])];
  next.lastTargetID = target?.id?.toLowerCase() ?? null;

  if (selection.marker === "hg35") next.bootNeutralCount += 1;
  else next.neutralStallCount = 0;
  const unit = buildUnit(decorated);
  if (unit && !next.selectedStructures.includes(unit)) {
    next.selectedStructures.push(unit);
  }
  if (unit) next.pendingStructures[unit] = next.decisionCount;
  if (
    decorated.kind === "attack" ||
    selection.marker === "hni25"
  ) {
    if (target) {
      next.primaryPreyID = target.id.toLowerCase() || null;
      next.primaryPreyName = target.canonicalName || null;
      next.primaryPreyAge = 0;
    }
  }

  if (selection.marker === "hn16" || selection.marker === "hni25") {
    const selectedRoute = selection.routeID ?? routeID(decorated);
    next.naval.attempts += 1;
    next.naval.noProgress += 1;
    next.naval.blocked = false;
    next.naval.routeID = selectedRoute;
    next.naval.targetID = target?.id?.toLowerCase() ?? null;
    next.naval.targetName = target?.canonicalName ?? null;
    next.naval.lastOwnTileShare = state.own.tileShare;
    next.naval.lastOwnTilesOwned = state.own.tilesOwned;
    next.naval.lastTargetTileShare = target?.tileShare ?? null;
    next.naval.lastTargetTilesOwned = target?.tilesOwned ?? null;
  } else if (selection.marker === "hncap") {
    next.naval.attempts = Math.max(
      next.naval.attempts,
      config.navalAttemptLimit,
    );
    next.naval.noProgress = Math.max(
      next.naval.noProgress,
      config.navalAttemptLimit,
    );
    next.naval.blocked = true;
  } else if ((selection.evidenceMarkers ?? []).includes("hncap")) {
    next.naval.attempts = Math.max(
      next.naval.attempts,
      config.navalAttemptLimit,
    );
    next.naval.noProgress = Math.max(
      next.naval.noProgress,
      config.navalAttemptLimit,
    );
    next.naval.blocked = true;
  }

  const entry = {
    decision: next.decisionCount,
    requestID: requestID ?? null,
    actionID: decorated.id,
    kind: decorated.kind,
    marker: selection.marker,
    evidenceMarkers: [...new Set(selection.evidenceMarkers ?? [])],
    phase: selection.phase,
    targetID: target?.id?.toLowerCase() ?? null,
    targetName: target?.canonicalName ?? null,
    targetTileShare: target?.tileShare ?? null,
    ownTileShare: state.own.tileShare,
    ownTroopRatio: state.own.troopRatio,
    routeID: selection.routeID ?? null,
    buildUnit: unit,
    actionGeneration: state.actionGeneration,
  };
  next.recent.push(entry);
  if (next.recent.length > config.historyLimit) next.recent.shift();

  if (requestID) {
    next.requestCache.push({
      requestID,
      actionID: decorated.id,
      marker: selection.marker,
      evidenceMarkers: entry.evidenceMarkers,
      phase: selection.phase,
      actionGeneration: state.actionGeneration,
      contextGeneration: decisionContextGeneration(state),
    });
    if (
      Number.isSafeInteger(config.requestCacheLimit) &&
      config.requestCacheLimit > 0
    ) {
      while (next.requestCache.length > config.requestCacheLimit) {
        next.requestCache.shift();
      }
    }
  }

  return {
    action: decorated,
    nextState: next,
    fallbackUsed: false,
    telemetry: {
      phase: selection.phase,
      marker: selection.marker,
      evidenceMarkers: entry.evidenceMarkers,
      targetID: entry.targetID,
      targetName: entry.targetName,
      commitment: actionPercent(decorated),
      reserve: state.own.troopRatio,
      ownTileShare: state.own.tileShare,
      targetTileShare: entry.targetTileShare,
      targetRelativeTroopRatio: target?.relativeTroopRatio ?? null,
      incomingAttackerCount: state.incomingCount,
      neutralStallCount: next.neutralStallCount,
      safetyRejectedCount,
      actionGeneration: state.actionGeneration,
      duplicateRequest: false,
    },
  };
}

function replayCachedRequest(cache, actions, state, persistent) {
  const action = actions.find((candidate) => candidate?.id === cache.actionID);
  let decorated;
  let cacheConflict = null;
  if (action) {
    decorated = {
      ...action,
      policyMarker: cache.marker,
      evidenceMarkers: [...cache.evidenceMarkers],
      policyPhase: cache.phase,
    };
    try {
      assertCandidateSelection(decorated, state, decorated.kind !== "spawn");
    } catch {
      decorated = null;
      cacheConflict = "cached-action-unsafe";
    }
  } else {
    cacheConflict = "cached-action-withdrawn";
  }
  if (!decorated) {
    const hold = failClosedHrafnHold(actions, state);
    decorated = {
      ...hold,
      policyMarker: "hhfc",
      evidenceMarkers: [],
      policyPhase: HRAFN_PHASES.RECOVERY,
    };
    assertCandidateSelection(decorated, state);
  }
  const contextChanged =
    cache.actionGeneration !== state.actionGeneration ||
    cache.contextGeneration !== decisionContextGeneration(state);
  return {
    action: decorated,
    nextState: createHrafnPersistentState(persistent),
    fallbackUsed: Boolean(cacheConflict),
    telemetry: {
      phase: decorated.policyPhase,
      marker: decorated.policyMarker,
      evidenceMarkers: [...decorated.evidenceMarkers],
      targetID: null,
      targetName: null,
      commitment: actionPercent(decorated),
      reserve: state.own.troopRatio,
      ownTileShare: state.own.tileShare,
      targetTileShare: null,
      targetRelativeTroopRatio: null,
      incomingAttackerCount: state.incomingCount,
      neutralStallCount: persistent.neutralStallCount,
      safetyRejectedCount: 0,
      actionGeneration: state.actionGeneration,
      duplicateRequest: true,
      duplicateContextChanged: contextChanged,
      cacheConflict,
    },
  };
}

export function decideHrafn({
  actions,
  observation,
  state: persistentState = createHrafnPersistentState(),
  requestID = null,
  config: configOverrides = {},
} = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  if (requestID !== null) {
    if (
      typeof requestID !== "string" ||
      !requestID ||
      requestID.trim() !== requestID
    ) {
      throw new Error("decision request had no non-empty string request ID");
    }
  }
  const config = { ...HRAFN_CHASSIS_DEFAULTS, ...configOverrides };
  const state = buildHrafnChassisState(observation, actions);
  const existing = requestID
    ? persistentState.requestCache?.find((entry) =>
      entry.requestID === requestID
    )
    : null;
  if (existing) {
    return replayCachedRequest(
      existing,
      actions,
      state,
      persistentState,
    );
  }

  const persistent = observeProgress(persistentState, state, config);
  const { safe, rejected } = filterHrafnSafeActions(actions, state);
  if (safe.length === 0) {
    throw new Error("decision request contained no safe Hrafn action");
  }

  if (!config.dispatcherEnabled) {
    const action = selectAblationControl(safe, state);
    assertFreshHrafnAction(action, state);
    return {
      action,
      nextState: persistent,
      fallbackUsed: false,
      telemetry: {
        phase: "ABLATION",
        marker: null,
        evidenceMarkers: [],
        duplicateRequest: false,
        actionGeneration: state.actionGeneration,
      },
    };
  }

  const terminal = terminalHandoff(safe, state, config);
  if (terminal) {
    const decorated = decorateAction(terminal);
    assertCandidateSelection(decorated, state);
    return commitDecision({
      selection: terminal,
      decorated,
      state,
      persistent,
      requestID,
      config,
      safetyRejectedCount: rejected.length,
    });
  }

  const spawn = lowRiskFirst(safe.filter((action) =>
    action?.kind === "spawn"
  ))[0];
  if (spawn) {
    const selection = {
      action: spawn,
      marker: null,
      evidenceMarkers: [],
      phase: HRAFN_PHASES.BOOT,
      target: null,
    };
    const decorated = decorateAction(selection);
    assertCandidateSelection(decorated, state, false);
    return commitDecision({
      selection,
      decorated,
      state,
      persistent,
      requestID,
      config,
      safetyRejectedCount: rejected.length,
    });
  }

  const groups = hostileGroups(safe, state);
  const severeDefense = selectDefensiveAction(
    safe,
    state,
    persistent,
    config,
    groups,
  );
  const finish = selectFinish(groups, state, persistent, config);
  const reverseAlliance = pendingK1ZAlliance(
    safe,
    state,
    persistent,
    config,
  );
  const counter = state.incomingCount > 0
    ? selectCounter(groups, state, persistent, config)
    : null;
  const neutral = config.enableGrow
    ? neutralLandAction(safe, config)
    : null;
  const neutralProductive = neutral &&
    persistent.neutralStallCount < config.neutralStallLimit;

  let selection = severeDefense ?? finish ?? counter ?? reverseAlliance;

  if (
    !selection &&
    persistent.bootNeutralCount >= config.cityAfterNeutralActions &&
    !hasStructure(state, persistent, "city")
  ) {
    const city = buildAction(safe, ["city"], persistent, config);
    if (city) {
      selection = {
        action: city,
        marker: "hec1",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.BOOT,
        target: null,
      };
    }
  }

  if (!selection && neutralProductive) {
    selection = {
      action: neutral,
      marker: "hg35",
      evidenceMarkers: [],
      phase: persistent.bootNeutralCount < config.bootNeutralActions
        ? HRAFN_PHASES.BOOT
        : HRAFN_PHASES.EXPAND,
      target: null,
    };
  }

  if (
    !selection &&
    config.enableNaval &&
    navalCapReached(persistent, config)
  ) {
    selection = selectNavalCapRecovery(
      safe,
      state,
      persistent,
      config,
      groups,
    );
  }
  if (!selection) selection = selectWar(groups, state, persistent, config);
  if (!selection) selection = selectEconomy(safe, state, persistent, config);
  if (!selection) selection = selectInvasion(safe, state, persistent, config);
  if (!selection) {
    selection = selectNeutralBoat(
      safe,
      persistent,
      config,
    );
  }
  if (!selection) selection = selectPressure(groups, state, persistent, config);
  if (!selection) selection = stableK1ZAlliance(
    safe,
    state,
    persistent,
    config,
  );

  if (!selection) {
    const utility = selectUtility(safe, persistent, config);
    if (utility) {
      selection = {
        action: utility,
        marker: "hdef",
        evidenceMarkers: [],
        phase: HRAFN_PHASES.RECOVERY,
        target: null,
      };
    }
  }
  if (!selection) {
    selection = {
      action: failClosedHrafnHold(safe, state),
      marker:
        config.enableNaval && navalCapReached(persistent, config)
          ? "hncap"
          : "hhfc",
      evidenceMarkers: [],
      phase: HRAFN_PHASES.RECOVERY,
      target: null,
    };
  }

  const decorated = decorateAction(selection);
  assertCandidateSelection(decorated, state);
  return commitDecision({
    selection,
    decorated,
    state,
    persistent,
    requestID,
    config,
    safetyRejectedCount: rejected.length,
  });
}

function cleanMarker(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
}

export function hrafnPublicKindCode(kind) {
  return PUBLIC_KIND[kind] ?? "act";
}

export function publicHrafnChassisReason(action) {
  const kind = hrafnPublicKindCode(action?.kind);
  const markers = [
    cleanMarker(action?.policyMarker),
    ...(Array.isArray(action?.evidenceMarkers)
      ? action.evidenceMarkers.map(cleanMarker)
      : []),
  ].filter(Boolean);
  const suffix = markers.length > 0 ? `:${[...new Set(markers)].join(".")}` : "";
  return `[K1Z] r4vn:${kind}${suffix}`.slice(0, 48);
}

export function validateHrafnMarkerSemantics(
  action,
  { state = null, requirePrimary = false } = {},
) {
  const marker = action?.policyMarker;
  const percent = actionPercent(action);
  const unit = buildUnit(action);
  const failures = [];

  if (requirePrimary && !marker) {
    failures.push("missing primary marker");
  }
  if (marker && !HRAFN_PRIMARY_MARKERS.has(marker)) {
    failures.push(`unknown primary marker ${marker}`);
  }
  for (const evidence of action?.evidenceMarkers ?? []) {
    if (!HRAFN_EVIDENCE_MARKERS.has(evidence)) {
      failures.push(`unknown evidence marker ${evidence}`);
    }
    if (
      (evidence === "hctr" || evidence === "hpri" || evidence === "hint") &&
      !HRAFN_COMBAT_MARKERS.has(marker)
    ) {
      failures.push(`${evidence} requires a combat primary marker`);
    }
    if (
      evidence === "hncap" &&
      marker !== "hg35" &&
      !HRAFN_COMBAT_MARKERS.has(marker)
    ) {
      failures.push(
        "hncap evidence requires a land-growth or combat primary marker",
      );
    }
  }
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  switch (marker) {
    case "hg35":
      expect(
        action?.kind === "attack" && isNeutralAction(action) && percent === 35,
        "hg35 requires a neutral 35 percent land attack",
      );
      break;
    case "hec1":
      expect(action?.kind === "build" && unit === "city", "hec1 requires City");
      break;
    case "hef1":
      expect(
        action?.kind === "build" && (unit === "factory" || unit === "port"),
        "hef1 requires Factory or route-backed Port",
      );
      break;
    case "hc10":
      expect(
        action?.kind === "attack" &&
          !isNeutralAction(action) &&
          percent === 10,
        "hc10 requires targeted attack 10",
      );
      break;
    case "hc25":
      expect(
        action?.kind === "attack" &&
          !isNeutralAction(action) &&
          percent === 25,
        "hc25 requires targeted attack 25",
      );
      break;
    case "hc40":
      expect(
        action?.kind === "attack" &&
          !isNeutralAction(action) &&
          percent === 40,
        "hc40 requires targeted attack 40",
      );
      break;
    case "hn16":
      expect(
        action?.kind === "boat" && isNeutralAction(action) && percent === 16,
        "hn16 requires neutral boat 16",
      );
      break;
    case "hni25":
      expect(
        action?.kind === "boat" && !isNeutralAction(action) && percent === 25,
        "hni25 requires targeted boat 25",
      );
      break;
    case "hncap":
      expect(
        action?.kind === "build" || action?.kind === "hold",
        "hncap requires a cap replacement build or fail-closed hold",
      );
      break;
    case "hdef":
      expect(
        ["build", "retreat", "boat_retreat", "upgrade_structure", "warship", "move_warship"]
          .includes(action?.kind),
        "hdef requires a defensive or recovery action",
      );
      break;
    case "hka1":
      expect(
        action?.kind === "alliance_request" || action?.kind === "alliance_extend",
        "hka1 requires an alliance action",
      );
      if (
        state &&
        !coalitionMemberForRival(resolveHrafnActionTarget(action, state).rival)
      ) {
        failures.push("hka1 requires a resolved K1Z target");
      }
      break;
    case "hkf1":
      expect(
        action?.kind === "donate_troops" ||
          action?.kind === "donate_gold" ||
          action?.kind === "hold",
        "hkf1 requires an Odin donation or fail-closed hold",
      );
      if (
        state &&
        (action?.kind === "donate_troops" || action?.kind === "donate_gold") &&
        coalitionMemberForRival(
          resolveHrafnActionTarget(action, state).rival,
        )?.role !== "king"
      ) {
        failures.push("hkf1 donation requires a resolved Odin target");
      }
      break;
    case "hhfc":
      expect(action?.kind === "hold", "hhfc requires hold");
      break;
    default:
      break;
  }
  return { valid: failures.length === 0, failures };
}
