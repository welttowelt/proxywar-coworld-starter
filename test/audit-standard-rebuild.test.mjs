import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "audit-standard-rebuild.mjs");
const validator = path.join(root, "scripts", "validate-standard-rebuild.mjs");
const IMAGE = `sha256:${"c".repeat(64)}`;
const PARENT_IMAGE = `sha256:${"d".repeat(64)}`;
const MICKEY = "ply_e982e621-9ca3-47cd-8151-f57ee9d99421";

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runGit(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function roster() {
  return [
    { name: "K1Z odin free" },
    { name: "K1Z Mickey Mouse" },
    { name: "Daveey" },
  ];
}

function fixtureSpec(map, arm, seed) {
  const subjectPolicy = arm === "candidate" ? "qd1n-std1" : "qd1n-v97";
  return {
    schema_version: 1,
    game_config: {
      map,
      seed,
      map_size: "Normal",
      difficulty: "Easy",
      num_agents: 3,
      max_decision_steps: 300,
      turns_per_decision_step: 100,
      max_decision_ms: 15_000,
      replay_tail_turns: 0,
      episode_timeout_seconds: 3_600,
      player_connect_timeout_seconds: 120,
    },
    players: roster().map((player, slot) => ({
      name: player.name,
      policy: slot === 0 ? subjectPolicy : "qd1n-v97",
      cwd: slot === 0 && arm === "candidate"
        ? "policies/qd1n-std1/app"
        : "policies/qd1n-v97/app",
      run: ["node", "llm-player.mjs"],
      env: {
        ...(slot === 0 && arm === "candidate" ? { POLICY_CODENAME: "std1" } : {}),
        AWS_EC2_METADATA_DISABLED: "true",
      },
    })),
  };
}

function createSourceRepository(base) {
  const repository = path.join(base, "source-repo");
  mkdirSync(path.join(repository, "scripts"), { recursive: true });
  mkdirSync(path.join(repository, "experiments"), { recursive: true });
  runGit(repository, ["init", "-q"]);
  runGit(repository, ["config", "user.name", "Fixture"]);
  runGit(repository, ["config", "user.email", "fixture@example.invalid"]);
  const closure = [
    "llm-player.mjs",
    "standard-controller.mjs",
    "controller-safety.mjs",
    "package.json",
    "package-lock.json",
    "Dockerfile",
  ];
  for (const name of closure) writeFileSync(path.join(repository, name), `parent ${name}\n`);
  writeFileSync(
    path.join(repository, "scripts", "benchmark-standard-controller.mjs"),
    "// benchmark\n",
  );
  writeFileSync(
    path.join(repository, "scripts", "audit-standard-qualifier.mjs"),
    "// qualifier\n",
  );
  writeFileSync(
    path.join(repository, "scripts", "run-standard-rebuild-runpod-four.sh"),
    "#!/bin/sh\n# dispatcher\n",
  );
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-q", "-m", "parent"]);
  const parentCommit = runGit(repository, ["rev-parse", "HEAD"]);
  for (const name of closure) writeFileSync(path.join(repository, name), `candidate ${name}\n`);
  const cells = [
    ["Pangaea", "candidate", 20260721],
    ["Pangaea", "control", 20260721],
    ["World", "candidate", 20260722],
    ["World", "control", 20260722],
  ].map(([map, arm, seed]) => {
    const basename = `std1-${map.toLowerCase()}-${arm}.json`;
    const relativePath = `experiments/${basename}`;
    const absolutePath = path.join(repository, relativePath);
    const document = fixtureSpec(map, arm, seed);
    writeJson(absolutePath, document);
    return {
      map,
      arm,
      seat: 0,
      spec_path: relativePath,
      spec_sha256: hash(absolutePath),
      document,
    };
  });
  const preregistrationPath = "experiments/std1-preregistration.json";
  const preregistrationAbsolute = path.join(repository, preregistrationPath);
  writeJson(preregistrationAbsolute, {
    schema_version: 1,
    profile: "standard-rebuild",
    control: {
      label: "qd1n:v97",
      policy_key: "qd1n-v97",
      source_commit: parentCommit,
      image_id: PARENT_IMAGE,
    },
    candidate_policy_key: "qd1n-std1",
    specs: cells.map(({ document: _document, spec_path, spec_sha256, ...cell }) => ({
      ...cell,
      path: spec_path,
      sha256: spec_sha256,
    })),
  });
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-q", "-m", "candidate"]);
  const sourceCommit = runGit(repository, ["rev-parse", "HEAD"]);
  return {
    repository,
    closure,
    sourceCommit,
    parentCommit,
    cells,
    preregistrationPath,
    preregistrationSha256: hash(preregistrationAbsolute),
  };
}

function decision(sequence, kind, id, metadata = {}, reason = `std1:${kind}`) {
  return {
    sequence,
    turnNumber: sequence * 100,
    username: "K1Z odin free",
    selectedLegalActionId: id,
    selectedActionKind: kind,
    selectedActionMetadata: metadata,
    legalActionIDs: [id, "hold"],
    reason,
    fallbackUsed: false,
    result: { accepted: true, reason: "accepted" },
  };
}

function openingDecisions(extra = []) {
  const records = [];
  for (let index = 1; index <= 18; index++) {
    records.push(decision(index, "attack", `expand:terra-nullius:35:${index}`, {
      expansion: true,
      troopPercent: 35,
    }, "std1:openinggrind"));
  }
  records.push(decision(19, "alliance_request", "alliance:mickey", {
    recipientID: MICKEY,
    recipientName: "K1Z Mickey Mouse",
  }, "std1:reverse_handshake"));
  records.push(decision(20, "build", "build:city", { unit: "City" }, "std1:openingbuild"));
  return [...records, ...extra];
}

function createRun(base, {
  map, arm, seed, tiles, score, won, spec, decisions = openingDecisions(),
}) {
  const lexicalDirectory = path.join(base, `${map.toLowerCase()}-${arm}`);
  mkdirSync(lexicalDirectory, { recursive: true });
  const directory = realpathSync(lexicalDirectory);
  const runDirectory = path.join(directory, "proxywar-runs", "run-fixture");
  mkdirSync(runDirectory, { recursive: true });
  const players = roster();
  writeJson(path.join(directory, "config.json"), { map, seed, players });
  const results = {
    game_id: `${map.slice(0, 3).toUpperCase()}${arm[0]}FIX1`,
    seed,
    winner_slot: won ? 0 : 2,
    scores: [score, 0.1, won ? 0.2 : 0.8],
    players: [
      { slot: 0, name: "K1Z odin free", score, tiles_owned: tiles, is_alive: true },
      { slot: 1, name: "K1Z Mickey Mouse", score: 0.1, tiles_owned: 50_000, is_alive: true },
      { slot: 2, name: "Daveey", score: won ? 0.2 : 0.8, tiles_owned: 80_000, is_alive: true },
    ],
  };
  const resultsPath = writeJson(path.join(directory, "results.json"), results);
  const snapshots = [100, 500, 1_000, 2_000].map((turn) => ({
    turnNumber: turn,
    players: [
      { playerID: "odin-game", username: "K1Z odin free", isAlive: true },
      { playerID: "mickey-game", username: "K1Z Mickey Mouse", isAlive: true },
      { playerID: "daveey-game", username: "Daveey", isAlive: true },
    ],
  }));
  const replayPath = writeJson(path.join(directory, "replay"), {
    runID: `run-${map}-${arm}`,
    gameID: `${map.slice(0, 3).toUpperCase()}${arm[0]}FIX1`,
    config: { map, seed, players },
    spectatorReplay: { snapshots },
  });
  const emittedDecisions = arm === "control"
    ? decisions.map((record) => ({
      ...record,
      reason: `rul:${record.selectedActionKind}`,
      fallbackUsed: true,
      llmPlannerDegraded: true,
    }))
    : decisions;
  const decisionsPath = path.join(runDirectory, "decisions.jsonl");
  writeFileSync(
    decisionsPath,
    `${emittedDecisions.map((record) => JSON.stringify({
      ...record,
      runID: `run-${map}-${arm}`,
      matchID: `${map.slice(0, 3).toUpperCase()}${arm[0]}FIX1`,
    })).join("\n")}\n`,
  );
  const policyKey = arm === "candidate" ? "qd1n-std1" : "qd1n-v97";
  const policies = [
    { key: "qd1n-std1", image_id: IMAGE, architecture: "amd64" },
    { key: "qd1n-v97", image_id: PARENT_IMAGE, architecture: "amd64" },
  ];
  const plannedPlayers = spec.document.players.map((player, slot) => ({ slot, ...player }));
  const runSpec = {
    sha256: spec.spec_sha256,
    manifest_role: arm === "candidate" ? "candidate" : "exact-parent",
  };
  writeJson(path.join(directory, "receipt.json"), {
    schema_version: 1,
    run_id: `runner-${map}-${arm}`,
    status: "passed",
    receipt_scope: "transport_and_artifact_integrity_only",
    evaluation_verdict: "not_evaluated",
    runtime_fingerprint: { status: "verified" },
    bundle_verification: { status: "verified", policies },
    post_run_attestation: {
      status: "stable",
      runtime_fingerprint: { status: "verified" },
      bundle_verification: { status: "verified", policies },
      run_spec: runSpec,
    },
    run_spec: runSpec,
    plan: { schema_version: 1, game_config: spec.document.game_config, players: plannedPlayers },
    results,
    primary_artifact_hashes: {
      "results.json": { sha256: hash(resultsPath) },
      replay: { sha256: hash(replayPath) },
    },
    artifacts: [{
      path: "proxywar-runs/run-fixture/decisions.jsonl",
      sha256: hash(decisionsPath),
      bytes: readFileSync(decisionsPath).length,
    }],
  });
  let qualifierReceiptPath = null;
  if (arm === "candidate") {
    const qualifierDirectory = path.join(directory, "qualifier");
    mkdirSync(qualifierDirectory, { recursive: true });
    qualifierReceiptPath = path.join(qualifierDirectory, "receipt.json");
    if (!existsSync(qualifierReceiptPath)) {
      writeJson(qualifierReceiptPath, {
        schema_version: 1,
        status: "passed",
        execution_class: "transport_canary",
      });
    }
  }
  return {
    directory, map, arm, seed, seat: 0, policy_key: policyKey, qualifierReceiptPath,
  };
}

function writeDispatcherReceipts(runs, source) {
  const pods = [
    { id: "7p0nqjordosvuy", name: "storm-evidence-32a" },
    { id: "9u8oumfcvyyhy5", name: "storm-evidence-32b" },
    { id: "877itccar33zdp", name: "storm-lazy-c" },
    { id: "76stn0v7q81d47", name: "storm-lazy-d" },
  ].map((pod, index) => ({
    index,
    ...pod,
    role: runs[index].arm,
    map: runs[index].map,
    formal_output: runs[index].directory,
    pre_start_status: "EXITED",
    post_stop_status: "EXITED",
    bundle_sha256: String(index + 1).repeat(64),
    extractor_sha256: String(index + 5).repeat(64),
    formal_receipt_sha256: hash(path.join(runs[index].directory, "receipt.json")),
    qualifier_receipt_sha256: runs[index].qualifierReceiptPath
      ? hash(runs[index].qualifierReceiptPath)
      : null,
  }));
  const outputs = runs.map((run) => run.directory);
  const receipt = {
    schema_version: "proxywar-standard-rebuild-dispatch-v1",
    status: "passed",
    recorded_at: "2026-07-21T00:00:00Z",
    run_id: "std1-fixture",
    execution_id: "fixture-execution",
    dispatcher: {
      path: "scripts/run-standard-rebuild-runpod-four.sh",
      sha256: hash(path.join(
        source.repository, "scripts", "run-standard-rebuild-runpod-four.sh",
      )),
    },
    lease: {
      owner: "odin",
      run_id: "std1-fixture",
      outputs,
      verified_status_sha256: "a".repeat(64),
    },
    pods,
    receipt_locations: outputs.map((output) => path.join(output, "dispatcher-receipt.json")),
  };
  for (const run of runs) {
    writeJson(path.join(run.directory, "dispatcher-receipt.json"), receipt);
  }
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "std1-auditor-"));
  const source = createSourceRepository(directory);
  const artifacts = source.closure.map((name) => ({ path: name }));
  const imageRoot = path.join(directory, "mock-image", "app");
  mkdirSync(imageRoot, { recursive: true });
  for (const artifact of artifacts.filter((entry) => entry.path !== "Dockerfile")) {
    writeFileSync(
      path.join(imageRoot, artifact.path),
      readFileSync(path.join(source.repository, artifact.path)),
    );
  }
  const mockBin = path.join(directory, "bin");
  mkdirSync(mockBin);
  const docker = path.join(mockBin, "docker");
  writeFileSync(docker, `#!/bin/sh
set -eu
case "$1 $2" in
  "image inspect") printf '%s|amd64|%s\\n' "$MOCK_IMAGE_ID" "$MOCK_SOURCE_COMMIT" ;;
  "create --entrypoint") printf '%s\\n' fixture-container ;;
  "cp fixture-container:"*) src="\${2#fixture-container:/app/}"; cp "$MOCK_IMAGE_ROOT/app/$src" "$3" ;;
  "rm -f") exit 0 ;;
  *) exit 2 ;;
esac
`);
  chmodSync(docker, 0o755);
  const benchmarkProducer = "scripts/benchmark-standard-controller.mjs";
  const benchmark = writeJson(path.join(directory, "benchmark.json"), {
    schema_version: "proxywar-standard-controller-benchmark-v2",
    source_commit: source.sourceCommit,
    image_id: IMAGE,
    producer: {
      path: benchmarkProducer,
      sha256: hash(path.join(source.repository, benchmarkProducer)),
    },
    executed_runtime: {
      image_id: IMAGE,
      files: Object.fromEntries([
        "llm-player.mjs",
        "standard-controller.mjs",
        "controller-safety.mjs",
      ].map((name) => [name, hash(path.join(source.repository, name))])),
    },
    iterations: 10_000,
    p50_ms: 0.1,
    p95_ms: 0.5,
    p99_ms: 0.8,
    max_ms: 1.2,
    microbenchmark: {
      iterations: 10_000, p50_ms: 0.01, p95_ms: 0.02, p99_ms: 0.03, max_ms: 0.1,
    },
    production: {
      iterations: 10_000,
      p50_ms: 0.1,
      p95_ms: 0.5,
      p99_ms: 0.8,
      max_ms: 1.2,
      action_count: 47,
      measured_path: ["JSON.parse", "decideResponse", "JSON.stringify"],
    },
  });
  const qualifierProducer = "scripts/audit-standard-qualifier.mjs";
  const qualifierRun = path.join(directory, "pangaea-candidate", "qualifier");
  const qualifierDecisionDirectory = path.join(qualifierRun, "proxywar-runs", "qualifier");
  mkdirSync(qualifierDecisionDirectory, { recursive: true });
  const qualifierDecisionPath = path.join(qualifierDecisionDirectory, "decisions.jsonl");
  writeFileSync(qualifierDecisionPath, `${JSON.stringify(openingDecisions()[0])}\n`);
  const qualifierResultsPath = writeJson(path.join(qualifierRun, "results.json"), {
    decision_count: 20,
    accepted_decision_count: 20,
  });
  const qualifierReplayPath = writeJson(path.join(qualifierRun, "replay"), {
    gameID: "QUALFIXTURE",
  });
  const qualifierArtifact = (filename) => ({
    path: path.relative(qualifierRun, filename).split(path.sep).join("/"),
    sha256: hash(filename),
    bytes: readFileSync(filename).length,
  });
  const qualifierRunSpec = {
    location: "bundle",
    relative_path: "specs/canary-candidate-player-specs.json",
    sha256: "b".repeat(64),
    manifest_label: "transport-canary-candidate",
    manifest_role: "candidate",
    execution_class: "transport_canary",
  };
  const qualifierPolicies = [
    { key: "qd1n-std1", image_id: IMAGE, architecture: "amd64" },
  ];
  const qualifierRunnerArtifacts = [
    qualifierResultsPath,
    qualifierReplayPath,
    qualifierDecisionPath,
  ].map(qualifierArtifact);
  const qualifierRunnerReceiptPath = writeJson(path.join(qualifierRun, "receipt.json"), {
    schema_version: 1,
    status: "passed",
    receipt_scope: "transport_and_artifact_integrity_only",
    evaluation_verdict: "not_evaluated",
    execution_class: "transport_canary",
    runtime_fingerprint: { status: "verified" },
    bundle_verification: {
      status: "verified",
      policies: qualifierPolicies,
      transport_canaries: [{
        label: "transport-canary-candidate",
        role: "candidate",
        path: qualifierRunSpec.relative_path,
        sha256: qualifierRunSpec.sha256,
      }],
    },
    post_run_attestation: {
      status: "stable",
      runtime_fingerprint: { status: "verified" },
      bundle_verification: { status: "verified", policies: qualifierPolicies },
      run_spec: qualifierRunSpec,
    },
    run_spec: qualifierRunSpec,
    plan: {
      players: [{ slot: 0, name: "K1Z odin free", policy: "qd1n-std1" }],
    },
    primary_artifact_hashes: {
      "results.json": qualifierArtifact(qualifierResultsPath),
      replay: qualifierArtifact(qualifierReplayPath),
    },
    artifacts: qualifierRunnerArtifacts,
  });
  const qualifier = writeJson(path.join(directory, "qualifier.json"), {
    schema_version: "proxywar-standard-qualifier-v1",
    source_commit: source.sourceCommit,
    image_id: IMAGE,
    policy_key: "qd1n-std1",
    subject_name: "K1Z odin free",
    producer: {
      path: qualifierProducer,
      sha256: hash(path.join(source.repository, qualifierProducer)),
    },
    run_dir: qualifierRun,
    artifacts: {
      "results.json": qualifierArtifact(qualifierResultsPath),
      replay: qualifierArtifact(qualifierReplayPath),
      "decisions.jsonl": qualifierArtifact(qualifierDecisionPath),
      "runner-receipt.json": qualifierArtifact(qualifierRunnerReceiptPath),
    },
    passed: true,
    decision_count: 20,
    accepted_decisions: 20,
    fallback_decisions: 0,
    degraded_decisions: 0,
    rejected_decisions: 0,
    illegal_decisions: 0,
    all_selected_ids_offered: true,
    result_counters_match: true,
    runner_attestation_verified: true,
  });
  const findSpec = (map, arm) => source.cells.find((cell) =>
    cell.map === map && cell.arm === arm
  );
  const runs = [
    createRun(directory, {
      map: "Pangaea", arm: "candidate", seed: 20260721,
      tiles: 160_000, score: 1, won: true, spec: findSpec("Pangaea", "candidate"),
    }),
    createRun(directory, {
      map: "Pangaea", arm: "control", seed: 20260721,
      tiles: 100_000, score: 0.25, won: false, spec: findSpec("Pangaea", "control"),
    }),
    createRun(directory, {
      map: "World", arm: "candidate", seed: 20260722,
      tiles: 150_000, score: 0.5, won: false, spec: findSpec("World", "candidate"),
    }),
    createRun(directory, {
      map: "World", arm: "control", seed: 20260722,
      tiles: 100_000, score: 0.2, won: false, spec: findSpec("World", "control"),
    }),
  ];
  writeDispatcherReceipts(runs, source);
  const contract = {
    schema_version: 1,
    profile: "standard-rebuild",
    control_runtime_mode: "credential-free-v97-deterministic-fallback",
    candidate: {
      source_repo: source.repository,
      source_commit: source.sourceCommit,
      parent_source_commit: source.parentCommit,
      image_id: IMAGE,
      parent_image_id: PARENT_IMAGE,
    },
    preregistration: {
      path: source.preregistrationPath,
      sha256: source.preregistrationSha256,
    },
    artifacts,
    benchmark_receipt_path: benchmark,
    qualifier_receipt_path: qualifier,
    runs,
  };
  const contractPath = writeJson(path.join(directory, "contract.json"), contract);
  const auditEnv = {
    ...process.env,
    PATH: `${mockBin}:${process.env.PATH}`,
    MOCK_IMAGE_ID: IMAGE,
    MOCK_SOURCE_COMMIT: source.sourceCommit,
    MOCK_IMAGE_ROOT: path.join(directory, "mock-image"),
  };
  return {
    directory,
    contract,
    contractPath,
    auditEnv,
    sourceCommit: source.sourceCommit,
    parentCommit: source.parentCommit,
    sourceRepo: source.repository,
  };
}

