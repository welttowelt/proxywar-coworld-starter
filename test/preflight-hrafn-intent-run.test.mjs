import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildHrafnIntentJob,
  HRAFN_INTENT_CELLS,
  HRAFN_INTENT_MANIFEST_SHA256,
} from "../scripts/build-hrafn-intent-job.mjs";
import {
  HRAFN_INTENT_CONTAINER_FILES,
  HRAFN_INTENT_IMAGE_FILES,
  HRAFN_INTENT_RUNTIME_IMPORTS,
  HRAFN_INTENT_RUNTIME_SYNTAX_FILES,
  HRAFN_NEUTRAL_OPPONENT_IMAGE_ID,
  hrafnIntentReceiptContentSHA256,
  serializeHrafnIntentImageReceipt,
} from "../scripts/create-hrafn-intent-image-receipt.mjs";
import {
  expectedHrafnIntentCoworldArgv,
  probeHrafnIntentOllama,
  probeHrafnIntentOllamaFromContainer,
  verifyMailboxArtifactHistory,
  verifyHrafnIntentRunPreflight,
} from "../scripts/preflight-hrafn-intent-run.mjs";
import {
  sealK1ZPacket,
  serializeK1ZPacket,
} from "../k1z-direct-line.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";
import {
  coworldGameReceiptFixture,
  neutralOpponentReceiptFixture,
} from "./helpers/hrafn-intent-receipt-fixture.mjs";
import {
  HRAFN_COWORLD_GAME_IMAGE_ID,
  HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
} from "../scripts/materialize-hrafn-coworld-manifest.mjs";

const SUBJECT_IMAGE = `sha256:${"a".repeat(64)}`;
const OPPONENT_IMAGE = HRAFN_NEUTRAL_OPPONENT_IMAGE_ID;
const SOURCE_COMMIT = "1".repeat(40);
const MODEL_DIGEST =
  "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJSON(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixtureReceipt(preregistrationSHA256) {
  const receipt = {
    schema_version: 2,
    record_type: "hrafn_intent_i1_image_receipt",
    campaign_id: "hrafn-intent-i1",
    created_at: "2026-07-20T20:30:00.000Z",
    source: {
      commit: SOURCE_COMMIT,
      branch: "feature/k1z-hrafn-fylking",
      upstream_ref: "origin/feature/k1z-hrafn-fylking",
      remote_name: "origin",
      remote_ref: "refs/heads/feature/k1z-hrafn-fylking",
      upstream_commit: SOURCE_COMMIT,
      remote_commit: SOURCE_COMMIT,
      clean: true,
      pushed: true,
    },
    image: {
      requested_reference: SUBJECT_IMAGE,
      id: SUBJECT_IMAGE,
      os: "linux",
      architecture: "amd64",
      working_dir: "/app",
      entrypoint: ["docker-entrypoint.sh"],
      cmd: ["node", "/app/hrafn-intent-player.mjs"],
      container_files: [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) => ({
        path: `/app/${file}`,
        sha256: String(
          [...HRAFN_INTENT_IMAGE_FILES].sort().indexOf(file) + 1,
        ).padStart(64, "0"),
      })),
      runtime_smoke: {
        node_version: "v24.4.1",
        syntax_files: [...HRAFN_INTENT_RUNTIME_SYNTAX_FILES],
        module_imports: [...HRAFN_INTENT_RUNTIME_IMPORTS],
      },
    },
    coworld_player_run: ["node", "/app/hrafn-intent-player.mjs"],
    files: [...HRAFN_INTENT_IMAGE_FILES].sort().map((file, index) => ({
      path: file,
      sha256: file ===
          "experiments/hrafn-intent-i1-preregistration-20260720.json"
        ? preregistrationSHA256
        : String(index + 1).padStart(64, "0"),
    })),
    tests: {
      argv: ["npm", "test"],
      exit_code: 0,
      stdout_sha256: "b".repeat(64),
      stderr_sha256: "c".repeat(64),
    },
    planner: {
      model: "llama3:latest",
      model_digest: MODEL_DIGEST,
      ollama_version: "0.32.1",
    },
    game: coworldGameReceiptFixture(),
    opponent: null,
  };
  receipt.opponent = neutralOpponentReceiptFixture(receipt.files);
  receipt.integrity = {
    algorithm: "sha256",
    canonicalization: "sorted-json-v1-excluding-integrity",
    content_sha256: hrafnIntentReceiptContentSHA256(receipt),
  };
  return receipt;
}

