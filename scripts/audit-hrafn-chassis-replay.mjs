import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hrafnPublicKindCode,
  validateHrafnCapEscapeAttribution,
  validateHrafnMarkerSemantics,
} from "../hrafn-chassis.mjs";
import {
  K1Z_MEMBERS,
  canonicalizeHrafnName,
  hasLeadingK1ZTag,
  hrafnActionTargetRawNames,
  hrafnActionTargetIdentity,
  isNeutralAction,
} from "../hrafn-state.mjs";

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

const DONATION_KINDS = new Set(["donate_troops", "donate_gold"]);
const ALLIANCE_KINDS = new Set(["alliance_request", "alliance_extend"]);
const NUCLEAR_UNITS = new Set(["Atom Bomb", "Hydrogen Bomb"]);
const SUBMITTED_TYPES = new Map([
  ["spawn", "spawn"],
  ["attack", "attack"],
  ["build", "build_unit"],
  ["boat", "boat"],
  ["retreat", "cancel_attack"],
  ["boat_retreat", "cancel_boat"],
  ["upgrade_structure", "upgrade_structure"],
  ["warship", "build_unit"],
  ["move_warship", "move_warship"],
  ["alliance_request", "allianceRequest"],
  ["alliance_extend", "allianceExtension"],
  ["donate_troops", "donate_troops"],
  ["donate_gold", "donate_gold"],
  ["nuke", "build_unit"],
  ["target_player", "targetPlayer"],
  ["embargo", "embargo"],
  ["embargo_all", "embargo_all"],
  ["break_alliance", "breakAlliance"],
  ["alliance_reject", "allianceReject"],
]);

const INTENT_V5_POLICY_MARKERS = new Set([
  "k1z",
  "dn1",
  "vr1",
  "rv1",
  "rv2",
  "rv3",
  "wr1",
  "sk1",
]);
const INTENT_V5_REQUEST_MARKER = /^q[0-9a-f]{10}$/;

function targetIdentity(decision) {
  const metadata = decision?.selectedActionMetadata ?? {};
  const action = {
    id: decision?.selectedLegalActionId,
    kind: decision?.selectedActionKind,
    metadata,
  };
  const identity = hrafnActionTargetIdentity(action);
  const rawNames = hrafnActionTargetRawNames(action);
  return {
    ids: identity.ids,
    names: identity.names,
    rawNames,
    rawName: rawNames[0] ?? "",
  };
}

export function parseHrafnChassisReason(reason) {
  const raw = String(reason ?? "");
  const match = raw.match(
    /^\[K1Z\] r4vn:([a-z0-9]{3})(?::((?:q[0-9a-f]{10}|[a-z0-9]{1,6})(?:\.(?:q[0-9a-f]{10}|[a-z0-9]{1,6}))*))?$/,
  );
  if (!match) {
    return {
      valid: false,
      kindCode: null,
      primaryMarker: null,
      evidenceMarkers: [],
    };
  }
  const markers = match[2]?.split(".") ?? [];
  return {
    valid: true,
    kindCode: match[1],
    primaryMarker: markers[0] ?? null,
    evidenceMarkers: markers.slice(1),
  };
}

function validateIntentV5PublicReason(reason, parsed) {
  const raw = String(reason ?? "");
  const failures = [];
  if (!/^[\x20-\x7e]+$/.test(raw)) {
    failures.push("intent-v5 public reason must contain only printable ASCII");
  }
  if (raw.length > 48) {
    failures.push("intent-v5 public reason exceeds 48 characters");
  }
  if (!parsed.valid) {
    failures.push("malformed intent-v5 public reason");
    return { valid: false, failures };
  }

  const markers = [
    parsed.primaryMarker,
    ...parsed.evidenceMarkers,
  ].filter((marker) => marker !== null);
  const requestMarkerIndexes = markers.flatMap((marker, index) =>
    INTENT_V5_REQUEST_MARKER.test(marker) ? [index] : []
  );
  if (requestMarkerIndexes.length !== 1) {
    failures.push("intent-v5 requires exactly one request marker");
  } else if (requestMarkerIndexes[0] !== markers.length - 1) {
    failures.push("intent-v5 request marker must be final");
  }

  const policyMarkers = markers.filter((marker) =>
    INTENT_V5_POLICY_MARKERS.has(marker)
  );
  if (policyMarkers.length > 1) {
    failures.push("intent-v5 allows at most one exact-v5 policy marker");
  }
  const intentMarkers = markers.filter((marker) => marker === "hi1");
  if (intentMarkers.length > 1) {
    failures.push("intent-v5 allows at most one hi1 marker");
  }
  const unknownMarkers = markers.filter((marker) =>
    marker !== "hi1" &&
    !INTENT_V5_POLICY_MARKERS.has(marker) &&
    !INTENT_V5_REQUEST_MARKER.test(marker)
  );
  if (unknownMarkers.length > 0) {
    failures.push(
      `intent-v5 contains unknown marker: ${unknownMarkers.join(", ")}`,
    );
  }

  const requestMarker = markers.at(-1);
  const sequenceValid =
    (markers.length === 1 &&
      INTENT_V5_REQUEST_MARKER.test(markers[0])) ||
    (markers.length === 2 &&
      (markers[0] === "hi1" || INTENT_V5_POLICY_MARKERS.has(markers[0])) &&
      INTENT_V5_REQUEST_MARKER.test(requestMarker)) ||
    (markers.length === 3 &&
      INTENT_V5_POLICY_MARKERS.has(markers[0]) &&
      markers[1] === "hi1" &&
      INTENT_V5_REQUEST_MARKER.test(requestMarker));
  if (!sequenceValid) {
    failures.push("intent-v5 marker order is invalid");
  }

  return {
    valid: failures.length === 0,
    failures: [...new Set(failures)],
  };
}

function decisionAction(decision, parsed) {
  return {
    id: decision?.selectedLegalActionId,
    kind: decision?.selectedActionKind,
    label: decision?.selectedLegalActionId,
    metadata: decision?.selectedActionMetadata ?? {},
    policyMarker: parsed.primaryMarker,
    evidenceMarkers: parsed.evidenceMarkers,
  };
}

function replayPlayers(replay) {
  return [
    ...(Array.isArray(replay?.results?.players) ? replay.results.players : []),
    ...(Array.isArray(replay?.finalState?.players) ? replay.finalState.players : []),
  ];
}

