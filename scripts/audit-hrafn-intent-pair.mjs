#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { chooseHrafnIntentDecision } from "../hrafn-intent.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";
import { recordHrafnDecision } from "../hrafn-strategy.mjs";
import { verifyK1ZPacketBytes } from "../k1z-direct-line.mjs";
import { auditHrafnChassisReplay } from "./audit-hrafn-chassis-replay.mjs";
import {
  HRAFN_INTENT_CAMPAIGN_ID,
  HRAFN_INTENT_MODEL,
  HRAFN_INTENT_MODEL_DIGEST,
  HRAFN_INTENT_OLLAMA_VERSION,
  HRAFN_INTENT_PLAYER_RUN,
  HRAFN_V5_OPPONENT_IMAGE_ID,
  hrafnIntentReceiptContentSHA256,
  serializeHrafnIntentImageReceipt,
  verifyHrafnIntentImageReceipt,
} from "./create-hrafn-intent-image-receipt.mjs";
import {
  HRAFN_INTENT_CELLS,
  HRAFN_INTENT_MANIFEST_SHA256,
} from "./build-hrafn-intent-job.mjs";

const CAMPAIGN_ID = "hrafn-intent-i1";
const SUBJECT_NAME = "K1Z Hrafn";
const REQUEST_MARKER = /^q[0-9a-f]{10}$/;
const OLLAMA_MODEL_DIGEST =
  "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1";
const PUBLIC_REASON = /^\[K1Z\] r4vn:([a-z0-9]{3})(?::((?:(?:[a-z0-9]{1,6}|q[0-9a-f]{10})(?:\.(?:[a-z0-9]{1,6}|q[0-9a-f]{10}))*)))?$/;
const ERROR_LOG_PATTERN = /(?:fail-closed decision error|decision response failed|match socket (?:closed|error)|reconnecting|uncaught|unhandled)/i;
const REQUIRED_CHASSIS_CHECKS = Object.freeze([
  "hrafn_identity_verified",
  "decisions_present",
  "zero_foreign_tagged_decisions",
  "all_decisions_accepted",
  "zero_rejections",
  "fallback_evidence_complete",
  "zero_fallbacks",
  "zero_planner_degradation",
  "zero_unexplained_holds",
  "hold_evidence_complete",
  "zero_k1z_harm",
  "harmful_targets_resolved",
  "submitted_effects_consistent",
  "selected_ids_were_legal",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalize(value[key]),
    ]));
  }
  return value;
}

function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

function finiteNumber(value) {
  if (value === null || value === "" || typeof value === "boolean") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function percentile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.some((value) => {
    const number = finiteNumber(value);
    return number === null || number < 0;
  })) return null;
  const ordered = values.map(Number).sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * ordered.length) - 1);
  return ordered[index];
}

function deepDifferences(left, right, prefix = "") {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return [{ path: prefix, control: left, candidate: right }];
    }
    const differences = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      differences.push(...deepDifferences(
        left[index],
        right[index],
        `${prefix}[${index}]`,
      ));
    }
    return differences;
  }
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (!leftObject || !rightObject) {
    return [{ path: prefix, control: left, candidate: right }];
  }
  const differences = [];
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .sort()) {
    differences.push(...deepDifferences(
      left[key],
      right[key],
      prefix ? `${prefix}.${key}` : key,
    ));
  }
  return differences;
}

function parsePolicyLog(raw) {
  const rows = [];
  const failures = [];
  const errorLines = [];
  for (const [index, line] of String(raw ?? "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (ERROR_LOG_PATTERN.test(line)) errorLines.push({ line: index + 1, text: line });
    if (!line.trimStart().startsWith("{")) continue;
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        failures.push({ line: index + 1, failure: "JSON telemetry row is not an object" });
      } else {
        rows.push({ ...value, _logLine: index + 1 });
      }
    } catch (error) {
      failures.push({
        line: index + 1,
        failure: `malformed JSON telemetry: ${error.message}`,
      });
    }
  }
  return { rows, failures, errorLines };
}

function parseReplayDecisions(replay) {
  const raw = replay?.inlineRunArtifacts?.["decisions.jsonl"];
  if (typeof raw !== "string") {
    return { decisions: [], failures: ["replay lacks inline decisions.jsonl"] };
  }
  const decisions = [];
  const failures = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line) continue;
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        failures.push(`decision row ${index + 1} is not an object`);
      } else {
        decisions.push({ ...value, _jsonlLine: index + 1 });
      }
    } catch (error) {
      failures.push(`decision row ${index + 1} is malformed: ${error.message}`);
    }
  }
  return { decisions, failures };
}

function reasonMarkers(reason) {
  const value = String(reason ?? "");
  if (value.length > 48 || !/^[\x20-\x7e]+$/.test(value)) {
    return { valid: false, kind: null, markers: [] };
  }
  const match = value.match(PUBLIC_REASON);
  return match
    ? {
        valid: true,
        kind: match[1],
        markers: match[2] ? match[2].split(".") : [],
      }
    : { valid: false, kind: null, markers: [] };
}

function subjectResult(results, subjectSlot) {
  const players = Array.isArray(results?.players) ? results.players : [];
  const matches = players.filter((player, index) =>
    (Number.isSafeInteger(player?.slot) ? player.slot : index) === subjectSlot &&
    player?.name === SUBJECT_NAME
  );
  return matches.length === 1 ? matches[0] : null;
}

function subjectFinalPlayer(replay, subjectSlot) {
  const players = Array.isArray(replay?.finalState?.players)
    ? replay.finalState.players
    : [];
  const matches = players.filter((player, index) =>
    index === subjectSlot && player?.username === SUBJECT_NAME
  );
  return matches.length === 1 ? matches[0] : null;
}

function subjectJobBinding(job, subjectSlot, role) {
  const players = Array.isArray(job?.players) ? job.players : [];
  const roster = Array.isArray(job?.game_config?.players)
    ? job.game_config.players
    : [];
  const expectedFlag = role === "candidate" ? "1" : "0";
  const subject = players[subjectSlot];
  const exactNames = roster.filter((player) => player?.name === SUBJECT_NAME);
  const forbidden = /(?:qd1n|odin)/i.test(JSON.stringify({ players, roster }));
  return {
    valid:
      Number.isSafeInteger(subjectSlot) &&
      subjectSlot >= 0 &&
      subjectSlot < 4 &&
      players.length === 4 &&
      roster.length === 4 &&
      job?.game_config?.num_agents === 4 &&
      job?.game_config?.map_size === "Compact" &&
      ["Pangaea", "Asia"].includes(job?.game_config?.map) &&
      exactNames.length === 1 &&
      roster[subjectSlot]?.name === SUBJECT_NAME &&
      subject?.env?.HRAFN_INTENT_ENABLED === expectedFlag &&
      Array.isArray(subject?.run) &&
      canonicalJSON(subject.run) === canonicalJSON([
        "node",
        "/app/hrafn-intent-player.mjs",
      ]) &&
      !forbidden,
    expectedFlag,
    forbidden,
  };
}

function jsonBytesMatch(value, bytes) {
  if (bytes === null || bytes === undefined) return true;
  try {
    return canonicalJSON(JSON.parse(bytes)) === canonicalJSON(value);
  } catch {
    return false;
  }
}

function artifactsMatch(run, subjectSlot) {
  const { job, replay, results } = run;
  const replayConfig = replay?.config;
  const result = subjectResult(results, subjectSlot);
  const replayResult = subjectResult(replay?.results, subjectSlot);
  const finalPlayer = subjectFinalPlayer(replay, subjectSlot);
  const jobNames = job?.game_config?.players?.map((entry) => entry?.name) ?? [];
  const replayNames = replayConfig?.players?.map((entry) => entry?.name) ?? [];
  return {
    valid:
      canonicalJSON(results) === canonicalJSON(replay?.results) &&
      jsonBytesMatch(job, run?.jobBytes) &&
      jsonBytesMatch(results, run?.resultsBytes) &&
      jsonBytesMatch(replay, run?.replayBytes) &&
      replay?.gameID === results?.game_id &&
      replay?.seed === job?.game_config?.seed &&
      replayConfig?.map === job?.game_config?.map &&
      replayConfig?.map_size === job?.game_config?.map_size &&
      replayConfig?.player_count === 4 &&
      canonicalJSON(replayNames) === canonicalJSON(jobNames) &&
      result !== null &&
      replayResult !== null &&
      finalPlayer !== null &&
      finiteNumber(result.score) !== null &&
      finiteNumber(result.tiles_owned) !== null &&
      finalPlayer.tilesOwned === result.tiles_owned &&
      finalPlayer.isAlive === result.is_alive,
    result,
    finalPlayer,
  };
}

export function hrafnIntentRequestMarker(requestID) {
  if (
    typeof requestID !== "string" ||
    requestID.length === 0 ||
    requestID.trim() !== requestID
  ) {
    return null;
  }
  return `q${sha256(requestID).slice(0, 10)}`;
}

function parseRawResponse(value) {
  if (typeof value === "string") {
    try {
      return { value: JSON.parse(value), error: null };
    } catch (error) {
      return {
        value: null,
        error: `malformed rawLlmOutput: ${error.message}`,
      };
    }
  }
  if (plainObject(value)) return { value, error: null };
  return { value: null, error: "rawLlmOutput is not an object or JSON object string" };
}

function validRawResponse(raw, telemetry, replay) {
  return plainObject(raw) &&
    raw.type === "decision_response" &&
    raw.requestID === telemetry.requestID &&
    raw.selectedLegalActionId === replay.selectedLegalActionId &&
    raw.reason === replay.reason &&
    finiteNumber(raw.confidence) !== null &&
    raw.confidence >= 0 &&
    raw.confidence <= 1 &&
    raw.fallbackUsed === false &&
    raw.llmPlannerDegraded === false;
}

