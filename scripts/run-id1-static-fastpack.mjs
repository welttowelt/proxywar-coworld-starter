#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), "..");
const RUNNER = process.env.PROXYWAR_RUNNER_LEASE_SCRIPT ||
  path.join(REPO, "scripts/proxywar-runner-lease.sh");
const SHA = /^[0-9a-f]{64}$/;

function stop(message, code = 2) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (file) => hash(readFileSync(file));
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function repoFile(relative, expected, label) {
  if (!SHA.test(expected ?? "") || path.isAbsolute(relative ?? "") ||
      path.posix.normalize(relative ?? "") !== relative || relative.includes("..")) {
    stop(`${label} binding is invalid`);
  }
  const file = path.join(REPO, relative);
  const committed = execFileSync("git", ["-C", REPO, "show", `HEAD:${relative}`]);
  if (hash(committed) !== expected || fileHash(file) !== expected) {
    stop(`${label} differs from its committed hash`);
  }
  return file;
}

function loadPack(manifestPath, expectedManifestHash = null) {
  const relative = path.relative(REPO, manifestPath).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    stop("manifest must be inside this repository");
  }
  const bytes = readFileSync(manifestPath);
  const manifestHash = hash(bytes);
  if (expectedManifestHash && manifestHash !== expectedManifestHash) stop("manifest changed");
  if (hash(execFileSync("git", ["-C", REPO, "show", `HEAD:${relative}`])) !== manifestHash) {
    stop("manifest differs from HEAD");
  }
  const pack = JSON.parse(bytes);
  if (pack.schema_version !== 1 || pack.runtime?.coworld_version !== "0.1.30" ||
      pack.runner?.lane !== "odin" || !/^[A-Za-z0-9._-]{1,80}$/.test(pack.runner?.run_id ?? "")) {
    stop("invalid ID1 fastpack identity or runtime");
  }
  if (!Array.isArray(pack.jobs) || pack.jobs.length !== 4 ||
      new Set(pack.jobs.map((job) => job.output_dir)).size !== 4) {
    stop("ID1 fastpack must bind four distinct outputs");
  }
  if (pack.next_stage?.league_mutation !== false) stop("next stage permits mutation");
  if (!SHA.test(pack.coworld_manifest?.sha256 ?? "") ||
      fileHash(pack.coworld_manifest.path) !== pack.coworld_manifest.sha256) {
    stop("Coworld manifest hash mismatch");
  }
  for (const job of pack.jobs) {
    job.file = repoFile(job.job_path, job.job_sha256, `job ${job.id}`);
  }
  pack.auditor.file = repoFile(pack.auditor?.path, pack.auditor?.sha256, "auditor");
  for (const [field, value] of Object.entries(pack.receipts ?? {})) {
    if (!path.isAbsolute(value) || !path.normalize(value).startsWith("/private/tmp/")) {
      stop(`invalid receipt path: ${field}`);
    }
  }
  return { pack, manifestHash };
}

function readReceipt(pack, manifestHash) {
  const receipt = json(pack.receipts.local_audit_path);
  const verdict = String(receipt.verdict ?? "").toUpperCase();
  const passed = verdict.startsWith("PASS");
  const failed = /^(FAIL|STOP|REJECT)/.test(verdict);
  if (receipt.manifest_sha256 !== manifestHash || receipt.league_mutation !== false ||
      (!passed && !failed) || (passed && receipt.failures?.length !== 0)) {
    stop("audit receipt is invalid or unbound");
  }
  return { receipt, passed, sha256: fileHash(pack.receipts.local_audit_path) };
}

