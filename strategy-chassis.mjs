/**
 * qd2n chassis: a minimal deterministic policy implementing the shared
 * winner profile measured in experiments/winner-decision-logic-20260717.md.
 *
 * Sequence: grind neutral land at a flat 35% above a troop floor, retaliate
 * first against current attackers, attack rivals only at 25%+ commitment,
 * cap expansion boats, keep the economy cadence, and use alliances when no
 * tactical action remains. Markers: ch1 (grind), ch2 (commitment contact).
 */
import {
  actionTargetsK1Z,
  actionPercent,
  actionText,
  avoidActionIDs,
  chooseAction as chooseSelectorAction,
  bestAllianceRequest,
  boatConversionStalled,
  chooseBoat,
  chooseBuild,
  chooseNeutralAttack,
  chooseUtility,
  consecutive,
  decisionsSince,
  incomingThreatCount,
  isNeutralBoat,
  isNeutralExpansion,
  kingmakerAllianceAction,
  pickPercent,
  recentHostility,
  rivalForAction,
  rivalIsK1Z,
  rivalIsProtected,
  safeActions,
  territoryCollapsing,
} from "./strategy-engine.mjs";

export const GRIND_TROOP_FLOOR = 100000;
export const MIN_RIVAL_COMMIT = 25;
export const CHASSIS_MARKERS = ["ch1", "ch2"];

function targetName(entry) {
  return String(entry?.targetName ?? "").toLowerCase();
}

function chassisAttackScore(rival, state, history) {
  const ratio = rival.relativeTroopRatio;
  if (!Number.isFinite(ratio) || ratio < 1.0) return -Infinity;
  const vulnerability = Math.min(Math.max(ratio - 1, 0), 3) * 2;
  const landValue = rival.tileShare * 2;
  const retaliation = Math.min(recentHostility(state, history, rival), 4) * 0.5;
  const leader = rival.tileShare >= state.topRivalTileShare - 0.005 ? 0.4 : 0;
  return vulnerability + landValue + retaliation + leader;
}

function pickRivalAttack(actions, state, history, avoid) {
  const grouped = new Map();
  for (const action of safeActions(actions, (candidate) =>
    candidate.kind === "attack" && !isNeutralExpansion(candidate)
  )) {
    const rival = rivalForAction(action, state);
    if (!rival || rival.isAllied) continue;
    if (!grouped.has(rival.name)) grouped.set(rival.name, { rival, actions: [] });
    grouped.get(rival.name).actions.push(action);
  }
  const started = [...history].reverse().find((entry) => entry.kind === "attack" && targetName(entry));
  const startedName = started ? targetName(started) : null;
  const options = [...grouped.values()];
  const sticky = startedName
    ? options.find((option) =>
        option.rival.name.toLowerCase() === startedName &&
        Number.isFinite(option.rival.relativeTroopRatio) &&
        option.rival.relativeTroopRatio >= 1.0
      )
    : null;
  const best = sticky ?? options
    .map((option) => ({
      ...option,
      score: chassisAttackScore(option.rival, state, history),
    }))
    .filter((option) => Number.isFinite(option.score))
    .sort((left, right) => right.score - left.score)[0];
  if (!best) return null;
  const streak = consecutive(
    history,
    (entry) => entry.kind === "attack" && targetName(entry) === best.rival.name.toLowerCase(),
  );
  const percent = streak >= 2 && best.rival.relativeTroopRatio >= 1.5 ? 40 : MIN_RIVAL_COMMIT;
  return {
    action: { ...pickPercent(best.actions, percent, avoid), policyMarker: "ch2" },
    rival: best.rival,
  };
}