function replaySequenceAudit(rows) {
  const failures = [];
  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    const sequence = row?.sequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      failures.push({
        source: "replay",
        line: row?._jsonlLine ?? null,
        failure: "replay sequence is not a positive safe integer",
      });
      continue;
    }
    if (seen.has(sequence)) {
      failures.push({
        source: "replay",
        line: row?._jsonlLine ?? null,
        failure: `duplicate replay sequence ${sequence}`,
      });
    }
    if (previous !== null && sequence <= previous) {
      failures.push({
        source: "replay",
        line: row?._jsonlLine ?? null,
        failure: `non-monotone replay sequence ${sequence} after ${previous}`,
      });
    }
    seen.add(sequence);
    previous = sequence;
  }
  return { pass: failures.length === 0, failures };
}

function strictJoin(telemetryRows, replayRows) {
  const failures = [];
  const requestIDs = new Set();
  const requestMarkers = new Set();
  const replayMarkers = new Set();

  for (const [index, row] of telemetryRows.entries()) {
    const expectedMarker = hrafnIntentRequestMarker(row.requestID);
    if (!expectedMarker || row.requestMarker !== expectedMarker) {
      failures.push({
        source: "policy_log",
        line: row._logLine ?? null,
        failure: "request marker does not match the full request ID",
      });
      continue;
    }
    if (requestIDs.has(row.requestID)) {
      failures.push({
        source: "policy_log",
        line: row._logLine ?? null,
        failure: "duplicate request ID",
      });
    }
    requestIDs.add(row.requestID);
    if (requestMarkers.has(row.requestMarker)) {
      failures.push({
        source: "policy_log",
        line: row._logLine ?? null,
        failure: "duplicate request marker",
      });
    }
    requestMarkers.add(row.requestMarker);
    if (row.decisionIndex !== index + 1) {
      failures.push({
        source: "policy_log",
        line: row._logLine ?? null,
        failure: `decisionIndex must be contiguous: expected ${index + 1}`,
      });
    }
    if (row.duplicateRequest !== false || row.cacheConflict !== null) {
      failures.push({
        source: "policy_log",
        line: row._logLine ?? null,
        failure: "duplicate or cache-conflicted decision telemetry",
      });
    }
  }

  for (const row of replayRows) {
    const parsed = reasonMarkers(row.reason);
    const markers = parsed.markers.filter((marker) => REQUEST_MARKER.test(marker));
    if (!parsed.valid || markers.length !== 1) {
      failures.push({
        source: "replay",
        line: row._jsonlLine ?? null,
        failure: "public reason lacks one valid request marker",
      });
      continue;
    }
    const marker = markers[0];
    if (replayMarkers.has(marker)) {
      failures.push({
        source: "replay",
        line: row._jsonlLine ?? null,
        failure: "duplicate replay request marker",
      });
    }
    replayMarkers.add(marker);
  }

  if (telemetryRows.length !== replayRows.length) {
    failures.push({
      source: "join",
      failure: `decision cardinality differs: log=${telemetryRows.length}, replay=${replayRows.length}`,
    });
  }

  const joined = [];
  const length = Math.min(telemetryRows.length, replayRows.length);
  for (let index = 0; index < length; index += 1) {
    const telemetry = telemetryRows[index];
    const replayRow = replayRows[index];
    const parsed = reasonMarkers(replayRow.reason);
    const marker = parsed.markers.find((value) => REQUEST_MARKER.test(value));
    if (!marker) continue;
    if (marker !== telemetry.requestMarker) {
      failures.push({
        source: "join",
        line: replayRow._jsonlLine ?? null,
        failure: `decision order/request marker mismatch at index ${index + 1}`,
      });
    }
    if (telemetry.actionID !== replayRow.selectedLegalActionId) {
      failures.push({
        source: "join",
        line: replayRow._jsonlLine ?? null,
        failure: `action mismatch for ${marker}`,
      });
    }
    if (telemetry.turnNumber !== replayRow.turnNumber) {
      failures.push({
        source: "join",
        line: replayRow._jsonlLine ?? null,
        failure: `turn mismatch for ${marker}`,
      });
    }
    if (!safeInteger(telemetry.turnNumber)) {
      failures.push({
        source: "join",
        line: telemetry._logLine ?? null,
        failure: `invalid turn for ${marker}`,
      });
    }
    const replayRaw = parseRawResponse(replayRow.rawLlmOutput);
    const telemetryRaw = parseRawResponse(telemetry.rawLlmOutput);
    if (replayRaw.error || telemetryRaw.error) {
      failures.push({
        source: "raw_response",
        line: replayRow._jsonlLine ?? null,
        failure: replayRaw.error ?? telemetryRaw.error,
      });
    } else if (
      !validRawResponse(replayRaw.value, telemetry, replayRow) ||
      canonicalJSON(replayRaw.value) !== canonicalJSON(telemetryRaw.value)
    ) {
      failures.push({
        source: "raw_response",
        line: replayRow._jsonlLine ?? null,
        failure: `raw response mismatch for ${marker}`,
      });
    }
    joined.push({
      marker,
      telemetry,
      replay: replayRow,
      parsed,
      rawResponse: replayRaw.value,
    });
  }
  return {
    joined,
    failures,
    orderPass: failures.every((failure) =>
      !/(?:decisionIndex|order\/request marker)/.test(failure.failure)
    ),
    rawResponsePass: failures.every((failure) =>
      failure.source !== "raw_response"
    ),
  };
}

const GENERATED_ACTION_FIELDS = new Set([
  "campaignStartDecision",
  "intentMarker",
  "policyMarker",
  "requestMarker",
]);

function inputActionShape(action) {
  if (!plainObject(action)) return action;
  return Object.fromEntries(Object.entries(action).filter(([key]) =>
    !GENERATED_ACTION_FIELDS.has(key)
  ));
}

function exactDecisionInput(value) {
  return plainObject(value) &&
    Object.keys(value).sort().join("\0") === "legalActions\0observation" &&
    Array.isArray(value.legalActions) &&
    plainObject(value.observation);
}

function recomputeWrappedV5(joined) {
  const history = [];
  const failures = [];
  const requestFailures = [];
  const selectedFailures = [];
  for (const [index, entry] of joined.entries()) {
    const row = entry.telemetry;
    const input = row.decisionInput;
    if (!exactDecisionInput(input)) {
      requestFailures.push({
        decision: index + 1,
        failure: "decisionInput must contain exactly legalActions and observation",
      });
      continue;
    }
    const expectedPayloadSHA256 = sha256(canonicalJSON(input));
    if (row.requestPayloadSHA256 !== expectedPayloadSHA256) {
      requestFailures.push({
        decision: index + 1,
        failure: "requestPayloadSHA256 does not bind decisionInput",
      });
    }
    const selected = row.selectedAction;
    const legalMatches = input.legalActions.filter((action) =>
      action?.id === row.actionID
    );
    if (
      !plainObject(selected) ||
      selected.id !== row.actionID ||
      selected.requestMarker !== entry.marker ||
      selected.kind !== entry.replay.selectedActionKind ||
      canonicalJSON(selected.metadata ?? {}) !==
        canonicalJSON(entry.replay.selectedActionMetadata ?? {}) ||
      legalMatches.length !== 1 ||
      canonicalJSON(inputActionShape(selected)) !==
        canonicalJSON(inputActionShape(legalMatches[0]))
    ) {
      selectedFailures.push({
        decision: index + 1,
        failure: "selectedAction is not the unique exact legal action",
      });
    }
    try {
      const recomputed = chooseHrafnIntentDecision({
        actions: input.legalActions,
        observation: input.observation,
        history,
        intent: null,
        rv1Enabled: true,
      });
      if (recomputed.baseline?.id !== row.baselineActionID) {
        failures.push({
          decision: index + 1,
          reported: row.baselineActionID ?? null,
          recomputed: recomputed.baseline?.id ?? null,
          failure: "reported baseline differs from independently replayed wrapped v5",
        });
      }
    } catch (error) {
      failures.push({
        decision: index + 1,
        failure: `baseline replay failed: ${error.message}`,
      });
    }
    if (plainObject(selected)) {
      recordHrafnDecision(history, selected, input.observation);
    }
  }
  return {
    pass: failures.length === 0 && selectedFailures.length === 0,
    requestPass: requestFailures.length === 0,
    failures,
    request_failures: requestFailures,
    selected_action_failures: selectedFailures,
  };
}

function latencyAudit(joined) {
  const response = joined.map((entry) => entry.telemetry.responseLatencyMs);
  const replay = joined.map((entry) => entry.replay.decisionLatencyMs);
  const responseP95 = percentile(response, 0.95);
  const replayP95 = percentile(replay, 0.95);
  const responseMax = response.length > 0 && response.every((value) =>
      finiteNumber(value) !== null
    )
    ? Math.max(...response.map(Number))
    : null;
  const replayMax = replay.length > 0 && replay.every((value) =>
      finiteNumber(value) !== null
    )
    ? Math.max(...replay.map(Number))
    : null;
  return {
    response_p95_ms: responseP95,
    response_max_ms: responseMax,
    replay_p95_ms: replayP95,
    replay_max_ms: replayMax,
    pass:
      responseP95 !== null &&
      responseMax !== null &&
      replayP95 !== null &&
      replayMax !== null &&
      responseP95 <= 50 &&
      replayP95 <= 50 &&
      responseMax <= 250 &&
      replayMax <= 250,
  };
}

