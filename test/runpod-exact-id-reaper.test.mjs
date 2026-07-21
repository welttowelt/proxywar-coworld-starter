import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ReaperIdentityRefusalError,
  ReaperProviderError,
  blockExactPendingPrePostCreate,
  blockPendingBeforeProviderPost,
  bindActivePod,
  bindActivePodR9,
  confirmOwnedPodAbsent,
  confirmOwnedPodAbsentR9,
  ensureReaperLedger,
  isStructuredProviderNotFound,
  preparePendingCreate,
  preparePendingCreateR9,
  readReaperLedger,
  reaperLedgerDigest,
  reconcilePendingCreateR9,
  runReaperOnce,
  verifyPendingNameAbsentR9,
  writeProviderHeartbeat,
} from "../scripts/runpod-exact-id-reaper.mjs";

const MANIFEST_SHA = "a".repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function assertLedgerUnlocked(ledgerPath) {
  await assert.rejects(
    lstat(`${ledgerPath}.lock`),
    (error) => error?.code === "ENOENT",
  );
}

test("structured not-found classifier uses the final HTTP marker and rejects nested 404 text in a 502", () => {
  const notFound = JSON.stringify({
    error: 'failed to get pod: api error: {"error":"pod not found","status":404}\\n (status 404)',
  });
  const duplicate = JSON.stringify({
    error: 'api error: {"error":"pod not found","status":404}\\n (status 404)',
  });
  assert.equal(isStructuredProviderNotFound("", `${notFound}\nUsage: runpodctl pod get\n${duplicate}\n`), true);

  const adversarial502 = JSON.stringify({
    error: "failed to get pod: status 502; upstream text contained status 404 (status 502)",
  });
  assert.equal(isStructuredProviderNotFound("", adversarial502), false);
  assert.equal(isStructuredProviderNotFound("", "pod not found status 404"), false);
  assert.equal(isStructuredProviderNotFound("", `${notFound}\n${adversarial502}`), false);
});