function audit(contractPath, env) {
  const result = spawnSync(process.execPath, [script, contractPath], {
    encoding: "utf8",
    env,
  });
  return { ...result, receipt: JSON.parse(result.stdout) };
}

test("four-cell auditor emits a validator-compatible passing receipt", () => {
  const { directory, contractPath, auditEnv, sourceCommit, parentCommit } = fixture();
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.receipt.verdict, "PASS_STANDARD_REBUILD");
  assert.equal(result.receipt.runs.length, 4);
  assert.equal(result.receipt.runs.every((run) => run.all_selected_ids_offered), true);

  const receiptPath = writeJson(path.join(directory, "audit.json"), result.receipt);
  const preupload = writeJson(path.join(directory, "preupload.json"), {
    schema_version: 1,
    verdict: "PASS_PREUPLOAD_RCI",
    unresolved_violations: [],
    candidate_source_commit: sourceCommit,
    candidate_image_id: IMAGE,
  });
  const preflight = writeJson(path.join(directory, "preflight.json"), {
    schema_version: 2,
    profile: "standard-rebuild",
    candidate: {
      policy_ref: "proxywar-agent-llm:std1-amd64",
      parent_label: "qd1n:v97",
      source_commit: sourceCommit,
      parent_commit: parentCommit,
      image_id: IMAGE,
      parent_image_id: PARENT_IMAGE,
      runtime_requires_bedrock: false,
    },
    local: { audit_receipt: { path: receiptPath, sha256: hash(receiptPath) } },
    rci: { preupload_receipt: { path: preupload, sha256: hash(preupload) } },
    release: { automatic: true, local_games: 4 },
  });
  const validated = spawnSync(process.execPath, [
    validator, preflight, "--require-diagnostic",
  ], { encoding: "utf8" });
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
});

