import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalRequestInputSha256,
} from "../scripts/run-mickey-cpu-fanout.mjs";
import {
  acquireCanaryOnce,
  runCli,
  simulateTransportCanaryForTest,
  validateLiveRunnerStatus,
} from "../scripts/run-mickey-cpu-transport-canary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = path.join(ROOT, "scripts", "run-mickey-cpu-transport-canary.mjs");
const MANIFEST = path.join(ROOT, "experiments", "manifest-mickey-cpu-screen-g000-r2-20260721.json");
const SIGNAL_FIXTURE = path.join(ROOT, "test-support", "mickey-cpu-canary-signal-child.mjs");
const MANIFEST_SHA256 = "7a950dadc34c018c10f2bf3c1f58ee253bb717e787c2a82210379cbd896d9dca";
const SELF = "8".repeat(64);
const NEW_ID = "mickey-canary-new-001";
const STORM_ID = "storm-existing-001";

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function manifest() {
  return {
    run_id: "mickey-screen-g000-r2-20260721t000905z",
    runpodctl: { path: "/fake/runpodctl" },
    pod: {
      name_prefix: "proxywar-mickey-cpu-fanout",
      image: "runpod/pytorch:test",
      compute_type: "CPU",
      cloud_type: "COMMUNITY",
      gpu_count: 0,
      max_cost_per_hour: 0.1,
      vcpu_count: 2,
      memory_gb: 4,
      container_disk_gb: 20,
      volume_gb: 0,
      terminate_after_seconds: 7200,
    },
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `missing ${flag}`);
  return args[index + 1];
}

function createRecord(args, id = NEW_ID) {
  const name = valueAfter(args, "--name");
  const terminateAfter = valueAfter(args, "--terminateAfter");
  const requestInput = {
    cloudType: "COMMUNITY",
    computeType: "CPU",
    containerDiskInGb: 20,
    deployCost: 0.1,
    dockerArgs: "",
    dataCenterId: "",
    env: [],
    imageName: "runpod/pytorch:test",
    instanceIds: ["cpu5c-2-4", "cpu3c-2-4"],
    minMemoryInGb: 4,
    minVcpuCount: 2,
    name,
    networkVolumeId: "",
    ports: "",
    supportPublicIp: false,
    startSsh: true,
    templateId: "",
    terminateAfter,
    volumeInGb: 0,
    volumeMountPath: "/workspace",
  };
  return {
    id,
    name,
    desiredStatus: "RUNNING",
    costPerHr: 0.08,
    gpuCount: 0,
    vcpuCount: 2,
    memoryInGb: 4,
    containerDiskInGb: 20,
    volumeInGb: 0,
    requestedTerminateAfter: terminateAfter,
    requestInput,
    requestInputSha256: canonicalRequestInputSha256(requestInput),
    requestInputHashAlgorithm: "sorted-json-sha256-v1",
  };
}

class FakeRunPod {
  constructor({ malformed = false, transportError = false, returnedId = NEW_ID, returnedName = null } = {}) {
    this.malformed = malformed;
    this.transportError = transportError;
    this.returnedId = returnedId;
    this.returnedName = returnedName;
    this.present = false;
    this.record = null;
    this.calls = [];
  }

  async run(command, args, options = {}) {
    this.calls.push({ command, args: [...args], options: { ...options } });
    if (args[0] === "pod" && args[1] === "list" && !args.includes("--name")) {
      return {
        code: 0,
        stdout: `${JSON.stringify([{ id: STORM_ID, name: "storm-preserve-me" }])}\n`,
        stderr: "",
      };
    }
    if (args[0] === "create") {
      this.record = createRecord(args, this.returnedId);
      if (this.returnedName !== null) this.record.name = this.returnedName;
      this.present = true;
      if (this.transportError) throw new Error("transport failed after request dispatch");
      return {
        code: 0,
        stdout: this.malformed ? "{" : `${JSON.stringify(this.record)}\n`,
        stderr: "",
      };
    }
    if (args[0] === "pod" && args[1] === "list" && args.includes("--name")) {
      return {
        code: 0,
        stdout: `${JSON.stringify(this.present ? [this.record] : [])}\n`,
        stderr: "",
      };
    }
    if (args[0] === "pod" && args[1] === "get") {
      assert.equal(args[2], NEW_ID);
      return {
        code: 0,
        stdout: `${JSON.stringify({
          ...this.record,
          networkVolumeInspection: {
            includeNetworkVolumeRequested: true,
            networkVolumeId: { present: true, value: null },
            networkVolume: { present: true, value: null },
          },
        })}\n`,
        stderr: "",
      };
    }
    if (args[0] === "pod" && args[1] === "delete") {
      assert.equal(args[2], NEW_ID);
      this.present = false;
      return { code: 0, stdout: `${JSON.stringify({ id: NEW_ID })}\n`, stderr: "" };
    }
    throw new Error(`unexpected fake command: ${args.join(" ")}`);
  }
}

