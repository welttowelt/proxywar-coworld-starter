export const lowRisk = Object.freeze({ level: "low" });

export function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

export function rival({
  id = "foe",
  name = "Foe",
  tileShare = 0.15,
  relativeTroopRatio = 1.5,
  sharesBorder = true,
  canAttack = true,
  isAllied = false,
  incomingAttack = false,
  isAlive = true,
  tilesOwned = 100000,
} = {}) {
  return {
    id,
    name,
    tileShare,
    tilesOwned,
    relativeTroopRatio,
    sharesBorder,
    canAttack,
    isAllied,
    incomingAttack,
    isAlive,
  };
}

export function observation({
  tileShare = 0.12,
  troopRatio = 1,
  tilesOwned = 120000,
  incomingAttacks = 0,
  incomingAttackPlayerIDs = [],
  rivals = [],
  unitCounts,
  gameMode = "FFA",
  phase = "active",
  alivePlayerCount,
  turnNumber = 1000,
} = {}) {
  return {
    gameMode,
    phase,
    turnNumber,
    ...(alivePlayerCount === undefined ? {} : { alivePlayerCount }),
    ownState: {
      tileShare,
      troopRatio,
      tilesOwned,
      troops: 500000,
      gold: 250000,
      incomingAttacks,
      ...(unitCounts === undefined ? {} : { unitCounts }),
    },
    combat: { incomingAttackPlayerIDs },
    visiblePlayers: rivals,
  };
}

export function attack(target, percent = 10, extraMetadata = {}) {
  return action(
    `attack:${target.id}:${percent}`,
    "attack",
    `Attack ${target.name} ${percent}%`,
    {
      targetID: target.id,
      targetName: target.name,
      troopPercent: percent,
      ...extraMetadata,
    },
  );
}

export function expand(percent = 35) {
  return action(
    `expand:terra-nullius:${percent}`,
    "attack",
    `Expand Terra Nullius ${percent}%`,
    { expansion: true, troopPercent: percent },
  );
}

export function neutralBoat(tile = 100, percent = 16) {
  return action(
    `boat:${tile}:${percent}`,
    "boat",
    `Boat to Terra Nullius ${percent}%`,
    {
      targetTile: tile,
      expansion: true,
      invasion: false,
      troopPercent: percent,
    },
  );
}

export function invasion(target, percent = 25) {
  return action(
    `boat:${target.id}:${percent}`,
    "boat",
    `Invade ${target.name} ${percent}%`,
    {
      targetID: target.id,
      targetName: target.name,
      expansion: false,
      invasion: true,
      troopPercent: percent,
    },
  );
}

export function build(unit) {
  return action(
    `build:${unit}:100`,
    "build",
    `Build ${unit}`,
    { unit },
  );
}

export function alliance(target, metadata = {}) {
  return action(
    `alliance:${target.id}`,
    "alliance_request",
    `Alliance with ${target.name}`,
    {
      recipientID: target.id,
      recipientName: target.name,
      ...metadata,
    },
  );
}

export function hold() {
  return action("hold", "hold", "Hold");
}
