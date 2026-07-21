import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalRequestInputSha256,
  validateCreateRequestAttestation,
} from "../scripts/run-mickey-cpu-fanout.mjs";
import {
  acquireCanaryOnce,
  simulateTransportCanaryForTest,
  validateLiveRunnerStatus,
} from "../scripts/run-mickey-cpu-transport-canary.mjs";

const MANIFEST_SHA256 = createHash("sha256").update("manifest-v3").digest("hex");
const SELF = "8".repeat(64);
const NEW_ID = "mickey-canary-new-001";
const STORM_ID = "storm-existing-001";
const PROVIDER_ENV_LIVE_SHAPE = JSON.parse(readFileSync(
  new URL(
    "../test-support/fixtures/runpod-create-provider-env-redacted-reconstructed_sanitized.json",
    import.meta.url,
  ),
  "utf8",
));

function manifest(root) {
  return {
    run_id: "mickey-screen-g000-r3-test",
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
      cpu_flavor_ids: ["cpu5c", "cpu3c"],
      cpu_flavor_priority: "custom",
      public_ip: true,
      ports: ["22/tcp"],
    },
    cleanup_watchdog: {
      ledger_path: path.join(root, "reaper-ledger.json"),
      client_cleanup_deadline_seconds: 7200,
    },
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `missing ${flag}`);
  return args[index + 1];
}

function notFound(error = "pod not found") {
  return {
    code: 1,
    stdout: "",
    stderr: `${JSON.stringify({ error: `failed to get pod: api error: ${error} (status 404)` })}\n`,
  };
}

function createRecord(args, id = NEW_ID, nameOverride = null) {
  const name = valueAfter(args, "--name");
  const requestInput = {
    cloudType: "COMMUNITY",
    computeType: "CPU",
    containerDiskInGb: 20,
    cpuFlavorIds: ["cpu5c", "cpu3c"],
    cpuFlavorPriority: "custom",
    imageName: "runpod/pytorch:test",
    name,
    ports: ["22/tcp"],
    supportPublicIp: true,
    vcpuCount: 2,
    volumeInGb: 0,
    volumeMountPath: "/workspace",
  };
  return {
    id,
    name: nameOverride ?? name,
    desiredStatus: "RUNNING",
    costPerHr: 0.08,
    gpuCount: 0,
    vcpuCount: 2,
    memoryInGb: 4,
    containerDiskInGb: 20,
    volumeInGb: 0,
    transport: "rest-v1",
    clientMaxCostPerHour: 0.1,
    validationPassed: true,
    cleanupAttempted: false,
    cleanupSucceeded: false,
    requestInput,
    requestInputSha256: canonicalRequestInputSha256(requestInput),
    requestInputHashAlgorithm: "sorted-json-sha256-v1",
    requestInputHashScope: "raw-request-before-redaction",
    requestInputRedacted: false,
    requestInputRedactionSchema: "env-map-v2",
    responseEnvRedacted: false,
    responseEnvRedactionSchema: "env-map-v2",
    redactedEnvValueMarker: "[REDACTED]",
    responseControlSecretScrubbed: false,
    providerIdentityContaminated: false,
    reconciliationRequired: false,
  };
}

class FakeRunPod {
  constructor({
    malformed = false,
    transportError = false,
    returnedId = NEW_ID,
    returnedName = null,
    cleanupGetFailures = 0,
    adversarialAfterDelete = false,
    providerResponseEnv = false,
  } = {}) {
    this.malformed = malformed;
    this.transportError = transportError;
    this.returnedId = returnedId;
    this.returnedName = returnedName;
    this.cleanupGetFailures = cleanupGetFailures;
    this.adversarialAfterDelete = adversarialAfterDelete;
    this.providerResponseEnv = providerResponseEnv;
    this.present = false;
    this.record = null;
    this.calls = [];
    this.createCount = 0;
  }

  async run(command, args, options = {}) {
    this.calls.push({ command, args: [...args], options: { ...options } });
    if (args[0] === "pod" && args[1] === "list") {
      const pods = [{ id: STORM_ID, name: "storm-preserve-me" }];
      if (this.present) pods.push(this.record);
      return { code: 0, stdout: `${JSON.stringify(pods)}\n`, stderr: "" };
    }
    if (args[0] === "pod" && args[1] === "create") {
      this.createCount += 1;
      this.record = createRecord(args, this.returnedId, this.returnedName);
      if (this.providerResponseEnv) {
        this.record.env = { redacted: true, schema: "env-map-v2" };
        this.record.responseEnvRedacted = true;
        this.record.responseControlSecretScrubbed = true;
      }
      this.present = true;
      if (this.transportError) throw new Error("transport failed after request dispatch");
      return {
        code: 0,
        stdout: this.malformed ? "{" : `${JSON.stringify(this.record)}\n`,
        stderr: "",
      };
    }
    if (args[0] === "pod" && args[1] === "get") {
      if (this.cleanupGetFailures > 0 && options.label?.includes("identity-check")) {
        this.cleanupGetFailures -= 1;
        return { code: 503, stdout: "", stderr: JSON.stringify({ error: "temporary (status 503)" }) };
      }
      if (!this.present) {
        if (this.adversarialAfterDelete) {
          return {
            code: 1,
            stdout: "",
            stderr: `${JSON.stringify({
              error: "status 502; upstream text contained status 404 (status 502)",
            })}\n`,
          };
        }
        return notFound();
      }
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
      return { code: 0, stdout: `${JSON.stringify({ deleted: true, id: NEW_ID })}\n`, stderr: "" };
    }
    throw new Error(`unexpected fake command: ${args.join(" ")}`);
  }
}

