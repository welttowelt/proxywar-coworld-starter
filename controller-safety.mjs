const freezeMember = ({ key, id, aliases }) => Object.freeze({
  key,
  id: id.toLowerCase(),
  aliases: Object.freeze(aliases.map(canonicalizePlayerName)),
});

/**
 * The complete protected fleet. Stable player IDs are the strongest signal;
 * aliases cover display-name rewriting by the game. Protection is
 * unconditional, including when every remaining rival is K1Z.
 */
export const K1Z_COALITION = Object.freeze([
  freezeMember({
    key: "katanasan",
    id: "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
    aliases: ["katanasan"],
  }),
  freezeMember({
    key: "gravity",
    id: "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
    aliases: ["gravity", "juryoku", "juryoku koku", "santai juryoku"],
  }),
  freezeMember({
    key: "hrafn",
    id: "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
    aliases: ["hrafn"],
  }),
  freezeMember({
    key: "mickey",
    id: "ply_e982e621-9ca3-47cd-8151-f57ee9d99421",
    aliases: ["mickey mouse", "mickey"],
  }),
]);

const MEMBER_BY_ID = new Map(K1Z_COALITION.map((member) => [member.id, member]));
const MEMBER_BY_ALIAS = new Map(
  K1Z_COALITION.flatMap((member) => member.aliases.map((alias) => [alias, member])),
);

const HARMFUL_KINDS = new Set([
  "attack",
  "land",
  "land_attack",
  "boat",
  "boat_attack",
  "nuke",
  "warship",
  "move_warship",
  "target",
  "target_player",
  "break_alliance",
  "alliance_reject",
  "reject_alliance",
  "embargo",
]);

const TARGET_ID_KEYS = Object.freeze([
  "targetID",
  "targetId",
  "target_id",
  "recipientID",
  "recipientId",
  "recipient_id",
]);

const TARGET_NAME_KEYS = Object.freeze([
  "targetName",
  "target_name",
  "recipientName",
  "recipient_name",
]);

export function canonicalizePlayerName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\[k1z\]|k1z)(?:\s+|$)/i, "")
    .toLowerCase();
}