function openingAuc20(joined, result, finalPlayer) {
  const accepted = joined.filter((entry) => entry.replay?.result?.accepted === true);
  const observed = accepted.slice(0, 20).map((entry) =>
    finiteNumber(entry.replay?.auditAfter?.tilesOwned)
  );
  if (observed.some((value) => value === null)) {
    return { value: null, observed: observed.length, padded: 0, complete: false };
  }
  if (observed.length < 20) {
    const eliminationVerified =
      result?.is_alive === false &&
      finalPlayer?.isAlive === false &&
      finiteNumber(result?.tiles_owned) === 0 &&
      finiteNumber(finalPlayer?.tilesOwned) === 0;
    if (!eliminationVerified) {
      return { value: null, observed: observed.length, padded: 0, complete: false };
    }
    const padded = 20 - observed.length;
    const total = observed.reduce((sum, value) => sum + value, 0);
    return { value: total / 20, observed: observed.length, padded, complete: true };
  }
  return {
    value: observed.reduce((sum, value) => sum + value, 0) / 20,
    observed: 20,
    padded: 0,
    complete: true,
  };
}

function planBindingAudit(role, joined, planRows) {
  const failures = [];
  const plansByEpoch = new Map();
  let successfulEpoch = 0;
  for (const [index, plan] of planRows.entries()) {
    if (plan.attempt !== index + 1) {
      failures.push(`plan row ${index + 1} has noncontiguous attempt`);
    }
    if (plan.ok !== true) {
      failures.push(`plan attempt ${plan.attempt ?? index + 1} was not successful`);
      continue;
    }
    successfulEpoch += 1;
    if (plan.intentEpoch !== successfulEpoch || plansByEpoch.has(plan.intentEpoch)) {
      failures.push(`plan row ${index + 1} has forged or duplicate epoch`);
      continue;
    }
    if (
      plan.model !== "llama3:latest" ||
      plan.expectedModelDigest !== OLLAMA_MODEL_DIGEST ||
      plan.error !== null ||
      finiteNumber(plan.latencyMs) === null ||
      plan.latencyMs < 0 ||
      !safeInteger(plan.intentSourceDecision) ||
      !safeInteger(plan.intentAge) ||
      plan.intentAge > 12 ||
      !Number.isSafeInteger(plan.intentHorizon) ||
      plan.intentHorizon < 2 ||
      plan.intentHorizon > 12 ||
      !(
        (plan.intentObjective === "grow" && plan.intentTargetID === null) ||
        (
          plan.intentObjective === "convert" &&
          typeof plan.intentTargetID === "string" &&
          plan.intentTargetID.length > 0 &&
          plan.intentTargetID.trim() === plan.intentTargetID
        )
      )
    ) {
      failures.push(`plan row ${index + 1} violates the pinned plan schema`);
      continue;
    }
    plansByEpoch.set(plan.intentEpoch, plan);
  }

  const allowedNoIntentReasons = new Set(["intent_missing_or_invalid"]);
  const allowedIntentReasons = new Set([
    "intent_applied",
    "intent_hard_guard",
    "intent_same_as_baseline",
    "intent_unreachable",
  ]);
  for (const [index, entry] of joined.entries()) {
    const row = entry.telemetry;
    const decisionIndex = index + 1;
    if (row.intentEpoch === 0) {
      if (
        row.intentObjective !== null ||
        row.intentTargetID !== null ||
        row.intentHorizon !== null ||
        row.intentSourceDecision !== null ||
        row.intentAge !== null ||
        row.intentRemainingBeforeCommit !== 0 ||
        !allowedNoIntentReasons.has(row.intentReason)
      ) {
        failures.push(`decision ${decisionIndex} has unbound no-intent fields`);
      }
      continue;
    }
    const plan = plansByEpoch.get(row.intentEpoch);
    if (!plan || plan._logLine >= row._logLine) {
      failures.push(`decision ${decisionIndex} has no earlier matching plan row`);
      continue;
    }
    const expectedAge = decisionIndex - 1 - plan.intentSourceDecision;
    const expectedRemaining = plan.intentHorizon - expectedAge;
    if (
      row.intentObjective !== plan.intentObjective ||
      row.intentTargetID !== plan.intentTargetID ||
      row.intentHorizon !== plan.intentHorizon ||
      row.intentSourceDecision !== plan.intentSourceDecision ||
      row.intentAge !== expectedAge ||
      row.planAgeDecisions !== (row.intentValid === true ? expectedAge : null) ||
      row.intentRemainingBeforeCommit !== expectedRemaining ||
      expectedAge < 0 ||
      expectedAge > 12 ||
      expectedRemaining < 1 ||
      !allowedIntentReasons.has(row.intentReason)
    ) {
      failures.push(`decision ${decisionIndex} does not exactly bind epoch ${row.intentEpoch}`);
    }
    const semanticReasonValid =
      (row.intentReason === "intent_applied" &&
        row.intentValid === true &&
        row.intentApplied === true &&
        row.actionDelta === true) ||
      (["intent_hard_guard", "intent_same_as_baseline"].includes(row.intentReason) &&
        row.intentValid === true &&
        row.intentApplied === false &&
        row.actionDelta === false) ||
      (row.intentReason === "intent_unreachable" &&
        row.intentValid === false &&
        row.intentApplied === false &&
        row.actionDelta === false &&
        row.intentFallback === true &&
        row.plannerDegraded === true);
    if (!semanticReasonValid) {
      failures.push(`decision ${decisionIndex} has inconsistent intent reason semantics`);
    }
  }

  if (role === "control" && (planRows.length > 0 || plansByEpoch.size > 0)) {
    failures.push("control emitted planner rows");
  }
  return {
    pass: failures.length === 0,
    failures,
    bound_epochs: [...plansByEpoch.keys()].sort((a, b) => a - b),
  };
}

function intentAudit(role, joined, planRows) {
  const isCandidate = role === "candidate";
  const deltas = joined.filter((entry) => entry.telemetry.actionDelta === true);
  const valid = joined.filter((entry) => entry.telemetry.intentValid === true);
  const epochs = [...new Set(joined
    .map((entry) => entry.telemetry.intentEpoch)
    .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0))]
    .sort((left, right) => left - right);
  const planEpochs = [...new Set(planRows
    .map((row) => row.intentEpoch)
    .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0))]
    .sort((left, right) => left - right);
  const firstDeltaIndex = joined.findIndex((entry) =>
    entry.telemetry.actionDelta === true
  );
  const openingDeltas = joined.slice(0, 20).filter((entry) =>
    entry.telemetry.actionDelta === true
  ).length;
  const semanticsValid = joined.every((entry) => {
    const telemetry = entry.telemetry;
    const legal = Array.isArray(entry.replay?.legalActionIDs)
      ? entry.replay.legalActionIDs
      : [];
    const delta = telemetry.actionDelta === true;
    const hi1Count = entry.parsed.markers.filter((marker) => marker === "hi1").length;
    return (
      typeof telemetry.actionDelta === "boolean" &&
      telemetry.intentApplied === delta &&
      (delta ? telemetry.intentValid === true : telemetry.intentApplied === false) &&
      hi1Count === (delta ? 1 : 0) &&
      (telemetry.actionID !== telemetry.baselineActionID) === delta &&
      legal.includes(telemetry.actionID) &&
      legal.includes(telemetry.baselineActionID)
    );
  });
  const planRowsValid = planRows.every((row, index) =>
    row.ok === true &&
    row.model === "llama3:latest" &&
    row.expectedModelDigest === OLLAMA_MODEL_DIGEST &&
    row.error === null &&
    row.attempt === index + 1 &&
    row.intentEpoch === index + 1 &&
    finiteNumber(row.latencyMs) !== null &&
    row.latencyMs >= 0 &&
    Number.isSafeInteger(row.intentHorizon) &&
    row.intentHorizon >= 2 &&
    row.intentHorizon <= 12 &&
    (
      (row.intentObjective === "grow" && row.intentTargetID === null) ||
      (
        row.intentObjective === "convert" &&
        typeof row.intentTargetID === "string" &&
        row.intentTargetID.length > 0 &&
        row.intentTargetID.trim() === row.intentTargetID
      )
    )
  );
  const intentFieldsValid = joined.every((entry) => {
    const row = entry.telemetry;
    if (typeof row.intentFallback !== "boolean" || row.intentFallback) {
      return false;
    }
    if (row.intentValid !== true) {
      return row.planAgeDecisions === null;
    }
    const schemaValid =
      ["grow", "convert"].includes(row.intentObjective) &&
      Number.isSafeInteger(row.intentHorizon) &&
      row.intentHorizon >= 2 &&
      row.intentHorizon <= 12 &&
      Number.isSafeInteger(row.planAgeDecisions) &&
      row.planAgeDecisions >= 0 &&
      row.planAgeDecisions <= 12 &&
      Number.isSafeInteger(row.intentEpoch) &&
      row.intentEpoch > 0 &&
      Number.isSafeInteger(row.intentRemaining) &&
      row.intentRemaining >= 0 &&
      row.intentRemaining <= row.intentHorizon;
    if (!schemaValid) return false;
    return row.intentObjective === "grow"
      ? row.intentTargetID === null
      : typeof row.intentTargetID === "string" &&
          row.intentTargetID.length > 0 &&
          row.intentTargetID.trim() === row.intentTargetID;
  });
  const attemptTrace = joined.map((entry) => entry.telemetry.plannerAttempts);
  const plannerAttemptsValid = joined.length > 0 && joined.every((entry) =>
    Number.isSafeInteger(entry.telemetry.plannerAttempts) &&
    entry.telemetry.plannerAttempts >= 0 &&
    entry.telemetry.plannerAttempts <= planRows.length &&
    typeof entry.telemetry.plannerPending === "boolean"
  ) && attemptTrace.every((value, index) =>
    index === 0 || value >= attemptTrace[index - 1]
  ) && Math.max(...attemptTrace) === planRows.length;
  const decisionPlannerClean = joined.every((entry) =>
    entry.telemetry.plannerDegraded === false &&
    entry.telemetry.plannerFailures === 0 &&
    entry.telemetry.plannerError === null &&
    entry.telemetry.model === "llama3:latest" &&
    entry.telemetry.expectedModelDigest === OLLAMA_MODEL_DIGEST
  );
  const controlZero =
    !isCandidate &&
    planRows.length === 0 &&
    joined.every((entry) =>
      entry.telemetry.intentEnabled === false &&
      entry.telemetry.intentEpoch === 0 &&
      entry.telemetry.actionDelta === false &&
      entry.telemetry.intentApplied === false &&
      entry.telemetry.plannerAttempts === 0 &&
      entry.telemetry.plannerFailures === 0 &&
      !entry.parsed.markers.includes("hi1")
    );
  const candidateMode =
    isCandidate &&
    joined.every((entry) => entry.telemetry.intentEnabled === true) &&
    planRows.length >= 2 &&
    planRowsValid &&
    canonicalJSON(epochs) === canonicalJSON(planEpochs);
  const coverage = joined.length > 0 ? valid.length / joined.length : 0;
  const deltaRate = joined.length > 0 ? deltas.length / joined.length : 0;
  return {
    valid_intent_decisions: valid.length,
    valid_coverage: coverage,
    intent_epochs: epochs.length,
    intent_epoch_ids: epochs,
    planner_attempts: planRows.length,
    action_deltas: deltas.length,
    action_delta_rate: deltaRate,
    first_delta_decision: firstDeltaIndex >= 0 ? firstDeltaIndex + 1 : null,
    hi1_opening_deltas: openingDeltas,
    semantics_valid: semanticsValid && intentFieldsValid,
    planner_clean:
      planRowsValid &&
      decisionPlannerClean &&
      plannerAttemptsValid &&
      intentFieldsValid,
    control_zero: controlZero,
    candidate_mode: candidateMode,
    coverage_pass: isCandidate ? coverage >= 0.8 : true,
    epochs_pass: isCandidate ? epochs.length >= 2 : true,
    deltas_pass: isCandidate ? deltas.length >= 8 : true,
    delta_rate_pass: isCandidate ? deltaRate >= 0.1 : true,
    opening_reach_pass: isCandidate
      ? firstDeltaIndex >= 0 && firstDeltaIndex < 20 && openingDeltas >= 2
      : true,
  };
}

