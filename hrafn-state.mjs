export const HRAFN_PLAYER_ID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";

export const K1Z_MEMBERS = Object.freeze([
  {
    role: "king",
    priority: 3,
    id: "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    names: Object.freeze(["odin free"]),
  },
  {
    role: "spear",
    priority: 2,
    id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    names: Object.freeze(["katanasan"]),
  },
  {
    role: "shield",
    priority: 1,
    id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
    names: Object.freeze(["juryoku koku"]),
  },
]);

export const HRAFN_PHASES = Object.freeze({
  BOOT: "BOOT",
  EXPAND: "EXPAND",
  CONTEST: "CONTEST",
  RACE: "RACE",
  FINISH: "FINISH",
  ENDGAME: "ENDGAME",
  DEFENSE: "DEFENSE",
  RECOVERY: "RECOVERY",
});

const TARGET_ID_KEYS = Object.freeze([
  "targetID",
  "targetId",
  "targetPlayerID",
  "targetPlayerId",
  "recipientID",
  "recipientId",
  "playerID",
  "playerId",
]);

const TARGET_NAME_KEYS = Object.freeze([
  "targetName",
  "targetPlayerName",
  "recipientName",
  "playerName",
]);

export function hrafnActionTargetRawNames(action) {
  const metadata = action?.metadata ?? {};
  return [...new Set(
    TARGET_NAME_KEYS
      .map((key) => String(metadata[key] ?? "").trim())
      .filter(Boolean),
  )];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function canonicalizeHrafnName(value) {
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

export function hasLeadingK1ZTag(value) {
  return /^(?:\[k1z\]|k1z)(?:\s+|$)/i.test(
    String(value ?? "").normalize("NFKC").trim(),
  );
}

export function playerID(player) {
  return String(
    player?.id ??
    player?.playerID ??
    player?.playerId ??
    player?.player_id ??
    "",
  ).trim();
}

export function actionText(action) {
  return `${action?.id ?? ""} ${action?.label ?? ""}`.trim();
}

export function actionPercent(action) {
  const direct = optionalFiniteNumber(
    action?.metadata?.troopPercent ??
    action?.metadata?.commitmentPercent ??
    action?.troopPercent,
  );
  if (direct !== null) return direct;
  const match = String(action?.id ?? "").match(/:(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

export function isNeutralAction(action) {
  if (action?.kind !== "attack" && action?.kind !== "boat") return false;
  const metadata = action?.metadata ?? {};
  const identity = hrafnActionTargetIdentity(action);
  const hasPlayerTarget = identity.ids.length > 0 ||
    identity.names.some((name) => name !== "terra nullius");
  if (hasPlayerTarget || metadata.invasion === true) return false;

  const id = String(action?.id ?? "").toLowerCase();
  const explicitlyNeutral =
    metadata.expansion === true ||
    metadata.neutral === true ||
    metadata.isNeutral === true ||
    metadata.invasion === false ||
    identity.names.includes("terra nullius");
  if (action.kind === "attack") {
    return /^expand:terra-nullius:\d+(?:\.\d+)?$/.test(id) &&
      explicitlyNeutral;
  }
  return /^boat:\d+:\d+(?:\.\d+)?$/.test(id) && explicitlyNeutral;
}

export function buildUnit(action) {
  if (action?.kind !== "build") return null;
  const direct = String(
    action?.metadata?.unit ??
    action?.metadata?.unitType ??
    action?.metadata?.structure ??
    "",
  ).trim();
  const text = canonicalizeHrafnName(direct || actionText(action));
  for (const unit of [
    "city",
    "factory",
    "port",
    "sam launcher",
    "defense post",
    "missile silo",
  ]) {
    if (text.includes(unit)) return unit;
  }
  return direct ? canonicalizeHrafnName(direct) : null;
}

export function hrafnActionTargetIdentity(action) {
  const metadata = action?.metadata ?? {};
  const ids = TARGET_ID_KEYS
    .map((key) => String(metadata[key] ?? "").trim().toLowerCase())
    .filter(Boolean);
  const names = hrafnActionTargetRawNames(action)
    .map(canonicalizeHrafnName)
    .filter(Boolean);

  const id = String(action?.id ?? "");
  const targetFromID = (() => {
    if (action?.kind === "attack") {
      const match = id.match(/^attack:([^:]+):/i);
      return match?.[1] && match[1].toLowerCase() !== "terra-nullius"
        ? match[1]
        : null;
    }
    if (action?.kind === "boat") {
      const match = id.match(/^boat:([^:]+):/i);
      return match?.[1] && !/^\d+$/.test(match[1]) ? match[1] : null;
    }
    if (
      [
        "target_player",
        "nuke",
        "embargo",
        "break_alliance",
        "alliance_reject",
        "alliance_request",
        "alliance_extend",
        "donate_troops",
        "donate_gold",
      ].includes(action?.kind)
    ) {
      return id.split(":")[1] || null;
    }
    return null;
  })();
  if (targetFromID) {
    ids.push(targetFromID.trim().toLowerCase());
  }

  return {
    ids: [...new Set(ids)],
    names: [...new Set(names)],
  };
}

function mapVisiblePlayer(player) {
  const id = playerID(player);
  const name = String(player?.name ?? "").trim();
  return {
    id,
    name,
    canonicalName: canonicalizeHrafnName(name),
    isAlive: player?.isAlive,
    tileShare: optionalFiniteNumber(player?.tileShare),
    tilesOwned: optionalFiniteNumber(player?.tilesOwned ?? player?.tiles),
    troops: finiteNumber(player?.troops),
    relativeTroopRatio: finiteNumber(player?.relativeTroopRatio, NaN),
    sharesBorder: player?.sharesBorder === true,
    canAttack: player?.canAttack === true,
    isAllied: player?.isAllied === true,
    incomingAttack: player?.incomingAttack === true,
    relation: player?.relation,
  };
}

function collectIncomingAttackerIDs(observation, visiblePlayers) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      ids.add(value.trim().toLowerCase());
    }
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
    add(
      value.attackerID ??
      value.attackerId ??
      value.sourcePlayerID ??
      value.sourcePlayerId ??
      value.sourceID ??
      value.sourceId,
    );
  };

  visit(observation?.combat?.incomingAttackPlayerIDs);
  visit(observation?.combat?.incomingAttackerIDs);
  if (Array.isArray(observation?.ownState?.incomingAttacks)) {
    visit(observation.ownState.incomingAttacks);
  }
  for (const rival of visiblePlayers) {
    if (rival.incomingAttack && rival.id) ids.add(rival.id.toLowerCase());
  }
  return [...ids];
}

function normalizeUnitCounts(ownState) {
  const raw = ownState?.unitCounts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([unit, count]) => [
      canonicalizeHrafnName(unit),
      Math.max(0, Math.trunc(finiteNumber(count))),
    ]),
  );
}

