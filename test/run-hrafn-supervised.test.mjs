import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseHrafnSupervisorArguments,
  runHrafnSupervised,
} from "../scripts/run-hrafn-supervised.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";
import { HRAFN_NEUTRAL_OPPONENT_IMAGE_ID } from
  "../scripts/create-hrafn-intent-image-receipt.mjs";
import {
  coworldGameReceiptFixture,
} from "./helpers/hrafn-intent-receipt-fixture.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SUBJECT_IMAGE = `sha256:${"a".repeat(64)}`;
const OPPONENT_IMAGE = HRAFN_NEUTRAL_OPPONENT_IMAGE_ID;

function fixturePreflight({ output, jobPath, manifestPath }) {
  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_preflight_receipt",
    campaign_id: "hrafn-intent-i1",
    verified_at: "2026-07-20T20:45:00.000Z",
    run_id: "hi1-pangaea-control",
    job: {
      id: "pangaea-control",
      order: 0,
      role: "control",
      map: "Pangaea",
      seed: 240723,
      subject_slot: 1,
      path: jobPath,
      sha256: "2".repeat(64),
    },
    campaign_jobs: [],
    source: { commit: SOURCE_COMMIT },
    image_receipt: {
      path: "/receipt.json",
      file_sha256: "3".repeat(64),
      content_sha256: "4".repeat(64),
    },
    preregistration: {
      path: "/prereg.json",
      file_sha256: "5".repeat(64),
      content_sha256: "6".repeat(64),
    },
    manifest: { path: manifestPath, sha256: "7".repeat(64) },
    images: {
      game: coworldGameReceiptFixture(),
      subject: { id: SUBJECT_IMAGE, os: "linux", architecture: "amd64" },
      opponent: { id: OPPONENT_IMAGE, os: "linux", architecture: "amd64" },
    },
    planner: {
      version: "0.32.1",
      model: "llama3:latest",
      model_digest:
        "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1",
      probe_response_sha256: "8".repeat(64),
    },
    identity_window: {
      path: "/mailbox/identity-window.json",
      message_id: "odin-hi1-identity-window",
      content_sha256: "9".repeat(64),
      file_sha256: "a".repeat(64),
      formal_approval: false,
      formal_approvals_consumed: 0,
      mailbox_head_commit: "b".repeat(40),
      mailbox_remote_commit: "b".repeat(40),
    },
    lifecycle: {
      active_order: 0,
      predecessors: [],
      pangaea_continuation: null,
    },
    identity: { player_id: HRAFN_PLAYER_ID, player_name: "K1Z Hrafn" },
    lease: {
      directory: "/lease",
      child_pid: 123,
      supervisor_pid: 100,
      acquired_at: "2026-07-20T20:44:00Z",
    },
    argv: [
      "uvx",
      "--from",
      "coworld==0.1.28",
      "coworld",
      "run-episode",
      manifestPath,
      jobPath,
      "--output-dir",
      output,
      "--episodes",
      "1",
      "--timeout-seconds",
      "3600",
      "--verify-replay",
    ],
    output: { directory: output, initial_entries: [".proxywar-runner-claim"] },
    checks: { all: true },
  };
}

function setup() {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "hrafn-supervisor-")));
  const output = path.join(directory, "output");
  mkdirSync(output);
  writeFileSync(path.join(output, ".proxywar-runner-claim"), "claim\n");
  const specPath = path.join(directory, "spec.json");
  const jobPath = path.join(directory, "job.json");
  const manifestPath = path.join(directory, "manifest.json");
  writeFileSync(jobPath, "{}\n");
  writeFileSync(manifestPath, "{}\n");
  const spec = { marker: "spec" };
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const preflight = fixturePreflight({ output, jobPath, manifestPath });
  const argv = [
    "--run-id",
    "hi1-pangaea-control",
    "--output",
    output,
    "--lease-dir",
    "/lease",
    "--preflight-spec",
    specPath,
    "--",
    ...preflight.argv,
  ];
  return { directory, output, specPath, spec, preflight, argv };
}

function fakeChild({ code = 0, signal = null } = {}) {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = (requested) => {
    child.killed = true;
    queueMicrotask(() => child.emit("exit", null, requested));
    return true;
  };
  queueMicrotask(() => child.emit("exit", code, signal));
  return child;
}

