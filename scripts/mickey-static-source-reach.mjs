import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { staticIntentPlan } from "../evaluation-static-intent.mjs";
import { buildState, chooseAction, clean } from "../strategy-engine.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const lowRisk = { level: "low" };
const coalition = Object.freeze([
  ["ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c", "K1Z odin free"],
  ["ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863", "K1Z Hrafn"],
  ["ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba", "K1Z katanasan"],
  ["ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335", "K1Z Gravity"],
]);
const coalitionIDs = new Set(coalition.map(([id]) => id));
const harmfulKinds = new Set([
  "attack", "boat", "nuke", "break_alliance", "target_player",
  "embargo", "embargo_all", "warship", "move_warship",
]);
const arms = Object.freeze([
  ["m0", "evaluation-m0", "evaluation-m0-player.mjs", false],
  ["grow-opening", "evaluation-grow-opening", "evaluation-grow-opening-player.mjs", true],
  ["grow-low-share", "evaluation-grow-low-share", "evaluation-grow-low-share-player.mjs", true],
  ["convert-weakest", "evaluation-convert-weakest", "evaluation-convert-weakest-player.mjs", true],
  ["convert-largest", "evaluation-convert-largest", "evaluation-convert-largest-player.mjs", true],
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableJSON(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function visiblePlayer({ id, name, tileShare, relativeTroopRatio }) {
  return {
    id,
    name,
    isAlive: true,
    tileShare,
    relativeTroopRatio,
    sharesBorder: true,
    canAttack: true,
    isAllied: false,
  };
}

function observation(tileShare, visiblePlayers) {
  return {
    phase: "active",
    ownState: {
      tileShare,
      troopRatio: 0.8,
      troops: 500000,
      gold: 250000,
      borderTiles: 100,
      incomingAttacks: [],
    },
    visiblePlayers,
  };
}

function handshakeFixture(id, tileShare) {
  const [partnerID, partnerName] = coalition[2];
  return {
    id,
    history: [],
    observation: observation(tileShare, [visiblePlayer({
      id: partnerID,
      name: partnerName,
      tileShare: 0.08,
      relativeTroopRatio: 1.2,
    })]),
    actions: [
      action("alliance:katanasan", "alliance_request", `Alliance with ${partnerName}`, {
        recipientID: partnerID,
        recipientName: partnerName,
        relation: 2,
      }),
      action("expand:terra-nullius:10", "attack", "Expand Terra Nullius 10%", {
        expansion: true,
        troopPercent: 10,
      }),
    ],
  };
}

function conversionFixture(id, first, second) {
  return {
    id,
    history: [],
    observation: observation(0.2, [visiblePlayer(first), visiblePlayer(second)]),
    actions: [first, second].map((target) => action(
      `attack:${target.id}:10`,
      "attack",
      `Attack ${target.name} 10%`,
      { targetID: target.id, targetName: target.name, troopPercent: 10 },
    )).concat(action("hold", "hold", "Hold")),
  };
}

function coalitionSafetyFixture() {
  return {
    id: "all-k1z-safety",
    history: [],
    observation: observation(0.2, coalition.map(([id, name]) => visiblePlayer({
      id,
      name,
      tileShare: 0.2,
      relativeTroopRatio: 4,
    }))),
    actions: coalition.map(([id, name]) => action(
      `attack:${id}:40`,
      "attack",
      `Attack ${name} 40%`,
      { targetID: id, targetName: name, troopPercent: 40 },
    )).concat(
      action("expand:terra-nullius:10", "attack", "Expand Terra Nullius 10%", {
        expansion: true,
        troopPercent: 10,
      }),
      action("hold", "hold", "Hold"),
    ),
  };
}

export function sourceReachFixtures() {
  return [
    handshakeFixture("grow-low-share-handshake", 0.05),
    handshakeFixture("grow-mid-share-handshake", 0.14),
    conversionFixture(
      "convert-largest-delta",
      { id: "weak-small", name: "Weak Small", tileShare: 0.08, relativeTroopRatio: 2.2 },
      {
        id: "large-less-weak",
        name: "Large Less Weak",
        tileShare: 0.2,
        relativeTroopRatio: 1.5,
      },
    ),
    conversionFixture(
      "convert-weakest-delta",
      { id: "ratio-edge", name: "Ratio Edge", tileShare: 0.01, relativeTroopRatio: 1.31 },
      { id: "land-leader", name: "Land Leader", tileShare: 0.3, relativeTroopRatio: 1.3 },
    ),
    coalitionSafetyFixture(),
  ];
}

function selectedTargetID(action) {
  return clean(action?.metadata?.targetID ?? action?.metadata?.recipientID ?? "") || null;
}

function evaluateArm(arm, fixtures) {
  let mechanismReached = false;
  let k1zHarmCount = 0;
  const trace = fixtures.map((fixture) => {
    const state = buildState(fixture.observation, fixture.actions, fixture.history);
    const plan = staticIntentPlan(arm, state, fixture.history);
    const baseline = chooseAction(fixture.actions, state, null, fixture.history);
    const selected = chooseAction(fixture.actions, state, plan, fixture.history);
    const marker = selected.policyMarker ?? null;
    const targetID = selectedTargetID(selected);
    const actionDelta = selected.id !== baseline.id;
    if (actionDelta && (marker === "mm1g" || marker === "mm1c")) mechanismReached = true;
    if (targetID && coalitionIDs.has(targetID) && harmfulKinds.has(selected.kind)) {
      k1zHarmCount += 1;
    }
    return {
      fixture_id: fixture.id,
      selected_action_id: selected.id,
      selected_action_kind: selected.kind,
      selected_target_id: targetID,
      policy_marker: marker,
      action_delta: actionDelta,
    };
  });
  return { mechanismReached, k1zHarmCount, trace };
}

export async function buildSourceReachReceipt(sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("source commit must be an exact 40-character lowercase git SHA");
  }
  const fixtures = sourceReachFixtures();
  const records = [];
  for (const [id, dockerTarget, entrypoint, expectedReach] of arms) {
    const evaluation = evaluateArm(id, fixtures);
    if (evaluation.mechanismReached !== expectedReach) {
      throw new Error(
        `${id} reach mismatch: expected ${expectedReach}, got ${evaluation.mechanismReached}`,
      );
    }
    if (evaluation.k1zHarmCount !== 0) {
      throw new Error(`${id} selected ${evaluation.k1zHarmCount} harmful K1Z actions`);
    }
    const entrypointBytes = await readFile(`${root}/${entrypoint}`);
    records.push({
      id,
      docker_target: dockerTarget,
      run: ["node", entrypoint],
      entrypoint_sha256: sha256(entrypointBytes),
      expected_mechanism_reach: expectedReach,
      mechanism_reached: evaluation.mechanismReached,
      selected_action_trace_sha256: sha256(stableJSON(evaluation.trace)),
      k1z_harm_count: evaluation.k1zHarmCount,
    });
  }

  const traceHashes = records.map((record) => record.selected_action_trace_sha256);
  if (new Set(traceHashes).size !== traceHashes.length) {
    throw new Error("retained static arms did not produce unique selected-action traces");
  }
  const entrypointHashes = records.map((record) => record.entrypoint_sha256);
  if (new Set(entrypointHashes).size !== entrypointHashes.length) {
    throw new Error("retained static arms did not produce unique baked entrypoints");
  }

  return {
    schema_version: 1,
    evidence_scope: "deterministic-source-fixtures-only",
    source_commit: sourceCommit,
    surrogate_source: "static-eval-v1",
    upload_eligible: false,
    fixture_set_sha256: sha256(stableJSON(fixtures)),
    fixture_ids: fixtures.map((fixture) => fixture.id),
    arms: records,
  };
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (direct) {
  const flagIndex = process.argv.indexOf("--source-commit");
  const sourceCommit = flagIndex >= 0 ? process.argv[flagIndex + 1] : "";
  console.log(JSON.stringify(await buildSourceReachReceipt(sourceCommit), null, 2));
}
