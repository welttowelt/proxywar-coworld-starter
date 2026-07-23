import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
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
const wrapper = path.join(root, "scripts", "proxywar-mickey-mutation.sh");
const validator = path.join(root, "scripts", "validate-mickey-mutation-gate.mjs");
const PLAYER = "ply_11111111-1111-4111-8111-111111111111";
const OTHER_PLAYER = "ply_22222222-2222-4222-8222-222222222222";
const LEAGUE = "league_33333333-3333-4333-8333-333333333333";
const POLICY_ID = "44444444-4444-4444-8444-444444444444";
const IMAGE = `sha256:${"a".repeat(64)}`;
const LABEL = "mickey-mouse-intent:v7";
const SERVER = "https://softmax.com/api";

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function binding(file) {
  return { path: file, sha256: sha256File(file) };
}

function executable(file, body) {
  writeFileSync(file, `#!/bin/zsh\nset -euo pipefail\n${body}\n`);
  chmodSync(file, 0o755);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function remoteCommits() {
  const source = execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const parent = execFileSync("git", ["rev-parse", `${source}^`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { source, parent };
}

function receipt(directory, name, value) {
  return binding(writeJson(path.join(directory, `${name}.json`), value));
}

function fixture({ roster, credential = "mickey-distinct-session\n" } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mickey-mutation-"));
  const state = path.join(directory, "state");
  const receipts = path.join(directory, "receipts");
  const evidence = path.join(directory, "evidence");
  const primaryHome = path.join(directory, "primary-home");
  const mickeyHome = path.join(directory, "mickey-home");
  for (const target of [state, receipts, evidence, primaryHome, mickeyHome]) {
    mkdirSync(target, { mode: 0o700 });
  }
  for (const home of [primaryHome, mickeyHome]) {
    mkdirSync(path.join(home, ".softmax"), { mode: 0o700 });
  }
  writeFileSync(path.join(primaryHome, ".softmax", "credentials.yaml"), "primary-session\n", { mode: 0o600 });
  const credentialPath = path.join(mickeyHome, ".softmax", "credentials.yaml");
  writeFileSync(credentialPath, credential, { mode: 0o600 });
  chmodSync(primaryHome, 0o700);
  chmodSync(mickeyHome, 0o700);
  chmodSync(path.join(primaryHome, ".softmax"), 0o700);
  chmodSync(path.join(mickeyHome, ".softmax"), 0o700);
  chmodSync(path.join(primaryHome, ".softmax", "credentials.yaml"), 0o600);
  chmodSync(credentialPath, 0o600);

  const runner = path.join(directory, "runner");
  const coworld = path.join(directory, "coworld");
  const docker = path.join(directory, "docker");
  const lookup = path.join(directory, "lookup");
  const commandLog = path.join(directory, "coworld-args.log");
  const homeLog = path.join(directory, "coworld-home.log");
  const queryLog = path.join(directory, "player-query-count.log");
  executable(runner, "print -r -- '{\"state\":\"free\"}'");
  executable(docker, `print -r -- ${shellQuote(IMAGE)}`);
  executable(lookup, `
label="$1"
print -r -- "{\\"label\\":\\"$label\\",\\"policy_version_id\\":\\"${POLICY_ID}\\"}"
`);
  const defaultRoster = [{ id: PLAYER, name: "K1Z Mickey Mouse", active: true }];
  const rosterJson = JSON.stringify(roster ?? defaultRoster);
  executable(coworld, `
case "$1" in
  player)
    print x >> ${shellQuote(queryLog)}
    print -r -- ${shellQuote(rosterJson)}
    ;;
  upload-policy)
    print -r -- "$HOME" > ${shellQuote(homeLog)}
    printf '%s\\n' "$@" > ${shellQuote(commandLog)}
    print -r -- 'Upload complete: ${LABEL}'
    ;;
  submit)
    print -r -- "$HOME" > ${shellQuote(homeLog)}
    printf '%s\\n' "$@" > ${shellQuote(commandLog)}
    print -r -- 'Submitted to league'
    ;;
  *)
    exit 64
    ;;
esac
`);
  const { source, parent } = remoteCommits();
  const localAudit = receipt(evidence, "local-audit", {
    status: "passed",
    verdict: "PASS_LOCAL_MECHANISM",
    candidate_source_commit: source,
    candidate_image_id: IMAGE,
    mechanism_reach: 3,
    accepted_actions: 24,
    unexplained_holds: 0,
    rejections: 0,
    k1z_harm: 0,
  });
  const preuploadRci = receipt(evidence, "preupload-rci", {
    status: "passed",
    verdict: "PASS_PREUPLOAD_RCI",
    candidate_source_commit: source,
    candidate_image_id: IMAGE,
    unresolved_violations: [],
  });
  return {
    directory,
    state,
    receipts,
    evidence,
    primaryHome,
    mickeyHome,
    credentialPath,
    credentialSha: sha256File(credentialPath),
    runner,
    coworld,
    docker,
    lookup,
    commandLog,
    homeLog,
    queryLog,
    source,
    parent,
    localAudit,
    preuploadRci,
    gate: path.join(directory, "gate.json"),
  };
}

function uploadGate(context) {
  return {
    schema_version: 1,
    lane: "mickey",
    action: "upload",
    expected_player_id: PLAYER,
    expected_league_id: LEAGUE,
    candidate: {
      policy_name: "mickey-mouse-intent",
      policy_ref: "proxywar-agent-llm:mickey-test-amd64",
      source_commit: context.source,
      parent_commit: context.parent,
      image_id: IMAGE,
      entrypoint: "/app/llm-player.mjs",
    },
    gates: {
      source_ready: true,
      local_mechanism_verified: true,
      mechanism_reach: 3,
      accepted_actions: 24,
      unexplained_holds: 0,
      rejections: 0,
      k1z_harm: 0,
      preupload_rci_passed: true,
    },
    evidence: {
      local_audit: context.localAudit,
      preupload_rci: context.preuploadRci,
    },
  };
}

function submitGate(context) {
  const upload = receipt(context.evidence, "upload", {
    schema_version: 1,
    lane: "mickey",
    mode: "upload",
    status: "completed",
    active_player_id: PLAYER,
    expected_player_id: PLAYER,
    league_id: LEAGUE,
    credential_isolated: true,
    exclusive_player_roster: true,
    candidate_source_commit: context.source,
    candidate_image_id: IMAGE,
    candidate_policy_ref: "proxywar-agent-llm:mickey-test-amd64",
    uploaded_label: LABEL,
    policy_version_id: POLICY_ID,
  });
  const cleanExperience = (episodes, markerRequired) => ({
    status: "completed",
    passed: true,
    episodes,
    wins: episodes,
    decisions: episodes * 2,
    accepted: episodes * 2,
    rejected: 0,
    unconfirmed_acceptance: 0,
    illegal_selections: 0,
    unexplained_holds: 0,
    k1z_harm_count: 0,
    unresolved_harmful_targets: 0,
    marker_count: markerRequired ? episodes : 0,
    nondegraded_marker_count: markerRequired ? episodes : 0,
    invalid_marker_count: 0,
    checks: {
      request_completed: true,
      exact_episode_count: true,
      all_episode_records_completed: true,
      exact_replay_evidence_count: true,
      perfect_episode_wins: true,
      all_decisions_accepted: true,
      all_selected_actions_legal: true,
      zero_rejected_decisions: true,
      zero_unexplained_holds: true,
      zero_k1z_harm: true,
      zero_unresolved_harmful_targets: true,
      selected_marker_reached: true,
      selected_marker_nondegraded: true,
      zero_invalid_marker_executions: true,
      ...(episodes === 20 ? {
        separate_request_id: true,
        separate_replay_evidence: true,
        regression_evidence_provided: true,
      } : {}),
    },
  });
  const hostedRegression = receipt(context.evidence, "hosted-regression", {
    schema_version: 1,
    kind: "mickey_hosted_evidence_audit",
    evidence_scope: "hosted_and_regression_only",
    candidate: {
      player_name: "K1Z Mickey Mouse",
      policy_ref: LABEL,
      policy_version_id: POLICY_ID,
      marker: "mm1g",
    },
    matched_baseline: {
      passed: true,
      checks: {
        distinct_request_ids: true,
        candidate_request_completed: true,
        baseline_request_completed: true,
        same_variant: true,
        same_roster_and_game_config: true,
      },
    },
    hosted: cleanExperience(4, true),
    regression: cleanExperience(20, false),
    confirmation: {
      matched_hosted_4_of_4_passed: true,
      separate_regression_20_of_20_passed: true,
      hosted_and_regression_evidence_passed: true,
      final_rci_still_required: true,
      live_identity_submission_membership_still_required: true,
      promotion_allowed: false,
    },
  });
  const finalRci = receipt(context.evidence, "final-rci", {
    status: "passed",
    verdict: "PASS_RCI",
    candidate_source_commit: context.source,
    candidate_image_id: IMAGE,
    candidate_policy_version_id: POLICY_ID,
    unresolved_violations: [],
  });
  const common = uploadGate(context);
  return {
    ...common,
    action: "submit",
    candidate: {
      ...common.candidate,
      uploaded_label: LABEL,
      policy_version_id: POLICY_ID,
    },
    gates: {
      ...common.gates,
      diagnostic_uploaded: true,
      hosted_passed: true,
      hosted_episodes: 4,
      hosted_wins: 4,
      regression_passed: true,
      regression_episodes: 20,
      regression_wins: 20,
      final_rci_passed: true,
    },
    evidence: {
      ...common.evidence,
      upload_receipt: upload,
      hosted_regression_audit: hostedRegression,
      final_rci: finalRci,
    },
  };
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
    PROXYWAR_MICKEY_GATE_VALIDATOR: validator,
    PROXYWAR_PRIMARY_HOME: context.primaryHome,
    PROXYWAR_MICKEY_HOME: context.mickeyHome,
    PROXYWAR_MICKEY_CREDENTIAL_SHA256: context.credentialSha,
    PROXYWAR_MICKEY_EXPECTED_PLAYER_ID: PLAYER,
    PROXYWAR_MICKEY_EXPECTED_LEAGUE_ID: LEAGUE,
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

test("read-only status reports an absent dedicated credential without invoking Coworld", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  rmSync(context.credentialPath);
  const result = invoke(context, ["status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.state, "free");
  assert.equal(status.identity.state, "credential_absent");
  assert.equal(status.identity.active_player_id, null);
  assert.equal(existsSync(context.queryLog), false);
  assert.equal(existsSync(context.commandLog), false);
});

test("status verifies only an exclusive exact Mickey identity under the dedicated HOME", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  const result = invoke(context, ["status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.identity.state, "verified");
  assert.equal(status.identity.active_player_id, PLAYER);
  assert.equal(readFileSync(context.queryLog, "utf8").trim(), "x");
  assert.equal(existsSync(context.commandLog), false);
});

test("same primary credential is refused before any account query or mutation", (t) => {
  const context = fixture({ credential: "primary-session\n" });
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const receiptPath = path.join(context.receipts, "blocked.json");
  const result = invoke(context, [
    "run", "upload", context.gate, receiptPath,
  ]);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /matches the primary account credential/);
  assert.equal(existsSync(context.queryLog), false);
  assert.equal(existsSync(context.commandLog), false);
  const recorded = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(recorded.credential_isolated, false);
  assert.equal(recorded.exclusive_player_roster, false);
});

test("a non-exclusive roster is refused as same-account reuse", (t) => {
  const context = fixture({
    roster: [
      { id: PLAYER, name: "K1Z Mickey Mouse", active: true },
      { id: OTHER_PLAYER, name: "Existing Player", active: false },
    ],
  });
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const receiptPath = path.join(context.receipts, "blocked.json");
  const result = invoke(context, ["run", "upload", context.gate, receiptPath]);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /non-exclusive player roster/);
  assert.equal(existsSync(context.commandLog), false);
  const recorded = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(recorded.status, "blocked");
  assert.equal(recorded.credential_isolated, true);
  assert.equal(recorded.exclusive_player_roster, false);
});

test("a dedicated account without the pinned Mickey player is refused as absent", (t) => {
  const context = fixture({
    roster: [{ id: OTHER_PLAYER, name: "Unrelated Player", active: true }],
  });
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const result = invoke(context, [
    "run", "upload", context.gate, path.join(context.receipts, "blocked.json"),
  ]);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /expected Mickey player is absent/);
  assert.equal(existsSync(context.commandLog), false);
});

test("an inactive expected player is refused as an exact identity mismatch", (t) => {
  const context = fixture({ roster: [{ id: PLAYER, name: "K1Z Mickey Mouse", active: false }] });
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const result = invoke(context, [
    "run", "upload", context.gate, path.join(context.receipts, "blocked.json"),
  ]);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /does not match the exact expected Mickey player ID/);
  assert.equal(existsSync(context.commandLog), false);
});

test("upload constructs the exact command from a hash-bound upload gate", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const gateSha = sha256File(context.gate);
  const receiptPath = path.join(context.receipts, "upload.json");
  const result = invoke(context, ["run", "upload", context.gate, receiptPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(context.homeLog, "utf8").trim(), context.mickeyHome);
  assert.deepEqual(readFileSync(context.commandLog, "utf8").trim().split("\n"), [
    "upload-policy",
    "proxywar-agent-llm:mickey-test-amd64",
    "--name",
    "mickey-mouse-intent",
    "--use-bedrock",
    "--run",
    "node",
    "--run",
    "/app/llm-player.mjs",
    "--tag",
    `source_commit=${context.source}`,
    "--tag",
    `image_id=${"a".repeat(64)}`,
    "--server",
    SERVER,
  ]);
  const recorded = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.active_player_id, PLAYER);
  assert.equal(recorded.expected_player_id, PLAYER);
  assert.equal(recorded.credential_isolated, true);
  assert.equal(recorded.exclusive_player_roster, true);
  assert.equal(recorded.gate_snapshot_sha256, gateSha);
  assert.equal(recorded.uploaded_label, LABEL);
  assert.equal(recorded.policy_version_id, POLICY_ID);
  assert.equal(existsSync(path.join(context.state, "mickey.mutation.lock")), false);
});

test("unsafe local gate claims fail closed before upload", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  const gate = uploadGate(context);
  gate.gates.k1z_harm = 1;
  writeJson(context.gate, gate);
  const result = invoke(context, [
    "run", "upload", context.gate, path.join(context.receipts, "blocked.json"),
  ]);
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /upload gate validation failed/);
  assert.equal(existsSync(context.commandLog), false);
});

test("submit constructs only the evidence-bound label after 4/4, 20/20, and RCI", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, submitGate(context));
  const receiptPath = path.join(context.receipts, "submit.json");
  const result = invoke(context, ["run", "submit", context.gate, receiptPath]);
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
  const recorded = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.mode, "submit");
  assert.equal(recorded.uploaded_label, LABEL);
  assert.equal(recorded.policy_version_id, POLICY_ID);
});

test("free-form Coworld arguments are rejected before mutation", (t) => {
  const context = fixture();
  t.after(() => rmSync(context.directory, { recursive: true, force: true }));
  writeJson(context.gate, uploadGate(context));
  const result = invoke(context, [
    "run", "upload", context.gate, path.join(context.receipts, "forbidden.json"),
    "--", "submit",
  ]);
  assert.equal(result.status, 64);
  assert.equal(existsSync(context.queryLog), false);
  assert.equal(existsSync(context.commandLog), false);
});
