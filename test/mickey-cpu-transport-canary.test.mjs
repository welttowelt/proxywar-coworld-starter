import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalRequestInputSha256,
} from "../scripts/run-mickey-cpu-fanout.mjs";
import {
  executeTransportCanary,
  runCli,
} from "../scripts/run-mickey-cpu-transport-canary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = path.join(ROOT, "scripts", "run-mickey-cpu-transport-canary.mjs");
const MANIFEST = path.join(ROOT, "experiments", "manifest-mickey-cpu-screen-g000-r2-20260721.json");
const MANIFEST_SHA256 = "7a950dadc34c018c10f2bf3c1f58ee253bb717e787c2a82210379cbd896d9dca";
const SECRET = "9".repeat(64);
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
  const secret = valueAfter(args, "--env").split("=").slice(1).join("=");
  const terminateAfter = valueAfter(args, "--terminateAfter");
  const requestInput = {
    cloudType: "COMMUNITY",
    computeType: "CPU",
    containerDiskInGb: 20,
    deployCost: 0.1,
    dockerArgs: "",
    dataCenterId: "",
    env: [{ key: "MICKEY_CONTROL_PLANE_NONCE", value: secret }],
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
  constructor({ malformed = false, transportError = false, returnedId = NEW_ID } = {}) {
    this.malformed = malformed;
    this.transportError = transportError;
    this.returnedId = returnedId;
    this.present = false;
    this.record = null;
    this.calls = [];
  }

  async run(command, args) {
    this.calls.push({ command, args: [...args] });
    if (args[0] === "pod" && args[1] === "list" && !args.includes("--name")) {
      return {
        code: 0,
        stdout: `${JSON.stringify([{ id: STORM_ID, name: "storm-preserve-me" }])}\n`,
        stderr: "",
      };
    }
    if (args[0] === "create") {
      this.record = createRecord(args, this.returnedId);
      this.present = true;
      if (this.transportError) throw new Error(`transport echoed ${valueAfter(args, "--env")}`);
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

async function execute(fake) {
  return executeTransportCanary({
    manifest: manifest(),
    manifestSha256: MANIFEST_SHA256,
    selfSha256: SELF,
    output: "/unused",
    executor: fake,
    now: Date.parse("2026-07-21T01:00:00.000Z"),
    controlSecret: SECRET,
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
  assert.equal(receipt.control_secret_persisted, false);
  assert.equal(JSON.stringify(receipt).includes(SECRET), false);
  assert.equal(JSON.stringify(receipt).includes(STORM_ID), false);
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

test("transport exception reconciles, redacts the secret, and deletes the exact ID", async () => {
  const fake = new FakeRunPod({ transportError: true });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(receipt.failure_reason.includes(SECRET), false);
  assert.match(receipt.failure_reason, /\[REDACTED\]/);
});

test("a preexisting returned ID is never cleanup-owned or deleted", async () => {
  const fake = new FakeRunPod({ returnedId: STORM_ID });
  const receipt = await execute(fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.observed_new_pod_ids, []);
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "pod" && args[1] === "delete"), false);
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