function canonicalIdentityName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function identityAliases(entry) {
  const aliases = new Map();
  const subjectID = String(entry?.replay?.auditBefore?.playerID ?? "").trim();
  if (subjectID) aliases.set(subjectID, "$subject");
  const observation = entry?.telemetry?.decisionInput?.observation;
  const own = observation?.ownState ?? observation?.self ?? {};
  for (const key of ["id", "playerID", "playerId"]) {
    const id = String(own?.[key] ?? "").trim();
    if (id) aliases.set(id, "$subject");
  }
  const visible = [
    ...(Array.isArray(observation?.visiblePlayers)
      ? observation.visiblePlayers
      : []),
    ...(Array.isArray(observation?.players) ? observation.players : []),
  ];
  for (const player of visible) {
    const token = `$player:${canonicalIdentityName(player?.name ?? player?.username)}`;
    for (const key of ["id", "playerID", "playerId"]) {
      const id = String(player?.[key] ?? "").trim();
      if (id) aliases.set(id, token);
    }
  }
  return [...aliases.entries()].sort(([left], [right]) =>
    right.length - left.length
  );
}

function normalizeRuntimeValue(value, aliases, opaque = new Map(), key = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeRuntimeValue(entry, aliases, opaque, key));
  }
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((childKey) => [
      childKey,
      normalizeRuntimeValue(value[childKey], aliases, opaque, childKey),
    ]));
  }
  if (typeof value !== "string") return value;
  let normalized = value;
  for (const [runtimeID, token] of aliases) {
    normalized = normalized.split(runtimeID).join(token);
  }
  const idField = /(?:^|_)(?:id|ids)$/i.test(key) || /(?:ID|IDs)$/.test(key);
  if (idField && normalized === value && value.length > 0) {
    if (!opaque.has(value)) opaque.set(value, `$opaque:${opaque.size + 1}`);
    normalized = opaque.get(value);
  }
  return normalized;
}

function normalizedPretreatment(entry) {
  const aliases = identityAliases(entry);
  const opaque = new Map();
  const input = entry?.telemetry?.decisionInput;
  const legalActions = Array.isArray(input?.legalActions)
    ? input.legalActions.map((action) =>
        normalizeRuntimeValue(action, aliases, opaque)
      ).sort((left, right) =>
        canonicalJSON(left).localeCompare(canonicalJSON(right))
      )
    : null;
  const legalActionIDs = Array.isArray(entry?.replay?.legalActionIDs)
    ? entry.replay.legalActionIDs
      .map((id) => normalizeRuntimeValue(id, aliases, opaque, "actionID"))
      .sort()
    : null;
  return {
    turnNumber: entry?.replay?.turnNumber,
    selectedLegalActionId: normalizeRuntimeValue(
      entry?.replay?.selectedLegalActionId,
      aliases,
      opaque,
      "actionID",
    ),
    selectedActionKind: entry?.replay?.selectedActionKind,
    selectedActionMetadata: normalizeRuntimeValue(
      entry?.replay?.selectedActionMetadata,
      aliases,
      opaque,
    ),
    legalActions,
    legalActionIDs,
    legalActionIDsByKind: normalizeRuntimeValue(
      entry?.replay?.legalActionIDsByKind,
      aliases,
      opaque,
    ),
    observation: normalizeRuntimeValue(input?.observation, aliases, opaque),
    auditBefore: normalizeRuntimeValue(
      entry?.replay?.auditBefore,
      aliases,
      opaque,
    ),
  };
}

function pretreatmentSignature(entry) {
  return canonicalJSON(normalizedPretreatment(entry));
}

function pretreatmentAudit(control, candidate) {
  const firstDeltaIndex = candidate.join.rows.findIndex((entry) =>
    entry.action_delta === true
  );
  const failures = [];
  if (firstDeltaIndex < 1) {
    failures.push("candidate lacks a nonempty pre-treatment decision prefix");
  } else if (control.join.rows.length < firstDeltaIndex) {
    failures.push("control is shorter than the candidate pre-treatment prefix");
  } else {
    for (let index = 0; index < firstDeltaIndex; index += 1) {
      if (
        control.join.rows[index].pretreatment_signature !==
          candidate.join.rows[index].pretreatment_signature
      ) {
        failures.push(`pre-treatment decision ${index + 1} differs`);
      }
    }
  }
  return {
    pass: failures.length === 0,
    compared_decisions: Math.max(0, firstDeltaIndex),
    failures,
  };
}

function bytesFor(value, bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === "string") return Buffer.from(bytes);
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArtifact(value, bytes, label) {
  const wire = bytesFor(value, bytes);
  let parsed;
  try {
    parsed = JSON.parse(wire.toString("utf8"));
  } catch {
    return { value: null, bytes: wire, error: `${label} is not JSON` };
  }
  if (value !== undefined && canonicalJSON(value) !== canonicalJSON(parsed)) {
    return { value: parsed, bytes: wire, error: `${label} value and bytes differ` };
  }
  return { value: parsed, bytes: wire, error: null };
}

function expectedCampaignCells(jobs) {
  if (!Array.isArray(jobs) || jobs.length !== HRAFN_INTENT_CELLS.length) {
    return false;
  }
  return jobs.every((job, index) => {
    const cell = HRAFN_INTENT_CELLS[index];
    return job?.id === cell.id &&
      job?.order === cell.order &&
      job?.role === cell.role &&
      job?.map === cell.map &&
      job?.seed === cell.seed &&
      job?.subject_slot === cell.subject_slot &&
      /^[a-f0-9]{64}$/.test(job?.sha256 ?? "");
  });
}

function expectedCoworldArgv(preflight) {
  return [
    "uvx",
    "--from",
    "coworld==0.1.28",
    "coworld",
    "run-episode",
    preflight?.manifest?.path,
    preflight?.job?.path,
    "--output-dir",
    preflight?.output?.directory,
    "--episodes",
    "1",
    "--timeout-seconds",
    "3600",
    "--verify-replay",
  ];
}