export function chooseChassisAction(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const avoid = new Set(avoidActionIDs(history));
  const spawn = safeActions(actions, (action) => action.kind === "spawn")
    .find((action) => !avoid.has(action.id));
  if (spawn) return spawn;

  // World and unknown maps run the proven mx3 route; the grind chassis
  // holds Asia and Pangaea only.
  if (state.mapFingerprint !== "Asia" && state.mapFingerprint !== "Pangaea") {
    return chooseSelectorAction(actions, state, plan, history);
  }

  const threatCount = incomingThreatCount(state.self.incomingAttacks);
  const collapsing = territoryCollapsing(state, history);
  const opening = state.self.tileShare < 0.12 && threatCount === 0 && !collapsing;
  const attackers = new Set(
    (state.self.incomingAttackerIDs || []).map((id) => String(id).toLowerCase()),
  );

  if (threatCount > 0 && state.self.troopRatio < 0.8) {
    const defense = chooseBuild(actions, history, true);
    if (defense) return defense;
  }

  const rivalAttack = pickRivalAttack(actions, state, history, avoid);

  // Retaliation first: a current attacker can be answered slightly below parity.
  if (
    rivalAttack && attackers.has(rivalAttack.rival.id.toLowerCase()) &&
    rivalAttack.rival.relativeTroopRatio >= 0.9
  ) {
    return rivalAttack.action;
  }

  // Opening grind: flat 35% neutral commitment above the troop floor.
  const neutralActions = safeActions(actions, isNeutralExpansion);
  if (opening && neutralActions.length > 0) {
    if (state.self.troops >= GRIND_TROOP_FLOOR) {
      return { ...pickPercent(neutralActions, 35, new Set()), policyMarker: "ch1" };
    }
    const cadence = chooseNeutralAttack(actions, history, avoid);
    if (cadence) return cadence;
  }

  // Contact: rival attacks at 25% minimum commitment; opening contact needs 1.3.
  if (rivalAttack && (!opening || rivalAttack.rival.relativeTroopRatio >= 1.3)) {
    return rivalAttack.action;
  }

  if (neutralActions.length > 0) {
    const cadence = chooseNeutralAttack(actions, history, avoid);
    if (cadence) return cadence;
  }

  const build = chooseBuild(actions, history);
  const sinceBuild = decisionsSince(history, (entry) =>
    entry.kind === "build" || entry.kind === "upgrade_structure"
  );
  if (build && sinceBuild >= 5) return build;

  const boatStreak = consecutive(history, (entry) => entry.kind === "boat");
  if (boatStreak < 2) {
    const boat = chooseBoat(actions, state, history, avoid);
    if (boat) return boat;
  }
  if (build) return build;

  const utility = chooseUtility(actions, state, plan, history);
  if (utility) return utility;

  const alliance = bestAllianceRequest(actions, state, history);
  if (alliance) return alliance;

  const retreat = safeActions(actions, (action) =>
    action.kind === "boat_retreat" || action.kind === "retreat"
  )[0];
  if (retreat) return retreat;

  // Holding while legal tactical actions remain turns a weak position into a
  // certain loss; the last resort is a cheap unprotected probe, never a hold.
  const emergencyAttacks = safeActions(actions, (action) =>
    action.kind === "attack" && !isNeutralExpansion(action)
  );
  const emergencyAttack = pickPercent(emergencyAttacks, 10, avoid);
  if (emergencyAttack) return emergencyAttack;

  const pressure = safeActions(actions, (action) => action.kind === "target_player")
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival }) => rival && !rival.isAllied)
    .sort((left, right) => right.rival.tileShare - left.rival.tileShare)[0]?.action;
  if (pressure) return pressure;

  return actions.find((action) => action.kind === "hold") ?? actions[0];
}

export const ODIN_CHASSIS_MARKERS = [
  "odef", "odec1", "odec2", "odg10", "odg20", "odg35",
  "odc10", "odc25", "odc40", "odn8", "odn16", "odncap", "odecon",
  "odsafe", "odguard",
];

function marked(action, marker) {
  return action ? { ...action, policyMarker: marker } : null;
}

const ODIN_HARMFUL_KINDS = new Set([
  "attack", "boat", "break_alliance", "embargo", "embargo_all", "move_warship",
  "nuke", "target_player", "warship",
]);

