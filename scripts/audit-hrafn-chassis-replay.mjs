import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hrafnPublicKindCode,
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
    /^\[K1Z\] r4vn:([a-z0-9]{3})(?::([a-z0-9]{1,6}(?:\.[a-z0-9]{1,6})*))?$/,
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
        canonicalName,
        rawNames: new Set(),
        ids: new Set([id]),
      });
    }
    const entry = byID.get(id);
    if (!entry.canonicalName && canonicalName) {
      entry.canonicalName = canonicalName;
    }
    if (rawName) entry.rawNames.add(rawName);
  }
  const universe = [...byID.values()];
  for (const alias of idless) {
    const matches = universe.filter((entry) =>
      alias.canonicalName &&
      entry.canonicalName === alias.canonicalName
    );
    if (matches.length === 1) {
      if (alias.rawName) matches[0].rawNames.add(alias.rawName);
      continue;
    }
    if (matches.length > 1) continue;
    universe.push({
      canonicalName: alias.canonicalName,
      rawNames: new Set(alias.rawName ? [alias.rawName] : []),
      ids: new Set(),
    });
  }
  return universe;
}

function resolveReplayTarget(target, universe) {
  const signalMatches = [
    ...target.ids.map((id) =>
      universe.filter((player) => player.ids.has(id))
    ),
    ...target.names.map((name) =>
      universe.filter((player) => player.canonicalName === name)
    ),
  ];
  const everySignalIsUnique = signalMatches.length > 0 &&
    signalMatches.every((matches) => matches.length === 1);
  const matches = new Set(signalMatches.flat());
  return {
    player: everySignalIsUnique && matches.size === 1
      ? signalMatches[0][0]
      : null,
    ambiguous:
      signalMatches.some((entries) => entries.length > 1) ||
      matches.size > 1,
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
  const complete = legalIDs.length > 0 &&
    byKindEntries.length > 0 &&
    legalSet.size === flattenedSet.size &&
    [...legalSet].every((id) => flattenedSet.has(id));
  const selected = String(decision?.selectedLegalActionId ?? "");
  const nonHoldIDs = legalIDs.filter((id) =>
    id !== selected && id !== "hold"
  );
  return {
    complete,
    nonHoldIDs,
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
    neutralLandIDs.length > 0 ||
    !hostileEvidenceComplete
  ) {
    return null;
  }
  return {
    proof: "naval cap recovery menu exhausted",
    offered_productive_kinds: offeredProductiveKinds,
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
  const identityVerified =
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
  const runtimePlayerUniverse = collectRuntimePlayerUniverse(replay);
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

  for (const decision of policyDecisions) {
    const parsed = parseHrafnChassisReason(decision.reason);
    if (!parsed.valid || String(decision.reason).length > 48) {
      publicReasonFailures.push({
        turn: decision.turnNumber ?? null,
        reason: decision.reason ?? null,
        failure: "malformed public reason",
      });
    } else {
      const expectedKindCode = hrafnPublicKindCode(
        decision.selectedActionKind,
      );
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

    const action = decisionAction(decision, parsed);
    const semantic = validateHrafnMarkerSemantics(action, {
      requirePrimary: decision.selectedActionKind !== "spawn",
    });
    const semanticFailures = [...semantic.failures];
    const target = targetIdentity(decision);
    const effectFailures = submittedEffectFailures(
      decision,
      target,
      runtimePlayerUniverse,
    );
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
      String(decision.selectedLegalActionId).startsWith("hold");
    if (isHold) {
      const coverage = legalActionCoverage(decision);
      const row = {
        turn: decision.turnNumber ?? null,
        action_id: decision.selectedLegalActionId ?? null,
        primary_marker: parsed.primaryMarker,
        legal_kind_coverage_complete: coverage.complete,
        offered_non_hold_ids: coverage.nonHoldIDs,
        offered_non_hold_kinds: coverage.nonHoldKinds,
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
    game_id: replay?.gameID ?? replay?.results?.game_id ?? null,
    hrafn_identity_verified: identityVerified,
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
    marker_failures: markerFailures,
    freshness_failures: freshnessFailures,
    harmful_k1z_actions: harmfulK1ZActions,
    harm_target_failures: harmTargetFailures,
    effect_consistency_failures: effectConsistencyFailures,
    public_reason_failures: publicReasonFailures,
    checks: {
      hrafn_identity_verified: identityVerified,
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