class DelayedRunPod extends FakeRunPod {
  constructor({ visibleAfter }) {
    super({ transportError: true });
    this.visibleAfter = visibleAfter;
    this.exactNameLists = 0;
  }

  async run(command, args, options = {}) {
    if (args[0] === "pod" && args[1] === "list" && args.includes("--name")) {
      this.exactNameLists += 1;
      if (this.exactNameLists < this.visibleAfter) {
        this.calls.push({ command, args: [...args], options: { ...options } });
        return { code: 0, stdout: "[]\n", stderr: "" };
      }
    }
    return super.run(command, args, options);
  }
}

class TransientCleanupGetRunPod extends FakeRunPod {
  constructor({ cleanupGetFailures }) {
    super();
    this.cleanupGetFailures = cleanupGetFailures;
  }

  async run(command, args, options = {}) {
    if (
      args[0] === "pod" &&
      args[1] === "get" &&
      options.label?.endsWith("-identity-check") &&
      this.cleanupGetFailures > 0
    ) {
      this.cleanupGetFailures -= 1;
      this.calls.push({ command, args: [...args], options: { ...options } });
      return { code: 503, stdout: "", stderr: "transient provider error" };
    }
    return super.run(command, args, options);
  }
}

async function execute(fake) {
  return simulateTransportCanaryForTest({
    manifest: manifest(),
    manifestSha256: MANIFEST_SHA256,
    selfSha256: SELF,
    output: "/unused",
    executor: fake,
    now: Date.parse("2026-07-21T01:00:00.000Z"),
    pairId: "transport-test",
    settle: async () => {},
  });
}

test("transport canary attests one CPU pod and deletes only its exact new ID", async () => {
  const fake = new FakeRunPod();
  const receipt = await execute(fake);
  assert.equal(receipt.status, "passed");
  assert.deepEqual(receipt.observed_new_pod_ids, [NEW_ID]);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(receipt.game_processes_started, 0);
  assert.equal(receipt.evidence_eligible, false);
  assert.equal(receipt.promotion_possible_from_this_run, false);
  assert.equal(receipt.secret_in_argv, false);
  assert.equal(JSON.stringify(receipt).includes("MICKEY_CONTROL_PLANE_NONCE"), false);
  assert.equal(JSON.stringify(receipt).includes(STORM_ID), false);
  const creates = fake.calls.filter(({ args }) => args[0] === "create");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].args.includes("--env"), false);
  const deletes = fake.calls.filter(({ args }) => args[0] === "pod" && args[1] === "delete");
  assert.deepEqual(deletes.map(({ args }) => args[2]), [NEW_ID]);
  assert.equal(deletes.some(({ args }) => args.includes("--name")), false);
});

test("malformed create output reconciles and deletes the exact new ID", async () => {
  const fake = new FakeRunPod({ malformed: true });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.observed_new_pod_ids, [NEW_ID]);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(fake.present, false);
});

test("transport exception reconciles and deletes the exact ID", async () => {
  const fake = new FakeRunPod({ transportError: true });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.match(receipt.failure_reason, /transport failed/);
});

test("cleanup retries two transient pre-delete GET failures before exact-ID delete and absence", async () => {
  const fake = new TransientCleanupGetRunPod({ cleanupGetFailures: 2 });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "passed");
  assert.equal(fake.present, false);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);

  const cleanupGets = fake.calls.filter(({ args, options }) => (
    args[0] === "pod" && args[1] === "get" && options.label?.endsWith("-identity-check")
  ));
  assert.equal(cleanupGets.length, 3);
  const deleteIndex = fake.calls.findIndex(({ args }) => args[0] === "pod" && args[1] === "delete");
  const absenceIndex = fake.calls.findIndex(({ options }) => options.label === "canary-final-absence-check");
  assert.notEqual(deleteIndex, -1);
  assert.ok(absenceIndex > deleteIndex, "final absence verification must follow exact-ID deletion");
});

