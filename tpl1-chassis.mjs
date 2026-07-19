/**
 * tpl1 chassis: the complete template replacement selector.
 *
 * Not a v89 patch — a full selector built from the measured winner template:
 * grind neutral land at 25-40% through the opening, defer the first economy,
 * pivot on a zero-gain frontier, convert with boats and ratio-floored rival
 * attacks, keep one global coalition-request cadence, and cap upgrade loops.
 * The K1Z contract is enforced through the same strategy-engine machinery
 * (canonical names, pinned player IDs, metadata targets). Every v89 guard is
 * deliberately absent. Marker: tpl1 on grind picks; kp2 on coalition moves.
 */
import {
  actionPercent,
  avoidActionIDs,
  chooseAtomBomb,
  chooseBoat,
  chooseBuild,
  consecutive,
  decisionsSince,
  finiteNumber,
  hasReliableTacticalAction,
  incomingThreatCount,
  isNeutralExpansion,
  kingmakerAllianceAction,
  matchesKingmakerPartner,
  pickPercent,
  recentHostility,
  reciprocalPartners,
  rivalForAction,
  rivalIsProtected,
  safeActions,
  targetName,
} from "./strategy-engine.mjs";

const TPL1_OPENING_DECISIONS = 20;
const TPL1_OPENING_SHARE = 0.15;
const TPL1_FIRST_BUILD_DECISION = 40;
const TPL1_FIRST_BUILD_SHARE = 0.12;
const TPL1_UPGRADE_CAP = 8;
const TPL1_GRIND_CADENCE = [25, 35, 40];
const TPL1_L2_FLOOR = 1.67;
const GLOBAL_COALITION_COOLDOWN = 8;

function openingGrind(actions, history, avoid) {
  const candidates = safeActions(actions, isNeutralExpansion);
  if (candidates.length === 0) return null;
  const streak = consecutive(
    history,
    (entry) => entry.neutral === true && entry.kind === "attack",
  );
  const desired = TPL1_GRIND_CADENCE[Math.min(streak, TPL1_GRIND_CADENCE.length - 1)];
  const atLeastDesired = candidates.filter((action) => {
    const percent = actionPercent(action);
    return Number.isFinite(percent) && percent >= desired;
  });
  const selected = pickPercent(
    atLeastDesired.length > 0 ? atLeastDesired : candidates,
    desired,
    avoid,
  );
  return selected ? { ...selected, policyMarker: "tpl1" } : null;
}

function zeroGainNeutralStreak(history) {
  let streak = 0;
  for (let index = history.length - 1; index > 0; index--) {
    const current = history[index];
    if (current?.kind !== "attack" || current?.neutral !== true) break;
    const previousShare = finiteNumber(history[index - 1]?.tileShare, NaN);
    const currentShare = finiteNumber(current.tileShare, NaN);
    if (!Number.isFinite(currentShare) || !Number.isFinite(previousShare)) break;
    if (currentShare > previousShare + 0.000001) break;
    streak++;
  }
  return streak;
}

function rivalAttackAboveFloor(actions, state, history, avoid) {
  const candidates = safeActions(actions, (action) =>
    action.kind === "attack" && !isNeutralExpansion(action)
  );
  const options = [];
  for (const action of candidates) {
    const rival = rivalForAction(action, state);
    if (!rival || rivalIsProtected(state, history, rival)) continue;
    const ratio = rival.relativeTroopRatio;
    if (!Number.isFinite(ratio) || ratio < 1) continue;
    const retaliation = recentHostility(state, history, rival) > 0;
    const streak = consecutive(history, (entry) =>
      entry.kind === "attack" && targetName(entry) === rival.name.toLowerCase()
    );
    const finishing = streak >= 1 && ratio >= 1.5;
    const floorPercent = retaliation || finishing
      ? 0
      : Math.ceil((TPL1_L2_FLOOR / ratio) * 100);
    const percent = actionPercent(action);
    if (Number.isFinite(percent) && percent < floorPercent) continue;
    options.push({ action, ratio, tileShare: rival.tileShare });
  }
  options.sort((left, right) =>
    right.ratio - left.ratio || right.tileShare - left.tileShare
  );
  const best = options.find((option) => !avoid.has(option.action.id));
  return best?.action ?? null;
}

