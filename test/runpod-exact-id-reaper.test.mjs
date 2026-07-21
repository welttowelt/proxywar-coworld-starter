import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ReaperIdentityRefusalError,
  bindActivePod,
  preparePendingCreate,
  readReaperLedger,
  runReaperOnce,
} from "../scripts/runpod-exact-id-reaper.mjs";

const MANIFEST_SHA = "a".repeat(64);

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
