import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chooseHrafnIntentDecision } from "../hrafn-intent.mjs";
import {
  publicHrafnReason,
  recordHrafnDecision,
} from "../hrafn-strategy.mjs";
import {
  sealK1ZPacket,
  serializeK1ZPacket,
  verifyK1ZPacketBytes,
} from "../k1z-direct-line.mjs";
import {
  HRAFN_INTENT_CONTAINER_FILES,
  HRAFN_INTENT_IMAGE_FILES,
  HRAFN_INTENT_RUNTIME_IMPORTS,
  HRAFN_INTENT_RUNTIME_SYNTAX_FILES,
  hrafnIntentReceiptContentSHA256,
  serializeHrafnIntentImageReceipt,
} from "../scripts/create-hrafn-intent-image-receipt.mjs";
import {
  auditHrafnIntentCampaign,
  auditHrafnIntentPair,
  auditHrafnIntentRun,
  hrafnIntentRequestMarker,
} from "../scripts/audit-hrafn-intent-pair.mjs";

const SUBJECT_SLOT = 1;
const SUBJECT_NAME = "K1Z Hrafn";
const SUBJECT_ID = "hrafn-runtime";
const IDENTITY_PLAYER_ID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
const OLLAMA_MODEL_DIGEST =
  "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1";
const MANIFEST_BYTES = readFileSync(
  "/private/tmp/hrafn-c4-crossover-20260720-r1/coworld-manifest-0.1.28.json",
);
const MANIFEST_SHA256 =
  "8feb5100ee63d5ccca66794c40e535f2715376e2a2cf8a3f8ed892880dfe65f3";
const SOURCE_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SUBJECT_IMAGE =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OPPONENT_IMAGE =
  "sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d";

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

function payloadSHA256(value) {
  return createHash("sha256").update(canonicalJSON(value)).digest("hex");
}

function requestMarker(requestID) {
  return `q${createHash("sha256").update(requestID).digest("hex").slice(0, 10)}`;
}

function job(intentEnabled, {
  map = "Pangaea",
  seed = 240721,
  subjectSlot = map === "Asia" ? 2 : SUBJECT_SLOT,
} = {}) {
  const outsiders = ["Frozen v5 Alpha", "Frozen v5 Beta", "Frozen v5 Gamma"];
  let outsiderIndex = 0;
  const names = Array.from({ length: 4 }, (_unused, slot) =>
    slot === subjectSlot ? SUBJECT_NAME : outsiders[outsiderIndex++]
  );
  return {
    manifest: { id: "coworld-0.1.28" },
    game_config: {
      map,
      map_size: "Compact",
      difficulty: "Easy",
      num_agents: 4,
      max_decision_steps: 300,
      turns_per_decision_step: 100,
      max_decision_ms: 15000,
      players: names.map((name) => ({ name })),
      seed,
      tokens: null,
    },
    players: names.map((_name, slot) => slot === subjectSlot
      ? {
          type: "player",
          image: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          run: ["node", "/app/hrafn-intent-player.mjs"],
          env: {
            HRAFN_INTENT_ENABLED: intentEnabled ? "1" : "0",
            HRAFN_INTENT_ENDPOINT: "http://host.docker.internal:11434/api/generate",
            HRAFN_INTENT_TIMEOUT_MS: "4000",
            HRAFN_RV1: "1",
          },
        }
      : {
          type: "player",
          image: "sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d",
          run: ["node", "/app/hrafn-player.mjs"],
          env: { HRAFN_RV1: "1" },
        }),
  };
}

function playerRows(finalTiles, score, alive = true, subjectSlot = SUBJECT_SLOT) {
  const outsiders = ["Frozen v5 Alpha", "Frozen v5 Beta", "Frozen v5 Gamma"];
  let outsiderIndex = 0;
  const names = Array.from({ length: 4 }, (_unused, slot) =>
    slot === subjectSlot ? SUBJECT_NAME : outsiders[outsiderIndex++]
  );
  return names.map((name, slot) => ({
    slot,
    name,
    score: slot === subjectSlot ? score : (1 - score) / 3,
    tiles_owned: slot === subjectSlot ? finalTiles : 1000 + slot,
    is_alive: slot === subjectSlot ? alive : true,
  }));
}