test("missing offered-ID telemetry fails closed", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const decisionsFile = path.join(
    contract.runs[0].directory,
    "proxywar-runs",
    "run-fixture",
    "decisions.jsonl",
  );
  const records = readFileSync(decisionsFile, "utf8").trim().split("\n").map(JSON.parse);
  delete records[0].legalActionIDs;
  writeFileSync(decisionsFile, `${records.map(JSON.stringify).join("\n")}\n`);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.equal(result.receipt.verdict, "FAIL_STANDARD_REBUILD");
  assert.match(result.receipt.failures.join(" "), /offered-ID telemetry/);
});

test("decisions telemetry tampering is rejected by exact receipt hash and byte count", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const decisionsFile = path.join(
    contract.runs[0].directory,
    "proxywar-runs",
    "run-fixture",
    "decisions.jsonl",
  );
  writeFileSync(decisionsFile, `${readFileSync(decisionsFile, "utf8")} `);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /decisions\.jsonl bytes\/hash mismatched/);
  assert.equal(result.receipt.runs[0].decisions_receipt_bound, false);
});

test("candidate source commit must exist in the specified real Git repository", () => {
  const { contract, contractPath, auditEnv } = fixture();
  contract.candidate.source_commit = "f".repeat(40);
  writeJson(contractPath, contract);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /source_commit does not exist/);
});

