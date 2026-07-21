#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { derivePairOrder } from "./run-mickey-cpu-fanout.mjs";

const SOURCE_RECEIPT_SHA256 = "127d60ee51f4e4b2d50c7b6908d1e571ce8f9e40f1939f61c25e3cdb4abaa129";
const RUNPODCTL_SHA256 = "95555bf636ee752c2da617a27d1bcc59d78481a624d82025a8042b27c2f07ad0";
const RUNPODCTL_UPSTREAM_BASE_COMMIT = "3928df943d67c89e66b4945bd5c8b38ffd512767";
const RUNPODCTL_SOURCE_COMMIT = "83d91b77ba08c76b5ad9f6d22411b66a9d095261";
const RUNPODCTL_SOURCE_TREE = "b542ea965b32794f9735389e2a8a8acb8d25f1f3";
const RUNPODCTL_PATCH_SHA256 = "448a5d0bf42427f877b48d1b64d78ca2a229dfbe86496c89601ab4d51169746b";
const RUNPODCTL_SERIES = Object.freeze([
  ["0001-Add-bounded-REST-CPU-pod-creation.patch", "8907e09b47a9586d01782a16cda3289348988b7ab96258e0d69ece598211287b"],
  ["0002-Make-REST-CPU-cleanup-recovery-only.patch", "797e97ad2f89203804b72d77cab3a9c6cf2c5977d153934e91bd8aadf74ff8ca"],
  ["0003-Read-CPU-control-nonce-from-stdin.patch", "c9bd800d79ebf06b56e0556f41c51e72354e7792fbcfa96c5e68807b2cf689df"],
  ["0004-Scrub-CPU-control-nonce-from-all-output.patch", "b96d2147d42d0c12c3bbf8a8ee75feccd00e8188c891792e137aca2aa0fec804"],
]);
const DURABLE_REAPER_ROOT = "/Users/olifreuler/.stormforge/proxywar-operators/mickey-runpod-reaper";
const DURABLE_BIN_ROOT = `${DURABLE_REAPER_ROOT}/bin`;
const DURABLE_INSTALLATIONS_ROOT = `${DURABLE_BIN_ROOT}/installations`;
const DURABLE_PLIST = "/Users/olifreuler/Library/LaunchAgents/com.welttowelt.proxywar.mickey.runpod-reaper.plist";
const RETAINED = new Map([
  ["grow-opening", ["grow", "all-k1z-grow", "mm1g"]],
  ["grow-low-share", ["grow", "all-k1z-grow", "mm1g"]],
  ["convert-weakest", ["convert", "mixed-outsider-convert", "mm1c"]],
  ["convert-largest", ["convert", "mixed-outsider-convert", "mm1c"]],
]);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL_PLANE_PATHS = {
  fanout_runner: path.join(REPO_ROOT, "scripts", "run-mickey-cpu-fanout.mjs"),
  policy_auditor: path.join(REPO_ROOT, "scripts", "audit-mickey-cpu-fanout.mjs"),
  remote_verifier: path.join(REPO_ROOT, "scripts", "verify-mickey-cpu-fanout-bundle.mjs"),
  exact_id_reaper: path.join(REPO_ROOT, "scripts", "runpod-exact-id-reaper.mjs"),
  reaper_launchd_renderer: path.join(REPO_ROOT, "scripts", "render-runpod-exact-id-reaper-launchd.mjs"),
};

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || ![
      "--fragment", "--output", "--run-id", "--nonce", "--source-receipt",
      "--runpodctl", "--runpodctl-patch", "--runner-lease", "--runner-lease-sha256",
      "--runpodctl-series-dir",
      "--pod-image", "--max-concurrency", "--reaper", "--reaper-ledger",
      "--reaper-service-receipt",
    ].includes(key)) fail(`unknown or incomplete option: ${key}`);
    if (Object.hasOwn(options, key)) fail(`duplicate option: ${key}`);
    options[key] = value;
  }
  for (const key of [
    "--fragment", "--output", "--run-id", "--source-receipt", "--runpodctl",
    "--runpodctl-patch", "--runner-lease", "--runner-lease-sha256", "--pod-image",
    "--runpodctl-series-dir",
    "--reaper", "--reaper-ledger", "--reaper-service-receipt",
  ]) {
    if (!options[key]) fail(`${key} is required`);
  }
  for (const key of ["--fragment", "--output", "--source-receipt", "--runpodctl", "--runpodctl-patch", "--runpodctl-series-dir", "--runner-lease", "--reaper", "--reaper-ledger", "--reaper-service-receipt"]) {
    if (!path.isAbsolute(options[key])) fail(`${key} must be absolute`);
  }
  const maxConcurrency = Number(options["--max-concurrency"] ?? 4);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 4) {
    fail("--max-concurrency must be an integer from 1 to 4");
  }
  const nonce = options["--nonce"] ?? randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(nonce)) fail("--nonce must be 64 lowercase hex characters");
  if (!/^[a-f0-9]{64}$/.test(options["--runner-lease-sha256"])) fail("--runner-lease-sha256 must be 64 lowercase hex characters");
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(options["--run-id"])) fail("--run-id is invalid");
  return {
    fragment: options["--fragment"],
    output: options["--output"],
    runId: options["--run-id"],
    nonce,
    sourceReceipt: options["--source-receipt"],
    runpodctl: options["--runpodctl"],
    runpodctlPatch: options["--runpodctl-patch"],
    runpodctlSeriesDir: options["--runpodctl-series-dir"],
    runnerLease: options["--runner-lease"],
    runnerLeaseSha256: options["--runner-lease-sha256"],
    podImage: options["--pod-image"],
    reaper: options["--reaper"],
    reaperLedger: options["--reaper-ledger"],
    reaperServiceReceipt: options["--reaper-service-receipt"],
    maxConcurrency,
  };
}

