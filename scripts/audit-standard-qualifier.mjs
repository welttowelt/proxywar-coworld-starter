#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
function option(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

const runDir = path.resolve(option("--run-dir") ?? "");
const sourceCommit = String(option("--source-commit") ?? "").toLowerCase();
const imageID = String(option("--image-id") ?? "").toLowerCase();
const policyKey = String(option("--policy-key") ?? "");
if (!path.isAbsolute(option("--run-dir") ?? "")) {
  throw new Error("--run-dir must be absolute");
}
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("--source-commit must be a full 40-character commit ID");
}
if (!/^sha256:[0-9a-f]{64}$/.test(imageID)) {
  throw new Error("--image-id must be a full Docker image ID");
}
if (!/^[A-Za-z0-9._-]{1,80}$/.test(policyKey)) {
  throw new Error("--policy-key must identify the bundled candidate policy");
}

const inspected = spawnSync(
  "docker",
  ["image", "inspect", imageID, "--format", "{{.Id}}|{{.Architecture}}"],
  { encoding: "utf8" },
);
if (inspected.status !== 0 || inspected.stdout.trim() !== `${imageID}|amd64`) {
  throw new Error("candidate image ID is unavailable or is not amd64");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function findNamed(directory, filename) {
  const found = [];
  async function visit(current, depth) {
    if (depth > 4) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile() && entry.name === filename) found.push(target);
    }
  }
  await visit(directory, 0);
  return found.sort();
}

const decisionsFiles = await findNamed(runDir, "decisions.jsonl");
if (decisionsFiles.length !== 1) {
  throw new Error(`expected exactly one decisions.jsonl, found ${decisionsFiles.length}`);
}
const artifactPaths = {
  "results.json": path.join(runDir, "results.json"),
  replay: path.join(runDir, "replay"),
  "decisions.jsonl": decisionsFiles[0],
  "runner-receipt.json": path.join(runDir, "receipt.json"),
};
const artifacts = {};
for (const [name, filename] of Object.entries(artifactPaths)) {
  const bytes = await readFile(filename);
  artifacts[name] = {
    path: path.relative(runDir, filename),
    sha256: sha256(bytes),
    bytes: bytes.length,
  };
}

const results = JSON.parse(await readFile(artifactPaths["results.json"], "utf8"));
const runnerReceipt = JSON.parse(
  await readFile(artifactPaths["runner-receipt.json"], "utf8"),
);
const allRecords = (await readFile(artifactPaths["decisions.jsonl"], "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim() !== "")
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`decisions.jsonl line ${index + 1} is invalid JSON`);
    }
  });
if (allRecords.length === 0) throw new Error("qualifier contains no decisions");

const plannedSubjects = (runnerReceipt?.plan?.players ?? [])
  .filter((player) => player?.policy === policyKey);
if (plannedSubjects.length !== 1) {
  throw new Error(`runner plan must contain candidate policy ${policyKey} exactly once`);
}
const subjectName = String(plannedSubjects[0]?.name ?? "").trim();
const records = allRecords.filter((record) =>
  String(record?.username ?? "").trim().toLowerCase() === subjectName.toLowerCase()
);
if (records.length === 0) throw new Error("qualifier contains no candidate decisions");

