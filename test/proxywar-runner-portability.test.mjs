import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(repo, "scripts", "proxywar-runner-lease.sh");

test("bundled foreground runner follows HOME and releases a clean Hrafn run", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "hrafn-runner-portable-"));
  const home = path.join(root, "home");
  const output = path.join(root, "output");
  const fakeDocker = path.join(root, "docker");
  mkdirSync(home);
  writeFileSync(fakeDocker, [
    "#!/bin/zsh",
    "[[ \"$1\" == \"ps\" ]] || exit 64",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(fakeDocker, 0o755);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: home,
    PROXYWAR_DOCKER_BIN: fakeDocker,
    PROXYWAR_RUNNER_OUTPUT_ROOTS: root,
    PROXYWAR_RUNNER_INIT_GRACE_SECONDS: "0",
    PROXYWAR_RUNNER_SIGNAL_GRACE_SECONDS: "1",
  };
  const stateRoot = path.join(home, ".stormforge", "proxywar-operators");
  for (const args of [
    ["acquire", "odin"],
    ["run", "odin", "denied", "--output", output, "--", "/usr/bin/true"],
    ["release", "odin"],
    ["reap-stale", "odin", "denied", "denied-token"],
  ]) {
    const denied = spawnSync("/bin/zsh", [runner, ...args], {
      cwd: repo,
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
    assert.equal(denied.status, 64, `${args.join(" ")}\n${denied.stderr}`);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(stateRoot), false);
  }
  const run = spawnSync("/bin/zsh", [
    runner,
    "run",
    "hrafn",
    "portable-test",
    "--output",
    output,
    "--",
    "/usr/bin/true",
  ], { cwd: repo, encoding: "utf8", env, timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(output, ".proxywar-runner-claim")), false);

  const status = spawnSync("/bin/zsh", [runner, "status", "--json"], {
    cwd: repo,
    encoding: "utf8",
    env,
    timeout: 15_000,
  });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).state, "free");
  assert.equal(
    existsSync(path.join(stateRoot, "runner.lock")),
    false,
  );
  assert.equal(
    readFileSync(fakeDocker, "utf8").startsWith("#!/bin/zsh\n"),
    true,
  );
});