function runFixture(role, {
  map = "Pangaea",
  seed = 240721,
  decisions = 24,
  deltaIndexes = null,
  finalTiles = role === "candidate" ? 3200 : 2500,
  score = role === "candidate" ? 0.4 : 0.3,
  alive = true,
  subjectSlot = map === "Asia" ? 2 : SUBJECT_SLOT,
} = {}) {
  const intentEnabled = role === "candidate";
  const telemetry = [];
  const replayDecisions = [{
    sequence: 1,
    turnNumber: 0,
    agentID: `opportunistic-agent-${subjectSlot + 1}`,
    username: SUBJECT_NAME,
    actionSelectionSource: "deterministic-spawn",
    externalActionCall: false,
    selectedLegalActionId: "spawn:100",
    selectedActionKind: "spawn",
    selectedActionMetadata: { tile: 100 },
    legalActionIDs: ["spawn:100", "hold"],
    legalActionIDsByKind: { spawn: ["spawn:100"], hold: ["hold"] },
    reason: "deterministic built-in-style spawn exploration",
    fallbackUsed: false,
    llmPlannerDegraded: false,
    result: {
      accepted: true,
      submittedIntent: { type: "spawn", tile: 100 },
    },
    auditBefore: null,
    auditAfter: {
      playerID: SUBJECT_ID,
      isAlive: true,
      hasSpawned: true,
      tilesOwned: 50,
      troops: 30000,
      gold: "1000",
      unitCounts: {},
      unitLevels: {},
      unitTiles: {},
      outgoingAttackTargetIDs: [],
      outgoingAttackIDs: [],
      outgoingAllianceRequestRecipientIDs: [],
      outgoingEmbargoTargetIDs: [],
      targetPlayerIDs: [],
      transportRetreatingUnitIDs: [],
    },
    decisionLatencyMs: 0,
  }];

  const history = [];
  const subjectRuntimeID = `${role}-hrafn-runtime`;
  const outsiderNames = [
    "Frozen v5 Alpha",
    "Frozen v5 Beta",
    "Frozen v5 Gamma",
  ];
  const outsiderIDs = outsiderNames.map((_name, index) =>
    `${role}-outsider-${index}`
  );
  let plannerAttempts = 0;

  for (let index = 0; index < decisions; index += 1) {
    if (intentEnabled && (index === 1 || index === 13)) {
      plannerAttempts += 1;
      const sourceDecision = index === 1 ? 1 : 13;
      telemetry.push({
        event: "hrafn_intent_plan",
        attempt: plannerAttempts,
        ok: true,
        model: "llama3:latest",
        expectedModel: "llama3:latest",
        expectedModelDigest: OLLAMA_MODEL_DIGEST,
        latencyMs: 11 + plannerAttempts,
        intentEpoch: plannerAttempts,
        intentObjective: "grow",
        intentTargetID: null,
        intentHorizon: 12,
        intentSourceDecision: sourceDecision,
        intentAge: 0,
        nextPlanEligibleDecision: sourceDecision,
        error: null,
      });
    }

    const requestID = `${role}-request-${index}`;
    const marker = requestMarker(requestID);
    const rivalIndex = index % 3;
    const rival = {
      id: outsiderIDs[rivalIndex],
      name: outsiderNames[rivalIndex],
      tileShare: 0.25 - (rivalIndex * 0.01),
      relativeTroopRatio: 1.5,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      incomingAttack: false,
      isAlive: true,
    };
    const turnNumber = (index + 1) * 100;
    const baselineAfter = 100 + ((index + 1) * 100);
    const candidateLift = role === "candidate" && index >= 3
      ? (index - 2) * 30
      : 0;
    const tilesAfter = baselineAfter + candidateLift;
    const previousLift = role === "candidate" && index >= 4
      ? (index - 3) * 30
      : 0;
    const tilesBefore = index === 0
      ? 50
      : 100 + (index * 100) + previousLift;
    const legalActions = [
      {
        id: `attack:${rival.id}:25`,
        kind: "attack",
        label: `Attack ${rival.name} 25%`,
        metadata: {
          targetID: rival.id,
          targetName: rival.name,
          troopPercent: 25,
          troops: 25,
        },
        risk: { level: "low" },
      },
      {
        id: "expand:terra-nullius:35",
        kind: "attack",
        label: "Expand Terra Nullius 35%",
        metadata: {
          expansion: true,
          troopPercent: 35,
          troops: 35,
        },
        risk: { level: "low" },
      },
      {
        id: "hold",
        kind: "hold",
        label: "Hold",
        metadata: {},
        risk: { level: "low" },
      },
    ];
    const observation = {
      turnNumber,
      ownState: {
        playerID: subjectRuntimeID,
        tileShare: 0.12,
        tilesOwned: tilesBefore,
        troopRatio: 1,
        troops: 500000,
        gold: 250000,
        incomingAttacks: 0,
      },
      combat: { incomingAttackPlayerIDs: [] },
      visiblePlayers: [rival],
    };
    const decisionInput = {
      observation,
      legalActions,
    };
    const intent = intentEnabled && index > 0 &&
        (deltaIndexes === null || deltaIndexes.has(index))
      ? { objective: "grow", targetID: null, horizon: 12 }
      : null;
    const chosen = chooseHrafnIntentDecision({
      actions: legalActions,
      observation,
      history,
      intent,
      rv1Enabled: true,
    });
    const delta = chosen.actionDelta === true;
    const intentEpoch = intent ? (index <= 12 ? 1 : 2) : 0;
    const intentSourceDecision = intentEpoch === 1
      ? 1
      : intentEpoch === 2
        ? 13
        : null;
    const intentAge = intent
      ? index - intentSourceDecision
      : null;
    const usage = intentEpoch === 1 ? index - 1 : index - 13;
    const intentRemainingBeforeCommit = intent ? 12 - usage : 0;
    const wireAction = { ...chosen.action, requestMarker: marker };
    const reason = publicHrafnReason(wireAction);
    const response = {
      type: "decision_response",
      requestID,
      selectedLegalActionId: wireAction.id,
      reason,
      confidence: wireAction.kind === "hold" ? 0.5 : 0.82,
      fallbackUsed: false,
      llmPlannerDegraded: false,
    };
    telemetry.push({
      event: "hrafn_intent_decision",
      requestID,
      requestMarker: marker,
      requestPayloadSHA256: payloadSHA256(decisionInput),
      decisionInput,
      selectedAction: wireAction,
      rawLlmOutput: response,
      turnNumber,
      decisionIndex: index + 1,
      actionID: wireAction.id,
      baselineActionID: chosen.baseline.id,
      actionDelta: delta,
      intentEnabled,
      intentEpoch,
      intentObjective: intent?.objective ?? null,
      intentTargetID: null,
      intentHorizon: intent?.horizon ?? null,
      intentSourceDecision,
      intentAge,
      intentRemaining: intentRemainingBeforeCommit,
      intentRemainingBeforeCommit,
      intentValid: chosen.intentValid,
      intentApplied: chosen.intentApplied,
      intentReason: chosen.reason,
      intentFailure: null,
      planAgeDecisions: chosen.intentValid ? intentAge : null,
      intentFallback: false,
      plannerPending: false,
      plannerDegraded: false,
      plannerAttempts,
      plannerFailures: 0,
      plannerLatencyMs: plannerAttempts > 0 ? 11 + plannerAttempts : null,
      plannerError: null,
      model: "llama3:latest",
      expectedModelDigest: OLLAMA_MODEL_DIGEST,
      safetyRejectedCount: chosen.safetyRejectedCount,
      wrapperOmittedCount: chosen.wrapperOmittedCount,
      legalActionCount: legalActions.length,
      fallbackUsed: false,
      duplicateRequest: false,
      wireRetry: false,
      cacheConflict: null,
      responseLatencyMs: 5 + (index % 4),
    });
    const inputSelected = legalActions.find((action) => action.id === wireAction.id);
    replayDecisions.push({
      sequence: index + 2,
      turnNumber,
      agentID: `opportunistic-agent-${subjectSlot + 1}`,
      username: SUBJECT_NAME,
      actionSelectionSource: "external-http",
      externalActionCall: true,
      rawProviderOutputPresent: true,
      selectedLegalActionId: wireAction.id,
      selectedActionKind: wireAction.kind,
      selectedActionMetadata: structuredClone(inputSelected.metadata),
      legalActionIDs: legalActions.map((action) => action.id),
      legalActionIDsByKind: {
        attack: legalActions.filter((action) => action.kind === "attack")
          .map((action) => action.id),
        hold: ["hold"],
      },
      reason,
      confidence: response.confidence,
      rawLlmOutput: JSON.stringify(response),
      parseSuccess: true,
      fallbackUsed: false,
      llmPlannerDegraded: null,
      result: {
        accepted: true,
        submittedIntent: {
          type: "attack",
          targetID: inputSelected.metadata.targetID ?? null,
          troops: inputSelected.metadata.troopPercent,
        },
      },
      auditBefore: {
        tick: turnNumber,
        playerID: subjectRuntimeID,
        isAlive: true,
        hasSpawned: true,
        tilesOwned: tilesBefore,
        troops: 30000 + index,
        gold: String(1000 + index),
        unitCounts: {},
        unitLevels: {},
        unitTiles: {},
        outgoingAttackTargetIDs: [],
        outgoingAttackIDs: [],
        outgoingAllianceRequestRecipientIDs: [],
        outgoingEmbargoTargetIDs: [],
        targetPlayerIDs: [],
        transportRetreatingUnitIDs: [],
      },
      auditAfter: {
        tick: turnNumber + 1,
        playerID: subjectRuntimeID,
        isAlive: true,
        hasSpawned: true,
        tilesOwned: tilesAfter,
        troops: 30001 + index,
        gold: String(999 + index),
        unitCounts: {},
        unitLevels: {},
        unitTiles: {},
        outgoingAttackTargetIDs: [],
        outgoingAttackIDs: [],
        outgoingAllianceRequestRecipientIDs: [],
        outgoingEmbargoTargetIDs: [],
        targetPlayerIDs: [],
        transportRetreatingUnitIDs: [],
      },
      auditTargetBefore: inputSelected.metadata.targetID
        ? {
            playerID: inputSelected.metadata.targetID,
            isAlive: true,
            tilesOwned: 2500,
            troops: 100000,
          }
        : null,
      auditTargetAfter: inputSelected.metadata.targetID
        ? {
            playerID: inputSelected.metadata.targetID,
            isAlive: true,
            tilesOwned: 2500,
            troops: 99975,
          }
        : null,
      decisionLatencyMs: 8 + (index % 5),
    });
    recordHrafnDecision(history, wireAction, observation);
  }

  const players = playerRows(finalTiles, score, alive, subjectSlot);
  const results = {
    scores: players.map((player) => player.score),
    winner_slot: null,
    turn_count: decisions * 100,
    tick: decisions * 100,
    decision_count: replayDecisions.length + (decisions * 3),
    accepted_decision_count: replayDecisions.length + (decisions * 3),
    fallback_count: 0,
    degraded_count: 0,
    players,
    seed,
    game_id: `HI1-${role}-${map}`,
  };
  const replay = {
    gameID: results.game_id,
    seed,
    config: {
      players: structuredClone(
        job(intentEnabled, { map, seed, subjectSlot }).game_config.players,
      ),
      max_decision_steps: 300,
      turns_per_decision_step: 100,
      max_decision_ms: 15000,
      map,
      map_size: "Compact",
      difficulty: "Easy",
      player_count: 4,
    },
    results: structuredClone(results),
    finalState: {
      phase: "active",
      winnerSlot: null,
      tick: results.tick,
      turnCount: results.turn_count,
      players: players.map((player) => ({
        agentID: `opportunistic-agent-${player.slot + 1}`,
        username: player.name,
        playerID: player.slot === subjectSlot
          ? subjectRuntimeID
          : outsiderIDs[player.slot < subjectSlot ? player.slot : player.slot - 1],
        isAlive: player.is_alive,
        tilesOwned: player.tiles_owned,
      })),
    },
    inlineRunArtifacts: {
      "decisions.jsonl": `${replayDecisions.map((row) => JSON.stringify(row)).join("\n")}\n`,
    },
  };
  return {
    role,
    job: job(intentEnabled, { map, seed, subjectSlot }),
    results,
    replay,
    policyLog: `${telemetry.map((row) => JSON.stringify(row)).join("\n")}\n`,
    subjectSlot,
  };
}

