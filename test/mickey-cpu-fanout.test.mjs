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
  appendEvent,
  CommandExecutor,
  canonicalRequestInputSha256,
  deleteExactPod,
  derivePairOrder,
  discoverNewExactNamePods,
  parseSshKeygenFingerprint,
  prepareKnownHostsFile,
  preflightManifest,
  registerCreatedPod,
  sanitizePodInventory,
  validateCreateRequestAttestation,
  validateCreatedPod,
  validateSshHostKeyAttestation,
  validateSshInfo,
  validateManifest,
  verifyLiveReaperService,
  verifyFetchedArtifacts,
} from "../scripts/run-mickey-cpu-fanout.mjs";
import {
  auditMickeyCpuFanout,
  mirroredSeatsPass,
} from "../scripts/audit-mickey-cpu-fanout.mjs";
import { parseFileManifest } from "../scripts/verify-mickey-cpu-fanout-bundle.mjs";
import {
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
        networkVolume: { present: false },
      },
    }, {
      expectedName: base.name,
      preexistingIds: new Set(),
      requireNetworkVolumeInspection: true,
    }),
    /omitted both network-volume fields/,
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
    assert.match(plan.full_fanout_blocking_reason, /end-to-end execution.*separate RCI/);
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
    assert.match(result.stderr, /blocked before mutation.*end-to-end execution.*separate RCI/);
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
        return { code: 0, stdout: "state = running\npid = 4321\n", stderr: "" };
      },
    };
    const result = await verifyLiveReaperService({ manifest, manifestSha256, executor });
    assert.equal(result.provider_probe.pod_count, 20);

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