export function buildHrafnChassisState(observation = {}, actions = []) {
  if (!Array.isArray(actions)) {
    throw new TypeError("legal actions must be an array");
  }
  const visibleSource = Array.isArray(observation?.visiblePlayers)
    ? observation.visiblePlayers
    : [];
  const visibleRaw = visibleSource.filter((player) =>
    player && typeof player === "object" && !Array.isArray(player)
  );
  const visiblePlayers = visibleRaw.map(mapVisiblePlayer);
  const rivals = visiblePlayers.filter((player) => player.isAlive !== false);
  const confirmedAliveRivals = visiblePlayers.filter((player) =>
    player.isAlive === true
  );
  const alivePlayerCount = Number.isSafeInteger(observation?.alivePlayerCount) &&
      observation.alivePlayerCount >= 1
    ? observation.alivePlayerCount
    : null;
  const own = observation?.ownState ?? {};
  const unitCountsObserved = Boolean(
    own.unitCounts &&
    typeof own.unitCounts === "object" &&
    !Array.isArray(own.unitCounts),
  );
  const incomingAttackerIDs = collectIncomingAttackerIDs(
    observation,
    visiblePlayers,
  );
  const incomingCount = Math.max(
    incomingAttackerIDs.length,
    Math.max(0, Math.trunc(finiteNumber(own.incomingAttacks))),
  );
  const actionIDs = actions.map((action) => String(action?.id ?? ""));

  return {
    gameMode: String(observation?.gameMode ?? "").trim(),
    phase: String(observation?.phase ?? "").trim(),
    turn: Math.max(
      0,
      Math.trunc(finiteNumber(observation?.turnNumber ?? observation?.turn)),
    ),
    alivePlayerCount,
    livenessComplete: visibleSource.length === visiblePlayers.length &&
      visiblePlayers.every((player) => typeof player.isAlive === "boolean"),
    visiblePlayers,
    rivals,
    confirmedAliveRivals,
    incomingAttackerIDs,
    incomingCount,
    own: {
      tileShare: finiteNumber(own.tileShare),
      tilesOwned: finiteNumber(own.tilesOwned ?? own.tiles),
      troopRatio: finiteNumber(own.troopRatio),
      troops: finiteNumber(own.troops),
      gold: finiteNumber(own.gold),
      isAlive: own.isAlive,
      unitCounts: normalizeUnitCounts(own),
      unitCountsObserved,
    },
    actions,
    legalActionIDs: new Set(actionIDs),
    actionGeneration: actionIDs.slice().sort().join("\u001f"),
  };
}