function wire(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function campaignJobs() {
  return [
    ["pangaea-control", 0, "control", "Pangaea", 240721, 1],
    ["pangaea-candidate", 1, "candidate", "Pangaea", 240721, 1],
    ["asia-candidate", 2, "candidate", "Asia", 240722, 2],
    ["asia-control", 3, "control", "Asia", 240722, 2],
  ].map(([id, order, role, map, seed, subject_slot]) => ({
    id,
    order,
    role,
    map,
    seed,
    subject_slot,
    sha256: createHash("sha256").update(wire(job(
      role === "candidate",
      { map, seed, subjectSlot: subject_slot },
    ))).digest("hex"),
  }));
}

function provenanceFixture(control, candidate, { pangaeaReport = null } = {}) {
  const campaignTimestamp = (order, seconds) => new Date(
    Date.parse("2026-07-20T20:50:00.000Z") +
      (order * 10 * 60 * 1000) + (seconds * 1000),
  ).toISOString();
  const preregistration = {
    schema_version: 2,
    record_type: "hrafn_intent_i1_preregistration",
    campaign_id: "hrafn-intent-i1",
    status: "PREREGISTERED_AMENDED_NO_RUNTIME_AUTHORITY",
    intent_contract: {
      planner: { model: "llama3:latest", model_digest: OLLAMA_MODEL_DIGEST },
    },
    pilot: { coworld_client: "0.1.28", manifest_sha256: MANIFEST_SHA256 },
  };
  const preregistrationBytes = wire(preregistration);
  const fileDigests = [...HRAFN_INTENT_IMAGE_FILES].sort().map((file) => ({
    path: file,
    sha256: file ===
        "experiments/hrafn-intent-i1-preregistration-20260720.json"
      ? payloadSHA256Raw(preregistrationBytes)
      : createHash("sha256").update(file).digest("hex"),
  }));
  const fileMap = new Map(fileDigests.map((entry) => [entry.path, entry.sha256]));
  const imageReceipt = {
    schema_version: 2,
    record_type: "hrafn_intent_i1_image_receipt",
    campaign_id: "hrafn-intent-i1",
    created_at: "2026-07-20T20:30:00.000Z",
    source: {
      commit: SOURCE_COMMIT,
      branch: "feature/k1z-hrafn-fylking",
      upstream_ref: "origin/feature/k1z-hrafn-fylking",
      remote_name: "origin",
      remote_ref: "refs/heads/feature/k1z-hrafn-fylking",
      upstream_commit: SOURCE_COMMIT,
      remote_commit: SOURCE_COMMIT,
      clean: true,
      pushed: true,
    },
    image: {
      requested_reference: "hrafn-intent:i1",
      id: SUBJECT_IMAGE,
      os: "linux",
      architecture: "amd64",
      working_dir: "/app",
      entrypoint: ["docker-entrypoint.sh"],
      cmd: ["node", "/app/hrafn-intent-player.mjs"],
      container_files: [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) => ({
        path: `/app/${file}`,
        sha256: fileMap.get(file),
      })),
      runtime_smoke: {
        node_version: "v24.4.1",
        syntax_files: [...HRAFN_INTENT_RUNTIME_SYNTAX_FILES],
        module_imports: [...HRAFN_INTENT_RUNTIME_IMPORTS],
      },
    },
    coworld_player_run: ["node", "/app/hrafn-intent-player.mjs"],
    files: fileDigests,
    tests: {
      argv: ["npm", "test"],
      exit_code: 0,
      stdout_sha256: "1".repeat(64),
      stderr_sha256: "2".repeat(64),
    },
    planner: {
      model: "llama3:latest",
      model_digest: OLLAMA_MODEL_DIGEST,
      ollama_version: "0.32.1",
    },
    opponent: { image_id: OPPONENT_IMAGE },
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-json-v1-excluding-integrity",
      content_sha256: "0".repeat(64),
    },
  };
  imageReceipt.integrity.content_sha256 =
    hrafnIntentReceiptContentSHA256(imageReceipt);
  const imageReceiptBytes = Buffer.from(serializeHrafnIntentImageReceipt(imageReceipt));
  const jobs = campaignJobs();
  const bindings = {
    scope: "hrafn-only",
    source_commit: SOURCE_COMMIT,
    subject_image_id: SUBJECT_IMAGE,
    image_receipt: {
      file_sha256: payloadSHA256Raw(imageReceiptBytes),
      content_sha256: imageReceipt.integrity.content_sha256,
    },
    preregistration: {
      file_sha256: payloadSHA256Raw(preregistrationBytes),
      content_sha256: payloadSHA256(preregistration),
    },
    manifest_sha256: MANIFEST_SHA256,
    planner: {
      model: "llama3:latest",
      model_digest: OLLAMA_MODEL_DIGEST,
      ollama_version: "0.32.1",
    },
    jobs,
  };
  const packetBase = {
    schema_version: 1,
    protocol: "k1z-direct-line",
    campaign_id: "hrafn-intent-i1",
    created_at: "2026-07-20T20:40:00.000Z",
    from: "odin",
    to: "hrafn",
    in_reply_to: null,
    evidence: {
      source_commit: SOURCE_COMMIT,
      image_digest: SUBJECT_IMAGE,
      replay_sha256: [],
    },
  };
  const identityWindowPacket = sealK1ZPacket({
    ...packetBase,
    message_id: "odin-hi1-identity-window",
    sequence: 1,
    kind: "coordination",
    authority: { advisory: true, formal_approval: false, mutation_scope: "none" },
    payload: {
      state: "HI1_IDENTITY_WINDOW_READY",
      active_identity: {
        player_id: IDENTITY_PLAYER_ID,
        player_name: SUBJECT_NAME,
      },
      formal_approvals_consumed: 0,
      ordered_diagnostic_scope: jobs.map((entry) => entry.id),
      bindings,
    },
  });
  const identityWindowBytes = Buffer.from(
    serializeK1ZPacket(identityWindowPacket),
  );
  const identityWindowWire = verifyK1ZPacketBytes(identityWindowBytes);
  const common = {
    preregistration,
    preregistrationBytes,
    imageReceipt,
    imageReceiptBytes,
    manifestBytes: MANIFEST_BYTES,
    identityWindowBytes,
  };

  const runEntries = [control, candidate].map((run) => ({
    run,
    active: jobs.find((entry) =>
      entry.map === run.job.game_config.map && entry.role === run.role
    ),
  })).sort((left, right) => left.active.order - right.active.order);
  const pangaeaPairSHA = pangaeaReport
    ? payloadSHA256Raw(wire(pangaeaReport))
    : "8".repeat(64);
  const knownPredecessors = runEntries[0].active.order >= 2
    ? [pangaeaReport?.control, pangaeaReport?.candidate].map((prior, order) => ({
        job_id: jobs[order].id,
        order,
        path: `/private/tmp/${jobs[order].id}-operational.json`,
        file_sha256: prior?.provenance?.operational_sha256 ??
          String(order + 1).repeat(64),
        run_id: `hi1-${jobs[order].id}`,
        started_at: campaignTimestamp(order, 60),
        completed_at: campaignTimestamp(order, 120),
      }))
    : [];
  const pangaeaContinuation = runEntries[0].active.order >= 2
    ? {
        path: "/private/tmp/pangaea-pair.json",
        file_sha256: pangaeaPairSHA,
        verdict: pangaeaReport?.verdict ?? "PAIR_PASS",
        control_operational_sha256: knownPredecessors[0].file_sha256,
        candidate_operational_sha256: knownPredecessors[1].file_sha256,
      }
    : null;

  for (const { run, active } of runEntries) {
    run.jobBytes = wire(run.job);
    const output = `/private/tmp/hi1-${active.id}`;
    const manifestPath = "/private/tmp/hi1-manifest.json";
    const jobPath = `/private/tmp/${active.id}.json`;
    const argv = [
      "uvx", "--from", "coworld==0.1.28", "coworld", "run-episode",
      manifestPath, jobPath, "--output-dir", output, "--episodes", "1",
      "--timeout-seconds", "3600", "--verify-replay",
    ];
    const preflightSpec = {
      schema_version: 1,
      record_type: "hrafn_intent_i1_preflight_spec",
      campaign_id: "hrafn-intent-i1",
      run_id: `hi1-${active.id}`,
      job_id: active.id,
      role: run.role,
      repo_path: "/Users/olifreuler/proxywar-k1z-hrafn",
      output_directory: output,
      lease_directory: "/private/tmp/proxywar-runner-lease",
      manifest_path: manifestPath,
      job_path: jobPath,
      image_receipt_path: "/private/tmp/hi1-image-receipt.json",
      preregistration_path: "/private/tmp/hi1-prereg.json",
      identity_window_path: "/private/tmp/identity-window.json",
      predecessor_operational_receipts: knownPredecessors.map((entry) => ({
        job_id: entry.job_id,
        path: entry.path,
        sha256: entry.file_sha256,
      })),
      pangaea_continuation_pair_report: active.order >= 2
        ? {
            path: pangaeaContinuation.path,
            sha256: pangaeaContinuation.file_sha256,
          }
        : null,
      campaign_jobs: jobs.map((entry) => ({
        ...entry,
        path: `/private/tmp/${entry.id}.json`,
      })),
      expected_argv: argv,
    };
    const identityWindow = {
      path: preflightSpec.identity_window_path,
      message_id: identityWindowPacket.message_id,
      content_sha256: identityWindowWire.content_sha256,
      file_sha256: identityWindowWire.file_sha256,
      formal_approval: false,
      formal_approvals_consumed: 0,
      mailbox_head_commit: "3".repeat(40),
      mailbox_remote_commit: "3".repeat(40),
    };
    const planner = {
      version: "0.32.1",
      model: "llama3:latest",
      model_digest: OLLAMA_MODEL_DIGEST,
      tags_response_sha256: "4".repeat(64),
      show_response_sha256: "5".repeat(64),
      schema_sha256: "6".repeat(64),
      probe_response_sha256: "7".repeat(64),
      probe_intent: { objective: "grow", targetID: null, horizon: 8 },
    };
    const preflight = {
      schema_version: 1,
      record_type: "hrafn_intent_i1_preflight_receipt",
      campaign_id: "hrafn-intent-i1",
      verified_at: campaignTimestamp(active.order, 0),
      run_id: preflightSpec.run_id,
      job: { ...active, path: jobPath },
      campaign_jobs: jobs,
      source: structuredClone(imageReceipt.source),
      image_receipt: {
        path: preflightSpec.image_receipt_path,
        ...bindings.image_receipt,
      },
      preregistration: {
        path: preflightSpec.preregistration_path,
        ...bindings.preregistration,
      },
      manifest: { path: manifestPath, sha256: MANIFEST_SHA256 },
      images: {
        subject: { id: SUBJECT_IMAGE, os: "linux", architecture: "amd64" },
        opponent: { id: OPPONENT_IMAGE, os: "linux", architecture: "amd64" },
      },
      planner,
      identity_window: identityWindow,
      lifecycle: {
        active_order: active.order,
        predecessors: structuredClone(knownPredecessors),
        pangaea_continuation: active.order >= 2
          ? structuredClone(pangaeaContinuation)
          : null,
      },
      identity: { player_id: IDENTITY_PLAYER_ID, player_name: SUBJECT_NAME },
      lease: {
        directory: preflightSpec.lease_directory,
        child_pid: 123,
        supervisor_pid: 122,
        acquired_at: "2026-07-20T20:49:00.000Z",
      },
      argv,
      output: { directory: output, initial_entries: [".proxywar-runner-claim"] },
      checks: { exact_run: true, exact_identity_window: true, exact_order: true },
    };
    const preflightSpecBytes = wire(preflightSpec);
    const preflightBytes = wire(preflight);
    const operational = {
      schema_version: 2,
      record_type: "hrafn_intent_i1_operational_receipt",
      campaign_id: "hrafn-intent-i1",
      lane: "hrafn",
      run_id: preflight.run_id,
      started_at: campaignTimestamp(active.order, 60),
      runner_lease: {
        directory: preflight.lease.directory,
        child_pid: preflight.lease.child_pid,
        supervisor_pid: preflight.lease.supervisor_pid,
        acquired_at: preflight.lease.acquired_at,
      },
      initial_identity: structuredClone(preflight.identity),
      preflight_spec: {
        path: "/private/tmp/preflight-spec.json",
        file_sha256: payloadSHA256Raw(preflightSpecBytes),
      },
      preflight_receipt: {
        path: `${output}/hrafn-intent-preflight-receipt.json`,
        file_sha256: payloadSHA256Raw(preflightBytes),
        verified_at: preflight.verified_at,
      },
      command_argv: argv,
      output_directory: output,
      bindings: {
        source_commit: SOURCE_COMMIT,
        job: preflight.job,
        campaign_jobs: jobs,
        image_receipt: preflight.image_receipt,
        preregistration: preflight.preregistration,
        manifest: preflight.manifest,
        images: preflight.images,
        planner,
        identity_window: identityWindow,
        lifecycle: preflight.lifecycle,
      },
      state: "completed",
      completed_at: campaignTimestamp(active.order, 120),
      child_exit_code: 0,
      child_signal: null,
      child_spawn_error: null,
      final_identity: structuredClone(preflight.identity),
      final_identity_error: null,
      supervisor_exit_code: 0,
    };
    run.provenance = {
      preflightSpec,
      preflightSpecBytes,
      preflight,
      preflightBytes,
      operational,
      operationalBytes: wire(operational),
    };
    knownPredecessors.push({
      job_id: active.id,
      order: active.order,
      path: `/private/tmp/${active.id}-operational.json`,
      file_sha256: payloadSHA256Raw(run.provenance.operationalBytes),
      run_id: preflight.run_id,
      started_at: operational.started_at,
      completed_at: operational.completed_at,
    });
  }
  return common;
}

