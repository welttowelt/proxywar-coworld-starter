#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decideResponse } from "../llm-player.mjs";
import { createStandardController } from "../standard-controller.mjs";

const argv = process.argv.slice(2);

function option(name, environmentName) {
  const equals = argv.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  return process.env[environmentName];
}

const positionalIterations = argv.find((argument) => /^\d+$/.test(argument));
const iterations = Number(option("--iterations", "BENCHMARK_ITERATIONS") ??
  positionalIterations ?? 10_000);
const sourceCommit = String(option("--source-commit", "SOURCE_COMMIT") ?? "").toLowerCase();
const imageID = String(option("--image-id", "IMAGE_ID") ?? "").toLowerCase();
if (!Number.isInteger(iterations) || iterations < 10_000) {
  throw new Error("benchmark requires at least 10000 iterations");
}
if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) {
  throw new Error("--source-commit (or SOURCE_COMMIT) must be a full git object ID");
}
if (!/^sha256:[0-9a-f]{64}$/.test(imageID)) {
  throw new Error("--image-id (or IMAGE_ID) must be a full sha256 Docker image ID");
}

const microActions = [
  {
    id: "expand:terra-nullius:35",
    kind: "attack",
    label: "Expand into Terra Nullius 35%",
    metadata: { expansion: true, troopPercent: 35 },
    risk: { level: "low" },
  },
  {
    id: "attack:outsider:25",
    kind: "attack",
    label: "Attack Outsider 25%",
    metadata: {
      targetID: "outsider",
      targetName: "Outsider",
      troopPercent: 25,
    },
    risk: { level: "low" },
  },
  {
    id: "build:city:1",
    kind: "build",
    label: "Build City",
    metadata: { unit: "City" },
    risk: { level: "low" },
  },
  { id: "hold", kind: "hold", label: "Hold", risk: { level: "low" } },
];

const K1Z = [
  ["kata", "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba", "K1Z katanasan"],
  ["gravity", "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335", "K1Z juryoku-koku"],
  ["hrafn", "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863", "K1Z Hrafn"],
  ["mickey", "ply_e982e621-9ca3-47cd-8151-f57ee9d99421", "K1Z Mickey Mouse"],
];
const OUTSIDERS = [
  ["daveey", "Daveey"],
  ["richard", "Richard Higgins"],
  ["auri", "Auri"],
];

function targetedAction(kind, slug, targetID, targetName, percent) {
  return {
    id: `${kind}:${slug}:${percent}`,
    kind,
    label: `${kind === "boat" ? "Launch boat at" : "Attack"} ${targetName} ${percent}%`,
    metadata: { targetID, targetName, troopPercent: percent },
    risk: { level: "low" },
  };
}

function productionActions() {
  const actions = [];
  for (const percent of [10, 16, 25, 35, 40]) {
    actions.push({
      id: `expand:terra-nullius:${percent}`,
      kind: "attack",
      label: `Expand into Terra Nullius ${percent}%`,
      metadata: { expansion: true, troopPercent: percent },
      risk: { level: "low" },
    });
  }
  for (const [slug, name] of OUTSIDERS) {
    for (const percent of [10, 25, 35, 40]) {
      actions.push(targetedAction("attack", slug, slug, name, percent));
    }
  }
  for (const [slug, id, name] of K1Z) {
    for (const percent of [25, 40]) {
      actions.push(targetedAction("attack", slug, id, name, percent));
    }
  }
  for (const percent of [8, 16, 25]) {
    actions.push({
      id: `boat:terra-nullius:${percent}`,
      kind: "boat",
      label: `Launch boat to Terra Nullius ${percent}%`,
      metadata: { expansion: true, troopPercent: percent },
      risk: { level: "low" },
    });
  }
  for (const [slug, name] of OUTSIDERS) {
    for (const percent of [16, 25]) {
      actions.push(targetedAction("boat", slug, slug, name, percent));
    }
  }
  for (const [slug, id, name] of K1Z) {
    actions.push({
      id: `alliance:${slug}`,
      kind: "alliance_request",
      label: `Request alliance with ${name}`,
      metadata: { recipientID: id, recipientName: name, relation: 2 },
      risk: { level: "low" },
    });
    actions.push({
      id: `alliance-extend:${slug}`,
      kind: "alliance_extend",
      label: `Extend alliance with ${name}`,
      metadata: { recipientID: id, recipientName: name, relation: 3 },
      risk: { level: "low" },
    });
  }
  for (const unit of ["City", "Factory", "Port", "Defense Post"]) {
    actions.push({
      id: `build:${unit.toLowerCase().replaceAll(" ", "-")}`,
      kind: "build",
      label: `Build ${unit}`,
      metadata: { unit },
      risk: { level: "low" },
    });
  }
  actions.push({ id: "hold", kind: "hold", label: "Hold", risk: { level: "low" } });
  if (actions.length !== 47) throw new Error(`production fixture has ${actions.length}, expected 47`);
  return actions;
}

