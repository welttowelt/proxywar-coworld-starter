import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const wrapper = path.join(root, "scripts", "proxywar-qd1n-mutation.sh");
const ODIN = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
const IMAGE = `sha256:${"a".repeat(64)}`;
const POLICY_ID = "11111111-1111-4111-8111-111111111111";

function executable(file, body) {
  writeFileSync(file, `#!/bin/zsh\nset -euo pipefail\n${body}\n`);
  chmodSync(file, 0o755);
}

test("standard-rebuild diagnostic routes through its validator without Bedrock", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "qd1n-standard-mutation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = path.join(directory, "state");
  const receipts = path.join(directory, "receipts");
  mkdirSync(state);
  mkdirSync(receipts);
  const runner = path.join(directory, "runner");
  const coworld = path.join(directory, "coworld");
  const docker = path.join(directory, "docker");
  const validator = path.join(directory, "validator");
  const lookup = path.join(directory, "lookup");
  const commandLog = path.join(directory, "command.log");
  executable(runner, `print -r -- '{"state":"free"}'`);
  executable(docker, `print -r -- '${IMAGE}'`);
  writeFileSync(validator, `process.stdout.write('{"valid":true}\\n');\n`);
  executable(lookup, `print -r -- '{"label":"qd1n:v123","policy_version_id":"${POLICY_ID}"}'`);
  executable(coworld, `
case "$1" in
  player) print -r -- '[{"id":"${ODIN}","active":true}]' ;;
  upload-policy)
    printf '%s\\n' "$@" > "$COWORLD_ARGS_LOG"
    print -r -- 'Upload complete: qd1n:v123'
    ;;
  *) exit 64 ;;
esac
`);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const parentCommit = execFileSync("git", ["rev-parse", "HEAD^"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const preflight = path.join(directory, "preflight.json");
  writeFileSync(preflight, JSON.stringify({
    schema_version: 2,
    profile: "standard-rebuild",
    candidate: {
      policy_ref: "proxywar-agent-llm:std1-test-amd64",
      source_commit: sourceCommit,
      parent_commit: parentCommit,
      image_id: IMAGE,
    },
  }));
  const receipt = path.join(receipts, "upload.json");
  const result = spawnSync("/bin/zsh", [
    wrapper,
    "run",
    "diagnostic",
    preflight,
    receipt,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PROXYWAR_OPERATOR_STATE_ROOT: state,
      PROXYWAR_RUNNER_LEASE_SCRIPT: runner,
      PROXYWAR_COWORLD_BIN: coworld,
      PROXYWAR_DOCKER_BIN: docker,
      PROXYWAR_STANDARD_REBUILD_VALIDATOR: validator,
      PROXYWAR_POLICY_LOOKUP_BIN: lookup,
      PROXYWAR_POLICY_LOOKUP_ATTEMPTS: "1",
      COWORLD_ARGS_LOG: commandLog,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(commandLog, "utf8").trim().split("\n");
  assert.equal(args.includes("--use-bedrock"), false);
  assert.deepEqual(args.slice(0, 4), [
    "upload-policy",
    "proxywar-agent-llm:std1-test-amd64",
    "--name",
    "qd1n",
  ]);
  const recorded = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(recorded.preflight_profile, "standard-rebuild");
  assert.equal(recorded.status, "completed");
});
