import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = "a".repeat(40);
const PARENT = "b".repeat(40);
const IMAGE = `sha256:${"c".repeat(64)}`;
const PARENT_IMAGE = `sha256:${"d".repeat(64)}`;
const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const PREREG = "9".repeat(64);

function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return {
    path: file,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  };
}

function run(directory, preflight, mode) {
  const file = path.join(directory, "preflight.json");
  writeFileSync(file, JSON.stringify(preflight));
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "validate-standard-rebuild.mjs"),
    file,
    mode,
  ], { encoding: "utf8" });
  return { ...result, report: JSON.parse(result.stdout) };
}

function runRecord(map, arm, index) {
  const candidate = arm === "candidate";
  const controlDegradation = Array.from({ length: 40 }, (_, sequence) => ({
    sequence,
    reason: "rul:atk",
  }));
  return {
    run_id: `${map.toLowerCase()}-${arm}`,
    pair_id: map.toLowerCase(),
    map,
    arm,
    seed: map === "Pangaea" ? 20260721 : 20260722,
    seat: map === "Pangaea" ? 1 : 5,
    roster_sha256: "e".repeat(64),
    matched_plan_sha256: "f".repeat(64),
    preregistration_sha256: PREREG,
    spec_path: `experiments/${map.toLowerCase()}-${arm}.json`,
    spec_sha256: (index + 8).toString(16).repeat(64),
    run_spec_sha256: (index + 8).toString(16).repeat(64),
    replay_sha256: String(index).repeat(64),
    decisions_sha256: String(index + 4).repeat(64),
    decisions_bytes: 1_000 + index,
    decisions_receipt_bound: true,
    runner_receipt_sha256: "cdef"[index - 1].repeat(64),
    image_id: candidate ? IMAGE : PARENT_IMAGE,
    decision_count: 40,
    accepted_decisions: 40,
    all_selected_ids_offered: true,
    illegal_decisions: [],
    rejected_decisions: [],
    unexplained_holds: [],
    fallback_decisions: candidate ? [] : controlDegradation,
    degraded_decisions: candidate ? [] : controlDegradation,
    normal_phase_k1z_harm: [],
    unresolved_harmful_targets: [],
    score: candidate ? 1 : 0.25,
    final_tiles: candidate ? 150_000 : 100_000,
    won: candidate,
    ...(candidate ? {
      opening: {
        active_decisions: 20,
        conquest_actions: 18,
        proactive_social_actions: 0,
        reverse_handshakes: 1,
        build_actions: 1,
        upgrade_actions: 0,
        boat_actions: 0,
        forced_neutral_boat_actions: 0,
        neutral_land_attacks: 18,
        neutral_land_attack_percent_violations: [],
      },
    } : {}),
  };
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "standard-rebuild-"));
  const audit = {
    schema_version: 1,
    profile: "standard-rebuild",
    verdict: "PASS_STANDARD_REBUILD",
    failures: [],
    image_binding_method: "docker-image-id+git-commit+revision-label",
    image_revision_label: SOURCE,
    source_commit_verified: true,
    candidate_source_repo: "/tmp/fixture-source-repo",
    control_runtime_mode: "credential-free-v97-deterministic-fallback",
    candidate_source_commit: SOURCE,
    candidate_image_id: IMAGE,
    parent_source_commit: PARENT,
    parent_image_id: PARENT_IMAGE,
    preregistration: {
      path: "experiments/std1-preregistration.json",
      sha256: PREREG,
      candidate_source_commit: SOURCE,
      source_commit_bound: true,
      parent_label: "qd1n:v97",
      parent_source_commit: PARENT,
      parent_image_id: PARENT_IMAGE,
      specs: [
        ["Pangaea", "candidate", 1],
        ["Pangaea", "control", 2],
        ["World", "candidate", 3],
        ["World", "control", 4],
      ].map(([map, arm, index]) => ({
        map,
        arm,
        seat: map === "Pangaea" ? 1 : 5,
        path: `experiments/${map.toLowerCase()}-${arm}.json`,
        sha256: (index + 8).toString(16).repeat(64),
      })),
    },
    artifacts: [...[
      "llm-player.mjs",
      "standard-controller.mjs",
      "controller-safety.mjs",
      "package.json",
      "package-lock.json",
      "Dockerfile",
    ]].map((artifact, index) => ({
      path: artifact,
      source_sha256: (index + 6).toString(16).repeat(64),
      image_sha256: artifact === "Dockerfile"
        ? null
        : (index + 6).toString(16).repeat(64),
      binding: artifact === "Dockerfile"
        ? "git-blob+image-revision-label"
        : "git-blob+docker-image-id",
    })),
    benchmark: {
      iterations: 10_000,
      p95_ms: 1.2,
      p99_ms: 2.2,
      max_ms: 40,
      action_count: 47,
      measured_path: ["JSON.parse", "decideResponse", "JSON.stringify"],
      candidate_binding_verified: true,
      executed_runtime_verified: true,
      executed_runtime: {
        image_id: IMAGE,
        files: {
          "llm-player.mjs": "1".repeat(64),
          "standard-controller.mjs": "2".repeat(64),
          "controller-safety.mjs": "3".repeat(64),
        },
      },
      producer: {
        script_path: "scripts/benchmark-standard-controller.mjs",
        script_sha256: "5".repeat(64),
      },
    },
    qualifier: {
      passed: true,
      decision_count: 20,
      accepted_decisions: 20,
      fallback_decisions: 0,
      degraded_decisions: 0,
      rejected_decisions: 0,
      illegal_decisions: 0,
      all_selected_ids_offered: true,
      result_counters_match: true,
      candidate_binding_verified: true,
      artifacts_verified: true,
      runner_attestation_verified: true,
      runner_attestation_independently_verified: true,
      producer: {
        script_path: "scripts/audit-standard-qualifier.mjs",
        script_sha256: "4".repeat(64),
      },
    },
    runs: [
      runRecord("Pangaea", "candidate", 1),
      runRecord("Pangaea", "control", 2),
      runRecord("World", "candidate", 3),
      runRecord("World", "control", 4),
    ],
  };
  audit.dispatcher = {
    verified: true,
    sha256: "8".repeat(64),
    run_id: "std1-fixture",
    execution_id: "fixture-execution",
    dispatcher_script_sha256: "7".repeat(64),
    pods: [
      { id: "lb4zz7jzgq9tr2", name: "storm-lazy-a", map: "Pangaea", role: "candidate" },
      { id: "2g5whxhph9bwbz", name: "storm-lazy-b", map: "Pangaea", role: "control" },
      { id: "877itccar33zdp", name: "storm-lazy-c", map: "World", role: "candidate" },
      { id: "76stn0v7q81d47", name: "storm-lazy-d", map: "World", role: "control" },
    ].map((pod, index) => ({
      index,
      ...pod,
      pre_start_status: "EXITED",
      post_stop_status: "EXITED",
      formal_receipt_sha256: audit.runs[index].runner_receipt_sha256,
      qualifier_receipt_sha256: pod.role === "candidate" ? "6".repeat(64) : null,
    })),
  };
  const preupload = {
    schema_version: 1,
    verdict: "PASS_PREUPLOAD_RCI",
    unresolved_violations: [],
    candidate_source_commit: SOURCE,
    candidate_image_id: IMAGE,
  };
  const preflight = {
    schema_version: 2,
    profile: "standard-rebuild",
    candidate: {
      policy_ref: "proxywar-agent-llm:std1-amd64",
      parent_label: "qd1n:v97",
      parent_commit: PARENT,
      parent_image_id: PARENT_IMAGE,
      source_commit: SOURCE,
      image_id: IMAGE,
      runtime_requires_bedrock: false,
    },
    local: { audit_receipt: writeJson(directory, "audit.json", audit) },
    rci: { preupload_receipt: writeJson(directory, "preupload.json", preupload) },
    release: { automatic: true, local_games: 4 },
  };
  return { directory, audit, preflight };
}

