#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hostname, uptime } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LEDGER_SCHEMA = "proxywar.runpod-exact-id-reaper-ledger.v1";
const OWNERSHIP_KIND = "generated-exact-name-v1";
const SAFE_NAME_PREFIX = "proxywar-mickey-";
const MAX_NAME_LENGTH = 63;
const EVENT_LIMIT = 256;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([0, 250, 1_000, 2_500, 5_000, 10_000, 15_000]);

export class ReaperValidationError extends Error {}
export class ReaperLedgerLockedError extends ReaperValidationError {
  constructor(ownerPid) {
    super(`reaper ledger is locked by live PID ${ownerPid}`);
    this.name = "ReaperLedgerLockedError";
    this.ownerPid = ownerPid;
  }
}
export class ReaperIdentityRefusalError extends Error {}
export class ReaperProviderError extends Error {}

function assertString(value, label, pattern, maximumLength = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    (pattern && !pattern.test(value))
  ) {
    throw new ReaperValidationError(`${label} is invalid`);
  }
  return value;
}

function normalizeNow(clock) {
  const value = clock();
  if (!Number.isFinite(value) || value < 0) {
    throw new ReaperValidationError("clock returned an invalid timestamp");
  }
  return Math.trunc(value);
}

function normalizeDeadline(value, label = "deadline") {
  const milliseconds = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new ReaperValidationError(`${label} is invalid`);
  }
  return new Date(milliseconds).toISOString();
}

function normalizePod(record, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ReaperProviderError(`${label} returned a non-object pod record`);
  }
  return {
    ...record,
    id: assertString(record.id, `${label}.id`, /^[A-Za-z0-9_-]+$/, 256),
    name: assertString(record.name, `${label}.name`, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 256),
  };
}

function normalizeSnapshot(records) {
  if (!Array.isArray(records)) {
    throw new ReaperProviderError("pre-create pod snapshot is not an array");
  }
  // Provider pod lists may include each pod's environment. The reaper only
  // needs identity, so discard every other field before the snapshot can flow
  // into ownership records, digests, heartbeats, or caller-visible results.
  const normalized = records.map((record, index) => {
    const pod = normalizePod(record, `pre-create snapshot[${index}]`);
    return { id: pod.id, name: pod.name };
  });
  const ids = new Set();
  for (const record of normalized) {
    if (ids.has(record.id)) {
      throw new ReaperProviderError(`pre-create pod snapshot repeats ID ${record.id}`);
    }
    ids.add(record.id);
  }
  return normalized;
}

function snapshotDigest(records) {
  const canonical = [...records]
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function assertNoStormName(name, label = "pod name") {
  if (name.toLowerCase().startsWith("storm-")) {
    throw new ReaperIdentityRefusalError(`${label} is protected by the storm-* boundary`);
  }
}

function validateNamePrefix(value) {
  const prefix = assertString(value, "name prefix", /^[a-z0-9][a-z0-9-]*$/, 30);
  if (!prefix.startsWith(SAFE_NAME_PREFIX) || prefix.endsWith("-")) {
    throw new ReaperValidationError(`name prefix must begin ${SAFE_NAME_PREFIX} and not end with a dash`);
  }
  assertNoStormName(prefix, "name prefix");
  return prefix;
}

function expectedNameFor(prefix, nonce) {
  const expected = `${prefix}-${nonce}`;
  if (expected.length > MAX_NAME_LENGTH) {
    throw new ReaperValidationError(`generated pod name exceeds ${MAX_NAME_LENGTH} characters`);
  }
  return expected;
}

function activeBindingDigest(record) {
  const binding = {
    pod_id: record.pod_id,
    expected_name: record.expected_name,
    run_id: record.run_id,
    manifest_sha256: record.manifest_sha256,
    deadline: record.deadline,
  };
  return createHash("sha256").update(JSON.stringify(binding)).digest("hex");
}

function assertRecordOwnership(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ReaperIdentityRefusalError("ledger record is not an object");
  }
  if (record.ownership_kind !== OWNERSHIP_KIND) {
    throw new ReaperIdentityRefusalError("ledger record has no recognized ownership proof");
  }
  const prefix = validateNamePrefix(record.name_prefix);
  const nonce = assertString(record.name_nonce, "name nonce", /^[a-f0-9]{32}$/, 32);
  const expected = expectedNameFor(prefix, nonce);
  if (record.expected_name !== expected) {
    throw new ReaperIdentityRefusalError("ledger ownership name invariant is broken");
  }
  assertNoStormName(expected, "owned pod name");
  const preexisting = new Set(record.preexisting_ids);
  if (record.pod_id !== null && preexisting.has(record.pod_id)) {
    throw new ReaperIdentityRefusalError("ledger attempts to own a pre-existing pod ID");
  }
  if (record.pod_id === null) {
    if (record.active_binding_sha256 !== null) {
      throw new ReaperIdentityRefusalError("unbound record contains an active binding digest");
    }
  } else if (record.active_binding_sha256 !== activeBindingDigest(record)) {
    throw new ReaperIdentityRefusalError("active pod/run/manifest/deadline binding is broken");
  }
  return expected;
}

