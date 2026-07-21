import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  canonicalRequestInputSha256,
} from "../../scripts/run-mickey-cpu-fanout.mjs";
import {
  simulateTransportCanaryForTest,
  withTerminationSignals,
} from "../../scripts/run-mickey-cpu-transport-canary.mjs";

const [readyPath, receiptPath] = process.argv.slice(2);
if (!readyPath || !receiptPath) throw new Error("ready and receipt paths are required");

const podId = "mickey-signal-canary-001";
const manifest = {
  run_id: "mickey-signal-fixture",
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

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

function makeRecord(args) {
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
    id: podId,
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

await withTerminationSignals(async (signalState) => {
  let present = false;
  let record = null;
  let paused = false;
  const executor = {
    async run(_command, args) {
      if (args[0] === "pod" && args[1] === "list" && !args.includes("--name")) {
        return { code: 0, stdout: "[]\n", stderr: "" };
      }
      if (args[0] === "create") {
        record = makeRecord(args);
        present = true;
        return { code: 0, stdout: `${JSON.stringify(record)}\n`, stderr: "" };
      }
      if (args[0] === "pod" && args[1] === "list" && args.includes("--name")) {
        if (present && !paused) {
          paused = true;
          await writeFile(readyPath, "created\n", { mode: 0o600 });
          const deadline = Date.now() + 5_000;
          while (!signalState.requested && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (!signalState.requested) throw new Error("signal fixture timed out");
        }
        return { code: 0, stdout: `${JSON.stringify(present ? [record] : [])}\n`, stderr: "" };
      }
      if (args[0] === "pod" && args[1] === "get") {
        return {
          code: 0,
          stdout: `${JSON.stringify({
            ...record,
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
        if (args[2] !== podId) throw new Error("signal fixture received non-exact cleanup");
        present = false;
        return { code: 0, stdout: `${JSON.stringify({ id: podId })}\n`, stderr: "" };
      }
      throw new Error(`unexpected signal fixture command ${args.join(" ")}`);
    },
  };

  const receipt = await simulateTransportCanaryForTest({
    manifest,
    manifestSha256: createHash("sha256").update("manifest").digest("hex"),
    selfSha256: createHash("sha256").update("canary").digest("hex"),
    output: "/unused",
    executor,
    now: Date.parse("2026-07-21T01:00:00.000Z"),
    pairId: "signal-fixture",
    settle: async () => {},
    signalState,
  });
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  process.exitCode = receipt.status === "failed" && receipt.deleted_exact_pod_ids.includes(podId) ? 17 : 0;
});
