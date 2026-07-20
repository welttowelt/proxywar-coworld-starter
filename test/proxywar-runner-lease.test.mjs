import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leaseScript = path.join(root, "scripts", "proxywar-runner-lease.sh");
const operatorScript = path.join(root, "scripts", "run-proxywar-operator-cycle.sh");

function fixture() {
  const created = mkdtempSync(path.join(tmpdir(), "proxywar-runner-lease-"));
  const directory = realpathSync(created);
  const state = path.join(directory, "state");
  mkdirSync(state, { recursive: true });
  return { directory, state };
}

function environment(state, extra = {}) {
  return {
    ...process.env,
    PROXYWAR_OPERATOR_STATE_ROOT: state,
    PROXYWAR_RUNNER_LEASE_SCRIPT: leaseScript,
    PROXYWAR_RUNNER_OUTPUT_ROOTS: path.dirname(state),
    PROXYWAR_RUNNER_INIT_GRACE_SECONDS: "0",
    PROXYWAR_RUNNER_SIGNAL_GRACE_SECONDS: "1",
    PROXYWAR_RUNNER_TEST_MODE: "1",
    ...extra,
  };
}

function invoke(state, args, extra = {}) {
  return spawnSync("/bin/zsh", [leaseScript, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment(state, extra),
    timeout: 15_000,
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

async function stopChild(child, exited, finish) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (finish) writeFileSync(finish, "");
  child.kill("SIGTERM");
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2_000));
  if (await Promise.race([exited, timeout])) return;
  child.kill("SIGKILL");
  await exited;
}

function processStart(pid) {
  return spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  }).stdout.trim().replaceAll(/\s+/g, " ");
}

function makeFakeDocker({ directory }, containers = [], failure = "") {
  const dockerRoot = path.join(directory, `fake-docker-${Math.random().toString(16).slice(2)}`);
  const containerRoot = path.join(dockerRoot, "containers");
  const log = path.join(dockerRoot, "docker.log");
  mkdirSync(containerRoot, { recursive: true });
  for (const container of containers) {
    const record = path.join(containerRoot, container.id);
    mkdirSync(record);
    writeFileSync(path.join(record, "mounts"), `${container.mounts.join("\n")}\n`);
    writeFileSync(
      path.join(record, "summary-mounts"),
      `${(container.summaryMounts ?? container.mounts).join(",")}\n`,
    );
    writeFileSync(path.join(record, "running"), `${container.running}\n`);
    writeFileSync(
      path.join(record, "state"),
      `${container.state ?? (container.running ? "running" : "exited")}\n`,
    );
    if (container.inspectFails) writeFileSync(path.join(record, "inspect-fails"), "");
    if (container.removeGone) writeFileSync(path.join(record, "remove-gone"), "");
  }
  const executable = path.join(dockerRoot, "docker");
  writeFileSync(executable, `#!/bin/zsh
set -euo pipefail
root="$FAKE_DOCKER_ROOT"
failure="\${FAKE_DOCKER_FAILURE:-}"
command_name="$1"
case "$command_name" in
  ps)
    [[ "$failure" != "list" ]] || exit 71
    for record in "$root"/containers/*(N); do
      [[ -d "$record" ]] || continue
      if [[ "$*" == *".Mounts"* ]]; then
        mount_summary="$(< "$record/summary-mounts")"
        state="$(< "$record/state")"
        print -r -- "\${record:t}\t$state\t$mount_summary"
      else
        print -r -- "\${record:t}"
      fi
    done
    ;;
  inspect)
    container="\${@: -1}"
    [[ "$failure" != "inspect" ]] || exit 72
    record="$root/containers/$container"
    [[ -d "$record" ]] || exit 1
    if [[ -e "$record/inspect-fails" ]]; then
      print -r -- "Error response from daemon: No such object: $container" >&2
      exit 72
    fi
    if [[ "$*" == *".State.Running"* ]]; then
      cat "$record/running"
    else
      cat "$record/mounts"
    fi
    ;;
  stop)
    container="\${@: -1}"
    [[ "$failure" != "stop" ]] || exit 73
    print -r -- "stop:$container" >> "$root/docker.log"
    print -r -- "false" > "$root/containers/$container/running"
    ;;
  rm)
    container="\${@: -1}"
    [[ "$failure" != "remove" ]] || exit 74
    print -r -- "rm:$container" >> "$root/docker.log"
    if [[ -e "$root/containers/$container/remove-gone" ]]; then
      mv "$root/containers/$container" "$root/removed-$container-$RANDOM"
      print -r -- "Error response from daemon: No such container: $container" >&2
      exit 1
    fi
    mv "$root/containers/$container" "$root/removed-$container-$RANDOM"
    ;;
  *)
    exit 64
    ;;
esac
`);
  chmodSync(executable, 0o755);
  return {
    executable,
    log,
    root: dockerRoot,
    env: {
      PROXYWAR_DOCKER_BIN: executable,
      FAKE_DOCKER_ROOT: dockerRoot,
      FAKE_DOCKER_FAILURE: failure,
    },
  };
}

