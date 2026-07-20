import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  assertActiveHrafnPlayers,
  DEFAULT_HRAFN_LEASE_DIRECTORY,
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