test("standard rebuild diagnostic accepts the exact four-game contract", () => {
  const { directory, preflight } = fixture();
  const result = run(directory, preflight, "--require-diagnostic");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.valid, true);
  assert.equal(result.report.profile, "standard-rebuild");
});

test("standard rebuild rejects normal-phase K1Z harm", () => {
  const { directory, audit, preflight } = fixture();
  audit.runs[0].normal_phase_k1z_harm.push({ action_id: "attack:mickey:40" });
  preflight.local.audit_receipt = writeJson(directory, "harm-audit.json", audit);
  const result = run(directory, preflight, "--require-diagnostic");
  assert.equal(result.status, 1);
  assert.match(result.report.errors.join(" "), /normal_phase_k1z_harm/);
});

test("standard rebuild rejects a full-plan pair mismatch", () => {
  const { directory, audit, preflight } = fixture();
  audit.runs[0].matched_plan_sha256 = "0".repeat(64);
  preflight.local.audit_receipt = writeJson(directory, "plan-mismatch-audit.json", audit);
  const result = run(directory, preflight, "--require-diagnostic");
  assert.equal(result.status, 1);
  assert.match(result.report.errors.join(" "), /full-plan matched/);
});

test("standard rebuild rejects missing benchmark and qualifier runtime attestations", () => {
  for (const mutate of [
    (audit) => { audit.benchmark.executed_runtime_verified = false; },
    (audit) => { audit.qualifier.runner_attestation_verified = false; },
  ]) {
    const { directory, audit, preflight } = fixture();
    mutate(audit);
    preflight.local.audit_receipt = writeJson(directory, "runtime-audit.json", audit);
    const result = run(directory, preflight, "--require-diagnostic");
    assert.equal(result.status, 1);
  }
});

test("promotion additionally binds upload identity and final RCI", () => {
  const { directory, preflight } = fixture();
  preflight.candidate.uploaded_label = "qd1n:v123";
  preflight.candidate.policy_version_id = POLICY_ID;
  preflight.candidate.upload_receipt = writeJson(directory, "upload.json", {
    schema_version: 2,
    mode: "diagnostic",
    status: "completed",
    candidate_source_commit: SOURCE,
    candidate_image_id: IMAGE,
    uploaded_label: "qd1n:v123",
    policy_version_id: POLICY_ID,
  });
  preflight.rci.final_receipt = writeJson(directory, "final.json", {
    schema_version: 1,
    verdict: "PASS_FINAL_RCI",
    unresolved_violations: [],
    candidate_source_commit: SOURCE,
    candidate_image_id: IMAGE,
    candidate_policy_version_id: POLICY_ID,
  });
  const result = run(directory, preflight, "--require-promotion");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.promotion_eligible, true);
});