function writeClaimMarker(output, {
  lane,
  runId,
  token,
  device,
  inode,
}) {
  const digest = spawnSync("shasum", ["-a", "256"], {
    encoding: "utf8",
    input: `${token}\0${output}\0${device}\0${inode}`,
  }).stdout.split(/\s+/)[0];
  writeFileSync(path.join(output, ".proxywar-runner-claim"), [
    "schema_version=1",
    `lane=${lane}`,
    `run_id=${runId}`,
    `claim_digest=${digest}`,
    `device=${device}`,
    `inode=${inode}`,
    `path=${output}`,
    "",
  ].join("\n"));
  chmodSync(path.join(output, ".proxywar-runner-claim"), 0o600);
}

function writeV2Lock(state, {
  lane = "odin",
  runId = "stale-run",
  token = "stale-token",
  supervisorPid = "999999",
  supervisorStartedAt = "Mon Jan 1 00:00:00 2001",
  outputs = [path.join(path.dirname(state), "partial-output")],
  createOutputs = true,
  childPid = "",
  childStartedAt = "",
  childPgid = "",
  recovery = false,
} = {}) {
  const lock = path.join(state, "runner.lock");
  mkdirSync(lock);
  const claims = [];
  for (const output of outputs) {
    let device = 1;
    let inode = 1;
    if (createOutputs) {
      mkdirSync(output);
      const stat = statSync(output);
      device = stat.dev;
      inode = stat.ino;
      writeClaimMarker(output, { lane, runId, token, device, inode });
    }
    claims.push(`${output}\t${device}\t${inode}`);
  }
  writeFileSync(path.join(lock, "schema_version"), "2\n");
  writeFileSync(path.join(lock, "owner"), `${lane}\n`);
  writeFileSync(path.join(lock, "run_id"), `${runId}\n`);
  writeFileSync(path.join(lock, "token"), `${token}\n`);
  writeFileSync(path.join(lock, "supervisor_pid"), `${supervisorPid}\n`);
  writeFileSync(path.join(lock, "supervisor_started_at"), `${supervisorStartedAt}\n`);
  writeFileSync(path.join(lock, "acquired_at"), "2026-07-19T11:10:17Z\n");
  writeFileSync(path.join(lock, "outputs"), `${outputs.join("\n")}\n`);
  writeFileSync(path.join(lock, "output_claims"), `${claims.join("\n")}\n`);
  writeFileSync(path.join(lock, "allowed_roots"), `${path.dirname(state)}\n`);
  if (childPid) {
    writeFileSync(path.join(lock, "child_pid"), `${childPid}\n`);
    writeFileSync(path.join(lock, "child_started_at"), `${childStartedAt}\n`);
    writeFileSync(path.join(lock, "child_pgid"), `${childPgid}\n`);
  }
  writeFileSync(path.join(lock, "ready"), "");
  chmodSync(lock, 0o700);
  for (const entry of readdirSync(lock)) {
    if (entry !== "recovery") chmodSync(path.join(lock, entry), 0o600);
  }
  if (recovery) {
    const recoveryDir = path.join(lock, "recovery");
    mkdirSync(recoveryDir);
    writeFileSync(path.join(recoveryDir, "pid"), "999998\n");
    writeFileSync(path.join(recoveryDir, "started_at"), "Mon Jan 1 00:00:00 2001\n");
    writeFileSync(path.join(recoveryDir, "mode"), "stale-reap\n");
    writeFileSync(path.join(recoveryDir, "ready"), "");
  }
  return { lock, outputs, token };
}

test("status --json is valid and token-free for free, initializing, corrupt, legacy, and reaping states", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });

  const free = fixture();
  fixtures.push(free);
  let result = invoke(free.state, ["status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    state: "free",
    schema_version: 2,
    owner: null,
    run_id: null,
    supervisor_pid: null,
    supervisor_alive: null,
    child_pid: null,
    child_pgid: null,
    child_alive: null,
    acquired_at: null,
    outputs: [],
    reap_in_progress: false,
  });

  const initializing = fixture();
  fixtures.push(initializing);
  mkdirSync(path.join(initializing.state, "runner.lock"));
  writeFileSync(path.join(initializing.state, "runner.lock", "schema_version"), "2\n");
  writeFileSync(path.join(initializing.state, "runner.lock", "owner"), "odin\n");
  result = invoke(initializing.state, ["status", "--json"]);
  let report = JSON.parse(result.stdout);
  assert.equal(report.state, "initializing");
  assert.equal(report.schema_version, 2);
  assert.equal(Object.hasOwn(report, "token"), false);

  const corrupt = fixture();
  fixtures.push(corrupt);
  writeV2Lock(corrupt.state);
  writeFileSync(path.join(corrupt.state, "runner.lock", "supervisor_pid"), "not-a-pid\n");
  result = invoke(corrupt.state, ["status", "--json"]);
  report = JSON.parse(result.stdout);
  assert.equal(report.state, "corrupt");
  assert.equal(report.supervisor_pid, null);
  assert.equal(Object.hasOwn(report, "token"), false);

  const legacy = fixture();
  fixtures.push(legacy);
  mkdirSync(path.join(legacy.state, "runner.lock"));
  writeFileSync(path.join(legacy.state, "runner.lock", "owner"), "odin\n");
  writeFileSync(path.join(legacy.state, "runner.lock", "acquired_at"), "2026-07-19T11:10:17Z\n");
  result = invoke(legacy.state, ["status", "--json"]);
  report = JSON.parse(result.stdout);
  assert.equal(report.state, "legacy");
  assert.equal(report.schema_version, 1);

  const reaping = fixture();
  fixtures.push(reaping);
  writeV2Lock(reaping.state, { recovery: true });
  result = invoke(reaping.state, ["status", "--json"]);
  report = JSON.parse(result.stdout);
  assert.equal(report.state, "reaping");
  assert.equal(report.reap_in_progress, true);
  assert.equal(Object.hasOwn(report, "token"), false);
});