function packetBase(overrides = {}) {
  return {
    schema_version: 1,
    protocol: "k1z-direct-line",
    campaign_id: "hrafn-intent-i1",
    message_id: "odin-hi1-identity-window",
    sequence: 100,
    created_at: "2026-07-20T20:40:00.000Z",
    from: "odin",
    to: "hrafn",
    kind: "coordination",
    in_reply_to: "hrafn-hi1-request",
    authority: {
      advisory: true,
      formal_approval: false,
      mutation_scope: "none",
    },
    payload: {},
    evidence: {
      source_commit: SOURCE_COMMIT,
      image_digest: SUBJECT_IMAGE,
      replay_sha256: [],
    },
    ...overrides,
  };
}

function manifestFixture() {
  return {
    id: "cow-test",
    game: {
      runnable: { image: HRAFN_COWORLD_GAME_IMAGE_REFERENCE },
    },
    variants: [
      {
        id: "tournament-4p-pangaea",
        game_config: {
          map: "Pangaea",
          map_size: "Compact",
          difficulty: "Easy",
          num_agents: 4,
          max_decision_ms: 15000,
          max_decision_steps: 300,
          turns_per_decision_step: 100,
        },
      },
      {
        id: "tournament-4p-asia",
        game_config: {
          map: "Asia",
          map_size: "Compact",
          difficulty: "Easy",
          num_agents: 4,
          max_decision_ms: 15000,
          max_decision_steps: 300,
          turns_per_decision_step: 100,
        },
      },
    ],
  };
}