function validateRecord(record, index) {
  assertString(record.record_id, `records[${index}].record_id`, /^[A-Za-z0-9._:-]+$/, 256);
  if (!["pending", "active", "retired", "blocked"].includes(record.state)) {
    throw new ReaperValidationError(`records[${index}].state is invalid`);
  }
  assertString(record.run_id, `records[${index}].run_id`, /^[A-Za-z0-9._:-]+$/, 256);
  assertString(record.manifest_sha256, `records[${index}].manifest_sha256`, /^[a-f0-9]{64}$/, 64);
  normalizeDeadline(record.deadline, `records[${index}].deadline`);
  if (!Array.isArray(record.preexisting_ids) || record.preexisting_ids.some((id) => typeof id !== "string")) {
    throw new ReaperValidationError(`records[${index}].preexisting_ids is invalid`);
  }
  if (new Set(record.preexisting_ids).size !== record.preexisting_ids.length) {
    throw new ReaperValidationError(`records[${index}].preexisting_ids contains duplicates`);
  }
  assertString(record.preexisting_snapshot_sha256, `records[${index}].preexisting_snapshot_sha256`, /^[a-f0-9]{64}$/, 64);
  if (record.pod_id !== null) {
    assertString(record.pod_id, `records[${index}].pod_id`, /^[A-Za-z0-9_-]+$/, 256);
  }
  if (record.state === "pending" && record.pod_id !== null) {
    throw new ReaperValidationError(`records[${index}] is pending with a pod ID`);
  }
  if (record.state === "active" && record.pod_id === null) {
    throw new ReaperValidationError(`records[${index}] is active without a pod ID`);
  }
  if (record.state === "retired" && record.pod_id === null) {
    throw new ReaperValidationError(`records[${index}] is retired without a pod ID`);
  }
  if (!Array.isArray(record.events)) {
    throw new ReaperValidationError(`records[${index}].events is invalid`);
  }
  assertRecordOwnership(record);
  return record;
}

function validateLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    throw new ReaperValidationError("ledger is not an object");
  }
  if (ledger.schema !== LEDGER_SCHEMA || !Number.isSafeInteger(ledger.revision) || ledger.revision < 0) {
    throw new ReaperValidationError("ledger header is invalid");
  }
  if (!Array.isArray(ledger.records)) throw new ReaperValidationError("ledger records are invalid");
  const recordIds = new Set();
  for (const [index, record] of ledger.records.entries()) {
    validateRecord(record, index);
    if (recordIds.has(record.record_id)) throw new ReaperValidationError("ledger repeats a record ID");
    recordIds.add(record.record_id);
  }
  return ledger;
}

function emptyLedger(now) {
  const timestamp = new Date(now).toISOString();
  return {
    schema: LEDGER_SCHEMA,
    revision: 0,
    created_at: timestamp,
    updated_at: timestamp,
    records: [],
  };
}

async function fsyncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function ensureLedgerParent(ledgerPath) {
  if (!path.isAbsolute(ledgerPath)) throw new ReaperValidationError("ledger path must be absolute");
  await mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
}