function commonProvenanceAudit(provenance) {
  const failures = [];
  if (!plainObject(provenance)) {
    return { pass: false, failures: ["provenance bundle is required"] };
  }
  const prereg = parseArtifact(
    provenance.preregistration,
    provenance.preregistrationBytes,
    "preregistration",
  );
  const image = parseArtifact(
    provenance.imageReceipt,
    provenance.imageReceiptBytes,
    "image receipt",
  );
  const manifestBytes = Buffer.isBuffer(provenance.manifestBytes)
    ? provenance.manifestBytes
    : typeof provenance.manifestBytes === "string"
      ? Buffer.from(provenance.manifestBytes)
      : null;
  for (const artifact of [prereg, image]) {
    if (artifact.error) failures.push(artifact.error);
  }
  if (!manifestBytes || sha256(manifestBytes) !== HRAFN_INTENT_MANIFEST_SHA256) {
    failures.push("manifest bytes do not match the pinned Coworld 0.1.28 hash");
  }
  const imageReport = image.value
    ? verifyHrafnIntentImageReceipt(image.value)
    : { valid: false, errors: ["image receipt missing"] };
  if (!imageReport.valid) {
    failures.push(...imageReport.errors.map((error) => `image receipt: ${error}`));
  }
  if (
    image.value &&
    !image.bytes.equals(Buffer.from(serializeHrafnIntentImageReceipt(image.value)))
  ) {
    failures.push("image receipt wire bytes are not canonical");
  }
  if (
    prereg.value?.schema_version !== 2 ||
    prereg.value?.record_type !== "hrafn_intent_i1_preregistration" ||
    prereg.value?.campaign_id !== CAMPAIGN_ID ||
    prereg.value?.status !== "PREREGISTERED_AMENDED_NO_RUNTIME_AUTHORITY" ||
    prereg.value?.pilot?.coworld_client !== "0.1.28" ||
    prereg.value?.pilot?.manifest_sha256 !== HRAFN_INTENT_MANIFEST_SHA256 ||
    prereg.value?.intent_contract?.planner?.model !== HRAFN_INTENT_MODEL ||
    prereg.value?.intent_contract?.planner?.model_digest !==
      HRAFN_INTENT_MODEL_DIGEST
  ) {
    failures.push("preregistration does not bind the amended HI1 campaign");
  }
  const preregistrationSource = image.value?.files?.filter((entry) =>
    entry?.path === "experiments/hrafn-intent-i1-preregistration-20260720.json"
  ) ?? [];
  if (preregistrationSource.length !== 1 ||
    preregistrationSource[0].sha256 !== sha256(prereg.bytes)
  ) {
    failures.push("preregistration bytes do not match committed image-receipt source");
  }

  const identityWindowBytes = Buffer.isBuffer(provenance.identityWindowBytes)
    ? provenance.identityWindowBytes
    : Buffer.from(String(provenance.identityWindowBytes ?? ""));
  const identityWindow = parseArtifact(
    undefined,
    identityWindowBytes,
    "Odin advisory identity window",
  );
  let identityWindowReport = { valid: false, identity_action_eligible: false };
  if (identityWindow.error) {
    failures.push(identityWindow.error);
  } else {
    identityWindowReport = verifyK1ZPacketBytes(identityWindowBytes, {}, {
      requireDeclaredContract: true,
    });
  }

  const campaignJobs = identityWindow.value?.payload?.bindings?.jobs;
  const expectedBindings = {
    scope: "hrafn-only",
    source_commit: image.value?.source?.commit,
    subject_image_id: image.value?.image?.id,
    image_receipt: {
      file_sha256: sha256(image.bytes),
      content_sha256: hrafnIntentReceiptContentSHA256(image.value),
    },
    preregistration: {
      file_sha256: sha256(prereg.bytes),
      content_sha256: sha256(canonicalJSON(prereg.value)),
    },
    manifest_sha256: HRAFN_INTENT_MANIFEST_SHA256,
    planner: {
      model: HRAFN_INTENT_MODEL,
      model_digest: HRAFN_INTENT_MODEL_DIGEST,
      ollama_version: HRAFN_INTENT_OLLAMA_VERSION,
    },
    jobs: campaignJobs,
  };
  const expectedWindowPayload = {
    state: "HI1_IDENTITY_WINDOW_READY",
    active_identity: {
      player_id: HRAFN_PLAYER_ID,
      player_name: SUBJECT_NAME,
    },
    formal_approvals_consumed: 0,
    ordered_diagnostic_scope: HRAFN_INTENT_CELLS.map((cell) => cell.id),
    bindings: expectedBindings,
  };
  if (
    !expectedCampaignCells(campaignJobs) ||
    !identityWindowReport.valid ||
    identityWindowReport.identity_action_eligible ||
    identityWindow.value?.campaign_id !== CAMPAIGN_ID ||
    identityWindow.value?.from !== "odin" ||
    identityWindow.value?.to !== "hrafn" ||
    identityWindow.value?.kind !== "coordination" ||
    identityWindow.value?.authority?.advisory !== true ||
    identityWindow.value?.authority?.formal_approval !== false ||
    identityWindow.value?.authority?.mutation_scope !== "none" ||
    canonicalJSON(identityWindow.value?.payload) !==
      canonicalJSON(expectedWindowPayload) ||
    identityWindow.value?.evidence?.source_commit !== image.value?.source?.commit ||
    identityWindow.value?.evidence?.image_digest !== image.value?.image?.id ||
    canonicalJSON(identityWindow.value?.evidence?.replay_sha256) !== "[]"
  ) {
    failures.push("Odin advisory identity-window exact-artifact bindings are invalid");
  }
  return {
    pass: failures.length === 0,
    failures,
    preregistration: prereg,
    imageReceipt: image,
    manifestSHA256: manifestBytes ? sha256(manifestBytes) : null,
    identityWindow: identityWindow.value,
    identityWindowReport,
    campaignJobs,
    fingerprint: failures.length === 0
      ? sha256(canonicalJSON({
          preregistration: sha256(prereg.bytes),
          image_receipt: sha256(image.bytes),
          manifest: sha256(manifestBytes),
          identity_window: identityWindowReport.file_sha256,
          jobs: campaignJobs,
        }))
      : null,
  };
}

function runProvenanceAudit(run, common, role) {
  const failures = [];
  if (!common?.pass) failures.push("common provenance failed");
  const bundle = run?.provenance;
  if (!plainObject(bundle)) {
    return { pass: false, failures: [...failures, "run provenance is required"] };
  }
  const spec = parseArtifact(bundle.preflightSpec, bundle.preflightSpecBytes, "preflight spec");
  const preflight = parseArtifact(bundle.preflight, bundle.preflightBytes, "preflight receipt");
  const operational = parseArtifact(bundle.operational, bundle.operationalBytes, "operational receipt");
  for (const artifact of [spec, preflight, operational]) {
    if (artifact.error) failures.push(artifact.error);
  }
  const jobSHA = sha256(run?.jobBytes ?? Buffer.from(JSON.stringify(run?.job ?? null)));
  const expectedJobID = `${String(run?.job?.game_config?.map ?? "").toLowerCase()}-${role}`;
  const activeCampaignJob = common?.campaignJobs?.find((job) => job.id === expectedJobID);
  const pf = preflight.value;
  const op = operational.value;
  if (
    pf?.schema_version !== 1 ||
    pf?.record_type !== "hrafn_intent_i1_preflight_receipt" ||
    pf?.campaign_id !== CAMPAIGN_ID ||
    pf?.run_id !== spec.value?.run_id ||
    pf?.job?.id !== expectedJobID ||
    pf?.job?.role !== role ||
    pf?.job?.sha256 !== jobSHA ||
    canonicalJSON(pf?.campaign_jobs) !== canonicalJSON(common?.campaignJobs) ||
    activeCampaignJob?.sha256 !== jobSHA ||
    pf?.source?.commit !== common?.imageReceipt?.value?.source?.commit ||
    pf?.image_receipt?.file_sha256 !== sha256(common?.imageReceipt?.bytes ?? Buffer.alloc(0)) ||
    pf?.preregistration?.file_sha256 !== sha256(common?.preregistration?.bytes ?? Buffer.alloc(0)) ||
    pf?.manifest?.sha256 !== HRAFN_INTENT_MANIFEST_SHA256 ||
    pf?.images?.subject?.id !== common?.imageReceipt?.value?.image?.id ||
    pf?.images?.opponent?.id !== HRAFN_V5_OPPONENT_IMAGE_ID ||
    pf?.planner?.model !== HRAFN_INTENT_MODEL ||
    pf?.planner?.model_digest !== HRAFN_INTENT_MODEL_DIGEST ||
    pf?.planner?.version !== HRAFN_INTENT_OLLAMA_VERSION ||
    pf?.identity_window?.file_sha256 !==
      common?.identityWindowReport?.file_sha256 ||
    pf?.identity_window?.formal_approval !== false ||
    pf?.identity_window?.formal_approvals_consumed !== 0 ||
    pf?.identity?.player_id !== HRAFN_PLAYER_ID ||
    pf?.identity?.player_name !== SUBJECT_NAME ||
    !safeInteger(pf?.lease?.child_pid) ||
    !safeInteger(pf?.lease?.supervisor_pid) ||
    !path.isAbsolute(pf?.lease?.directory ?? "") ||
    canonicalJSON(pf?.argv) !== canonicalJSON(expectedCoworldArgv(pf)) ||
    !plainObject(pf?.checks) ||
    Object.values(pf.checks).some((value) => value !== true)
  ) {
    failures.push("preflight receipt does not bind the exact run");
  }
  const campaignFromSpec = Array.isArray(spec.value?.campaign_jobs)
    ? spec.value.campaign_jobs.map(({ path: _path, ...entry }) => entry)
    : null;
  const declaredPredecessors = Array.isArray(
      spec.value?.predecessor_operational_receipts,
    )
    ? spec.value.predecessor_operational_receipts
    : null;
  const receiptPredecessors = Array.isArray(pf?.lifecycle?.predecessors)
    ? pf.lifecycle.predecessors
    : null;
  const lifecycleDeclarationMatches = declaredPredecessors !== null &&
    receiptPredecessors !== null &&
    declaredPredecessors.length === receiptPredecessors.length &&
    declaredPredecessors.every((entry, index) =>
      entry?.job_id === receiptPredecessors[index]?.job_id &&
      entry?.path === receiptPredecessors[index]?.path &&
      entry?.sha256 === receiptPredecessors[index]?.file_sha256)
    && (
      spec.value?.pangaea_continuation_pair_report === null
        ? pf?.lifecycle?.pangaea_continuation === null
        : spec.value?.pangaea_continuation_pair_report?.path ===
            pf?.lifecycle?.pangaea_continuation?.path &&
          spec.value?.pangaea_continuation_pair_report?.sha256 ===
            pf?.lifecycle?.pangaea_continuation?.file_sha256
    );
  if (
    spec.value?.schema_version !== 1 ||
    spec.value?.record_type !== "hrafn_intent_i1_preflight_spec" ||
    spec.value?.campaign_id !== CAMPAIGN_ID ||
    spec.value?.role !== role ||
    spec.value?.job_id !== expectedJobID ||
    spec.value?.identity_window_path !== pf?.identity_window?.path ||
    canonicalJSON(campaignFromSpec) !== canonicalJSON(common?.campaignJobs) ||
    canonicalJSON(spec.value?.expected_argv) !== canonicalJSON(pf?.argv) ||
    pf?.lifecycle?.active_order !== activeCampaignJob?.order ||
    !lifecycleDeclarationMatches
  ) {
    failures.push("preflight spec does not bind the ordered campaign jobs and argv");
  }
  const expectedBindings = {
    source_commit: pf?.source?.commit,
    job: pf?.job,
    campaign_jobs: pf?.campaign_jobs,
    image_receipt: pf?.image_receipt,
    preregistration: pf?.preregistration,
    manifest: pf?.manifest,
    images: pf?.images,
    planner: pf?.planner,
    identity_window: pf?.identity_window,
    lifecycle: pf?.lifecycle,
  };
  if (
    op?.schema_version !== 2 ||
    op?.record_type !== "hrafn_intent_i1_operational_receipt" ||
    op?.campaign_id !== CAMPAIGN_ID ||
    op?.lane !== "hrafn" ||
    op?.run_id !== pf?.run_id ||
    op?.state !== "completed" ||
    op?.child_exit_code !== 0 ||
    op?.supervisor_exit_code !== 0 ||
    op?.child_signal !== null ||
    op?.child_spawn_error !== null ||
    op?.initial_identity?.player_id !== HRAFN_PLAYER_ID ||
    op?.initial_identity?.player_name !== SUBJECT_NAME ||
    op?.final_identity?.player_id !== HRAFN_PLAYER_ID ||
    op?.final_identity?.player_name !== SUBJECT_NAME ||
    op?.final_identity_error !== null ||
    op?.preflight_spec?.file_sha256 !== sha256(spec.bytes) ||
    op?.preflight_receipt?.file_sha256 !== sha256(preflight.bytes) ||
    canonicalJSON(op?.command_argv) !== canonicalJSON(pf?.argv) ||
    op?.output_directory !== pf?.output?.directory ||
    canonicalJSON(op?.runner_lease) !== canonicalJSON({
      directory: pf?.lease?.directory,
      child_pid: pf?.lease?.child_pid,
      supervisor_pid: pf?.lease?.supervisor_pid,
      acquired_at: pf?.lease?.acquired_at,
    }) ||
    canonicalJSON(op?.bindings) !== canonicalJSON(expectedBindings)
  ) {
    failures.push("operational receipt does not bind clean foreground completion");
  }
  return {
    pass: failures.length === 0,
    failures,
    preflight_sha256: sha256(preflight.bytes),
    operational_sha256: sha256(operational.bytes),
    campaign_order: pf?.job?.order ?? null,
    output_directory: pf?.output?.directory ?? null,
    preflight_verified_at: pf?.verified_at ?? null,
    started_at: op?.started_at ?? null,
    completed_at: op?.completed_at ?? null,
    lifecycle: pf?.lifecycle ?? null,
  };
}

