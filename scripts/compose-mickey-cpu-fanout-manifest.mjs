#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { derivePairOrder } from "./run-mickey-cpu-fanout.mjs";

const SOURCE_RECEIPT_SHA256 = "127d60ee51f4e4b2d50c7b6908d1e571ce8f9e40f1939f61c25e3cdb4abaa129";
const RUNPODCTL_SHA256 = "b588c113a85856e13af9e02bd107f6c330ecd3b5b56fa1bc94cc673f6cb1f388";
const RUNPODCTL_UPSTREAM_BASE_COMMIT = "3928df943d67c89e66b4945bd5c8b38ffd512767";
const RUNPODCTL_SOURCE_COMMIT = "d4296baa6edf37f098d58e9d92f7b496ee4bfaab";
const RUNPODCTL_PATCH_SHA256 = "9aca93b4e0dc8f48b0b36df448dafdb52dd12a6ec4d80b70ad7a171a09106a18";
const RETAINED = new Map([
  ["grow-opening", ["grow", "all-k1z-grow", "mm1g"]],
  ["grow-low-share", ["grow", "all-k1z-grow", "mm1g"]],
  ["convert-weakest", ["convert", "mixed-outsider-convert", "mm1c"]],
  ["convert-largest", ["convert", "mixed-outsider-convert", "mm1c"]],
]);

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
      "--pod-image", "--max-concurrency",
    ].includes(key)) fail(`unknown or incomplete option: ${key}`);
    if (Object.hasOwn(options, key)) fail(`duplicate option: ${key}`);
    options[key] = value;
  }
  for (const key of [
    "--fragment", "--output", "--run-id", "--source-receipt", "--runpodctl",
    "--runpodctl-patch", "--runner-lease", "--runner-lease-sha256", "--pod-image",
  ]) {
    if (!options[key]) fail(`${key} is required`);
  }
  for (const key of ["--fragment", "--output", "--source-receipt", "--runpodctl", "--runpodctl-patch", "--runner-lease"]) {
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
    runnerLease: options["--runner-lease"],
    runnerLeaseSha256: options["--runner-lease-sha256"],
    podImage: options["--pod-image"],
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
  const manifest = {
    schema_version: 1,
    kind: "mickey_cpu_fanout",
    run_id: options.runId,
    preregistered_at: new Date().toISOString(),
    evidence_scope: "diagnostic_only",
    randomization: { algorithm: "sha256-parity-v1", nonce: options.nonce },
    runner_lease: {
      path: options.runnerLease,
      sha256: options.runnerLeaseSha256,
      operator_lane: "hrafn",
      state_root: "/Users/olifreuler/.stormforge/proxywar-operators",
    },
    runpodctl: {
      path: options.runpodctl,
      sha256: RUNPODCTL_SHA256,
      source_repository: "https://github.com/runpod/runpodctl",
      upstream_base_commit: RUNPODCTL_UPSTREAM_BASE_COMMIT,
      source_commit: RUNPODCTL_SOURCE_COMMIT,
      patch_path: options.runpodctlPatch,
      patch_sha256: RUNPODCTL_PATCH_SHA256,
      patch_id: "mickey-cpu-terminate-after-v1",
      create_interface: "legacy-graphql-json-v1",
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
      terminate_after_seconds: 7200,
      max_concurrency: options.maxConcurrency,
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