function payloadSHA256Raw(value) {
  return createHash("sha256").update(value).digest("hex");
}

function passingPair(options = {}) {
  const map = options.map ?? "Pangaea";
  const seed = options.seed ?? 240721;
  const control = runFixture("control", { map, seed });
  const candidate = runFixture("candidate", { map, seed });
  const provenance = provenanceFixture(control, candidate, {
    pangaeaReport: options.pangaeaReport ?? null,
  });
  return auditHrafnIntentPair({
    control,
    candidate,
    provenance,
  });
}

function campaignArtifact(report) {
  return { report, bytes: wire(report) };
}

test("request markers use ten lowercase SHA-256 hex characters", () => {
  assert.equal(
    hrafnIntentRequestMarker("candidate-request-1"),
    requestMarker("candidate-request-1"),
  );
  assert.match(hrafnIntentRequestMarker("request"), /^q[0-9a-f]{10}$/);
});

test("a clean, reached HI1 pair passes all pair gates", () => {
  const report = passingPair();
  assert.equal(report.verdict, "PAIR_PASS");
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.equal(report.control.intent.action_deltas, 0);
  assert.equal(report.candidate.intent.action_deltas, 19);
  assert.equal(report.candidate.intent.hi1_opening_deltas, 15);
  assert.equal(report.candidate.intent.valid_coverage, 23 / 24);
  assert.equal(report.candidate.intent.intent_epochs, 2);
  assert.ok(report.pair.opening_auc20_relative_lift > 0.1);
  assert.equal(report.pair.pretreatment_compared_decisions, 3);
});