test("Docker revision label must exactly bind the candidate source commit", () => {
  const { contractPath, auditEnv } = fixture();
  const result = audit(contractPath, {
    ...auditEnv,
    MOCK_SOURCE_COMMIT: "f".repeat(40),
  });
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /revision label/);
});

test("benchmark and qualifier receipts reject mismatched candidate provenance", () => {
  const benchmarkFixture = fixture();
  const benchmarkPath = benchmarkFixture.contract.benchmark_receipt_path;
  const benchmark = JSON.parse(readFileSync(benchmarkPath));
  benchmark.image_id = PARENT_IMAGE;
  writeJson(benchmarkPath, benchmark);
  const benchmarkResult = audit(
    benchmarkFixture.contractPath,
    benchmarkFixture.auditEnv,
  );
  assert.equal(benchmarkResult.status, 1);
  assert.match(benchmarkResult.receipt.failures.join(" "), /benchmark receipt candidate image ID/);

  const qualifierFixture = fixture();
  const qualifierPath = qualifierFixture.contract.qualifier_receipt_path;
  const qualifier = JSON.parse(readFileSync(qualifierPath));
  qualifier.producer.sha256 = "0".repeat(64);
  writeJson(qualifierPath, qualifier);
  const qualifierResult = audit(
    qualifierFixture.contractPath,
    qualifierFixture.auditEnv,
  );
  assert.equal(qualifierResult.status, 1);
  assert.match(qualifierResult.receipt.failures.join(" "), /producer script hash mismatched/);

  const sourceFixture = fixture();
  const sourcePath = sourceFixture.contract.benchmark_receipt_path;
  const sourceReceipt = JSON.parse(readFileSync(sourcePath));
  sourceReceipt.source_commit = sourceFixture.parentCommit;
  writeJson(sourcePath, sourceReceipt);
  const sourceResult = audit(sourceFixture.contractPath, sourceFixture.auditEnv);
  assert.equal(sourceResult.status, 1);
  assert.match(sourceResult.receipt.failures.join(" "), /candidate source commit mismatched/);
});