async function atomicWriteLedger(ledgerPath, ledger) {
  validateLedger(ledger);
  await ensureLedgerParent(ledgerPath);
  const temporary = `${ledgerPath}.part-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, ledgerPath);
    await chmod(ledgerPath, 0o600);
    await fsyncDirectory(path.dirname(ledgerPath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson0600(filePath, value) {
  await ensureLedgerParent(filePath);
  const temporary = `${filePath}.part-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readReaperLedger(ledgerPath, { allowMissing = false, clock = Date.now } = {}) {
  if (!path.isAbsolute(ledgerPath)) throw new ReaperValidationError("ledger path must be absolute");
  let info;
  try {
    info = await lstat(ledgerPath);
  } catch (error) {
    if (error?.code === "ENOENT" && allowMissing) return emptyLedger(normalizeNow(clock));
    throw error;
  }
  if (!info.isFile()) throw new ReaperValidationError("ledger is not a regular file");
  if ((info.mode & 0o777) !== 0o600) {
    throw new ReaperValidationError("ledger permissions must be exactly 0600");
  }
  let parsed;
  let handle;
  try {
    handle = await open(ledgerPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    parsed = JSON.parse(await handle.readFile("utf8"));
  } catch (error) {
    throw new ReaperValidationError(`ledger is not valid JSON: ${error.message}`);
  } finally {
    await handle?.close();
  }
  return validateLedger(parsed);
}

function bootIdentity() {
  const bootedAt = Date.now() - uptime() * 1_000;
  return `${hostname()}:${Math.floor(bootedAt / 60_000)}`;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function acquireLedgerLock(ledgerPath) {
  await ensureLedgerParent(ledgerPath);
  const lockPath = `${ledgerPath}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(
        lockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      const owner = {
        schema: "proxywar.runpod-exact-id-reaper-lock.v1",
        pid: process.pid,
        host: hostname(),
        boot: bootIdentity(),
        acquired_at: new Date().toISOString(),
      };
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return async () => {
        await unlink(lockPath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST" || attempt > 0) throw error;
      let owner;
      try {
        owner = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        throw new ReaperValidationError("reaper ledger lock exists but cannot be safely inspected");
      }
      const sameHost = owner.host === hostname();
      const sameBoot = owner.boot === bootIdentity();
      if (sameHost && sameBoot && Number.isSafeInteger(owner.pid) && processExists(owner.pid)) {
        throw new ReaperLedgerLockedError(owner.pid);
      }
      if (!sameHost) {
        throw new ReaperValidationError("reaper ledger lock belongs to another host");
      }
      await unlink(lockPath);
    }
  }
  throw new ReaperValidationError("could not acquire reaper ledger lock");
}

function equalSnapshot(left, right) {
  const canonical = (records) => [...records]
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.name.localeCompare(b.name));
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/**
 * One deliberately narrow incident-recovery transition.  This is not a
 * general way to retire pending creates: callers must independently prove
 * that the exact provider POST was never invoked and bind that proof by hash.
 */
export async function blockExactPendingPrePostCreate({
  ledgerPath,
  client,
  expected,
  expectedProviderSnapshot,
  recoveryEvidenceSha256,
  clock = Date.now,
  retryOptions,
}) {
  if (!client || typeof client.listAll !== "function") {
    throw new ReaperValidationError("recovery provider client must implement listAll");
  }
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new ReaperValidationError("exact recovery record expectation is invalid");
  }
  assertString(recoveryEvidenceSha256, "recovery evidence SHA-256", /^[a-f0-9]{64}$/, 64);
  const baseline = normalizeSnapshot(expectedProviderSnapshot);
  return withLedgerLock(ledgerPath, async () => {
    const now = normalizeNow(clock);
    const ledger = await readReaperLedger(ledgerPath);
    const nonterminal = ledger.records.filter((record) => record.state !== "retired");
    if (nonterminal.length !== 1 || nonterminal[0].record_id !== expected.record_id) {
      throw new ReaperIdentityRefusalError(
        "pre-POST recovery requires the exact record to be the sole non-retired record",
      );
    }
    const record = nonterminal[0];
    const exactFields = [
      "record_id", "run_id", "manifest_sha256", "deadline", "ownership_kind",
      "name_prefix", "name_nonce", "expected_name", "preexisting_snapshot_sha256",
      "created_at",
    ];
    for (const field of exactFields) {
      if (record[field] !== expected[field]) {
        throw new ReaperIdentityRefusalError(`pre-POST recovery ${field} differs from pinned evidence`);
      }
    }
    if (
      !["pending", "blocked"].includes(record.state) ||
      record.pod_id !== null ||
      record.active_binding_sha256 !== null ||
      record.bound_at !== null ||
      record.retired_at !== null ||
      (record.state === "pending" && record.terminal_reason !== null) ||
      (record.state === "blocked" && record.terminal_reason !== "pre_post_create_not_invoked") ||
      record.last_error !== null ||
      !Array.isArray(record.preexisting_ids) ||
      JSON.stringify(record.preexisting_ids) !== JSON.stringify(expected.preexisting_ids) ||
      snapshotDigest(baseline) !== record.preexisting_snapshot_sha256 ||
      !Array.isArray(record.events) ||
      record.events.length < (record.state === "blocked" ? 3 : 2) ||
      JSON.stringify(record.events[0]) !== JSON.stringify(expected.events[0]) ||
      record.events.slice(1, record.state === "blocked" ? -1 : undefined).some((event) => (
        !event ||
        Object.keys(event).sort().join(",") !== "at,type" ||
        event.type !== "pending_name_absent" ||
        !Number.isFinite(Date.parse(event.at))
      ))
    ) {
      throw new ReaperIdentityRefusalError("pending record is not the exact unbound r8 pre-POST sentinel");
    }

    const current = normalizeSnapshot(await retry(() => client.listAll(), retryOptions));
    if (!equalSnapshot(current, baseline)) {
      throw new ReaperIdentityRefusalError("provider inventory differs from the pinned pre-POST baseline");
    }
    if (current.some((pod) => pod.name === record.expected_name)) {
      throw new ReaperIdentityRefusalError("exact pending name is present at the provider");
    }

    if (record.state === "blocked") {
      const terminal = record.events.at(-1);
      if (
        record.terminal_reason !== "pre_post_create_not_invoked" ||
        !terminal ||
        Object.keys(terminal).sort().join(",") !==
          "at,provider_snapshot_sha256,recovery_evidence_sha256,type" ||
        terminal.type !== "pre_post_create_not_invoked" ||
        terminal.recovery_evidence_sha256 !== recoveryEvidenceSha256 ||
        terminal.provider_snapshot_sha256 !== snapshotDigest(current) ||
        record.updated_at !== terminal.at
      ) {
        throw new ReaperIdentityRefusalError("already-blocked recovery sentinel lacks the exact terminal proof");
      }
      return {
        record: structuredClone(record),
        ledger_revision: ledger.revision,
        provider_snapshot_sha256: snapshotDigest(current),
        provider_pod_count: current.length,
        other_records_unchanged: true,
        already_recovered: true,
      };
    }

    const otherBefore = ledger.records
      .filter((candidate) => candidate.record_id !== record.record_id)
      .map((candidate) => JSON.stringify(candidate));
    record.state = "blocked";
    record.terminal_reason = "pre_post_create_not_invoked";
    record.last_error = null;
    appendEvent(record, "pre_post_create_not_invoked", now, {
      recovery_evidence_sha256: recoveryEvidenceSha256,
      provider_snapshot_sha256: snapshotDigest(current),
    });
    const otherAfter = ledger.records
      .filter((candidate) => candidate.record_id !== record.record_id)
      .map((candidate) => JSON.stringify(candidate));
    if (JSON.stringify(otherAfter) !== JSON.stringify(otherBefore)) {
      throw new ReaperIdentityRefusalError("recovery changed a non-target record");
    }
    await persist(ledgerPath, ledger, now);
    return {
      record: structuredClone(record),
      ledger_revision: ledger.revision,
      provider_snapshot_sha256: snapshotDigest(current),
      provider_pod_count: current.length,
      other_records_unchanged: true,
      already_recovered: false,
    };
  });
}

async function withLedgerLock(ledgerPath, operation) {
  const release = await acquireLedgerLock(ledgerPath);
  try {
    return await operation();
  } finally {
    await release();
  }
}

function appendEvent(record, type, now, detail = {}) {
  const event = { at: new Date(now).toISOString(), type, ...detail };
  record.events = [...record.events, event].slice(-EVENT_LIMIT);
  record.updated_at = event.at;
  return event;
}

async function persist(ledgerPath, ledger, now) {
  ledger.revision += 1;
  ledger.updated_at = new Date(now).toISOString();
  await atomicWriteLedger(ledgerPath, ledger);
}

export async function ensureReaperLedger({ ledgerPath, clock = Date.now }) {
  return withLedgerLock(ledgerPath, async () => {
    const existing = await lstat(ledgerPath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (existing) return readReaperLedger(ledgerPath);
    const ledger = emptyLedger(normalizeNow(clock));
    await atomicWriteLedger(ledgerPath, ledger);
    return ledger;
  });
}

async function retry(operation, {
  delays = DEFAULT_RETRY_DELAYS_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt]);
    try {
      return await operation(attempt + 1);
    } catch (error) {
      if (error instanceof ReaperIdentityRefusalError || error instanceof ReaperValidationError) throw error;
      lastError = error;
    }
  }
  throw new ReaperProviderError(`provider operation exhausted ${delays.length} attempts: ${lastError?.message || "unknown failure"}`);
}

export function isStructuredProviderNotFound(stdout, stderr) {
  const statuses = [];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.error !== "string") continue;
    const match = parsed.error.match(/\(status\s+([1-5][0-9]{2})\)\s*$/i);
    if (match) statuses.push(Number(match[1]));
  }
  return statuses.length > 0 && statuses.every((status) => status === 404);
}

function parseProviderJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new ReaperProviderError(`${label} did not return JSON`);
  }
}

function assertNoSensitiveArg(args) {
  for (const arg of args) {
    if (/api[-_]?key|authorization|bearer/i.test(arg)) {
      throw new ReaperValidationError("provider credentials are forbidden in child-process arguments");
    }
  }
}

export class RunpodctlClient {
  constructor(runpodctlPath) {
    if (!path.isAbsolute(runpodctlPath)) {
      throw new ReaperValidationError("runpodctl path must be absolute");
    }
    this.runpodctlPath = runpodctlPath;
  }

  async #run(args) {
    assertNoSensitiveArg(args);
    return new Promise((resolve, reject) => {
      const child = spawn(this.runpodctlPath, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const maximum = 16 * 1024 * 1024;
      const collect = (target, chunk) => {
        const next = target + chunk.toString("utf8");
        if (Buffer.byteLength(next) > maximum) {
          child.kill("SIGKILL");
          throw new ReaperProviderError("runpodctl output exceeded the safety limit");
        }
        return next;
      };
      child.stdout.on("data", (chunk) => {
        try { stdout = collect(stdout, chunk); } catch (error) { reject(error); }
      });
      child.stderr.on("data", (chunk) => {
        try { stderr = collect(stderr, chunk); } catch (error) { reject(error); }
      });
      child.once("error", () => reject(new ReaperProviderError("runpodctl could not be started")));
      child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  }

  async listAll() {
    const result = await this.#run(["pod", "list", "-a", "-o", "json"]);
    if (result.code !== 0) throw new ReaperProviderError(`runpodctl pod list failed with status ${result.code}`);
    return normalizeSnapshot(parseProviderJson(result, "runpodctl pod list"));
  }

  async get(podId) {
    assertString(podId, "pod ID", /^[A-Za-z0-9_-]+$/, 256);
    const result = await this.#run([
      "pod",
      "get",
      podId,
      "--include-network-volume",
      "-o",
      "json",
    ]);
    if (result.code !== 0) {
      if (isStructuredProviderNotFound(result.stdout, result.stderr)) return null;
      throw new ReaperProviderError(`runpodctl pod get failed with status ${result.code}`);
    }
    return normalizePod(parseProviderJson(result, "runpodctl pod get"), "runpodctl pod get");
  }

  async delete(podId) {
    assertString(podId, "pod ID", /^[A-Za-z0-9_-]+$/, 256);
    const result = await this.#run(["pod", "delete", podId, "-o", "json"]);
    if (result.code !== 0) {
      if (isStructuredProviderNotFound(result.stdout, result.stderr)) return { status: "already_absent" };
      throw new ReaperProviderError(`runpodctl pod delete failed with status ${result.code}`);
    }
    return { status: "delete_acknowledged" };
  }
}

function makeRecord({
  runId,
  manifestSha256,
  deadline,
  namePrefix,
  nameNonce,
  snapshot,
  recordId,
  now,
}) {
  const timestamp = new Date(now).toISOString();
  return {
    record_id: recordId,
    state: "pending",
    run_id: assertString(runId, "run ID", /^[A-Za-z0-9._:-]+$/, 256),
    manifest_sha256: assertString(manifestSha256, "manifest SHA-256", /^[a-f0-9]{64}$/, 64),
    deadline: normalizeDeadline(deadline),
    ownership_kind: OWNERSHIP_KIND,
    name_prefix: namePrefix,
    name_nonce: nameNonce,
    expected_name: expectedNameFor(namePrefix, nameNonce),
    preexisting_ids: snapshot.map(({ id }) => id).sort(),
    preexisting_snapshot_sha256: snapshotDigest(snapshot),
    pod_id: null,
    active_binding_sha256: null,
    bound_at: null,
    retired_at: null,
    terminal_reason: null,
    last_error: null,
    created_at: timestamp,
    updated_at: timestamp,
    events: [{ at: timestamp, type: "pending_create_registered" }],
  };
}

export async function preparePendingCreate({
  ledgerPath,
  client,
  runId,
  manifestSha256,
  deadline,
  namePrefix = "proxywar-mickey-reaper",
  clock = Date.now,
  randomBytesFn = randomBytes,
  randomUUIDFn = randomUUID,
  retryOptions,
}) {
  if (!client || typeof client.listAll !== "function") {
    throw new ReaperValidationError("provider client must implement listAll");
  }
  const prefix = validateNamePrefix(namePrefix);
  return withLedgerLock(ledgerPath, async () => {
    const now = normalizeNow(clock);
    const ledger = await readReaperLedger(ledgerPath, { allowMissing: true, clock });
    const snapshot = await retry(() => client.listAll(), retryOptions);
    const normalized = normalizeSnapshot(snapshot);
    let nameNonce;
    let expectedName;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      nameNonce = randomBytesFn(16).toString("hex");
      if (!/^[a-f0-9]{32}$/.test(nameNonce)) {
        throw new ReaperValidationError("random name nonce generator returned invalid bytes");
      }
      expectedName = expectedNameFor(prefix, nameNonce);
      if (!normalized.some((pod) => pod.name === expectedName)) break;
      expectedName = null;
    }
    if (!expectedName) {
      throw new ReaperIdentityRefusalError("could not allocate an exact name absent from the pre-create snapshot");
    }
    const recordId = `mickey-reaper:${randomUUIDFn()}`;
    if (ledger.records.some((record) => record.record_id === recordId)) {
      throw new ReaperValidationError("generated record ID already exists");
    }
    const record = makeRecord({
      runId,
      manifestSha256,
      deadline,
      namePrefix: prefix,
      nameNonce,
      snapshot: normalized,
      recordId,
      now,
    });
    ledger.records.push(record);
    await persist(ledgerPath, ledger, now);
    return structuredClone(record);
  });
}

function findRecord(ledger, recordId) {
  const record = ledger.records.find((candidate) => candidate.record_id === recordId);
  if (!record) throw new ReaperValidationError(`unknown reaper record ${recordId}`);
  return record;
}

function exactNewCandidates(record, listed) {
  const expectedName = assertRecordOwnership(record);
  const preexisting = new Set(record.preexisting_ids);
  return normalizeSnapshot(listed).filter(
    (pod) => pod.name === expectedName && !preexisting.has(pod.id),
  );
}

function attestExactPod(record, pod) {
  const expectedName = assertRecordOwnership(record);
  const normalized = normalizePod(pod, "exact-ID inspection");
  if (normalized.id !== record.pod_id && record.pod_id !== null) {
    throw new ReaperIdentityRefusalError("exact-ID inspection returned a different pod ID");
  }
  if (normalized.name !== expectedName) {
    throw new ReaperIdentityRefusalError("exact-ID inspection returned a different pod name");
  }
  assertNoStormName(normalized.name, "exact-ID inspected pod");
  if (record.preexisting_ids.includes(normalized.id)) {
    throw new ReaperIdentityRefusalError("exact-ID inspected pod existed before ownership registration");
  }
  return normalized;
}

function bindRecord(record, pod, now, discovery) {
  if (record.state !== "pending") {
    if (record.state === "active" && record.pod_id === pod.id) return false;
    throw new ReaperIdentityRefusalError("only a pending ownership record can bind a pod");
  }
  if (record.preexisting_ids.includes(pod.id)) {
    throw new ReaperIdentityRefusalError("refusing to bind a pre-existing pod ID");
  }
  const provisional = { ...record, pod_id: pod.id };
  provisional.active_binding_sha256 = activeBindingDigest(provisional);
  attestExactPod(provisional, pod);
  record.pod_id = pod.id;
  record.active_binding_sha256 = provisional.active_binding_sha256;
  record.state = "active";
  record.bound_at = new Date(now).toISOString();
  record.last_error = null;
  appendEvent(record, "pod_id_bound", now, { pod_id: pod.id, discovery });
  return true;
}

export async function bindActivePod({
  ledgerPath,
  client,
  recordId,
  podId,
  clock = Date.now,
  retryOptions,
}) {
  if (!client || typeof client.listAll !== "function" || typeof client.get !== "function") {
    throw new ReaperValidationError("provider client must implement listAll and get");
  }
  return withLedgerLock(ledgerPath, async () => {
    const now = normalizeNow(clock);
    const ledger = await readReaperLedger(ledgerPath);
    const record = findRecord(ledger, recordId);
    if (record.state === "active" && record.pod_id === podId) return structuredClone(record);
    if (record.state !== "pending") {
      throw new ReaperIdentityRefusalError("record is not pending");
    }
    if (record.preexisting_ids.includes(podId)) {
      throw new ReaperIdentityRefusalError("refusing to bind a pre-existing pod ID");
    }
    const listed = await retry(() => client.listAll(), retryOptions);
    const candidates = exactNewCandidates(record, listed);
    if (candidates.length !== 1 || candidates[0].id !== podId) {
      throw new ReaperIdentityRefusalError("exact owned name does not resolve to the requested new pod ID");
    }
    const got = await retry(() => client.get(podId), retryOptions);
    if (!got) throw new ReaperIdentityRefusalError("requested pod ID is absent during bind");
    bindRecord(record, got, now, "explicit_bind");
    await persist(ledgerPath, ledger, now);
    return structuredClone(record);
  });
}

export async function confirmOwnedPodAbsent({
  ledgerPath,
  client,
  recordId,
  clock = Date.now,
  retryOptions,
}) {
  if (!client || typeof client.get !== "function") {
    throw new ReaperValidationError("provider client must implement get");
  }
  return withLedgerLock(ledgerPath, async () => {
    const now = normalizeNow(clock);
    const ledger = await readReaperLedger(ledgerPath);
    const record = findRecord(ledger, recordId);
    if (record.state === "pending") {
      throw new ReaperIdentityRefusalError("cannot confirm absence for an unbound pending record");
    }
    if (record.state === "blocked") {
      throw new ReaperIdentityRefusalError("cannot confirm absence for a blocked record");
    }
    assertRecordOwnership(record);

    let current;
    try {
      current = await retry(() => client.get(record.pod_id), retryOptions);
    } catch (error) {
      const message = safeErrorMessage(error);
      record.last_error = message;
      appendEvent(record, "normal_cleanup_absence_check_error", now, {
        pod_id: record.pod_id,
        error: message,
      });
      await persist(ledgerPath, ledger, now);
      throw error;
    }

    if (current !== null) {
      try {
        attestExactPod(record, current);
      } catch (error) {
        const message = safeErrorMessage(error);
        record.state = "blocked";
        record.terminal_reason = "identity_refusal";
        record.last_error = message;
        appendEvent(record, "normal_cleanup_identity_refusal", now, {
          pod_id: record.pod_id,
          error: message,
        });
        await persist(ledgerPath, ledger, now);
        throw error;
      }
      const error = new ReaperProviderError("exact owned pod remains present after normal cleanup");
      record.last_error = error.message;
      appendEvent(record, "normal_cleanup_pod_still_present", now, { pod_id: record.pod_id });
      await persist(ledgerPath, ledger, now);
      throw error;
    }

    record.state = "retired";
    record.retired_at ??= new Date(now).toISOString();
    record.terminal_reason = "normal_cleanup_confirmed_absent";
    record.last_error = null;
    appendEvent(record, "normal_cleanup_absence_confirmed", now, { pod_id: record.pod_id });
    await persist(ledgerPath, ledger, now);
    return structuredClone(record);
  });
}

async function finalAbsence(client, podId, retryOptions) {
  return retry(async () => {
    const current = await client.get(podId);
    if (current !== null) throw new ReaperProviderError("exact pod remains present");
    return true;
  }, retryOptions);
}

async function deleteOwnedPod(record, client, retryOptions) {
  const podId = record.pod_id;
  let acknowledged = false;
  let deletionError = null;
  try {
    await retry(async () => {
      const current = await client.get(podId);
      if (current === null) return;
      attestExactPod(record, current);
      const result = await client.delete(podId);
      acknowledged ||= result?.status === "delete_acknowledged";
    }, retryOptions);
  } catch (error) {
    deletionError = error;
  }

  try {
    await finalAbsence(client, podId, retryOptions);
    return { status: acknowledged ? "deleted_and_absent" : "confirmed_absent" };
  } catch (absenceError) {
    if (deletionError instanceof ReaperIdentityRefusalError) throw deletionError;
    throw new ReaperProviderError(
      `exact-ID cleanup did not reach verified absence: ${deletionError?.message || absenceError.message}`,
    );
  }
}

function safeErrorMessage(error) {
  if (error instanceof ReaperIdentityRefusalError) return error.message;
  if (error instanceof ReaperValidationError) return error.message;
  if (error instanceof ReaperProviderError) return error.message;
  return "unexpected reaper failure";
}

async function reconcilePending(record, client, now, retryOptions) {
  const listed = await retry(() => client.listAll(), retryOptions);
  const candidates = exactNewCandidates(record, listed);
  if (candidates.length === 0) {
    appendEvent(record, "pending_name_absent", now);
    return { changed: true, bound: false };
  }
  if (candidates.length !== 1) {
    throw new ReaperIdentityRefusalError("exact owned name resolves to multiple new pod IDs");
  }
  const got = await retry(() => client.get(candidates[0].id), retryOptions);
  if (got === null) {
    appendEvent(record, "pending_candidate_disappeared", now, { pod_id: candidates[0].id });
    return { changed: true, bound: false };
  }
  bindRecord(record, got, now, "pending_crash_recovery");
  return { changed: true, bound: true };
}

export async function runReaperOnce({
  ledgerPath,
  client,
  clock = Date.now,
  retryOptions,
}) {
  if (
    !client ||
    typeof client.listAll !== "function" ||
    typeof client.get !== "function" ||
    typeof client.delete !== "function"
  ) {
    throw new ReaperValidationError("provider client must implement listAll, get, and delete");
  }
  return withLedgerLock(ledgerPath, async () => {
    const ledger = await readReaperLedger(ledgerPath, { allowMissing: true, clock });
    const summary = {
      schema: "proxywar.runpod-exact-id-reaper-run.v1",
      started_at: new Date(normalizeNow(clock)).toISOString(),
      pending_checked: 0,
      bound: 0,
      active_checked: 0,
      retired: 0,
      blocked: 0,
      errors: 0,
    };

    for (const record of ledger.records) {
      let now = normalizeNow(clock);
      if (record.state === "pending") {
        summary.pending_checked += 1;
        try {
          const result = await reconcilePending(record, client, now, retryOptions);
          if (result.bound) summary.bound += 1;
          record.last_error = null;
          await persist(ledgerPath, ledger, now);
        } catch (error) {
          const message = safeErrorMessage(error);
          record.last_error = message;
          appendEvent(record, "pending_reconcile_error", now, { error: message });
          if (error instanceof ReaperIdentityRefusalError) {
            record.state = "blocked";
            record.terminal_reason = "identity_refusal";
            summary.blocked += 1;
          } else {
            summary.errors += 1;
          }
          await persist(ledgerPath, ledger, now);
          continue;
        }
      }

      if (record.state !== "active") continue;
      summary.active_checked += 1;
      now = normalizeNow(clock);
      if (Date.parse(record.deadline) > now) continue;

      try {
        assertRecordOwnership(record);
        appendEvent(record, "deadline_reached", now, { pod_id: record.pod_id });
        await persist(ledgerPath, ledger, now);
        const outcome = await deleteOwnedPod(record, client, retryOptions);
        now = normalizeNow(clock);
        record.state = "retired";
        record.retired_at = new Date(now).toISOString();
        record.terminal_reason = outcome.status;
        record.last_error = null;
        appendEvent(record, "final_absence_verified", now, {
          pod_id: record.pod_id,
          outcome: outcome.status,
        });
        summary.retired += 1;
        await persist(ledgerPath, ledger, now);
      } catch (error) {
        now = normalizeNow(clock);
        const message = safeErrorMessage(error);
        record.last_error = message;
        appendEvent(record, "cleanup_error", now, { pod_id: record.pod_id, error: message });
        if (error instanceof ReaperIdentityRefusalError || error instanceof ReaperValidationError) {
          record.state = "blocked";
          record.terminal_reason = "identity_refusal";
          summary.blocked += 1;
        } else {
          summary.errors += 1;
        }
        await persist(ledgerPath, ledger, now);
      }
    }

    summary.completed_at = new Date(normalizeNow(clock)).toISOString();
    summary.ledger_revision = ledger.revision;
    return summary;
  });
}

export async function pollReaper({
  ledgerPath,
  client,
  heartbeatPath = null,
  runpodctlPath = null,
  intervalSeconds = 60,
  signalState = { requested: false },
  clock = Date.now,
  retryOptions,
  onResult = () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3_600) {
    throw new ReaperValidationError("poll interval must be an integer from 5 through 3600 seconds");
  }
  await ensureReaperLedger({ ledgerPath, clock });
  while (!signalState.requested) {
    if (heartbeatPath !== null) {
      await writeProviderHeartbeat({
        heartbeatPath,
        ledgerPath,
        runpodctlPath,
        client,
        clock,
        retryOptions,
      });
    }
    const result = await runReaperOnce({ ledgerPath, client, clock, retryOptions });
    await onResult(result);
    if (!signalState.requested) await sleep(intervalSeconds * 1_000);
  }
}

export async function writeProviderHeartbeat({
  heartbeatPath,
  ledgerPath,
  runpodctlPath,
  client,
  clock = Date.now,
  retryOptions,
}) {
  if (!client || typeof client.listAll !== "function") {
    throw new ReaperValidationError("provider client must implement listAll");
  }
  if (!path.isAbsolute(heartbeatPath) || !path.isAbsolute(ledgerPath) || !path.isAbsolute(runpodctlPath)) {
    throw new ReaperValidationError("heartbeat, ledger, and runpodctl paths must be absolute");
  }
  const pods = normalizeSnapshot(await retry(() => client.listAll(), retryOptions));
  const heartbeat = {
    schema_version: 1,
    kind: "mickey_runpod_exact_id_reaper_provider_heartbeat",
    status: "provider_list_succeeded",
    probed_at: new Date(normalizeNow(clock)).toISOString(),
    pod_count: pods.length,
    ledger_path: ledgerPath,
    runpodctl_path: runpodctlPath,
    pid: process.pid,
    identifiers_recorded: false,
    credentials_recorded: false,
  };
  await atomicWriteJson0600(heartbeatPath, heartbeat);
  return heartbeat;
}

function makeInterruptibleSleep(signalState) {
  let wake = null;
  return {
    sleep(milliseconds) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, milliseconds);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    },
    requestStop() {
      signalState.requested = true;
      wake?.();
    },
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new ReaperValidationError(`unexpected argument ${token}`);
    const key = token.slice(2);
    if (/api[-_]?key|authorization|bearer/i.test(key)) {
      throw new ReaperValidationError("API credentials are forbidden in arguments");
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ReaperValidationError(`missing value for --${key}`);
    }
    if (options.has(key)) throw new ReaperValidationError(`duplicate option --${key}`);
    options.set(key, value);
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  if (!options.has(key)) throw new ReaperValidationError(`missing --${key}`);
  return options.get(key);
}

function printUsage() {
  process.stdout.write(`Usage:
  runpod-exact-id-reaper.mjs prepare --ledger ABS --runpodctl ABS --run-id ID --manifest-sha256 HEX --deadline ISO [--name-prefix proxywar-mickey-reaper]
  runpod-exact-id-reaper.mjs bind --ledger ABS --runpodctl ABS --record-id ID --pod-id ID
  runpod-exact-id-reaper.mjs confirm-absent --ledger ABS --runpodctl ABS --record-id ID
  runpod-exact-id-reaper.mjs run-once --ledger ABS --runpodctl ABS
  runpod-exact-id-reaper.mjs poll --ledger ABS --runpodctl ABS [--interval-seconds 60] [--heartbeat ABS]
  runpod-exact-id-reaper.mjs status --ledger ABS

The tool reads provider credentials only through runpodctl's normal environment/config.
Never pass an API key on the command line.\n`);
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "help") {
    printUsage();
    return;
  }
  const ledgerPath = path.resolve(required(options, "ledger"));
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(await readReaperLedger(ledgerPath, { allowMissing: true }), null, 2)}\n`);
    return;
  }
  const client = new RunpodctlClient(path.resolve(required(options, "runpodctl")));
  if (command === "prepare") {
    const record = await preparePendingCreate({
      ledgerPath,
      client,
      runId: required(options, "run-id"),
      manifestSha256: required(options, "manifest-sha256"),
      deadline: required(options, "deadline"),
      namePrefix: options.get("name-prefix") || "proxywar-mickey-reaper",
    });
    process.stdout.write(`${JSON.stringify({
      record_id: record.record_id,
      expected_name: record.expected_name,
      deadline: record.deadline,
    })}\n`);
    return;
  }
  if (command === "bind") {
    const record = await bindActivePod({
      ledgerPath,
      client,
      recordId: required(options, "record-id"),
      podId: required(options, "pod-id"),
    });
    process.stdout.write(`${JSON.stringify({
      record_id: record.record_id,
      state: record.state,
      pod_id: record.pod_id,
      expected_name: record.expected_name,
      deadline: record.deadline,
    })}\n`);
    return;
  }
  if (command === "confirm-absent") {
    const record = await confirmOwnedPodAbsent({
      ledgerPath,
      client,
      recordId: required(options, "record-id"),
    });
    process.stdout.write(`${JSON.stringify({
      record_id: record.record_id,
      state: record.state,
      pod_id: record.pod_id,
      expected_name: record.expected_name,
      terminal_reason: record.terminal_reason,
    })}\n`);
    return;
  }
  if (command === "run-once") {
    process.stdout.write(`${JSON.stringify(await runReaperOnce({ ledgerPath, client }))}\n`);
    return;
  }
  if (command === "poll") {
    const intervalSeconds = Number(options.get("interval-seconds") || "60");
    const signalState = { requested: false };
    const interrupt = makeInterruptibleSleep(signalState);
    const handler = () => interrupt.requestStop();
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    process.on("SIGHUP", handler);
    try {
      await pollReaper({
        ledgerPath,
        client,
        heartbeatPath: options.has("heartbeat") ? path.resolve(options.get("heartbeat")) : null,
        runpodctlPath: path.resolve(required(options, "runpodctl")),
        intervalSeconds,
        signalState,
        onResult: (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
        sleep: interrupt.sleep,
      });
    } finally {
      process.off("SIGINT", handler);
      process.off("SIGTERM", handler);
      process.off("SIGHUP", handler);
    }
    return;
  }
  throw new ReaperValidationError(`unknown command ${command}`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`RUNPOD_EXACT_ID_REAPER_FAILED: ${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
