import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  activationManifestDigest,
  appendEvent,
  CommandExecutor,
  canonicalRequestInputSha256,
  createFanoutLedgerMutationCoordinator,
  deleteExactPod,
  derivePairOrder,
  discoverNewExactNamePods,
  executeAfterExactR8MutationBoundary,
  executeAfterExactR9PrePostBoundary,
  executeAfterExactR9WorkerStartBoundary,
  parseSshKeygenFingerprint,
  prepareKnownHostsFile,
  preflightManifest,
  REMOTE_POST_RUN_ATTESTATION_STATUS,
  isFullFanoutLiveApproved,
  isExactR9ActivationCandidate,
  isExactR8PrePostRecoveryRecord,
  r9ActivationManifestDigest,
  runR9SerializedCreateTransaction,
  normalizeForegroundReaperForR8Persistence,
  reconcileAndCleanupReaperRecord,
  registerCreatedPod,
  sanitizePodInventory,
  validateCreateRequestAttestation,
  validateCreatedPod,
  validateSshHostKeyAttestation,
  validateSshInfo,
  validateManifest,
  validateMickeyRunnerStatus,
  validateR8LedgerQuiescence,
  validateR8MutationLedgerBoundary,
  validateR9LedgerReady,
  validateR9RecoveryHistory,
  validateR9SafePreProviderBlockedRecord,
  validateR9WorkerStartLedgerBoundary,
  validateR8PersistentReaperCompatibility,
  validateFinalReaperServiceIdentity,
  validateTransportCanaryActivationReceipt,
  validateTransportCanaryKnownHosts,
  verifyLiveReaperService,
  verifyFetchedArtifacts,
} from "../scripts/run-mickey-cpu-fanout.mjs";
import {
  ReaperLedgerLockedError,
  blockPendingBeforeProviderPost,
  preparePendingCreate,
  readReaperLedger,
} from "../scripts/runpod-exact-id-reaper.mjs";
import {
  auditMickeyCpuFanout,
  mirroredSeatsPass,
} from "../scripts/audit-mickey-cpu-fanout.mjs";
import { parseFileManifest } from "../scripts/verify-mickey-cpu-fanout-bundle.mjs";
import {
  inspectRunningReaperService,
  renderReaperPlistForTest,
  stageDurableReaperInstallation,
} from "../scripts/render-runpod-exact-id-reaper-launchd.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fanoutScript = path.join(root, "scripts", "run-mickey-cpu-fanout.mjs");
const auditScript = path.join(root, "scripts", "audit-mickey-cpu-fanout.mjs");
const remoteVerifierScript = path.join(root, "scripts", "verify-mickey-cpu-fanout-bundle.mjs");
const rendererScript = path.join(root, "scripts", "render-mickey-cpu-fanout-launchd.mjs");
const reaperScript = path.join(root, "scripts", "runpod-exact-id-reaper.mjs");
const reaperRendererScript = path.join(root, "scripts", "render-runpod-exact-id-reaper-launchd.mjs");
const verifierScript = path.join(root, "scripts", "verify-mickey-cpu-fanout-bundle.mjs");
const durableReaperRoot = "/Users/olifreuler/.stormforge/proxywar-operators/mickey-runpod-reaper";
const durableBinRoot = `${durableReaperRoot}/bin`;
const durableInstallationsRoot = `${durableBinRoot}/installations`;
const durablePlist = "/Users/olifreuler/Library/LaunchAgents/com.welttowelt.proxywar.mickey.runpod-reaper.plist";
const r8ManifestPath = path.join(
  root,
  "experiments",
  "manifest-mickey-cpu-screen-g000-r8-20260721.json",
);
const r8Manifest = JSON.parse(readFileSync(r8ManifestPath, "utf8"));
const r9ManifestPath = path.join(
  root,
  "experiments",
  "manifest-mickey-cpu-screen-g000-r9-20260721.json",
);
const r9Manifest = JSON.parse(readFileSync(r9ManifestPath, "utf8"));
const acceptedCanaryFixture = JSON.parse(readFileSync(
  path.join(
    root,
    "test-support",
    "fixtures",
    "runpod-transport-canary-r7-accepted-reconstructed_sanitized.json",
  ),
  "utf8",
));
const HEX = {
  source: "1".repeat(40),
  m0Entry: "1".repeat(64),
  goEntry: "2".repeat(64),
  glEntry: "3".repeat(64),
  cwEntry: "4".repeat(64),
  clEntry: "5".repeat(64),
  m0Image: `sha256:${"6".repeat(64)}`,
  goImage: `sha256:${"7".repeat(64)}`,
};