test("strict join rejects missing, duplicated, or forged request markers", () => {
  for (const mutate of [
    (fixture) => {
      const row = fixture.policyLog.split("\n").find((line) =>
        line.includes('"event":"hrafn_intent_decision"')
      );
      fixture.policyLog = fixture.policyLog.replace(
        row,
        JSON.stringify({ ...JSON.parse(row), requestMarker: null }),
      );
    },
    (fixture) => {
      const row = fixture.policyLog.split("\n").find((line) =>
        line.includes('"event":"hrafn_intent_decision"')
      );
      fixture.policyLog += `${row}\n`;
    },
    (fixture) => {
      const lines = fixture.policyLog.trimEnd().split("\n");
      const index = lines.findIndex((line) =>
        line.includes('"event":"hrafn_intent_decision"')
      );
      const parsed = JSON.parse(lines[index]);
      parsed.requestMarker = "q0000000000";
      lines[index] = JSON.stringify(parsed);
      fixture.policyLog = `${lines.join("\n")}\n`;
    },
  ]) {
    const fixture = runFixture("candidate");
    mutate(fixture);
    const report = auditHrafnIntentRun(fixture);
    assert.equal(report.checks.strict_request_marker_join, false);
    assert.ok(report.join.failures.length > 0);
  }
});