function collectRuntimePlayerUniverse(replay) {
  const byID = new Map();
  const idless = [];
  for (const player of replayPlayers(replay)) {
    const canonicalName = canonicalizeHrafnName(
      player?.name ?? player?.username,
    );
    const id = String(
      player?.id ??
      player?.playerID ??
      player?.playerId ??
      "",
    ).trim().toLowerCase();
    if (!canonicalName && !id) continue;
    const rawName = String(player?.name ?? player?.username ?? "").trim();
    if (!id) {
      idless.push({ canonicalName, rawName });
      continue;
    }
    if (!byID.has(id)) {
      byID.set(id, {
        canonicalNames: new Set(),
        rawNames: new Set(),
        ids: new Set([id]),
      });
    }
    const entry = byID.get(id);
    if (canonicalName) entry.canonicalNames.add(canonicalName);
    if (rawName) entry.rawNames.add(rawName);
  }
  const universe = [...byID.values()].map((entry) => ({
    ...entry,
    canonicalName: entry.canonicalNames.size === 1
      ? [...entry.canonicalNames][0]
      : null,
    identityConflict: entry.canonicalNames.size > 1,
  }));
  for (const alias of idless) {
    const matches = universe.filter((entry) =>
      alias.canonicalName &&
      entry.canonicalNames.has(alias.canonicalName)
    );
    if (matches.length === 1) {
      if (alias.rawName) matches[0].rawNames.add(alias.rawName);
      continue;
    }
    if (matches.length > 1) continue;
    universe.push({
      canonicalName: alias.canonicalName,
      canonicalNames: new Set(
        alias.canonicalName ? [alias.canonicalName] : [],
      ),
      rawNames: new Set(alias.rawName ? [alias.rawName] : []),
      ids: new Set(),
      identityConflict: false,
    });
  }
  return {
    players: universe,
    conflicts: universe
      .filter((entry) => entry.identityConflict)
      .map((entry) => ({
        runtime_id: [...entry.ids][0] ?? null,
        canonical_names: [...entry.canonicalNames].sort(),
        raw_names: [...entry.rawNames].sort(),
      }))
      .sort((left, right) =>
        String(left.runtime_id).localeCompare(String(right.runtime_id))
      ),
  };
}

function resolveReplayTarget(target, universe) {
  const signalMatches = [
    ...target.ids.map((id) =>
      universe.filter((player) => player.ids.has(id))
    ),
    ...target.names.map((name) =>
      universe.filter((player) => player.canonicalNames.has(name))
    ),
  ];
  const everySignalIsUnique = signalMatches.length > 0 &&
    signalMatches.every((matches) =>
      matches.length === 1 && matches[0].identityConflict !== true
    );
  const matches = new Set(signalMatches.flat());
  return {
    player: everySignalIsUnique && matches.size === 1
      ? signalMatches[0][0]
      : null,
    ambiguous:
      signalMatches.some((entries) => entries.length > 1) ||
      matches.size > 1 ||
      [...matches].some((entry) => entry.identityConflict === true),
    signaled: signalMatches.length > 0,
  };
}

function runtimePlayerID(player) {
  return String(
    player?.id ??
    player?.playerID ??
    player?.playerId ??
    "",
  ).trim().toLowerCase();
}

function decisionRuntimePlayerID(decision) {
  return runtimePlayerID(decision?.auditBefore) ||
    runtimePlayerID(decision?.auditAfter);
}

function decisionRequestID(decision) {
  const directKeys = ["requestID", "requestId", "request_id"];
  for (const key of directKeys) {
    if (!Object.hasOwn(decision ?? {}, key)) continue;
    return typeof decision[key] === "string" &&
        decision[key].trim() === decision[key] &&
        decision[key].length > 0
      ? decision[key]
      : null;
  }
  try {
    const parsed = JSON.parse(decision?.rawLlmOutput);
    return typeof parsed?.requestID === "string" &&
        parsed.requestID.trim() === parsed.requestID &&
        parsed.requestID.length > 0
      ? parsed.requestID
      : null;
  } catch {
    return null;
  }
}

