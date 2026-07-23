#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  link,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RunpodctlClient,
  blockExactPendingPrePostCreate,
  readReaperLedger,
} from "./runpod-exact-id-reaper.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const INDEX_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "receipt-mickey-r8-pre-post-failure-20260721.json",
);
const INDEX_SHA256 = "799e4c547fb786e74680365b42fdf55d845e7a1ab7cf7df51e2f058a40d2d280";
const RECEIPT_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  "experiments",
  "expected-mickey-r8-pre-post-recovery-receipt-20260721.json",
);
const RECEIPT_SHA256 = "67d4f2b5d04c2ae10b128eeae60eca6e1eeac0631206fca1271519a4d61515b8";
const R8_SOURCE_REPOSITORY = "/Users/olifreuler/proxywar-coworld-starter";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!equalJson(actual, expected)) throw new Error(`${label} has unexpected keys`);
}

async function runReadOnly(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const collect = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > 16 * 1024 * 1024) {
        child.kill("SIGKILL");
        throw new Error("read-only command output exceeded 16 MiB");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try { stdout = collect(stdout, chunk); } catch (error) { reject(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = collect(stderr, chunk); } catch (error) { reject(error); }
    });
    child.once("error", () => reject(new Error("read-only command could not start")));
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function inventoryTree(root) {
  if (await realpath(root) !== root) throw new Error("quarantine root must already be canonical");
  const files = [];
  let directories = 0;
  let bytes = 0;
  async function walk(directory, relativeRoot = "") {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error(`quarantine directory is unsafe: ${relativeRoot || "."}`);
    }
    if ((directoryInfo.mode & 0o777) !== 0o700) {
      throw new Error(`quarantine directory mode drifted: ${relativeRoot || "."}`);
    }
    directories += 1;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeRoot, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`quarantine contains symlink ${relative}`);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error(`quarantine contains non-regular entry ${relative}`);
      const info = await lstat(absolute);
      const digest = await sha256File(absolute);
      const mode = (info.mode & 0o777).toString(8).padStart(3, "0");
      files.push({ relative, absolute, digest, mode, size: info.size });
      bytes += info.size;
    }
  }
  await walk(root);
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  const content = createHash("sha256");
  const modeBound = createHash("sha256");
  for (const file of files) {
    content.update(file.relative).update("\0").update(file.digest).update("\n");
    modeBound.update(file.relative).update("\0").update(file.mode).update("\0").update(file.digest).update("\n");
  }
  return {
    files,
    directories,
    bytes,
    contentSha256: content.digest("hex"),
    modeSha256: modeBound.digest("hex"),
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function processGroupExists(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function assertDeadTwice(runtime) {
  for (let observation = 0; observation < 2; observation += 1) {
    if (
      processExists(runtime.failed_supervisor_pid) ||
      processExists(runtime.failed_child_pid) ||
      processGroupExists(runtime.failed_child_pgid)
    ) {
      throw new Error("failed r8 runner process or process group is still alive");
    }
    if (observation === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function validateRunnerFree(status) {
  exactKeys(status, [
    "state", "schema_version", "owner", "run_id", "supervisor_pid", "supervisor_alive",
    "child_pid", "child_pgid", "child_alive", "acquired_at", "outputs", "reap_in_progress",
  ], "runner free status");
  if (
    status.state !== "free" || status.schema_version !== 2 || status.owner !== null ||
    status.run_id !== null || status.supervisor_pid !== null || status.supervisor_alive !== null ||
    status.child_pid !== null || status.child_pgid !== null || status.child_alive !== null ||
    status.acquired_at !== null || !equalJson(status.outputs, []) || status.reap_in_progress !== false
  ) {
    throw new Error("Mickey runner is not exactly free");
  }
}

function validateSemanticFailure(index, quarantine, pending) {
  const state = JSON.parse(quarantine.state);
  const verdict = JSON.parse(quarantine.verdict);
  const abort = JSON.parse(quarantine.abort);
  const cleanup = JSON.parse(quarantine.cleanup);
  if (
    state.run_id !== index.activation.run_id || state.status !== "aborted" ||
    state.evidence_eligible !== false || state.abort_reason !== "reaper ledger is locked by live PID 96440" ||
    state.pairs?.[index.record.pair_id]?.phase !== "create" ||
    state.pairs[index.record.pair_id].error !==
      "RunPod create transport failed before a trustworthy response: fanout stopping before command launch" ||
    verdict.run_id !== index.activation.run_id || verdict.transport_status !== "aborted" ||
    verdict.policy_audit_status !== "not_completed" || verdict.evidence_eligible !== false ||
    verdict.reason !== "reaper ledger is locked by live PID 96440" ||
    abort.run_id !== index.activation.run_id || abort.reason !== "supervised_command_exit_1" ||
    abort.quarantined_path !== index.quarantine.path || abort.evidence_eligible !== false ||
    cleanup.record_id !== index.record.record_id || cleanup.state !== "pending" ||
    cleanup.outcome !== "exact_generated_name_not_currently_observed" ||
    cleanup.external_deadline_cleanup_required !== true
  ) {
    throw new Error("quarantined r8 verdict does not prove the pinned pre-POST failure");
  }
  for (const [field, value] of Object.entries({
    record_id: index.record.record_id,
    run_id: index.record.run_id,
    manifest_sha256: index.record.manifest_sha256,
    deadline: index.record.deadline,
    ownership_kind: index.record.ownership_kind,
    name_prefix: index.record.name_prefix,
    name_nonce: index.record.name_nonce,
    expected_name: index.record.expected_name,
    preexisting_snapshot_sha256: index.record.preexisting_snapshot_sha256,
    created_at: index.record.created_at,
  })) {
    if (pending[field] !== value) throw new Error(`quarantined pending record ${field} drifted`);
  }
  if (
    pending.state !== "pending" || pending.preexisting_ids?.length !== index.record.preexisting_count ||
    pending.pod_id !== null || pending.active_binding_sha256 !== null || pending.bound_at !== null ||
    pending.retired_at !== null || pending.terminal_reason !== null || pending.last_error !== null ||
    pending.events?.length !== 1 || pending.events[0].type !== index.record.initial_event_type ||
    pending.events[0].at !== index.record.created_at
  ) {
    throw new Error("quarantined pending record is not the exact unbound sentinel");
  }
}

function validateArgvAudit(index, inventory) {
  const argvFiles = inventory.files.filter(({ relative }) => (
    relative.startsWith("command-logs/") && relative.endsWith(".argv.json")
  ));
  const aggregate = createHash("sha256");
  const counts = { runner: 0, launchctl: 0, list: 0 };
  for (const file of argvFiles) {
    aggregate.update(file.relative).update("\0").update(file.digest).update("\n");
    const value = JSON.parse(file.body);
    if (
      value.redaction_count !== 0 || value.stdin_provided !== false || value.stdin_byte_count !== 0 ||
      !Array.isArray(value.args)
    ) {
      throw new Error("r8 argv artifact has an unexpected execution shape");
    }
    const joined = value.args.join(" ");
    if (value.command === index.runtime.runner_lease_path && joined === "status --json") counts.runner += 1;
    else if (value.command === "/bin/launchctl" && value.args[0] === "print") counts.launchctl += 1;
    else if (
      value.command === index.runtime.runpodctl_path &&
      equalJson(value.args, ["pod", "list", "-a", "-o", "json"])
    ) counts.list += 1;
    else throw new Error("r8 argv inventory contains an unapproved command");
    if (/\b(create|delete|get)\b/.test(joined) || /\b(ssh|scp)\b/.test(value.command)) {
      throw new Error("r8 argv inventory contains a forbidden mutation or transport command");
    }
  }
  if (
    argvFiles.length !== index.command_audit.argv_artifact_count ||
    aggregate.digest("hex") !== index.command_audit.argv_inventory_sha256 ||
    counts.runner !== 1 || counts.launchctl !== 1 || counts.list !== 6 ||
    inventory.files.some(({ relative }) => /pod-create|pod-delete|pod-get|ssh|scp/.test(relative))
  ) {
    throw new Error("r8 command audit does not prove zero provider POST");
  }
}

function canonicalSnapshot(records) {
  return [...records]
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function observeExactProviderBaseline(client, baseline, expectedName) {
  for (let observation = 0; observation < 2; observation += 1) {
    const current = canonicalSnapshot(await client.listAll());
    if (!equalJson(current, baseline) || current.some(({ name }) => name === expectedName)) {
      throw new Error("provider inventory does not equal the exact 20-pod r8 baseline");
    }
    if (observation === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function writeExactReceipt(filePath, bytes) {
  const parent = path.dirname(filePath);
  if (await realpath(parent) !== parent) throw new Error("recovery receipt parent must be canonical");
  const temporary = `${filePath}.part-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, filePath);
    let directoryHandle;
    try {
      directoryHandle = await open(parent, fsConstants.O_RDONLY);
      await directoryHandle.sync();
    } finally {
      await directoryHandle?.close();
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function auditPinnedR8Quarantine(index) {
  const inventory = await inventoryTree(index.quarantine.path);
  if (
    inventory.files.length !== index.quarantine.regular_file_count ||
    inventory.directories !== index.quarantine.directory_count ||
    inventory.bytes !== index.quarantine.byte_count ||
    inventory.contentSha256 !== index.quarantine.content_inventory_sha256 ||
    inventory.modeSha256 !== index.quarantine.mode_inventory_sha256
  ) {
    throw new Error("r8 quarantine inventory differs from the complete pinned hash boundary");
  }
  const byPath = new Map(inventory.files.map((file) => [file.relative, file]));
  for (const file of inventory.files) file.body = await readFile(file.absolute, "utf8");
  const required = {
    state: ["state.json", index.quarantine.state_sha256],
    verdict: ["evidence/run-verdict.json", index.quarantine.verdict_sha256],
    abort: ["runner-abort-receipt.json", index.quarantine.runner_abort_sha256],
    events: ["evidence/events.jsonl", index.quarantine.events_sha256],
    pending: [index.quarantine.pending_record_copy, index.quarantine.pending_record_copy_sha256],
    cleanup: [index.quarantine.failure_cleanup_copy, index.quarantine.failure_cleanup_copy_sha256],
  };
  const bodies = {};
  for (const [label, [relative, digest]] of Object.entries(required)) {
    const file = byPath.get(relative);
    if (!file || file.digest !== digest) throw new Error(`r8 quarantine ${label} hash drifted`);
    bodies[label] = file.body;
  }
  const pending = JSON.parse(bodies.pending);
  validateSemanticFailure(index, bodies, pending);
  validateArgvAudit(index, inventory);
  return { pending, baseline: canonicalSnapshot(JSON.parse(byPath.get("control/preexisting-pods.json").body)) };
}

export async function recoverExactR8PrePostCreate() {
  if (await realpath(INDEX_PATH) !== INDEX_PATH || await sha256File(INDEX_PATH) !== INDEX_SHA256) {
    throw new Error("exact r8 failure evidence index hash drifted");
  }
  if (await realpath(RECEIPT_TEMPLATE_PATH) !== RECEIPT_TEMPLATE_PATH) {
    throw new Error("exact recovery receipt template path drifted");
  }
  const receiptBytes = await readFile(RECEIPT_TEMPLATE_PATH);
  if (sha256(receiptBytes) !== RECEIPT_SHA256) throw new Error("recovery receipt template hash drifted");
  const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
  const existingReceipt = await lstat(index.runtime.recovery_receipt_path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (
    existingReceipt &&
    (!existingReceipt.isFile() || existingReceipt.isSymbolicLink() ||
      (existingReceipt.mode & 0o777) !== 0o600 ||
      await realpath(index.runtime.recovery_receipt_path) !== index.runtime.recovery_receipt_path ||
      await sha256File(index.runtime.recovery_receipt_path) !== RECEIPT_SHA256)
  ) {
    throw new Error("existing r8 recovery receipt is not the exact completed receipt");
  }

  const { pending, baseline } = await auditPinnedR8Quarantine(index);
  if (
    baseline.length !== index.record.preexisting_count ||
    baseline.some(({ name }) => name === index.record.expected_name)
  ) {
    throw new Error("quarantined provider baseline does not prove exact-name absence");
  }
  if (
    await sha256File(index.runtime.runner_lease_path) !== index.activation.runner_lease_sha256 ||
    await sha256File(index.runtime.runpodctl_path) !== index.runtime.runpodctl_sha256
  ) {
    throw new Error("runner lease or provider client hash drifted");
  }
  const r8Source = await runReadOnly(
    "/usr/bin/git",
    ["-C", R8_SOURCE_REPOSITORY, "show", `${index.activation.source_commit}:scripts/run-mickey-cpu-fanout.mjs`],
  );
  if (r8Source.code !== 0 || sha256(r8Source.stdout) !== index.activation.fanout_sha256) {
    throw new Error("exact r8 fanout source is unavailable or hash-drifted");
  }
  const stopping = r8Source.stdout.indexOf("fanout stopping before command launch");
  const sequence = r8Source.stdout.indexOf("const sequence = String(++this.sequence)", stopping);
  const spawning = r8Source.stdout.indexOf("spawn(command, args", sequence);
  if (!(stopping >= 0 && sequence > stopping && spawning > sequence)) {
    throw new Error("r8 source no longer proves the stopping exception precedes command spawn");
  }

  await assertDeadTwice(index.runtime);
  const runner = await runReadOnly(index.runtime.runner_lease_path, ["status", "--json"]);
  if (runner.code !== 0 || runner.stderr !== "") throw new Error("runner free check failed");
  validateRunnerFree(JSON.parse(runner.stdout));

  const client = new RunpodctlClient(index.runtime.runpodctl_path);
  await observeExactProviderBaseline(client, baseline, index.record.expected_name);
  const transition = await blockExactPendingPrePostCreate({
    ledgerPath: index.runtime.ledger_path,
    client,
    expected: pending,
    expectedProviderSnapshot: baseline,
    recoveryEvidenceSha256: INDEX_SHA256,
    retryOptions: { delays: [0], sleep: async () => {} },
  });
  if (
    transition.record.state !== "blocked" ||
    transition.record.terminal_reason !== "pre_post_create_not_invoked" ||
    transition.record.pod_id !== null ||
    transition.record.active_binding_sha256 !== null ||
    transition.record.last_error !== null ||
    transition.record.events.at(-1)?.type !== "pre_post_create_not_invoked" ||
    transition.record.events.at(-1)?.recovery_evidence_sha256 !== INDEX_SHA256 ||
    transition.provider_pod_count !== 20 ||
    transition.provider_snapshot_sha256 !== index.record.preexisting_snapshot_sha256 ||
    transition.other_records_unchanged !== true
  ) {
    throw new Error("exact r8 ledger recovery did not produce the sole allowed blocked record");
  }
  const after = await readReaperLedger(index.runtime.ledger_path);
  if (
    after.records.filter(({ state }) => state === "pending").length !== 0 ||
    after.records.filter(({ state }) => state === "active").length !== 0 ||
    after.records.filter(({ state }) => state === "blocked").length !== 1 ||
    after.records.find(({ state }) => state === "blocked")?.record_id !== index.record.record_id
  ) {
    throw new Error("post-recovery ledger does not have zero pending/active and one exact blocked sentinel");
  }
  if (!existingReceipt) await writeExactReceipt(index.runtime.recovery_receipt_path, receiptBytes);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    record_id: index.record.record_id,
    state: "blocked",
    terminal_reason: "pre_post_create_not_invoked",
    receipt_path: index.runtime.recovery_receipt_path,
    receipt_sha256: RECEIPT_SHA256,
  })}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/recover-mickey-r8-pre-post-create.mjs --apply-exact-r8-recovery

This command is intentionally one-shot. It performs three provider LIST reads,
zero creates, and zero deletes; then it changes only the exact pinned r8 pending
record to terminal blocked after every local/process/provider check passes.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    usage();
  } else if (process.argv.length === 3 && process.argv[2] === "--apply-exact-r8-recovery") {
    recoverExactR8PrePostCreate().catch((error) => {
      process.stderr.write(`MICKEY_R8_RECOVERY_BLOCKED: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  } else {
    usage();
    process.exitCode = 2;
  }
}