test("HI1 marker, action delta, intent application, and legal baseline agree", () => {
  for (const mutate of [
    (fixture) => {
      fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
        fixture.replay.inlineRunArtifacts["decisions.jsonl"].replace("hi1.", "");
    },
    (fixture) => {
      const rows = fixture.replay.inlineRunArtifacts["decisions.jsonl"]
        .trimEnd().split("\n").map(JSON.parse);
      const index = rows.findIndex((row) => row.reason?.includes(":hi1."));
      rows[index].reason = rows[index].reason.replace(":hi1.", ":");
      fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
        `${rows.map(JSON.stringify).join("\n")}\n`;
    },
    (fixture) => {
      const lines = fixture.policyLog.trimEnd().split("\n");
      const index = lines.findIndex((line) =>
        line.includes('"actionDelta":true')
      );
      const row = JSON.parse(lines[index]);
      row.baselineActionID = "not-legal";
      lines[index] = JSON.stringify(row);
      fixture.policyLog = `${lines.join("\n")}\n`;
    },
  ]) {
    const fixture = runFixture("candidate");
    mutate(fixture);
    const report = auditHrafnIntentRun(fixture);
    assert.equal(report.checks.hi1_delta_semantics, false);
  }
});

test("control fails closed on any planner or intent activity", () => {
  const fixture = runFixture("control");
  fixture.policyLog = `${JSON.stringify({
    event: "hrafn_intent_plan",
    attempt: 1,
    ok: true,
    model: "llama3:latest",
    intentEpoch: 1,
  })}\n${fixture.policyLog}`;
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.control_zero_intent_activity, false);
});

test("candidate reach gates reject weak or late autonomy", () => {
  const fixture = runFixture("candidate", {
    deltaIndexes: new Set([20, 21, 22, 23]),
  });
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.candidate_action_deltas, false);
  assert.equal(report.checks.candidate_opening_reach, false);
});

test("safety, fallback, rejection, hold, and latency gates fail closed", () => {
  for (const mutate of [
    (fixture) => {
      fixture.results.fallback_count = 1;
      fixture.replay.results.fallback_count = 1;
    },
    (fixture) => {
      const rows = fixture.replay.inlineRunArtifacts["decisions.jsonl"]
        .trimEnd().split("\n").map(JSON.parse);
      rows[2].result.accepted = false;
      fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
        `${rows.map(JSON.stringify).join("\n")}\n`;
    },
    (fixture) => {
      const rows = fixture.replay.inlineRunArtifacts["decisions.jsonl"]
        .trimEnd().split("\n").map(JSON.parse);
      rows[2].decisionLatencyMs = 251;
      fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
        `${rows.map(JSON.stringify).join("\n")}\n`;
    },
    (fixture) => {
      const rows = fixture.replay.inlineRunArtifacts["decisions.jsonl"]
        .trimEnd().split("\n").map(JSON.parse);
      const row = rows[2];
      const harmfulID = `attack:${SUBJECT_ID}:25`;
      row.selectedLegalActionId = harmfulID;
      row.selectedActionMetadata = {
        targetID: SUBJECT_ID,
        targetName: SUBJECT_NAME,
        troopPercent: 25,
        troops: 25,
      };
      row.legalActionIDs.push(harmfulID);
      row.legalActionIDsByKind.attack.push(harmfulID);
      row.result.submittedIntent = {
        type: "attack",
        targetID: SUBJECT_ID,
        troops: 25,
      };
      fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
        `${rows.map(JSON.stringify).join("\n")}\n`;
      const marker = row.reason.match(/q[0-9a-f]{10}/)[0];
      const logRows = fixture.policyLog.trimEnd().split("\n").map(JSON.parse);
      logRows.find((entry) => entry.requestMarker === marker).actionID = harmfulID;
      fixture.policyLog = `${logRows.map(JSON.stringify).join("\n")}\n`;
    },
  ]) {
    const fixture = runFixture("candidate");
    mutate(fixture);
    const report = auditHrafnIntentRun(fixture);
    assert.equal(report.checks.reliability, false);
  }
});

test("stale intent age and unbound replay bytes fail closed", () => {
  const stale = runFixture("candidate");
  const lines = stale.policyLog.trimEnd().split("\n").map(JSON.parse);
  lines.find((row) => row.intentValid === true).planAgeDecisions = 13;
  stale.policyLog = `${lines.map(JSON.stringify).join("\n")}\n`;
  assert.equal(auditHrafnIntentRun(stale).checks.planner_clean, false);

  const unbound = runFixture("candidate");
  unbound.replayBytes = Buffer.from("{}\n");
  assert.equal(auditHrafnIntentRun(unbound).checks.artifact_consistency, false);
});

test("a surviving run cannot pad a short opening with zeros", () => {
  const fixture = runFixture("candidate", {
    decisions: 19,
    deltaIndexes: new Set([1, 2, 4, 6, 8, 10, 12, 14]),
  });
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.opening_metric_complete, false);
  assert.equal(report.opening_auc20, null);
});

test("terminal elimination after the last own action permits only zero suffix padding", () => {
  const fixture = runFixture("candidate", {
    decisions: 19,
    finalTiles: 0,
    score: 0,
    alive: false,
  });
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.opening_metric_complete, true);
  assert.equal(report.opening_evidence.observed_decisions, 19);
  assert.equal(report.opening_evidence.zero_padded_after_verified_elimination, 1);
  assert.ok(Number.isFinite(report.opening_auc20));
});