async function execute(t, fake, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mickey-canary-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const signalState = overrides.signalState ?? { requested: false, signal: null };
  return simulateTransportCanaryForTest({
    manifest: manifest(root),
    manifestSha256: MANIFEST_SHA256,
    selfSha256: SELF,
    output: root,
    executor: fake,
    now: Date.parse("2026-07-21T01:00:00.000Z"),
    settle: async () => {},
    signalState,
    sshProbe: overrides.sshProbe ?? (async ({ podId, expectedName }) => ({
      status: "ready",
      pod_id: podId,
      pod_name: expectedName,
      command: "static_readiness_probe_only",
    })),
    beforeCreate: overrides.beforeCreate === undefined
      ? undefined
      : (details) => overrides.beforeCreate(details, root, fake),
  });
}

test("transport canary prepares ownership before one REST POST, proves SSH, and confirms exact-ID absence", async (t) => {
  const fake = new FakeRunPod();
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "passed");
  assert.equal(fake.createCount, 1);
  assert.equal(receipt.ssh_transport.status, "ready");
  assert.equal(receipt.game_processes_started, 0);
  assert.equal(receipt.secret_in_argv, false);
  assert.equal(receipt.requested_contract.provider_ttl, null);
  assert.deepEqual(receipt.observed_new_pod_ids, [NEW_ID]);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(receipt.cleanup.final_absence_confirmed, true);
  const create = fake.calls.find(({ args }) => args[0] === "pod" && args[1] === "create");
  assert.equal(create.args.includes("--public-ip"), true);
  assert.equal(create.args.includes("22/tcp"), true);
  assert.equal(create.args.includes("--env"), false);
  const firstList = fake.calls.findIndex(({ args }) => args[0] === "pod" && args[1] === "list");
  const post = fake.calls.findIndex(({ args }) => args[0] === "pod" && args[1] === "create");
  assert.ok(firstList >= 0 && firstList < post, "reaper snapshot must precede POST");
  assert.equal(fake.calls.some(({ args }) => args.includes(STORM_ID) && args.includes("delete")), false);
});

test("transport canary accepts provider-returned redacted env metadata with no requested env", async (t) => {
  const expectedName = PROVIDER_ENV_LIVE_SHAPE.name;
  assert.equal(PROVIDER_ENV_LIVE_SHAPE.fixture_label, "reconstructed_sanitized");
  assert.equal(
    canonicalRequestInputSha256(PROVIDER_ENV_LIVE_SHAPE.requestInput),
    PROVIDER_ENV_LIVE_SHAPE.requestInputSha256,
  );
  const attestation = validateCreateRequestAttestation(PROVIDER_ENV_LIVE_SHAPE, {
    manifest: manifest("/private/tmp/live-shape-only"),
    expectedName,
    controlSecret: null,
  });
  assert.equal(attestation.response_env_redacted, true);
  assert.equal(attestation.response_control_secret_scrubbed, true);
  const redactedButNotScrubbed = structuredClone(PROVIDER_ENV_LIVE_SHAPE);
  redactedButNotScrubbed.responseControlSecretScrubbed = false;
  assert.throws(
    () => validateCreateRequestAttestation(redactedButNotScrubbed, {
      manifest: manifest("/private/tmp/live-shape-only"),
      expectedName,
      controlSecret: null,
    }),
    /response-wide scrub and identity contract/,
  );
  const absentButReportedScrubbed = structuredClone(PROVIDER_ENV_LIVE_SHAPE);
  delete absentButReportedScrubbed.env;
  absentButReportedScrubbed.responseEnvRedacted = false;
  assert.throws(
    () => validateCreateRequestAttestation(absentButReportedScrubbed, {
      manifest: manifest("/private/tmp/live-shape-only"),
      expectedName,
      controlSecret: null,
    }),
    /response-wide scrub and identity contract/,
  );

  const fake = new FakeRunPod({ providerResponseEnv: true });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.schema_version, 3);
  assert.equal(receipt.requested_contract.requested_env, false);
  assert.equal(receipt.requested_contract.control_secret_supplied, false);
  assert.equal(receipt.create_request_attestation.response_env_redacted, true);
  assert.equal(receipt.create_request_attestation.response_control_secret_scrubbed, true);
  const create = fake.calls.find(({ args }) => args[0] === "pod" && args[1] === "create");
  assert.equal(create.args.includes("--env"), false);
  assert.equal(create.args.includes("--env-stdin"), false);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(receipt.cleanup.final_absence_confirmed, true);
});