function coalitionRequest(actions, state, history) {
  const partners = reciprocalPartners(actions, state);
  const partnerOfferPending = safeActions(actions, (action) =>
    action.kind === "alliance_reject" &&
    partners.some((partner) => matchesKingmakerPartner(action, partner, state))
  ).length > 0;
  if (partnerOfferPending) {
    const accept = kingmakerAllianceAction(actions, state, history);
    if (accept) return accept;
  }
  const lastCoalitionRequest = decisionsSince(history, (entry) =>
    entry.kind === "alliance_request" && entry.policyMarker === "kp2"
  );
  if (
    lastCoalitionRequest < GLOBAL_COALITION_COOLDOWN &&
    hasReliableTacticalAction(actions)
  ) {
    return null;
  }
  return kingmakerAllianceAction(actions, state, history);
}

export function chooseTpl1Action(actions, state, plan = null, history = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("decision request had no legal actions");
  }
  const avoid = new Set(avoidActionIDs(history));
  const spawn = safeActions(actions, (action) => action.kind === "spawn")
    .find((action) => !avoid.has(action.id));
  if (spawn) return spawn;

  const threatCount = incomingThreatCount(state.self.incomingAttacks);
  const defensiveBuild = threatCount > 0 && state.self.troopRatio < 0.8
    ? chooseBuild(actions, history, true)
    : null;
  if (defensiveBuild) return defensiveBuild;

  // A genuine reverse handshake is always accepted on sight, before any grind.
  const pendingPartners = reciprocalPartners(actions, state);
  const partnerOfferPending = safeActions(actions, (action) =>
    action.kind === "alliance_reject" &&
    pendingPartners.some((partner) => matchesKingmakerPartner(action, partner, state))
  ).length > 0;
  if (partnerOfferPending) {
    const accept = kingmakerAllianceAction(actions, state, history);
    if (accept) return accept;
  }

  const activeDecisions = history.filter((entry) => entry.kind !== "spawn").length;
  const frontierStalled = zeroGainNeutralStreak(history) >= 2;
  const neutralAvailable = actions.some(isNeutralExpansion);
  const opening = activeDecisions < TPL1_OPENING_DECISIONS &&
    state.self.tileShare < TPL1_OPENING_SHARE && threatCount === 0;

  // The opening grind: nothing else fires while neutral land is profitable.
  if (opening && neutralAvailable && !frontierStalled) {
    const grind = openingGrind(actions, history, avoid);
    if (grind) return grind;
  }

  // The first economy is deferred until the land base exists.
  const builtAny = history.some((entry) => entry.kind === "build");
  if (
    !builtAny &&
    (activeDecisions >= TPL1_FIRST_BUILD_DECISION ||
      state.self.tileShare >= TPL1_FIRST_BUILD_SHARE)
  ) {
    const firstBuild = chooseBuild(actions, history);
    if (firstBuild) return firstBuild;
  }

  // Conversion: boats first (invasions at favorable ratios, then neutral),
  // then rival attacks that clear the L2 floor or are retaliatory/finishing.
  const boat = chooseBoat(actions, state, history, avoid, false, frontierStalled);
  if (boat) return boat;
  const rivalHit = rivalAttackAboveFloor(actions, state, history, avoid);
  if (rivalHit) return rivalHit;

  // The grind continues outside the opening while the frontier lives.
  if (!frontierStalled && neutralAvailable) {
    const grind = openingGrind(actions, history, avoid);
    if (grind) return grind;
  }

  // Coalition requests, capped at one per global cadence window.
  const coalition = coalitionRequest(actions, state, history);
  if (coalition) return coalition;

  // Economy cadence.
  const sinceBuild = decisionsSince(history, (entry) =>
    entry.kind === "build" || entry.kind === "upgrade_structure"
  );
  const build = chooseBuild(actions, history);
  if (build && sinceBuild >= 14) return build;

  // Nukes stay on the v89 nk1 gate (uncovered non-K1Z, 12%+ share).
  const atomBomb = chooseAtomBomb(actions, state, history);
  if (atomBomb) return atomBomb;

  // Upgrades are capped: the R516 stall cannot happen here.
  const upgradeStreak = consecutive(history, (entry) => entry.kind === "upgrade_structure");
  if (upgradeStreak < TPL1_UPGRADE_CAP) {
    const upgrade = safeActions(actions, (action) => action.kind === "upgrade_structure")
      .find((action) => !avoid.has(action.id));
    if (upgrade) return upgrade;
  }

  // Fallback: any unprotected tactical action; hold only when none exists.
  const fallback = safeActions(actions, (action) => {
    if (![
      "attack", "boat", "boat_retreat", "retreat", "build", "upgrade_structure",
      "warship", "move_warship", "nuke",
    ].includes(action.kind)) return false;
    const rival = rivalForAction(action, state);
    return !rival || !rivalIsProtected(state, history, rival);
  }).find((action) => !avoid.has(action.id));
  if (fallback) return fallback;

  return actions.find((action) => action.kind === "hold") ?? actions[0];
}
