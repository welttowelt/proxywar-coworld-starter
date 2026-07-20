import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const wrapper = path.join(root, "scripts", "proxywar-qd1n-mutation.sh");
const ODIN = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
const HRAFN = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
const LEAGUE = "league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42";
const IMAGE = `sha256:${"a".repeat(64)}`;
const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const LABEL = "qd1n:v123";
const SERVER = "https://softmax.com/api";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function binding(file) {
  return { path: file, sha256: sha256(file) };
}

function executable(file, body) {
  writeFileSync(file, `#!/bin/zsh\nset -euo pipefail\n${body}\n`);
  chmodSync(file, 0o755);
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function localAudit(sourceCommit, parentCommit, directory) {
  const file = path.join(directory, "local-audit.json");
  const run = (orientation, replayCharacter) => ({
    orientation,
    replay_sha256: replayCharacter.repeat(64),
    coalition_roles_present: ["odin", "katanasan"],
    resolved_images: {
      images: { candidate: { image_id: IMAGE } },
    },
    candidate: {
      decision_count: 10,
      accepted: 10,
      illegal_turns: [],
      rejected_turns: [],
      fallback_turns: [],
      degradation_turns: [],
      unexplained_holds: [],
      harmful_k1z_actions: [],
      unresolved_harmful_targets: [],
      marker_counts: { od1: 2 },
      route_execution_count: 2,
    },
    orientation_advantage: { score_delta: 0.2, tile_delta: 1000 },
  });
  writeJson(file, {
    schema_version: 2,
    verdict: "PASS_LOCAL_SCREEN",
    failures: [],
    candidate_source_commit: sourceCommit,
    candidate_image_id: IMAGE,
    parent_source_commit: parentCommit,
    contract_sha256: "e".repeat(64),
    required_coalition_roles: ["katanasan"],
    differential_unit_proof: {
      same_fixture: true,
      test_exit_code: 0,
      parent: {
        source_commit: parentCommit,
        selected_action_id: "parent-action",
      },
      candidate: {
        source_commit: sourceCommit,
        selected_action_id: "candidate-action",
      },
    },
    runs: [run("A", "b"), run("B", "c")],
  });
  return binding(file);
}

function rciReceipt(sourceCommit, directory, name, { final = false } = {}) {
  const file = path.join(directory, `${name}.json`);
  writeJson(file, {
    schema_version: 1,
    verdict: final ? "PASS_RCI" : "PASS_PREUPLOAD_RCI",
    status: "passed",
    unresolved_violations: [],
    candidate_source_commit: sourceCommit,
    candidate_image_id: IMAGE,
    ...(final ? {
      candidate_policy_version_id: POLICY_ID,
      checks: {
        source_identity: true,
        image_identity: true,
        roster_identity: true,
        runtime_identity: true,
        marker_integrity: true,
        k1z_safety: true,
        outcome_identity: true,
      },
    } : {}),
  });
  return binding(file);
}

function fixture(activePlayer = ODIN) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "qd1n-mutation-"));
  const state = path.join(directory, "state");
  const receipts = path.join(directory, "receipts");
  mkdirSync(state);
  mkdirSync(receipts);
  const runner = path.join(directory, "runner");
  const coworld = path.join(directory, "coworld");
  const docker = path.join(directory, "docker");
  const lookup = path.join(directory, "lookup");
  const commandLog = path.join(directory, "coworld-args.log");
  const ready = path.join(directory, "mutation-child-ready");
  const terminated = path.join(directory, "mutation-child-terminated");
  const preflight = path.join(directory, "preflight.json");
  executable(runner, "print -r -- '{\"state\":\"free\"}'");
  executable(coworld, `
case "$1" in
  player)
    print -r -- '[{"id":"${activePlayer}","active":true}]'
    ;;
  upload-policy)
    printf '%s\\n' "$@" > "$COWORLD_ARGS_LOG"
    if [[ "\${FAKE_MUTATION_WAIT:-0}" == "1" ]]; then
      : > "$FAKE_MUTATION_READY"
      trap ': > "$FAKE_MUTATION_TERMINATED"; exit 143' TERM
      while true; do sleep 1; done
    fi
    [[ "\${FAKE_MUTATION_FAIL:-0}" != "1" ]] || exit 42
    print -r -- 'Upload complete: ${LABEL}'
    ;;
  submit)
    printf '%s\\n' "$@" > "$COWORLD_ARGS_LOG"
    [[ "\${FAKE_MUTATION_FAIL:-0}" != "1" ]] || exit 43
    print -r -- 'Submitted to league'
    ;;
  *)
    exit 64
    ;;
esac
`);
  executable(docker, `print -r -- '${IMAGE}'`);
  executable(lookup, `
label="$1"
id="\${LOOKUP_ID_OVERRIDE:-${POLICY_ID}}"
print -r -- "{\\"label\\":\\"$label\\",\\"policy_version_id\\":\\"$id\\"}"
`);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const parentCommit = execFileSync("git", ["rev-parse", "HEAD^"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const base = {
    schema_version: 1,
    candidate: {
      policy_ref: "proxywar-agent-llm:qd1n-test-amd64",
      parent_ref: "proxywar-agent-llm:qd1n-parent-amd64",
      exact_deltas: ["one bounded dispatcher change"],
      source_commit: sourceCommit,
      parent_commit: parentCommit,
      image_id: IMAGE,
    },
    hypothesis: "the bounded dispatcher improves both seat orientations",
    mechanism: { marker: "od1", prior_reachable_decisions: 2 },
    local: {
      runs: 2,
      independent_traces: 2,
      contract_sha256: "e".repeat(64),
      audit_receipt: localAudit(sourceCommit, parentCommit, directory),
    },
    preupload_rci: {
      receipt: rciReceipt(sourceCommit, directory, "preupload-rci"),
    },
    matched_baseline: null,
    diagnostic_only: true,
    hosted: {
      criteria: {
        win_rate_pct: 100,
        max_holds: 0,
        max_rejections: 0,
        max_k1z_harm: 0,
        planner_degradation_rule: "no_unexplained_regression_vs_parent",
        min_mechanism_executions: 1,
      },
    },
    promotion: {
      regression_episodes: 20,
      league_change_allowed: false,
    },
  };
  writeJson(preflight, base);
  return {
    directory,
    state,
    receipts,
    runner,
    coworld,
    docker,
    lookup,
    commandLog,
    ready,
    terminated,
    preflight,
    sourceCommit,
    parentCommit,
  };
}

function makePromotionPreflight(context) {
  const value = JSON.parse(readFileSync(context.preflight, "utf8"));
  const uploadReceipt = path.join(context.directory, "upload-receipt.json");
  writeJson(uploadReceipt, {
    schema_version: 2,
    mode: "diagnostic",
    status: "completed",
    candidate_source_commit: context.sourceCommit,
    candidate_image_id: IMAGE,
    candidate_policy_ref: value.candidate.policy_ref,
    uploaded_label: LABEL,
    policy_version_id: POLICY_ID,
  });
  value.candidate.uploaded_label = LABEL;
  value.candidate.policy_version_id = POLICY_ID;
  value.candidate.upload_receipt = binding(uploadReceipt);
  value.diagnostic_only = false;
  value.matched_baseline = {
    policy_ref: value.candidate.parent_ref,
    request_id: "xreq_parent",
    same_roster: true,
    same_variant: true,
  };
  const hostedEpisodes = Array.from({ length: 4 }, (_, index) => ({
    episode_id: `hosted-${index}`,
    replay_sha256: (index + 1).toString(16).repeat(64),
    winner_player_id: ODIN,
    candidate_policy_version_id: POLICY_ID,
    marker_executions: 1,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    planner_degradation_passed: true,
  }));
  const hostedAudit = path.join(context.directory, "hosted-audit.json");
  writeJson(hostedAudit, {
    verdict: "PASS_HOSTED",
    candidate_source_commit: context.sourceCommit,
    candidate_image_id: IMAGE,
    candidate_policy_version_id: POLICY_ID,
    request_id: "xreq_child",
    baseline_request_id: "xreq_parent",
    roster_sha256: "d".repeat(64),
    variant: "12p-pangaea",
    episodes: hostedEpisodes,
  });
  value.hosted.request_id = "xreq_child";
  value.hosted.audit_receipt = binding(hostedAudit);
  value.hosted.result = {
    status: "completed",
    episodes: 4,
    wins: 4,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    mechanism_executions: 4,
    planner_degradation_rule_passed: true,
  };
  const regressionEpisodes = Array.from({ length: 20 }, (_, index) => ({
    episode_id: `regression-${index}`,
    replay_sha256: createHash("sha256")
      .update(`regression-${index}`)
      .digest("hex"),
    winner_player_id: ODIN,
    candidate_policy_version_id: POLICY_ID,
    marker_executions: 0,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
    map: index % 2 ? "World" : "Pangaea",
    seat: index % 4,
  }));
  const regressionAudit = path.join(context.directory, "regression-audit.json");
  value.promotion.request_id = "xreq_regression";
  writeJson(regressionAudit, {
    verdict: "PASS_REGRESSION",
    candidate_source_commit: context.sourceCommit,
    candidate_image_id: IMAGE,
    candidate_policy_version_id: POLICY_ID,
    request_id: "xreq_regression",
    episodes: regressionEpisodes,
  });
  value.promotion.regression_audit_receipt = binding(regressionAudit);
  value.promotion.result = {
    status: "completed",
    episodes: 20,
    wins: 20,
    holds: 0,
    rejections: 0,
    k1z_harm: 0,
  };
  value.final_rci = {
    receipt: rciReceipt(context.sourceCommit, context.directory, "final-rci", {
      final: true,
    }),
  };
  writeJson(context.preflight, value);
}

function environment(context, extra = {}) {
  return {
    ...process.env,
    PROXYWAR_OPERATOR_STATE_ROOT: context.state,
    PROXYWAR_RUNNER_LEASE_SCRIPT: context.runner,
    PROXYWAR_COWORLD_BIN: context.coworld,
    PROXYWAR_DOCKER_BIN: context.docker,
    PROXYWAR_POLICY_LOOKUP_BIN: context.lookup,
    PROXYWAR_POLICY_LOOKUP_ATTEMPTS: "1",
    PROXYWAR_MUTATION_SIGNAL_GRACE_SECONDS: "1",
    COWORLD_ARGS_LOG: context.commandLog,
    FAKE_MUTATION_READY: context.ready,
    FAKE_MUTATION_TERMINATED: context.terminated,
    ...extra,
  };
}

function invoke(context, args, extra = {}) {
  return spawnSync("/bin/zsh", [wrapper, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment(context, extra),
    timeout: 30_000,
  });
}

function exitPromise(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitFor(check, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

test("diagnostic constructs the exact upload command and binds its receipt", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  const receipt = path.join(context.receipts, "diagnostic.json");
  const preflightHash = sha256(context.preflight);
  const result = invoke(context, [
    "run", "diagnostic", context.preflight, receipt,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(context.commandLog, "utf8").trim().split("\n"), [
    "upload-policy",
    "proxywar-agent-llm:qd1n-test-amd64",
    "--name",
    "qd1n",
    "--use-bedrock",
    "--run",
    "node",
    "--run",
    "/app/llm-player.mjs",
    "--tag",
    `source_commit=${context.sourceCommit}`,
    "--tag",
    `image_id=${"a".repeat(64)}`,
    "--server",
    SERVER,
  ]);
  const recorded = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.active_player_id, ODIN);
  assert.equal(recorded.candidate_policy_ref, "proxywar-agent-llm:qd1n-test-amd64");
  assert.equal(recorded.candidate_image_id, IMAGE);
  assert.equal(recorded.uploaded_label, LABEL);
  assert.equal(recorded.policy_version_id, POLICY_ID);
  assert.equal(recorded.preflight_snapshot_sha256, preflightHash);
  assert.equal(existsSync(path.join(context.state, "qd1n.mutation.lock")), false);
});

test("free-form command arguments are rejected before any mutation", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  const result = invoke(context, [
    "run", "diagnostic", context.preflight,
    path.join(context.receipts, "forbidden.json"),
    "--", "/bin/true", "upload-policy",
  ]);
  assert.equal(result.status, 64);
  assert.equal(existsSync(context.commandLog), false);
});

test("retired Hrafn identity blocks the exact command and records the blocker", (t) => {
  const context = fixture(HRAFN);
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  const receipt = path.join(context.receipts, "blocked.json");
  const result = invoke(context, [
    "run", "diagnostic", context.preflight, receipt,
  ]);
  assert.equal(result.status, 78);
  assert.match(result.stderr, /active player is not K1Z odin free/);
  assert.equal(existsSync(context.commandLog), false);
  assert.equal(
    existsSync(path.join(context.state, "qd1n.mutation.lock")),
    false,
    result.stderr,
  );
  assert.equal(existsSync(receipt), true, result.stderr);
  assert.equal(JSON.parse(readFileSync(receipt, "utf8")).status, "blocked");
  assert.equal(existsSync(path.join(context.state, "qd1n.mutation.lock")), false);
});

test("promotion submits only the evidence-bound label after live ID verification", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  makePromotionPreflight(context);
  const receipt = path.join(context.receipts, "promotion.json");
  const result = invoke(context, [
    "run", "promotion", context.preflight, receipt,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(context.commandLog, "utf8").trim().split("\n"), [
    "submit",
    LABEL,
    "--league",
    LEAGUE,
    "--no-open-browser",
    "--auto-champion",
    "always",
    "--server",
    SERVER,
  ]);
  const recorded = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.uploaded_label, LABEL);
  assert.equal(recorded.policy_version_id, POLICY_ID);
});

