export const PARITY_PULSE_MARKER = "[hrafn-s4r:r1ft]";
export const LEADER_SEVER_MARKER = "[n1dh0ggr:s3vr]";

const MIN_OWN_TILE_SHARE = 0.2;
const MIN_LEADER_GAP = 0.08;
const MAX_LEADER_GAP = 0.22;
const MIN_RELATIVE_TROOP_RATIO = 0.9;
const COOLDOWN_DECISIONS = 2;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function actionTargetID(action) {
  const metadataTarget = action?.metadata?.targetID;
  if (typeof metadataTarget === "string" && metadataTarget !== "") {
    return metadataTarget;
  }
  const parts = String(action?.id ?? "").split(":");
  return ["attack", "break_alliance"].includes(parts[0])
    ? parts[1] ?? null
    : null;
}

function actionTroopPercent(action) {
  const metadataPercent = finiteNumber(action?.metadata?.troopPercent);
  if (metadataPercent !== null) return metadataPercent;
  const parts = String(action?.id ?? "").split(":");
  return parts[0] === "attack" ? finiteNumber(parts[2]) : null;
}

function isHostileAttack(action) {
  return action?.kind === "attack" && action?.metadata?.expansion !== true;
}

function recentLeaderAttack(observation, leaderID) {
  return (observation.recentDecisions ?? [])
    .slice(-COOLDOWN_DECISIONS)
    .some((recent) =>
      recent.accepted === true &&
      recent.actionKind === "attack" &&
      recent.expansion !== true &&
      (recent.targetID === leaderID ||
        String(recent.actionID ?? "").startsWith(`attack:${leaderID}:`))
    );
}

function markedDecision(decision, action, marker, mode, leader, gap, ratio) {
  return {
    ...decision,
    actionID: action.id,
    actionIDs: undefined,
    reason:
      `${marker} mode=${mode} leader=${leader.name} ` +
      `gap=${gap.toFixed(3)} ratio=${ratio.toFixed(3)} ` +
      `replaced=${decision.actionID}; ${decision.reason}`,
    metadata: {
      ...decision.metadata,
      leaderClamp: mode,
    },
  };
}

export function applyLeaderClamp(input, decision) {
  const observation = input?.observation;
  const ownState = observation?.ownState;
  if (!observation || !ownState?.isAlive) return decision;

  const livingRivals = (observation.visiblePlayers ?? []).filter((player) =>
    player?.isAlive === true && player?.isTeammate !== true
  );
  const alivePlayerCount = finiteNumber(observation.alivePlayerCount) ??
    livingRivals.length + 1;
  if (alivePlayerCount < 3 || livingRivals.length < 2) return decision;

  const leader = livingRivals
    .map((player) => ({ player, share: finiteNumber(player.tileShare) }))
    .filter((entry) => entry.share !== null)
    .sort((left, right) => right.share - left.share)[0];
  const ownTileShare = finiteNumber(
    ownState.tileShare ?? observation.endgame?.ownTileShare,
  );
  if (!leader || ownTileShare === null) return decision;

  const leaderGap = leader.share - ownTileShare;
  const relativeTroopRatio = finiteNumber(leader.player.relativeTroopRatio);
  if (
    ownTileShare < MIN_OWN_TILE_SHARE ||
    leaderGap < MIN_LEADER_GAP ||
    leaderGap > MAX_LEADER_GAP ||
    relativeTroopRatio === null ||
    relativeTroopRatio < MIN_RELATIVE_TROOP_RATIO ||
    (observation.combat?.incomingAttackPlayerIDs ?? []).length > 0
  ) {
    return decision;
  }

  const legalActions = input.legalActions ?? [];
  const selectedAction = legalActions.find((action) => action.id === decision.actionID);
  if (isHostileAttack(selectedAction)) return decision;

  if (leader.player.isAllied === true) {
    const sever = legalActions.find((action) =>
      action.kind === "break_alliance" &&
      actionTargetID(action) === leader.player.playerID &&
      action.risk?.level !== "high"
    );
    return sever
      ? markedDecision(
          decision,
          sever,
          LEADER_SEVER_MARKER,
          "sever",
          leader.player,
          leaderGap,
          relativeTroopRatio,
        )
      : decision;
  }

  if (
    leader.player.canAttack !== true ||
    recentLeaderAttack(observation, leader.player.playerID)
  ) {
    return decision;
  }
  const pulse = legalActions.find((action) =>
    isHostileAttack(action) &&
    actionTargetID(action) === leader.player.playerID &&
    actionTroopPercent(action) === 10 &&
    action.risk?.level !== "high"
  );
  return pulse
    ? markedDecision(
        decision,
        pulse,
        PARITY_PULSE_MARKER,
        "strike",
        leader.player,
        leaderGap,
        relativeTroopRatio,
      )
    : decision;
}