export function coalitionMemberForRival(rival) {
  if (!rival) return null;
  const id = String(rival.id ?? "").trim().toLowerCase();
  const name = canonicalizeHrafnName(rival.canonicalName ?? rival.name);
  return K1Z_MEMBERS.find((member) =>
    (id && member.id.toLowerCase() === id) ||
    member.names.some((candidate) =>
      canonicalizeHrafnName(candidate) === name
    )
  ) ?? null;
}

export function isK1ZRival(rival) {
  return coalitionMemberForRival(rival) !== null ||
    hasLeadingK1ZTag(rival?.name);
}

export function isProtectedRival(rival) {
  return rival?.isAllied === true || isK1ZRival(rival);
}

export function resolveHrafnActionTarget(action, state) {
  const identity = hrafnActionTargetIdentity(action);
  const text = String(actionText(action)).toLowerCase();
  const canonicalText = canonicalizeHrafnName(actionText(action));
  const paddedCanonicalText = ` ${canonicalText} `;
  const explicitMatches = [
    ...identity.ids.map((id) =>
      state.rivals.filter((rival) => rival.id.toLowerCase() === id)
    ),
    ...identity.names.map((name) =>
      state.rivals.filter((rival) => rival.canonicalName === name)
    ),
  ];
  if (explicitMatches.length > 0) {
    const everySignalIsUnique = explicitMatches.every((matches) =>
      matches.length === 1
    );
    const matched = new Set(
      explicitMatches.flat().map((rival) =>
        `${rival.id.toLowerCase()}\u001f${rival.canonicalName}`
      ),
    );
    if (everySignalIsUnique && matched.size === 1) {
      return {
        rival: explicitMatches[0][0],
        ambiguous: false,
        signaled: true,
      };
    }
    return {
      rival: null,
      ambiguous:
        explicitMatches.some((matches) => matches.length > 1) ||
        matched.size > 1,
      signaled: true,
    };
  }

  const textCandidates = state.rivals.filter((rival) => {
    const id = rival.id.toLowerCase();
    const name = rival.canonicalName;
    return Boolean(
      (id && text.includes(id)) ||
      (name && paddedCanonicalText.includes(` ${name} `))
    );
  });
  if (textCandidates.length === 1) {
    return {
      rival: textCandidates[0],
      ambiguous: false,
      signaled: true,
    };
  }
  return {
    rival: null,
    ambiguous: textCandidates.length > 1,
    signaled: textCandidates.length > 0,
  };
}