test("transport canary runs the final revalidation after durable ownership and immediately before POST", async (t) => {
  const fake = new FakeRunPod();
  let revalidationCount = 0;
  const receipt = await execute(t, fake, {
    beforeCreate: async ({ expectedName, reaperRecordId }, root) => {
      revalidationCount += 1;
      assert.equal(fake.createCount, 0);
      const ledger = JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(root, "reaper-ledger.json"), "utf8")));
      const pending = ledger.records.find((record) => record.record_id === reaperRecordId);
      assert.equal(pending.state, "pending");
      assert.equal(pending.expected_name, expectedName);
      assert.equal(fake.calls.at(-1).args[1], "list");
    },
  });
  assert.equal(receipt.status, "passed");
  assert.equal(revalidationCount, 1);
  assert.equal(fake.createCount, 1);
});

test("failed immediate pre-POST revalidation prevents pod creation", async (t) => {
  const fake = new FakeRunPod();
  const receipt = await execute(t, fake, {
    beforeCreate: async () => {
      throw new Error("unit durable asset drift");
    },
  });
  assert.equal(receipt.status, "failed");
  assert.equal(fake.createCount, 0);
  assert.equal(receipt.create_attempts, 0);
  assert.match(receipt.failure_reason, /unit durable asset drift/);
});

test("malformed create output is reconciled by exact generated name and cleaned", async (t) => {
  const fake = new FakeRunPod({ malformed: true });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(fake.present, false);
  assert.match(receipt.failure_reason, /not cleanup-safe/);
});

test("transport exception after dispatch is reconciled and cleaned", async (t) => {
  const fake = new FakeRunPod({ transportError: true });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(fake.present, false);
  assert.match(receipt.failure_reason, /transport failed/);
});

test("normal cleanup retries transient exact GET failures before delete and reaper confirmation", async (t) => {
  const fake = new FakeRunPod({ cleanupGetFailures: 2 });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "passed");
  const cleanupGets = fake.calls.filter(({ args, options }) => (
    args[0] === "pod" && args[1] === "get" && options.label?.includes("identity-check")
  ));
  assert.equal(cleanupGets.length, 4);
  assert.equal(receipt.cleanup.final_absence_confirmed, true);
});

test("a 502 containing 404 text is never classified as final absence", async (t) => {
  const fake = new FakeRunPod({ adversarialAfterDelete: true });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "failed");
  assert.match(receipt.failure_reason, /cleanup retries exhausted|provider operation exhausted/);
  assert.notEqual(receipt.cleanup?.final_absence_confirmed, true);
});

test("a preexisting returned ID is never bound or deleted", async (t) => {
  const fake = new FakeRunPod({ returnedId: STORM_ID });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "pod" && args[1] === "delete"), false);
});

test("a returned storm name is never bound or deleted", async (t) => {
  const fake = new FakeRunPod({ returnedName: "storm-new" });
  const receipt = await execute(t, fake);
  assert.equal(receipt.status, "failed");
  assert.deepEqual(receipt.deleted_exact_pod_ids, []);
  assert.equal(fake.calls.some(({ args }) => args[0] === "pod" && args[1] === "delete"), false);
});

test("a termination signal observed after SSH readiness still waits for exact cleanup", async (t) => {
  const fake = new FakeRunPod();
  const signalState = { requested: false, signal: null };
  const receipt = await execute(t, fake, {
    signalState,
    sshProbe: async ({ podId, expectedName }) => {
      signalState.requested = true;
      signalState.signal = "SIGTERM";
      return { status: "ready", pod_id: podId, pod_name: expectedName };
    },
  });
  assert.equal(receipt.status, "failed");
  assert.match(receipt.failure_reason, /SIGTERM/);
  assert.deepEqual(receipt.deleted_exact_pod_ids, [NEW_ID]);
  assert.equal(fake.present, false);
});

test("live status must bind the exact active runner child and sole output", () => {
  const root = "/private/tmp/canary-output";
  const document = manifest(root);
  const status = {
    state: "active",
    schema_version: 2,
    owner: "mickey",
    run_id: document.run_id,
    supervisor_alive: true,
    child_alive: true,
    child_pid: 1234,
    outputs: [root],
  };
  assert.deepEqual(validateLiveRunnerStatus(status, {
    manifest: document,
    output: root,
    childPid: 1234,
  }), { owner: "mickey", run_id: document.run_id, child_pid: 1234, output: root });
  assert.throws(
    () => validateLiveRunnerStatus({ ...status, child_pid: 9999 }, {
      manifest: document,
      output: root,
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