test("supervisor parser requires an absolute preflight spec and preserves full argv", () => {
  const fixture = setup();
  try {
    const parsed = parseHrafnSupervisorArguments(fixture.argv);
    assert.equal(parsed.preflightSpecPath, fixture.specPath);
    assert.deepEqual(parsed.command, fixture.preflight.argv);
    assert.throws(() => parseHrafnSupervisorArguments(
      fixture.argv.filter((value, index, all) =>
        value !== "--preflight-spec" && all[index - 1] !== "--preflight-spec"
      ),
    ), /preflight/i);
    const relative = [...fixture.argv];
    relative[relative.indexOf("--preflight-spec") + 1] = "spec.json";
    assert.throws(() => parseHrafnSupervisorArguments(relative), /absolute/i);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("supervisor binds full preflight provenance and writes an exit-zero final identity receipt", async () => {
  const fixture = setup();
  try {
    let spawnArgs = null;
    const result = await runHrafnSupervised(fixture.argv, {
      processPID: 123,
      now: (() => {
        const values = [
          new Date("2026-07-20T20:45:01.000Z"),
          new Date("2026-07-20T20:50:00.000Z"),
        ];
        return () => values.shift() ?? values.at(-1);
      })(),
      waitForLeaseChild: async () => {},
      verifyPreflight: async (spec, options) => {
        assert.deepEqual(spec, fixture.spec);
        assert.deepEqual(options.command, fixture.preflight.argv);
        return fixture.preflight;
      },
      readIdentity: () => ({
        playerID: HRAFN_PLAYER_ID,
        playerName: "K1Z Hrafn",
      }),
      spawn(command, args, options) {
        spawnArgs = { command, args, options };
        return fakeChild();
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(spawnArgs.command, "uvx");
    assert.deepEqual([spawnArgs.command, ...spawnArgs.args], fixture.preflight.argv);
    assert.equal(spawnArgs.options.env.HRAFN_RUNTIME_LANE, "hrafn");

    const receipt = JSON.parse(readFileSync(
      path.join(fixture.output, "hrafn-operational-receipt.json"),
      "utf8",
    ));
    assert.equal(receipt.schema_version, 2);
    assert.equal(receipt.state, "completed");
    assert.equal(receipt.child_exit_code, 0);
    assert.equal(receipt.supervisor_exit_code, 0);
    assert.deepEqual(receipt.command_argv, fixture.preflight.argv);
    assert.equal(receipt.bindings.source_commit, SOURCE_COMMIT);
    assert.deepEqual(receipt.bindings.job, fixture.preflight.job);
    assert.deepEqual(receipt.bindings.manifest, fixture.preflight.manifest);
    assert.deepEqual(receipt.bindings.images, fixture.preflight.images);
    assert.deepEqual(receipt.bindings.planner, fixture.preflight.planner);
    assert.deepEqual(
      receipt.bindings.identity_window,
      fixture.preflight.identity_window,
    );
    assert.deepEqual(receipt.bindings.lifecycle, fixture.preflight.lifecycle);
    assert.equal(receipt.final_identity.player_id, HRAFN_PLAYER_ID);
    assert.match(receipt.preflight_spec.file_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.preflight_receipt.file_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      readFileSync(path.join(fixture.output, "hrafn-intent-preflight-receipt.json"), "utf8"),
      `${JSON.stringify(fixture.preflight, null, 2)}\n`,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("child exit zero still fails closed when final Hrafn identity is lost", async () => {
  const fixture = setup();
  try {
    let reads = 0;
    const result = await runHrafnSupervised(fixture.argv, {
      processPID: 123,
      waitForLeaseChild: async () => {},
      verifyPreflight: async () => fixture.preflight,
      readIdentity: () => {
        reads += 1;
        if (reads === 1) {
          return { playerID: HRAFN_PLAYER_ID, playerName: "K1Z Hrafn" };
        }
        throw new Error("active identity drifted");
      },
      spawn: () => fakeChild(),
    });
    assert.equal(result.exitCode, 78);
    const receipt = JSON.parse(readFileSync(
      path.join(fixture.output, "hrafn-operational-receipt.json"),
      "utf8",
    ));
    assert.equal(receipt.child_exit_code, 0);
    assert.equal(receipt.supervisor_exit_code, 78);
    assert.equal(receipt.state, "failed");
    assert.equal(receipt.final_identity, null);
    assert.match(receipt.final_identity_error, /drifted/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("supervisor never spawns Coworld when integrated preflight fails", async () => {
  const fixture = setup();
  try {
    let spawned = false;
    await assert.rejects(runHrafnSupervised(fixture.argv, {
      processPID: 123,
      waitForLeaseChild: async () => {},
      verifyPreflight: async () => {
        throw new Error("approval missing");
      },
      spawn: () => {
        spawned = true;
        return fakeChild();
      },
    }), /approval missing/);
    assert.equal(spawned, false);
    assert.equal(
      path.join(fixture.output, "hrafn-operational-receipt.json"),
      path.join(fixture.output, "hrafn-operational-receipt.json"),
    );
    assert.throws(() => readFileSync(
      path.join(fixture.output, "hrafn-operational-receipt.json"),
    ));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