export function auditHrafnIntentRun(run, provenanceCommon = null) {
  const role = run?.role;
  if (!["control", "candidate"].includes(role)) {
    throw new Error("HI1 run role must be control or candidate");
  }
  const subjectSlot = run?.subjectSlot;
  const log = parsePolicyLog(run?.policyLog);
  const parsedReplay = parseReplayDecisions(run?.replay);
  const subjectReplayRows = parsedReplay.decisions.filter((decision) =>
    decision?.username === SUBJECT_NAME &&
    !(
      decision?.externalActionCall === false &&
      decision?.actionSelectionSource === "deterministic-spawn"
    )
  );
  const foreignTagged = parsedReplay.decisions.filter((decision) =>
    String(decision?.reason ?? "").startsWith("[K1Z] r4vn:") &&
    decision?.username !== SUBJECT_NAME
  );
  const decisionTelemetry = log.rows.filter((row) =>
    row.event === "hrafn_intent_decision"
  );
  const planTelemetry = log.rows.filter((row) =>
    row.event === "hrafn_intent_plan"
  );
  const retryTelemetry = log.rows.filter((row) =>
    row.event === "hrafn_intent_retry"
  );
  const unknownIntentTelemetry = log.rows.filter((row) =>
    String(row.event ?? "").startsWith("hrafn_intent_") &&
    ![
      "hrafn_intent_decision",
      "hrafn_intent_plan",
      "hrafn_intent_retry",
    ].includes(row.event)
  );
  const join = strictJoin(decisionTelemetry, subjectReplayRows);
  const sequence = replaySequenceAudit(parsedReplay.decisions);
  const recomputed = recomputeWrappedV5(join.joined);
  const planBinding = planBindingAudit(role, join.joined, planTelemetry);
  const binding = subjectJobBinding(run?.job, subjectSlot, role);
  const artifact = artifactsMatch(run, subjectSlot);
  const common = provenanceCommon?.pass !== undefined
    ? provenanceCommon
    : commonProvenanceAudit(provenanceCommon);
  const provenance = runProvenanceAudit(run, common, role);
  let chassis;
  try {
    chassis = auditHrafnChassisReplay(
      run?.replay,
      run?.replayBytes ?? Buffer.from(JSON.stringify(run?.replay ?? null)),
    );
  } catch (error) {
    chassis = {
      checks: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const chassisSafety = REQUIRED_CHASSIS_CHECKS.every((name) =>
    chassis?.checks?.[name] === true
  );
  const latency = latencyAudit(join.joined);
  const intent = intentAudit(role, join.joined, planTelemetry);
  const opening = openingAuc20(join.joined, artifact.result, artifact.finalPlayer);
  const resultsReliable =
    run?.results?.fallback_count === 0 &&
    run?.results?.degraded_count === 0 &&
    Number.isSafeInteger(run?.results?.decision_count) &&
    Number.isSafeInteger(run?.results?.accepted_decision_count) &&
    run.results.accepted_decision_count === run.results.decision_count;
  const replayReliable = subjectReplayRows.length > 0 && subjectReplayRows.every((row) =>
    row?.result?.accepted === true &&
    row?.fallbackUsed === false &&
    [null, undefined, false].includes(row?.llmPlannerDegraded) &&
    parseRawResponse(row?.rawLlmOutput).value?.llmPlannerDegraded === false &&
    row?.selectedActionKind !== "hold" &&
    row?.selectedLegalActionId !== "hold" &&
    !String(row?.selectedLegalActionId ?? "").startsWith("hold:")
  );
  const publicReasonsValid = subjectReplayRows.every((row) =>
    reasonMarkers(row.reason).valid
  );
  const strictJoinPass =
    parsedReplay.failures.length === 0 &&
    sequence.pass &&
    log.failures.length === 0 &&
    unknownIntentTelemetry.length === 0 &&
    retryTelemetry.length === 0 &&
    join.failures.length === 0 &&
    join.joined.length === subjectReplayRows.length &&
    join.joined.length === decisionTelemetry.length &&
    join.joined.length > 0;
  const reliability =
    provenance.pass &&
    artifact.valid &&
    chassisSafety &&
    resultsReliable &&
    replayReliable &&
    publicReasonsValid &&
    strictJoinPass &&
    latency.pass &&
    intent.planner_clean &&
    recomputed.pass &&
    recomputed.requestPass &&
    planBinding.pass &&
    log.errorLines.length === 0 &&
    foreignTagged.length === 0;
  const checks = {
    subject_job_binding: binding.valid,
    provenance_bound: provenance.pass,
    artifact_consistency: artifact.valid,
    strict_request_marker_join: strictJoinPass,
    replay_sequence_valid: sequence.pass,
    strict_order_binding: join.orderPass,
    raw_response_binding: join.rawResponsePass,
    request_payload_binding: recomputed.requestPass,
    baseline_recomputed: recomputed.pass,
    intent_plan_binding: planBinding.pass,
    public_reasons_valid: publicReasonsValid,
    replay_safety: chassisSafety,
    zero_foreign_tagged_decisions: foreignTagged.length === 0,
    zero_runtime_errors: log.errorLines.length === 0,
    zero_retry_events: retryTelemetry.length === 0,
    results_reliable: resultsReliable,
    replay_reliable: replayReliable,
    latency_within_bound: latency.pass,
    hi1_delta_semantics: intent.semantics_valid,
    planner_clean: intent.planner_clean,
    opening_metric_complete: opening.complete,
    control_zero_intent_activity: role === "control" ? intent.control_zero : true,
    candidate_intent_mode: role === "candidate" ? intent.candidate_mode : true,
    candidate_valid_coverage: intent.coverage_pass,
    candidate_intent_epochs: intent.epochs_pass,
    candidate_action_deltas: intent.deltas_pass && intent.delta_rate_pass,
    candidate_opening_reach: intent.opening_reach_pass,
    reliability,
  };
  const compactJoinRows = join.joined.map((entry) => ({
    request_marker: entry.marker,
    turn: entry.replay.turnNumber,
    action_id: entry.replay.selectedLegalActionId,
    baseline_action_id: entry.telemetry.baselineActionID,
    action_delta: entry.telemetry.actionDelta,
    intent_epoch: entry.telemetry.intentEpoch,
    intent_valid: entry.telemetry.intentValid,
    hi1: entry.parsed.markers.includes("hi1"),
    tiles_after: finiteNumber(entry.replay?.auditAfter?.tilesOwned),
    response_latency_ms: finiteNumber(entry.telemetry.responseLatencyMs),
    replay_latency_ms: finiteNumber(entry.replay.decisionLatencyMs),
    pretreatment_signature: pretreatmentSignature(entry),
  }));
  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_run_audit",
    campaign_id: CAMPAIGN_ID,
    role,
    subject_slot: subjectSlot,
    map: run?.job?.game_config?.map ?? null,
    seed: run?.job?.game_config?.seed ?? null,
    game_id: run?.results?.game_id ?? null,
    evidence_sha256: {
      job: sha256(run?.jobBytes ?? Buffer.from(JSON.stringify(run?.job ?? null))),
      results: sha256(run?.resultsBytes ?? Buffer.from(JSON.stringify(run?.results ?? null))),
      replay: sha256(run?.replayBytes ?? Buffer.from(JSON.stringify(run?.replay ?? null))),
      policy_log: sha256(Buffer.from(String(run?.policyLog ?? ""))),
    },
    score: finiteNumber(artifact.result?.score),
    final_tiles: finiteNumber(artifact.result?.tiles_owned),
    alive: artifact.result?.is_alive ?? null,
    opening_auc20: opening.value,
    opening_evidence: {
      observed_decisions: opening.observed,
      zero_padded_after_verified_elimination: opening.padded,
    },
    decision_count: join.joined.length,
    intent,
    latency,
    join: {
      joined_decisions: join.joined.length,
      failures: [
        ...parsedReplay.failures.map((failure) => ({ source: "replay", failure })),
        ...sequence.failures,
        ...log.failures,
        ...join.failures,
      ],
      rows: compactJoinRows,
    },
    telemetry: {
      plan_rows: planTelemetry.length,
      decision_rows: decisionTelemetry.length,
      unknown_rows: unknownIntentTelemetry.length,
      retry_rows: retryTelemetry.length,
      runtime_error_lines: log.errorLines,
    },
    provenance,
    recomputed_baseline: recomputed,
    intent_plan_binding: planBinding,
    chassis_audit: chassis,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

function compareJobs(control, candidate, subjectSlot) {
  const differences = deepDifferences(control, candidate);
  const expectedPath = `players[${subjectSlot}].env.HRAFN_INTENT_ENABLED`;
  return {
    valid:
      differences.length === 1 &&
      differences[0].path === expectedPath &&
      differences[0].control === "0" &&
      differences[0].candidate === "1",
    differences,
  };
}

export function auditHrafnIntentPair({ control, candidate, provenance } = {}) {
  const commonProvenance = commonProvenanceAudit(provenance);
  const controlAudit = auditHrafnIntentRun(control, commonProvenance);
  const candidateAudit = auditHrafnIntentRun(candidate, commonProvenance);
  const sameSubjectSlot =
    controlAudit.subject_slot === candidateAudit.subject_slot &&
    Number.isSafeInteger(controlAudit.subject_slot);
  const jobs = sameSubjectSlot
    ? compareJobs(control.job, candidate.job, controlAudit.subject_slot)
    : { valid: false, differences: [] };
  const pretreatment = pretreatmentAudit(controlAudit, candidateAudit);
  const controlAuc = controlAudit.opening_auc20;
  const candidateAuc = candidateAudit.opening_auc20;
  const relativeLift =
    finiteNumber(controlAuc) !== null &&
      finiteNumber(candidateAuc) !== null &&
      controlAuc > 0
      ? (candidateAuc - controlAuc) / controlAuc
      : null;
  const operational =
    controlAudit.pass &&
    candidateAudit.checks.reliability &&
    candidateAudit.checks.candidate_intent_mode;
  const reach =
    candidateAudit.checks.candidate_valid_coverage &&
    candidateAudit.checks.candidate_intent_epochs &&
    candidateAudit.checks.candidate_action_deltas &&
    candidateAudit.checks.candidate_opening_reach &&
    candidateAudit.checks.hi1_delta_semantics;
  const checks = {
    provenance_bound:
      commonProvenance.pass &&
      controlAudit.checks.provenance_bound &&
      candidateAudit.checks.provenance_bound,
    jobs_only_intent_flag: jobs.valid,
    same_map_seed_slot:
      sameSubjectSlot &&
      controlAudit.map === candidateAudit.map &&
      controlAudit.seed === candidateAudit.seed,
    control_clean: controlAudit.pass,
    candidate_operational: candidateAudit.checks.reliability,
    candidate_reach: reach,
    pretreatment_equivalent: pretreatment.pass,
    opening_metrics_complete:
      controlAudit.checks.opening_metric_complete &&
      candidateAudit.checks.opening_metric_complete,
    positive_opening_lift:
      relativeLift !== null &&
      candidateAuc > controlAuc,
  };
  const safetyOrReliability =
    !checks.provenance_bound ||
    !jobs.valid ||
    !checks.same_map_seed_slot ||
    !operational ||
    !pretreatment.pass ||
    !checks.opening_metrics_complete;
  const verdict = safetyOrReliability
    ? "REJECT_SAFETY_OR_RELIABILITY"
    : !reach
      ? "REJECT_NO_REACH"
      : !checks.positive_opening_lift
        ? "REJECT_NO_LIFT"
        : "PAIR_PASS";
  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_pair_audit",
    campaign_id: CAMPAIGN_ID,
    map: candidateAudit.map,
    seed: candidateAudit.seed,
    subject_slot: candidateAudit.subject_slot,
    control: controlAudit,
    candidate: candidateAudit,
    provenance: {
      pass: commonProvenance.pass,
      failures: commonProvenance.failures,
      fingerprint: commonProvenance.fingerprint,
      identity_window_message_id:
        commonProvenance.identityWindow?.message_id ?? null,
      identity_window_file_sha256:
        commonProvenance.identityWindowReport?.file_sha256 ?? null,
      formal_approvals_consumed: 0,
      manifest_sha256: commonProvenance.manifestSHA256 ?? null,
    },
    job_comparison: jobs,
    pair: {
      control_opening_auc20: controlAuc,
      candidate_opening_auc20: candidateAuc,
      opening_auc20_relative_lift: relativeLift,
      control_score: controlAudit.score,
      candidate_score: candidateAudit.score,
      control_final_tiles: controlAudit.final_tiles,
      candidate_final_tiles: candidateAudit.final_tiles,
      pretreatment_compared_decisions: pretreatment.compared_decisions,
      pretreatment_failures: pretreatment.failures,
    },
    checks,
    verdict,
  };
}

export function auditHrafnIntentCampaign(pairArtifacts) {
  const parsedArtifacts = Array.isArray(pairArtifacts)
    ? pairArtifacts.map((artifact) => {
        if (!plainObject(artifact) || !Buffer.isBuffer(artifact.bytes)) {
          return { report: null, sha256: null, valid: false };
        }
        try {
          const parsed = JSON.parse(artifact.bytes.toString("utf8"));
          return {
            report: parsed,
            sha256: sha256(artifact.bytes),
            valid:
              canonicalJSON(parsed) === canonicalJSON(artifact.report) &&
              parsed?.record_type === "hrafn_intent_i1_pair_audit",
          };
        } catch {
          return { report: null, sha256: sha256(artifact.bytes), valid: false };
        }
      })
    : [];
  const pairs = parsedArtifacts.map((artifact) => artifact.report);
  const maps = pairs.map((pair) => pair?.map).sort();
  const cells = pairs.map((pair) => ({
    map: pair?.map,
    seed: pair?.seed,
    subject_slot: pair?.subject_slot,
  })).sort((left, right) => String(left.map).localeCompare(String(right.map)));
  const expectedCells = canonicalJSON(cells) === canonicalJSON([
    { map: "Asia", seed: 240722, subject_slot: 2 },
    { map: "Pangaea", seed: 240721, subject_slot: 1 },
  ]);
  const relativeLifts = pairs.map((pair) =>
    finiteNumber(pair?.pair?.opening_auc20_relative_lift)
  );
  const meanRelativeLift =
    relativeLifts.length === 2 && relativeLifts.every((value) => value !== null)
      ? relativeLifts.reduce((sum, value) => sum + value, 0) / 2
      : null;
  const sumField = (side, field) => pairs.reduce((sum, pair) => {
    const value = finiteNumber(pair?.pair?.[`${side}_${field}`]);
    return value === null ? Number.NaN : sum + value;
  }, 0);
  const controlScore = sumField("control", "score");
  const candidateScore = sumField("candidate", "score");
  const controlTiles = sumField("control", "final_tiles");
  const candidateTiles = sumField("candidate", "final_tiles");
  const safetyClean = pairs.every((pair) =>
    pair?.verdict !== "REJECT_SAFETY_OR_RELIABILITY" &&
    pair?.checks?.jobs_only_intent_flag === true &&
    pair?.checks?.pretreatment_equivalent === true
  );
  const reach = pairs.every((pair) => pair?.checks?.candidate_reach === true);
  const provenanceFingerprints = new Set(pairs.map((pair) =>
    pair?.provenance?.fingerprint
  ));
  const pangaeaArtifact = parsedArtifacts.find((artifact) =>
    artifact.report?.map === "Pangaea"
  );
  const pangaeaPair = pangaeaArtifact?.report;
  const runSequence = [
    pangaeaPair?.control,
    pangaeaPair?.candidate,
    pairs.find((pair) => pair?.map === "Asia")?.candidate,
    pairs.find((pair) => pair?.map === "Asia")?.control,
  ];
  const pangaeaCanContinue =
    ["PAIR_PASS", "REJECT_NO_LIFT"].includes(pangaeaPair?.verdict) &&
    pangaeaPair?.checks?.provenance_bound === true &&
    pangaeaPair?.checks?.control_clean === true &&
    pangaeaPair?.checks?.candidate_operational === true &&
    pangaeaPair?.checks?.candidate_reach === true &&
    pangaeaPair?.checks?.pretreatment_equivalent === true;
  let lifecyclePass = runSequence.every((run, order) =>
    run?.provenance?.campaign_order === order &&
    run?.provenance?.lifecycle?.active_order === order &&
    Array.isArray(run?.provenance?.lifecycle?.predecessors) &&
    run.provenance.lifecycle.predecessors.length === order &&
    run.provenance.lifecycle.predecessors.every((entry, index) =>
      entry?.job_id === HRAFN_INTENT_CELLS[index].id &&
      entry?.order === index &&
      entry?.file_sha256 === runSequence[index]?.provenance?.operational_sha256)
  );
  for (let order = 1; order < runSequence.length && lifecyclePass; order += 1) {
    const previousCompleted = Date.parse(
      runSequence[order - 1]?.provenance?.completed_at,
    );
    const currentPreflight = Date.parse(
      runSequence[order]?.provenance?.preflight_verified_at,
    );
    const currentStarted = Date.parse(runSequence[order]?.provenance?.started_at);
    if (!Number.isFinite(previousCompleted) || !Number.isFinite(currentPreflight) ||
      !Number.isFinite(currentStarted) || previousCompleted > currentPreflight ||
      currentPreflight > currentStarted
    ) {
      lifecyclePass = false;
    }
  }
  if (lifecyclePass) {
    lifecyclePass = runSequence.every((run, order) => {
      const continuation = run?.provenance?.lifecycle?.pangaea_continuation;
      if (order < 2) return continuation === null;
      return pangaeaCanContinue &&
        continuation?.file_sha256 === pangaeaArtifact?.sha256 &&
        continuation?.verdict === pangaeaPair?.verdict &&
        continuation?.control_operational_sha256 ===
          runSequence[0]?.provenance?.operational_sha256 &&
        continuation?.candidate_operational_sha256 ===
          runSequence[1]?.provenance?.operational_sha256;
    });
  }
  const checks = {
    exact_pair_report_files:
      parsedArtifacts.length === 2 && parsedArtifacts.every((artifact) => artifact.valid),
    shared_campaign_provenance:
      provenanceFingerprints.size === 1 &&
      !provenanceFingerprints.has(null) &&
      !provenanceFingerprints.has(undefined),
    exact_preregistered_cells: expectedCells,
    dispatch_order_and_stop_rule: lifecyclePass,
    all_pairs_safety_reliable: safetyClean,
    all_pairs_reached: reach,
    positive_lift_each_cell: pairs.length === 2 && pairs.every((pair) =>
      pair?.checks?.positive_opening_lift === true
    ),
    mean_relative_lift_at_least_10_percent:
      meanRelativeLift !== null && meanRelativeLift >= 0.1,
    combined_score_veto:
      Number.isFinite(controlScore) &&
      Number.isFinite(candidateScore) &&
      candidateScore >= controlScore,
    combined_tiles_veto:
      Number.isFinite(controlTiles) &&
      Number.isFinite(candidateTiles) &&
      candidateTiles >= controlTiles,
  };
  const verdict =
    !checks.exact_pair_report_files ||
        !checks.shared_campaign_provenance ||
        !checks.exact_preregistered_cells ||
        !checks.dispatch_order_and_stop_rule ||
        !checks.all_pairs_safety_reliable
      ? "REJECT_SAFETY_OR_RELIABILITY"
      : !checks.all_pairs_reached
        ? "REJECT_NO_REACH"
        : !checks.positive_lift_each_cell ||
            !checks.mean_relative_lift_at_least_10_percent ||
            !checks.combined_score_veto ||
            !checks.combined_tiles_veto
          ? "REJECT_NO_LIFT"
          : "PROMISING_DIAGNOSTIC_ONLY";
  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_campaign_audit",
    campaign_id: CAMPAIGN_ID,
    pair_count: pairs.length,
    pair_reports: parsedArtifacts.map((artifact) => ({
      sha256: artifact.sha256,
      map: artifact.report?.map ?? null,
      seed: artifact.report?.seed ?? null,
      subject_slot: artifact.report?.subject_slot ?? null,
    })),
    maps,
    mean_relative_opening_lift: meanRelativeLift,
    combined_control_score: Number.isFinite(controlScore) ? controlScore : null,
    combined_candidate_score: Number.isFinite(candidateScore) ? candidateScore : null,
    combined_control_final_tiles: Number.isFinite(controlTiles) ? controlTiles : null,
    combined_candidate_final_tiles: Number.isFinite(candidateTiles) ? candidateTiles : null,
    checks,
    verdict,
  };
}

function parseArguments(argv) {
  const allowed = new Set([
    "control-dir",
    "candidate-dir",
    "control-job",
    "candidate-job",
    "control-preflight-spec",
    "candidate-preflight-spec",
    "preregistration",
    "image-receipt",
    "manifest",
    "identity-window",
    "subject-slot",
    "output",
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument ${argument}`);
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator >= 0 ? separator : undefined);
    if (!allowed.has(name)) throw new Error(`unknown option --${name}`);
    if (Object.hasOwn(values, name)) throw new Error(`duplicate option --${name}`);
    const value = separator >= 0 ? argument.slice(separator + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    values[name] = value;
  }
  for (const required of [
    "control-dir",
    "candidate-dir",
    "control-job",
    "candidate-job",
    "control-preflight-spec",
    "candidate-preflight-spec",
    "preregistration",
    "image-receipt",
    "manifest",
    "identity-window",
    "subject-slot",
  ]) {
    if (!values[required]) throw new Error(`missing --${required}`);
  }
  const subjectSlot = Number(values["subject-slot"]);
  if (!Number.isSafeInteger(subjectSlot) || subjectSlot < 0 || subjectSlot > 3) {
    throw new Error("--subject-slot must be 0 through 3");
  }
  return {
    controlDir: path.resolve(values["control-dir"]),
    candidateDir: path.resolve(values["candidate-dir"]),
    controlJob: path.resolve(values["control-job"]),
    candidateJob: path.resolve(values["candidate-job"]),
    controlPreflightSpec: path.resolve(values["control-preflight-spec"]),
    candidatePreflightSpec: path.resolve(values["candidate-preflight-spec"]),
    preregistration: path.resolve(values.preregistration),
    imageReceipt: path.resolve(values["image-receipt"]),
    manifest: path.resolve(values.manifest),
    identityWindow: path.resolve(values["identity-window"]),
    subjectSlot,
    output: values.output ? path.resolve(values.output) : null,
  };
}

async function loadRun(role, directory, jobPath, preflightSpecPath, subjectSlot) {
  const [
    jobBytes,
    resultsBytes,
    replayBytes,
    policyLog,
    preflightSpecBytes,
    preflightBytes,
    operationalBytes,
  ] = await Promise.all([
    readFile(jobPath),
    readFile(path.join(directory, "results.json")),
    readFile(path.join(directory, "replay")),
    readFile(path.join(directory, "logs", `policy_agent_${subjectSlot}.log`), "utf8"),
    readFile(preflightSpecPath),
    readFile(path.join(directory, "hrafn-intent-preflight-receipt.json")),
    readFile(path.join(directory, "hrafn-operational-receipt.json")),
  ]);
  return {
    role,
    job: JSON.parse(jobBytes),
    jobBytes,
    results: JSON.parse(resultsBytes),
    resultsBytes,
    replay: JSON.parse(replayBytes),
    replayBytes,
    policyLog,
    subjectSlot,
    provenance: {
      preflightSpec: JSON.parse(preflightSpecBytes),
      preflightSpecBytes,
      preflight: JSON.parse(preflightBytes),
      preflightBytes,
      operational: JSON.parse(operationalBytes),
      operationalBytes,
    },
  };
}

async function runCampaignCLI(argv) {
  const value = (name) => {
    const exact = `--${name}`;
    const index = argv.indexOf(exact);
    const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
    return inline ? inline.slice(exact.length + 1) : index >= 0 ? argv[index + 1] : null;
  };
  const pangaeaPath = value("pangaea-pair");
  const asiaPath = value("asia-pair");
  if (!pangaeaPath || !asiaPath) {
    throw new Error("campaign mode requires --pangaea-pair and --asia-pair");
  }
  const artifacts = await Promise.all([pangaeaPath, asiaPath].map(async (target) => {
    const bytes = await readFile(path.resolve(target));
    return { report: JSON.parse(bytes), bytes };
  }));
  const report = auditHrafnIntentCampaign(artifacts);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = value("output");
  if (outputPath) await writeFile(path.resolve(outputPath), output, { mode: 0o600 });
  process.stdout.write(output);
  if (report.verdict !== "PROMISING_DIAGNOSTIC_ONLY") process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((argument) => argument === "--campaign" || argument.startsWith("--campaign="))) {
    await runCampaignCLI(argv.filter((argument) => argument !== "--campaign"));
    return;
  }
  const options = parseArguments(argv);
  const [control, candidate] = await Promise.all([
    loadRun(
      "control",
      options.controlDir,
      options.controlJob,
      options.controlPreflightSpec,
      options.subjectSlot,
    ),
    loadRun(
      "candidate",
      options.candidateDir,
      options.candidateJob,
      options.candidatePreflightSpec,
      options.subjectSlot,
    ),
  ]);
  const [
    preregistrationBytes,
    imageReceiptBytes,
    manifestBytes,
    identityWindowBytes,
  ] = await Promise.all([
    readFile(options.preregistration),
    readFile(options.imageReceipt),
    readFile(options.manifest),
    readFile(options.identityWindow),
  ]);
  const provenance = {
    preregistration: JSON.parse(preregistrationBytes),
    preregistrationBytes,
    imageReceipt: JSON.parse(imageReceiptBytes),
    imageReceiptBytes,
    manifestBytes,
    identityWindowBytes,
  };
  const report = auditHrafnIntentPair({ control, candidate, provenance });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(options.output, output, { mode: 0o600 });
  process.stdout.write(output);
  if (!["PAIR_PASS", "REJECT_NO_LIFT"].includes(report.verdict)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