test("supervised run is strict-busy, exact-release protected, private, and clean on success", async (t) => {
  const context = fixture();
  const { directory, state } = context;
  const docker = makeFakeDocker(context);
  const output = path.join(directory, "output");
  const ready = path.join(directory, "ready");
  const finish = path.join(directory, "finish");
  const child = spawn("/bin/zsh", [
    leaseScript,
    "run",
    "odin",
    "run-a",
    "--output",
    output,
    "--",
    "/bin/zsh",
    "-c",
    ': > "$TEST_READY"; while [[ ! -e "$TEST_FINISH" ]]; do sleep 0.02; done',
  ], {
    cwd: root,
    env: environment(state, {
      ...docker.env,
      TEST_READY: ready,
      TEST_FINISH: finish,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = exitPromise(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await stopChild(child, exited, finish);
    rmSync(directory, { recursive: true, force: true });
  });

  await waitFor(() => existsSync(ready), "supervised command readiness");
  const token = readFileSync(path.join(state, "runner.lock", "token"), "utf8").trim();
  const status = invoke(state, ["status", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.equal(report.state, "active");
  assert.equal(report.owner, "odin");
  assert.equal(report.run_id, "run-a");
  assert.equal(report.supervisor_pid, child.pid);
  assert.equal(report.supervisor_alive, true);
  assert.equal(report.child_alive, true);
  assert.deepEqual(report.outputs, [output]);
  assert.equal(Object.hasOwn(report, "token"), false);
  assert.equal(lstatSync(path.join(state, "runner.lock")).mode & 0o777, 0o700);
  assert.equal(lstatSync(path.join(state, "runner.lock", "token")).mode & 0o777, 0o600);
  assert.equal(lstatSync(path.join(output, ".proxywar-runner-claim")).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(path.join(output, ".proxywar-runner-claim"), "utf8").includes(token),
    false,
  );
  assert.equal(stdout.includes(token), false);
  assert.equal(stderr.includes(token), false);

  for (const lane of ["odin", "hrafn"]) {
    const contenderOutput = path.join(directory, `contender-${lane}`);
    const contender = invoke(state, [
      "run", lane, `run-${lane}`, "--output", contenderOutput, "--", "/usr/bin/true",
    ], docker.env);
    assert.equal(contender.status, 1, contender.stderr);
    assert.match(contender.stderr, /busy:odin:run-a/);
    assert.equal(existsSync(contenderOutput), false);
  }

  const wrongRelease = invoke(state, ["release", "odin", "run-a", "wrong-token"]);
  assert.equal(wrongRelease.status, 1);
  assert.match(wrongRelease.stderr, /lease-mismatch/);

  const activeRelease = invoke(state, ["release", "odin", "run-a", token]);
  assert.equal(activeRelease.status, 1);
  assert.match(activeRelease.stderr, /active-run:odin:run-a/);

  const activeReap = invoke(state, ["reap-stale", "odin", "run-a", token], docker.env);
  assert.equal(activeReap.status, 1);
  assert.match(activeReap.stderr, /active-run:odin:run-a/);

  writeFileSync(finish, "");
  const exit = await exited;
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(output, ".proxywar-runner-claim")), false);
  assert.match(stderr, /"event":"lease_acquired"/);
  assert.match(stderr, /"event":"child_started"/);
  assert.match(stderr, /"event":"lease_released"/);
  assert.equal(readdirSync(directory).some((name) => name.includes(".aborted-")), false);
});

test("failed supervised command performs scoped cleanup then quarantines exact output", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "partial-output");
  const docker = makeFakeDocker(context, [
    { id: "failed-run-container", mounts: [output], running: true },
  ]);
  const result = invoke(state, [
    "run", "odin", "failed-run", "--output", output, "--",
    "/bin/zsh", "-c", 'print -r -- partial > "$TEST_OUTPUT/data.txt"; exit 7',
  ], { ...docker.env, TEST_OUTPUT: output });

  assert.equal(result.status, 7, result.stderr);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), false);
  const quarantinedName = readdirSync(directory).find((name) =>
    name.startsWith("partial-output.aborted-") && !name.endsWith(".json"));
  assert.ok(quarantinedName);
  const receipt = JSON.parse(readFileSync(
    path.join(directory, quarantinedName, "runner-abort-receipt.json"), "utf8"));
  assert.equal(receipt.run_id, "failed-run");
  assert.equal(receipt.reason, "supervised_command_exit_7");
  assert.equal(receipt.evidence_eligible, false);
  assert.equal(
    readFileSync(docker.log, "utf8"),
    "stop:failed-run-container\nrm:failed-run-container\n",
  );
  const childExitIndex = result.stderr.indexOf('"event":"child_exited"');
  const containerCleanupIndex = result.stderr.indexOf('"event":"containers_cleaned"');
  const quarantineIndex = result.stderr.indexOf('"event":"output_quarantined"');
  const releaseIndex = result.stderr.indexOf('"event":"lease_released"');
  assert.ok(childExitIndex >= 0);
  assert.ok(childExitIndex < containerCleanupIndex);
  assert.ok(containerCleanupIndex < quarantineIndex);
  assert.ok(quarantineIndex < releaseIndex);
  assert.match(result.stderr, /"event":"containers_cleaned"/);
});