test("bundle file manifest accepts real npm and asset paths but rejects traversal", () => {
  const digest = "a".repeat(64);
  const entries = parseFileManifest([
    `${digest}  runtime/node_modules/@scope/package/index.js`,
    `${digest}  runtime/proxywar/resources/flags/East Anglia – 1.svg`,
    "",
  ].join("\n"));
  assert.equal(entries.size, 2);
  assert.throws(
    () => parseFileManifest(`${digest}  runtime/../escape\n`),
    /non-canonical path/,
  );
  assert.throws(
    () => parseFileManifest(`${digest}  runtime\\escape\n`),
    /non-canonical path/,
  );
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function tempDirectory(prefix) {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

function identity(arm, entrypointHash, imageId) {
  const suffix = arm;
  const entrypoint = `evaluation-${arm}-player.mjs`;
  return {
    policy_id: `mickey-static-eval/${arm}`,
    policy_key: `mickey-static-eval-${arm}`,
    arm,
    docker_target: `evaluation-${arm}`,
    surrogate_source: "static-eval-v1",
    source_commit: HEX.source,
    image_id: imageId,
    bundle_root: `policies/mickey-static-eval-${suffix}/app`,
    run: ["node", entrypoint],
    entrypoint_sha256: entrypointHash,
    upload_eligible: false,
  };
}

function sourceReceipt() {
  const records = [
    ["m0", HEX.m0Entry, "a".repeat(64), false],
    ["grow-opening", HEX.goEntry, "b".repeat(64), true],
    ["grow-low-share", HEX.glEntry, "c".repeat(64), true],
    ["convert-weakest", HEX.cwEntry, "d".repeat(64), true],
    ["convert-largest", HEX.clEntry, "e".repeat(64), true],
  ];
  return {
    schema_version: 1,
    evidence_scope: "deterministic-source-fixtures-only",
    source_commit: HEX.source,
    surrogate_source: "static-eval-v1",
    upload_eligible: false,
    fixture_set_sha256: "f".repeat(64),
    fixture_ids: ["all-k1z-safety", "mixed-outsider-convert"],
    arms: records.map(([id, entrypoint, trace, reached]) => ({
      id,
      docker_target: `evaluation-${id}`,
      run: ["node", `evaluation-${id}-player.mjs`],
      entrypoint_sha256: entrypoint,
      expected_mechanism_reach: reached,
      mechanism_reached: reached,
      selected_action_trace_sha256: trace,
      k1z_harm_count: 0,
    })),
  };
}

function fixture() {
  const directory = tempDirectory("mickey-fanout-test-");
  const bundle = path.join(directory, "grow-opening.tar.gz");
  const extractor = path.join(directory, "extract.py");
  const runpodctl = path.join(directory, "runpodctl-mickey-pinned");
  const runpodctlPatch = path.join(directory, "runpodctl.patch");
  const runpodctlSeries = [1, 2, 3, 4].map((sequence) =>
    path.join(directory, `runpodctl-series-${sequence}.patch`));
  const runnerLease = path.join(directory, "proxywar-runner-lease.sh");
  const receiptPath = path.join(directory, "source-reach.json");
  writeFileSync(bundle, "immutable-bundle\n");
  writeFileSync(extractor, "#!/usr/bin/env python3\n");
  writeFileSync(runpodctl, "runpodctl cleanroom-39906d06bfc0558e9b76d217fa6be6f3740a0423\n");
  writeFileSync(runpodctlPatch, "fixture patch\n");
  runpodctlSeries.forEach((filePath, index) => writeFileSync(filePath, `fixture series ${index + 1}\n`));
  writeFileSync(runnerLease, "#!/bin/sh\nexit 99\n");
  chmodSync(runpodctl, 0o755);
  chmodSync(runnerLease, 0o755);
  writeFileSync(receiptPath, `${JSON.stringify(sourceReceipt(), null, 2)}\n`);
  const nonce = "9".repeat(64);
  const pairId = "go-pangaea-seed-1-seat-0";
  const draw = derivePairOrder(nonce, "grow-opening", pairId);
  const m0 = identity("m0", HEX.m0Entry, HEX.m0Image);
  const candidate = identity("grow-opening", HEX.goEntry, HEX.goImage);
  const runpodctlSha256 = sha256File(runpodctl);
  const reaperSha256 = sha256File(reaperScript);
  const nodeSha256 = sha256File(process.execPath);
  const sourceCommit = "39906d06bfc0558e9b76d217fa6be6f3740a0423";
  const sourceTree = "f6d47598c72f0d78fd9c660c4589996c8a8be033";
  const installationId = sha256([
    sourceCommit,
    sourceTree,
    runpodctlSha256,
    reaperSha256,
    nodeSha256,
  ].join("\n"));
  const installationDirectory = `${durableInstallationsRoot}/${installationId}`;
  const manifest = {
    schema_version: 3,
    kind: "mickey_cpu_fanout",
    run_id: "mickey-fanout-unit",
    preregistered_at: new Date(Date.now() - 1_000).toISOString(),
    evidence_scope: "diagnostic_only",
    randomization: { algorithm: "sha256-parity-v1", nonce },
    control_plane: {
      fanout_runner: { path: fanoutScript, sha256: sha256File(fanoutScript) },
      policy_auditor: { path: auditScript, sha256: sha256File(auditScript) },
      remote_verifier: { path: remoteVerifierScript, sha256: sha256File(remoteVerifierScript) },
      exact_id_reaper: { path: reaperScript, sha256: sha256File(reaperScript) },
      reaper_launchd_renderer: {
        path: reaperRendererScript,
        sha256: sha256File(reaperRendererScript),
      },
    },
    runner_lease: {
      path: runnerLease,
      sha256: sha256File(runnerLease),
      operator_lane: "mickey",
      state_root: "/Users/olifreuler/.stormforge/proxywar-operators",
    },
    runpodctl: {
      path: `${installationDirectory}/runpodctl-darwin-arm64`,
      sha256: runpodctlSha256,
      install_source_path: runpodctl,
      source_repository: "https://github.com/runpod/runpodctl",
      upstream_base_commit: "3928df943d67c89e66b4945bd5c8b38ffd512767",
      source_commit: sourceCommit,
      source_tree: sourceTree,
      official_base_patch_series: runpodctlSeries.map((filePath, index) => ({
        sequence: index + 1,
        path: filePath,
        sha256: sha256File(filePath),
      })),
      patch_path: runpodctlPatch,
      patch_sha256: sha256File(runpodctlPatch),
      patch_id: "mickey-cpu-rest-stdin-no-delete-v3",
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
      image: "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
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
      max_concurrency: 1,
    },
    cleanup_watchdog: {
      kind: "independent_exact_id_reaper_v1",
      installation_id: installationId,
      state_root: durableReaperRoot,
      bin_root: durableBinRoot,
      installations_root: durableInstallationsRoot,
      installation_directory: installationDirectory,
      script: {
        path: `${installationDirectory}/runpod-exact-id-reaper.mjs`,
        sha256: reaperSha256,
        install_source_path: reaperScript,
      },
      node_runtime: { path: process.execPath, sha256: nodeSha256 },
      plist_path: durablePlist,
      ledger_path: `${durableReaperRoot}/ledger.json`,
      heartbeat_path: `${durableReaperRoot}/provider-heartbeat.json`,
      heartbeat_max_age_seconds: 120,
      client_cleanup_deadline_seconds: 7200,
      poll_interval_seconds: 60,
      provider_ttl_available: false,
      exact_id_only: true,
      launchd_required_for_live_run: true,
      launchd_label: "com.welttowelt.proxywar.mickey.runpod-reaper",
      service_receipt_path: `${durableReaperRoot}/service-receipt.json`,
    },
    source_reach_receipt: { path: receiptPath, sha256: sha256File(receiptPath) },
    arms: [
      {
        id: "grow-opening",
        mechanism_class: "grow",
        roster_class: "all-k1z-grow",
        bundle: { path: bundle, sha256: sha256File(bundle) },
        extractor: { path: extractor, sha256: sha256File(extractor) },
        shared_files: [
          "evaluation-static-intent-player.mjs",
          "evaluation-static-intent.mjs",
          "intent-controller.mjs",
          "strategy-engine.mjs",
        ].map((file, index) => ({ path: file, sha256: String(index + 1).repeat(64) })),
        candidate,
        m0,
        gates: {
          mechanism: {
            marker: "mm1g",
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
            minimum_pairs: 1,
            require_mirrored_seats: false,
          },
        },
        pairs: [
          {
            id: pairId,
            map: "Pangaea",
            seed: 1,
            seat: 0,
            max_decision_steps: 80,
            roster: [
              { seat: 0, name: "K1Z Mickey Mouse", coalition: "k1z" },
              { seat: 1, name: "K1Z Odin", coalition: "k1z" },
            ],
            candidate_spec: { archive_path: "specs/go-a.json", sha256: "a".repeat(64) },
            m0_spec: { archive_path: "specs/go-m0.json", sha256: "b".repeat(64) },
            order: draw.order,
            order_draw_sha256: draw.digest,
          },
        ],
      },
    ],
    promotion_gates: {
      local_fanout_can_promote: false,
      upload_allowed: false,
      hosted_4_of_4_required: true,
      regression_20_of_20_required: true,
      final_rci_required: true,
      zero_k1z_harm_required: true,
    },
  };
  const manifestPath = path.join(directory, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, manifest, manifestPath, manifestSha256: sha256File(manifestPath), receiptPath };
}

test("manifest pins a fair M0, exact identities, fixture, randomized order, and promotion boundary", () => {
  const { directory, manifest } = fixture();
  try {
    const validated = validateManifest(manifest);
    assert.equal(validated.pairs.length, 1);
    assert.equal(validated.pairs[0].arm.m0.arm, "m0");
    assert.equal(validated.pairs[0].pair.roster.every((seat) => seat.coalition === "k1z"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("r8 activation remains semantically reproducible but is no longer live-approved", () => {
  const validated = validateManifest(r8Manifest);
  assert.equal(validated.pairs.length, 16);
  assert.equal(r8Manifest.pod.max_concurrency, 4);
  assert.equal(r8Manifest.activation.screen_pair_count, 16);
  assert.equal(r8Manifest.activation.one_pod_per_pair, true);
  assert.equal(r8Manifest.activation.nonce_input_channel, "stdin");
  assert.equal(r8Manifest.activation.preexisting_pod_deletion_allowed, false);
  assert.equal(r8Manifest.activation.storm_pod_deletion_allowed, false);
  assert.equal(r8Manifest.activation.resume_allowed, false);
  assert.equal(
    activationManifestDigest(r8Manifest),
    "5b53c76ef088cd3d929efc0ea72f73dfa103754804231dd6ef76a43bddcb96f2",
  );
  const activationEvidence = {
    receipt_sha256: r8Manifest.activation.canary_receipt.sha256,
    known_hosts_sha256: r8Manifest.activation.canary_known_hosts.sha256,
    ledger_state: "retired",
    terminal_reason: "normal_cleanup_confirmed_absent",
  };
  assert.equal(isFullFanoutLiveApproved({
    manifestPath: r8ManifestPath,
    document: r8Manifest,
    activationEvidence,
  }), false);
  assert.equal(isFullFanoutLiveApproved({
    manifestPath: `${r8ManifestPath}.drift`,
    document: r8Manifest,
    activationEvidence,
  }), false);
  const drifted = structuredClone(r8Manifest);
  drifted.preregistered_at = "2026-07-21T03:14:49.000Z";
  assert.throws(() => validateManifest(drifted), /semantic digest mismatch/);
});

test("r9 activation is the sole recovery-bound live candidate", () => {
  const validated = validateManifest(r9Manifest);
  assert.equal(validated.pairs.length, 16);
  assert.equal(
    r9ActivationManifestDigest(r9Manifest),
    "1f671075f28da27ce350ae2f443325f3c895f9a2ce8fe0efcd7815893c2460e4",
  );
  const activationEvidence = {
    receipt_sha256: r9Manifest.activation.canary_receipt.sha256,
    known_hosts_sha256: r9Manifest.activation.canary_known_hosts.sha256,
    failure_evidence_sha256: r9Manifest.activation.r8_failure_evidence.sha256,
    recovery_receipt_sha256: r9Manifest.activation.r8_recovery_receipt.sha256,
    recovery_status: "passed",
    recovery_record_state: "blocked",
    recovery_terminal_reason: "pre_post_create_not_invoked",
  };
  const preflight = { manifestPath: r9ManifestPath, document: r9Manifest, activationEvidence };
  assert.equal(isExactR9ActivationCandidate(preflight), true);
  assert.equal(isFullFanoutLiveApproved(preflight), true);
  const drifted = structuredClone(r9Manifest);
  drifted.activation.resume_allowed = true;
  assert.throws(() => validateManifest(drifted), /exact r9 recovery-bound/);
});

test("r9 adopts the exact r8 cleanup daemon while foreground-only additions normalize byte-for-byte", () => {
  const persistentSource = readFileSync(r9Manifest.cleanup_watchdog.script.path, "utf8");
  const foregroundSource = readFileSync(reaperScript, "utf8");
  const proof = validateR8PersistentReaperCompatibility(persistentSource, foregroundSource);
  assert.deepEqual(proof, r9Manifest.activation.persistent_reaper.compatibility);
  assert.equal(normalizeForegroundReaperForR8Persistence(foregroundSource), persistentSource);
  assert.notEqual(
    r9Manifest.cleanup_watchdog.script.sha256,
    r9Manifest.control_plane.exact_id_reaper.sha256,
  );
  assert.equal(
    r9Manifest.cleanup_watchdog.installation_id,
    r9Manifest.activation.persistent_reaper.installation_id,
  );
  assert.throws(
    () => validateR8PersistentReaperCompatibility(
      persistentSource.replace("pollReaper", "pollReaperDrift"),
      foregroundSource,
    ),
    /persistent r8 reaper behavior surface/,
  );
  assert.throws(
    () => normalizeForegroundReaperForR8Persistence(
      foregroundSource.replace("ReaperLedgerLockedError(owner.pid)", "ReaperValidationError('drift')"),
    ),
    /typed live-owner throw/,
  );
  const swapped = structuredClone(r9Manifest);
  swapped.cleanup_watchdog.script.sha256 = swapped.control_plane.exact_id_reaper.sha256;
  assert.throws(() => validateManifest(swapped), /durable versioned installation paths/);
});

test("remote episode gate uses the canonical stable post-run attestation status", () => {
  assert.equal(REMOTE_POST_RUN_ATTESTATION_STATUS, "stable");
  const source = readFileSync(fanoutScript, "utf8");
  assert.match(source, /post_run_attestation\?\.status!==\$\{JSON\.stringify\(REMOTE_POST_RUN_ATTESTATION_STATUS\)\}/);
  assert.doesNotMatch(source, /post_run_attestation\?\.status!=='passed'/);
});

test("final reaper identity is checked before evidence eligibility and rejects PID or receipt drift", () => {
  const initial = {
    status: "active",
    label: "com.welttowelt.proxywar.mickey.runpod-reaper",
    domain: "gui/501",
    pid: 12345,
    ledger_path: "/private/tmp/ledger.json",
    receipt_path: "/private/tmp/service-receipt.json",
    receipt_sha256: "a".repeat(64),
  };
  assert.equal(
    validateFinalReaperServiceIdentity(initial, structuredClone(initial)).pid,
    initial.pid,
  );
  for (const mutate of [
    (value) => { value.pid += 1; },
    (value) => { value.receipt_sha256 = "b".repeat(64); },
    (value) => { value.ledger_path = "/private/tmp/other-ledger.json"; },
  ]) {
    const drifted = structuredClone(initial);
    mutate(drifted);
    assert.throws(
      () => validateFinalReaperServiceIdentity(initial, drifted),
      /drifted before final evidence gate/,
    );
  }
  const source = readFileSync(fanoutScript, "utf8");
  const finalCheck = source.lastIndexOf("const finalReaperService = await verifyLiveReaperService");
  const evidenceEligible = source.lastIndexOf("state.evidence_eligible = true");
  assert.equal(finalCheck > 0 && evidenceEligible > finalCheck, true);
});

test("r8 foreground runner status binds schema two to this exact child and sole output", () => {
  const output = r8Manifest.activation.output_path;
  const status = {
    schema_version: 2,
    state: "active",
    owner: "mickey",
    run_id: r8Manifest.run_id,
    child_pid: process.pid,
    supervisor_alive: true,
    child_alive: true,
    reap_in_progress: false,
    outputs: [output],
  };
  assert.equal(
    validateMickeyRunnerStatus(status, output, r8Manifest.run_id),
    status,
  );
  for (const mutate of [
    (value) => { value.schema_version = 1; },
    (value) => { value.child_pid = process.pid + 1; },
    (value) => { value.outputs.push("/private/tmp/unrelated-output"); },
    (value) => { value.outputs = ["/private/tmp/unrelated-output"]; },
  ]) {
    const drifted = structuredClone(status);
    mutate(drifted);
    assert.throws(
      () => validateMickeyRunnerStatus(drifted, output, r8Manifest.run_id),
      /exact Mickey foreground runner child/,
    );
  }
});

function exactR8RecoveryRecord() {
  const recoveredAt = "2026-07-21T04:30:00.000Z";
  return {
    record_id: "mickey-reaper:f6707829-6e5f-46e0-9071-5f3e91f91f35",
    state: "blocked",
    run_id: "mickey-screen-g000-r8-20260721t031448z:grow-opening-asia-s0-c",
    manifest_sha256: "6d50207e6498e98fa36c88950188bf227b66011b977253f73aa6786c91e7bd6f",
    deadline: "2026-07-21T05:42:20.144Z",
    ownership_kind: "generated-exact-name-v1",
    name_prefix: "proxywar-mickey-cpu-fanout",
    name_nonce: "ba7e0411a40d16bb617a743c7a86966f",
    expected_name: "proxywar-mickey-cpu-fanout-ba7e0411a40d16bb617a743c7a86966f",
    preexisting_ids: [
      "0l7p9ke95cu6ms", "2g5whxhph9bwbz", "3649lnxlyhlf3n", "67yzvbbp54aizm",
      "76stn0v7q81d47", "825a2frvggm1k4", "877itccar33zdp", "a7dmwmcmh45a4b",
      "ctnggpz7t6nj6c", "l1evg0fagjmbgn", "lb4zz7jzgq9tr2", "lshjhv5avqjsaj",
      "ne262xferohtdi", "og13wgkfcmblx9", "rkm013fsjsf87c", "rwvsgeancauyug",
      "sxrtmdyd62n3ia", "szlrnk3ucex44f", "vbo7a33nlvsrtf", "zadju8y8p6d5r9",
    ],
    preexisting_snapshot_sha256: "5609cad100d6b5477590bf42b531da42d11f29fd3aa7d62b2fb8edda26e61e56",
    pod_id: null,
    active_binding_sha256: null,
    bound_at: null,
    retired_at: null,
    terminal_reason: "pre_post_create_not_invoked",
    last_error: null,
    created_at: "2026-07-21T03:42:20.155Z",
    updated_at: recoveredAt,
    events: [
      { at: "2026-07-21T03:42:20.155Z", type: "pending_create_registered" },
      { at: "2026-07-21T03:43:20.000Z", type: "pending_name_absent" },
      {
        at: recoveredAt,
        type: "pre_post_create_not_invoked",
        recovery_evidence_sha256: "799e4c547fb786e74680365b42fdf55d845e7a1ab7cf7df51e2f058a40d2d280",
        provider_snapshot_sha256: "5609cad100d6b5477590bf42b531da42d11f29fd3aa7d62b2fb8edda26e61e56",
      },
    ],
  };
}

test("r9 ledger admits only the exact blocked r8 recovery and zero initial pending or active", () => {
  const recovery = exactR8RecoveryRecord();
  assert.equal(isExactR8PrePostRecoveryRecord(recovery), true);
  assert.deepEqual(validateR9LedgerReady({ revision: 21, records: [
    { state: "retired" }, recovery,
  ] }), {
    revision: 21,
    pending_count: 0,
    active_count: 0,
    blocked_count: 1,
    r8_recovery_record_id: recovery.record_id,
  });
  assert.deepEqual(validateR9RecoveryHistory({ revision: 22, records: [
    recovery, { state: "pending" }, { state: "active" },
  ] }), {
    revision: 22,
    pending_count: 1,
    active_count: 1,
    r8_recovery_record_id: recovery.record_id,
  });
  for (const mutate of [
    (value) => { value.preexisting_ids[0] = "substituted-id"; },
    (value) => { value.terminal_reason = "identity_refusal"; },
    (value) => { value.events.at(-1).recovery_evidence_sha256 = "0".repeat(64); },
  ]) {
    const drifted = structuredClone(recovery);
    mutate(drifted);
    assert.throws(
      () => validateR9LedgerReady({ revision: 22, records: [drifted] }),
      /only the exact terminal blocked r8/,
    );
  }
  assert.throws(
    () => validateR9LedgerReady({ revision: 22, records: [recovery, { ...recovery, record_id: "other" }] }),
    /only the exact terminal blocked r8/,
  );
  assert.throws(
    () => validateR9LedgerReady({ revision: 22, records: [recovery, { state: "pending" }] }),
    /zero pending and zero active/,
  );
});

test("r8 ledger starts quiescent and each create admits only this process's at-most-four records", () => {
  const manifestSha256 = sha256File(r8ManifestPath);
  const pairIds = r8Manifest.arms.flatMap((arm) => arm.pairs.map((pair) => pair.id));
  const makePending = (pairId, sequence) => {
    const nameNonce = String(sequence).repeat(32);
    return {
      record_id: `mickey-reaper:00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      state: "pending",
      run_id: `${r8Manifest.run_id}:${pairId}`,
      manifest_sha256: manifestSha256,
      ownership_kind: "generated-exact-name-v1",
      name_prefix: r8Manifest.pod.name_prefix,
      name_nonce: nameNonce,
      expected_name: `${r8Manifest.pod.name_prefix}-${nameNonce}`,
      preexisting_ids: ["preexisting-sanitized-pod"],
      preexisting_snapshot_sha256: String(sequence).repeat(64),
      pod_id: null,
      active_binding_sha256: null,
      bound_at: null,
      retired_at: null,
      deadline: "2026-07-21T05:14:48.000Z",
      terminal_reason: null,
      last_error: null,
      created_at: "2026-07-21T03:14:48.000Z",
      updated_at: "2026-07-21T03:14:48.000Z",
      events: [{ at: "2026-07-21T03:14:48.000Z", type: "pending_create_registered" }],
    };
  };
  assert.deepEqual(
    validateR8LedgerQuiescence({ revision: 7, records: [{ state: "retired" }] }),
    { revision: 7, nonterminal_count: 0 },
  );
  assert.throws(
    () => validateR8LedgerQuiescence({ revision: 8, records: [{ state: "blocked" }] }),
    /zero-nonterminal/,
  );

  const pending = makePending(pairIds[0], 1);
  const registeredRecords = new Map([[pending.record_id, { pairId: pairIds[0] }]]);
  const ledger = { revision: 9, records: [{ state: "retired" }, pending] };
  assert.deepEqual(
    validateR8MutationLedgerBoundary({
      ledger,
      manifest: r8Manifest,
      manifestSha256,
      pairId: pairIds[0],
      pendingOwnership: structuredClone(pending),
      registeredRecords,
    }),
    {
      revision: 9,
      pending_record_id: pending.record_id,
      nonterminal_count: 1,
    },
  );

  const changedSnapshot = structuredClone(ledger);
  changedSnapshot.records[1].preexisting_ids.push("late-unregistered-pod");
  assert.throws(
    () => validateR8MutationLedgerBoundary({
      ledger: changedSnapshot,
      manifest: r8Manifest,
      manifestSha256,
      pairId: pairIds[0],
      pendingOwnership: pending,
      registeredRecords,
    }),
    /pending record drifted/,
  );

  const blocked = structuredClone(ledger);
  blocked.records.push({ ...makePending(pairIds[1], 2), state: "blocked" });
  const blockedRecords = new Map(registeredRecords);
  blockedRecords.set(blocked.records[2].record_id, { pairId: pairIds[1] });
  assert.throws(
    () => validateR8MutationLedgerBoundary({
      ledger: blocked,
      manifest: r8Manifest,
      manifestSha256,
      pairId: pairIds[0],
      pendingOwnership: pending,
      registeredRecords: blockedRecords,
    }),
    /blocked ownership record/,
  );

  const overConcurrency = { revision: 10, records: [pending] };
  const overConcurrencyRecords = new Map(registeredRecords);
  for (let index = 1; index < 5; index += 1) {
    const record = makePending(pairIds[index], index + 1);
    overConcurrency.records.push(record);
    overConcurrencyRecords.set(record.record_id, { pairId: pairIds[index] });
  }
  assert.throws(
    () => validateR8MutationLedgerBoundary({
      ledger: overConcurrency,
      manifest: r8Manifest,
      manifestSha256,
      pairId: pairIds[0],
      pendingOwnership: pending,
      registeredRecords: overConcurrencyRecords,
    }),
    /concurrency cap/,
  );

  const r9ManifestSha256 = sha256File(r9ManifestPath);
  const r9PairId = r9Manifest.arms[0].pairs[0].id;
  const r9Pending = makePending(r9PairId, 7);
  r9Pending.run_id = `${r9Manifest.run_id}:${r9PairId}`;
  r9Pending.manifest_sha256 = r9ManifestSha256;
  const r9Registered = new Map([[r9Pending.record_id, { pairId: r9PairId }]]);
  assert.deepEqual(validateR8MutationLedgerBoundary({
    ledger: { revision: 23, records: [exactR8RecoveryRecord(), r9Pending] },
    manifest: r9Manifest,
    manifestSha256: r9ManifestSha256,
    pairId: r9PairId,
    pendingOwnership: structuredClone(r9Pending),
    registeredRecords: r9Registered,
  }), {
    revision: 23,
    pending_record_id: r9Pending.record_id,
    nonterminal_count: 1,
  });
  const wrongHistory = exactR8RecoveryRecord();
  wrongHistory.terminal_reason = "identity_refusal";
  assert.throws(
    () => validateR8MutationLedgerBoundary({
      ledger: { revision: 24, records: [wrongHistory, r9Pending] },
      manifest: r9Manifest,
      manifestSha256: r9ManifestSha256,
      pairId: r9PairId,
      pendingOwnership: r9Pending,
      registeredRecords: r9Registered,
    }),
    /only the exact blocked r8/,
  );
});

test("late hash runner or reaper drift causes zero provider create calls", async () => {
  for (const kind of ["hash", "runner", "reaper"]) {
    let createCalls = 0;
    const state = { hash: "exact", runner: "exact", reaper: "exact" };
    const initialPreflight = structuredClone(state);
    state[kind] = "drifted-after-initial-preflight";
    await assert.rejects(
      executeAfterExactR8MutationBoundary(
        async () => {
          if (
            state.hash !== initialPreflight.hash ||
            state.runner !== initialPreflight.runner ||
            state.reaper !== initialPreflight.reaper
          ) {
            throw new Error(`${kind} drift at immediate provider mutation boundary`);
          }
        },
        async () => {
          createCalls += 1;
          return { code: 0 };
        },
      ),
      new RegExp(`${kind} drift`),
    );
    assert.equal(createCalls, 0);
  }
});

test("four fanout workers serialize registration through binding and the queue survives rejection", async () => {
  const coordinator = createFanoutLedgerMutationCoordinator({
    expectedReaperPid: process.pid + 10_000,
    retryDelaysMs: [0],
  });
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const workers = Array.from({ length: 4 }, (_, index) => coordinator.runExclusive(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`prepare-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(`register-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(`post-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(`bind-${index}`);
    active -= 1;
    if (index === 1) throw new Error("injected post-bind failure");
    return index;
  }));
  const settled = await Promise.allSettled(workers);
  assert.equal(maximumActive, 1);
  assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 3);
  assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
  assert.deepEqual(order, Array.from({ length: 4 }, (_, index) => [
    `prepare-${index}`, `register-${index}`, `post-${index}`, `bind-${index}`,
  ]).flat());
});

test("r9 create failure latches stop before the queued worker can register or POST", async () => {
  const coordinator = createFanoutLedgerMutationCoordinator({
    expectedReaperPid: process.pid + 15_000,
    retryDelaysMs: [0],
  });
  const stopState = { requested: false, signal: null };
  let stopCalls = 0;
  let registrations = 0;
  let providerPosts = 0;
  const executor = { stop: () => { stopCalls += 1; } };
  const first = runR9SerializedCreateTransaction({
    ledgerMutationCoordinator: coordinator,
    stopState,
    executor,
    operation: async () => {
      registrations += 1;
      throw new Error("manual pending registration failure");
    },
  });
  const second = runR9SerializedCreateTransaction({
    ledgerMutationCoordinator: coordinator,
    stopState,
    executor,
    operation: async () => {
      if (stopState.requested) throw new Error("stopped before queued registration");
      registrations += 1;
      providerPosts += 1;
    },
  });
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.every(({ status }) => status === "rejected"), true);
  assert.equal(stopState.requested, true);
  assert.equal(registrations, 1);
  assert.equal(providerPosts, 0);
  assert.equal(stopCalls >= 1, true);
});

test("ledger lock retry accepts only the exact attested service PID and is bounded", async () => {
  const servicePid = process.pid + 20_000;
  const sleeps = [];
  const coordinator = createFanoutLedgerMutationCoordinator({
    expectedReaperPid: servicePid,
    retryDelaysMs: [0, 100, 250, 500],
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  let attempts = 0;
  assert.equal(await coordinator.retryExactServiceLock(async () => {
    attempts += 1;
    if (attempts < 4) throw new ReaperLedgerLockedError(servicePid);
    return "acquired";
  }), "acquired");
  assert.deepEqual(sleeps, [100, 250, 500]);

  await assert.rejects(
    coordinator.retryExactServiceLock(async () => { throw new ReaperLedgerLockedError(process.pid); }),
    (error) => error instanceof ReaperLedgerLockedError && error.ownerPid === process.pid,
  );
  await assert.rejects(
    coordinator.retryExactServiceLock(async () => { throw new Error("untyped collision"); }),
    /untyped collision/,
  );
  let exhausted = 0;
  await assert.rejects(
    coordinator.retryExactServiceLock(async () => {
      exhausted += 1;
      throw new ReaperLedgerLockedError(servicePid);
    }),
    (error) => error instanceof ReaperLedgerLockedError && error.ownerPid === servicePid,
  );
  assert.equal(exhausted, 4);
});

test("r7 activation receipt requires every one-create SSH volume and cleanup acceptance field", () => {
  assert.equal(acceptedCanaryFixture.fixture_label, "reconstructed_sanitized");
  const receipt = acceptedCanaryFixture.receipt;
  const accepted = validateTransportCanaryActivationReceipt(receipt, r8Manifest.activation);
  assert.equal(accepted.pod_id, "mickey-sanitized-pod-001");
  const cases = [
    [(value) => { value.create_attempts = 2; }, /one-create boundary/],
    [(value) => { value.game_processes_started = 1; }, /one-create boundary/],
    [(value) => { value.evidence_eligible = true; }, /one-create boundary/],
    [(value) => { value.requested_contract.requested_env = true; }, /exact bounded CPU shape/],
    [(value) => { value.create_request_attestation.requested_volume_gb = 1; }, /zero-volume/],
    [(value) => { value.network_volume_attestation.status = "explicit_none"; }, /omission/],
    [(value) => { value.ssh_transport_attempts.push(value.ssh_transport_attempts[0]); }, /exactly one attempt/],
    [(value) => { value.ssh_transport.negotiated_host_key_fingerprint = "SHA256:bad"; }, /ED25519/],
    [(value) => { value.deleted_exact_pod_ids = ["storm-existing-001"]; }, /sole observed new pod ID/],
    [(value) => { value.cleanup.reaper_state = "active"; }, /retire exact ownership/],
  ];
  for (const [mutate, message] of cases) {
    const adversarial = structuredClone(receipt);
    mutate(adversarial);
    assert.throws(
      () => validateTransportCanaryActivationReceipt(adversarial, r8Manifest.activation),
      message,
    );
  }
});

test("r7 activation known_hosts requires one endpoint-bound ED25519 key and matching fingerprint", () => {
  const receipt = structuredClone(acceptedCanaryFixture.receipt);
  const key = Buffer.from("sanitized fixture ED25519 public key blob with more than thirty-two bytes", "utf8");
  const encoded = key.toString("base64");
  receipt.ssh_transport.negotiated_host_key_fingerprint = `SHA256:${createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/=+$/, "")}`;
  const endpoint = "[192.0.2.10]:22022";
  assert.deepEqual(
    validateTransportCanaryKnownHosts(`${endpoint} ssh-ed25519 ${encoded}\n`, receipt),
    {
      algorithm: "ssh-ed25519",
      fingerprint: receipt.ssh_transport.negotiated_host_key_fingerprint,
      endpoint,
    },
  );
  assert.throws(
    () => validateTransportCanaryKnownHosts(`${endpoint} ssh-rsa ${encoded}\n`, receipt),
    /exactly one ED25519/,
  );
  assert.throws(
    () => validateTransportCanaryKnownHosts(`[192.0.2.11]:22022 ssh-ed25519 ${encoded}\n`, receipt),
    /endpoint differs/,
  );
  assert.throws(
    () => validateTransportCanaryKnownHosts(
      `${endpoint} ssh-ed25519 ${encoded}\n${endpoint} ssh-ed25519 ${encoded}\n`,
      receipt,
    ),
    /exactly one ED25519/,
  );
});

test("manifest permits only the legacy or exact run-bound durable service receipt", () => {
  const { directory, manifest } = fixture();
  try {
    manifest.cleanup_watchdog.service_receipt_path =
      `${durableReaperRoot}/service-receipt-${manifest.run_id}.json`;
    assert.equal(validateManifest(manifest).document, manifest);
    manifest.cleanup_watchdog.service_receipt_path =
      `${durableReaperRoot}/service-receipt-another-run.json`;
    assert.throws(
      () => validateManifest(manifest),
      /exact run-bound durable paths/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manifest rejects old qd1n-style control, pruned arms, outsider grow rosters, and manipulated order", () => {
  const cases = [
    (manifest) => { manifest.arms[0].m0.arm = "qd1n-v89"; },
    (manifest) => { manifest.arms[0].id = "grow-calm"; },
    (manifest) => { manifest.arms[0].pairs[0].roster[1].coalition = "outsider"; },
    (manifest) => { manifest.arms[0].pairs[0].order.reverse(); },
    (manifest) => { manifest.pod.network_volume_id = "vol-forbidden"; },
    (manifest) => { manifest.promotion_gates.upload_allowed = true; },
  ];
  for (const mutate of cases) {
    const { directory, manifest } = fixture();
    try {
      mutate(manifest);
      assert.throws(() => validateManifest(manifest));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("source-reach preflight rejects duplicate selected-action traces", async () => {
  const { directory, manifest, manifestPath, receiptPath } = fixture();
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.arms[2].selected_action_trace_sha256 = receipt.arms[1].selected_action_trace_sha256;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    manifest.source_reach_receipt.sha256 = sha256File(receiptPath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      preflightManifest(manifestPath, sha256File(manifestPath)),
      /duplicate selected-action traces/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pod registration rejects pre-existing IDs and enforces the exact CPU cost/disk/volume contract", () => {
  const base = {
    id: "newpod123",
    name: "proxywar-mickey-cpu-fanout-go-pair-abc",
    gpuCount: 0,
    costPerHr: 0.06,
    vcpuCount: 2,
    memoryInGb: 4,
    containerDiskInGb: 20,
    volumeInGb: 0,
  };
  assert.equal(
    validateCreatedPod(base, {
      expectedName: base.name,
      preexistingIds: new Set(),
    }),
    base.id,
  );
  assert.throws(
    () => registerCreatedPod(base, base.name, new Set([base.id]), new Set()),
    /pre-existing pod ID/,
  );
  assert.throws(
    () => validateCreatedPod({ ...base, gpuCount: 1 }, { expectedName: base.name, preexistingIds: new Set() }),
    /gpuCount/,
  );
  assert.throws(
    () => validateCreatedPod({ ...base, networkVolumeId: "volume" }, { expectedName: base.name, preexistingIds: new Set() }),
    /networkVolumeId/,
  );
  assert.throws(
    () => validateCreatedPod({ ...base, name: "storm-existing" }, { expectedName: "storm-existing", preexistingIds: new Set() }),
    /exact Mickey fanout name/,
  );
  assert.throws(
    () => validateCreatedPod(base, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    /explicit network-volume inspection/,
  );
  const inspected = {
    ...base,
    networkVolumeInspection: {
      includeNetworkVolumeRequested: true,
      networkVolumeId: { present: true, value: null },
      networkVolume: { present: false },
    },
  };
  assert.equal(
    validateCreatedPod(inspected, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    base.id,
  );
  assert.throws(
    () => validateCreatedPod({
      ...inspected,
      networkVolumeInspection: {
        ...inspected.networkVolumeInspection,
        networkVolumeId: { present: true, value: "nv-attached" },
      },
    }, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    /has a networkVolumeId/,
  );
  assert.throws(
    () => validateCreatedPod({
      ...inspected,
      networkVolumeInspection: {
        includeNetworkVolumeRequested: true,
        networkVolumeId: { present: false },
        networkVolume: { present: true, value: { id: "nv-attached" } },
      },
    }, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    /has an attached networkVolume/,
  );
  const zeroVolumeRequest = { volumeInGb: 0 };
  const requestInputSha256 = canonicalRequestInputSha256(zeroVolumeRequest);
  const zeroVolumeCreateProof = {
    request_input_sha256: requestInputSha256,
    request_input_hash_scope: "raw-request-before-redaction",
    request_input_redaction_schema: "env-map-v2",
    requested_volume_gb: 0,
    network_volume_id_supplied: false,
    network_volume_request: "none",
  };
  const omittedWhenNone = {
    ...inspected,
    requestInput: zeroVolumeRequest,
    requestInputSha256,
    networkVolumeInspection: {
      includeNetworkVolumeRequested: true,
      networkVolumeId: { present: false },
      networkVolume: { present: false },
    },
  };
  assert.throws(
    () => validateCreatedPod(omittedWhenNone, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    /without exact zero-volume create proof/,
  );
  const omittedAttestation = validateCreatedPod(omittedWhenNone, {
    expectedName: base.name,
    preexistingIds: new Set(),
    requireNetworkVolumeInspection: true,
    createRequestAttestation: zeroVolumeCreateProof,
    returnAttestation: true,
  });
  assert.equal(omittedAttestation.pod_id, base.id);
  assert.deepEqual(omittedAttestation.network_volume_attestation, {
    status: "omitted_when_none",
    include_network_volume_requested: true,
    network_volume_id_present: false,
    network_volume_present: false,
    network_volume_attached: false,
    request_input_sha256: requestInputSha256,
    requested_volume_gb: 0,
    network_volume_id_supplied: false,
  });
  assert.throws(
    () => validateCreatedPod(omittedWhenNone, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
      createRequestAttestation: { ...zeroVolumeCreateProof, requested_volume_gb: 1 },
      returnAttestation: true,
    }),
    /without exact zero-volume create proof/,
  );
  assert.throws(
    () => validateCreatedPod({
      ...omittedWhenNone,
      networkVolumeInspection: {
        includeNetworkVolumeRequested: true,
        networkVolumeId: { present: false, value: null },
        networkVolume: { present: false },
      },
    }, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
      createRequestAttestation: zeroVolumeCreateProof,
    }),
    /inspection is malformed/,
  );
});

test("manifest rejects a fanout whose aggregate two-hour ceiling exceeds USD 3.20", () => {
  const { directory, manifest } = fixture();
  try {
    const template = manifest.arms[0].pairs[0];
    manifest.arms[0].pairs = Array.from({ length: 17 }, (_, index) => {
      const id = `go-cap-pair-${String(index).padStart(2, "0")}`;
      const draw = derivePairOrder(manifest.randomization.nonce, manifest.arms[0].id, id);
      return { ...structuredClone(template), id, order: draw.order, order_draw_sha256: draw.digest };
    });
    manifest.arms[0].gates.outcome.minimum_pairs = 17;
    assert.throws(() => validateManifest(manifest), /worst-case pod cost 3\.40 exceeds total cap/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SSH first contact binds the negotiated ED25519 host key to the control-plane nonce", () => {
  const fingerprint = `SHA256:${"A".repeat(43)}`;
  const controlSecret = "b".repeat(64);
  assert.equal(
    parseSshKeygenFingerprint(`256 ${fingerprint} no comment (ED25519)\n`),
    fingerprint,
  );
  assert.throws(
    () => parseSshKeygenFingerprint(`256 ${fingerprint} first (ED25519)\n256 ${fingerprint} second (ED25519)\n`),
    /exactly one negotiated host key/,
  );
  const hmac = createHmac("sha256", Buffer.from(controlSecret, "hex"))
    .update(`mickey-ssh-host-key-v1\n${fingerprint}\n`, "utf8")
    .digest("hex");
  const challenge = { schema_version: 1, fingerprint, hmac_sha256: hmac };
  assert.equal(
    validateSshHostKeyAttestation(challenge, fingerprint, controlSecret).fingerprint,
    fingerprint,
  );
  assert.throws(
    () => validateSshHostKeyAttestation(challenge, `SHA256:${"B".repeat(43)}`, controlSecret),
    /not bound/,
  );
  assert.throws(
    () => validateSshHostKeyAttestation({ ...challenge, hmac_sha256: "0".repeat(64) }, fingerprint, controlSecret),
    /HMAC is invalid/,
  );
  const sshInfo = {
    id: "pod123",
    name: "proxywar-mickey-cpu-fanout-unit",
    ip: "192.0.2.10",
    port: 22022,
    ssh_key: {
      path: "/Users/olifreuler/.runpod/ssh/RunPod-Key-Go",
      exists: true,
      source: "runpodctl doctor",
      in_account: true,
      fingerprint,
    },
  };
  assert.equal(validateSshInfo(sshInfo, sshInfo.id, sshInfo.name), sshInfo);
  assert.throws(() => validateSshInfo({ ...sshInfo, id: "wrong" }, sshInfo.id, sshInfo.name), /unsafe or incomplete/);
});

test("SSH bootstrap pre-creates a private known_hosts file before accept-new", async () => {
  const directory = tempDirectory("mickey-known-hosts-test-");
  try {
    const knownHosts = path.join(directory, "known_hosts");
    await prepareKnownHostsFile(knownHosts);
    assert.equal(statSync(knownHosts).mode & 0o777, 0o600);
    assert.equal(readFileSync(knownHosts, "utf8"), "");
    await assert.rejects(prepareKnownHostsFile(knownHosts), /EEXIST/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("create request attestation binds the exact bounded REST CPU and SSH input without provider TTL", () => {
  const { directory, manifest } = fixture();
  try {
    const expectedName = "proxywar-mickey-cpu-fanout-unit";
    const controlSecret = "c".repeat(64);
    const requestInputRaw = {
      cloudType: "COMMUNITY",
      computeType: "CPU",
      containerDiskInGb: 20,
      cpuFlavorIds: ["cpu5c", "cpu3c"],
      cpuFlavorPriority: "custom",
      env: { MICKEY_CONTROL_PLANE_NONCE: controlSecret },
      imageName: manifest.pod.image,
      name: expectedName,
      ports: ["22/tcp"],
      supportPublicIp: true,
      vcpuCount: 2,
      volumeInGb: 0,
      volumeMountPath: "/workspace",
    };
    const requestInput = structuredClone(requestInputRaw);
    requestInput.env = { redacted: true, schema: "env-map-v2" };
    const record = {
      transport: "rest-v1",
      validationPassed: true,
      cleanupAttempted: false,
      cleanupSucceeded: false,
      clientMaxCostPerHour: 0.1,
      requestInput,
      requestInputSha256: canonicalRequestInputSha256(requestInputRaw),
      requestInputHashAlgorithm: "sorted-json-sha256-v1",
      requestInputHashScope: "raw-request-before-redaction",
      requestInputRedacted: true,
      requestInputRedactionSchema: "env-map-v2",
      responseEnvRedacted: false,
      responseEnvRedactionSchema: "env-map-v2",
      redactedEnvValueMarker: "[REDACTED]",
      responseControlSecretScrubbed: false,
      providerIdentityContaminated: false,
      reconciliationRequired: false,
    };
    assert.equal(
      validateCreateRequestAttestation(record, {
        manifest,
        expectedName,
        controlSecret,
      }).provider_ttl,
      null,
    );
    const responseEnvRedacted = structuredClone(record);
    responseEnvRedacted.env = { redacted: true, schema: "env-map-v2" };
    responseEnvRedacted.responseEnvRedacted = true;
    responseEnvRedacted.responseControlSecretScrubbed = true;
    assert.equal(
      validateCreateRequestAttestation(responseEnvRedacted, {
        manifest,
        expectedName,
        controlSecret,
      }).response_env_redacted,
      true,
    );
    const responseEnvLeaked = structuredClone(responseEnvRedacted);
    responseEnvLeaked.env.leaked = controlSecret;
    assert.throws(
      () => validateCreateRequestAttestation(responseEnvLeaked, {
        manifest,
        expectedName,
        controlSecret,
      }),
      /unexpected or unredacted env/,
    );
    const tampered = structuredClone(record);
    tampered.requestInput.vcpuCount = 8;
    assert.throws(
      () => validateCreateRequestAttestation(tampered, {
        manifest,
        expectedName,
        controlSecret,
      }),
      /redacted request echo differs/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure cleanup bypasses the stopped normal executor and deletes only the exact created ID", async () => {
  const directory = tempDirectory("mickey-cleanup-test-");
  try {
    const logRoot = path.join(directory, "logs");
    mkdirSync(logRoot);
    const calls = path.join(directory, "calls.log");
    const fake = path.join(directory, "runpodctl");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nprintf '{"id":"newpod123"}\\n'\n`);
    chmodSync(fake, 0o755);
    const executor = new CommandExecutor(logRoot);
    executor.stop();
    const result = await deleteExactPod(fake, "newpod123", executor, "signal-cleanup-newpod123");
    assert.equal(result.status, "deleted");
    assert.equal(readFileSync(calls, "utf8"), "pod delete newpod123 -o json\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("post-create attestation failure keeps the exact provisional ID cleanup-owned", async () => {
  const directory = tempDirectory("mickey-provisional-cleanup-test-");
  try {
    const logRoot = path.join(directory, "logs");
    mkdirSync(logRoot);
    const calls = path.join(directory, "calls.log");
    const fake = path.join(directory, "runpodctl");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nprintf '{"id":"newpod456"}\\n'\n`);
    chmodSync(fake, 0o755);
    const preexistingIds = new Set(["storm-production", "unrelated-existing"]);
    const createdIds = new Set();
    const malformedCreate = {
      id: "newpod456",
      name: "storm-production",
      gpuCount: 0,
      costPerHr: 0.75,
      vcpuCount: 2,
      memoryInGb: 4,
      containerDiskInGb: 20,
      volumeInGb: 0,
    };
    const id = registerCreatedPod(
      malformedCreate,
      "proxywar-mickey-cpu-fanout-expected",
      preexistingIds,
      createdIds,
    );
    assert.equal(id, "newpod456");
    assert.deepEqual([...createdIds], ["newpod456"]);
    assert.throws(
      () => validateCreatedPod(malformedCreate, {
        expectedName: "proxywar-mickey-cpu-fanout-expected",
        preexistingIds,
      }),
      /exact Mickey fanout name/,
    );
    const executor = new CommandExecutor(logRoot);
    executor.stop();
    for (const createdId of createdIds) {
      await deleteExactPod(fake, createdId, executor, `cleanup-${createdId}`);
    }
    assert.equal(readFileSync(calls, "utf8"), "pod delete newpod456 -o json\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("indeterminate create reconciliation claims only new pods with the exact preregistered name", async () => {
  const directory = tempDirectory("mickey-indeterminate-create-test-");
  try {
    const logRoot = path.join(directory, "logs");
    mkdirSync(logRoot);
    const calls = path.join(directory, "calls.log");
    const fake = path.join(directory, "runpodctl");
    const expectedName = "proxywar-mickey-cpu-fanout-exact-unit";
    writeFileSync(fake, `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
if [ "$1 $2" = "pod list" ]; then
  printf '%s\\n' '[{"id":"newpod789","name":"${expectedName}"},{"id":"oldpod123","name":"${expectedName}"},{"id":"stormpod999","name":"storm-production"}]'
  exit 0
fi
printf '%s\\n' '{"id":"newpod789"}'
`);
    chmodSync(fake, 0o755);
    const executor = new CommandExecutor(logRoot);
    const preexistingIds = new Set(["oldpod123", "stormpod999"]);
    const createdIds = new Set();
    const claimed = await discoverNewExactNamePods({
      runpodctl: fake,
      expectedName,
      preexistingIds,
      createdIds,
      executor,
      label: "unit-reconcile",
    });
    assert.deepEqual(claimed, ["newpod789"]);
    assert.deepEqual([...createdIds], ["newpod789"]);
    executor.stop();
    for (const id of createdIds) await deleteExactPod(fake, id, executor, `cleanup-${id}`);
    const commandLines = readFileSync(calls, "utf8").trim().split("\n");
    assert.deepEqual(commandLines, [
      `pod list --name ${expectedName} -a -o json`,
      "pod delete newpod789 -o json",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fetched evidence verification requires an exact, symlink-free file set and hashes", async () => {
  const directory = tempDirectory("mickey-fetch-test-");
  try {
    mkdirSync(path.join(directory, "runs"));
    mkdirSync(path.join(directory, "evidence"));
    writeFileSync(path.join(directory, "runs", "result.json"), "{}\n");
    writeFileSync(path.join(directory, "evidence", "receipt.json"), "{}\n");
    writeFileSync(
      path.join(directory, "artifacts.sha256"),
      [
        `${sha256File(path.join(directory, "evidence", "receipt.json"))}  evidence/receipt.json`,
        `${sha256File(path.join(directory, "runs", "result.json"))}  runs/result.json`,
        "",
      ].join("\n"),
    );
    assert.equal((await verifyFetchedArtifacts(directory)).file_count, 2);
    writeFileSync(path.join(directory, "runs", "result.json"), "tampered\n");
    await assert.rejects(verifyFetchedArtifacts(directory), /hash mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parallel workers serialize the shared event ledger without loss or rename races", async () => {
  const directory = tempDirectory("mickey-events-test-");
  try {
    mkdirSync(path.join(directory, "evidence"));
    await Promise.all(Array.from({ length: 40 }, (_, index) =>
      appendEvent(directory, "unit_event", { index })));
    const rows = readFileSync(path.join(directory, "evidence", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 40);
    assert.deepEqual(rows.map((row) => row.index).sort((left, right) => left - right),
      Array.from({ length: 40 }, (_, index) => index));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the runtime nonce travels only over stdin and never reaches argv, env, disk, or logs", async () => {
  const directory = tempDirectory("mickey-stdin-command-test-");
  try {
    const logs = path.join(directory, "logs");
    mkdirSync(logs);
    const fake = path.join(directory, "read-sensitive-stdin.mjs");
    writeFileSync(fake, `
import { createHash } from "node:crypto";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const body = Buffer.concat(chunks).toString("utf8");
const parsed = JSON.parse(body);
const value = parsed.MICKEY_CONTROL_PLANE_NONCE;
if (!/^[a-f0-9]{64}$/.test(value)) process.exit(91);
if (JSON.stringify(process.argv).toLowerCase().includes(value.toLowerCase())) process.exit(92);
if (JSON.stringify(process.env).toLowerCase().includes(value.toLowerCase())) process.exit(93);
process.stdout.write(createHash("sha256").update(body).digest("hex") + "\\n");
`);
    const nonce = "a".repeat(64);
    const stdin = Buffer.from(JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: nonce }), "utf8");
    const executor = new CommandExecutor(logs);
    const result = await executor.run(process.execPath, [fake, "--env-stdin"], {
      redactions: [nonce],
      outputLogMode: "metadata-only",
      stdinBytes: stdin,
      sensitiveOutputToken: nonce,
    });
    assert.equal(result.stdout.trim(), sha256(JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: nonce })));
    assert.equal(result.stderr, "");
    stdin.fill(0);
    const serializedLogs = readdirSync(logs)
      .map((name) => readFileSync(path.join(logs, name), "utf8"))
      .join("\n");
    assert.doesNotMatch(serializedLogs, new RegExp(nonce));
    assert.match(serializedLogs, /--env-stdin/);
    assert.doesNotMatch(serializedLogs, /"--env"/);
    assert.match(serializedLogs, /"stdin_provided": true/);
    const allDiskBodies = [
      readFileSync(fake, "utf8"),
      ...readdirSync(logs).map((name) => readFileSync(path.join(logs, name), "utf8")),
    ].join("\n");
    assert.doesNotMatch(allDiskBodies, new RegExp(nonce, "i"));

    const leakingLogs = path.join(directory, "leaking-logs");
    mkdirSync(leakingLogs);
    const leaker = path.join(directory, "leak-sensitive-stdin.mjs");
    writeFileSync(leaker, `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const value = JSON.parse(Buffer.concat(chunks).toString("utf8")).MICKEY_CONTROL_PLANE_NONCE;
process.stdout.write(value.toUpperCase());
`);
    const leakingStdin = Buffer.from(JSON.stringify({ MICKEY_CONTROL_PLANE_NONCE: nonce }), "utf8");
    const leakingExecutor = new CommandExecutor(leakingLogs);
    await assert.rejects(
      leakingExecutor.run(process.execPath, [leaker, "--env-stdin"], {
        redactions: [nonce],
        outputLogMode: "metadata-only",
        stdinBytes: leakingStdin,
        sensitiveOutputToken: nonce,
      }),
      (error) => error?.message === "sensitive child output rejected",
    );
    leakingStdin.fill(0);
    assert.deepEqual(readdirSync(leakingLogs), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("provider inventory evidence keeps only exact id and name while command logs omit raw env", async () => {
  const directory = tempDirectory("mickey-sanitized-provider-output-test-");
  try {
    const logs = path.join(directory, "logs");
    mkdirSync(logs);
    const fake = path.join(directory, "provider-output");
    const existingSecret = "existing-storm-provider-env-secret";
    writeFileSync(
      fake,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify([{
        id: "stormpod123",
        name: "storm-production",
        env: { API_TOKEN: existingSecret },
        costPerHr: 99,
      }])}'\nprintf '%s\\n' '${existingSecret}' >&2\n`,
    );
    chmodSync(fake, 0o755);
    const executor = new CommandExecutor(logs);
    const result = await executor.run(fake, [], { outputLogMode: "metadata-only" });
    const sanitized = sanitizePodInventory(JSON.parse(result.stdout));
    assert.deepEqual(sanitized, [{ id: "stormpod123", name: "storm-production" }]);
    assert.deepEqual(Object.keys(sanitized[0]).sort(), ["id", "name"]);
    const serializedLogs = readdirSync(logs)
      .map((name) => readFileSync(path.join(logs, name), "utf8"))
      .join("\n");
    assert.doesNotMatch(serializedLogs, new RegExp(existingSecret));
    assert.doesNotMatch(serializedLogs, /API_TOKEN/);
    assert.match(serializedLogs, /"content_omitted":true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dry-run performs zero network calls even when every external command is a tripwire", () => {
  const { directory, manifestPath, manifestSha256 } = fixture();
  try {
    const marker = path.join(directory, "external-command-called");
    const tripwire = path.join(directory, "tripwire");
    writeFileSync(tripwire, `#!/bin/sh\ntouch '${marker}'\nexit 99\n`);
    chmodSync(tripwire, 0o755);
    const result = spawnSync(
      process.execPath,
      [fanoutScript, "--manifest", manifestPath, "--manifest-sha256", manifestSha256, "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          RUNPODCTL_BIN: tripwire,
          SSH_BIN: tripwire,
          SCP_BIN: tripwire,
          LAUNCHCTL_BIN: tripwire,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.network_calls, 0);
    assert.deepEqual(plan.pairs[0].pod_create_argv.slice(0, 2), ["pod", "create"]);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--max-cost-per-hour"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("0.10"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--vcpu-count"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--terminateAfter"), false);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--env"), false);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--env-stdin"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--public-ip"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("22/tcp"), true);
    assert.equal(plan.pairs[0].pod_create_argv.includes("--network-volume-id"), false);
    assert.equal(plan.cleanup_watchdog.provider_ttl_available, false);
    assert.equal(plan.full_fanout_live_approved, false);
    assert.equal(plan.transport_canary_live_approved, true);
    assert.match(plan.full_fanout_blocking_reason, /not the exact.*r9 G000 activation/);
    assert.deepEqual(plan.pairs[0].order, manifestOrder(manifestPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("full fanout live mode fails closed before output or provider mutation", () => {
  const { directory, manifestPath, manifestSha256 } = fixture();
  try {
    const output = path.join(directory, "must-not-be-created");
    const result = spawnSync(
      process.execPath,
      [
        fanoutScript,
        "--manifest", manifestPath,
        "--manifest-sha256", manifestSha256,
        "--output", output,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /blocked before mutation.*not the exact.*r9 G000 activation/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function manifestOrder(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, "utf8")).arms[0].pairs[0].order;
}

test("launchd renderer is inert and preserves the transferred Mickey lease command", () => {
  const { directory, manifest, manifestPath, manifestSha256 } = fixture();
  const outputParent = realpathSync(mkdtempSync("/private/tmp/mickey-launchd-test-"));
  try {
    const fakeRunpodctl = manifest.runpodctl.path;
    const marker = path.join(directory, "called");
    const output = path.join(outputParent, "future-output");
    const result = spawnSync(
      process.execPath,
      [
        rendererScript,
        "--manifest", manifestPath,
        "--manifest-sha256", manifestSha256,
        "--output", output,
        "--runpodctl", fakeRunpodctl,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(output), false);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.rendered_only, true);
    assert.equal(plan.executed, false);
    assert.equal(plan.command, "/bin/launchctl");
    const joined = plan.argv.join(" ");
    assert.match(joined, /run mickey mickey-fanout-unit --output/);
    assert.match(joined, /run-mickey-cpu-fanout\.mjs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  }
});

test("dedicated reaper LaunchAgent renderer is inert and pins poll heartbeat without credentials", () => {
  const { directory, manifestPath, manifestSha256 } = fixture();
  try {
    const plist = path.join(directory, "reaper.plist");
    const planPath = path.join(directory, "reaper-plan.json");
    const result = spawnSync(process.execPath, [
      reaperRendererScript,
      "render",
      "--manifest", manifestPath,
      "--manifest-sha256", manifestSha256,
      "--plist", plist,
      "--plan", planPath,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    assert.equal(plan.installed, false);
    assert.equal(plan.invokes_runpod_api, false);
    const body = readFileSync(plist, "utf8");
    assert.match(body, /runpod-exact-id-reaper\.mjs/);
    assert.match(body, /provider-heartbeat\.json/);
    assert.match(body, /<string>poll<\/string>/);
    assert.match(body, /<key>HOME<\/key>\s*<string>\/Users\/olifreuler<\/string>/);
    assert.match(body, /<key>Umask<\/key>\s*<integer>63<\/integer>/);
    assert.doesNotMatch(body, /\/private\/tmp|\/tmp\//);
    assert.doesNotMatch(body, /api.?key|authorization|bearer/i);
    assert.equal(plan.exact_commands[0][2], "install");
    assert.equal(plan.exact_commands[1][1], "bootstrap");
    assert.equal(plan.plist_path, durablePlist);
    assert.equal(plan.durable_reaper_path.startsWith(`${durableBinRoot}/installations/`), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("r9 reaper plan adopts the exact running r8 service and forbids every service transition command", () => {
  const directory = realpathSync(mkdtempSync("/private/tmp/mickey-r9-adoption-plan-test-"));
  try {
    const plist = path.join(directory, "reaper.plist");
    const planPath = path.join(directory, "reaper-plan.json");
    const result = spawnSync(process.execPath, [
      reaperRendererScript,
      "render",
      "--manifest", r9ManifestPath,
      "--manifest-sha256", sha256File(r9ManifestPath),
      "--plist", plist,
      "--plan", planPath,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    assert.equal(plan.kind, "mickey_runpod_reaper_existing_service_attestation_plan");
    assert.equal(plan.provider_heartbeat_lists_may_continue_in_preexisting_service, true);
    assert.equal(plan.provider_create_or_delete_calls, 0);
    assert.equal(sha256File(plist), r9Manifest.activation.persistent_reaper.plist_sha256);
    assert.deepEqual(plan.exact_commands.map((command) => command[2]), ["attest", "wait-heartbeat"]);
    assert.deepEqual(
      plan.install_contract.forbidden_commands,
      ["install", "replace", "bootout", "bootstrap", "kickstart"],
    );
    const serializedCommands = JSON.stringify(plan.exact_commands);
    assert.doesNotMatch(serializedCommands, /\b(?:install|replace|bootout|bootstrap|kickstart)\b/);
    assert.deepEqual(
      plan.install_contract.persistent_reaper_compatibility,
      r9Manifest.activation.persistent_reaper.compatibility,
    );
    assert.equal(
      plan.install_contract.historical_service_receipt_pid,
      r9Manifest.activation.persistent_reaper.historical_receipt_pid,
    );
    assert.equal(
      plan.install_contract.current_pid_bound_at_attest,
      true,
    );
    const currentPid = 92990;
    const programArguments = [
      r9Manifest.cleanup_watchdog.node_runtime.path,
      r9Manifest.cleanup_watchdog.script.path,
      "poll",
      "--ledger",
      r9Manifest.cleanup_watchdog.ledger_path,
      "--runpodctl",
      r9Manifest.runpodctl.path,
      "--interval-seconds",
      String(r9Manifest.cleanup_watchdog.poll_interval_seconds),
      "--heartbeat",
      r9Manifest.cleanup_watchdog.heartbeat_path,
    ];
    const servicePrint = [
      `path = ${r9Manifest.cleanup_watchdog.plist_path}`,
      "state = running",
      `program = ${r9Manifest.cleanup_watchdog.node_runtime.path}`,
      "arguments = {",
      ...programArguments.map((argument) => `  ${argument}`),
      "}",
      `pid = ${currentPid}`,
      "",
    ].join("\n");
    assert.notEqual(currentPid, r9Manifest.activation.persistent_reaper.historical_receipt_pid);
    assert.equal(inspectRunningReaperService(r9Manifest, servicePrint), currentPid);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function stageManifestAtTemporaryDurableRoot(sourceManifest, stateRoot) {
  const manifest = structuredClone(sourceManifest);
  const binRoot = path.join(stateRoot, "bin");
  const installationsRoot = path.join(binRoot, "installations");
  const installationDirectory = path.join(
    installationsRoot,
    manifest.cleanup_watchdog.installation_id,
  );
  manifest.cleanup_watchdog.state_root = stateRoot;
  manifest.cleanup_watchdog.bin_root = binRoot;
  manifest.cleanup_watchdog.installations_root = installationsRoot;
  manifest.cleanup_watchdog.installation_directory = installationDirectory;
  manifest.cleanup_watchdog.script.path = path.join(
    installationDirectory,
    "runpod-exact-id-reaper.mjs",
  );
  manifest.runpodctl.path = path.join(installationDirectory, "runpodctl-darwin-arm64");
  manifest.cleanup_watchdog.plist_path = path.join(
    stateRoot,
    "LaunchAgents",
    "com.welttowelt.proxywar.mickey.runpod-reaper.plist",
  );
  manifest.cleanup_watchdog.ledger_path = path.join(stateRoot, "ledger.json");
  manifest.cleanup_watchdog.heartbeat_path = path.join(stateRoot, "provider-heartbeat.json");
  manifest.cleanup_watchdog.service_receipt_path = path.join(stateRoot, "service-receipt.json");
  return manifest;
}

function durableStageFixture(prefix) {
  const source = fixture();
  const stateRoot = realpathSync(mkdtempSync(`/private/tmp/${prefix}`));
  const manifest = stageManifestAtTemporaryDurableRoot(source.manifest, stateRoot);
  const plistSourcePath = path.join(stateRoot, "rendered-reaper.plist");
  writeFileSync(plistSourcePath, renderReaperPlistForTest(manifest), { mode: 0o600 });
  return { source, stateRoot, manifest, plistSourcePath };
}

function stageTemporaryDurableFixture(fixtureValue, testHooks = null) {
  return stageDurableReaperInstallation({
    manifest: fixtureValue.manifest,
    manifestSha256: "d".repeat(64),
    plistSourcePath: fixtureValue.plistSourcePath,
    allowTemporaryPathsForTest: true,
    testHooks,
  });
}

function cleanupDurableStageFixture(fixtureValue) {
  rmSync(fixtureValue.stateRoot, { recursive: true, force: true });
  rmSync(fixtureValue.source.directory, { recursive: true, force: true });
}

test("durable reaper installation is staged atomically with exact modes and refuses drift", async () => {
  const source = fixture();
  const stateRoot = realpathSync(mkdtempSync("/private/tmp/mickey-durable-install-test-"));
  try {
    const manifest = stageManifestAtTemporaryDurableRoot(source.manifest, stateRoot);
    const plistSourcePath = path.join(stateRoot, "rendered-reaper.plist");
    const plist = renderReaperPlistForTest(manifest);
    writeFileSync(plistSourcePath, plist, { mode: 0o600 });
    const manifestSha256 = "f".repeat(64);
    const receipt = await stageDurableReaperInstallation({
      manifest,
      manifestSha256,
      plistSourcePath,
      allowTemporaryPathsForTest: true,
    });
    assert.equal(receipt.provider_calls, 0);
    assert.equal(receipt.launchctl_calls, 0);
    assert.equal(receipt.installation_directory, manifest.cleanup_watchdog.installation_directory);
    for (const directory of [
      manifest.cleanup_watchdog.state_root,
      manifest.cleanup_watchdog.bin_root,
      manifest.cleanup_watchdog.installations_root,
      manifest.cleanup_watchdog.installation_directory,
    ]) {
      assert.equal(statSync(directory).mode & 0o777, 0o700, directory);
      assert.equal(realpathSync(directory), directory);
    }
    for (const filePath of [
      manifest.cleanup_watchdog.script.path,
      manifest.cleanup_watchdog.plist_path,
      manifest.cleanup_watchdog.ledger_path,
      path.join(stateRoot, "runpod-reaper.stdout.log"),
      path.join(stateRoot, "runpod-reaper.stderr.log"),
    ]) {
      assert.equal(statSync(filePath).mode & 0o777, 0o600, filePath);
      assert.equal(realpathSync(filePath), filePath);
    }
    assert.equal(statSync(manifest.runpodctl.path).mode & 0o777, 0o700);
    assert.equal(sha256File(manifest.cleanup_watchdog.script.path), manifest.cleanup_watchdog.script.sha256);
    assert.equal(sha256File(manifest.runpodctl.path), manifest.runpodctl.sha256);
    assert.equal(readFileSync(manifest.cleanup_watchdog.plist_path, "utf8"), plist);
    assert.doesNotMatch(plist, /MICKEY_CONTROL_PLANE_NONCE|--env(?:-stdin)?/i);

    const immutableBefore = Object.fromEntries([
      manifest.cleanup_watchdog.installation_directory,
      manifest.cleanup_watchdog.script.path,
      manifest.runpodctl.path,
    ].map((filePath) => {
      const info = statSync(filePath);
      return [filePath, { dev: info.dev, ino: info.ino, mode: info.mode, mtimeMs: info.mtimeMs }];
    }));
    const repeated = await stageDurableReaperInstallation({
      manifest,
      manifestSha256,
      plistSourcePath,
      allowTemporaryPathsForTest: true,
    });
    assert.equal(repeated.runpodctl_sha256, receipt.runpodctl_sha256);
    assert.deepEqual(readdirSync(manifest.cleanup_watchdog.installation_directory).sort(), [
      "runpod-exact-id-reaper.mjs",
      "runpodctl-darwin-arm64",
    ]);
    for (const [filePath, before] of Object.entries(immutableBefore)) {
      const info = statSync(filePath);
      assert.deepEqual(
        { dev: info.dev, ino: info.ino, mode: info.mode, mtimeMs: info.mtimeMs },
        before,
        `idempotent install wrote to ${filePath}`,
      );
    }

    const unexpected = path.join(manifest.cleanup_watchdog.installation_directory, "unexpected");
    writeFileSync(unexpected, "preserve me\n", { mode: 0o600 });
    await assert.rejects(
      stageDurableReaperInstallation({
        manifest,
        manifestSha256,
        plistSourcePath,
        allowTemporaryPathsForTest: true,
      }),
      /exactly two pinned payloads/,
    );
    assert.equal(readFileSync(unexpected, "utf8"), "preserve me\n");
    unlinkSync(unexpected);

    writeFileSync(manifest.cleanup_watchdog.script.path, "tampered\n", { mode: 0o600 });
    await assert.rejects(
      stageDurableReaperInstallation({
        manifest,
        manifestSha256,
        plistSourcePath,
        allowTemporaryPathsForTest: true,
      }),
      /durable file hash drift/,
    );
    assert.equal(readFileSync(manifest.cleanup_watchdog.script.path, "utf8"), "tampered\n");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(source.directory, { recursive: true, force: true });
  }
});

test("durable reaper installation rejects symlinked sources and never replaces an existing plist", async () => {
  const source = fixture();
  const stateRoot = realpathSync(mkdtempSync("/private/tmp/mickey-durable-refusal-test-"));
  try {
    const manifest = stageManifestAtTemporaryDurableRoot(source.manifest, stateRoot);
    const plistSourcePath = path.join(stateRoot, "rendered-reaper.plist");
    writeFileSync(plistSourcePath, renderReaperPlistForTest(manifest), { mode: 0o600 });
    const linkedRunpodctl = path.join(stateRoot, "runpodctl-source-link");
    symlinkSync(manifest.runpodctl.install_source_path, linkedRunpodctl);
    manifest.runpodctl.install_source_path = linkedRunpodctl;
    await assert.rejects(
      stageDurableReaperInstallation({
        manifest,
        manifestSha256: "e".repeat(64),
        plistSourcePath,
        allowTemporaryPathsForTest: true,
      }),
      /installation source is unsafe/,
    );

    manifest.runpodctl.install_source_path = source.manifest.runpodctl.install_source_path;
    mkdirSync(path.dirname(manifest.cleanup_watchdog.plist_path), { mode: 0o700 });
    writeFileSync(manifest.cleanup_watchdog.plist_path, "unrelated plist\n", { mode: 0o600 });
    await assert.rejects(
      stageDurableReaperInstallation({
        manifest,
        manifestSha256: "e".repeat(64),
        plistSourcePath,
        allowTemporaryPathsForTest: true,
      }),
      /durable file hash drift/,
    );
    assert.equal(readFileSync(manifest.cleanup_watchdog.plist_path, "utf8"), "unrelated plist\n");
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(source.directory, { recursive: true, force: true });
  }
});

test("durable promotion refuses a concurrently-created destination and cleans only its owned staging inode", async () => {
  const value = durableStageFixture("mickey-durable-destination-race-test-");
  try {
    if (process.platform === "darwin") {
      const legacyRoot = path.join(value.stateRoot, "legacy-bsd-mv-reproduction");
      const legacyStaging = path.join(legacyRoot, "legacy-staging");
      const legacyDestination = path.join(legacyRoot, "existing-destination");
      mkdirSync(legacyRoot, { mode: 0o700 });
      mkdirSync(legacyStaging, { mode: 0o700 });
      mkdirSync(legacyDestination, { mode: 0o700 });
      writeFileSync(path.join(legacyStaging, "payload"), "legacy payload\n", { mode: 0o600 });
      const legacyMove = spawnSync("/bin/mv", ["-n", legacyStaging, legacyDestination], {
        encoding: "utf8",
      });
      assert.equal(legacyMove.status, 0, legacyMove.stderr);
      assert.equal(existsSync(legacyStaging), false, "BSD mv consumed the staging source");
      assert.equal(
        readFileSync(path.join(legacyDestination, "legacy-staging", "payload"), "utf8"),
        "legacy payload\n",
        "BSD mv nested staging inside the existing destination",
      );
    }

    let stagingBasename;
    const sentinel = path.join(value.manifest.cleanup_watchdog.installation_directory, "foreign-sentinel");
    await assert.rejects(
      stageTemporaryDurableFixture(value, {
        beforePromotion: async ({ staging, destination }) => {
          stagingBasename = path.basename(staging);
          mkdirSync(destination, { mode: 0o700 });
          writeFileSync(sentinel, "foreign destination\n", { mode: 0o600 });
        },
      }),
      /destination appeared concurrently/,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "foreign destination\n");
    assert.deepEqual(
      readdirSync(value.manifest.cleanup_watchdog.installation_directory),
      ["foreign-sentinel"],
      "the concurrent destination must receive no staged child or payload",
    );
    assert.equal(
      existsSync(path.join(value.manifest.cleanup_watchdog.installation_directory, stagingBasename)),
      false,
    );
    assert.deepEqual(
      readdirSync(value.manifest.cleanup_watchdog.installations_root),
      [value.manifest.cleanup_watchdog.installation_id],
      "only the injected destination remains after exact-owned staging and lock cleanup",
    );
  } finally {
    cleanupDurableStageFixture(value);
  }
});

test("exclusive durable installer lock rejects simultaneous and stale or foreign lock holders", async () => {
  const simultaneous = durableStageFixture("mickey-durable-simultaneous-test-");
  let releaseFirst;
  const firstMayContinue = new Promise((resolve) => { releaseFirst = resolve; });
  let reportFirstLock;
  const firstHasLock = new Promise((resolve) => { reportFirstLock = resolve; });
  try {
    const first = stageTemporaryDurableFixture(simultaneous, {
      afterLockAcquired: async () => {
        reportFirstLock();
        await firstMayContinue;
      },
    });
    await firstHasLock;
    try {
      await assert.rejects(
        stageTemporaryDurableFixture(simultaneous),
        /exclusive installation lock already exists/,
      );
      assert.equal(existsSync(simultaneous.manifest.cleanup_watchdog.installation_directory), false);
    } finally {
      releaseFirst();
    }
    await first;
    assert.deepEqual(
      readdirSync(simultaneous.manifest.cleanup_watchdog.installation_directory).sort(),
      ["runpod-exact-id-reaper.mjs", "runpodctl-darwin-arm64"],
    );
    assert.equal(
      existsSync(path.join(simultaneous.manifest.cleanup_watchdog.installations_root, ".install.lock")),
      false,
    );
  } finally {
    releaseFirst?.();
    cleanupDurableStageFixture(simultaneous);
  }

  for (const kind of ["stale-directory", "foreign-symlink"]) {
    const value = durableStageFixture(`mickey-durable-${kind}-lock-test-`);
    const external = realpathSync(mkdtempSync(`/private/tmp/mickey-durable-${kind}-target-`));
    try {
      mkdirSync(value.manifest.cleanup_watchdog.bin_root, { mode: 0o700 });
      mkdirSync(value.manifest.cleanup_watchdog.installations_root, { mode: 0o700 });
      const lockPath = path.join(value.manifest.cleanup_watchdog.installations_root, ".install.lock");
      if (kind === "stale-directory") {
        mkdirSync(lockPath, { mode: 0o700 });
        writeFileSync(path.join(lockPath, "owner-unknown"), "preserve\n", { mode: 0o600 });
      } else {
        writeFileSync(path.join(external, "foreign"), "preserve\n", { mode: 0o600 });
        symlinkSync(external, lockPath, "dir");
      }
      await assert.rejects(
        stageTemporaryDurableFixture(value),
        /exclusive installation lock already exists/,
      );
      if (kind === "stale-directory") {
        assert.equal(readFileSync(path.join(lockPath, "owner-unknown"), "utf8"), "preserve\n");
      } else {
        assert.equal(lstatSync(lockPath).isSymbolicLink(), true);
        assert.equal(readFileSync(path.join(external, "foreign"), "utf8"), "preserve\n");
      }
      assert.equal(existsSync(value.manifest.cleanup_watchdog.installation_directory), false);
    } finally {
      cleanupDurableStageFixture(value);
      rmSync(external, { recursive: true, force: true });
    }
  }
});

test("durable installer refuses symlinks at destination, installed payload, staging, and staged payload boundaries", async () => {
  const destinationLink = durableStageFixture("mickey-durable-destination-link-test-");
  const destinationTarget = realpathSync(mkdtempSync("/private/tmp/mickey-durable-destination-target-"));
  try {
    mkdirSync(destinationLink.manifest.cleanup_watchdog.bin_root, { mode: 0o700 });
    mkdirSync(destinationLink.manifest.cleanup_watchdog.installations_root, { mode: 0o700 });
    writeFileSync(path.join(destinationTarget, "foreign"), "preserve\n", { mode: 0o600 });
    symlinkSync(
      destinationTarget,
      destinationLink.manifest.cleanup_watchdog.installation_directory,
      "dir",
    );
    await assert.rejects(
      stageTemporaryDurableFixture(destinationLink),
      /durable directory is unsafe/,
    );
    assert.equal(lstatSync(destinationLink.manifest.cleanup_watchdog.installation_directory).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(destinationTarget, "foreign"), "utf8"), "preserve\n");
  } finally {
    cleanupDurableStageFixture(destinationLink);
    rmSync(destinationTarget, { recursive: true, force: true });
  }

  const installedPayloadLink = durableStageFixture("mickey-durable-installed-payload-link-test-");
  try {
    mkdirSync(installedPayloadLink.manifest.cleanup_watchdog.bin_root, { mode: 0o700 });
    mkdirSync(installedPayloadLink.manifest.cleanup_watchdog.installations_root, { mode: 0o700 });
    mkdirSync(installedPayloadLink.manifest.cleanup_watchdog.installation_directory, { mode: 0o700 });
    symlinkSync(
      installedPayloadLink.manifest.cleanup_watchdog.script.install_source_path,
      installedPayloadLink.manifest.cleanup_watchdog.script.path,
    );
    writeFileSync(
      installedPayloadLink.manifest.runpodctl.path,
      readFileSync(installedPayloadLink.manifest.runpodctl.install_source_path),
      { mode: 0o700 },
    );
    await assert.rejects(
      stageTemporaryDurableFixture(installedPayloadLink),
      /durable file is unsafe/,
    );
    assert.equal(lstatSync(installedPayloadLink.manifest.cleanup_watchdog.script.path).isSymbolicLink(), true);
  } finally {
    cleanupDurableStageFixture(installedPayloadLink);
  }

  const stagingLink = durableStageFixture("mickey-durable-staging-link-test-");
  let stagingPath;
  let relocatedStaging;
  try {
    await assert.rejects(
      stageTemporaryDurableFixture(stagingLink, {
        beforePromotion: async ({ staging }) => {
          stagingPath = staging;
          relocatedStaging = `${staging}.foreign-relocation`;
          renameSync(staging, relocatedStaging);
          symlinkSync(relocatedStaging, staging, "dir");
        },
      }),
      /staging directory inode or security boundary changed.*preserved/,
    );
    assert.equal(lstatSync(stagingPath).isSymbolicLink(), true, "changed staging path was not unlinked");
    assert.equal(lstatSync(relocatedStaging).isDirectory(), true, "recorded staging inode was not recursively deleted");
    assert.equal(existsSync(stagingLink.manifest.cleanup_watchdog.installation_directory), false);
    assert.equal(existsSync(path.join(stagingLink.manifest.cleanup_watchdog.installations_root, ".install.lock")), false);
  } finally {
    cleanupDurableStageFixture(stagingLink);
  }

  const stagedPayloadLink = durableStageFixture("mickey-durable-staged-payload-link-test-");
  let stagedDirectory;
  let replacedPayload;
  const sourceBefore = readFileSync(stagedPayloadLink.manifest.cleanup_watchdog.script.install_source_path);
  try {
    await assert.rejects(
      stageTemporaryDurableFixture(stagedPayloadLink, {
        beforePromotion: async ({ staging, payloadPaths }) => {
          stagedDirectory = staging;
          replacedPayload = payloadPaths["runpod-exact-id-reaper.mjs"];
          unlinkSync(replacedPayload);
          symlinkSync(stagedPayloadLink.manifest.cleanup_watchdog.script.install_source_path, replacedPayload);
        },
      }),
      /durable file is unsafe.*preserved/,
    );
    assert.equal(lstatSync(replacedPayload).isSymbolicLink(), true, "changed payload was not unlinked");
    assert.equal(lstatSync(stagedDirectory).isDirectory(), true, "staging with a changed payload was preserved");
    assert.deepEqual(
      readFileSync(stagedPayloadLink.manifest.cleanup_watchdog.script.install_source_path),
      sourceBefore,
    );
    assert.equal(existsSync(stagedPayloadLink.manifest.cleanup_watchdog.installation_directory), false);
    assert.equal(existsSync(path.join(stagedPayloadLink.manifest.cleanup_watchdog.installations_root, ".install.lock")), false);
  } finally {
    cleanupDurableStageFixture(stagedPayloadLink);
  }
});

test("live reaper preflight requires a fresh service-context provider heartbeat from the launchd PID", async () => {
  const { directory, manifest, manifestSha256 } = fixture();
  try {
    let liveServicePid = 4321;
    const stateRoot = path.join(directory, "live-reaper-state");
    manifest.cleanup_watchdog.state_root = stateRoot;
    manifest.cleanup_watchdog.ledger_path = path.join(stateRoot, "ledger.json");
    manifest.cleanup_watchdog.heartbeat_path = path.join(stateRoot, "provider-heartbeat.json");
    manifest.cleanup_watchdog.service_receipt_path = path.join(stateRoot, "service-receipt.json");
    manifest.cleanup_watchdog.plist_path = path.join(directory, "active-reaper.plist");
    mkdirSync(stateRoot, { mode: 0o700 });
    const plist = manifest.cleanup_watchdog.plist_path;
    writeFileSync(plist, "plist\n", { mode: 0o600 });
    writeFileSync(manifest.cleanup_watchdog.ledger_path, `${JSON.stringify({ empty: true })}\n`, { mode: 0o600 });
    writeFileSync(manifest.cleanup_watchdog.heartbeat_path, `${JSON.stringify({
      schema_version: 1,
      kind: "mickey_runpod_exact_id_reaper_provider_heartbeat",
      status: "provider_list_succeeded",
      probed_at: new Date().toISOString(),
      pod_count: 20,
      ledger_path: manifest.cleanup_watchdog.ledger_path,
      runpodctl_path: manifest.runpodctl.path,
      pid: 4321,
      identifiers_recorded: false,
      credentials_recorded: false,
    }, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(manifest.cleanup_watchdog.service_receipt_path, `${JSON.stringify({
      schema_version: 1,
      kind: "mickey_runpod_exact_id_reaper_service",
      status: "active",
      manifest_sha256: manifestSha256,
      launchd_label: manifest.cleanup_watchdog.launchd_label,
      launchd_domain: `gui/${process.getuid()}`,
      plist_path: plist,
      plist_sha256: sha256File(plist),
      ledger_path: manifest.cleanup_watchdog.ledger_path,
      heartbeat_path: manifest.cleanup_watchdog.heartbeat_path,
      runpodctl_sha256: manifest.runpodctl.sha256,
      reaper_sha256: manifest.cleanup_watchdog.script.sha256,
      node_path: manifest.cleanup_watchdog.node_runtime.path,
      node_sha256: manifest.cleanup_watchdog.node_runtime.sha256,
      pid: 4321,
      attested_at: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    const executor = {
      async run(command, args) {
        assert.equal(command, "/bin/launchctl");
        assert.deepEqual(args, [
          "print",
          `gui/${process.getuid()}/${manifest.cleanup_watchdog.launchd_label}`,
        ]);
        const programArguments = [
          manifest.cleanup_watchdog.node_runtime.path,
          manifest.cleanup_watchdog.script.path,
          "poll",
          "--ledger",
          manifest.cleanup_watchdog.ledger_path,
          "--runpodctl",
          manifest.runpodctl.path,
          "--interval-seconds",
          String(manifest.cleanup_watchdog.poll_interval_seconds),
          "--heartbeat",
          manifest.cleanup_watchdog.heartbeat_path,
        ];
        return {
          code: 0,
          stdout: [
            `path = ${manifest.cleanup_watchdog.plist_path}`,
            "state = running",
            `program = ${manifest.cleanup_watchdog.node_runtime.path}`,
            "arguments = {",
            ...programArguments.map((argument) => `  ${argument}`),
            "}",
            `pid = ${liveServicePid}`,
            "",
          ].join("\n"),
          stderr: "",
        };
      },
    };
    const result = await verifyLiveReaperService({ manifest, manifestSha256, executor });
    assert.equal(result.provider_probe.pod_count, 20);

    manifest.schema_version = 5;
    manifest.activation = {
      persistent_reaper: {
        historical_receipt_pid: 9999,
        plist_sha256: sha256File(plist),
      },
    };
    const adopted = await verifyLiveReaperService({ manifest, manifestSha256, executor });
    assert.equal(adopted.pid, 4321);
    assert.notEqual(adopted.pid, manifest.activation.persistent_reaper.historical_receipt_pid);

    liveServicePid = 4322;
    await assert.rejects(
      verifyLiveReaperService({ manifest, manifestSha256, executor }),
      /service PID differs from the attested receipt/,
    );
    liveServicePid = 4321;
    manifest.schema_version = 3;
    delete manifest.activation;

    const heartbeat = JSON.parse(readFileSync(manifest.cleanup_watchdog.heartbeat_path, "utf8"));
    heartbeat.probed_at = new Date(Date.now() - 121_000).toISOString();
    writeFileSync(manifest.cleanup_watchdog.heartbeat_path, `${JSON.stringify(heartbeat)}\n`, { mode: 0o600 });
    await assert.rejects(
      verifyLiveReaperService({ manifest, manifestSha256, executor }),
      /heartbeat is stale/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeBundleFixture(directory, manifestFixture) {
  const bundleRoot = path.join(directory, "bundle");
  mkdirSync(bundleRoot);
  const arm = manifestFixture.arms[0];
  const pair = arm.pairs[0];
  const files = new Map();
  function add(relative, body) {
    const absolute = path.join(bundleRoot, ...relative.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
    files.set(relative, sha256File(absolute));
  }
  for (const identityValue of [arm.candidate, arm.m0]) {
    add(`${identityValue.bundle_root}/${identityValue.run[1]}`, `${identityValue.arm}\n`);
    identityValue.entrypoint_sha256 = files.get(`${identityValue.bundle_root}/${identityValue.run[1]}`);
    for (const shared of arm.shared_files) {
      add(`${identityValue.bundle_root}/${shared.path}`, `${shared.path}\n`);
      shared.sha256 = files.get(`${identityValue.bundle_root}/${shared.path}`);
    }
  }
  const gameConfig = {
    seed: pair.seed,
    map: pair.map,
    num_agents: pair.roster.length,
    max_decision_steps: pair.max_decision_steps,
  };
  const common = {
    name: pair.roster[1].name,
    policy: "opponent",
    cwd: "policies/opponent/app",
    run: ["node", "player.mjs"],
  };
  const testedPlayer = (identityValue) => ({
    name: pair.roster[0].name,
    policy: identityValue.policy_key,
    cwd: identityValue.bundle_root,
    run: identityValue.run,
    env: { POLICY_CODENAME: "mickey-eval" },
  });
  const candidateSpec = { schema_version: 1, game_config: gameConfig, players: [testedPlayer(arm.candidate), common] };
  const m0Spec = { schema_version: 1, game_config: gameConfig, players: [testedPlayer(arm.m0), common] };
  add(pair.candidate_spec.archive_path, `${JSON.stringify(candidateSpec, null, 2)}\n`);
  add(pair.m0_spec.archive_path, `${JSON.stringify(m0Spec, null, 2)}\n`);
  pair.candidate_spec.sha256 = files.get(pair.candidate_spec.archive_path);
  pair.m0_spec.sha256 = files.get(pair.m0_spec.archive_path);
  const filesBody = [...files]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relative, digest]) => `${digest}  ${relative}`)
    .join("\n") + "\n";
  writeFileSync(path.join(bundleRoot, "files.sha256"), filesBody);
  const policyRecord = (identityValue) => ({
    policy_id: identityValue.policy_id,
    key: identityValue.policy_key,
    arm: identityValue.arm,
    docker_target: identityValue.docker_target,
    surrogate_source: identityValue.surrogate_source,
    source_commit: identityValue.source_commit,
    image_id: identityValue.image_id,
    architecture: "amd64",
    bundle_root: identityValue.bundle_root,
    run: identityValue.run,
    entrypoint_sha256: identityValue.entrypoint_sha256,
    upload_eligible: false,
  });
  writeFileSync(path.join(bundleRoot, "manifest.json"), `${JSON.stringify({
    schema_version: 1,
    contains_credentials: false,
    invokes_runpod_api: false,
    runtime: { architecture: "amd64" },
    file_manifest: { sha256: sha256File(path.join(bundleRoot, "files.sha256")) },
    policies: [policyRecord(arm.candidate), policyRecord(arm.m0)],
    experiment_specs: [
      { path: pair.candidate_spec.archive_path, sha256: pair.candidate_spec.sha256, role: "candidate" },
      { path: pair.m0_spec.archive_path, sha256: pair.m0_spec.sha256, role: "exact-parent" },
    ],
  }, null, 2)}\n`);
  return bundleRoot;
}

test("remote bundle verifier binds exact images, baked entrypoints, shared selector hashes, and matched fixture", () => {
  const { directory, manifest } = fixture();
  try {
    const bundleRoot = writeBundleFixture(directory, manifest);
    const arm = manifest.arms[0];
    const pair = arm.pairs[0];
    const contract = {
      schema_version: 1,
      manifest_sha256: "f".repeat(64),
      run_id: manifest.run_id,
      arm_id: arm.id,
      mechanism_class: arm.mechanism_class,
      roster_class: arm.roster_class,
      shared_files: arm.shared_files,
      candidate: arm.candidate,
      m0: arm.m0,
      fixture: {
        pair_id: pair.id,
        map: pair.map,
        seed: pair.seed,
        seat: pair.seat,
        max_decision_steps: pair.max_decision_steps,
        roster: pair.roster,
        candidate_spec: pair.candidate_spec,
        m0_spec: pair.m0_spec,
        order: pair.order,
        order_draw_sha256: pair.order_draw_sha256,
      },
      gates: arm.gates,
      promotion_gates: manifest.promotion_gates,
    };
    const contractPath = path.join(directory, "contract.json");
    const outputPath = path.join(directory, "verified.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const result = spawnSync(process.execPath, [
      verifierScript,
      "--bundle-root", bundleRoot,
      "--contract", contractPath,
      "--output", outputPath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).status, "verified");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mirrored-seat gate groups reordered rosters by identity and coalition", () => {
  const arm = {
    gates: { outcome: { require_mirrored_seats: true } },
    pairs: [
      {
        map: "pangaea",
        seed: 41,
        seat: 0,
        roster: [
          { name: "Mickey", coalition: "K1Z" },
          { name: "Ally", coalition: "K1Z" },
          { name: "Outsider", coalition: "OUT" },
        ],
      },
      {
        map: "pangaea",
        seed: 41,
        seat: 2,
        roster: [
          { name: "Outsider", coalition: "OUT" },
          { name: "Ally", coalition: "K1Z" },
          { name: "Mickey", coalition: "K1Z" },
        ],
      },
    ],
  };

  assert.equal(mirroredSeatsPass(arm), true);

  arm.pairs[1].roster = [
    { name: "Outsider", coalition: "OUT" },
    { name: "Mickey", coalition: "K1Z" },
    { name: "Ally", coalition: "K1Z" },
  ];
  assert.equal(mirroredSeatsPass(arm), false);
  arm.pairs[1].roster = [
    { name: "Outsider", coalition: "OUT" },
    { name: "Ally", coalition: "K1Z" },
    { name: "Mickey", coalition: "K1Z" },
  ];

  arm.pairs[1].seed = 42;
  assert.equal(mirroredSeatsPass(arm), false);
  arm.pairs[1].seed = 41;
  arm.pairs[1].roster[0].coalition = "K1Z";
  assert.equal(mirroredSeatsPass(arm), false);
});

function writeAuditRole(output, manifest, role, { score, tiles, reached }) {
  const arm = manifest.arms[0];
  const pair = arm.pairs[0];
  const identityValue = role === "candidate" ? arm.candidate : arm.m0;
  const spec = role === "candidate" ? pair.candidate_spec : pair.m0_spec;
  const runRoot = path.join(output, "completed", pair.id, "fetched", "runs", role);
  const decisionsRoot = path.join(runRoot, "proxywar-runs", "unit-run");
  const logsRoot = path.join(runRoot, "logs");
  mkdirSync(decisionsRoot, { recursive: true });
  mkdirSync(logsRoot, { recursive: true });
  const results = {
    scores: [score, 1 - score],
    winner_slot: score > 0.5 ? 0 : 1,
    turn_count: 100,
    tick: 100,
    decision_count: 2,
    accepted_decision_count: 2,
    fallback_count: 2,
    degraded_count: 2,
    players: [
      { slot: 0, name: pair.roster[0].name, score, tiles_owned: tiles, is_alive: true },
      { slot: 1, name: pair.roster[1].name, score: 1 - score, tiles_owned: 100 - tiles, is_alive: true },
    ],
    seed: pair.seed,
    game_id: "UNITTEST",
  };
  writeFileSync(path.join(runRoot, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const firstAction = reached ? "expand:terra-nullius:25" : "expand:terra-nullius:10";
  const rows = [
    {
      username: pair.roster[0].name,
      selectedLegalActionId: firstAction,
      selectedActionKind: "attack",
      selectedActionMetadata: { targetID: null, expansion: true },
      result: { accepted: true, reason: "accepted" },
    },
    {
      username: pair.roster[0].name,
      selectedLegalActionId: "hold",
      selectedActionKind: "hold",
      selectedActionMetadata: {},
      legalActionIDs: ["hold"],
      result: { accepted: true, reason: "hold action selected; no game intent submitted" },
    },
  ];
  const decisionsBody = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const decisionsPath = path.join(decisionsRoot, "decisions.jsonl");
  writeFileSync(
    decisionsPath,
    decisionsBody,
  );
  const replayPath = path.join(runRoot, "replay");
  writeFileSync(replayPath, `${JSON.stringify({
    schemaVersion: 1,
    finalState: {
      players: pair.roster.map((entry, index) => ({
        username: entry.name,
        playerID: index === 1 ? "k1z-target" : `player-${index}`,
      })),
    },
    inlineRunArtifacts: { "decisions.jsonl": decisionsBody },
  })}\n`);
  const events = [
    {
      type: "evaluation_static_intent_start",
      source: "static-eval-v1",
      arm: identityValue.arm,
      uploadEligible: false,
    },
    {
      type: "evaluation_static_intent_decision",
      source: "static-eval-v1",
      arm: identityValue.arm,
      requestID: `${role}-request-1`,
      selectedActionID: firstAction,
      selectedActionKind: "attack",
      selectedTargetID: null,
      actionDelta: reached,
      reached,
      policyMarker: reached ? arm.gates.mechanism.marker : null,
    },
    {
      type: "evaluation_static_intent_decision",
      source: "static-eval-v1",
      arm: identityValue.arm,
      requestID: `${role}-request-2`,
      selectedActionID: "hold",
      selectedActionKind: "hold",
      selectedTargetID: null,
      actionDelta: false,
      reached: false,
      policyMarker: null,
    },
  ];
  const stdoutPath = path.join(
    logsRoot,
    `player-00-${identityValue.policy_key}.stdout.log`,
  );
  writeFileSync(stdoutPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const receipt = {
    schema_version: 1,
    status: "passed",
    receipt_scope: "transport_and_artifact_integrity_only",
    evaluation_verdict: "not_evaluated",
    execution_class: "formal_evaluation",
    post_run_attestation: { status: "stable" },
    run_spec: {
      location: "bundle",
      relative_path: spec.archive_path,
      sha256: spec.sha256,
      execution_class: "formal_evaluation",
    },
    plan: {
      game_config: {
        seed: pair.seed,
        map: pair.map,
        max_decision_steps: pair.max_decision_steps,
      },
      players: [
        {
          slot: 0,
          name: pair.roster[0].name,
          policy: identityValue.policy_key,
          cwd: identityValue.bundle_root,
          run: identityValue.run,
        },
        { slot: 1, name: pair.roster[1].name, policy: "opponent" },
      ],
    },
    results,
    primary_artifact_hashes: {
      "results.json": { sha256: sha256File(path.join(runRoot, "results.json")) },
      replay: { sha256: sha256File(path.join(runRoot, "replay")) },
    },
  };
  const receiptPath = path.join(runRoot, "receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { runRoot, rows, events, stdoutPath, decisionsPath, replayPath, receipt, receiptPath, pair };
}

function rewriteAuditRoleEvidence(artifacts) {
  const decisionsBody = `${artifacts.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  if (existsSync(artifacts.decisionsPath)) writeFileSync(artifacts.decisionsPath, decisionsBody);
  writeFileSync(artifacts.replayPath, `${JSON.stringify({
    schemaVersion: 1,
    finalState: {
      players: artifacts.pair.roster.map((entry, index) => ({
        username: entry.name,
        playerID: index === 1 ? "k1z-target" : `player-${index}`,
      })),
    },
    inlineRunArtifacts: { "decisions.jsonl": decisionsBody },
  })}\n`);
  writeFileSync(
    artifacts.stdoutPath,
    `${artifacts.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  artifacts.receipt.primary_artifact_hashes.replay.sha256 = sha256File(artifacts.replayPath);
  writeFileSync(artifacts.receiptPath, `${JSON.stringify(artifacts.receipt, null, 2)}\n`);
}

function refreshFetchedManifest(pairRoot) {
  const fetchedRoot = path.join(pairRoot, "fetched");
  const lines = [];
  function walk(directory, relativeRoot) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeRoot, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) lines.push(`${sha256File(absolute)}  ${relative}`);
      else throw new Error(`unsupported audit fixture entry ${relative}`);
    }
  }
  walk(path.join(fetchedRoot, "runs"), "runs");
  walk(path.join(fetchedRoot, "evidence"), "evidence");
  lines.sort();
  const manifestPath = path.join(fetchedRoot, "artifacts.sha256");
  writeFileSync(manifestPath, `${lines.join("\n")}\n`);
  return sha256File(manifestPath);
}

test("post-run audit ranks only a screen leader and rejects replay-visible K1Z harm", async () => {
  const { directory, manifest, manifestSha256 } = fixture();
  const output = path.join(directory, "audit-output");
  try {
    const pair = manifest.arms[0].pairs[0];
    const pairRoot = path.join(output, "completed", pair.id);
    mkdirSync(path.join(pairRoot, "fetched", "evidence"), { recursive: true });
    const candidateArtifacts = writeAuditRole(output, manifest, "candidate", {
      score: 0.75,
      tiles: 80,
      reached: true,
    });
    writeAuditRole(output, manifest, "m0", { score: 0.25, tiles: 20, reached: false });
    rmSync(candidateArtifacts.decisionsPath);
    const completionPath = path.join(pairRoot, "pair-complete.json");
    const completion = {
      schema_version: 1,
      pair_id: pair.id,
      arm_id: manifest.arms[0].id,
      manifest_sha256: manifestSha256,
      execution_order: pair.order,
      order_draw_sha256: pair.order_draw_sha256,
      evidence_eligible: true,
      fetched_manifest_sha256: refreshFetchedManifest(pairRoot),
    };
    writeFileSync(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
    const leaderboard = await auditMickeyCpuFanout({ output, manifest, manifestSha256 });
    assert.equal(leaderboard.screen_leader, "grow-opening");
    assert.equal(leaderboard.arms[0].label, "screen_leader");
    assert.equal(leaderboard.arms[0].confirmed, false);
    assert.equal(leaderboard.confirmation.promotion_allowed, false);
    assert.equal(leaderboard.arms[0].outcome.mean_candidate_minus_m0_score, 0.5);
    assert.equal(leaderboard.arms[0].outcome.mean_candidate_minus_m0_final_tiles, 60);
    assert.equal(leaderboard.arms[0].pairs[0].candidate.decision_evidence_source, "replay_inline");
    assert.equal(leaderboard.arms[0].pairs[0].candidate.holds, 1);
    assert.equal(leaderboard.arms[0].pairs[0].candidate.unexplained_holds, 0);

    candidateArtifacts.rows[1] = {
      username: pair.roster[0].name,
      selectedLegalActionId: "attack:k1z-target:25",
      selectedActionKind: "attack",
      selectedActionMetadata: {
      targetID: "k1z-target",
      targetName: pair.roster[1].name,
      },
      legalActionIDs: ["attack:k1z-target:25", "hold"],
      result: { accepted: true, reason: "accepted" },
    };
    candidateArtifacts.events[2].selectedActionID = "attack:k1z-target:25";
    candidateArtifacts.events[2].selectedActionKind = "attack";
    candidateArtifacts.events[2].selectedTargetID = "k1z-target";
    rewriteAuditRoleEvidence(candidateArtifacts);
    completion.fetched_manifest_sha256 = refreshFetchedManifest(pairRoot);
    writeFileSync(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
    const harmed = await auditMickeyCpuFanout({ output, manifest, manifestSha256 });
    assert.equal(harmed.screen_leader, null);
    assert.equal(harmed.arms[0].label, "screen_rejected");
    assert.equal(harmed.arms[0].mechanism.k1z_harm_count, 1);
    assert.equal(harmed.arms[0].mechanism.mechanism_reached_k1z_harm_count, 0);
    assert.equal(harmed.arms[0].gates.maximum_k1z_harm, false);

    candidateArtifacts.rows[1] = {
      username: pair.roster[0].name,
      selectedLegalActionId: "move_warship:unit-7:tile-42",
      selectedActionKind: "move_warship",
      selectedActionMetadata: {
        unitCount: 1,
        targetTile: 42,
        legalReason: "enemy Trade Ship is present but owner is absent",
      },
      legalActionIDs: ["move_warship:unit-7:tile-42", "hold"],
      result: { accepted: true, reason: "accepted" },
    };
    candidateArtifacts.events[2].selectedActionID = "move_warship:unit-7:tile-42";
    candidateArtifacts.events[2].selectedActionKind = "move_warship";
    candidateArtifacts.events[2].selectedTargetID = null;
    rewriteAuditRoleEvidence(candidateArtifacts);
    completion.fetched_manifest_sha256 = refreshFetchedManifest(pairRoot);
    writeFileSync(completionPath, `${JSON.stringify(completion, null, 2)}\n`);
    await assert.rejects(
      auditMickeyCpuFanout({ output, manifest, manifestSha256 }),
      /accepted harmful action has no replay-verifiable target/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