test("runner policy attestation must prove the subject image", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const receiptFile = path.join(contract.runs[0].directory, "receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile));
  for (const table of [
    receipt.bundle_verification.policies,
    receipt.post_run_attestation.bundle_verification.policies,
  ]) {
    table.find((policy) => policy.key === "qd1n-std1").image_id = PARENT_IMAGE;
  }
  writeJson(receiptFile, receipt);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /subject image ID was not proved/);
});

test("a top-score tie is not a declared win", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const candidate = contract.runs[0];
  const resultsFile = path.join(candidate.directory, "results.json");
  const results = JSON.parse(readFileSync(resultsFile));
  results.winner_slot = 2;
  results.players[2].score = results.players[0].score;
  results.scores[2] = results.scores[0];
  writeJson(resultsFile, results);
  const receiptFile = path.join(candidate.directory, "receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile));
  receipt.results = results;
  receipt.primary_artifact_hashes["results.json"].sha256 = hash(resultsFile);
  writeJson(receiptFile, receipt);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /candidate never finished first/);
});

test("K1Z harm is rejected unconditionally even when every outsider is dead", () => {
  const blocked = fixture();
  const harmfulDecision = decision(21, "attack", "attack:mickey-game:40", {
    targetID: "mickey-game",
    targetName: "K1Z Mickey Mouse",
    troopPercent: 40,
  }, "std1:attack");
  const run = blocked.contract.runs[0];
  const decisionsFile = path.join(
    run.directory, "proxywar-runs", "run-fixture", "decisions.jsonl",
  );
  writeFileSync(
    decisionsFile,
    `${openingDecisions([harmfulDecision]).map(JSON.stringify).join("\n")}\n`,
  );
  const replayFile = path.join(run.directory, "replay");
  const replay = JSON.parse(readFileSync(replayFile));
  replay.spectatorReplay.snapshots.at(-1).players[2].isAlive = false;
  writeJson(replayFile, replay);
  const runnerReceiptFile = path.join(run.directory, "receipt.json");
  const runnerReceipt = JSON.parse(readFileSync(runnerReceiptFile));
  runnerReceipt.primary_artifact_hashes.replay.sha256 = hash(replayFile);
  const decisionArtifact = runnerReceipt.artifacts.find((entry) =>
    entry.path.endsWith("decisions.jsonl")
  );
  decisionArtifact.sha256 = hash(decisionsFile);
  decisionArtifact.bytes = readFileSync(decisionsFile).length;
  writeJson(runnerReceiptFile, runnerReceipt);
  const failed = audit(blocked.contractPath, blocked.auditEnv);
  assert.equal(failed.status, 1);
  assert.match(failed.receipt.failures.join(" "), /normal_phase_k1z_harm/);
});