test("TERM and HUP reach the exact child process group and produce signal quarantine receipts", async () => {
  for (const [signal, code] of [["SIGTERM", 143], ["SIGHUP", 129]]) {
    const context = fixture();
    const { directory, state } = context;
    try {
      const docker = makeFakeDocker(context);
      const output = path.join(directory, "signal-output");
      const ready = path.join(directory, "ready");
      const signalReceipt = path.join(directory, "signal-received");
      const trapName = signal === "SIGTERM" ? "TERM" : "HUP";
      const child = spawn("/bin/zsh", [
        leaseScript, "run", "odin", `signal-${trapName.toLowerCase()}`,
        "--output", output, "--", "/bin/zsh", "-c",
        `trap 'print -r -- ${trapName} > "$TEST_SIGNAL"; exit 0' ${trapName}; : > "$TEST_READY"; sleep 30 & wait`,
      ], {
        cwd: root,
        env: environment(state, {
          ...docker.env,
          TEST_READY: ready,
          TEST_SIGNAL: signalReceipt,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = exitPromise(child);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      await waitFor(() => existsSync(ready), `${trapName} child readiness`);
      child.kill(signal);
      const result = await exited;
      assert.deepEqual(result, { code, signal: null }, stderr);
      assert.equal(readFileSync(signalReceipt, "utf8").trim(), trapName);
      assert.equal(existsSync(path.join(state, "runner.lock")), false);
      const quarantinedName = readdirSync(directory).find((name) =>
        name.startsWith("signal-output.aborted-"));
      assert.ok(quarantinedName);
      const receipt = JSON.parse(readFileSync(
        path.join(directory, quarantinedName, "runner-abort-receipt.json"), "utf8"));
      assert.equal(receipt.reason, `supervised_signal_${trapName}`);
      assert.match(stderr, /"event":"signal_forwarded"/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("SIGKILL leaves a stale lease whose reaper terminates the recorded orphan group", async (t) => {
  const context = fixture();
  const { directory, state } = context;
  const docker = makeFakeDocker(context);
  const output = path.join(directory, "orphan-output");
  const ready = path.join(directory, "ready");
  const terminated = path.join(directory, "orphan-terminated");
  const child = spawn("/bin/zsh", [
    leaseScript, "run", "odin", "orphan-run", "--output", output, "--",
    "/bin/zsh", "-c",
    'trap \'print -r -- terminated > "$TEST_TERMINATED"; exit 0\' TERM; : > "$TEST_READY"; while true; do sleep 1; done',
  ], {
    cwd: root,
    env: environment(state, {
      ...docker.env,
      TEST_READY: ready,
      TEST_TERMINATED: terminated,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = exitPromise(child);
  let orphanPid = 0;
  t.after(() => {
    if (orphanPid > 1) {
      try { process.kill(-orphanPid, "SIGKILL"); } catch {}
    }
    rmSync(directory, { recursive: true, force: true });
  });

  await waitFor(() => existsSync(ready), "orphan child readiness");
  orphanPid = Number(readFileSync(path.join(state, "runner.lock", "child_pid"), "utf8").trim());
  const token = readFileSync(path.join(state, "runner.lock", "token"), "utf8").trim();
  child.kill("SIGKILL");
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
  await waitFor(() => JSON.parse(invoke(state, ["status", "--json"]).stdout).state === "stale", "stale status");

  const reaped = invoke(state, ["reap-stale", "odin", "orphan-run", token], docker.env);
  assert.equal(reaped.status, 0, reaped.stderr);
  assert.match(reaped.stdout, /reaped:odin:orphan-run:containers=0/);
  assert.equal(readFileSync(terminated, "utf8").trim(), "terminated");
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), false);
  assert.throws(() => process.kill(orphanPid, 0));
  orphanPid = 0;
});

test("stale reaping clears only exact mounted containers when an orphaned group lost its leader", async (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "leaderless-output");
  const group = spawn("/bin/zsh", ["-c", "sleep 30 & wait"], {
    detached: true,
    stdio: "ignore",
  });
  let groupPid = group.pid;
  t.after(() => {
    if (groupPid > 1) {
      try { process.kill(-groupPid, "SIGKILL"); } catch {}
    }
  });
  await waitFor(() => processStart(groupPid).length > 0, "orphan group leader start");
  const groupStart = processStart(groupPid);
  group.kill("SIGKILL");
  await exitPromise(group);
  const docker = makeFakeDocker(context, [{ id: "ours", mounts: [output], running: true }]);
  writeV2Lock(state, {
    runId: "leaderless-run",
    token: "leaderless-token",
    outputs: [output],
    childPid: String(groupPid),
    childStartedAt: groupStart,
    childPgid: String(groupPid),
  });

  const result = invoke(
    state, ["reap-stale", "odin", "leaderless-run", "leaderless-token"], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reaped:odin:leaderless-run:containers=1/);
  assert.match(readFileSync(docker.log, "utf8"), /stop:ours/);
  assert.match(readFileSync(docker.log, "utf8"), /rm:ours/);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  groupPid = 0;
});

test("stale reaping removes only exact mounted running and exited containers, then verifies again", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "partial-output");
  writeV2Lock(state, { outputs: [output] });
  writeFileSync(path.join(output, "data.txt"), "partial");
  const docker = makeFakeDocker(context, [
    { id: "ours-running", mounts: [output], running: true },
    { id: "ours-exited", mounts: [output], running: false },
    { id: "unrelated", mounts: [path.join(directory, "unrelated")], running: true },
  ]);

  const result = invoke(
    state, ["reap-stale", "odin", "stale-run", "stale-token"], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /containers=2/);
  assert.deepEqual(
    new Set(readFileSync(docker.log, "utf8").trim().split("\n")),
    new Set(["stop:ours-running", "rm:ours-running", "rm:ours-exited"]),
  );
  assert.equal(existsSync(path.join(docker.root, "containers", "unrelated")), true);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), false);
  const quarantinedName = readdirSync(directory).find((name) =>
    name.startsWith("partial-output.aborted-"));
  const receipt = JSON.parse(readFileSync(
    path.join(directory, quarantinedName, "runner-abort-receipt.json"), "utf8"));
  assert.equal(receipt.reason, "stale_supervisor");
  assert.equal(receipt.evidence_eligible, false);
});

test("stale reaping accepts only an exact container auto-removal race", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "auto-removed-output");
  writeV2Lock(state, { outputs: [output] });
  const docker = makeFakeDocker(context, [
    { id: "ours", mounts: [output], running: true, removeGone: true },
  ]);

  const result = invoke(state, ["reap-stale", "odin", "stale-run", "stale-token"], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reaped:odin:stale-run:containers=1/);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
});

test("Docker list, inspect, stop, and remove failures preserve the exact lock and outputs", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });
  for (const failure of ["list", "inspect", "stop", "remove"]) {
    const context = fixture();
    fixtures.push(context);
    const output = path.join(context.directory, `output-${failure}`);
    writeV2Lock(context.state, { outputs: [output] });
    const docker = makeFakeDocker(context, [
      { id: "ours", mounts: [output], running: failure === "stop" },
    ], failure);
    const result = invoke(
      context.state,
      ["reap-stale", "odin", "stale-run", "stale-token"],
      docker.env,
    );
    assert.equal(result.status, 69, `${failure}: ${result.stderr}`);
    assert.equal(existsSync(path.join(context.state, "runner.lock")), true, failure);
    assert.equal(existsSync(output), true, failure);
    assert.equal(
      existsSync(path.join(output, ".proxywar-runner-claim")), true, failure);
    const report = JSON.parse(invoke(context.state, ["status", "--json"]).stdout);
    assert.equal(report.state, "reaping", failure);
  }
});

test("a Created empty-summary Docker 404 ghost cannot block exact stale cleanup", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "partial-output");
  writeV2Lock(state, { outputs: [output] });
  writeFileSync(path.join(output, "data.txt"), "partial");
  const docker = makeFakeDocker(context, [
    {
      id: "desktop-ghost",
      mounts: [],
      summaryMounts: [],
      running: false,
      state: "created",
      inspectFails: true,
    },
  ]);

  const result = invoke(
    state, ["reap-stale", "odin", "stale-run", "stale-token"], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /containers=0/);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(path.join(docker.root, "containers", "desktop-ghost")), true);
  assert.equal(existsSync(docker.log), false);
});