export function rivalForHrafnAction(action, state) {
  return resolveHrafnActionTarget(action, state).rival;
}

const K1Z_ENDGAME_NAMES = new Set(
  K1Z_MEMBERS.flatMap((member) =>
    member.names.map(canonicalizeHrafnName)
  ),
);

export function hasStrictK1ZEndgameProof(state) {
  if (
    String(state?.gameMode).toUpperCase() !== "FFA" ||
    String(state?.phase).toLowerCase() !== "active" ||
    !Number.isSafeInteger(state?.alivePlayerCount) ||
    state.alivePlayerCount < 2 ||
    state?.livenessComplete !== true ||
    !Array.isArray(state?.confirmedAliveRivals) ||
    state.confirmedAliveRivals.length < 1 ||
    state.alivePlayerCount !== state.confirmedAliveRivals.length + 1
  ) {
    return false;
  }

  const names = state.confirmedAliveRivals.map((rival) =>
    rival.canonicalName
  );
  const ids = state.confirmedAliveRivals.map((rival) =>
    String(rival.id ?? "").trim().toLowerCase()
  );
  if (new Set(names).size !== names.length) return false;
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return false;
  if (!state.confirmedAliveRivals.every((rival) =>
    rival.isAlive === true &&
    hasLeadingK1ZTag(rival.name) &&
    K1Z_ENDGAME_NAMES.has(rival.canonicalName)
  )) {
    return false;
  }
  return state.confirmedAliveRivals.some((rival) =>
    coalitionMemberForRival(rival)?.role === "king"
  );
}

export function createHrafnPersistentState(overrides = {}) {
  return {
    schemaVersion: 1,
    decisionCount: 0,
    bootNeutralCount: 0,
    selectedStructures: [],
    pendingStructures: {},
    primaryPreyID: null,
    primaryPreyName: null,
    primaryPreyAge: 0,
    neutralStallCount: 0,
    lastOwnTileShare: null,
    lastOwnTilesOwned: null,
    lastActionID: null,
    lastPrimaryMarker: null,
    lastEvidenceMarkers: [],
    lastTargetID: null,
    naval: {
      targetID: null,
      targetName: null,
      routeID: null,
      attempts: 0,
      noProgress: 0,
      blocked: false,
      capEscapeBuilds: 0,
      lastOwnTileShare: null,
      lastOwnTilesOwned: null,
      lastTargetTileShare: null,
      lastTargetTilesOwned: null,
    },
    recent: [],
    requestCache: [],
    ...overrides,
    naval: {
      targetID: null,
      targetName: null,
      routeID: null,
      attempts: 0,
      noProgress: 0,
      blocked: false,
      capEscapeBuilds: 0,
      lastOwnTileShare: null,
      lastOwnTilesOwned: null,
      lastTargetTileShare: null,
      lastTargetTilesOwned: null,
      ...(overrides.naval ?? {}),
    },
    selectedStructures: Array.isArray(overrides.selectedStructures)
      ? [...overrides.selectedStructures]
      : [],
    pendingStructures:
      overrides.pendingStructures &&
      typeof overrides.pendingStructures === "object" &&
      !Array.isArray(overrides.pendingStructures)
        ? { ...overrides.pendingStructures }
        : {},
    lastEvidenceMarkers: Array.isArray(overrides.lastEvidenceMarkers)
      ? [...overrides.lastEvidenceMarkers]
      : [],
    recent: Array.isArray(overrides.recent) ? [...overrides.recent] : [],
    requestCache: Array.isArray(overrides.requestCache)
      ? [...overrides.requestCache]
      : [],
  };
}