test("pre-treatment state or action drift invalidates a pair", () => {
  const control = runFixture("control");
  const candidate = runFixture("candidate");
  const rows = candidate.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse);
  rows[1].selectedLegalActionId = "expand:terra-nullius:999";
  rows[1].legalActionIDs.push("expand:terra-nullius:999");
  const marker = rows[1].reason.match(/q[0-9a-f]{10}/)[0];
  candidate.replay.inlineRunArtifacts["decisions.jsonl"] =
    `${rows.map(JSON.stringify).join("\n")}\n`;
  const logRows = candidate.policyLog.trimEnd().split("\n").map(JSON.parse);
  const decision = logRows.find((row) => row.requestMarker === marker);
  decision.actionID = "expand:terra-nullius:999";
  decision.baselineActionID = "expand:terra-nullius:999";
  candidate.policyLog = `${logRows.map(JSON.stringify).join("\n")}\n`;

  const report = auditHrafnIntentPair({ control, candidate });
  assert.equal(report.checks.pretreatment_equivalent, false);
});

test("job drift beyond the intent flag invalidates a pair", () => {
  const control = runFixture("control");
  const candidate = runFixture("candidate");
  candidate.job.game_config.seed += 1;
  const report = auditHrafnIntentPair({ control, candidate });
  assert.equal(report.checks.jobs_only_intent_flag, false);
  assert.equal(report.verdict, "REJECT_SAFETY_OR_RELIABILITY");
});

test("two clean map cells pass campaign lift and combined outcome vetoes", () => {
  const pangaea = passingPair({ map: "Pangaea", seed: 240721 });
  const asia = passingPair({
    map: "Asia",
    seed: 240722,
    pangaeaReport: pangaea,
  });
  const report = auditHrafnIntentCampaign([
    campaignArtifact(pangaea),
    campaignArtifact(asia),
  ]);
  assert.equal(report.verdict, "PROMISING_DIAGNOSTIC_ONLY");
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.ok(report.mean_relative_opening_lift >= 0.1);
  assert.ok(report.combined_candidate_score >= report.combined_control_score);
  assert.ok(report.combined_candidate_final_tiles >= report.combined_control_final_tiles);
});

test("campaign cell binding includes the preregistered seed and subject slot", () => {
  const wrongAsiaPair = auditHrafnIntentPair({
    control: runFixture("control", {
      map: "Asia",
      seed: 240722,
      subjectSlot: 1,
    }),
    candidate: runFixture("candidate", {
      map: "Asia",
      seed: 240722,
      subjectSlot: 1,
    }),
  });
  const report = auditHrafnIntentCampaign([
    campaignArtifact(passingPair()),
    campaignArtifact(wrongAsiaPair),
  ]);
  assert.equal(report.checks.exact_preregistered_cells, false);
  assert.equal(report.verdict, "REJECT_SAFETY_OR_RELIABILITY");
});

test("campaign rejects no-lift and outcome-veto failures after real reach", () => {
  const pangaea = passingPair({ map: "Pangaea", seed: 240721 });
  const control = runFixture("control", { map: "Asia", seed: 240722 });
  const candidate = runFixture("candidate", {
    map: "Asia",
    seed: 240722,
    finalTiles: 1500,
    score: 0.1,
  });
  const rows = candidate.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse);
  const controlRows = control.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse);
  for (let index = 1; index <= 20; index += 1) {
    rows[index].auditAfter.tilesOwned = controlRows[index].auditAfter.tilesOwned - 1;
  }
  candidate.replay.inlineRunArtifacts["decisions.jsonl"] =
    `${rows.map(JSON.stringify).join("\n")}\n`;
  const provenance = provenanceFixture(control, candidate, {
    pangaeaReport: pangaea,
  });
  const badPair = auditHrafnIntentPair({ control, candidate, provenance });
  const report = auditHrafnIntentCampaign([
    campaignArtifact(pangaea),
    campaignArtifact(badPair),
  ]);
  assert.equal(report.verdict, "REJECT_NO_LIFT");
  assert.equal(report.checks.positive_lift_each_cell, false);
  assert.equal(report.checks.combined_score_veto, false);
  assert.equal(report.checks.combined_tiles_veto, false);
});

test("auditor independently rejects a forged wrapped-v5 baseline", () => {
  const fixture = runFixture("candidate");
  const rows = fixture.policyLog.trimEnd().split("\n").map(JSON.parse);
  const decision = rows.find((row) => row.event === "hrafn_intent_decision");
  decision.baselineActionID = "hold";
  fixture.policyLog = `${rows.map(JSON.stringify).join("\n")}\n`;
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.baseline_recomputed, false);
});

test("auditor rejects decision input telemetry outside the two-field projection", () => {
  const fixture = runFixture("candidate");
  const rows = fixture.policyLog.trimEnd().split("\n").map(JSON.parse);
  const decision = rows.find((row) => row.event === "hrafn_intent_decision");
  decision.decisionInput.unrelatedRootMetadata = { traceID: "must-be-discarded" };
  decision.requestPayloadSHA256 = payloadSHA256(decision.decisionInput);
  fixture.policyLog = `${rows.map(JSON.stringify).join("\n")}\n`;

  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.request_payload_binding, false);
  assert.match(
    report.recomputed_baseline.request_failures[0].failure,
    /exactly legalActions and observation/,
  );
});

test("auditor rejects forged plan epochs and intent bindings", () => {
  const fixture = runFixture("candidate");
  const rows = fixture.policyLog.trimEnd().split("\n").map(JSON.parse);
  const decision = rows.find((row) =>
    row.event === "hrafn_intent_decision" && row.intentValid === true
  );
  decision.intentObjective = "convert";
  decision.intentTargetID = "forged-target";
  fixture.policyLog = `${rows.map(JSON.stringify).join("\n")}\n`;
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.intent_plan_binding, false);
});

test("auditor rejects reordered decision telemetry despite valid markers", () => {
  const fixture = runFixture("candidate");
  const rows = fixture.policyLog.trimEnd().split("\n").map(JSON.parse);
  const indexes = rows.map((row, index) =>
    row.event === "hrafn_intent_decision" ? index : -1
  ).filter((index) => index >= 0);
  [rows[indexes[0]], rows[indexes[1]]] = [rows[indexes[1]], rows[indexes[0]]];
  fixture.policyLog = `${rows.map(JSON.stringify).join("\n")}\n`;
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.strict_order_binding, false);
});