function cleanID(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function firstMetadataValue(metadata, keys) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function playerID(player) {
  return cleanID(
    player?.id ?? player?.playerID ?? player?.playerId ?? player?.player_id ?? "",
  );
}

function playerName(player) {
  return canonicalizePlayerName(player?.name ?? player?.playerName ?? "");
}

function memberFromDirectSignals(id, name) {
  const byID = id ? MEMBER_BY_ID.get(cleanID(id)) ?? null : null;
  const byName = name ? MEMBER_BY_ALIAS.get(canonicalizePlayerName(name)) ?? null : null;
  return { byID, byName };
}

function identityForVisiblePlayer(player) {
  const id = playerID(player);
  const name = playerName(player);
  const { byID, byName } = memberFromDirectSignals(id, name);
  if (byID && byName && byID.key !== byName.key) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  const member = byID ?? byName;
  if (member) {
    return {
      resolved: true,
      conflict: false,
      member,
      key: `k1z:${member.key}`,
    };
  }
  if (id || name) {
    return {
      resolved: true,
      conflict: false,
      member: null,
      key: id ? `player:${id}` : `name:${name}`,
    };
  }
  return { resolved: false, conflict: false, member: null, key: null };
}

function exactVisibleByID(id, visiblePlayers) {
  if (!id) return null;
  return visiblePlayers.find((player) => playerID(player) === cleanID(id)) ?? null;
}

function exactVisibleByName(name, visiblePlayers) {
  const canonical = canonicalizePlayerName(name);
  if (!canonical) return null;
  const matches = visiblePlayers.filter((player) => playerName(player) === canonical);
  return matches.length === 1 ? matches[0] : null;
}

function signalFromID(id, visiblePlayers) {
  const cleaned = cleanID(id);
  if (!cleaned) return null;
  const member = MEMBER_BY_ID.get(cleaned);
  if (member) return { resolved: true, conflict: false, member, key: `k1z:${member.key}` };
  const visible = exactVisibleByID(cleaned, visiblePlayers);
  return visible ? identityForVisiblePlayer(visible) : null;
}

function signalFromName(name, visiblePlayers) {
  const canonical = canonicalizePlayerName(name);
  if (!canonical) return null;
  const member = MEMBER_BY_ALIAS.get(canonical);
  if (member) return { resolved: true, conflict: false, member, key: `k1z:${member.key}` };
  const visible = exactVisibleByName(canonical, visiblePlayers);
  return visible ? identityForVisiblePlayer(visible) : null;
}

function boundedTextContains(text, value) {
  if (!value) return false;
  return ` ${text} `.includes(` ${value} `);
}

function textVisibleSignals(action, visiblePlayers) {
  const text = canonicalizePlayerName(`${action?.id ?? ""} ${action?.label ?? ""}`);
  const matches = [];
  for (const player of visiblePlayers) {
    const id = playerID(player);
    const name = playerName(player);
    if ((id && String(action?.id ?? "").toLowerCase().includes(id)) ||
        boundedTextContains(text, name)) {
      matches.push(identityForVisiblePlayer(player));
    }
  }
  return matches;
}

/**
 * Resolve a player reference without substring aliases. Unknown raw IDs or
 * names are not considered resolved unless they match a visible player.
 */
export function resolveCoalitionIdentity(
  { id = "", name = "" } = {},
  visiblePlayers = [],
) {
  const idSignal = signalFromID(id, visiblePlayers);
  const nameSignal = signalFromName(name, visiblePlayers);
  const signals = [idSignal, nameSignal].filter(Boolean);
  if (signals.some((signal) => signal.conflict)) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  const keys = new Set(signals.filter((signal) => signal.resolved).map((signal) => signal.key));
  if (keys.size > 1) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  const signal = signals.find((candidate) => candidate.resolved) ?? null;
  return signal ?? { resolved: false, conflict: false, member: null, key: null };
}

function resolveActionTarget(action, visiblePlayers) {
  const metadata = action?.metadata ?? {};
  const rawID = firstMetadataValue(metadata, TARGET_ID_KEYS);
  const rawName = firstMetadataValue(metadata, TARGET_NAME_KEYS);
  const direct = resolveCoalitionIdentity({ id: rawID, name: rawName }, visiblePlayers);
  if (direct.conflict) return direct;

  const textSignals = textVisibleSignals(action, visiblePlayers)
    .filter((signal) => signal.resolved || signal.conflict);
  if (textSignals.some((signal) => signal.conflict)) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  const textKeys = new Set(textSignals.map((signal) => signal.key));
  if (textKeys.size > 1) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  const textSignal = textSignals[0] ?? null;
  if (direct.resolved && textSignal && direct.key !== textSignal.key) {
    return { resolved: false, conflict: true, member: null, key: null };
  }
  return direct.resolved
    ? direct
    : textSignal ?? { resolved: false, conflict: false, member: null, key: null };
}

function isNuclearBuild(action) {
  if (String(action?.kind ?? "").toLowerCase() !== "build") return false;
  const unit = canonicalizePlayerName(action?.metadata?.unit ?? "");
  const text = canonicalizePlayerName(`${action?.id ?? ""} ${action?.label ?? ""}`);
  return unit === "atom bomb" || unit === "nuke" ||
    boundedTextContains(text, "atom bomb") || boundedTextContains(text, "nuke");
}

function isNeutralTerritoryAction(action) {
  const kind = String(action?.kind ?? "").toLowerCase();
  if (!["attack", "land", "land_attack", "boat", "boat_attack"].includes(kind)) {
    return false;
  }
  const text = canonicalizePlayerName(`${action?.id ?? ""} ${action?.label ?? ""}`);
  return action?.metadata?.expansion === true || boundedTextContains(text, "terra nullius");
}

function classifyAction(action, visiblePlayers) {
  const kind = String(action?.kind ?? "").trim().toLowerCase();
  if (kind === "embargo_all") {
    return { safe: false, reason: "global-embargo-veto" };
  }
  const nuclearBuild = isNuclearBuild(action);
  const harmful = HARMFUL_KINDS.has(kind) || nuclearBuild;
  if (!harmful) return { safe: true, reason: "non-harmful" };

  const target = resolveActionTarget(action, visiblePlayers);
  if (target.conflict) {
    return { safe: false, reason: "conflicting-target-identity" };
  }
  if (isNeutralTerritoryAction(action) && !target.resolved) {
    return { safe: true, reason: "neutral-expansion" };
  }
  if (!target.resolved) {
    return { safe: false, reason: "unresolved-harmful-target" };
  }
  if (!target.member) {
    return { safe: true, reason: "resolved-outsider-target" };
  }
  return { safe: false, reason: `protected-k1z:${target.member.key}` };
}

function unwrapRanked(entry) {
  return entry?.action && typeof entry.action === "object" ? entry.action : entry;
}

function actionID(action) {
  return String(action?.id ?? "");
}

function safetyResult({ action, fallbackUsed, marker, mode, rerouted, rejectedActionIDs, reason }) {
  return { action, fallbackUsed, marker, mode, rerouted, rejectedActionIDs, reason };
}

/**
 * Final, single-pass policy boundary. Only offered actions can leave here.
 */
export function enforceSafety({ ranked = [], legalActions = [], observation = {}, state = {} } = {}) {
  void state;
  const mode = "normal";
  const visiblePlayers = Array.isArray(observation?.visiblePlayers)
    ? observation.visiblePlayers
    : [];
  const offeredByID = new Map();
  for (const action of legalActions) {
    const id = actionID(action);
    if (id && !offeredByID.has(id)) offeredByID.set(id, action);
  }

  const rejectedActionIDs = [];
  const seen = new Set();
  for (const entry of ranked) {
    const rankedAction = unwrapRanked(entry);
    const id = actionID(rankedAction);
    if (!id || seen.has(id) || !offeredByID.has(id)) continue;
    seen.add(id);
    const offered = offeredByID.get(id);
    // Hold is the fail-closed terminal action, never a ranked shortcut around
    // a later safe productive action.
    if (String(offered?.kind ?? "").toLowerCase() === "hold") continue;
    const verdict = classifyAction(offered, visiblePlayers);
    if (!verdict.safe) {
      rejectedActionIDs.push(id);
      continue;
    }
    const rerouted = rejectedActionIDs.length > 0;
    return safetyResult({
      action: offered,
      fallbackUsed: false,
      marker: rerouted ? "sv1" : null,
      mode,
      rerouted,
      rejectedActionIDs,
      reason: verdict.reason,
    });
  }

  const hold = legalActions.find((action) =>
    String(action?.kind ?? "").toLowerCase() === "hold"
  ) ?? null;
  return {
    action: hold,
    fallbackUsed: true,
    marker: "sv1",
    mode,
    rerouted: true,
    rejectedActionIDs,
    reason: hold ? "no-safe-ranked-action" : "no-safe-offered-action",
  };
}
