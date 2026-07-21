import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const producer = fileURLToPath(
  new URL("../scripts/audit-standard-qualifier.mjs", import.meta.url),
);
const sourceCommit = "a".repeat(40);
const imageID = `sha256:${"b".repeat(64)}`;

async function fixture({ fallback = false, attestedImageID = imageID } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "std1-qualifier-"));
  const run = path.join(root, "run");
  const decisionsDir = path.join(run, "proxywar-runs", "coworld-test");
  const bin = path.join(root, "bin");
  await mkdir(decisionsDir, { recursive: true });
  await mkdir(bin);
  const records = [
    {
      username: "Qualifier Seat 1",
      selectedLegalActionId: "spawn:1",
      selectedActionKind: "spawn",
      legalActionIDs: ["spawn:1", "hold"],
      result: { accepted: true, reason: "accepted" },
      fallbackUsed: false,
    },
    {
      username: "Qualifier Seat 1",
      selectedLegalActionId: fallback ? "hold" : "expand:terra-nullius:35",
      selectedActionKind: fallback ? "hold" : "attack",
      legalActionIDs: ["expand:terra-nullius:35", "hold"],
      result: { accepted: true, reason: "accepted" },
      fallbackUsed: fallback,
    },
    {
      username: "Control Seat",
      selectedLegalActionId: "hold",
      selectedActionKind: "hold",
      legalActionIDs: ["hold"],
      result: { accepted: true, reason: "accepted" },
      fallbackUsed: true,
    },
  ];
  const resultsBody = JSON.stringify({
    game_id: "COWRLD01",
    decision_count: records.length,
    accepted_decision_count: records.length,
    fallback_count: records.filter((record) => record.fallbackUsed).length,
    degraded_count: records.filter((record) => record.fallbackUsed).length,
  });
  const replayBody = "{}\n";
  const decisionsBody = `${records.map(JSON.stringify).join("\n")}\n`;
  const digest = (body) => createHash("sha256").update(body).digest("hex");
  const decisionsRelative = "proxywar-runs/coworld-test/decisions.jsonl";
  await writeFile(path.join(run, "results.json"), resultsBody);
  await writeFile(path.join(run, "replay"), replayBody);
  await writeFile(path.join(decisionsDir, "decisions.jsonl"), decisionsBody);
  const policyTable = [{ key: "qd1n-std1", image_id: attestedImageID }];
  const runSpec = {
    location: "bundle",
    relative_path: "specs/canary-candidate-player-specs.json",
    sha256: "d".repeat(64),
    manifest_label: "transport-canary-candidate",
    manifest_role: "candidate",
    execution_class: "transport_canary",
  };
  const canaries = [{
    label: "transport-canary-candidate",
    path: runSpec.relative_path,
    sha256: runSpec.sha256,
    role: "candidate",
  }];
  await writeFile(path.join(run, "receipt.json"), JSON.stringify({
    schema_version: 1,
    receipt_scope: "transport_and_artifact_integrity_only",
    evaluation_verdict: "not_evaluated",
    status: "passed",
    execution_class: "transport_canary",
    run_spec: runSpec,
    plan: {
      players: [
        { name: "Qualifier Seat 1", policy: "qd1n-std1" },
        { name: "Control Seat", policy: "qd1n-v97" },
      ],
    },
    runtime_fingerprint: { status: "verified" },
    bundle_verification: {
      status: "verified",
      policies: policyTable,
      transport_canaries: canaries,
    },
    post_run_attestation: {
      status: "stable",
      run_spec: runSpec,
      runtime_fingerprint: { status: "verified" },
      bundle_verification: {
        status: "verified",
        policies: policyTable,
        transport_canaries: canaries,
      },
    },
    primary_artifact_hashes: {
      "results.json": { sha256: digest(resultsBody), bytes: Buffer.byteLength(resultsBody) },
      replay: { sha256: digest(replayBody), bytes: Buffer.byteLength(replayBody) },
    },
    artifacts: [
      { path: "results.json", sha256: digest(resultsBody), bytes: Buffer.byteLength(resultsBody) },
      { path: "replay", sha256: digest(replayBody), bytes: Buffer.byteLength(replayBody) },
      { path: decisionsRelative, sha256: digest(decisionsBody), bytes: Buffer.byteLength(decisionsBody) },
    ],
  }));
  const docker = path.join(bin, "docker");
  await writeFile(docker, `#!/bin/sh\nprintf '%s\\n' '${imageID}|amd64'\n`);
  await chmod(docker, 0o755);
  return { run, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

async function execute(run, env) {
  try {
    const result = await execFileAsync(process.execPath, [
      producer,
      "--run-dir", run,
      "--source-commit", sourceCommit,
      "--image-id", imageID,
      "--policy-key", "qd1n-std1",
    ], { env });
    return { status: 0, receipt: JSON.parse(result.stdout) };
  } catch (error) {
    return { status: error.code, receipt: JSON.parse(error.stdout) };
  }
}

test("qualifier receipt binds a clean run to source, image, producer, and artifacts", async () => {
  const { run, env } = await fixture();
  const { status, receipt } = await execute(run, env);
  assert.equal(status, 0);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.source_commit, sourceCommit);
  assert.equal(receipt.image_id, imageID);
  assert.match(receipt.producer.sha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.artifacts["decisions.jsonl"].sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.result_counters_match, true);
  assert.equal(receipt.runner_attestation_verified, true);
});

test("qualifier receipt fails closed on any fallback or degradation", async () => {
  const { run, env } = await fixture({ fallback: true });
  const { status, receipt } = await execute(run, env);
  assert.notEqual(status, 0);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.fallback_decisions, 1);
  assert.equal(receipt.degraded_decisions, 1);
});

test("qualifier receipt rejects a clean run attested to another image", async () => {
  const { run, env } = await fixture({
    attestedImageID: `sha256:${"c".repeat(64)}`,
  });
  const { status, receipt } = await execute(run, env);
  assert.notEqual(status, 0);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.runner_attestation_verified, false);
});
