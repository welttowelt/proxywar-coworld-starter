import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";

import { assertHrafnHostRunnerDeclaration } from "../hrafn-runtime-guard.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";

const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function leaseFixture(overrides = {}) {
  const directory = mkdtempSync(`${tmpdir()}/hrafn-guard-`);
  const values = {
    schema_version: "2",
    owner: "hrafn",
    run_id: "guard-test",
    token,
    ready: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(`${directory}/${name}`, `${value}\n`, { mode: 0o600 });
  }
  return directory;
}

function environment(directory, overrides = {}) {
  return {
    HRAFN_RUNTIME_PLAYER_ID: HRAFN_PLAYER_ID,
    HRAFN_RUNTIME_PLAYER_NAME: "K1Z Hrafn",
    HRAFN_RUNTIME_LANE: "hrafn",
    HRAFN_RUNTIME_RUN_ID: "guard-test",
    HRAFN_RUNTIME_LEASE_TOKEN: token,
    HRAFN_RUNTIME_LEASE_DIR: directory,
    ...overrides,
  };
}

test("host declaration requires exact Hrafn fields and matching v2 lease files", (t) => {
  const directory = leaseFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const authority = assertHrafnHostRunnerDeclaration(environment(directory));
  assert.equal(authority.playerID, HRAFN_PLAYER_ID);
  assert.equal(authority.playerName, "K1Z Hrafn");
  assert.equal(authority.lane, "hrafn");
  assert.equal(authority.runID, "guard-test");
  assert.equal("token" in authority, false);
});

test("host declaration rejects Odin identity, lane, and mismatched lease data", (t) => {
  const directory = leaseFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () => assertHrafnHostRunnerDeclaration(environment(directory, {
      HRAFN_RUNTIME_PLAYER_ID:
        "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
    })),
    /identity is not Hrafn/,
  );
  assert.throws(
    () => assertHrafnHostRunnerDeclaration(environment(directory, {
      HRAFN_RUNTIME_LANE: "odin",
    })),
    /lane is not hrafn/,
  );
  assert.throws(
    () => assertHrafnHostRunnerDeclaration(environment(directory, {
      HRAFN_RUNTIME_LEASE_TOKEN:
        "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
    })),
    /lease token mismatch/,
  );
});

test("host declaration fails after its ready file disappears", (t) => {
  const directory = leaseFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = environment(directory);
  assert.doesNotThrow(() => assertHrafnHostRunnerDeclaration(env));
  rmSync(`${directory}/ready`);
  assert.throws(
    () => assertHrafnHostRunnerDeclaration(env),
    /ready/,
  );
});