test("service-context heartbeat performs a provider list but records only a sanitized count", async (t) => {
  const fx = await fixture(t, {
    pods: [
      { id: "secret-id-a", name: "storm-private-a" },
      { id: "secret-id-b", name: "unrelated-private-b" },
    ],
  });
  const heartbeatPath = path.join(fx.root, "provider-heartbeat.json");
  const heartbeat = await writeProviderHeartbeat({
    heartbeatPath,
    ledgerPath: fx.ledgerPath,
    runpodctlPath: "/private/tmp/pinned-runpodctl",
    client: fx.client,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  assert.equal(heartbeat.status, "provider_list_succeeded");
  assert.equal(heartbeat.pod_count, 2);
  assert.equal(heartbeat.identifiers_recorded, false);
  assert.equal((await stat(heartbeatPath)).mode & 0o777, 0o600);
  const serialized = await readFile(heartbeatPath, "utf8");
  assert.doesNotMatch(serialized, /secret-id|storm-private|unrelated-private/);
  assert.doesNotMatch(serialized, /api[-_]?key|authorization|bearer/i);
});

test("service startup materializes an empty durable 0600 ledger", async (t) => {
  const fx = await fixture(t);
  const ledger = await ensureReaperLedger({ ledgerPath: fx.ledgerPath, clock: fx.clock });
  assert.equal(ledger.records.length, 0);
  assert.equal((await stat(fx.ledgerPath)).mode & 0o777, 0o600);
});

test("exact pre-POST recovery blocks only the sole pinned unbound record", async (t) => {
  const baseline = [{ id: "existing-a", name: "unrelated-existing" }];
  const fx = await fixture(t, { pods: baseline });
  const historical = await prepare(fx, {
    randomBytesFn: () => Buffer.from("44".repeat(16), "hex"),
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000044",
  });
  fx.client.add({ id: "historical-owned", name: historical.expected_name });
  await bind(fx, historical, "historical-owned");
  fx.client.pods.delete("historical-owned");
  await confirmOwnedPodAbsent({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    recordId: historical.record_id,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  const pending = await prepare(fx, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000001",
  });
  fx.state.now += 1_000;
  await runReaperOnce(fx);
  const before = await readReaperLedger(fx.ledgerPath);
  const historicalBefore = JSON.stringify(before.records[0]);
  assert.equal(before.records[1].events.at(-1).type, "pending_name_absent");

  const recovered = await blockExactPendingPrePostCreate({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    expected: pending,
    expectedProviderSnapshot: baseline,
    recoveryEvidenceSha256: "b".repeat(64),
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  assert.equal(recovered.record.state, "blocked");
  assert.equal(recovered.record.terminal_reason, "pre_post_create_not_invoked");
  assert.equal(recovered.record.pod_id, null);
  assert.equal(recovered.record.events.at(-1).type, "pre_post_create_not_invoked");
  assert.equal(recovered.record.events.at(-1).recovery_evidence_sha256, "b".repeat(64));
  assert.equal(recovered.provider_pod_count, 1);
  assert.equal(recovered.other_records_unchanged, true);
  assert.equal(fx.client.calls.some(({ method }) => method === "delete"), false);
  const after = await readReaperLedger(fx.ledgerPath);
  assert.equal(JSON.stringify(after.records[0]), historicalBefore);
  const revisionAfterFirstRecovery = after.revision;
  const repeated = await blockExactPendingPrePostCreate({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    expected: pending,
    expectedProviderSnapshot: baseline,
    recoveryEvidenceSha256: "b".repeat(64),
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  assert.equal(repeated.already_recovered, true);
  assert.equal(repeated.ledger_revision, revisionAfterFirstRecovery);
  assert.equal((await readReaperLedger(fx.ledgerPath)).revision, revisionAfterFirstRecovery);
});

test("pre-POST recovery rejects inventory drift, exact-name presence, and a second nonterminal", async (t) => {
  for (const fault of ["inventory", "exact-name", "second-record"]) {
    const baseline = [{ id: "existing-a", name: "unrelated-existing" }];
    const fx = await fixture(t, { pods: baseline });
    const pending = await prepare(fx, {
      randomUUIDFn: () => `00000000-0000-4000-8000-00000000000${fault.length % 10}`,
    });
    fx.state.now += 1_000;
    await runReaperOnce(fx);
    if (fault === "inventory") fx.client.add({ id: "unexpected", name: "unrelated-new" });
    if (fault === "exact-name") fx.client.add({ id: "unexpected", name: pending.expected_name });
    if (fault === "second-record") {
      await preparePendingCreate({
        ledgerPath: fx.ledgerPath,
        client: fx.client,
        runId: "second-pending",
        manifestSha256: MANIFEST_SHA,
        deadline: new Date(fx.state.now + 60_000).toISOString(),
        namePrefix: "proxywar-mickey-test",
        clock: fx.clock,
        randomBytesFn: () => Buffer.from("33".repeat(16), "hex"),
        randomUUIDFn: () => "00000000-0000-4000-8000-000000000099",
        retryOptions: fx.retryOptions,
      });
    }
    await assert.rejects(
      blockExactPendingPrePostCreate({
        ledgerPath: fx.ledgerPath,
        client: fx.client,
        expected: pending,
        expectedProviderSnapshot: baseline,
        recoveryEvidenceSha256: "c".repeat(64),
        clock: fx.clock,
        retryOptions: fx.retryOptions,
      }),
      ReaperIdentityRefusalError,
    );
    const after = await readReaperLedger(fx.ledgerPath);
    assert.equal(after.records.find(({ record_id }) => record_id === pending.record_id).state, "pending");
    assert.equal(fx.client.calls.some(({ method }) => method === "delete"), false);
  }
});

test("r9 local pre-provider block terminalizes only the exact pending record with zero provider calls", async (t) => {
  const baseline = [{ id: "existing-a", name: "unrelated-existing" }];
  const fx = await fixture(t, { pods: baseline });
  const historical = await prepare(fx, {
    runId: "historical-run",
    randomBytesFn: () => Buffer.from("44".repeat(16), "hex"),
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000044",
  });
  fx.client.add({ id: "historical-owned", name: historical.expected_name });
  await bind(fx, historical, "historical-owned");
  fx.client.pods.delete("historical-owned");
  await confirmOwnedPodAbsent({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    recordId: historical.record_id,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  const pending = await prepare(fx, {
    runId: "mickey-screen-g000-r9b-20260721t063347z:grow-opening-asia-s0-c",
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000009",
  });
  const before = await readReaperLedger(fx.ledgerPath);
  const unrelatedBefore = JSON.stringify(
    before.records.find(({ record_id }) => record_id === historical.record_id),
  );
  const providerCallsBefore = fx.client.calls.length;
  fx.state.now += 1_000;
  const blocked = await blockPendingBeforeProviderPost({
    ledgerPath: fx.ledgerPath,
    expected: pending,
    clock: fx.clock,
  });
  assert.equal(blocked.provider_calls, 0);
  assert.equal(blocked.other_records_unchanged, true);
  assert.equal(blocked.record.state, "blocked");
  assert.equal(blocked.record.terminal_reason, "pre_post_create_not_invoked");
  assert.equal(blocked.record.pod_id, null);
  assert.equal(blocked.record.active_binding_sha256, null);
  assert.equal(blocked.record.events.at(-1).type, "pre_post_create_not_invoked");
  assert.equal(fx.client.calls.length, providerCallsBefore);
  const after = await readReaperLedger(fx.ledgerPath);
  assert.equal(
    JSON.stringify(after.records.find(({ record_id }) => record_id === historical.record_id)),
    unrelatedBefore,
  );
});

class FakeRunPodClient {
  constructor(pods = []) {
    this.pods = new Map(pods.map((pod) => [pod.id, { ...pod }]));
    this.calls = [];
    this.failures = { listAll: 0, get: 0, delete: 0 };
    this.keepAfterDelete = 0;
  }

  fail(method, count) {
    this.failures[method] = count;
  }

  add(pod) {
    this.pods.set(pod.id, { ...pod });
  }

  rename(id, name) {
    this.pods.get(id).name = name;
  }

  async listAll() {
    this.calls.push({ method: "listAll" });
    if (this.failures.listAll > 0) {
      this.failures.listAll -= 1;
      throw new Error("injected list failure");
    }
    return [...this.pods.values()].map((pod) => ({ ...pod }));
  }

  async get(id) {
    this.calls.push({ method: "get", id });
    if (this.failures.get > 0) {
      this.failures.get -= 1;
      throw new Error("injected get failure");
    }
    const pod = this.pods.get(id);
    return pod ? { ...pod } : null;
  }

  async delete(id) {
    this.calls.push({ method: "delete", id });
    if (this.failures.delete > 0) {
      this.failures.delete -= 1;
      throw new Error("injected delete failure");
    }
    if (!this.pods.has(id)) return { status: "already_absent" };
    if (this.keepAfterDelete > 0) this.keepAfterDelete -= 1;
    else this.pods.delete(id);
    return { status: "delete_acknowledged" };
  }
}

function noWaitRetries() {
  return {
    delays: [0, 0, 0, 0, 0, 0, 0],
    sleep: async () => {},
  };
}

async function fixture(t, { pods = [], now = Date.UTC(2026, 6, 21, 1, 0, 0) } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "proxywar-reaper-test-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const state = { now };
  return {
    root,
    ledgerPath: path.join(root, "reaper-ledger.json"),
    client: new FakeRunPodClient(pods),
    state,
    clock: () => state.now,
    retryOptions: noWaitRetries(),
  };
}

async function prepare(fx, overrides = {}) {
  return preparePendingCreate({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    runId: overrides.runId || "mickey-test-run",
    manifestSha256: MANIFEST_SHA,
    deadline: overrides.deadline || new Date(fx.state.now + 60_000).toISOString(),
    namePrefix: overrides.namePrefix || "proxywar-mickey-test",
    clock: fx.clock,
    randomBytesFn: overrides.randomBytesFn || (() => Buffer.from("11".repeat(16), "hex")),
    randomUUIDFn: overrides.randomUUIDFn || (() => "00000000-0000-4000-8000-000000000001"),
    retryOptions: fx.retryOptions,
  });
}

async function bind(fx, record, podId) {
  return bindActivePod({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    recordId: record.record_id,
    podId,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
}

async function prepareR9(fx, overrides = {}) {
  const ledger = await readReaperLedger(fx.ledgerPath);
  return preparePendingCreateR9({
    ledgerPath: fx.ledgerPath,
    client: overrides.client || fx.client,
    runId: overrides.runId ||
      "mickey-screen-g000-r9b-20260721t063347z:grow-opening-asia-s0-c",
    manifestSha256: MANIFEST_SHA,
    deadline: new Date(fx.state.now + 60_000).toISOString(),
    expectedLedgerRevision: ledger.revision,
    expectedLedgerDigest: reaperLedgerDigest(ledger),
    namePrefix: "proxywar-mickey-test",
    clock: fx.clock,
    randomBytesFn: overrides.randomBytesFn || (() => Buffer.from("77".repeat(16), "hex")),
    randomUUIDFn: overrides.randomUUIDFn ||
      (() => "00000000-0000-4000-8000-000000000077"),
    retryOptions: fx.retryOptions,
  });
}

test("r9 prepare and immediate name check keep provider LIST outside the lock and fail closed on drift", async (t) => {
  const fx = await fixture(t);
  await ensureReaperLedger({ ledgerPath: fx.ledgerPath, clock: fx.clock });
  const boundary = await readReaperLedger(fx.ledgerPath);
  const listEntered = deferred();
  const listRelease = deferred();
  const r9Client = new FakeRunPodClient();
  const originalList = r9Client.listAll.bind(r9Client);
  r9Client.listAll = async () => {
    listEntered.resolve();
    await listRelease.promise;
    return originalList();
  };
  const registering = preparePendingCreateR9({
    ledgerPath: fx.ledgerPath,
    client: r9Client,
    runId: "mickey-screen-g000-r9b-20260721t063347z:grow-opening-asia-s0-c",
    manifestSha256: MANIFEST_SHA,
    deadline: new Date(fx.state.now + 60_000).toISOString(),
    expectedLedgerRevision: boundary.revision,
    expectedLedgerDigest: reaperLedgerDigest(boundary),
    namePrefix: "proxywar-mickey-test",
    clock: fx.clock,
    randomBytesFn: () => Buffer.from("71".repeat(16), "hex"),
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000071",
    retryOptions: fx.retryOptions,
  });
  await listEntered.promise;
  await assertLedgerUnlocked(fx.ledgerPath);
  await prepare(fx, {
    runId: "concurrent-ledger-mutation",
    randomBytesFn: () => Buffer.from("72".repeat(16), "hex"),
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000072",
  });
  await assertLedgerUnlocked(fx.ledgerPath);
  listRelease.resolve();
  await assert.rejects(registering, /ledger changed during provider discovery/);
  let ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records.some((record) => record.run_id.startsWith(
    "mickey-screen-g000-r9b-20260721t063347z:",
  )), false);

  const exact = await fixture(t);
  await ensureReaperLedger({ ledgerPath: exact.ledgerPath, clock: exact.clock });
  const pending = await prepareR9(exact);
  const stillPending = await reconcilePendingCreateR9({
    ledgerPath: exact.ledgerPath,
    client: exact.client,
    expected: pending,
    clock: exact.clock,
    retryOptions: exact.retryOptions,
  });
  assert.equal(stillPending.state, "pending");
  const checkEntered = deferred();
  const checkRelease = deferred();
  const exactOriginalList = exact.client.listAll.bind(exact.client);
  exact.client.listAll = async () => {
    checkEntered.resolve();
    await checkRelease.promise;
    return exactOriginalList();
  };
  const checking = verifyPendingNameAbsentR9({
    client: exact.client,
    expected: pending,
    retryOptions: exact.retryOptions,
  });
  await checkEntered.promise;
  await assertLedgerUnlocked(exact.ledgerPath);
  exact.client.add({ id: "late-exact-name", name: pending.expected_name });
  checkRelease.resolve();
  await assert.rejects(checking, /already present before provider POST/);
  const blocked = await blockPendingBeforeProviderPost({
    ledgerPath: exact.ledgerPath,
    expected: pending,
    clock: exact.clock,
  });
  assert.equal(blocked.record.state, "blocked");
  assert.equal(exact.client.calls.some(({ method }) => method === "delete"), false);
  ledger = await readReaperLedger(exact.ledgerPath);
  assert.equal(ledger.records[0].pod_id, null);
});

test("r9 bind and absence confirmation keep LIST and GET unlocked across daemon races", async (t) => {
  const fx = await fixture(t);
  await ensureReaperLedger({ ledgerPath: fx.ledgerPath, clock: fx.clock });
  const pending = await prepareR9(fx, {
    runId: "mickey-screen-g000-r9b-20260721t063347z:convert-weakest-asia-s0-c",
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000078",
  });
  const daemonClient = new FakeRunPodClient();
  const listEntered = deferred();
  const listRelease = deferred();
  const getEntered = deferred();
  const getRelease = deferred();
  const originalList = fx.client.listAll.bind(fx.client);
  const originalGet = fx.client.get.bind(fx.client);
  fx.client.listAll = async () => {
    listEntered.resolve();
    await listRelease.promise;
    return originalList();
  };
  fx.client.get = async (id) => {
    getEntered.resolve();
    await getRelease.promise;
    return originalGet(id);
  };
  const binding = bindActivePodR9({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    expected: pending,
    podId: "r9-owned-pod",
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  await listEntered.promise;
  await assertLedgerUnlocked(fx.ledgerPath);
  await runReaperOnce({
    ledgerPath: fx.ledgerPath,
    client: daemonClient,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  fx.client.add({ id: "r9-owned-pod", name: pending.expected_name });
  daemonClient.add({ id: "r9-owned-pod", name: pending.expected_name });
  listRelease.resolve();
  await getEntered.promise;
  await assertLedgerUnlocked(fx.ledgerPath);
  await runReaperOnce({
    ledgerPath: fx.ledgerPath,
    client: daemonClient,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  getRelease.resolve();
  const active = await binding;
  assert.equal(active.state, "active");
  assert.equal(active.pod_id, "r9-owned-pod");
  assert.deepEqual(
    active.events.map(({ type }) => type),
    ["pending_create_registered", "pending_name_absent", "pod_id_bound"],
  );

  fx.client.listAll = originalList;
  fx.client.get = originalGet;
  const beforePresent = JSON.stringify(await readReaperLedger(fx.ledgerPath));
  await assert.rejects(
    confirmOwnedPodAbsentR9({
      ledgerPath: fx.ledgerPath,
      client: fx.client,
      expected: active,
      clock: fx.clock,
      retryOptions: fx.retryOptions,
    }),
    ReaperProviderError,
  );
  assert.equal(JSON.stringify(await readReaperLedger(fx.ledgerPath)), beforePresent);

  fx.client.pods.delete("r9-owned-pod");
  daemonClient.pods.delete("r9-owned-pod");
  const confirmEntered = deferred();
  const confirmRelease = deferred();
  fx.client.get = async (id) => {
    confirmEntered.resolve();
    await confirmRelease.promise;
    return originalGet(id);
  };
  const confirming = confirmOwnedPodAbsentR9({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    expected: active,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  await confirmEntered.promise;
  await assertLedgerUnlocked(fx.ledgerPath);
  const daemonRetired = await confirmOwnedPodAbsent({
    ledgerPath: fx.ledgerPath,
    client: daemonClient,
    recordId: active.record_id,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  assert.equal(daemonRetired.state, "retired");
  confirmRelease.resolve();
  const retired = await confirming;
  assert.equal(retired.state, "retired");
  assert.equal(retired.pod_id, active.pod_id);
});

test("r9 reconcile keeps provider I/O unlocked and refuses a different-ID daemon bind", async (t) => {
  const fx = await fixture(t);
  await ensureReaperLedger({ ledgerPath: fx.ledgerPath, clock: fx.clock });
  const pending = await prepareR9(fx, {
    runId: "mickey-screen-g000-r9b-20260721t063347z:convert-largest-asia-s0-c",
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000079",
  });
  fx.client.add({ id: "foreground-candidate", name: pending.expected_name });
  const daemonClient = new FakeRunPodClient([
    { id: "daemon-candidate", name: pending.expected_name },
  ]);
  const getEntered = deferred();
  const getRelease = deferred();
  const originalGet = fx.client.get.bind(fx.client);
  fx.client.get = async (id) => {
    getEntered.resolve();
    await getRelease.promise;
    return originalGet(id);
  };
  const reconciling = reconcilePendingCreateR9({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    expected: pending,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  await getEntered.promise;
  await assertLedgerUnlocked(fx.ledgerPath);
  await runReaperOnce({
    ledgerPath: fx.ledgerPath,
    client: daemonClient,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  getRelease.resolve();
  await assert.rejects(reconciling, /different active pod ID/);
  const active = (await readReaperLedger(fx.ledgerPath)).records[0];
  assert.equal(active.state, "active");
  assert.equal(active.pod_id, "daemon-candidate");

  const failingClient = new FakeRunPodClient();
  failingClient.fail("get", 7);
  const beforeFailure = JSON.stringify(await readReaperLedger(fx.ledgerPath));
  await assert.rejects(
    confirmOwnedPodAbsentR9({
      ledgerPath: fx.ledgerPath,
      client: failingClient,
      expected: active,
      clock: fx.clock,
      retryOptions: fx.retryOptions,
    }),
    ReaperProviderError,
  );
  assert.equal(JSON.stringify(await readReaperLedger(fx.ledgerPath)), beforeFailure);
});

test("pending crash recovery claims one exact new name and reaps it after expiration", async (t) => {
  const fx = await fixture(t, {
    pods: [{ id: "existing-a", name: "unrelated-existing" }],
  });
  const pending = await prepare(fx);

  // The create succeeded, but the creator crashed before registering the returned ID.
  fx.client.add({ id: "new-owned-pod", name: pending.expected_name });
  fx.state.now += 120_000;

  const result = await runReaperOnce(fx);
  assert.equal(result.bound, 1);
  assert.equal(result.retired, 1);
  assert.equal(fx.client.pods.has("new-owned-pod"), false);
  assert.deepEqual(
    fx.client.calls.filter((call) => call.method === "delete"),
    [{ method: "delete", id: "new-owned-pod" }],
  );

  const ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "retired");
  assert.equal(ledger.records[0].pod_id, "new-owned-pod");
  assert.equal(ledger.records[0].terminal_reason, "deleted_and_absent");
  assert.equal((await stat(fx.ledgerPath)).mode & 0o777, 0o600);
  const serialized = await readFile(fx.ledgerPath, "utf8");
  assert.doesNotMatch(serialized, /api[-_]?key|authorization|bearer/i);
});

test("bounded retries survive transient list, get, and delete failures and verify absence", async (t) => {
  const fx = await fixture(t);
  fx.client.fail("listAll", 2);
  const pending = await prepare(fx);
  fx.client.add({ id: "transient-pod", name: pending.expected_name });

  fx.client.fail("listAll", 1);
  fx.client.fail("get", 2);
  const active = await bind(fx, pending, "transient-pod");
  assert.equal(active.state, "active");

  fx.state.now += 120_000;
  fx.client.fail("get", 2);
  fx.client.fail("delete", 2);
  const result = await runReaperOnce(fx);
  assert.equal(result.retired, 1);
  assert.equal(result.errors, 0);
  assert.equal(fx.client.pods.has("transient-pod"), false);
  assert.equal(fx.client.calls.filter((call) => call.method === "delete").length, 3);

  const deleteIndexes = fx.client.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.method === "delete")
    .map(({ index }) => index);
  for (const index of deleteIndexes) {
    assert.equal(fx.client.calls[index - 1].method, "get", "each delete retry must follow an exact-ID get");
    assert.equal(fx.client.calls[index - 1].id, "transient-pod");
  }
  assert.equal(fx.client.calls.at(-1).method, "get", "cleanup must finish with an absence GET");
});

test("exact-name collision and pre-existing IDs can never become cleanup-owned", async (t) => {
  const nonce = "22".repeat(16);
  const expectedName = `proxywar-mickey-test-${nonce}`;
  const collision = await fixture(t, {
    pods: [{ id: "preexisting-collision", name: expectedName }],
  });
  await assert.rejects(
    prepare(collision, { randomBytesFn: () => Buffer.from(nonce, "hex") }),
    ReaperIdentityRefusalError,
  );
  assert.equal(collision.client.calls.some((call) => call.method === "delete"), false);

  const preexisting = await fixture(t, {
    pods: [{ id: "preexisting-id", name: "different-before-prepare" }],
  });
  const pending = await prepare(preexisting, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000002",
  });
  preexisting.client.rename("preexisting-id", pending.expected_name);
  await assert.rejects(bind(preexisting, pending, "preexisting-id"), ReaperIdentityRefusalError);
  preexisting.state.now += 120_000;
  const result = await runReaperOnce(preexisting);
  assert.equal(result.retired, 0);
  assert.equal(preexisting.client.pods.has("preexisting-id"), true);
  assert.equal(preexisting.client.calls.some((call) => call.method === "delete"), false);
});

test("storm-* identity observed at the exact owned ID blocks deletion", async (t) => {
  const fx = await fixture(t);
  const pending = await prepare(fx);
  fx.client.add({ id: "renamed-pod", name: pending.expected_name });
  await bind(fx, pending, "renamed-pod");
  fx.client.rename("renamed-pod", "storm-protected-worker");
  fx.state.now += 120_000;

  const result = await runReaperOnce(fx);
  assert.equal(result.blocked, 1);
  assert.equal(result.retired, 0);
  assert.equal(fx.client.pods.has("renamed-pod"), true);
  assert.equal(fx.client.calls.some((call) => call.method === "delete"), false);
  const ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "blocked");
  assert.equal(ledger.records[0].terminal_reason, "identity_refusal");
});

test("an active pod remains before its deadline and is reaped only after expiration", async (t) => {
  const fx = await fixture(t);
  const pending = await prepare(fx, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000003",
  });
  fx.client.add({ id: "deadline-pod", name: pending.expected_name });
  await bind(fx, pending, "deadline-pod");

  fx.state.now += 30_000;
  const before = await runReaperOnce(fx);
  assert.equal(before.active_checked, 1);
  assert.equal(before.retired, 0);
  assert.equal(fx.client.pods.has("deadline-pod"), true);
  assert.equal(fx.client.calls.some((call) => call.method === "delete"), false);

  fx.state.now += 31_000;
  const after = await runReaperOnce(fx);
  assert.equal(after.retired, 1);
  assert.equal(fx.client.pods.has("deadline-pod"), false);
});

test("a delete acknowledgement without final absence never retires the record", async (t) => {
  const fx = await fixture(t);
  const pending = await prepare(fx, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000004",
  });
  fx.client.add({ id: "sticky-pod", name: pending.expected_name });
  await bind(fx, pending, "sticky-pod");
  fx.state.now += 120_000;
  fx.client.keepAfterDelete = 20;

  const result = await runReaperOnce(fx);
  assert.equal(result.retired, 0);
  assert.equal(result.errors, 1);
  assert.equal(fx.client.pods.has("sticky-pod"), true);
  const ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "active");
  assert.match(ledger.records[0].last_error, /verified absence/);
});

test("pre-deadline normal cleanup becomes terminal only after exact bound ID is absent", async (t) => {
  const fx = await fixture(t);
  const pending = await prepare(fx, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000005",
  });
  fx.client.add({ id: "normally-cleaned-pod", name: pending.expected_name });
  await bind(fx, pending, "normally-cleaned-pod");

  await assert.rejects(
    confirmOwnedPodAbsent({
      ledgerPath: fx.ledgerPath,
      client: fx.client,
      recordId: pending.record_id,
      clock: fx.clock,
      retryOptions: fx.retryOptions,
    }),
    ReaperProviderError,
  );
  let ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "active");
  assert.match(ledger.records[0].last_error, /remains present/);

  fx.client.pods.delete("normally-cleaned-pod");
  const retired = await confirmOwnedPodAbsent({
    ledgerPath: fx.ledgerPath,
    client: fx.client,
    recordId: pending.record_id,
    clock: fx.clock,
    retryOptions: fx.retryOptions,
  });
  assert.equal(retired.state, "retired");
  assert.equal(retired.terminal_reason, "normal_cleanup_confirmed_absent");
  ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "retired");
});

test("normal cleanup absence confirmation blocks on exact-ID name drift", async (t) => {
  const fx = await fixture(t);
  const pending = await prepare(fx, {
    randomUUIDFn: () => "00000000-0000-4000-8000-000000000006",
  });
  fx.client.add({ id: "identity-drift-pod", name: pending.expected_name });
  await bind(fx, pending, "identity-drift-pod");
  fx.client.rename("identity-drift-pod", "storm-protected-drift");

  await assert.rejects(
    confirmOwnedPodAbsent({
      ledgerPath: fx.ledgerPath,
      client: fx.client,
      recordId: pending.record_id,
      clock: fx.clock,
      retryOptions: fx.retryOptions,
    }),
    ReaperIdentityRefusalError,
  );
  const ledger = await readReaperLedger(fx.ledgerPath);
  assert.equal(ledger.records[0].state, "blocked");
  assert.equal(ledger.records[0].terminal_reason, "identity_refusal");
  assert.equal(fx.client.calls.some((call) => call.method === "delete"), false);
});