function handoff(pack, manifestPath, manifestHash, auditHash) {
  const target = pack.receipts.next_preflight_path;
  if (existsSync(target)) {
    const prior = json(target);
    if (prior.manifest?.sha256 !== manifestHash || prior.local_audit?.sha256 !== auditHash ||
        prior.mutation_preflight !== false || prior.league_mutation !== false) {
      stop("existing handoff is unbound");
    }
    return target;
  }
  writeFileSync(target, `${JSON.stringify({
    schema_version: 1,
    record_type: "qd1n_id1_diagnostic_preflight_handoff",
    created_at: new Date().toISOString(),
    experiment_id: pack.experiment_id,
    status: "LOCAL_FASTPACK_PASS",
    manifest: { path: manifestPath, sha256: manifestHash },
    local_audit: { path: pack.receipts.local_audit_path, sha256: auditHash },
    preregistered_next_stage: pack.next_stage,
    mutation_preflight: false,
    league_mutation: false,
    missing_strict_artifacts: [
      "validator-compatible local audit and differential binding",
      "pre-upload RCI receipt bound to exact source and image",
      "strict diagnostic preflight validated with --require-diagnostic",
    ],
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return target;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    child.once("error", (error) => resolve({ code: null, error: error.message }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function execute(manifestPath, manifestHash) {
  const { pack } = loadPack(manifestPath, manifestHash);
  const binary = process.env.PROXYWAR_ID1_COWORLD_BIN;
  const results = await Promise.all(pack.jobs.map((job) => {
    const args = [pack.coworld_manifest.path, job.file, "-o", job.output_dir];
    return binary
      ? run(binary, args, { stdio: "inherit", env: process.env })
      : run("uvx", ["--from", "coworld==0.1.30", "coworld", "run-episode", ...args],
          { stdio: "inherit", env: process.env });
  }));
  if (results.some((result) => result.code !== 0 || result.signal || result.error)) {
    writeFileSync(pack.receipts.local_audit_path, `${JSON.stringify({
      schema_version: 1,
      manifest_sha256: manifestHash,
      verdict: "FAIL_EXECUTION",
      failures: results.map((result, index) => ({ job: pack.jobs[index].id, ...result })),
      league_mutation: false,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return 0;
  }
  const audited = spawnSync(process.execPath,
    [pack.auditor.file, "--manifest", manifestPath], { stdio: "inherit", env: process.env });
  if (!existsSync(pack.receipts.local_audit_path)) return audited.status ?? 2;
  const receipt = readReceipt(pack, manifestHash);
  if ((receipt.passed && audited.status !== 0) || (!receipt.passed && audited.status === 0)) return 2;
  return 0;
}

function interruptedOutput(pack) {
  return pack.jobs.some((job) => {
    if (existsSync(job.output_dir)) return true;
    const prefix = `${path.basename(job.output_dir)}.aborted-`;
    return readdirSync(path.dirname(job.output_dir)).some((entry) => entry.startsWith(prefix));
  });
}

async function main(args) {
  if (args[0] === "--execute") return execute(path.resolve(args[1]), args[2]);
  if (args[0] !== "--manifest" || !args[1] || args.length > 2) {
    stop("usage: node scripts/run-id1-static-fastpack.mjs --manifest FILE", 64);
  }
  const manifestPath = path.resolve(args[1]);
  const { pack, manifestHash } = loadPack(manifestPath);
  if (existsSync(pack.receipts.local_audit_path)) {
    const audit = readReceipt(pack, manifestHash);
    if (!audit.passed) stop(`ID1 stopped: ${audit.receipt.verdict}`, 1);
    console.log(`PASS receipt resume; handoff: ${handoff(pack, manifestPath, manifestHash, audit.sha256)}`);
    return 0;
  }
  if (interruptedOutput(pack) || existsSync(pack.receipts.next_preflight_path)) {
    stop("output history exists without a bound audit receipt");
  }
  for (;;) {
    const status = spawnSync(RUNNER, ["status", "--json"], { encoding: "utf8" });
    if (status.status !== 0) stop("runner status failed");
    const state = JSON.parse(status.stdout);
    if (state.state === "free") break;
    if (!["active", "initializing", "reaping"].includes(state.state)) {
      stop(`runner is ${state.state}; recovery is forbidden`);
    }
    await sleep(15_000);
  }
  loadPack(manifestPath, manifestHash);
  const leaseArgs = ["run", "odin", pack.runner.run_id];
  for (const job of pack.jobs) leaseArgs.push("--output", job.output_dir);
  leaseArgs.push("--", process.execPath, SELF, "--execute", manifestPath, manifestHash);
  const leased = spawnSync(RUNNER, leaseArgs, { stdio: "inherit", env: process.env });
  if (leased.status !== 0) stop(`supervised fastpack failed: ${leased.status}`);
  const audit = readReceipt(pack, manifestHash);
  if (!audit.passed) stop(`ID1 stopped: ${audit.receipt.verdict}`, 1);
  console.log(`PASS; handoff: ${handoff(pack, manifestPath, manifestHash, audit.sha256)}`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code ?? 0; }).catch((error) => {
  console.error(error.message);
  process.exitCode = error.code ?? 2;
});