test("committed preregistration and exact v97 parent cannot be supplied by the caller", () => {
  const { contract, contractPath, auditEnv } = fixture();
  contract.candidate.parent_image_id = IMAGE;
  writeJson(contractPath, contract);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /exact preregistered qd1n:v97 parent/);
});

test("runner run_spec SHA must equal the committed cell spec", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const receiptFile = path.join(contract.runs[0].directory, "receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile));
  receipt.run_spec.sha256 = "0".repeat(64);
  receipt.post_run_attestation.run_spec.sha256 = "0".repeat(64);
  writeJson(receiptFile, receipt);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /runner attestation failed/);
});

test("full game config and complete non-subject player plan are committed", () => {
  for (const mutate of [
    (receipt) => { receipt.plan.game_config.max_decision_steps = 299; },
    (receipt) => { receipt.plan.players[1].env.EXTRA = "unregistered"; },
  ]) {
    const { contract, contractPath, auditEnv } = fixture();
    const receiptFile = path.join(contract.runs[0].directory, "receipt.json");
    const receipt = JSON.parse(readFileSync(receiptFile));
    mutate(receipt);
    writeJson(receiptFile, receipt);
    const result = audit(contractPath, auditEnv);
    assert.equal(result.status, 1);
    assert.match(result.receipt.failures.join(" "), /complete runner plan differs/);
  }
});