const visiblePlayers = [
  ...OUTSIDERS.map(([id, name], index) => ({
    id,
    name,
    isAlive: true,
    isAllied: false,
    sharesBorder: true,
    canAttack: true,
    tileShare: 0.08 + index * 0.02,
    relativeTroopRatio: 1.4 + index * 0.2,
  })),
  ...K1Z.map(([, id, name], index) => ({
    id,
    name,
    isAlive: true,
    isAllied: false,
    sharesBorder: index < 2,
    canAttack: index < 2,
    tileShare: 0.04 + index * 0.01,
    relativeTroopRatio: 1.1,
  })),
];
const observation = {
  phase: "active",
  alivePlayerCount: 8,
  ownState: {
    tileShare: 0.1,
    troops: 500_000,
    maxTroops: 1_000_000,
    incomingAttacks: [],
  },
  combat: { incomingAttackPlayerIDs: [] },
  visiblePlayers,
};

function summarize(samples) {
  samples.sort((left, right) => left - right);
  const percentile = (fraction) =>
    samples[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)];
  return {
    iterations: samples.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: samples.at(-1),
  };
}

function runMicrobenchmark() {
  let controller = createStandardController();
  for (let index = 0; index < 1_000; index++) {
    controller.decide({
      requestID: `micro-warm-${index}`,
      observation,
      legalActions: microActions,
    });
  }
  controller = createStandardController();
  const samples = [];
  for (let index = 0; index < iterations; index++) {
    const start = process.hrtime.bigint();
    const decision = controller.decide({
      requestID: `micro-${index}`,
      observation,
      legalActions: microActions,
    });
    samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    if (!microActions.some((action) => action.id === decision.selectedLegalActionId)) {
      throw new Error("microbenchmark selected an unoffered action");
    }
  }
  return summarize(samples);
}

function runProductionBenchmark() {
  const legalActions = productionActions();
  const controller = createStandardController();
  const responseCache = new Map();
  const samples = [];
  let responseBytes = 0;
  for (let index = 0; index < iterations + 1_000; index++) {
    const rawRequest = JSON.stringify({
      type: "decision_request",
      requestID: `production-${index}`,
      request: {
        protocolVersion: "proxywar-agent-v1",
        observation,
        legalActions,
      },
    });
    const measured = index >= 1_000;
    const start = measured ? process.hrtime.bigint() : 0n;
    const parsed = JSON.parse(rawRequest);
    const response = decideResponse(controller, parsed, responseCache);
    const serialized = JSON.stringify(response);
    if (measured) {
      samples.push(Number(process.hrtime.bigint() - start) / 1_000_000);
      responseBytes += Buffer.byteLength(serialized);
    }
    if (response.type !== "decision_response" ||
        !legalActions.some((action) => action.id === response.selectedLegalActionId)) {
      throw new Error("production benchmark emitted an invalid response");
    }
  }
  return {
    ...summarize(samples),
    action_count: legalActions.length,
    measured_path: ["JSON.parse", "decideResponse", "JSON.stringify"],
    mean_response_bytes: responseBytes / samples.length,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
const producerSha256 = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
const executedRuntimeFiles = Object.fromEntries(
  ["llm-player.mjs", "standard-controller.mjs", "controller-safety.mjs"].map(
    (name) => [
      name,
      createHash("sha256")
        .update(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url))))
        .digest("hex"),
    ],
  ),
);
const microbenchmark = runMicrobenchmark();
const production = runProductionBenchmark();
process.stdout.write(`${JSON.stringify({
  schema_version: "proxywar-standard-controller-benchmark-v2",
  source_commit: sourceCommit,
  image_id: imageID,
  producer: {
    path: "scripts/benchmark-standard-controller.mjs",
    sha256: producerSha256,
  },
  executed_runtime: {
    image_id: imageID,
    files: executedRuntimeFiles,
  },
  // Compatibility fields consumed by the standard-rebuild gate now describe
  // the full production-shaped wire path, not the four-action microbenchmark.
  iterations: production.iterations,
  p50_ms: production.p50_ms,
  p95_ms: production.p95_ms,
  p99_ms: production.p99_ms,
  max_ms: production.max_ms,
  microbenchmark,
  production,
})}\n`);
