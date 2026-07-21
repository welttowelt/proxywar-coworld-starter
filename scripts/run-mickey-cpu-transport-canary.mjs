#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ExecutorRunPodClient,
  buildPodCreateArgs,
  deleteExactOwnedPodWithRetry,
  parseSshKeygenFingerprint,
  preflightManifest,
  prepareKnownHostsFile,
  registerCreatedPod,
  validateClaimedOutputShape,
  validateCreateRequestAttestation,
  validateCreatedPod,
  validateSshInfo,
  verifyLiveReaperService,
} from "./run-mickey-cpu-fanout.mjs";
import {
  bindActivePod,
  confirmOwnedPodAbsent,
  preparePendingCreate,
  readReaperLedger,
  runReaperOnce,
} from "./runpod-exact-id-reaper.mjs";

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
  --dry-run  Validate local pins and print one redacted REST create/SSH/delete plan.
             It performs zero RunPod or other network calls.

Real execution must be the child of the canonical foreground Mickey runner lease.
The canary creates at most one CPU pod, starts no game, verifies SSH transport,
and only cleans an exact ID owned by the durable reaper ledger.
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

function dryRunName(manifest) {
  return `${manifest.pod.name_prefix}-${"0".repeat(32)}`;
}

function sshArgs(info, knownHosts, bootstrap) {
  return [
    "-i", info.ssh_key.path,
    "-p", String(info.port),
    "-o", "BatchMode=yes",
    "-o", `StrictHostKeyChecking=${bootstrap ? "accept-new" : "yes"}`,
    "-o", `UserKnownHostsFile=${knownHosts}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=20",
    "-o", "ServerAliveCountMax=3",
  ];
}

async function waitForSshInfo({ runpodctl, podId, expectedName, executor, signalState, settle }) {
  let last = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);
    const result = await executor.run(
      runpodctl,
      ["ssh", "info", podId, "-o", "json"],
      { label: `canary-ssh-info-${attempt}`, allowFailure: true },
    );
    last = result;
    if (result.code === 0) {
      try {
        return validateSshInfo(parseJson(result, "RunPod SSH info"), podId, expectedName);
      } catch {
        // Poll until the exact identity and public endpoint are complete.
      }
    }
    await settle(5_000);
  }
  throw new Error(`SSH never became ready: ${last?.stderr || "no response"}`);
}

async function defaultSshProbe({ manifest, podId, expectedName, output, executor, signalState, settle }) {
  const info = await waitForSshInfo({
    runpodctl: manifest.runpodctl.path,
    podId,
    expectedName,
    executor,
    signalState,
    settle,
  });
  const keyInfo = await lstat(info.ssh_key.path).catch(() => null);
  if (!keyInfo?.isFile() || keyInfo.isSymbolicLink()) throw new Error("SSH private key is missing or unsafe");
  if (await realpath(info.ssh_key.path) !== info.ssh_key.path) throw new Error("SSH private key path is not canonical");
  if ((keyInfo.mode & 0o077) !== 0) throw new Error("SSH private key permissions are too broad");
  if (typeof process.getuid === "function" && keyInfo.uid !== process.getuid()) {
    throw new Error("SSH private key is not owned by this operator");
  }

  const knownHosts = path.join(output, "evidence", "transport-canary-known-hosts");
  await prepareKnownHostsFile(knownHosts);
  const ready = await executor.run(
    "/usr/bin/ssh",
    [
      ...sshArgs(info, knownHosts, true),
      `root@${info.ip}`,
      "printf 'MICKEY_SSH_TRANSPORT_READY\\n'",
    ],
    { label: "canary-ssh-transport-probe" },
  );
  if (ready.stdout !== "MICKEY_SSH_TRANSPORT_READY\n") {
    throw new Error("SSH transport probe returned an unexpected payload");
  }
  const fingerprintResult = await executor.run(
    "/usr/bin/ssh-keygen",
    ["-lf", knownHosts, "-E", "sha256"],
    { label: "canary-known-host-fingerprint" },
  );
  return {
    status: "ready",
    pod_id: podId,
    pod_name: expectedName,
    public_endpoint: { ip: info.ip, port: info.port },
    account_ssh_key_fingerprint: info.ssh_key.fingerprint,
    negotiated_host_key_fingerprint: parseSshKeygenFingerprint(fingerprintResult.stdout),
    trust_scope: "transport_canary_tofu_after_exact_control_plane_identity",
    command: "static_readiness_probe_only",
  };
}

async function executeTransportCanary({
  manifest,
  manifestSha256,
  selfSha256,
  output,
  executor,
  reaperClient = new ExecutorRunPodClient(manifest.runpodctl.path, executor, "canary-reaper"),
  now = Date.now(),
  settle = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  signalState = { requested: false, signal: null },
  sshProbe = defaultSshProbe,
  beforeCreate = async () => {},
}) {
  const receipt = {
    schema_version: 2,
    kind: "mickey_cpu_transport_canary_receipt",
    run_id: manifest.run_id,
    manifest_sha256: manifestSha256,
    canary_script_sha256: selfSha256,
    evidence_scope: "transport_only",
    evidence_eligible: false,
    promotion_possible_from_this_run: false,
    game_processes_started: 0,
    create_attempts: 0,
    secret_in_argv: false,
    requested_contract: {
      transport: "rest-v1",
      compute_type: "CPU",
      cloud_type: manifest.pod.cloud_type,
      cpu_flavor_ids: manifest.pod.cpu_flavor_ids,
      vcpu_count: manifest.pod.vcpu_count,
      max_cost_per_hour: manifest.pod.max_cost_per_hour,
      container_disk_gb: manifest.pod.container_disk_gb,
      volume_gb: manifest.pod.volume_gb,
      network_volume_id: null,
      public_ip: true,
      ports: ["22/tcp"],
      provider_ttl: null,
      client_cleanup_deadline_seconds:
        manifest.cleanup_watchdog.client_cleanup_deadline_seconds,
    },
    reaper_record_id: null,
    pod_name: null,
    observed_new_pod_ids: [],
    deleted_exact_pod_ids: [],
    already_absent_exact_pod_ids: [],
    external_deadline_cleanup_required: false,
    started_at: new Date(now).toISOString(),
    completed_at: null,
    status: "running",
    failure_reason: null,
  };

  const observedIds = new Set();
  let pending = null;
  let podId = null;
  let fatal = null;
  try {
    const deadline = new Date(
      now + manifest.cleanup_watchdog.client_cleanup_deadline_seconds * 1_000,
    ).toISOString();
    pending = await preparePendingCreate({
      ledgerPath: manifest.cleanup_watchdog.ledger_path,
      client: reaperClient,
      runId: `${manifest.run_id}:transport-canary`,
      manifestSha256,
      deadline,
      namePrefix: manifest.pod.name_prefix,
    });
    receipt.reaper_record_id = pending.record_id;
    receipt.pod_name = pending.expected_name;
    receipt.preexisting_pod_count = pending.preexisting_ids.length;
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);

    const createArgs = buildPodCreateArgs(manifest, pending.expected_name, null);
    if (
      createArgs.includes("--env") ||
      createArgs.includes("--env-stdin") ||
      JSON.stringify(createArgs).match(/api.?key|credential|password/i)
    ) {
      throw new Error("transport canary create argv contains a forbidden secret-bearing field");
    }
    // The pending exact-name ownership record is durable before this point.
    // Revalidate the installed assets, service heartbeat/PID, and foreground
    // runner as the final awaited operation before dispatching the one POST.
    await beforeCreate({
      expectedName: pending.expected_name,
      reaperRecordId: pending.record_id,
    });
    if (signalState.requested) throw new Error(`received ${signalState.signal}`);
    receipt.create_attempts = 1;
    let createResult;
    try {
      createResult = await executor.run(manifest.runpodctl.path, createArgs, {
        label: "canary-pod-create",
        allowFailure: true,
      });
    } catch (error) {
      throw new Error(`RunPod create transport failed before a trustworthy response: ${error.message}`);
    }
    let createRecord;
    try {
      createRecord = parseJson(createResult, "RunPod create");
      const createdIds = new Set();
      podId = registerCreatedPod(
        createRecord,
        pending.expected_name,
        new Set(pending.preexisting_ids),
        createdIds,
      );
      observedIds.add(podId);
      await bindActivePod({
        ledgerPath: manifest.cleanup_watchdog.ledger_path,
        client: reaperClient,
        recordId: pending.record_id,
        podId,
      });
    } catch (error) {
      throw new Error(`RunPod create response was not cleanup-safe: ${error.message}`);
    }
    if (createResult.code !== 0) {
      throw new Error(`RunPod create returned status ${createResult.code} after binding exact pod ID ${podId}`);
    }
    receipt.create_request_attestation = validateCreateRequestAttestation(createRecord, {
      manifest,
      expectedName: pending.expected_name,
      controlSecret: null,
    });
    validateCreatedPod(createRecord, {
      expectedName: pending.expected_name,
      preexistingIds: new Set(pending.preexisting_ids),
    });
    const got = await reaperClient.get(podId);
    if (!got) throw new Error("exact created pod disappeared before transport inspection");
    validateCreatedPod(
      { ...createRecord, ...got, id: podId },
      {
        expectedName: pending.expected_name,
        preexistingIds: new Set(pending.preexisting_ids),
        requireNetworkVolumeInspection: true,
      },
    );
    receipt.attested_pod = {
      id: podId,
      name: pending.expected_name,
      cost_per_hour: Number(got.costPerHr ?? createRecord.costPerHr),
      vcpu_count: got.vcpuCount ?? createRecord.vcpuCount,
      memory_gb: got.memoryInGb ?? createRecord.memoryInGb,
      gpu_count: got.gpuCount ?? createRecord.gpuCount,
      container_disk_gb: got.containerDiskInGb ?? createRecord.containerDiskInGb,
      volume_gb: got.volumeInGb ?? createRecord.volumeInGb,
      network_volume_attached: false,
    };
    receipt.ssh_transport = await sshProbe({
      manifest,
      podId,
      expectedName: pending.expected_name,
      output,
      executor,
      signalState,
      settle,
    });
    if (receipt.ssh_transport?.status !== "ready") throw new Error("SSH transport did not become ready");
  } catch (error) {
    fatal = error;
  } finally {
    if (pending) {
      try {
        await runReaperOnce({
          ledgerPath: manifest.cleanup_watchdog.ledger_path,
          client: reaperClient,
        });
        let ledger = await readReaperLedger(manifest.cleanup_watchdog.ledger_path);
        let owned = ledger.records.find((record) => record.record_id === pending.record_id);
        if (!owned) throw new Error("reaper ownership record disappeared");
        if (owned.state === "active") {
          podId ??= owned.pod_id;
          observedIds.add(owned.pod_id);
          const deletion = await deleteExactOwnedPodWithRetry({
            runpodctl: manifest.runpodctl.path,
            podId: owned.pod_id,
            expectedName: owned.expected_name,
            preexistingIds: new Set(owned.preexisting_ids),
            executor,
            label: "canary-normal-cleanup",
            settle,
          });
          owned = await confirmOwnedPodAbsent({
            ledgerPath: manifest.cleanup_watchdog.ledger_path,
            client: reaperClient,
            recordId: pending.record_id,
          });
          if (deletion.status === "confirmed_absent") receipt.already_absent_exact_pod_ids.push(owned.pod_id);
          else receipt.deleted_exact_pod_ids.push(owned.pod_id);
          receipt.cleanup = {
            status: owned.terminal_reason,
            reaper_state: owned.state,
            exact_id_get_before_each_delete: true,
            final_absence_confirmed: true,
          };
        } else if (owned.state === "retired") {
          owned = await confirmOwnedPodAbsent({
            ledgerPath: manifest.cleanup_watchdog.ledger_path,
            client: reaperClient,
            recordId: pending.record_id,
          });
          receipt.already_absent_exact_pod_ids.push(owned.pod_id);
          receipt.cleanup = {
            status: owned.terminal_reason,
            reaper_state: owned.state,
            final_absence_confirmed: true,
          };
        } else if (owned.state === "pending") {
          receipt.external_deadline_cleanup_required = true;
          receipt.cleanup = {
            status: "pending_exact_name_reconciliation",
            reaper_state: owned.state,
            deadline: owned.deadline,
            final_absence_confirmed: false,
          };
          fatal ??= new Error("create outcome remains pending under the external exact-ID deadline reaper");
        } else {
          throw new Error(`reaper record ended in unsafe state ${owned.state}`);
        }
      } catch (cleanupError) {
        fatal = new Error(`${fatal?.message || "transport canary failed"}; exact-ID cleanup: ${cleanupError.message}`);
      }
    }
  }

  if (signalState.requested) fatal ??= new Error(`received ${signalState.signal}`);
  receipt.observed_new_pod_ids = [...observedIds].sort();
  receipt.deleted_exact_pod_ids = [...new Set(receipt.deleted_exact_pod_ids)].sort();
  receipt.already_absent_exact_pod_ids = [...new Set(receipt.already_absent_exact_pod_ids)].sort();
  receipt.completed_at = new Date().toISOString();
  receipt.status = fatal ? "failed" : "passed";
  receipt.failure_reason = fatal ? redactError(fatal) : null;
  return receipt;
}

export async function simulateTransportCanaryForTest(options) {
  if (options?.manifest?.runpodctl?.path !== "/fake/runpodctl") {
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
  return { owner: status.owner, run_id: status.run_id, child_pid: status.child_pid, output };
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
  const preflight = await preflightManifest(
    options.manifest,
    options.manifestSha256,
    { requirePersistentServiceArtifacts: !options.dryRun },
  );
  const plannedName = dryRunName(preflight.document);
  const dryArgs = buildPodCreateArgs(preflight.document, plannedName, null);
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
      reaper_prepare_before_post: true,
      provider_ttl: null,
      client_cleanup_deadline_seconds:
        preflight.document.cleanup_watchdog.client_cleanup_deadline_seconds,
      create_argv: dryArgs,
      ssh_probe: "exact-id/name readiness plus static command; no game",
      cleanup: "exact-id retries then reaper confirm-absent",
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
  await verifyLiveReaperService({
    manifest: preflight.document,
    manifestSha256: preflight.manifestSha256,
    executor,
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
    beforeCreate: async () => {
      await preflightManifest(
        options.manifest,
        options.manifestSha256,
        { requirePersistentServiceArtifacts: true },
      );
      await validateClaimedOutputShape(
        options.output,
        preflight.document.run_id,
        preflight.document.runner_lease.state_root,
      );
      const currentRunnerStatus = await executor.run(
        preflight.document.runner_lease.path,
        ["status", "--json"],
        { label: "canary-immediate-pre-post-runner-status" },
      );
      validateLiveRunnerStatus(parseJson(currentRunnerStatus, "immediate pre-POST runner status"), {
        manifest: preflight.document,
        output: options.output,
      });
      await verifyLiveReaperService({
        manifest: preflight.document,
        manifestSha256: preflight.manifestSha256,
        executor,
      });
    },
  }));
  await writeJsonAtomic(path.join(evidenceRoot, "transport-canary-receipt.json"), receipt);
  if (receipt.status !== "passed") throw new Error(receipt.failure_reason || "transport canary failed");
  process.stdout.write(`MICKEY_CPU_TRANSPORT_CANARY_PASSED pod_id=${receipt.attested_pod.id}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`MICKEY_CPU_TRANSPORT_CANARY_FAILED: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