test("every opening neutral land attack must commit exactly 35 percent", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const run = contract.runs[0];
  const decisionsFile = path.join(
    run.directory, "proxywar-runs", "run-fixture", "decisions.jsonl",
  );
  const records = readFileSync(decisionsFile, "utf8").trim().split("\n").map(JSON.parse);
  records[0].selectedActionMetadata.troopPercent = 25;
  writeFileSync(decisionsFile, `${records.map(JSON.stringify).join("\n")}\n`);
  const receiptFile = path.join(run.directory, "receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile));
  const artifact = receipt.artifacts.find((entry) => entry.path.endsWith("decisions.jsonl"));
  artifact.sha256 = hash(decisionsFile);
  artifact.bytes = readFileSync(decisionsFile).length;
  writeJson(receiptFile, receipt);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /opening discipline failed/);
  assert.equal(result.receipt.runs[0].opening.reverse_handshakes, 1);
  assert.equal(result.receipt.runs[0].opening.proactive_social_actions, 0);
  assert.equal(result.receipt.runs[0].opening.neutral_land_attack_percent_violations.length, 1);
});

test("benchmark must prove execution of the committed image runtime", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const benchmark = JSON.parse(readFileSync(contract.benchmark_receipt_path));
  benchmark.executed_runtime.files["standard-controller.mjs"] = "0".repeat(64);
  writeJson(contract.benchmark_receipt_path, benchmark);
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /benchmark executed runtime standard-controller/);
});