function odinActionIsHarmful(action) {
  return ODIN_HARMFUL_KINDS.has(action?.kind) ||
    (action?.kind === "build" &&
      String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb");
}

function odinProtectedActions(actions, state, history) {
  const incoming = new Set(
    (state.self.allProtocolAttackerIDs || state.self.incomingAttackerIDs || [])
      .map((id) => String(id).toLowerCase()),
  );
  return actions.filter((action) => {
    if (!odinActionIsHarmful(action)) return true;
    if (isNeutralExpansion(action) || isNeutralBoat(action)) return true;
    if (
      action.kind === "embargo_all" ||
      action.kind === "move_warship" ||
      (
        action.kind === "build" &&
        String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb"
      )
    ) {
      return false;
    }
    const rival = rivalForAction(action, state);
    return Boolean(
      rival &&
      !rivalIsK1Z(rival) &&
      !actionTargetsK1Z(action, state) &&
      (
        !rivalIsProtected(state, history, rival) ||
        incoming.has(rival.id.toLowerCase())
      ),
    );
  });
}

function builtUnit(history, unit) {
  const needle = String(unit).toLowerCase();
  return history.some((entry) =>
    entry.kind === "build" && String(entry.actionID).toLowerCase().includes(needle)
  );
}

function odinBuildActions(actions, state, history) {
  return actions.filter((action) => {
    if (action.kind === "nuke") return false;
    if (action.kind !== "build") return true;
    const metadata = action?.metadata || {};
    if (String(metadata.unit ?? "").toLowerCase() === "atom bomb") return false;
    const targeted = metadata.targetID || metadata.targetName ||
      metadata.recipientID || metadata.recipientName ||
      false;
    if (!targeted) return true;
    const rival = rivalForAction(action, state);
    return rival && !rivalIsK1Z(rival) && !rivalIsProtected(state, history, rival);
  });
}

function chooseOdinBuild(actions, state, history, defend = false) {
  return chooseBuild(odinBuildActions(actions, state, history), history, defend);
}

function namedBuild(actions, state, history, unit) {
  const needle = String(unit).toLowerCase();
  return safeActions(odinBuildActions(actions, state, history), (action) =>
    action.kind === "build" && actionText(action).includes(needle)
  )[0] ?? null;
}

function productiveNeutralCount(state, history) {
  const shares = history.map((entry) => Number(entry?.tileShare));
  shares.push(Number(state?.self?.tileShare));
  let count = 0;
  for (let index = 0; index < history.length; index++) {
    if (history[index]?.kind !== "attack" || history[index]?.neutral !== true) continue;
    const before = shares[index];
    const after = shares.slice(index + 1).find(Number.isFinite);
    if (Number.isFinite(before) && Number.isFinite(after) && after > before + 0.0005) {
      count++;
    }
  }
  return count;
}

function chooseOdinEconomy(actions, state, history) {
  const productive = productiveNeutralCount(state, history);
  if (productive >= 4 && !builtUnit(history, "city")) {
    return marked(namedBuild(actions, state, history, "city"), "odec1");
  }
  if (
    productive >= 6 &&
    builtUnit(history, "city") &&
    !builtUnit(history, "factory")
  ) {
    return marked(namedBuild(actions, state, history, "factory"), "odec2");
  }
  return null;
}

function chooseOdinAtomBomb(actions, state, history) {
  const incoming = new Set(
    (state.self.allProtocolAttackerIDs || state.self.incomingAttackerIDs || [])
      .map((id) => String(id).toLowerCase()),
  );
  const candidates = safeActions(actions, (action) =>
    action.kind === "nuke" &&
    (
      String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb" ||
      actionText(action).includes("atom bomb")
    )
  ).map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ action, rival }) => {
      if (
        !rival ||
        rivalIsK1Z(rival) ||
        actionTargetsK1Z(action, state) ||
        rivalIsProtected(state, history, rival) ||
        Number(action?.metadata?.targetSamCoverage ?? 1) !== 0
      ) {
        return false;
      }
      const targetShare = Number(
        action?.metadata?.targetTileShare ?? rival.tileShare ?? 0,
      );
      return targetShare >= 0.12 || incoming.has(rival.id.toLowerCase());
    })
    .sort((left, right) =>
      Number(right.action?.metadata?.targetTileShare ?? right.rival.tileShare ?? 0) -
      Number(left.action?.metadata?.targetTileShare ?? left.rival.tileShare ?? 0)
    );
  return marked(candidates[0]?.action ?? null, "nk1");
}