test("an empty mount summary never hides an exact matching inspected mount", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "partial-output");
  writeV2Lock(state, { outputs: [output] });
  const docker = makeFakeDocker(context, [
    {
      id: "summary-mismatch",
      mounts: [output],
      summaryMounts: [],
      running: false,
      state: "exited",
    },
  ]);

  const result = invoke(
    state, ["reap-stale", "odin", "stale-run", "stale-token"], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /containers=1/);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.match(readFileSync(docker.log, "utf8"), /rm:summary-mismatch/);
});

test("empty-summary inspect failures outside the narrow Created 404 stay fail-closed", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });
  for (const stateName of ["running", "exited"]) {
    const context = fixture();
    fixtures.push(context);
    const output = path.join(context.directory, `partial-${stateName}`);
    writeV2Lock(context.state, { outputs: [output] });
    const docker = makeFakeDocker(context, [
      {
        id: `bad-${stateName}`,
        mounts: [],
        summaryMounts: [],
        running: stateName === "running",
        state: stateName,
        inspectFails: true,
      },
    ]);
    const result = invoke(
      context.state,
      ["reap-stale", "odin", "stale-run", "stale-token"],
      docker.env,
    );
    assert.equal(result.status, 69, `${stateName}: ${result.stderr}`);
    assert.equal(existsSync(path.join(context.state, "runner.lock")), true);
    assert.equal(existsSync(output), true);
  }
});

