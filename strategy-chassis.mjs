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
  avoidActionIDs,
  bestAllianceRequest,
  chooseBoat,
  chooseBuild,
  chooseNeutralAttack,
  chooseUtility,
  consecutive,
  decisionsSince,
  incomingThreatCount,
  isNeutralExpansion,
  pickPercent,
  recentHostility,
  rivalForAction,
  safeActions,
  territoryCollapsing,
} from "./strategy-engine.mjs";

export const GRIND_TROOP_FLOOR = 100000;
export const MIN_RIVAL_COMMIT = 25;
export const GRIND_CEILING = { Asia: 0.12, Pangaea: 0.12, World: 0.08, default: 0.1 };
export const FRESH_ATTACK_RATIO = 1.3;
export const CHASSIS_MARKERS = ["ch1", "ch2"];

function targetName(entry) {
  return String(entry?.targetName ?? "").toLowerCase();
}

function frontierStalled(history) {
  const grinds = history.filter((entry) => entry.kind === "attack" && entry.neutral === true);
  if (grinds.length < 4) return false;
  const latest = grinds[grinds.length - 1];
  const earlier = grinds[grinds.length - 4];
  return latest.tileShare - earlier.tileShare < 0.002;
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
  const isSticky = sticky != null;
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
    sticky: isSticky,
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

  const threatCount = incomingThreatCount(state.self.incomingAttacks);
  const collapsing = territoryCollapsing(state, history);
  const grindCeiling = GRIND_CEILING[state.mapFingerprint] ?? GRIND_CEILING.default;
  const opening = state.self.tileShare < grindCeiling && threatCount === 0 && !collapsing;
  const attackers = new Set(
    (state.self.incomingAttackerIDs || []).map((id) => String(id).toLowerCase()),
  );

  if (threatCount >= 2 && state.self.troopRatio < 0.8) {
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
    if (state.self.troops >= GRIND_TROOP_FLOOR && !frontierStalled(history)) {
      return { ...pickPercent(neutralActions, 35, new Set()), policyMarker: "ch1" };
    }
    const cadence = chooseNeutralAttack(actions, history, avoid);
    if (cadence) return cadence;
  }

  // Contact: finish a started target down to 1.0; fresh targets need 1.3.
  if (rivalAttack &&
    (rivalAttack.sticky || rivalAttack.rival.relativeTroopRatio >= FRESH_ATTACK_RATIO)) {
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

  const utility = chooseUtility(actions, plan, history);
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