test("final absence verification still runs after late exact-ID cleanup exhausts retries", async () => {
  const fake = new TransientCleanupGetRunPod({ cleanupGetFailures: 20 });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.equal(fake.present, true);
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.match(receipt.failure_reason, /cleanup retries exhausted/);
  assert.equal(
    fake.calls.some(({ options }) => options.label === "canary-final-absence-check"),
    true,
  );
});

test("an indeterminate create that appears late in the 30-second window is deleted", async () => {
  const fake = new DelayedRunPod({ visibleAfter: 7 });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.observed_new_pod_ids, [NEW_ID]);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(fake.present, false);
});

test("a preexisting returned ID is never cleanup-owned or deleted", async () => {
  const fake = new FakeRunPod({ returnedId: STORM_ID });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.observed_new_pod_ids, []);
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "pod" && args[1] === "delete"), false);
});

test("a newly returned storm name is never cleanup-owned or deleted", async () => {
  const fake = new FakeRunPod({ returnedId: "storm-new-002", returnedName: "storm-new" });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.observed_new_pod_ids, []);
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "pod" && args[1] === "delete"), false);
});

test("SIGTERM after creation is trapped until exact-ID cleanup completes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mickey-canary-signal-"));
  const ready = path.join(directory, "ready");
  const receiptPath = path.join(directory, "receipt.json");
  const child = spawn(process.execPath, [SIGNAL_FIXTURE, ready, receiptPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(ready) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(ready), true, "signal fixture never reached the post-create boundary");
    assert.equal(child.kill("SIGTERM"), true);
    const result = await new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }));
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 17, result.stderr);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.failure_reason, "received SIGTERM");
    assert.deepEqual(receipt.observed_new_pod_ids, ["mickey-signal-canary-001"]);
    assert.deepEqual(receipt.deleted_exact_pod_ids, ["mickey-signal-canary-001"]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live status must bind the exact active runner child and sole output", () => {
  const document = manifest();
  const output = "/private/tmp/canary-output";
  const status = {
    state: "active",
    schema_version: 2,
    owner: "mickey",
    run_id: document.run_id,
    supervisor_alive: true,
    child_alive: true,
    child_pid: 1234,
    outputs: [output],
  };
  assert.deepEqual(validateLiveRunnerStatus(status, {
    manifest: document,
    output,
    childPid: 1234,
  }), {
    owner: "mickey",
    run_id: document.run_id,
    child_pid: 1234,
    output,
  });
  assert.throws(
    () => validateLiveRunnerStatus({ ...status, child_pid: 9999 }, {
      manifest: document,
      output,
      childPid: 1234,
    }),
    /does not bind/,
  );
  assert.throws(
    () => validateLiveRunnerStatus({ ...status, outputs: [output, "/tmp/other"] }, {
      manifest: document,
      output,
      childPid: 1234,
    }),
    /does not bind/,
  );
  assert.throws(
    () => validateLiveRunnerStatus({ ...status, supervisor_alive: false }, {
      manifest: document,
      output,
      childPid: 1234,
    }),
    /does not bind/,
  );
});

test("the output-local canary lock is atomic and one-shot", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mickey-canary-once-"));
  try {
    const lockPath = await acquireCanaryOnce(directory);
    assert.equal(existsSync(lockPath), true);
    await assert.rejects(() => acquireCanaryOnce(directory), /EEXIST/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dry-run validates pins without touching the injected network executor", async () => {
  let calls = 0;
  const tripwire = {
    async run() {
      calls += 1;
      throw new Error("network tripwire");
    },
  };
  const code = await runCli([
    "--manifest", MANIFEST,
    "--manifest-sha256", MANIFEST_SHA256,
    "--self-sha256", sha256File(CANARY),
    "--dry-run",
  ], { executor: tripwire });
  assert.equal(code, 0);
  assert.equal(calls, 0);
});
