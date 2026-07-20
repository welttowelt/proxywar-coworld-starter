import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  assertActiveHrafnPlayers,
  DEFAULT_HRAFN_LEASE_DIRECTORY,
  hrafnCoworldEnvironment,
  validateHrafnLeaseSnapshot,
} from "../hrafn-operational-context.mjs";
import {
  DEFAULT_HRAFN_MAILBOX_DIRECTORY,
  DEFAULT_HRAFN_REPO,
} from "../scripts/preflight-hrafn-intent-run.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";

function fixture(t, overrides = {}) {
  const root = mkdtempSync(`${tmpdir()}/hrafn-operational-`);
  const leaseDirectory = `${root}/runner.lock`;
  const outputDirectory = `${root}/output`;
  mkdirSync(leaseDirectory);
  mkdirSync(outputDirectory);
  const values = {
    schema_version: "2",
    owner: "hrafn",
    run_id: "operational-test",
    ready: "",
    child_pid: "123",
    child_started_at: "Mon Jul 20 12:00:00 2026",
    child_pgid: "123",
    supervisor_pid: "122",
    supervisor_started_at: "Mon Jul 20 11:59:59 2026",
    acquired_at: "2026-07-20T10:00:00Z",
    outputs: `${realpathSync(outputDirectory)}\n`,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(`${leaseDirectory}/${name}`, `${value}\n`);
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { leaseDirectory, outputDirectory };
}

test("Hrafn operational defaults follow the active host home", () => {
  assert.equal(
    DEFAULT_HRAFN_LEASE_DIRECTORY,
    path.join(homedir(), ".stormforge", "proxywar-operators", "runner.lock"),
  );
  assert.equal(DEFAULT_HRAFN_REPO, path.join(homedir(), "proxywar-k1z-hrafn"));
  assert.equal(
    DEFAULT_HRAFN_MAILBOX_DIRECTORY,
    path.join(homedir(), ".stormforge", "team-mailbox"),
  );
});

test("Hrafn can isolate Coworld credentials without moving host operations", (t) => {
  const root = mkdtempSync(`${tmpdir()}/hrafn-coworld-context-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hostHome = path.join(root, "host-home");
  const coworldHome = path.join(root, "coworld-home");
  mkdirSync(hostHome);
  mkdirSync(coworldHome);
  const environment = {
    HOME: hostHome,
    PATH: "/usr/bin:/bin",
    HRAFN_SOFTMAX_HOME: realpathSync(coworldHome),
  };

  const isolated = hrafnCoworldEnvironment(environment);
  assert.equal(isolated.HOME, realpathSync(coworldHome));
  assert.equal(isolated.PATH, environment.PATH);
  assert.equal(environment.HOME, hostHome);
  assert.deepEqual(isolated, {
    ...environment,
    HOME: realpathSync(coworldHome),
  });
  assert.equal(Object.isFrozen(isolated), true);
});

test("Hrafn Coworld identity probe rejects a missing or blank isolated home", (t) => {
  const hostHome = mkdtempSync(`${tmpdir()}/hrafn-host-home-`);
  t.after(() => rmSync(hostHome, { recursive: true, force: true }));

  assert.throws(
    () => hrafnCoworldEnvironment({ HOME: hostHome }),
    /HRAFN_SOFTMAX_HOME is required/,
  );
  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: hostHome,
      HRAFN_SOFTMAX_HOME: "   ",
    }),
    /HRAFN_SOFTMAX_HOME is required/,
  );
});

test("Hrafn Coworld identity probe rejects shared-home aliases", (t) => {
  const root = mkdtempSync(`${tmpdir()}/hrafn-home-alias-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hostHome = path.join(root, "host-home");
  const hostAlias = path.join(root, "host-alias");
  mkdirSync(hostHome);
  symlinkSync(hostHome, hostAlias);
  const canonicalHostHome = realpathSync(hostHome);

  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: canonicalHostHome,
      HRAFN_SOFTMAX_HOME: canonicalHostHome,
    }),
    /must be distinct from the normal HOME/,
  );
  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: hostAlias,
      HRAFN_SOFTMAX_HOME: canonicalHostHome,
    }),
    /must be distinct from the normal HOME/,
  );
  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: canonicalHostHome,
      HRAFN_SOFTMAX_HOME: hostAlias,
    }),
    /must be an absolute canonical directory/,
  );
});

test("Hrafn Coworld identity probe requires a canonical absolute directory", (t) => {
  const root = mkdtempSync(`${tmpdir()}/hrafn-canonical-home-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hostHome = path.join(root, "host-home");
  const coworldHome = path.join(root, "coworld-home");
  mkdirSync(hostHome);
  mkdirSync(coworldHome);

  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: hostHome,
      HRAFN_SOFTMAX_HOME: "relative",
    }),
    /must be an absolute canonical directory/,
  );
  assert.throws(
    () => hrafnCoworldEnvironment({
      HOME: hostHome,
      HRAFN_SOFTMAX_HOME: path.join(coworldHome, "..", "coworld-home"),
    }),
    /must be an absolute canonical directory/,
  );
});

test("operational context binds the launcher, supervisor, and claimed output", (t) => {
  const paths = fixture(t);
  const result = validateHrafnLeaseSnapshot({
    ...paths,
    runID: "operational-test",
    processPID: 123,
    processStart: () => " Mon  Jul 20 12:00:00 2026 ",
    supervisorStart: () => "Mon Jul 20 11:59:59 2026",
  });
  assert.equal(result.childPID, 123);
  assert.equal(result.supervisorPID, 122);
});

test("operational context rejects another lane, child, or output", (t) => {
  const wrongLane = fixture(t, { owner: "odin" });
  assert.throws(() => validateHrafnLeaseSnapshot({
    ...wrongLane,
    runID: "operational-test",
    processPID: 123,
    processStart: () => "Mon Jul 20 12:00:00 2026",
    supervisorStart: () => "Mon Jul 20 11:59:59 2026",
  }), /owner is not hrafn/);

  const wrongChild = fixture(t);
  assert.throws(() => validateHrafnLeaseSnapshot({
    ...wrongChild,
    runID: "operational-test",
    processPID: 999,
    processStart: () => "Mon Jul 20 12:00:00 2026",
    supervisorStart: () => "Mon Jul 20 11:59:59 2026",
  }), /not the recorded foreground child/);
});

test("active identity must be the one exact Hrafn player", () => {
  assert.deepEqual(assertActiveHrafnPlayers([
    { id: HRAFN_PLAYER_ID, name: "K1Z Hrafn", active: true },
    { id: "ply_odin", name: "K1Z odin free", active: false },
  ]), {
    playerID: HRAFN_PLAYER_ID,
    playerName: "K1Z Hrafn",
  });
  assert.throws(() => assertActiveHrafnPlayers([
    { id: "ply_odin", name: "K1Z odin free", active: true },
  ]), /not exactly K1Z Hrafn/);
});