function chooseOdinRivalAction(actions, state, history, avoid) {
  const incoming = new Set(
    (state.self.allProtocolAttackerIDs || state.self.incomingAttackerIDs || [])
      .map((id) => String(id).toLowerCase()),
  );
  const grouped = new Map();
  for (const action of safeActions(actions, (candidate) =>
    candidate.kind === "attack" && !isNeutralExpansion(candidate)
  )) {
    const rival = rivalForAction(action, state);
    if (
      !rival ||
      rival.isAllied ||
      rivalIsK1Z(rival) ||
      (rivalIsProtected(state, history, rival) &&
        !incoming.has(rival.id.toLowerCase()))
    ) {
      continue;
    }
    const key = rival.id || rival.name;
    if (!grouped.has(key)) grouped.set(key, { rival, actions: [] });
    grouped.get(key).actions.push(action);
  }

  const previousTarget = [...history].reverse().find((entry) =>
    entry.kind === "attack" && targetName(entry)
  );
  const options = [...grouped.values()].map((option) => {
    const { rival } = option;
    const ratio = rival.relativeTroopRatio;
    if (!Number.isFinite(ratio)) return null;
    const isIncoming = incoming.has(rival.id.toLowerCase());
    const isLeader = rival.tileShare >= state.topRivalTileShare - 0.005 &&
      rival.tileShare > state.self.tileShare + 0.02;
    const finishable = ratio >= 1.5 &&
      rival.tileShare <= Math.max(0.08, state.self.tileShare * 0.6);
    const convertible = ratio >= 1.2;
    const pressure = ratio >= 0.85 && (isIncoming || isLeader);
    if (!finishable && !convertible && !pressure) return null;
    const desiredPercent = finishable ? 40 : convertible ? 25 : 10;
    const continuity = previousTarget &&
      targetName(previousTarget) === rival.name.toLowerCase() ? 0.75 : 0;
    const score = (finishable ? 100 : convertible ? 40 : 20) +
      ratio * 3 + rival.tileShare * 2 + (isIncoming ? 4 : 0) +
      (isLeader ? 1 : 0) + continuity;
    return { ...option, desiredPercent, finishable, isIncoming, score };
  }).filter(Boolean).sort((left, right) => right.score - left.score);

  const best = options[0];
  if (!best) return null;
  const action = pickPercent(best.actions, best.desiredPercent, avoid);
  const selectedPercent = actionPercent(action);
  return {
    action: marked(
      action,
      `odc${Math.round(selectedPercent ?? best.desiredPercent)}`,
    ),
    finishable: best.finishable,
    isIncoming: best.isIncoming,
  };
}

function neutralMarker(action) {
  const percent = actionPercent(action);
  return percent === null ? "odg10" : `odg${Math.round(percent)}`;
}

/**
 * ODC1: a small direct dispatcher for Odin.
 *
 * Unlike the historical qd2n chassis, this route preserves the live K1Z
 * contract, uses the proven neutral cadence, treats target continuity as a
 * bonus rather than a lock, and exits naval loops on measured non-progress.
 */