function policyIdentity(policy) {
  return {
    policy_id: policy.policy_id,
    policy_key: policy.key,
    arm: policy.arm,
    docker_target: policy.docker_target,
    surrogate_source: policy.surrogate_source,
    source_commit: policy.source_commit,
    image_id: policy.image_id,
    bundle_root: policy.bundle_root,
    run: policy.run,
    entrypoint_sha256: policy.entrypoint_sha256,
    upload_eligible: policy.upload_eligible,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.reaper !== CONTROL_PLANE_PATHS.exact_id_reaper) {
    fail("--reaper must be the exact integration reaper script");
  }
  if (await sha256File(options.runpodctl) !== RUNPODCTL_SHA256) {
    fail("--runpodctl does not match the frozen cleanroom arm64 binary");
  }
  if (await sha256File(options.runpodctlPatch) !== RUNPODCTL_PATCH_SHA256) {
    fail("--runpodctl-patch does not match the frozen cleanroom patch");
  }
  const officialBasePatchSeries = [];
  for (const [index, [fileName, sha256]] of RUNPODCTL_SERIES.entries()) {
    const filePath = path.join(options.runpodctlSeriesDir, fileName);
    if (await sha256File(filePath) !== sha256) {
      fail(`--runpodctl-series-dir patch ${index + 1} does not match the frozen official-base series`);
    }
    officialBasePatchSeries.push({ sequence: index + 1, path: filePath, sha256 });
  }
  const fragment = JSON.parse(await readFile(options.fragment, "utf8"));
  if (
    fragment.schema_version !== 1 ||
    fragment.kind !== "mickey_cpu_fanout_bundle_fragment" ||
    fragment.evidence_scope !== "diagnostic_only" ||
    fragment.pair_count !== 16 ||
    !Array.isArray(fragment.pairs) ||
    !Array.isArray(fragment.policies)
  ) fail("bundle fragment does not describe the exact 16-pair diagnostic screen");
  const m0Policies = fragment.policies.filter((policy) => policy.policy_id === "mickey-static-eval/m0");
  if (m0Policies.length !== 1) fail("bundle fragment must contain exactly one M0 policy");
  const m0 = policyIdentity(m0Policies[0]);
  const arms = [];
  for (const [armId, [mechanismClass, rosterClass, marker]] of RETAINED) {
    const policies = fragment.policies.filter((policy) => policy.policy_id === `mickey-static-eval/${armId}`);
    const pairs = fragment.pairs.filter((pair) => pair.arm === armId);
    if (policies.length !== 1 || pairs.length !== 4) fail(`fragment lacks exact four-pair arm ${armId}`);
    arms.push({
      id: armId,
      mechanism_class: mechanismClass,
      roster_class: rosterClass,
      bundle: fragment.bundle,
      extractor: fragment.extractor,
      shared_files: fragment.shared_files,
      candidate: policyIdentity(policies[0]),
      m0,
      gates: {
        mechanism: {
          marker,
          expected_reach: true,
          minimum_marker_count: 1,
          minimum_accepted_replacements: 1,
          maximum_unexplained_holds: 0,
          maximum_rejected_decisions: 0,
          maximum_k1z_harm: 0,
        },
        outcome: {
          primary_metric: "score",
          direction: "candidate_minus_m0",
          minimum_candidate_minus_m0: 0.001,
          secondary_metric: "final_tiles",
          minimum_secondary_delta: 1,
          minimum_pairs: 4,
          require_mirrored_seats: true,
        },
      },
      pairs: pairs.map((pair) => {
        const draw = derivePairOrder(options.nonce, armId, pair.id);
        return {
          id: pair.id,
          map: pair.map,
          seed: pair.seed,
          seat: pair.seat,
          max_decision_steps: pair.max_decision_steps,
          roster: pair.roster,
          candidate_spec: pair.candidate_spec,
          m0_spec: pair.m0_spec,
          order: draw.order,
          order_draw_sha256: draw.digest,
        };
      }),
    });
  }
  const controlPlane = Object.fromEntries(await Promise.all(
    Object.entries(CONTROL_PLANE_PATHS).map(async ([key, filePath]) => [
      key,
      { path: filePath, sha256: await sha256File(filePath) },
    ]),
  ));
  const nodeRuntime = { path: process.execPath, sha256: await sha256File(process.execPath) };
  const installationId = createHash("sha256").update([
    RUNPODCTL_SOURCE_COMMIT,
    RUNPODCTL_SOURCE_TREE,
    RUNPODCTL_SHA256,
    controlPlane.exact_id_reaper.sha256,
    nodeRuntime.sha256,
  ].join("\n"), "utf8").digest("hex");
  const installationDirectory = `${DURABLE_INSTALLATIONS_ROOT}/${installationId}`;
  const durableReaper = `${installationDirectory}/runpod-exact-id-reaper.mjs`;
  const durableRunpodctl = `${installationDirectory}/runpodctl-darwin-arm64`;
  const allowedServiceReceipts = new Set([
    `${DURABLE_REAPER_ROOT}/service-receipt.json`,
    `${DURABLE_REAPER_ROOT}/service-receipt-${options.runId}.json`,
  ]);
  if (
    options.reaperLedger !== `${DURABLE_REAPER_ROOT}/ledger.json` ||
    !allowedServiceReceipts.has(options.reaperServiceReceipt)
  ) {
    fail("reaper ledger and service receipt must use exact run-bound durable Mickey paths");
  }
  const manifest = {
    schema_version: 3,
    kind: "mickey_cpu_fanout",
    run_id: options.runId,
    preregistered_at: new Date().toISOString(),
    evidence_scope: "diagnostic_only",
    randomization: { algorithm: "sha256-parity-v1", nonce: options.nonce },
    control_plane: controlPlane,
    runner_lease: {
      path: options.runnerLease,
      sha256: options.runnerLeaseSha256,
      operator_lane: "mickey",
      state_root: "/Users/olifreuler/.stormforge/proxywar-operators",
    },
    runpodctl: {
      path: durableRunpodctl,
      sha256: RUNPODCTL_SHA256,
      install_source_path: options.runpodctl,
      source_repository: "https://github.com/runpod/runpodctl",
      upstream_base_commit: RUNPODCTL_UPSTREAM_BASE_COMMIT,
      source_commit: RUNPODCTL_SOURCE_COMMIT,
      source_tree: RUNPODCTL_SOURCE_TREE,
      official_base_patch_series: officialBasePatchSeries,
      patch_path: options.runpodctlPatch,
      patch_sha256: RUNPODCTL_PATCH_SHA256,
      patch_id: "mickey-cpu-rest-stdin-scrub-no-delete-v4",
      create_interface: "rest-cpu-pod-create-stdin-v3",
      nonce_input_channel: "stdin",
      nonce_input_flag: "--env-stdin",
      receipt_redaction_schema: "env-map-v2",
      response_scrub_contract: "recursive-case-insensitive-string-leaves-and-map-keys",
      provider_identity_contamination: "redact-id-and-name-require-reconciliation",
      serialized_output_guard: "constant-value-free-failure-and-no-receipt",
    },
    pod: {
      name_prefix: "proxywar-mickey-cpu-fanout",
      image: options.podImage,
      compute_type: "CPU",
      cloud_type: "COMMUNITY",
      gpu_count: 0,
      max_cost_per_hour: 0.1,
      max_total_cost_usd: 3.2,
      vcpu_count: 2,
      memory_gb: 4,
      container_disk_gb: 20,
      volume_gb: 0,
      network_volume_id: null,
      cpu_flavor_ids: ["cpu5c", "cpu3c"],
      cpu_flavor_priority: "custom",
      public_ip: true,
      ports: ["22/tcp"],
      max_concurrency: options.maxConcurrency,
    },
    cleanup_watchdog: {
      kind: "independent_exact_id_reaper_v1",
      installation_id: installationId,
      state_root: DURABLE_REAPER_ROOT,
      bin_root: DURABLE_BIN_ROOT,
      installations_root: DURABLE_INSTALLATIONS_ROOT,
      installation_directory: installationDirectory,
      script: {
        path: durableReaper,
        sha256: controlPlane.exact_id_reaper.sha256,
        install_source_path: options.reaper,
      },
      node_runtime: nodeRuntime,
      plist_path: DURABLE_PLIST,
      ledger_path: options.reaperLedger,
      heartbeat_path: path.join(path.dirname(options.reaperLedger), "provider-heartbeat.json"),
      heartbeat_max_age_seconds: 120,
      client_cleanup_deadline_seconds: 7200,
      poll_interval_seconds: 60,
      provider_ttl_available: false,
      exact_id_only: true,
      launchd_required_for_live_run: true,
      launchd_label: "com.welttowelt.proxywar.mickey.runpod-reaper",
      service_receipt_path: options.reaperServiceReceipt,
    },
    source_reach_receipt: { path: options.sourceReceipt, sha256: SOURCE_RECEIPT_SHA256 },
    arms,
    promotion_gates: {
      local_fanout_can_promote: false,
      upload_allowed: false,
      hosted_4_of_4_required: true,
      regression_20_of_20_required: true,
      final_rci_required: true,
      zero_k1z_harm_required: true,
    },
  };
  await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: options.output, run_id: options.runId, nonce: options.nonce, pair_count: 16 })}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`MICKEY_MANIFEST_COMPOSE_FAILED: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