function setupFixture() {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "hrafn-hi1-preflight-")),
  );
  const mailbox = path.join(directory, "mailbox");
  const output = path.join(directory, "output");
  mkdirSync(mailbox);
  mkdirSync(output);
  writeFileSync(path.join(output, ".proxywar-runner-claim"), "claim\n");
  const manifest = manifestFixture();
  const manifestPath = path.join(directory, "manifest.json");
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(manifestPath, manifestBytes);
  const manifestSHA = sha256(manifestBytes);
  const preregistration = {
    schema_version: 2,
    record_type: "hrafn_intent_i1_preregistration",
    campaign_id: "hrafn-intent-i1",
    campaign_revision_id: "hrafn-intent-i1-r2",
    post_result_revision_id: "hrafn-intent-i1-r2",
    post_result_revision_from:
      "98288c8b9211513cfb71ceb88707de1721f351e3",
    status: "PREREGISTERED_AMENDED_NO_RUNTIME_AUTHORITY",
    revision_status: "POST_RESULT_REVISION_PREREGISTERED_NO_RUNTIME_AUTHORITY",
    post_result_evidence: {
      tested_source_commit: "98288c8b9211513cfb71ceb88707de1721f351e3",
      prior_attempt_rejected: true,
      verdict: "REJECT_SAFETY_OR_RELIABILITY",
    },
    intent_contract: {
      planner: {
        model: "llama3:latest",
        model_digest:
          "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1",
        seed: 240723,
      },
    },
    pilot: {
      coworld_client: "0.1.28",
      manifest_sha256: HRAFN_INTENT_MANIFEST_SHA256,
      cells: [
        {
          map: "Compact Pangaea",
          seed: 240723,
          subject_slot_zero_based: 1,
          order: ["control", "candidate"],
        },
        {
          map: "Compact Asia",
          seed: 240724,
          subject_slot_zero_based: 2,
          order: ["candidate", "control"],
        },
      ],
    },
    promotion_state: {
      DIAGNOSTIC_RUN: true,
      CURRENT_REVISION_DIAGNOSTIC_RUN: false,
      PRIOR_REVISION_REJECTED: true,
      UPLOADED: false,
      SUBMITTED: false,
      CHAMPION_CHANGED: false,
    },
  };
  const preregistrationPath = path.join(directory, "prereg.json");
  const preregistrationBytes = Buffer.from(`${JSON.stringify(preregistration, null, 2)}\n`);
  writeFileSync(preregistrationPath, preregistrationBytes);
  const receipt = fixtureReceipt(sha256(preregistrationBytes));
  const receiptPath = path.join(directory, "image-receipt.json");
  const receiptBytes = Buffer.from(serializeHrafnIntentImageReceipt(receipt));
  writeFileSync(receiptPath, receiptBytes);

  const jobs = HRAFN_INTENT_CELLS.map((cell) => {
    const job = buildHrafnIntentJob(manifest, {
      manifestSHA256: HRAFN_INTENT_MANIFEST_SHA256,
      variantID: cell.variant_id,
      subjectImage: SUBJECT_IMAGE,
      opponentImage: OPPONENT_IMAGE,
      subjectReceipt: receipt,
      subjectSlot: cell.subject_slot,
      seed: cell.seed,
      intentEnabled: cell.role === "candidate",
    });
    const jobPath = path.join(directory, `${cell.id}.json`);
    const bytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`);
    writeFileSync(jobPath, bytes);
    return {
      id: cell.id,
      order: cell.order,
      role: cell.role,
      map: cell.map,
      seed: cell.seed,
      subject_slot: cell.subject_slot,
      path: jobPath,
      sha256: sha256(bytes),
    };
  });

  const bindings = {
    scope: "hrafn-only",
    source_commit: SOURCE_COMMIT,
    subject_image_id: SUBJECT_IMAGE,
    game_image_id: HRAFN_COWORLD_GAME_IMAGE_ID,
    image_receipt: {
      file_sha256: sha256(receiptBytes),
      content_sha256: receipt.integrity.content_sha256,
    },
    preregistration: {
      file_sha256: sha256(preregistrationBytes),
      content_sha256: sha256(canonicalJSON(preregistration)),
    },
    manifest_sha256: manifestSHA,
    planner: {
      model: "llama3:latest",
      model_digest: MODEL_DIGEST,
      ollama_version: "0.32.1",
    },
    jobs: jobs.map(({ path: _path, ...job }) => job),
  };
  const identityWindow = sealK1ZPacket(packetBase({
    payload: {
      state: "HI1_IDENTITY_WINDOW_READY",
      active_identity: {
        player_id: HRAFN_PLAYER_ID,
        player_name: "K1Z Hrafn",
      },
      formal_approvals_consumed: 0,
      ordered_diagnostic_scope: HRAFN_INTENT_CELLS.map((cell) => cell.id),
      bindings,
    },
  }));
  const identityWindowPath = path.join(mailbox, "identity-window.json");
  writeFileSync(identityWindowPath, serializeK1ZPacket(identityWindow));

  const active = jobs[0];
  const argv = expectedHrafnIntentCoworldArgv({
    manifestPath,
    jobPath: active.path,
    outputDirectory: output,
  });
  const spec = {
    schema_version: 1,
    record_type: "hrafn_intent_i1_preflight_spec",
    campaign_id: "hrafn-intent-i1",
    run_id: "hi1-pangaea-control",
    job_id: active.id,
    role: active.role,
    repo_path: "/repo",
    output_directory: output,
    lease_directory: "/lease",
    manifest_path: manifestPath,
    job_path: active.path,
    image_receipt_path: receiptPath,
    preregistration_path: preregistrationPath,
    identity_window_path: identityWindowPath,
    predecessor_operational_receipts: [],
    pangaea_continuation_pair_report: null,
    campaign_jobs: jobs,
    expected_argv: argv,
  };
  const runtime = {
    now: () => new Date("2026-07-20T20:45:00.000Z"),
    async verifyImageEnvironment() {
      return {
        valid: true,
        source_commit: SOURCE_COMMIT,
        subject_image: SUBJECT_IMAGE,
        game_image: HRAFN_COWORLD_GAME_IMAGE_ID,
      };
    },
    async inspectImage(imageReference, expectedID = imageReference) {
      return { id: expectedID, os: "linux", architecture: "amd64" };
    },
    async probeOllama() {
      return {
        version: "0.32.1",
        model: "llama3:latest",
        model_digest: MODEL_DIGEST,
        tags_response_sha256: "d".repeat(64),
        show_response_sha256: "e".repeat(64),
        schema_sha256: "f".repeat(64),
        probe_response_sha256: "9".repeat(64),
        probe_intent: { objective: "grow", targetID: null, horizon: 8 },
      };
    },
    async probeContainerOllama(imageID) {
      return {
        endpoint: "http://host.docker.internal:11434/api/generate",
        image_id: imageID,
        model: "llama3:latest",
        schema_sha256: "f".repeat(64),
        response_sha256: "7".repeat(64),
        probe_intent: { objective: "grow", targetID: null, horizon: 8 },
      };
    },
    async verifyMailboxEnvironment() {
      return {
        head_commit: "8".repeat(40),
        remote_commit: "8".repeat(40),
      };
    },
    async verifyMailboxArtifactHistory() {
      return true;
    },
    readIdentity() {
      return { playerID: HRAFN_PLAYER_ID, playerName: "K1Z Hrafn" };
    },
    validateLease() {
      return {
        childPID: 123,
        supervisorPID: 100,
        runID: spec.run_id,
        outputDirectory: output,
        acquiredAt: "2026-07-20T20:44:00Z",
      };
    },
  };
  return {
    directory,
    mailbox,
    output,
    manifestSHA,
    spec,
    runtime,
    identityWindow,
    identityWindowPath,
  };
}

function verificationOptions(fixture) {
  return {
    command: fixture.spec.expected_argv,
    processPID: 123,
    expectedRepoPath: "/repo",
    expectedMailboxDirectory: fixture.mailbox,
    expectedOutputRoot: fixture.directory,
    expectedManifestSHA256: fixture.manifestSHA,
  };
}

function setActiveCell(fixture, order, predecessors, continuation) {
  const active = fixture.spec.campaign_jobs[order];
  const output = order === 0
    ? fixture.output
    : path.join(fixture.directory, `output-${order}`);
  if (order > 0) {
    mkdirSync(output);
    writeFileSync(path.join(output, ".proxywar-runner-claim"), "claim\n");
  }
  fixture.spec.run_id = `hi1-${active.id}`;
  fixture.spec.job_id = active.id;
  fixture.spec.role = active.role;
  fixture.spec.output_directory = output;
  fixture.spec.job_path = active.path;
  fixture.spec.predecessor_operational_receipts = structuredClone(predecessors);
  fixture.spec.pangaea_continuation_pair_report = continuation
    ? structuredClone(continuation)
    : null;
  fixture.spec.expected_argv = expectedHrafnIntentCoworldArgv({
    manifestPath: fixture.spec.manifest_path,
    jobPath: active.path,
    outputDirectory: output,
  });
  fixture.runtime.now = () =>
    new Date(`2026-07-20T21:0${order}:00.000Z`);
  fixture.runtime.validateLease = () => ({
    childPID: 123,
    supervisorPID: 100,
    runID: fixture.spec.run_id,
    outputDirectory: output,
    acquiredAt: `2026-07-20T21:0${order}:00.000Z`,
  });
}

async function prepareActiveOrder(fixture, targetOrder, pairVerdict = "PAIR_PASS") {
  const predecessors = [];
  let continuation = null;
  for (let order = 0; order < targetOrder; order += 1) {
    setActiveCell(fixture, order, predecessors, order >= 2 ? continuation : null);
    const preflight = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    const operational = {
      schema_version: 2,
      record_type: "hrafn_intent_i1_operational_receipt",
      campaign_id: "hrafn-intent-i1",
      lane: "hrafn",
      run_id: preflight.run_id,
      started_at: `2026-07-20T21:0${order}:01.000Z`,
      completed_at: `2026-07-20T21:0${order}:02.000Z`,
      runner_lease: {},
      initial_identity: structuredClone(preflight.identity),
      preflight_spec: {},
      preflight_receipt: {},
      command_argv: structuredClone(preflight.argv),
      output_directory: preflight.output.directory,
      bindings: {
        source_commit: preflight.source.commit,
        job: structuredClone(preflight.job),
        campaign_jobs: structuredClone(preflight.campaign_jobs),
        image_receipt: structuredClone(preflight.image_receipt),
        preregistration: structuredClone(preflight.preregistration),
        manifest: structuredClone(preflight.manifest),
        images: structuredClone(preflight.images),
        planner: structuredClone(preflight.planner),
        identity_window: structuredClone(preflight.identity_window),
        lifecycle: structuredClone(preflight.lifecycle),
      },
      child_exit_code: 0,
      child_signal: null,
      child_spawn_error: null,
      final_identity: structuredClone(preflight.identity),
      final_identity_error: null,
      supervisor_exit_code: 0,
      state: "completed",
    };
    const operationalPath = path.join(
      fixture.directory,
      `${preflight.job.id}-operational.json`,
    );
    const operationalBytes = Buffer.from(`${JSON.stringify(operational, null, 2)}\n`);
    writeFileSync(operationalPath, operationalBytes);
    predecessors.push({
      job_id: preflight.job.id,
      path: operationalPath,
      sha256: sha256(operationalBytes),
    });
    if (order === 1) {
      const pairReport = {
        schema_version: 1,
        record_type: "hrafn_intent_i1_pair_audit",
        campaign_id: "hrafn-intent-i1",
        map: "Pangaea",
        seed: 240723,
        subject_slot: 1,
        control: {
          provenance: { operational_sha256: predecessors[0].sha256 },
        },
        candidate: {
          provenance: { operational_sha256: predecessors[1].sha256 },
        },
        checks: {
          provenance_bound: true,
          jobs_only_intent_flag: true,
          same_map_seed_slot: true,
          control_clean: true,
          candidate_operational: true,
          candidate_reach: true,
          pretreatment_equivalent: true,
          opening_metrics_complete: true,
        },
        verdict: pairVerdict,
      };
      const pairPath = path.join(fixture.directory, "pangaea-pair.json");
      const pairBytes = Buffer.from(`${JSON.stringify(pairReport, null, 2)}\n`);
      writeFileSync(pairPath, pairBytes);
      continuation = { path: pairPath, sha256: sha256(pairBytes) };
    }
  }
  setActiveCell(
    fixture,
    targetOrder,
    predecessors,
    targetOrder >= 2 ? continuation : null,
  );
  return { predecessors, continuation };
}

test("preflight binds exact jobs, Odin advisory window, identity, lease, argv, and fresh output", async () => {
  const fixture = setupFixture();
  try {
    const receipt = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    assert.equal(receipt.record_type, "hrafn_intent_i1_preflight_receipt");
    assert.equal(receipt.job.id, "pangaea-control");
    assert.equal(receipt.job.sha256, fixture.spec.campaign_jobs[0].sha256);
    assert.equal(receipt.manifest.sha256, fixture.manifestSHA);
    assert.equal(receipt.source.commit, SOURCE_COMMIT);
    assert.equal(receipt.images.subject.id, SUBJECT_IMAGE);
    assert.equal(receipt.images.opponent.id, OPPONENT_IMAGE);
    assert.deepEqual(receipt.images.game, coworldGameReceiptFixture());
    assert.equal(receipt.planner.model_digest, MODEL_DIGEST);
    assert.equal(receipt.planner.container_probe.image_id, SUBJECT_IMAGE);
    assert.equal(
      receipt.planner.container_probe.endpoint,
      "http://host.docker.internal:11434/api/generate",
    );
    assert.equal(
      receipt.identity_window.message_id,
      fixture.identityWindow.message_id,
    );
    assert.equal(
      receipt.identity_window.file_sha256,
      sha256(readFileSync(fixture.identityWindowPath)),
    );
    assert.equal(receipt.identity_window.formal_approvals_consumed, 0);
    assert.deepEqual(receipt.lifecycle.predecessors, []);
    assert.equal(receipt.identity.player_id, HRAFN_PLAYER_ID);
    assert.equal(receipt.lease.child_pid, 123);
    assert.deepEqual(receipt.argv, fixture.spec.expected_argv);
    assert.deepEqual(receipt.output.initial_entries, [".proxywar-runner-claim"]);
    assert.equal(Object.values(receipt.checks).every(Boolean), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("HI1 diagnostic preflight consumes no formal approval", async () => {
  const fixture = setupFixture();
  try {
    const receipt = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    assert.equal(receipt.identity_window.formal_approval, false);
    assert.equal(receipt.identity_window.formal_approvals_consumed, 0);
    assert.equal(Object.hasOwn(receipt, "approval"), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("preflight fails closed on cell, job, manifest, image, model, identity, lease, argv, or output drift", async () => {
  const mutations = [
    (fixture) => { fixture.spec.role = "candidate"; },
    (fixture) => { fixture.spec.campaign_jobs[0].seed += 1; },
    (fixture) => { writeFileSync(fixture.spec.job_path, "{}\n"); },
    (fixture) => { writeFileSync(fixture.spec.manifest_path, "{}\n"); },
    (fixture) => { fixture.runtime.inspectImage = async () => ({ id: SUBJECT_IMAGE, os: "linux", architecture: "arm64" }); },
    (fixture) => {
      fixture.runtime.verifyImageEnvironment = async () => ({
        valid: true,
        source_commit: SOURCE_COMMIT,
        subject_image: SUBJECT_IMAGE,
        game_image: `sha256:${"0".repeat(64)}`,
      });
    },
    (fixture) => { fixture.runtime.probeOllama = async () => ({ version: "0.0.0" }); },
    (fixture) => { fixture.runtime.probeContainerOllama = async () => ({ model: "other" }); },
    (fixture) => { fixture.runtime.readIdentity = () => ({ playerID: "other", playerName: "K1Z Hrafn" }); },
    (fixture) => { fixture.runtime.validateLease = () => ({ runID: "other" }); },
    (fixture) => { fixture.spec.expected_argv.push("--use-bedrock"); },
    (fixture) => { writeFileSync(path.join(fixture.output, "results.json"), "{}\n"); },
  ];
  for (const mutate of mutations) {
    const fixture = setupFixture();
    try {
      mutate(fixture);
      await assert.rejects(
        verifyHrafnIntentRunPreflight(
          fixture.spec,
          verificationOptions(fixture),
          fixture.runtime,
        ),
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("exactly one advisory identity window is required and formal approvals remain unused", async () => {
  for (const mutate of [
    (fixture) => {
      const window = JSON.parse(readFileSync(fixture.identityWindowPath, "utf8"));
      window.payload.active_identity.player_name = "K1Z odin free";
      writeFileSync(fixture.identityWindowPath, `${JSON.stringify(window, null, 2)}\n`);
    },
    (fixture) => {
      const duplicate = JSON.parse(readFileSync(fixture.identityWindowPath, "utf8"));
      duplicate.message_id = "odin-hi1-window-duplicate";
      const sealed = sealK1ZPacket(duplicate);
      writeFileSync(
        path.join(fixture.mailbox, "duplicate.json"),
        serializeK1ZPacket(sealed),
      );
    },
    (fixture) => {
      const window = JSON.parse(readFileSync(fixture.identityWindowPath, "utf8"));
      window.from = "hrafn";
      writeFileSync(fixture.identityWindowPath, `${JSON.stringify(window, null, 2)}\n`);
    },
    (fixture) => {
      const window = JSON.parse(readFileSync(fixture.identityWindowPath, "utf8"));
      window.payload.bindings.jobs[0].sha256 = "0".repeat(64);
      writeFileSync(fixture.identityWindowPath, `${JSON.stringify(window, null, 2)}\n`);
    },
    (fixture) => {
      const window = JSON.parse(readFileSync(fixture.identityWindowPath, "utf8"));
      window.payload.bindings.game_image_id = `sha256:${"0".repeat(64)}`;
      writeFileSync(
        fixture.identityWindowPath,
        serializeK1ZPacket(sealK1ZPacket(window)),
      );
    },
    (fixture) => {
      const formal = sealK1ZPacket(packetBase({
        message_id: "odin-hi1-forbidden-formal",
        sequence: 101,
        kind: "verdict",
        authority: {
          advisory: false,
          formal_approval: true,
          mutation_scope: "hrafn",
        },
        payload: {
          decision: "APPROVE",
          gates: {
            source_image_bound: true,
            local_matched: true,
            fail_closed_continuation: true,
            zero_k1z_harm: true,
          },
        },
      }));
      writeFileSync(
        path.join(fixture.mailbox, "forbidden-formal.json"),
        serializeK1ZPacket(formal),
      );
    },
  ]) {
    const fixture = setupFixture();
    try {
      mutate(fixture);
      await assert.rejects(
        verifyHrafnIntentRunPreflight(
          fixture.spec,
          verificationOptions(fixture),
          fixture.runtime,
        ),
        /identity|window|formal|binding|exactly|invalid/i,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("historical artifact-bound identity windows do not block the current window", async () => {
  const fixture = setupFixture();
  try {
    const historical = JSON.parse(readFileSync(
      fixture.identityWindowPath,
      "utf8",
    ));
    historical.message_id = "odin-hi1-window-historical";
    historical.sequence -= 1;
    historical.payload.bindings.source_commit = "9".repeat(40);
    writeFileSync(
      path.join(fixture.mailbox, "historical.json"),
      serializeK1ZPacket(sealK1ZPacket(historical)),
    );

    const receipt = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    assert.equal(receipt.checks.one_odin_advisory_identity_window, true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("preflight binds live preregistration bytes to the image-receipt source hash", async () => {
  const fixture = setupFixture();
  try {
    const receipt = JSON.parse(readFileSync(fixture.spec.image_receipt_path, "utf8"));
    const entry = receipt.files.find((file) =>
      file.path === "experiments/hrafn-intent-i1-preregistration-20260720.json"
    );
    entry.sha256 = "0".repeat(64);
    receipt.integrity.content_sha256 = hrafnIntentReceiptContentSHA256(receipt);
    writeFileSync(
      fixture.spec.image_receipt_path,
      serializeHrafnIntentImageReceipt(receipt),
    );
    await assert.rejects(
      verifyHrafnIntentRunPreflight(
        fixture.spec,
        verificationOptions(fixture),
        fixture.runtime,
      ),
      /preregistration bytes.*committed image-receipt source/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("preflight enforces the exact four-run predecessor chain and Pangaea continuation", async () => {
  for (const order of [1, 2, 3]) {
    const fixture = setupFixture();
    try {
      await prepareActiveOrder(fixture, order);
      const receipt = await verifyHrafnIntentRunPreflight(
        fixture.spec,
        verificationOptions(fixture),
        fixture.runtime,
      );
      assert.equal(receipt.lifecycle.active_order, order);
      assert.equal(receipt.lifecycle.predecessors.length, order);
      assert.equal(
        receipt.lifecycle.pangaea_continuation === null,
        order < 2,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("append-only mailbox commits preserve an exact predecessor identity window", async () => {
  const fixture = setupFixture();
  try {
    const { predecessors } = await prepareActiveOrder(fixture, 1);
    fixture.runtime.verifyMailboxEnvironment = async () => ({
      head_commit: "9".repeat(40),
      remote_commit: "9".repeat(40),
    });
    let observedHistory = null;
    fixture.runtime.verifyMailboxArtifactHistory = async (entry) => {
      observedHistory = structuredClone(entry);
      return entry.commit === "8".repeat(40) &&
        entry.current_commit === "9".repeat(40) &&
        entry.path === fixture.identityWindowPath &&
        entry.file_sha256 === sha256(readFileSync(fixture.identityWindowPath));
    };

    const receipt = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    assert.equal(receipt.lifecycle.predecessors.length, 1);
    assert.equal(
      receipt.lifecycle.predecessors[0].file_sha256,
      predecessors[0].sha256,
    );
    assert.equal(observedHistory.commit, "8".repeat(40));
    assert.equal(observedHistory.current_commit, "9".repeat(40));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("preflight requires an exact boolean mailbox-history verdict", async () => {
  const invalidVerifiers = [
    async () => false,
    async () => undefined,
    async () => ({ valid: false }),
    async () => { throw new Error("mailbox history probe failed"); },
  ];
  for (const verifier of invalidVerifiers) {
    const fixture = setupFixture();
    try {
      await prepareActiveOrder(fixture, 1);
      fixture.runtime.verifyMailboxEnvironment = async () => ({
        head_commit: "9".repeat(40),
        remote_commit: "9".repeat(40),
      });
      fixture.runtime.verifyMailboxArtifactHistory = verifier;
      await assert.rejects(
        verifyHrafnIntentRunPreflight(
          fixture.spec,
          verificationOptions(fixture),
          fixture.runtime,
        ),
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("mailbox history verifies real ancestry and exact nested-path blob bytes", async () => {
  const repository = realpathSync(
    mkdtempSync(path.join(tmpdir(), "hrafn-mailbox-history-")),
  );
  const mailbox = path.join(repository, "nested", "mailbox");
  mkdirSync(mailbox, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", repository, ...args]);
  const commit = () => String(git("rev-parse", "HEAD")).trim();
  const runtime = {
    async run(command, args, options = {}) {
      return {
        stdout: execFileSync(command, args, {
          cwd: options.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        }),
        stderr: Buffer.alloc(0),
      };
    },
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Hrafn Test");
    git("config", "user.email", "hrafn-test@example.invalid");
    const outsidePath = path.join(repository, "outside.json");
    writeFileSync(outsidePath, "outside\n");
    git("add", "--", "outside.json");
    git("commit", "-qm", "base without window");
    const missingBlobCommit = commit();

    const windowPath = path.join(mailbox, "identity-window.json");
    const exactBytes = Buffer.from('{"window":"exact"}\n');
    writeFileSync(windowPath, exactBytes);
    git("add", "--", "nested/mailbox/identity-window.json");
    git("commit", "-qm", "add exact window");
    const exactCommit = commit();

    writeFileSync(path.join(mailbox, "unrelated.txt"), "append only\n");
    git("add", "--", "nested/mailbox/unrelated.txt");
    git("commit", "-qm", "append unrelated mailbox entry");
    const appendCommit = commit();
    const exactEntry = {
      commit: exactCommit,
      current_commit: appendCommit,
      path: windowPath,
      file_sha256: sha256(exactBytes),
    };
    assert.equal(
      await verifyMailboxArtifactHistory(exactEntry, mailbox, runtime),
      true,
    );
    assert.equal(
      await verifyMailboxArtifactHistory(
        { ...exactEntry, commit: missingBlobCommit },
        mailbox,
        runtime,
      ),
      false,
    );
    assert.equal(
      await verifyMailboxArtifactHistory(
        {
          ...exactEntry,
          path: outsidePath,
          file_sha256: sha256(readFileSync(outsidePath)),
        },
        mailbox,
        runtime,
      ),
      false,
    );

    writeFileSync(windowPath, '{"window":"exact"}\r\n');
    git("add", "--", "nested/mailbox/identity-window.json");
    git("commit", "-qm", "change window bytes");
    const changedCommit = commit();
    assert.equal(
      await verifyMailboxArtifactHistory(
        {
          ...exactEntry,
          commit: changedCommit,
          current_commit: changedCommit,
        },
        mailbox,
        runtime,
      ),
      false,
    );

    git("checkout", "-q", "-b", "sibling", exactCommit);
    writeFileSync(path.join(mailbox, "sibling.txt"), "sibling\n");
    git("add", "--", "nested/mailbox/sibling.txt");
    git("commit", "-qm", "sibling history");
    const siblingCommit = commit();
    git("checkout", "-q", "main");
    assert.equal(
      await verifyMailboxArtifactHistory(
        {
          ...exactEntry,
          commit: siblingCommit,
          current_commit: changedCommit,
        },
        mailbox,
        runtime,
      ),
      false,
    );
    assert.equal(
      await verifyMailboxArtifactHistory(
        { ...exactEntry, current_commit: "f".repeat(40) },
        mailbox,
        runtime,
      ),
      false,
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("Asia dispatch rejects missing predecessors or a Pangaea stop verdict", async () => {
  for (const mutate of [
    (fixture) => fixture.spec.predecessor_operational_receipts.pop(),
    (fixture) => {
      const pair = JSON.parse(readFileSync(
        fixture.spec.pangaea_continuation_pair_report.path,
        "utf8",
      ));
      pair.verdict = "REJECT_NO_REACH";
      const bytes = Buffer.from(`${JSON.stringify(pair, null, 2)}\n`);
      writeFileSync(fixture.spec.pangaea_continuation_pair_report.path, bytes);
      fixture.spec.pangaea_continuation_pair_report.sha256 = sha256(bytes);
    },
    (fixture) => {
      fixture.spec.predecessor_operational_receipts.reverse();
    },
  ]) {
    const fixture = setupFixture();
    try {
      await prepareActiveOrder(fixture, 2);
      mutate(fixture);
      await assert.rejects(
        verifyHrafnIntentRunPreflight(
          fixture.spec,
          verificationOptions(fixture),
          fixture.runtime,
        ),
        /predecessor|continuation|dispatch|Pangaea/i,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("Pangaea no-lift remains an authorized continuation verdict", async () => {
  const fixture = setupFixture();
  try {
    await prepareActiveOrder(fixture, 2, "REJECT_NO_LIFT");
    const receipt = await verifyHrafnIntentRunPreflight(
      fixture.spec,
      verificationOptions(fixture),
      fixture.runtime,
    );
    assert.equal(
      receipt.lifecycle.pangaea_continuation.verdict,
      "REJECT_NO_LIFT",
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("Ollama probe observes exact version, tag digest, show response, and schema-constrained generation", async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/version")) {
      return new Response(JSON.stringify({ version: "0.32.1" }));
    }
    if (url.endsWith("/api/tags")) {
      return new Response(JSON.stringify({
        models: [{ name: "llama3:latest", digest: MODEL_DIGEST }],
      }));
    }
    if (url.endsWith("/api/show")) {
      return new Response(JSON.stringify({
        details: { parameter_size: "8.0B", quantization_level: "Q4_0" },
        model_info: { "general.architecture": "llama" },
      }));
    }
    if (url.endsWith("/api/generate")) {
      return new Response(JSON.stringify({
        model: "llama3:latest",
        done: true,
        response: JSON.stringify({ objective: "grow", targetID: null, horizon: 8 }),
      }));
    }
    return new Response("not found", { status: 404 });
  };
  const result = await probeHrafnIntentOllama({ fetch });
  assert.equal(result.version, "0.32.1");
  assert.equal(result.model_digest, MODEL_DIGEST);
  assert.deepEqual(result.probe_intent, { objective: "grow", targetID: null, horizon: 8 });
  assert.equal(calls.length, 4);
  const generate = JSON.parse(calls[3].options.body);
  assert.equal(generate.model, "llama3:latest");
  assert.equal(generate.stream, false);
  assert.equal(generate.format.additionalProperties, false);
  assert.deepEqual(generate.format.required, ["objective", "targetID", "horizon"]);
});

test("container Ollama probe uses the exact subject image, Docker route, model, and schema", async () => {
  const calls = [];
  const runtime = {
    async run(command, args) {
      calls.push([command, ...args]);
      return {
        stdout: Buffer.from(JSON.stringify({
          model: "llama3:latest",
          done: true,
          response: JSON.stringify({ objective: "grow", targetID: null, horizon: 8 }),
        })),
        stderr: Buffer.alloc(0),
      };
    },
  };
  const result = await probeHrafnIntentOllamaFromContainer({
    imageID: SUBJECT_IMAGE,
    runtime,
  });
  assert.equal(result.image_id, SUBJECT_IMAGE);
  assert.equal(result.model, "llama3:latest");
  assert.equal(
    result.endpoint,
    "http://host.docker.internal:11434/api/generate",
  );
  assert.deepEqual(result.probe_intent, {
    objective: "grow",
    targetID: null,
    horizon: 8,
  });
  assert.match(result.schema_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 9), [
    "docker",
    "run",
    "--rm",
    "--network",
    "bridge",
    "--entrypoint",
    "node",
    SUBJECT_IMAGE,
    "--input-type=module",
  ]);
  assert.equal(calls[0].join(" ").includes("host.docker.internal:11434"), true);
  assert.equal(calls[0].join(" ").includes("llama3:latest"), true);
});

test("Ollama probe rejects wrong version, digest, show metadata, model response, or malformed intent", async () => {
  const base = {
    version: { version: "0.32.1" },
    tags: { models: [{ name: "llama3:latest", digest: MODEL_DIGEST }] },
    show: { details: { parameter_size: "8.0B" }, model_info: { arch: "llama" } },
    generate: {
      model: "llama3:latest",
      done: true,
      response: JSON.stringify({ objective: "grow", targetID: null, horizon: 8 }),
    },
  };
  for (const mutate of [
    (data) => { data.version.version = "0.0.0"; },
    (data) => { data.tags.models[0].digest = "0".repeat(64); },
    (data) => { data.show = {}; },
    (data) => { data.generate.model = "other:latest"; },
    (data) => { data.generate.response = "{}"; },
  ]) {
    const data = structuredClone(base);
    mutate(data);
    const fetch = async (url) => {
      const key = url.split("/").at(-1);
      return new Response(JSON.stringify(data[key]));
    };
    await assert.rejects(probeHrafnIntentOllama({ fetch }));
  }
});