export function chooseOdinChassisAction(actions, state, _plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const avoid = new Set(avoidActionIDs(history));
  const spawn = safeActions(actions, (action) => action.kind === "spawn")
    .find((action) => !avoid.has(action.id));
  if (spawn) return spawn;

  const odinActions = odinProtectedActions(actions, state, history);
  const pendingHandshake = kingmakerAllianceAction(
    odinActions,
    state,
    history,
    { pendingOnly: true },
  );
  if (pendingHandshake) return pendingHandshake;

  const threatCount = Math.max(
    incomingThreatCount(state.self.incomingAttacks),
    (state.self.allProtocolAttackerIDs || []).length,
  );
  const collapsing = territoryCollapsing(state, history);
  if ((threatCount > 0 || collapsing) && state.self.troopRatio < 0.8) {
    const defense = chooseOdinBuild(odinActions, state, history, true);
    if (defense) return marked(defense, "odef");
  }

  const atomBomb = chooseOdinAtomBomb(odinActions, state, history);
  if (atomBomb) return atomBomb;

  const rival = chooseOdinRivalAction(odinActions, state, history, avoid);
  if (rival?.finishable || rival?.isIncoming) return rival.action;

  const economy = chooseOdinEconomy(odinActions, state, history);
  if (economy) return economy;

  const neutral = chooseNeutralAttack(odinActions, history, avoid);
  if (neutral && state.self.tileShare < 0.12 && threatCount === 0 && !collapsing) {
    return marked(neutral, neutralMarker(neutral));
  }

  if (rival?.action) return rival.action;
  if (neutral) return marked(neutral, neutralMarker(neutral));

  const build = chooseOdinBuild(odinActions, state, history);
  const stalledBoat = boatConversionStalled(state, history);
  if (!stalledBoat) {
    const boat = chooseBoat(odinActions, state, history, avoid, true);
    if (boat) {
      const percent = actionPercent(boat);
      return marked(boat, `odn${Math.round(percent ?? 16)}`);
    }
  }
  if (build) return marked(build, stalledBoat ? "odncap" : "odecon");

  const utility = chooseUtility(
    odinActions.filter((action) => action.kind !== "nuke"),
    state,
    null,
    history,
  );
  if (utility) return utility;

  const retreat = safeActions(odinActions, (action) =>
    action.kind === "boat_retreat" || action.kind === "retreat"
  )[0];
  if (retreat) return retreat;

  const emergencyAttacks = safeActions(odinActions, (action) => {
    if (action.kind !== "attack" || isNeutralExpansion(action)) return false;
    const target = rivalForAction(action, state);
    return target && !rivalIsProtected(state, history, target);
  });
  const pressureNeeded = threatCount > 0 || collapsing ||
    state.self.tileShare <= state.topRivalTileShare + 0.02;
  if (pressureNeeded) {
    const emergencyAttack = pickPercent(emergencyAttacks, 10, avoid);
    if (emergencyAttack) return marked(emergencyAttack, "odc10");
  }

  const pressure = safeActions(odinActions, (action) => action.kind === "target_player")
    .map((action) => ({ action, rival: rivalForAction(action, state) }))
    .filter(({ rival: target }) =>
      target && !rivalIsProtected(state, history, target)
    )
    .sort((left, right) => right.rival.tileShare - left.rival.tileShare)[0]?.action;
  if (pressure) return pressure;

  const coalition = kingmakerAllianceAction(odinActions, state, history);
  if (coalition) return coalition;

  const survivalAlliance = bestAllianceRequest(odinActions, state, history);
  if (survivalAlliance) return survivalAlliance;

  const harmlessSocial = safeActions(odinActions, (action) =>
    ["alliance_extend", "embargo_stop", "emoji"].includes(action.kind)
  )[0];
  if (harmlessSocial) return marked(harmlessSocial, "odsafe");

  const hold = odinActions.find((action) => action.kind === "hold");
  const alternatives = actions.filter((action) => action.kind !== "hold");
  const admissibleAlternativeIDs = new Set(
    odinActions
      .filter((action) => action.kind !== "hold")
      .map((action) => action.id),
  );
  const guardedOnly = alternatives.length > 0 && alternatives.every((action) => {
    if (!admissibleAlternativeIDs.has(action.id)) return true;
    if (action.kind === "build" && actionText(action).includes("defense post")) return true;
    const target = rivalForAction(action, state);
    return target && rivalIsProtected(state, history, target);
  });
  const dominantPreservation = threatCount === 0 && !collapsing &&
    state.self.tileShare >= 0.35 &&
    state.self.tileShare >= state.topRivalTileShare + 0.08 &&
    alternatives.length > 0 &&
    alternatives.every((action) => {
      if (action.kind !== "attack" || isNeutralExpansion(action)) return false;
      const target = rivalForAction(action, state);
      return target && Number.isFinite(target.relativeTroopRatio) &&
        target.relativeTroopRatio < 1;
    });
  if (hold) {
    return guardedOnly || dominantPreservation ? marked(hold, "odguard") : hold;
  }
  const finalSafe = odinActions.find((action) =>
    action.kind !== "quick_chat" &&
    action.kind !== "nuke" &&
    !(
      action.kind === "build" &&
      String(action?.metadata?.unit ?? "").toLowerCase() === "atom bomb"
    )
  );
  if (finalSafe) return finalSafe;
  throw new Error("ODC1 found no admissible legal action");
}