function policyImage(receipt, location) {
  const policies = location === "post"
    ? receipt?.post_run_attestation?.bundle_verification?.policies
    : receipt?.bundle_verification?.policies;
  const matches = Array.isArray(policies)
    ? policies.filter((policy) => policy?.key === policyKey)
    : [];
  return matches.length === 1 ? matches[0]?.image_id : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const runnerArtifacts = Array.isArray(runnerReceipt?.artifacts)
  ? runnerReceipt.artifacts
  : [];
let runnerArtifactHashesMatch = true;
for (const name of ["results.json", "replay", "decisions.jsonl"]) {
  const relative = artifacts[name].path.split(path.sep).join("/");
  const matches = runnerArtifacts.filter((entry) => entry?.path === relative);
  if (
    matches.length !== 1 || matches[0]?.sha256 !== artifacts[name].sha256 ||
    matches[0]?.bytes !== artifacts[name].bytes
  ) runnerArtifactHashesMatch = false;
}
const runnerAttestationVerified =
  runnerReceipt?.schema_version === 1 &&
  runnerReceipt?.receipt_scope === "transport_and_artifact_integrity_only" &&
  runnerReceipt?.evaluation_verdict === "not_evaluated" &&
  runnerReceipt?.status === "passed" &&
  runnerReceipt?.execution_class === "transport_canary" &&
  runnerReceipt?.run_spec?.manifest_label === "transport-canary-candidate" &&
  runnerReceipt?.run_spec?.manifest_role === "candidate" &&
  runnerReceipt?.runtime_fingerprint?.status === "verified" &&
  runnerReceipt?.bundle_verification?.status === "verified" &&
  runnerReceipt?.post_run_attestation?.status === "stable" &&
  runnerReceipt?.post_run_attestation?.runtime_fingerprint?.status === "verified" &&
  runnerReceipt?.post_run_attestation?.bundle_verification?.status === "verified" &&
  stable(runnerReceipt?.run_spec) ===
    stable(runnerReceipt?.post_run_attestation?.run_spec) &&
  stable(runnerReceipt?.bundle_verification?.policies) ===
    stable(runnerReceipt?.post_run_attestation?.bundle_verification?.policies) &&
  (runnerReceipt?.bundle_verification?.transport_canaries ?? []).filter((entry) =>
    entry?.label === "transport-canary-candidate" &&
    entry?.role === "candidate" &&
    entry?.path === runnerReceipt?.run_spec?.relative_path &&
    entry?.sha256 === runnerReceipt?.run_spec?.sha256
  ).length === 1 &&
  policyImage(runnerReceipt, "pre") === imageID &&
  policyImage(runnerReceipt, "post") === imageID &&
  runnerReceipt?.primary_artifact_hashes?.["results.json"]?.sha256 ===
    artifacts["results.json"].sha256 &&
  runnerReceipt?.primary_artifact_hashes?.replay?.sha256 === artifacts.replay.sha256 &&
  runnerArtifactHashesMatch;

let accepted = 0;
let fallback = 0;
let degraded = 0;
let rejected = 0;
let illegal = 0;
for (const record of records) {
  const selected = record?.selectedLegalActionId;
  const offered = record?.legalActionIDs;
  if (record?.result?.accepted === true) accepted++;
  else rejected++;
  if (record?.fallbackUsed === true) fallback++;
  if (
    record?.fallbackUsed === true || record?.llmPlannerDegraded === true ||
    record?.plannerDegraded === true || record?.degraded === true
  ) degraded++;
  if (typeof selected !== "string" || !Array.isArray(offered) || !offered.includes(selected)) {
    illegal++;
  }
}

const countersMatch = Number(results?.decision_count) === allRecords.length &&
  Number(results?.accepted_decision_count) >= accepted;
const passed = runnerAttestationVerified && countersMatch && records.length > 0 &&
  accepted === records.length &&
  fallback === 0 && degraded === 0 && rejected === 0 && illegal === 0;

const producerPath = fileURLToPath(import.meta.url);
const receipt = {
  schema_version: "proxywar-standard-qualifier-v1",
  passed,
  source_commit: sourceCommit,
  image_id: imageID,
  policy_key: policyKey,
  producer: {
    path: "scripts/audit-standard-qualifier.mjs",
    sha256: sha256(await readFile(producerPath)),
  },
  run_dir: runDir,
  game_id: results?.game_id ?? null,
  subject_name: subjectName,
  decision_count: records.length,
  accepted_decisions: accepted,
  fallback_decisions: fallback,
  degraded_decisions: degraded,
  rejected_decisions: rejected,
  illegal_decisions: illegal,
  all_selected_ids_offered: illegal === 0,
  result_counters_match: countersMatch,
  runner_attestation_verified: runnerAttestationVerified,
  artifacts,
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (!passed) process.exitCode = 1;