test("promotion blocks when live policy-version identity differs", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  makePromotionPreflight(context);
  const receipt = path.join(context.receipts, "mismatch.json");
  const result = invoke(
    context,
    ["run", "promotion", context.preflight, receipt],
    { LOOKUP_ID_OVERRIDE: "22222222-2222-4222-8222-222222222222" },
  );
  assert.equal(result.status, 78);
  assert.match(result.stderr, /live policy-version identity/);
  assert.equal(existsSync(context.commandLog), false);
  assert.equal(JSON.parse(readFileSync(receipt, "utf8")).status, "blocked");
});

test("SIGKILL leaves a stale mutation whose exact-token reaper stops the child", async (t) => {
  const context = fixture();
  let childPid = 0;
  t.after(() => {
    if (childPid > 1) {
      try { process.kill(-childPid, "SIGKILL"); } catch {}
    }
    rmSync(context.directory, { recursive: true, force: true });
  });
  const receipt = path.join(context.receipts, "recovered.json");
  const wrapperChild = spawn("/bin/zsh", [
    wrapper, "run", "diagnostic", context.preflight, receipt,
  ], {
    cwd: root,
    env: environment(context, { FAKE_MUTATION_WAIT: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = exitPromise(wrapperChild);
  await waitFor(() => existsSync(context.ready), "mutation child readiness");
  const lock = path.join(context.state, "qd1n.mutation.lock");
  childPid = Number(readFileSync(path.join(lock, "child_pid"), "utf8").trim());
  const token = readFileSync(path.join(lock, "token"), "utf8").trim();
  wrapperChild.kill("SIGKILL");
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });

  const wrong = invoke(context, ["reap-stale", "wrong-token"]);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /token mismatch/);
  assert.equal(existsSync(lock), true);

  const reaped = invoke(context, ["reap-stale", token]);
  assert.equal(reaped.status, 0, reaped.stderr);
  assert.match(reaped.stdout, /external-outcome-unknown/);
  await waitFor(() => existsSync(context.terminated), "mutation child termination");
  assert.equal(existsSync(lock), false);
  const recorded = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(recorded.status, "recovered_stale");
  assert.equal(recorded.external_outcome_unknown, true);
  assert.throws(() => process.kill(childPid, 0));
  childPid = 0;
});