test("partial-v2 can never use tokenless release while a pure legacy lock can release once", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });

  const partial = fixture();
  fixtures.push(partial);
  const partialLock = path.join(partial.state, "runner.lock");
  mkdirSync(partialLock);
  writeFileSync(path.join(partialLock, "schema_version"), "2\n");
  writeFileSync(path.join(partialLock, "owner"), "odin\n");
  let result = invoke(partial.state, ["release", "odin"]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /pure v1 migration lock/);
  assert.equal(existsSync(partialLock), true);

  const markedLegacy = fixture();
  fixtures.push(markedLegacy);
  const markedLock = path.join(markedLegacy.state, "runner.lock");
  mkdirSync(markedLock);
  writeFileSync(path.join(markedLock, "owner"), "odin\n");
  writeFileSync(path.join(markedLock, "acquired_at"), "2026-07-19T11:10:17Z\n");
  writeFileSync(path.join(markedLock, "outputs"), "");
  result = invoke(markedLegacy.state, ["release", "odin"]);
  assert.equal(result.status, 64);
  assert.equal(existsSync(markedLock), true);

  const legacy = fixture();
  fixtures.push(legacy);
  const legacyLock = path.join(legacy.state, "runner.lock");
  mkdirSync(legacyLock);
  writeFileSync(path.join(legacyLock, "owner"), "odin\n");
  writeFileSync(path.join(legacyLock, "acquired_at"), "2026-07-19T11:10:17Z\n");
  result = invoke(legacy.state, ["release", "hrafn"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /owned-by:odin/);
  result = invoke(legacy.state, ["release", "odin"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /released-legacy:odin/);
  assert.equal(existsSync(legacyLock), false);
  result = invoke(legacy.state, ["release", "odin"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /free/);
});

test("exact release clears only a dead cleanup marker when every recorded output is absent", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "vanished-output");
  writeV2Lock(state, { outputs: [output], createOutputs: false });
  const recovery = path.join(state, "runner.lock", "recovery");
  mkdirSync(recovery);
  writeFileSync(path.join(recovery, "pid"), "999999\n");
  writeFileSync(path.join(recovery, "started_at"), "1\n");
  writeFileSync(path.join(recovery, "mode"), "owner-cleanup\n");
  writeFileSync(path.join(recovery, "ready"), "");

  const result = invoke(state, ["release", "odin", "stale-run", "stale-token"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /released:odin:stale-run/);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
});

test("every injected bootstrap failure cleans staging, claims, mutation guard, and runner lock", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });
  const points = [
    "schema_version", "owner", "run_id", "token", "supervisor_pid",
    "supervisor_started_at", "acquired_at", "outputs", "allowed_roots",
    "output_claims", "ready",
  ];
  for (const point of points) {
    const context = fixture();
    fixtures.push(context);
    const output = path.join(context.directory, `output-${point}`);
    const result = invoke(context.state, [
      "run", "odin", `bootstrap-${point.replaceAll("_", "-")}`,
      "--output", output, "--", "/usr/bin/true",
    ], { PROXYWAR_RUNNER_TEST_FAIL_AFTER: point });
    assert.equal(result.status, 72, `${point}: ${result.stderr}`);
    assert.equal(existsSync(output), false, point);
    assert.equal(existsSync(path.join(context.state, "runner.lock")), false, point);
    assert.equal(existsSync(path.join(context.state, "runner.mutation.lock")), false, point);
    assert.equal(
      readdirSync(context.state).some((name) => name.startsWith(".runner.lock.staging")),
      false,
      point,
    );
    assert.equal(JSON.parse(invoke(context.state, ["status", "--json"]).stdout).state, "free");
  }
});

test("a crashed partial mutation and staging record are recovered before the next run", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const mutation = path.join(state, "runner.mutation.lock");
  mkdirSync(mutation);
  const staging = path.join(state, ".runner.lock.staging.dead.1");
  mkdirSync(staging);
  writeFileSync(path.join(staging, "schema_version"), "2\n");
  const before = JSON.parse(invoke(state, ["status", "--json"]).stdout);
  assert.equal(before.state, "initializing");
  assert.equal(before.schema_version, 2);

  const docker = makeFakeDocker(context);
  const output = path.join(directory, "recovered-output");
  const result = invoke(state, [
    "run", "odin", "recovered-run", "--output", output, "--", "/usr/bin/true",
  ], docker.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(mutation), false);
  assert.equal(existsSync(staging), false);
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(output, ".proxywar-runner-claim")), false);
  assert.equal(JSON.parse(invoke(state, ["status", "--json"]).stdout).state, "free");
});