test("auditor binds the replay raw response to the full request ID", () => {
  const fixture = runFixture("candidate");
  const replayRows = fixture.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse);
  replayRows[1].rawLlmOutput = JSON.stringify({
    type: "decision_response",
    requestID: "forged-request",
    selectedLegalActionId: replayRows[1].selectedLegalActionId,
    reason: replayRows[1].reason,
    confidence: 0.82,
    fallbackUsed: false,
    llmPlannerDegraded: false,
  });
  fixture.replay.inlineRunArtifacts["decisions.jsonl"] =
    `${replayRows.map(JSON.stringify).join("\n")}\n`;
  const report = auditHrafnIntentRun(fixture);
  assert.equal(report.checks.raw_response_binding, false);
});

test("pre-treatment comparison retains outgoing state", () => {
  const control = runFixture("control");
  const candidate = runFixture("candidate");
  const rows = candidate.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse);
  rows[1].auditBefore.outgoingAttackIDs = ["candidate-only-outgoing"];
  candidate.replay.inlineRunArtifacts["decisions.jsonl"] =
    `${rows.map(JSON.stringify).join("\n")}\n`;
  const report = auditHrafnIntentPair({ control, candidate });
  assert.equal(report.checks.pretreatment_equivalent, false);
});

test("sanitized Coworld 0.1.28 replay shape uses player_count and raw response degradation", () => {
  const control = runFixture("control");
  const candidate = runFixture("candidate");
  const provenance = provenanceFixture(control, candidate);
  assert.equal(candidate.replay.config.player_count, 4);
  assert.equal(candidate.replay.config.num_agents, undefined);
  const row = candidate.replay.inlineRunArtifacts["decisions.jsonl"]
    .trimEnd().split("\n").map(JSON.parse)
    .find((entry) => entry.externalActionCall === true);
  assert.equal(row.llmPlannerDegraded, null);
  assert.equal(JSON.parse(row.rawLlmOutput).llmPlannerDegraded, false);
  assert.equal(
    auditHrafnIntentPair({ control, candidate, provenance }).verdict,
    "PAIR_PASS",
  );
});

test("pair provenance fails closed on absence, forged identity window, or nonzero exit", () => {
  const missingControl = runFixture("control");
  const missingCandidate = runFixture("candidate");
  assert.equal(auditHrafnIntentPair({
    control: missingControl,
    candidate: missingCandidate,
  }).checks.provenance_bound, false);

  const control = runFixture("control");
  const candidate = runFixture("candidate");
  const provenance = provenanceFixture(control, candidate);
  const identityWindow = JSON.parse(provenance.identityWindowBytes);
  identityWindow.payload.bindings.jobs[0].sha256 = "0".repeat(64);
  provenance.identityWindowBytes = wire(identityWindow);
  assert.equal(auditHrafnIntentPair({ control, candidate, provenance })
    .checks.provenance_bound, false);

  const control2 = runFixture("control");
  const candidate2 = runFixture("candidate");
  const provenance2 = provenanceFixture(control2, candidate2);
  candidate2.provenance.operational.child_exit_code = 1;
  candidate2.provenance.operationalBytes = wire(candidate2.provenance.operational);
  assert.equal(auditHrafnIntentPair({
    control: control2,
    candidate: candidate2,
    provenance: provenance2,
  }).checks.provenance_bound, false);
});

test("campaign rejects pair bytes that do not exactly encode the supplied reports", () => {
  const pangaea = passingPair({ map: "Pangaea", seed: 240721 });
  const asia = passingPair({
    map: "Asia",
    seed: 240722,
    pangaeaReport: pangaea,
  });
  const report = auditHrafnIntentCampaign([
    { report: pangaea, bytes: wire({ ...pangaea, verdict: "forged" }) },
    campaignArtifact(asia),
  ]);
  assert.equal(report.checks.exact_pair_report_files, false);
  assert.equal(report.verdict, "REJECT_SAFETY_OR_RELIABILITY");
});

test("CLI audits exact job, results, replay, and subject-log bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hrafn-hi1-audit-"));
  try {
    const control = runFixture("control");
    const candidate = runFixture("candidate");
    const provenance = provenanceFixture(control, candidate);
    const argumentsList = [];
    for (const fixture of [control, candidate]) {
      const directory = fixture.provenance.preflight.output.directory;
      await rm(directory, { recursive: true, force: true });
      const logs = path.join(directory, "logs");
      const jobPath = path.join(root, `${fixture.role}-job.json`);
      const specPath = path.join(root, `${fixture.role}-preflight-spec.json`);
      await mkdir(logs, { recursive: true });
      await Promise.all([
        writeFile(jobPath, fixture.jobBytes),
        writeFile(
          path.join(directory, "results.json"),
          `${JSON.stringify(fixture.results, null, 2)}\n`,
        ),
        writeFile(path.join(directory, "replay"), JSON.stringify(fixture.replay)),
        writeFile(
          path.join(logs, `policy_agent_${fixture.subjectSlot}.log`),
          fixture.policyLog,
        ),
        writeFile(specPath, fixture.provenance.preflightSpecBytes),
        writeFile(
          path.join(directory, "hrafn-intent-preflight-receipt.json"),
          fixture.provenance.preflightBytes,
        ),
        writeFile(
          path.join(directory, "hrafn-operational-receipt.json"),
          fixture.provenance.operationalBytes,
        ),
      ]);
      argumentsList.push(`--${fixture.role}-dir`, directory);
      argumentsList.push(`--${fixture.role}-job`, jobPath);
      argumentsList.push(`--${fixture.role}-preflight-spec`, specPath);
    }
    const commonPaths = {
      preregistration: path.join(root, "preregistration.json"),
      "image-receipt": path.join(root, "image-receipt.json"),
      manifest: path.join(root, "manifest.json"),
      "identity-window": path.join(root, "identity-window.json"),
    };
    await Promise.all([
      writeFile(commonPaths.preregistration, provenance.preregistrationBytes),
      writeFile(commonPaths["image-receipt"], provenance.imageReceiptBytes),
      writeFile(commonPaths.manifest, provenance.manifestBytes),
      writeFile(commonPaths["identity-window"], provenance.identityWindowBytes),
    ]);
    for (const [name, target] of Object.entries(commonPaths)) {
      argumentsList.push(`--${name}`, target);
    }
    argumentsList.push("--subject-slot", String(SUBJECT_SLOT));
    const executed = spawnSync(process.execPath, [
      path.resolve("scripts/audit-hrafn-intent-pair.mjs"),
      ...argumentsList,
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(JSON.parse(executed.stdout).verdict, "PAIR_PASS");
  } finally {
    await rm("/private/tmp/hi1-pangaea-control", { recursive: true, force: true });
    await rm("/private/tmp/hi1-pangaea-candidate", { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