function validReplayTurn(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const WARSHIP_OWNER_ID_KEYS = Object.freeze([
  "ownerID",
  "ownerId",
  "ownerPlayerID",
  "ownerPlayerId",
  "playerID",
  "playerId",
]);

const WARSHIP_OWNER_NAME_KEYS = Object.freeze([
  "ownerName",
  "ownerPlayerName",
  "playerName",
]);

function moveWarshipOwnerIdentity(decision) {
  const metadata = decision?.selectedActionMetadata ?? {};
  return {
    ids: [...new Set(
      WARSHIP_OWNER_ID_KEYS
        .map((key) => String(metadata[key] ?? "").trim().toLowerCase())
        .filter(Boolean),
    )],
    names: [...new Set(
      WARSHIP_OWNER_NAME_KEYS
        .map((key) => canonicalizeHrafnName(metadata[key]))
        .filter(Boolean),
    )],
  };
}

function plannerDegradationIsFalse(decision) {
  if (decision?.llmPlannerDegraded === false) return true;
  if (decision?.externalPlannerCall === false) return true;
  try {
    return JSON.parse(decision?.rawLlmOutput)?.llmPlannerDegraded === false;
  } catch {
    return false;
  }
}

function submittedTargetID(intent) {
  return String(
    intent?.targetID ??
    intent?.targetId ??
    intent?.target ??
    intent?.recipientID ??
    intent?.recipientId ??
    intent?.recipient ??
    "",
  ).trim().toLowerCase();
}

function submittedEffectFailures(decision, selectedTarget, universe) {
  if (decision?.result?.accepted !== true) return [];
  const kind = decision?.selectedActionKind;
  const intent = decision?.result?.submittedIntent;
  if (kind === "hold") {
    return intent === null || intent === undefined
      ? []
      : ["hold unexpectedly produced a submitted intent"];
  }
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
    return ["accepted non-hold decision lacks submitted intent"];
  }
  const failures = [];
  const expectedType = SUBMITTED_TYPES.get(kind);
  if (!expectedType) {
    failures.push(
      `selected action kind ${String(kind)} has no submitted intent mapping`,
    );
  } else if (intent.type !== expectedType) {
    failures.push(
      `submitted intent type ${String(intent.type)} does not match ${expectedType}`,
    );
  }

  const selectedAction = {
    id: decision?.selectedLegalActionId,
    kind,
    metadata: decision?.selectedActionMetadata ?? {},
  };
  if (
    HARMFUL_KINDS.has(kind) &&
    isNeutralAction(selectedAction) &&
    submittedTargetID(intent)
  ) {
    failures.push("neutral selected action submitted a player target");
  }

  const metadata = decision?.selectedActionMetadata ?? {};
  if (kind === "spawn") {
    if (
      !Number.isFinite(Number(metadata.tile)) ||
      Number(intent.tile) !== Number(metadata.tile)
    ) {
      failures.push("submitted spawn tile does not match selected spawn tile");
    }
    return failures;
  }

  if (kind === "build" || kind === "warship") {
    const selectedUnit = String(metadata.unit ?? "");
    const selectedTile = Number(
      kind === "warship" || selectedUnit === "Port"
        ? metadata.targetTile ?? metadata.buildTile
        : metadata.buildTile ?? metadata.targetTile,
    );
    if (!selectedUnit || String(intent.unit ?? "") !== selectedUnit) {
      failures.push("submitted build unit does not match selected unit");
    }
    if (
      !Number.isFinite(selectedTile) ||
      !Number.isFinite(Number(intent.tile)) ||
      Number(intent.tile) !== selectedTile
    ) {
      failures.push("submitted build tile does not match selected target tile");
    }
    return failures;
  }

  if (kind === "boat") {
    const targetTile = Number(metadata.targetTile);
    const destination = Number(intent.dst);
    if (
      !Number.isFinite(targetTile) ||
      !Number.isFinite(destination) ||
      destination !== targetTile
    ) {
      failures.push("submitted boat destination does not match selected target tile");
    }
    if (
      !Number.isFinite(Number(metadata.troops)) ||
      !Number.isFinite(Number(intent.troops)) ||
      Number(intent.troops) !== Number(metadata.troops)
    ) {
      failures.push("submitted boat troops do not match selected troop count");
    }
    return failures;
  }

  if (kind === "boat_retreat") {
    const selectedUnitID = String(metadata.unitID ?? "");
    if (
      !selectedUnitID ||
      String(intent.unitID ?? "") !== selectedUnitID
    ) {
      failures.push("submitted boat retreat does not match selected unit");
    }
    return failures;
  }

  if (kind === "retreat") {
    const selectedAttackID = String(metadata.attackID ?? "");
    if (
      !selectedAttackID ||
      String(intent.attackID ?? "") !== selectedAttackID
    ) {
      failures.push("submitted retreat does not match selected attack");
    }
    return failures;
  }

  if (kind === "upgrade_structure") {
    const selectedUnit = String(metadata.unit ?? "");
    const selectedUnitID = String(metadata.unitID ?? "");
    if (!selectedUnit || String(intent.unit ?? "") !== selectedUnit) {
      failures.push("submitted upgrade unit does not match selected unit");
    }
    if (
      !selectedUnitID ||
      String(intent.unitId ?? "") !== selectedUnitID
    ) {
      failures.push("submitted upgrade ID does not match selected unit");
    }
    return failures;
  }

  if (kind === "move_warship") {
    const idMatch = String(decision?.selectedLegalActionId ?? "").match(
      /^move_warship:([^:]+):([^:]+)$/,
    );
    const selectedUnitID = idMatch?.[1] ?? "";
    const selectedTile = Number(metadata.targetTile ?? idMatch?.[2]);
    const submittedUnitIDs = Array.isArray(intent.unitIds)
      ? intent.unitIds.map((id) => String(id))
      : [];
    if (
      !selectedUnitID ||
      submittedUnitIDs.length !== 1 ||
      submittedUnitIDs[0] !== selectedUnitID
    ) {
      failures.push("submitted warship move does not match selected unit");
    }
    if (
      !Number.isFinite(selectedTile) ||
      !Number.isFinite(Number(intent.tile)) ||
      Number(intent.tile) !== selectedTile
    ) {
      failures.push("submitted warship destination does not match selected tile");
    }
    return failures;
  }

  if (kind === "nuke") {
    const selectedUnit = String(
      metadata.unit ?? "",
    );
    const submittedUnit = String(intent.unit ?? "");
    const targetTile = Number(metadata.targetTile);
    const submittedTile = Number(intent.tile);
    if (
      !NUCLEAR_UNITS.has(selectedUnit) ||
      submittedUnit !== selectedUnit
    ) {
      failures.push("submitted nuclear unit does not match selected nuclear unit");
    }
    if (
      !Number.isFinite(targetTile) ||
      !Number.isFinite(submittedTile) ||
      submittedTile !== targetTile
    ) {
      failures.push("submitted nuclear tile does not match selected target tile");
    }
    return failures;
  }

  if (kind === "attack") {
    if (
      !Number.isFinite(Number(metadata.troops)) ||
      !Number.isFinite(Number(intent.troops)) ||
      Number(intent.troops) !== Number(metadata.troops)
    ) {
      failures.push("submitted attack troops do not match selected troop count");
    }
  }

  const requiresPlayerTarget =
    (
      HARMFUL_KINDS.has(kind) &&
      kind !== "embargo_all" &&
      !isNeutralAction(selectedAction)
    ) ||
    DONATION_KINDS.has(kind) ||
    ALLIANCE_KINDS.has(kind);
  if (!requiresPlayerTarget) return failures;

  const actualTargetID = submittedTargetID(intent);
  if (!actualTargetID) {
    failures.push("submitted intent lacks player target");
    return failures;
  }
  const selectedResolution = resolveReplayTarget(selectedTarget, universe);
  const actualResolution = resolveReplayTarget(
    { ids: [actualTargetID], names: [] },
    universe,
  );
  if (!actualResolution.player) {
    failures.push("submitted intent player target does not resolve uniquely");
  } else if (
    !selectedResolution.player ||
    actualResolution.player !== selectedResolution.player
  ) {
    failures.push("submitted intent player target conflicts with selected action");
  }
  return failures;
}

