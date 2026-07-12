export const WIRE_SALVAGE_MARKER = "[g4lga-v4rd:w1re]";

const SOCIAL_KINDS = new Set([
  "alliance_request",
  "alliance_extend",
  "alliance_reject",
  "break_alliance",
  "target_player",
  "embargo",
  "embargo_stop",
  "donate_gold",
  "donate_troops",
  "quick_chat",
  "emoji",
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function targetID(action) {
  const metadataTarget = action?.metadata?.targetID;
  if (typeof metadataTarget === "string" && metadataTarget !== "") {
    return metadataTarget;
  }
  const parts = String(action?.id ?? "").split(":");
  return parts[0] === "attack" ? parts[1] ?? null : null;
}

function troopPercent(action) {
  const metadataPercent = finiteNumber(action?.metadata?.troopPercent);
  if (metadataPercent !== null) return metadataPercent;
  const parts = String(action?.id ?? "").split(":");
  return ["attack", "expand", "boat"].includes(parts[0])
    ? finiteNumber(parts.at(-1))
    : null;
}

function lowRisk(action) {
  return action?.risk?.level !== "high";
}

function hostileAttack(action) {
  return action?.kind === "attack" && action?.metadata?.expansion !== true;
}

function safestSmallCommitment(actions) {
  return [...actions].sort((left, right) =>
    (troopPercent(left) ?? 100) - (troopPercent(right) ?? 100)
  )[0] ?? null;
}

function pressureSalvage(input) {
  const observation = input.observation;
  const ownState = observation?.ownState;
  if (!ownState?.isAlive) return null;
  const rivals = (observation.visiblePlayers ?? []).filter((player) =>
    player?.isAlive === true && player?.isTeammate !== true
  );
  if (rivals.length === 0) return null;
  const ranked = rivals
    .map((player) => ({ player, share: finiteNumber(player.tileShare) }))
    .filter((entry) => entry.share !== null)
    .sort((left, right) => right.share - left.share);
  const leader = ranked[0];
  const ownShare = finiteNumber(
    ownState.tileShare ?? observation.endgame?.ownTileShare,
  );
  const ratio = finiteNumber(leader?.player.relativeTroopRatio);
  const alivePlayers = finiteNumber(observation.alivePlayerCount) ?? rivals.length + 1;
  const multiwayWindow =
    alivePlayers >= 3 &&
    ownShare !== null &&
    leader !== undefined &&
    leader.share - ownShare >= 0.05 &&
    ownShare >= 0.2 &&
    ratio !== null &&
    ratio >= 0.9;
  const duelWindow =
    alivePlayers === 2 && ratio !== null && ratio >= 0.85;
  if (
    !leader ||
    (!multiwayWindow && !duelWindow) ||
    leader.player.canAttack !== true ||
    leader.player.isAllied === true ||
    (observation.combat?.incomingAttackPlayerIDs ?? []).length > 0
  ) {
    return null;
  }
  return (input.legalActions ?? []).find((action) =>
    hostileAttack(action) &&
    targetID(action) === leader.player.playerID &&
    troopPercent(action) === 10 &&
    lowRisk(action)
  ) ?? null;
}

function productiveFallback(input, decision) {
  const legalActions = input.legalActions ?? [];
  const byID = new Map(legalActions.map((action) => [action.id, action]));
  const knownBatchAction = (decision.actionIDs ?? [])
    .map((id) => byID.get(id))
    .find((action) =>
      action && action.kind !== "hold" && !SOCIAL_KINDS.has(action.kind) && lowRisk(action)
    );
  if (knownBatchAction) return knownBatchAction;

  const pressure = pressureSalvage(input);
  if (pressure) return pressure;

  const incoming = input.observation?.combat?.incomingAttackPlayerIDs ?? [];
  if (incoming.length > 0) {
    const retreat = legalActions.find((action) =>
      action.kind === "retreat" && lowRisk(action)
    );
    if (retreat) return retreat;
  }

  const boatRetreat = legalActions.find((action) =>
    action.kind === "boat_retreat" && lowRisk(action)
  );
  if (boatRetreat) return boatRetreat;

  const build = legalActions
    .filter((action) => action.kind === "build" && lowRisk(action))
    .sort((left, right) =>
      (finiteNumber(right.metadata?.economicValue) ?? 0) -
      (finiteNumber(left.metadata?.economicValue) ?? 0)
    )[0];
  if (build) return build;

  const neutralLand = safestSmallCommitment(legalActions.filter((action) =>
    action.kind === "attack" && action.metadata?.expansion === true && lowRisk(action)
  ));
  if (neutralLand) return neutralLand;

  const neutralBoat = safestSmallCommitment(legalActions.filter((action) =>
    action.kind === "boat" && lowRisk(action)
  ));
  if (neutralBoat) return neutralBoat;

  for (const kind of ["upgrade_structure", "warship", "move_warship", "delete_unit"]) {
    const action = legalActions.find((candidate) =>
      candidate.kind === kind && lowRisk(candidate)
    );
    if (action) return action;
  }

  return legalActions.find((action) =>
    action.kind !== "hold" && !SOCIAL_KINDS.has(action.kind) && lowRisk(action)
  ) ?? legalActions.find((action) => action.kind === "hold") ?? legalActions[0] ?? null;
}

export function applyWireSalvage(input, decision) {
  const legalIDs = new Set((input?.legalActions ?? []).map((action) => action.id));
  if (legalIDs.has(decision.actionID)) return decision;

  const replacement = productiveFallback(input, decision);
  if (!replacement) return decision;
  return {
    ...decision,
    actionID: replacement.id,
    actionIDs: undefined,
    reason:
      `${WIRE_SALVAGE_MARKER} unknown=${decision.actionID} ` +
      `replacement=${replacement.id}; ${decision.reason}`,
    metadata: {
      ...decision.metadata,
      wireSalvage: true,
    },
  };
}