test("external mutation guard prevents release/reap/new-run races from deleting a successor", async (t) => {
  const context = fixture();
  const { directory, state } = context;
  const docker = makeFakeDocker(context);
  const oldOutput = path.join(directory, "old-output");
  writeV2Lock(state, { outputs: [oldOutput], createOutputs: false });
  const barrier = path.join(directory, "barrier");
  const release = spawn("/bin/zsh", [
    leaseScript, "release", "odin", "stale-run", "stale-token",
  ], {
    cwd: root,
    env: environment(state, { PROXYWAR_RUNNER_TEST_RETIRE_BARRIER: barrier }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const releaseExited = exitPromise(release);
  t.after(async () => {
    if (release.exitCode === null && release.signalCode === null) {
      mkdirSync(barrier, { recursive: true });
      writeFileSync(path.join(barrier, "continue"), "");
      await stopChild(release, releaseExited);
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await waitFor(() => existsSync(path.join(barrier, "entered")), "release barrier");

  const concurrentReap = invoke(
    state, ["reap-stale", "odin", "stale-run", "stale-token"], docker.env);
  assert.equal(concurrentReap.status, 1);
  assert.match(concurrentReap.stderr, /mutation in progress/);
  const successorOutput = path.join(directory, "successor-output");
  const concurrentRun = invoke(state, [
    "run", "odin", "successor", "--output", successorOutput, "--", "/usr/bin/true",
  ], docker.env);
  assert.equal(concurrentRun.status, 1);
  assert.match(concurrentRun.stderr, /mutation in progress/);
  assert.equal(existsSync(successorOutput), false);

  writeFileSync(path.join(barrier, "continue"), "");
  assert.deepEqual(await releaseExited, { code: 0, signal: null });
  const ready = path.join(directory, "successor-ready");
  const finish = path.join(directory, "successor-finish");
  const successor = spawn("/bin/zsh", [
    leaseScript, "run", "odin", "successor", "--output", successorOutput, "--",
    "/bin/zsh", "-c",
    ': > "$TEST_READY"; while [[ ! -e "$TEST_FINISH" ]]; do sleep 0.02; done',
  ], {
    cwd: root,
    env: environment(state, {
      ...docker.env,
      TEST_READY: ready,
      TEST_FINISH: finish,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const successorExited = exitPromise(successor);
  await waitFor(() => existsSync(ready), "successor readiness");
  assert.equal(JSON.parse(invoke(state, ["status", "--json"]).stdout).run_id, "successor");
  writeFileSync(finish, "");
  assert.deepEqual(await successorExited, { code: 0, signal: null });
  assert.equal(existsSync(path.join(state, "runner.lock")), false);
});

test("output validation rejects missing outputs, broad/existing/symlink/duplicate paths, and oversized IDs", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let result = invoke(state, ["run", "odin", "no-output", "--", "/usr/bin/true"]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /at least one --output/);

  const existing = path.join(directory, "existing");
  mkdirSync(existing);
  const symlink = path.join(directory, "symlink");
  symlinkSync(existing, symlink);
  for (const output of ["/", path.dirname(state), existing, symlink, "/Users/olifreuler"]) {
    result = invoke(state, [
      "run", "odin", "unsafe-output", "--output", output, "--", "/usr/bin/true",
    ]);
    assert.equal(result.status, 64, `${output}: ${result.stderr}`);
    assert.match(result.stderr, /new dedicated directories/);
    assert.equal(existsSync(path.join(state, "runner.lock")), false);
  }

  const duplicate = path.join(directory, "duplicate");
  result = invoke(state, [
    "run", "odin", "duplicate", "--output", duplicate, "--output", duplicate,
    "--", "/usr/bin/true",
  ]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /duplicate output/);

  result = invoke(state, [
    "run", "odin", "x".repeat(81), "--output", path.join(directory, "long-id"),
    "--", "/usr/bin/true",
  ]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /1-80/);
});

test("launcher blocks active, stale, legacy, initializing, reaping, and corrupt states before wake/cursor/mailbox", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });
  const states = ["active", "stale", "legacy", "initializing", "reaping", "corrupt"];
  for (const stateName of states) {
    const context = fixture();
    fixtures.push(context);
    const prompt = path.join(context.directory, "safe-prompt.md");
    writeFileSync(prompt, "Use proxywar-runner-lease.sh run odin RUN_ID --output PATH -- COMMAND.\n");
    const wake = path.join(context.state, "odin.wake");
    const cursor = path.join(context.state, "odin-mailbox-head");
    writeFileSync(wake, "wake\n");
    writeFileSync(cursor, "unchanged\n");
    if (stateName === "legacy") {
      const lock = path.join(context.state, "runner.lock");
      mkdirSync(lock);
      writeFileSync(path.join(lock, "owner"), "odin\n");
      writeFileSync(path.join(lock, "acquired_at"), "2026-07-19T11:10:17Z\n");
    } else if (stateName === "initializing") {
      mkdirSync(path.join(context.state, "runner.lock"));
      writeFileSync(path.join(context.state, "runner.lock", "schema_version"), "2\n");
    } else {
      writeV2Lock(context.state, {
        supervisorPid: stateName === "active" ? String(process.pid) : "999999",
        supervisorStartedAt: stateName === "active"
          ? processStart(process.pid)
          : "Mon Jan 1 00:00:00 2001",
        recovery: stateName === "reaping",
      });
      if (stateName === "corrupt") {
        writeFileSync(path.join(context.state, "runner.lock", "supervisor_pid"), "bad\n");
      }
    }
    const result = spawnSync("/bin/zsh", [operatorScript, "odin"], {
      cwd: root,
      encoding: "utf8",
      env: environment(context.state, {
        PROXYWAR_OPERATOR_PROMPT: prompt,
        PROXYWAR_OPERATOR_REPO: root,
      }),
      timeout: 2_000,
    });
    assert.equal(result.status, 0, `${stateName}: ${result.stderr}`);
    assert.equal(existsSync(wake), true, stateName);
    assert.equal(readFileSync(cursor, "utf8"), "unchanged\n", stateName);
    assert.equal(existsSync(path.join(context.state, "odin.lock")), false, stateName);
  }
});

test("launcher fails closed on invalid status and split-line legacy Hrafn prompt without consuming work", (t) => {
  const fixtures = [];
  t.after(() => {
    for (const item of fixtures) rmSync(item.directory, { recursive: true, force: true });
  });

  const invalid = fixture();
  fixtures.push(invalid);
  const safePrompt = path.join(invalid.directory, "safe.md");
  writeFileSync(safePrompt, "Use proxywar-runner-lease.sh run odin RUN_ID --output PATH -- COMMAND.\n");
  const invalidLease = path.join(invalid.directory, "invalid-lease");
  writeFileSync(invalidLease, "#!/bin/zsh\nprint -r -- not-json\n");
  chmodSync(invalidLease, 0o755);
  const invalidWake = path.join(invalid.state, "odin.wake");
  const invalidCursor = path.join(invalid.state, "odin-mailbox-head");
  writeFileSync(invalidWake, "wake\n");
  writeFileSync(invalidCursor, "cursor\n");
  let result = spawnSync("/bin/zsh", [operatorScript, "odin"], {
    cwd: root,
    encoding: "utf8",
    env: environment(invalid.state, {
      PROXYWAR_RUNNER_LEASE_SCRIPT: invalidLease,
      PROXYWAR_OPERATOR_PROMPT: safePrompt,
      PROXYWAR_OPERATOR_REPO: root,
    }),
  });
  assert.equal(result.status, 75);
  assert.equal(existsSync(invalidWake), true);
  assert.equal(readFileSync(invalidCursor, "utf8"), "cursor\n");

  const legacyPrompt = fixture();
  fixtures.push(legacyPrompt);
  const hrafnPrompt = path.join(legacyPrompt.directory, "legacy-hrafn.md");
  writeFileSync(hrafnPrompt, [
    "A migrated example is also present:",
    "scripts/proxywar-runner-lease.sh run hrafn HRAFN_RUN_1 \\",
    "  --output /private/tmp/hrafn-new-output \\",
    "  -- /absolute/path/to/hrafn-batch.sh",
    "",
    "Before a Coworld episode, acquire the runner with",
    "`/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh",
    "acquire hrafn`; always release it afterward.",
    "",
  ].join("\n"));
  const hrafnWake = path.join(legacyPrompt.state, "hrafn.wake");
  const hrafnCursor = path.join(legacyPrompt.state, "hrafn-mailbox-head");
  writeFileSync(hrafnWake, "wake\n");
  writeFileSync(hrafnCursor, "cursor\n");
  result = spawnSync("/bin/zsh", [operatorScript, "hrafn"], {
    cwd: root,
    encoding: "utf8",
    env: environment(legacyPrompt.state, {
      PROXYWAR_OPERATOR_PROMPT: hrafnPrompt,
      PROXYWAR_OPERATOR_REPO: root,
    }),
  });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /not runner-v2 ready/);
  assert.equal(existsSync(hrafnWake), true);
  assert.equal(readFileSync(hrafnCursor, "utf8"), "cursor\n");

  const shim = invoke(legacyPrompt.state, ["acquire", "hrafn"]);
  assert.equal(shim.status, 78);
  assert.match(shim.stderr, /transition-required:hrafn/);
  assert.equal(existsSync(path.join(legacyPrompt.state, "runner.lock")), false);
});

test("launcher accepts a multiline migrated Hrafn run prompt before applying runner-state preflight", (t) => {
  const context = fixture();
  const { directory, state } = context;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const prompt = path.join(directory, "migrated-hrafn.md");
  writeFileSync(prompt, [
    "Run every Coworld batch through:",
    "",
    "```bash",
    "/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh \\",
    "  run hrafn HRAFN_RUN_1 \\",
    "  --output /private/tmp/hrafn-new-output \\",
    "  -- /absolute/path/to/hrafn-batch.sh",
    "```",
    "",
  ].join("\n"));
  const lock = path.join(state, "runner.lock");
  mkdirSync(lock);
  writeFileSync(path.join(lock, "owner"), "hrafn\n");
  writeFileSync(path.join(lock, "acquired_at"), "2026-07-19T11:10:17Z\n");
  const wake = path.join(state, "hrafn.wake");
  const cursor = path.join(state, "hrafn-mailbox-head");
  writeFileSync(wake, "wake\n");
  writeFileSync(cursor, "cursor\n");

  const result = spawnSync("/bin/zsh", [operatorScript, "hrafn"], {
    cwd: root,
    encoding: "utf8",
    env: environment(state, {
      PROXYWAR_OPERATOR_PROMPT: prompt,
      PROXYWAR_OPERATOR_REPO: root,
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /not runner-v2 ready/);
  assert.equal(existsSync(wake), true);
  assert.equal(readFileSync(cursor, "utf8"), "cursor\n");
  assert.equal(existsSync(path.join(state, "hrafn.lock")), false);
});
