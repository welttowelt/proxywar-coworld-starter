#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPodCreateArgs,
  canonicalRequestInputSha256,
  deleteExactPod,
  preflightManifest,
  registerCreatedPod,
  validateClaimedOutputShape,
  validateCreatedPod,
} from "./run-mickey-cpu-fanout.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const SELF_PATH = fileURLToPath(import.meta.url);
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function usage() {
  return `Usage:
  node scripts/run-mickey-cpu-transport-canary.mjs \\
    --manifest /absolute/path/manifest.json \\
    --manifest-sha256 <64-hex> \\
    --self-sha256 <64-hex> \\
    --output /private/tmp/new-run-output

Options:
  --dry-run  Validate all local pins and print one redacted create/delete plan.
             It performs zero RunPod or other network calls.

Real execution must be the child of the canonical foreground Mickey runner lease.
The canary creates at most one CPU pod, starts no game, and deletes only an exact
new pod ID before returning.
`;
}

function parseArgs(argv) {
  const options = {
    manifest: null,
    manifestSha256: null,
    selfSha256: null,
    output: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const field = {
      "--manifest": "manifest",
      "--manifest-sha256": "manifestSha256",
      "--self-sha256": "selfSha256",
      "--output": "output",
    }[arg];
    if (!field || index + 1 >= argv.length) throw new Error(`unknown or incomplete option: ${arg}`);
    if (options[field] !== null) throw new Error(`duplicate option: ${arg}`);
    options[field] = argv[++index];
  }
  if (!options.manifest || !options.manifestSha256 || !options.selfSha256) {
    throw new Error("--manifest, --manifest-sha256, and --self-sha256 are required");
  }
  if (!SHA256.test(options.selfSha256)) throw new Error("--self-sha256 must be lowercase SHA-256");
  if (!options.dryRun && !options.output) throw new Error("--output is required outside dry-run mode");
  return options;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`);
  }
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) throw new Error(`create plan lacks ${flag}`);
  return args[index + 1];
}

function redactError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.part-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

export class EphemeralExecutor {
  async run(command, args, { label = "command", allowFailure = false } = {}) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      let bytes = 0;
      const capture = (target) => (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_CAPTURE_BYTES) child.kill("SIGTERM");
        else target.push(chunk);
      };
      child.stdout.on("data", capture(stdout));
      child.stderr.on("data", capture(stderr));
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }));
    });
    if (!allowFailure && result.code !== 0) {
      throw new Error(`${label} failed with status ${result.code}${result.signal ? ` signal ${result.signal}` : ""}`);
    }
    return result;
  }
}

function newCanaryPairId(now) {
  return `transport-${now}-${randomBytes(4).toString("hex")}`;
}

function redactedCreatePlan(args) {
  return [...args];
}

function buildTransportPodCreateArgs(manifest, pairId, now) {
  const args = buildPodCreateArgs(manifest, "transport-canary", pairId, now, "0".repeat(64));
  const envIndex = args.indexOf("--env");
  if (envIndex < 0 || envIndex + 1 >= args.length) throw new Error("base CPU create plan lacks env pair");
  args.splice(envIndex, 2);
  return args;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]));
}

function validateTransportCreateRequest(record, { manifest, expectedName, expectedTerminateAfter }) {
  if (!record || typeof record !== "object") throw new Error("RunPod create response must be an object");
  if (record.requestInputHashAlgorithm !== "sorted-json-sha256-v1") {
    throw new Error("RunPod create response uses an unapproved request-input hash algorithm");
  }
  if (record.requestInputSha256 !== canonicalRequestInputSha256(record.requestInput)) {
    throw new Error("RunPod create request-input SHA-256 is invalid");
  }
  if (record.requestedTerminateAfter !== expectedTerminateAfter) {
    throw new Error("RunPod create response does not echo the exact server-side termination request");
  }
  const expected = {
    cloudType: manifest.pod.cloud_type,
    computeType: manifest.pod.compute_type,
    containerDiskInGb: manifest.pod.container_disk_gb,
    deployCost: manifest.pod.max_cost_per_hour,
    dockerArgs: "",
    dataCenterId: "",
    env: [],
    imageName: manifest.pod.image,
    instanceIds: [
      `cpu5c-${manifest.pod.vcpu_count}-${manifest.pod.memory_gb}`,
      `cpu3c-${manifest.pod.vcpu_count}-${manifest.pod.memory_gb}`,
    ],
    minMemoryInGb: manifest.pod.memory_gb,
    minVcpuCount: manifest.pod.vcpu_count,
    name: expectedName,
    networkVolumeId: "",
    ports: "",
    supportPublicIp: false,
    startSsh: true,
    templateId: "",
    terminateAfter: expectedTerminateAfter,
    volumeInGb: manifest.pod.volume_gb,
    volumeMountPath: "/workspace",
  };
  if (JSON.stringify(sortedJsonValue(record.requestInput)) !== JSON.stringify(sortedJsonValue(expected))) {
    throw new Error("RunPod create request echo differs from the exact transport contract");
  }
  return {
    request_input_sha256: record.requestInputSha256,
    requested_terminate_after: record.requestedTerminateAfter,
  };
}

function exactNameRecords(records, expectedName, preexistingIds) {
  if (!Array.isArray(records)) throw new Error("RunPod exact-name listing is not an array");
  return records.filter((record) => (
    record &&
    typeof record === "object" &&
    record.name === expectedName &&
    typeof record.id === "string" &&
    !preexistingIds.has(record.id)
  ));
}

async function executeTransportCanary({
  manifest,
  manifestSha256,
  selfSha256,
  output,
  executor,
  now = Date.now(),
  pairId = newCanaryPairId(now),
  settle = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  signalState = { requested: false, signal: null },
}) {
  const runpodctl = manifest.runpodctl.path;
  const createArgs = buildTransportPodCreateArgs(manifest, pairId, now);
  const expectedName = flagValue(createArgs, "--name");
  const expectedTerminateAfter = flagValue(createArgs, "--terminateAfter");
  if (expectedName.startsWith("storm-") || !expectedName.startsWith("proxywar-mickey-")) {
    throw new Error("transport canary name is outside the Mickey namespace");
  }

  const receipt = {
    schema_version: 1,
    kind: "mickey_cpu_transport_canary_receipt",
    run_id: manifest.run_id,
    manifest_sha256: manifestSha256,
    canary_script_sha256: selfSha256,
    evidence_scope: "transport_only",
    evidence_eligible: false,
    promotion_possible_from_this_run: false,
    game_processes_started: 0,
    pod_name: expectedName,
    requested_contract: {
      compute_type: "CPU",
      cloud_type: manifest.pod.cloud_type,
      vcpu_count: manifest.pod.vcpu_count,
      memory_gb: manifest.pod.memory_gb,
      max_cost_per_hour: manifest.pod.max_cost_per_hour,
      container_disk_gb: manifest.pod.container_disk_gb,
      volume_gb: manifest.pod.volume_gb,
      network_volume_id: null,
      terminate_after: expectedTerminateAfter,
    },
    secret_in_argv: false,
    request_correlation: "unique_exact_name_plus_manifest_hash",
    preexisting_pod_count: null,
    observed_new_pod_ids: [],
    deleted_exact_pod_ids: [],
    already_absent_exact_pod_ids: [],
    cleanup_reconciliation: {
      indeterminate_window_seconds: 30,
      provider_terminate_after: expectedTerminateAfter,
    },
    started_at: new Date(now).toISOString(),
    completed_at: null,
    status: "running",
    failure_reason: null,
  };

  const createdIds = new Set();
  const observedIds = new Set();
  const deletedIds = new Set();
  const alreadyAbsentIds = new Set();
  let preexistingIds = new Set();
  let fatal = null;
  let createAttempted = false;

  const rememberClaims = (ids) => {
    for (const id of ids) observedIds.add(id);
  };

  const reconcile = async (label) => {
    const result = await executor.run(
      runpodctl,
      ["pod", "list", "--name", expectedName, "-a", "-o", "json"],
      { label, allowFailure: true },
    );
    if (result.code !== 0) throw new Error(`${label} failed with status ${result.code}`);
    const listed = parseJson(result, label);
    if (!Array.isArray(listed)) throw new Error(`${label} did not return an array`);
    const claimed = [];
    for (const record of listed) {
      if (
        !record ||
        typeof record !== "object" ||
        record.name !== expectedName ||
        preexistingIds.has(record.id) ||
        createdIds.has(record.id)
      ) continue;
      const id = registerCreatedPod(record, expectedName, preexistingIds, createdIds);
      claimed.push(id);
    }
    rememberClaims(claimed);
    return claimed;
  };

  const deleteCleanupOwnedId = async (id, label) => {
    const inspection = await executor.run(
      runpodctl,
      ["pod", "get", id, "--include-network-volume", "-o", "json"],
      { label: `${label}-identity-check`, allowFailure: true },
    );
    if (inspection.code !== 0) {
      const body = `${inspection.stdout}\n${inspection.stderr}`.toLowerCase();
      if (body.includes("pod not found") || body.includes('"status":404') || body.includes("status 404")) {
        createdIds.delete(id);
        alreadyAbsentIds.add(id);
        return;
      }
      throw new Error(`pre-delete identity check failed for exact pod ${id}`);
    }
    const current = parseJson(inspection, "pre-delete exact-ID identity check");
    if (current.id !== id || current.name !== expectedName || current.name.startsWith("storm-")) {
      throw new Error(`pre-delete identity check refused pod ${id}`);
    }
    await deleteExactPod(runpodctl, id, executor, label);
    createdIds.delete(id);
    deletedIds.add(id);
  };

  try {
    const snapshotResult = await executor.run(runpodctl, ["pod", "list", "-a", "-o", "json"], {
      label: "canary-preexisting-snapshot",
    });
    const snapshot = parseJson(snapshotResult, "pre-existing pod snapshot");
    if (!Array.isArray(snapshot) || snapshot.some((pod) => !pod || typeof pod.id !== "string")) {
      throw new Error("pre-existing pod snapshot is not a complete JSON array");
    }
    preexistingIds = new Set(snapshot.map((pod) => pod.id));
    receipt.preexisting_pod_count = preexistingIds.size;
    if (snapshot.some((pod) => pod.name === expectedName)) {
      throw new Error("unique canary name already exists before creation");
    }
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);

    createAttempted = true;
    let createResult;
    try {
      createResult = await executor.run(runpodctl, createArgs, {
        label: "canary-pod-create",
        allowFailure: true,
      });
    } catch (error) {
      await reconcile("canary-reconcile-create-exception").catch(() => []);
      throw new Error(`RunPod create transport failed before a trustworthy response: ${error.message}`);
    }

    let createRecord;
    try {
      createRecord = parseJson(createResult, "RunPod create");
      if (createRecord.name !== expectedName || createRecord.name.startsWith("storm-")) {
        throw new Error("RunPod create response does not bind the exact non-storm canary name");
      }
      const podId = registerCreatedPod(createRecord, expectedName, preexistingIds, createdIds);
      observedIds.add(podId);
    } catch (error) {
      await reconcile("canary-reconcile-create-response").catch(() => []);
      throw new Error(`RunPod create response was not cleanup-safe: ${error.message}`);
    }
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);
    if (createResult.code !== 0) {
      throw new Error(`RunPod create returned status ${createResult.code} after returning a pod ID`);
    }

    receipt.create_request_attestation = validateTransportCreateRequest(createRecord, {
      manifest,
      expectedName,
      expectedTerminateAfter,
    });
    validateCreatedPod(createRecord, { expectedName, preexistingIds });

    const listResult = await executor.run(
      runpodctl,
      ["pod", "list", "--name", expectedName, "-a", "-o", "json"],
      { label: "canary-post-create-list" },
    );
    const listed = parseJson(listResult, "post-create exact-name listing");
    const exactNew = exactNameRecords(listed, expectedName, preexistingIds);
    if (exactNew.length !== 1 || !createdIds.has(exactNew[0].id)) {
      throw new Error("post-create exact-name listing does not resolve to the one cleanup-owned pod");
    }

    const podId = exactNew[0].id;
    const getResult = await executor.run(
      runpodctl,
      ["pod", "get", podId, "--include-network-volume", "-o", "json"],
      { label: "canary-post-create-get" },
    );
    const got = parseJson(getResult, "post-create exact-ID inspection");
    if (got.id !== podId || got.name !== expectedName) {
      throw new Error("post-create exact-ID inspection returned a different pod");
    }
    validateCreatedPod(
      { ...createRecord, ...exactNew[0], ...got, id: podId },
      { expectedName, preexistingIds, requireNetworkVolumeInspection: true },
    );
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);
    receipt.attested_pod = {
      id: podId,
      name: expectedName,
      cost_per_hour: got.costPerHr ?? createRecord.costPerHr,
      vcpu_count: got.vcpuCount ?? createRecord.vcpuCount,
      memory_gb: got.memoryInGb ?? createRecord.memoryInGb,
      gpu_count: got.gpuCount ?? createRecord.gpuCount,
      container_disk_gb: got.containerDiskInGb ?? createRecord.containerDiskInGb,
      volume_gb: got.volumeInGb ?? createRecord.volumeInGb,
      network_volume_attached: false,
    };
  } catch (error) {
    fatal = error;
  } finally {
    if (createAttempted) {
      const reconciliationRounds = fatal && observedIds.size === 0 ? 7 : 1;
      for (let round = 0; round < reconciliationRounds; round += 1) {
        if (round > 0) await settle(5_000);
        await reconcile(`canary-final-reconcile-${round + 1}`).catch((error) => {
          fatal ??= error;
        });
        for (const id of [...createdIds]) {
          try {
            await deleteCleanupOwnedId(id, `canary-exact-delete-${id}`);
          } catch (error) {
            fatal ??= error;
          }
        }
      }
      try {
        const lateResult = await executor.run(
          runpodctl,
          ["pod", "list", "--name", expectedName, "-a", "-o", "json"],
          { label: "canary-late-arrival-check" },
        );
        const lateRecords = exactNameRecords(
          parseJson(lateResult, "late exact-name arrival check"),
          expectedName,
          preexistingIds,
        );
        for (const record of lateRecords) {
          if (!createdIds.has(record.id)) {
            const id = registerCreatedPod(record, expectedName, preexistingIds, createdIds);
            observedIds.add(id);
          }
        }
        for (const id of [...createdIds]) {
          await deleteCleanupOwnedId(id, `canary-late-exact-delete-${id}`);
        }
        const finalResult = await executor.run(
          runpodctl,
          ["pod", "list", "--name", expectedName, "-a", "-o", "json"],
          { label: "canary-final-absence-check" },
        );
        const finalRecords = exactNameRecords(
          parseJson(finalResult, "final exact-name absence check"),
          expectedName,
          preexistingIds,
        );
        if (finalRecords.length !== 0 || createdIds.size !== 0) {
          fatal ??= new Error("one or more exact canary pod IDs remain after cleanup");
        }
      } catch (error) {
        fatal ??= error;
      }
    }
  }

  if (signalState.requested) fatal ??= new Error(`received ${signalState.signal}`);
  receipt.observed_new_pod_ids = [...observedIds].sort();
  receipt.deleted_exact_pod_ids = [...deletedIds].sort();
  receipt.already_absent_exact_pod_ids = [...alreadyAbsentIds].sort();
  receipt.completed_at = new Date().toISOString();
  receipt.status = fatal ? "failed" : "passed";
  receipt.failure_reason = fatal ? redactError(fatal) : null;
  return receipt;
}

export async function simulateTransportCanaryForTest(options) {
  if (options?.manifest?.runpodctl?.path !== "/fake/runpodctl" || options.output !== "/unused") {
    throw new Error("test simulation is restricted to the non-network fake RunPod path");
  }
  return executeTransportCanary(options);
}

export async function withTerminationSignals(operation) {
  const signalState = { requested: false, signal: null };
  const handlers = new Map();
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => {
      signalState.requested = true;
      signalState.signal ??= signal;
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    return await operation(signalState);
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

export function validateLiveRunnerStatus(status, { manifest, output, childPid = process.pid }) {
  if (
    !status ||
    status.state !== "active" ||
    status.schema_version !== 2 ||
    status.owner !== "mickey" ||
    status.run_id !== manifest.run_id ||
    status.supervisor_alive !== true ||
    status.child_alive !== true ||
    status.child_pid !== childPid ||
    !Array.isArray(status.outputs) ||
    status.outputs.length !== 1 ||
    status.outputs[0] !== output
  ) {
    throw new Error("live runner status does not bind this exact Mickey child and output");
  }
  return {
    owner: status.owner,
    run_id: status.run_id,
    child_pid: status.child_pid,
    output,
  };
}

export async function acquireCanaryOnce(output) {
  const lockPath = path.join(output, ".mickey-cpu-transport-canary-once");
  await mkdir(lockPath, { mode: 0o700 });
  return lockPath;
}

export async function runCli(argv, { executor = new EphemeralExecutor() } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  const actualSelfSha256 = await sha256File(SELF_PATH);
  if (actualSelfSha256 !== options.selfSha256) throw new Error("transport canary self SHA-256 mismatch");
  const preflight = await preflightManifest(options.manifest, options.manifestSha256);

  const dryPairId = "transport-dry-run";
  const dryArgs = buildTransportPodCreateArgs(preflight.document, dryPairId, 0);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dry_run: true,
      network_calls: 0,
      manifest_sha256: preflight.manifestSha256,
      canary_script_sha256: actualSelfSha256,
      pod_count: 1,
      game_processes_started: 0,
      evidence_eligible: false,
      promotion_possible_from_this_run: false,
      create_argv: redactedCreatePlan(dryArgs),
      cleanup: "exact_new_pod_ids_only",
    }, null, 2)}\n`);
    return 0;
  }

  await validateClaimedOutputShape(
    options.output,
    preflight.document.run_id,
    preflight.document.runner_lease.state_root,
  );
  const runnerStatusResult = await executor.run(
    preflight.document.runner_lease.path,
    ["status", "--json"],
    { label: "canary-live-runner-status" },
  );
  validateLiveRunnerStatus(parseJson(runnerStatusResult, "live runner status"), {
    manifest: preflight.document,
    output: options.output,
  });
  await acquireCanaryOnce(options.output);
  const evidenceRoot = path.join(options.output, "evidence");
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const receipt = await withTerminationSignals((signalState) => executeTransportCanary({
    manifest: preflight.document,
    manifestSha256: preflight.manifestSha256,
    selfSha256: actualSelfSha256,
    output: options.output,
    executor,
    signalState,
  }));
  await writeJsonAtomic(path.join(evidenceRoot, "transport-canary-receipt.json"), receipt);
  if (receipt.status !== "passed") throw new Error(receipt.failure_reason || "transport canary failed");
  process.stdout.write(`MICKEY_CPU_TRANSPORT_CANARY_PASSED pod_id=${receipt.attested_pod.id}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`MICKEY_CPU_TRANSPORT_CANARY_FAILED: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