function collectK1ZRuntimeIDs(replay) {
  const ids = new Set(
    K1Z_MEMBERS.map((member) => member.id.toLowerCase()),
  );
  const knownNames = new Set([
    ...K1Z_MEMBERS.flatMap((member) =>
      member.names.map(canonicalizeHrafnName)
    ),
    "hrafn",
  ]);
  for (const player of replayPlayers(replay)) {
    const name = String(player?.name ?? player?.username ?? "");
    const canonical = canonicalizeHrafnName(name);
    if (!knownNames.has(canonical) && !hasLeadingK1ZTag(name)) continue;
    const id = String(
      player?.id ??
      player?.playerID ??
      player?.playerId ??
      "",
    ).trim().toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}

function collectOdinRuntimeIDs(replay) {
  const odin = K1Z_MEMBERS.find((member) => member.role === "king");
  const names = new Set(odin.names.map(canonicalizeHrafnName));
  const ids = new Set([odin.id.toLowerCase()]);
  for (const player of replayPlayers(replay)) {
    const name = canonicalizeHrafnName(player?.name ?? player?.username);
    if (!names.has(name)) continue;
    const id = String(
      player?.id ??
      player?.playerID ??
      player?.playerId ??
      "",
    ).trim().toLowerCase();
    if (id) ids.add(id);
  }
  return { ids, names };
}

function legalActionWasFresh(decision) {
  const selected = String(decision?.selectedLegalActionId ?? "");
  return Array.isArray(decision?.legalActionIDs) &&
    decision.legalActionIDs.includes(selected);
}

function expectedLegalActionKind(id) {
  const value = String(id ?? "");
  if (value === "hold" || value.startsWith("hold:")) return "hold";
  if (value.startsWith("build:Warship:")) return "warship";
  if (/^build:(?:Atom Bomb|Hydrogen Bomb|MIRV):/.test(value)) return "nuke";
  if (value.startsWith("build:")) return "build";
  if (value.startsWith("move_warship:")) return "move_warship";
  if (value.startsWith("boat_retreat:")) return "boat_retreat";
  if (value.startsWith("retreat:")) return "retreat";
  if (value.startsWith("upgrade:")) return "upgrade_structure";
  if (value.startsWith("expand:") || value.startsWith("attack:")) {
    return "attack";
  }
  if (value.startsWith("boat:")) return "boat";
  if (value.startsWith("donate_troops:")) return "donate_troops";
  if (value.startsWith("donate_gold:")) return "donate_gold";
  if (value.startsWith("alliance_extend:")) return "alliance_extend";
  if (value.startsWith("alliance:")) return "alliance_request";
  if (value.startsWith("alliance_reject:")) return "alliance_reject";
  if (value.startsWith("target:")) return "target_player";
  if (value.startsWith("embargo_all:")) return "embargo_all";
  if (value.startsWith("embargo:")) return "embargo";
  if (value.startsWith("break_alliance:")) return "break_alliance";
  if (value.startsWith("quick_chat:")) return "quick_chat";
  if (value.startsWith("emoji:")) return "emoji";
  if (value.startsWith("spawn:")) return "spawn";
  return null;
}

function productiveLegalActionID(id) {
  return [
    /^build:/,
    /^upgrade:/,
    /^retreat:/,
    /^boat_retreat:/,
    /^move_warship:/,
    /^donate_troops:/,
    /^donate_gold:/,
  ].some((pattern) => pattern.test(String(id ?? "")));
}

function legalActionCoverage(decision) {
  const legalIDs = Array.isArray(decision?.legalActionIDs)
    ? [...new Set(
        decision.legalActionIDs.map((id) => String(id ?? "")).filter(Boolean),
      )]
    : [];
  const byKind = decision?.legalActionIDsByKind;
  const byKindEntries = byKind && typeof byKind === "object" &&
      !Array.isArray(byKind)
    ? Object.entries(byKind)
    : [];
  const flattened = [...new Set(byKindEntries.flatMap(([, ids]) =>
    Array.isArray(ids)
      ? ids.map((id) => String(id ?? "")).filter(Boolean)
      : ["<invalid-kind-list>"]
  ))];
  const legalSet = new Set(legalIDs);
  const flattenedSet = new Set(flattened);
  const kindAssignments = new Map();
  const misbucketed = [];
  let invalidKindLists = false;
  for (const [kind, ids] of byKindEntries) {
    if (!Array.isArray(ids)) {
      invalidKindLists = true;
      continue;
    }
    for (const rawID of ids) {
      const id = String(rawID ?? "");
      if (!id) continue;
      if (!kindAssignments.has(id)) kindAssignments.set(id, []);
      kindAssignments.get(id).push(kind);
      const expectedKind = expectedLegalActionKind(id);
      if (expectedKind && expectedKind !== kind) {
        misbucketed.push({
          action_id: id,
          declared_kind: kind,
          expected_kind: expectedKind,
        });
      }
    }
  }
  const duplicateAssignments = [...kindAssignments.entries()]
    .filter(([, kinds]) => kinds.length !== 1)
    .map(([id, kinds]) => ({ action_id: id, declared_kinds: kinds }));
  const complete = legalIDs.length > 0 &&
    byKindEntries.length > 0 &&
    !invalidKindLists &&
    legalSet.size === flattenedSet.size &&
    [...legalSet].every((id) =>
      flattenedSet.has(id) && kindAssignments.get(id)?.length === 1
    ) &&
    misbucketed.length === 0 &&
    duplicateAssignments.length === 0;
  const selected = String(decision?.selectedLegalActionId ?? "");
  const nonHoldIDs = legalIDs.filter((id) =>
    id !== selected && id !== "hold"
  );
  return {
    complete,
    nonHoldIDs,
    productiveIDs: nonHoldIDs.filter(productiveLegalActionID),
    misbucketed,
    duplicateAssignments,
    nonHoldKinds: byKindEntries
      .filter(([kind, ids]) =>
        kind !== "hold" && Array.isArray(ids) && ids.length > 0
      )
      .map(([kind]) => kind),
  };
}

function navalCapHoldProof(decision, coverage) {
  if (!coverage.complete) return null;
  const byKind = decision?.legalActionIDsByKind ?? {};
  const productiveKinds = new Set([
    "build",
    "upgrade_structure",
    "retreat",
    "boat_retreat",
    "warship",
    "move_warship",
    "donate_troops",
    "donate_gold",
  ]);
  const offeredProductiveKinds = coverage.nonHoldKinds.filter((kind) =>
    productiveKinds.has(kind)
  );
  const neutralLandIDs = coverage.nonHoldIDs.filter((id) =>
    id.startsWith("expand:")
  );
  const hostileAttackIDs = Array.isArray(byKind.attack)
    ? byKind.attack.filter((id) => !String(id).startsWith("expand:"))
    : [];
  const conversion =
    decision?.tacticalAffordances?.frontierConversionTiming;
  const hostileEvidenceComplete =
    hostileAttackIDs.length === 0 ||
    (
      Number.isInteger(conversion?.hostileAttackActionCount) &&
      conversion.hostileAttackActionCount === hostileAttackIDs.length &&
      Number.isInteger(conversion?.favorableHostileAttackActionCount) &&
      conversion.favorableHostileAttackActionCount === 0
    );
  if (
    offeredProductiveKinds.length > 0 ||
    coverage.productiveIDs.length > 0 ||
    neutralLandIDs.length > 0 ||
    !hostileEvidenceComplete
  ) {
    return null;
  }
  return {
    proof: "naval cap recovery menu exhausted",
    offered_productive_kinds: offeredProductiveKinds,
    offered_productive_ids: coverage.productiveIDs,
    neutral_land_ids: neutralLandIDs,
    hostile_attack_ids: hostileAttackIDs,
    favorable_hostile_attack_count:
      conversion?.favorableHostileAttackActionCount ?? null,
  };
}

export function auditHrafnChassisReplay(
  replay,
  replayBytes = null,
  options = {},
) {
  const markerProfile = options.markerProfile ?? "clean-chassis";
  if (!["clean-chassis", "intent-v5"].includes(markerProfile)) {
    throw new Error(`unknown Hrafn marker profile: ${markerProfile}`);
  }
  const rawDecisions = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof rawDecisions !== "string") {
    throw new Error("replay does not contain inline decisions.jsonl");
  }
  const decisions = rawDecisions
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const tagged = decisions.filter((decision) =>
    String(decision?.reason ?? "").startsWith("[K1Z] r4vn:")
  );
  const named = decisions.filter((decision) =>
    canonicalizeHrafnName(decision?.username) === "hrafn" &&
    !(
      decision?.externalActionCall === false &&
      decision?.actionSelectionSource === "deterministic-spawn"
    )
  );
  const rosterHrafn = replayPlayers(replay).filter((player) =>
    canonicalizeHrafnName(player?.name ?? player?.username) === "hrafn"
  );
  const rosterHrafnIDs = new Set(
    rosterHrafn.map(runtimePlayerID).filter(Boolean),
  );
  const decisionHrafnIDs = new Set(
    named.map(decisionRuntimePlayerID).filter(Boolean),
  );
  const identityBound =
    named.length > 0 &&
    named.every((decision) => Boolean(decisionRuntimePlayerID(decision))) &&
    rosterHrafnIDs.size === 1 &&
    decisionHrafnIDs.size === 1 &&
    [...decisionHrafnIDs][0] === [...rosterHrafnIDs][0];
  const policyDecisions = named;
  const foreignTaggedDecisions = tagged.filter((decision) =>
    canonicalizeHrafnName(decision?.username) !== "hrafn"
  );
  const k1zRuntimeIDs = collectK1ZRuntimeIDs(replay);
  const odinRuntime = collectOdinRuntimeIDs(replay);
  const runtimeIdentities = collectRuntimePlayerUniverse(replay);
  const runtimePlayerUniverse = runtimeIdentities.players;
  const identityVerified =
    identityBound && runtimeIdentities.conflicts.length === 0;
  const knownK1ZNames = new Set([
    ...K1Z_MEMBERS.flatMap((member) =>
      member.names.map(canonicalizeHrafnName)
    ),
    "hrafn",
  ]);

  const markerCounts = {};
  const markerFailures = [];
  const publicReasonFailures = [];
  const freshnessFailures = [];
  const harmfulK1ZActions = [];
  const harmTargetFailures = [];
  const effectConsistencyFailures = [];
  const unexplainedHolds = [];
  const explainedHolds = [];
  const verifiedHolds = [];
  const holdEvidenceGaps = [];
  const capAntecedentFailures = [];
  const navalLaunchFailures = [];
  const capEscapeBuildBoundFailures = [];
  const capEscapeOwnerFailures = [];
  const capEscapeOwnerRows = [];
  const capEscapeAttributionFailures = [];
  const capEscapeAttributionRows = [];
  const extraSemanticFailures = new Map();
  const addExtraSemanticFailure = (analysis, failure) => {
    if (!extraSemanticFailures.has(analysis)) {
      extraSemanticFailures.set(analysis, []);
    }
    extraSemanticFailures.get(analysis).push(failure);
  };
  const decisionAnalyses = policyDecisions.map((decision, jsonlIndex) => {
    const parsed = parseHrafnChassisReason(decision.reason);
    const action = decisionAction(decision, parsed);
    const intentV5Reason = markerProfile === "intent-v5"
      ? validateIntentV5PublicReason(decision.reason, parsed)
      : null;
    const semantic = markerProfile === "intent-v5"
      ? intentV5Reason
      : validateHrafnMarkerSemantics(action, {
          requirePrimary: decision.selectedActionKind !== "spawn",
        });
    const target = targetIdentity(decision);
    const effectFailures = submittedEffectFailures(
      decision,
      target,
      runtimePlayerUniverse,
    );
    const expectedKindCode = hrafnPublicKindCode(
      decision.selectedActionKind,
    );
    return {
      decision,
      jsonlIndex,
      parsed,
      action,
      semantic,
      target,
      effectFailures,
      expectedKindCode,
      intentV5Reason,
      publicKindMatches:
        parsed.valid && parsed.kindCode === expectedKindCode,
      fresh: legalActionWasFresh(decision),
      turn: decision.turnNumber,
      requestID: decisionRequestID(decision),
    };
  });
  const chronological = (analyses) =>
    [...analyses].sort((left, right) => {
      const leftValid = validReplayTurn(left.turn);
      const rightValid = validReplayTurn(right.turn);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && left.turn !== right.turn) {
        return left.turn - right.turn;
      }
      return String(left.requestID ?? "").localeCompare(
        String(right.requestID ?? ""),
      ) || left.jsonlIndex - right.jsonlIndex;
    });
  const hks1Analyses = chronological(
    decisionAnalyses.filter((analysis) =>
      analysis.parsed.primaryMarker === "hks1"
    ),
  );
  const capAuditActive = hks1Analyses.length > 0;
  const launchCandidates = capAuditActive
    ? chronological(decisionAnalyses.filter((analysis) =>
        analysis.decision?.result?.accepted === true &&
        (
          analysis.parsed.primaryMarker === "hn16" ||
          analysis.parsed.primaryMarker === "hni25"
        ) &&
        analysis.semantic.valid &&
        analysis.publicKindMatches &&
        analysis.effectFailures.length === 0 &&
        analysis.fresh
      ))
    : [];
  const acceptedNavalLaunchAnalyses = [];
  const seenLaunchTurns = new Set();
  const seenLaunchRequests = new Set();
  for (const analysis of launchCandidates) {
    const reach = {
      turn: analysis.turn ?? null,
      request_id: analysis.requestID,
      action_id: analysis.decision.selectedLegalActionId ?? null,
      marker: analysis.parsed.primaryMarker,
    };
    const failures = [];
    if (!validReplayTurn(analysis.turn)) {
      failures.push("accepted naval launch requires a nonnegative safe-integer turn");
    }
    if (!analysis.requestID) {
      failures.push("accepted naval launch requires a nonblank request ID");
    }
    if (validReplayTurn(analysis.turn) && seenLaunchTurns.has(analysis.turn)) {
      failures.push("duplicate accepted naval launch turn");
    }
    if (
      analysis.requestID &&
      seenLaunchRequests.has(analysis.requestID)
    ) {
      failures.push("duplicate accepted naval launch request");
    }
    if (failures.length > 0) {
      for (const failure of failures) {
        navalLaunchFailures.push({ ...reach, failure });
        addExtraSemanticFailure(analysis, failure);
      }
      continue;
    }
    seenLaunchTurns.add(analysis.turn);
    seenLaunchRequests.add(analysis.requestID);
    acceptedNavalLaunchAnalyses.push(analysis);
  }
  for (
    let index = 2;
    index < acceptedNavalLaunchAnalyses.length;
    index += 1
  ) {
    const analysis = acceptedNavalLaunchAnalyses[index];
    const failure = "C3 permits at most two accepted naval launches";
    navalLaunchFailures.push({
      turn: analysis.turn,
      request_id: analysis.requestID,
      action_id: analysis.decision.selectedLegalActionId ?? null,
      marker: analysis.parsed.primaryMarker,
      launch_number: index + 1,
      failure,
    });
    addExtraSemanticFailure(analysis, failure);
  }
  const acceptedNavalLaunchTurns = acceptedNavalLaunchAnalyses.map(
    (analysis) => analysis.turn,
  );
  const acceptedNavalLaunches = acceptedNavalLaunchAnalyses.length;
  const capAntecedentFirstTurn = acceptedNavalLaunches >= 2
    ? acceptedNavalLaunchAnalyses[1].turn
    : null;
  const hks1BuildAnalyses = hks1Analyses.filter((analysis) =>
    analysis.decision.selectedActionKind === "warship"
  );
  const hks1MoveAnalyses = hks1Analyses.filter((analysis) =>
    analysis.decision.selectedActionKind === "move_warship"
  );
  const hks1Builds = hks1BuildAnalyses.length;
  const acceptedHks1Builds = hks1BuildAnalyses.filter((analysis) =>
    analysis.decision?.result?.accepted === true
  ).length;
  const hks1Moves = hks1MoveAnalyses.length;
  const acceptedHks1Moves = hks1MoveAnalyses.filter((analysis) =>
    analysis.decision?.result?.accepted === true
  ).length;
  for (const [index, analysis] of hks1BuildAnalyses.entries()) {
    if (index === 0) continue;
    const failure = "C3 permits at most one hks1 Warship build";
    const row = {
      turn: analysis.turn ?? null,
      request_id: analysis.requestID,
      action_id: analysis.decision.selectedLegalActionId ?? null,
      kind: analysis.decision.selectedActionKind ?? null,
      build_number: index + 1,
      failure,
    };
    capEscapeBuildBoundFailures.push(row);
    addExtraSemanticFailure(analysis, failure);
  }
  for (const analysis of hks1Analyses) {
    const reach = {
      turn: analysis.turn ?? null,
      request_id: analysis.requestID,
      action_id: analysis.decision.selectedLegalActionId ?? null,
      kind: analysis.decision.selectedActionKind ?? null,
    };
    const attribution = validateHrafnCapEscapeAttribution(analysis.action);
    capEscapeAttributionRows.push({
      ...reach,
      available: !attribution.valid,
      keys: attribution.keys,
    });
    if (!attribution.valid) {
      capEscapeAttributionFailures.push({
        ...reach,
        keys: attribution.keys,
        failure: attribution.failures[0],
      });
    }
    if (analysis.decision.selectedActionKind === "move_warship") {
      const owner = moveWarshipOwnerIdentity(analysis.decision);
      const available = owner.ids.length > 0 || owner.names.length > 0;
      const row = {
        ...reach,
        available,
        owner_ids: owner.ids,
        owner_names: owner.names,
        resolution: "unavailable",
      };
      if (available) {
        const resolution = resolveReplayTarget(owner, runtimePlayerUniverse);
        const resolvedIDs = resolution.player
          ? [...resolution.player.ids]
          : [];
        const resolvesToHrafn =
          resolution.player !== null &&
          resolvedIDs.some((id) => rosterHrafnIDs.has(id));
        row.resolution = !resolution.player
          ? resolution.ambiguous
            ? "ambiguous"
            : "unresolved"
          : resolvesToHrafn
            ? "hrafn"
            : "non_hrafn";
        const ownerFailure =
          "hks1 forbids available move_warship owner attribution even if it could resolve uniquely to Hrafn";
        capEscapeOwnerFailures.push({
          ...reach,
          owner_ids: owner.ids,
          owner_names: owner.names,
          failure: ownerFailure,
        });
        addExtraSemanticFailure(analysis, ownerFailure);
      }
      capEscapeOwnerRows.push(row);
    }
    const reachFailures = [];
    if (!validReplayTurn(analysis.turn)) {
      reachFailures.push("hks1 requires a nonnegative safe-integer turn");
    }
    if (!analysis.requestID) {
      reachFailures.push("hks1 requires a nonblank request ID");
    }
    if (validReplayTurn(analysis.turn)) {
      const priorLaunches = acceptedNavalLaunchAnalyses.filter(
        (launch) => launch.turn < analysis.turn,
      );
      const priorLaunchFailures = navalLaunchFailures.filter((failure) =>
        failure.turn === null ||
        !validReplayTurn(failure.turn) ||
        failure.turn < analysis.turn
      );
      if (
        priorLaunches.length !== 2 ||
        priorLaunchFailures.length > 0
      ) {
        reachFailures.push(
          "hks1 requires an independent naval cap antecedent from exactly two distinct valid prior accepted hn16 or hni25 launches and must follow the second accepted naval launch by turn",
        );
      }
    }
    for (const failure of reachFailures) {
      capAntecedentFailures.push({
        ...reach,
        accepted_naval_launches_before: validReplayTurn(analysis.turn)
          ? acceptedNavalLaunchAnalyses.filter((launch) =>
              launch.turn < analysis.turn
            ).length
          : null,
        failure,
      });
      addExtraSemanticFailure(analysis, failure);
    }
  }
  const reachRow = (analysis) => ({
    turn: analysis.turn ?? null,
    action_id: analysis.decision.selectedLegalActionId ?? null,
    kind: analysis.decision.selectedActionKind ?? null,
  });
  const hks1FirstReach = hks1Analyses.length > 0
    ? reachRow(hks1Analyses[0])
    : null;
  const acceptedHks1Analysis = hks1Analyses.find((analysis) =>
    analysis.decision?.result?.accepted === true &&
    analysis.semantic.valid &&
    (extraSemanticFailures.get(analysis) ?? []).length === 0 &&
    analysis.publicKindMatches &&
    String(analysis.decision.reason).length <= 48 &&
    analysis.effectFailures.length === 0 &&
    analysis.fresh &&
    validReplayTurn(analysis.turn) &&
    Boolean(analysis.requestID)
  );
  const acceptedHks1FirstReach = acceptedHks1Analysis
    ? reachRow(acceptedHks1Analysis)
    : null;

  for (const analysis of decisionAnalyses) {
    const {
      decision,
      parsed,
      action,
      semantic,
      target,
      effectFailures,
      expectedKindCode,
      intentV5Reason,
      publicKindMatches,
    } = analysis;
    const publicReasonValid = markerProfile === "intent-v5"
      ? intentV5Reason.valid
      : parsed.valid && String(decision.reason).length <= 48;
    if (!publicReasonValid) {
      publicReasonFailures.push({
        turn: decision.turnNumber ?? null,
        reason: decision.reason ?? null,
        failure: markerProfile === "intent-v5"
          ? intentV5Reason.failures.join("; ")
          : "malformed public reason",
      });
    } else {
      if (parsed.kindCode !== expectedKindCode) {
        publicReasonFailures.push({
          turn: decision.turnNumber ?? null,
          reason: decision.reason ?? null,
          failure:
            `public kind ${parsed.kindCode} does not match ${expectedKindCode}`,
        });
      }
    }
    if (parsed.primaryMarker) {
      markerCounts[parsed.primaryMarker] =
        (markerCounts[parsed.primaryMarker] ?? 0) + 1;
    }
    for (const evidence of parsed.evidenceMarkers) {
      markerCounts[evidence] = (markerCounts[evidence] ?? 0) + 1;
    }

    const semanticFailures = [
      ...semantic.failures,
      ...(extraSemanticFailures.get(analysis) ?? []),
    ];
    if (effectFailures.length > 0) {
      effectConsistencyFailures.push({
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
        failures: effectFailures,
      });
    }
    if (
      parsed.primaryMarker === "hkf1" &&
      DONATION_KINDS.has(decision.selectedActionKind) &&
      !target.ids.some((id) => odinRuntime.ids.has(id)) &&
      !target.names.some((name) => odinRuntime.names.has(name))
    ) {
      semanticFailures.push("hkf1 donation requires a resolved Odin target");
    }
    if (
      parsed.primaryMarker === "hka1" &&
      !target.ids.some((id) => k1zRuntimeIDs.has(id)) &&
      !target.names.some((name) => knownK1ZNames.has(name))
    ) {
      semanticFailures.push("hka1 requires a resolved K1Z target");
    }
    if (semanticFailures.length > 0) {
      markerFailures.push({
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
        primary_marker: parsed.primaryMarker,
        evidence_markers: parsed.evidenceMarkers,
        failures: semanticFailures,
      });
    }

    if (!legalActionWasFresh(decision)) {
      freshnessFailures.push({
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
      });
    }

    const isHold = decision.selectedActionKind === "hold" ||
      String(decision.selectedLegalActionId).startsWith("hold:");
    if (isHold) {
      const coverage = legalActionCoverage(decision);
      const row = {
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
        primary_marker: parsed.primaryMarker,
        legal_kind_coverage_complete: coverage.complete,
        offered_non_hold_ids: coverage.nonHoldIDs,
        offered_non_hold_kinds: coverage.nonHoldKinds,
        offered_productive_ids: coverage.productiveIDs,
        legal_kind_misbucketed: coverage.misbucketed,
        duplicate_kind_assignments: coverage.duplicateAssignments,
      };
      if (
        parsed.primaryMarker === "hkf1" ||
        parsed.primaryMarker === "hhfc" ||
        parsed.primaryMarker === "hncap"
      ) {
        explainedHolds.push(row);
        const capProof = parsed.primaryMarker === "hncap"
          ? navalCapHoldProof(decision, coverage)
          : null;
        if (
          (
            row.legal_kind_coverage_complete &&
            row.offered_non_hold_ids.length === 0 &&
            row.offered_non_hold_kinds.length === 0
          ) ||
          capProof
        ) {
          verifiedHolds.push({
            ...row,
            ...(capProof ?? { proof: "hold was the only offered action" }),
          });
        } else {
          holdEvidenceGaps.push({
            ...row,
            failure:
              "marker explains policy intent but replay lacks complete independent proof that no productive safe alternative was offered",
          });
        }
      } else {
        unexplainedHolds.push(row);
      }
    }

    const harmfulKind = HARMFUL_KINDS.has(decision.selectedActionKind);
    const neutralSelection = isNeutralAction(action);
    const selectedTargetsK1Z =
      target.ids.some((id) => k1zRuntimeIDs.has(id)) ||
      target.names.some((name) => knownK1ZNames.has(name)) ||
      target.rawNames.some(hasLeadingK1ZTag);
    if (harmfulKind && !neutralSelection) {
      const resolution = resolveReplayTarget(target, runtimePlayerUniverse);
      if (!resolution.player) {
        harmTargetFailures.push({
          turn: decision.turnNumber ?? null,
          action_id: decision.selectedLegalActionId ?? null,
          action_kind: decision.selectedActionKind ?? null,
          target,
          failure: resolution.ambiguous
            ? "ambiguous harmful target"
            : resolution.signaled
              ? "unresolved harmful target"
              : "missing harmful target",
        });
      }
      if (selectedTargetsK1Z) {
        harmfulK1ZActions.push({
          turn: decision.turnNumber ?? null,
          action_id: decision.selectedLegalActionId ?? null,
          action_kind: decision.selectedActionKind ?? null,
          target,
        });
      }
    }
    const submittedID = submittedTargetID(
      decision?.result?.submittedIntent,
    );
    if (
      harmfulKind &&
      submittedID &&
      k1zRuntimeIDs.has(submittedID) &&
      !selectedTargetsK1Z
    ) {
      harmfulK1ZActions.push({
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
        action_kind: decision.selectedActionKind ?? null,
        target: {
          ids: [submittedID],
          names: [],
          rawName: "",
        },
        evidence: "submitted_intent",
      });
    }
  }

  const accepted = policyDecisions.filter((decision) =>
    decision?.result?.accepted === true
  ).length;
  const rejected = policyDecisions.filter((decision) =>
    decision?.result?.accepted === false
  ).length;
  const fallbacks = policyDecisions.filter((decision) =>
    decision?.fallbackUsed === true
  ).length;
  const fallbackEvidenceFailures = policyDecisions
    .filter((decision) => typeof decision?.fallbackUsed !== "boolean")
    .map((decision) => ({
      turn: decision.turnNumber ?? null,
      value: decision?.fallbackUsed ?? null,
    }));
  const plannerDegradationFailures = policyDecisions
    .filter((decision) => !plannerDegradationIsFalse(decision))
    .map((decision) => ({
      turn: decision.turnNumber ?? null,
      value: decision?.llmPlannerDegraded ?? null,
    }));
  const bytes = replayBytes === null
    ? null
    : Buffer.isBuffer(replayBytes)
      ? replayBytes
      : Buffer.from(replayBytes);

  return {
    schema_version: 2,
    record_type: "hrafn_clean_chassis_replay_audit",
    audit_scope: "replay_safety_only",
    not_proven: [
      "candidate_source_or_image_binding",
      "preregistered_branch_reach",
      "exact_v5_matched_control",
      "causal_lift",
    ],
    replay_sha256: bytes
      ? createHash("sha256").update(bytes).digest("hex")
      : null,
    marker_profile: markerProfile,
    game_id: replay?.gameID ?? replay?.results?.game_id ?? null,
    hrafn_identity_verified: identityVerified,
    runtime_identity_conflicts: runtimeIdentities.conflicts,
    foreign_tagged_decisions: foreignTaggedDecisions.length,
    foreign_tagged_allowed_for_matched_control:
      options.allowForeignTagged === true,
    policy_decisions: policyDecisions.length,
    accepted,
    rejected,
    holds: explainedHolds.length + unexplainedHolds.length,
    explained_holds: explainedHolds,
    verified_holds: verifiedHolds,
    hold_evidence_gaps: holdEvidenceGaps,
    unexplained_holds: unexplainedHolds,
    fallbacks,
    fallback_evidence_failures: fallbackEvidenceFailures,
    planner_degradation_failures: plannerDegradationFailures,
    marker_counts: markerCounts,
    cap_escape: {
      accepted_naval_launches: acceptedNavalLaunches,
      accepted_naval_launch_turns: acceptedNavalLaunchTurns,
      cap_antecedent_reached: acceptedNavalLaunches >= 2,
      cap_antecedent_first_turn: capAntecedentFirstTurn,
      hks1_builds: hks1Builds,
      accepted_hks1_builds: acceptedHks1Builds,
      hks1_moves: hks1Moves,
      accepted_hks1_moves: acceptedHks1Moves,
      hks1_first_reach: hks1FirstReach,
      accepted_hks1_first_reach: acceptedHks1FirstReach,
      naval_launch_failures: navalLaunchFailures,
      cap_antecedent_failures: capAntecedentFailures,
      build_bound_failures: capEscapeBuildBoundFailures,
      attribution: {
        actions: capEscapeAttributionRows,
        attributed_actions: capEscapeAttributionRows.filter((row) =>
          row.available
        ).length,
        invalid_actions: capEscapeAttributionFailures.length,
        failures: capEscapeAttributionFailures,
      },
      owner_attribution: {
        moves: capEscapeOwnerRows,
        available_moves: capEscapeOwnerRows.filter((row) => row.available)
          .length,
        unavailable_moves: capEscapeOwnerRows.filter((row) => !row.available)
          .length,
        resolved_hrafn_moves: capEscapeOwnerRows.filter((row) =>
          row.resolution === "hrafn"
        ).length,
        invalid_moves: capEscapeOwnerFailures.length,
      },
    },
    marker_failures: markerFailures,
    freshness_failures: freshnessFailures,
    harmful_k1z_actions: harmfulK1ZActions,
    harm_target_failures: harmTargetFailures,
    effect_consistency_failures: effectConsistencyFailures,
    public_reason_failures: publicReasonFailures,
    checks: {
      hrafn_identity_verified: identityVerified,
      runtime_identities_consistent:
        runtimeIdentities.conflicts.length === 0,
      decisions_present: policyDecisions.length > 0,
      zero_foreign_tagged_decisions:
        foreignTaggedDecisions.length === 0 ||
        options.allowForeignTagged === true,
      all_decisions_accepted: accepted === policyDecisions.length,
      zero_rejections: rejected === 0,
      fallback_evidence_complete: fallbackEvidenceFailures.length === 0,
      zero_fallbacks: policyDecisions.every((decision) =>
        decision?.fallbackUsed === false
      ),
      zero_planner_degradation: plannerDegradationFailures.length === 0,
      zero_unexplained_holds: unexplainedHolds.length === 0,
      hold_evidence_complete: holdEvidenceGaps.length === 0,
      zero_k1z_harm: harmfulK1ZActions.length === 0,
      harmful_targets_resolved: harmTargetFailures.length === 0,
      submitted_effects_consistent: effectConsistencyFailures.length === 0,
      marker_semantics_valid: markerFailures.length === 0,
      hks1_cap_antecedent_valid: capAntecedentFailures.length === 0,
      hks1_naval_launch_bound_valid: navalLaunchFailures.length === 0,
      hks1_build_bound_valid: capEscapeBuildBoundFailures.length === 0,
      hks1_owner_attribution_valid: capEscapeOwnerFailures.length === 0,
      hks1_attribution_valid: capEscapeAttributionFailures.length === 0,
      selected_ids_were_legal: freshnessFailures.length === 0,
      public_text_valid: publicReasonFailures.length === 0,
    },
  };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    throw new Error(
      "usage: node scripts/audit-hrafn-chassis-replay.mjs <replay>",
    );
  }
  const bytes = await readFile(target);
  const allowed = new Set(["--allow-foreign-tagged-control"]);
  const unknown = process.argv.slice(3).filter((value) => !allowed.has(value));
  if (unknown.length > 0) {
    throw new Error(`unknown option ${unknown[0]}`);
  }
  const report = auditHrafnChassisReplay(JSON.parse(bytes), bytes, {
    allowForeignTagged:
      process.argv.includes("--allow-foreign-tagged-control"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