test("dispatcher binds the four exact pods, lease, outputs, and receipts", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const dispatcherFile = path.join(contract.runs[0].directory, "dispatcher-receipt.json");
  const dispatcher = JSON.parse(readFileSync(dispatcherFile));
  dispatcher.pods[0].post_stop_status = "RUNNING";
  for (const run of contract.runs) {
    writeJson(path.join(run.directory, "dispatcher-receipt.json"), dispatcher);
  }
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(result.receipt.failures.join(" "), /dispatcher pod evidence is invalid/);
});

test("qualifier runner receipt is independently parsed instead of trusting its summary flag", () => {
  const { contract, contractPath, auditEnv } = fixture();
  const candidateRun = contract.runs.find((run) =>
    run.map === "Pangaea" && run.arm === "candidate"
  );
  const runnerReceiptPath = path.join(candidateRun.directory, "qualifier", "receipt.json");
  writeJson(runnerReceiptPath, {
    schema_version: 1,
    status: "passed",
    execution_class: "transport_canary",
  });
  const qualifier = JSON.parse(readFileSync(contract.qualifier_receipt_path));
  qualifier.artifacts["runner-receipt.json"].sha256 = hash(runnerReceiptPath);
  qualifier.artifacts["runner-receipt.json"].bytes = readFileSync(runnerReceiptPath).length;
  writeJson(contract.qualifier_receipt_path, qualifier);

  const dispatcherPath = path.join(contract.runs[0].directory, "dispatcher-receipt.json");
  const dispatcher = JSON.parse(readFileSync(dispatcherPath));
  dispatcher.pods[0].qualifier_receipt_sha256 = hash(runnerReceiptPath);
  for (const run of contract.runs) {
    writeJson(path.join(run.directory, "dispatcher-receipt.json"), dispatcher);
  }
  const result = audit(contractPath, auditEnv);
  assert.equal(result.status, 1);
  assert.match(
    result.receipt.failures.join(" "),
    /qualifier bound runner receipt attestation is invalid/,
  );
  assert.equal(qualifier.runner_attestation_verified, true);
});
