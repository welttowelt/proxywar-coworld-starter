import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASE_IMAGE,
  BASE_IMAGE_ID,
  NODE_SHA256,
  adaptStandaloneOpponentEntrypoint,
  deduplicateNodeModules,
  rewriteGravityStandaloneEntrypoint,
  validateImageRecord,
  validateInput,
} from "../scripts/prepare-mickey-runpod-bundle.mjs";

const H = "a".repeat(64);
const SOURCE = "b".repeat(40);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARM_INFO = {
  m0: ["evaluation-m0", "evaluation-m0-player.mjs"],
  "grow-opening": ["evaluation-grow-opening", "evaluation-grow-opening-player.mjs"],
  "grow-low-share": ["evaluation-grow-low-share", "evaluation-grow-low-share-player.mjs"],
  "convert-weakest": ["evaluation-convert-weakest", "evaluation-convert-weakest-player.mjs"],
  "convert-largest": ["evaluation-convert-largest", "evaluation-convert-largest-player.mjs"],
};

function evaluation(arm, index) {
  const [target, entrypoint] = ARM_INFO[arm];
  return {
    kind: "evaluation",
    policy_id: `mickey-static-eval/${arm}`,
    key: `mickey-static-eval-${arm}`,
    arm,
    docker_target: target,
    surrogate_source: "static-eval-v1",
    source_commit: SOURCE,
    local_reference: `proxywar-agent-llm:mickey-${arm}`,
    image_id: `sha256:${String(index).repeat(64)}`,
    architecture: "amd64",
    image_user: "node",
    working_dir: "/app",
    container_entrypoint: ["docker-entrypoint.sh"],
    container_cmd: ["node", `/app/${entrypoint}`],
    upload_label: "false",
    upload_eligible: false,
    bundle_root: `policies/mickey-static-eval-${arm}/app`,
    run: ["node", entrypoint],
    entrypoint_sha256: H,
  };
}

function opponent() {
  return {
    kind: "opponent",
    policy_id: null,
    key: "opponent-v89",
    arm: null,
    docker_target: null,
    surrogate_source: null,
    source_commit: null,
    local_reference: "proxywar-agent-llm:qd1n-v89-exact-amd64",
    image_id: `sha256:${"f".repeat(64)}`,
    architecture: "amd64",
    image_user: "",
    working_dir: "/app",
    container_entrypoint: ["docker-entrypoint.sh"],
    container_cmd: ["node", "/app/llm-player.mjs"],
    upload_label: null,
    upload_eligible: false,
    bundle_root: "policies/opponent-v89/app",
    run: ["node", "llm-player.mjs"],
    entrypoint_sha256: H,
  };
}

function fixture() {
  const arms = Object.keys(ARM_INFO).map((arm, index) => evaluation(arm, index + 1));
  const specs = [
    ["grow-opening-candidate", "candidate"],
    ["grow-low-share-candidate", "candidate"],
    ["grow-m0", "exact-parent"],
    ["convert-weakest-candidate", "candidate"],
    ["convert-largest-candidate", "candidate"],
    ["convert-m0", "exact-parent"],
  ].map(([label, role]) => ({
    label,
    source: `experiments/${label}.json`,
    archive_path: `specs/${label}.json`,
    sha256: H,
    role,
    max_decision_steps: 80,
  }));
  return {
    schema_version: 1,
    kind: "mickey_runpod_multi_policy_bundle",
    bundle_id: "mickey-static-eval-26c36eca",
    runtime: { image: BASE_IMAGE, image_id: BASE_IMAGE_ID, architecture: "amd64", node_sha256: NODE_SHA256 },
    source_reach_receipt: { path: "experiments/source-reach.json", sha256: H },
    pair_index: { path: "experiments/pair-index.json", sha256: H },
    shared_files: [
      "evaluation-static-intent-player.mjs",
      "evaluation-static-intent.mjs",
      "intent-controller.mjs",
      "strategy-engine.mjs",
    ].map((path) => ({ path, sha256: H })),
    policies: [...arms, opponent()],
    experiment_specs: specs,
  };
}

test("multi-policy bundle input requires M0, four distinct arms, and paired specs", () => {
  assert.equal(validateInput(fixture()).policies.length, 6);
  const missing = fixture();
  missing.policies.splice(1, 1);
  assert.throws(
    () => validateInput(missing),
    /all evaluators|M0 plus the four retained/,
  );
  const secret = fixture();
  secret.runtime.api_key = "forbidden";
  assert.throws(() => validateInput(secret), /secret-bearing/);
});

test("image validation rejects ID, architecture, user, CMD, and upload-label drift", () => {
  const policy = fixture().policies[0];
  const actual = {
    Id: policy.image_id,
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "node",
      WorkingDir: "/app",
      Entrypoint: ["docker-entrypoint.sh"],
      Cmd: policy.container_cmd,
      Labels: {
        "com.welttowelt.proxywar.upload-eligible": "false",
        "com.welttowelt.proxywar.evaluation-source": "static-eval-v1",
      },
    },
  };
  assert.equal(validateImageRecord(policy, actual), true);
  for (const mutate of [
    (copy) => { copy.Id = `sha256:${"e".repeat(64)}`; },
    (copy) => { copy.Architecture = "arm64"; },
    (copy) => { copy.Config.User = ""; },
    (copy) => { copy.Config.Cmd = ["node", "/app/llm-player.mjs"]; },
    (copy) => { copy.Config.Labels["com.welttowelt.proxywar.upload-eligible"] = "true"; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(() => validateImageRecord(policy, copy), /mismatch/);
  }
});

test("standalone opponent adapter removes Gravity's container-only /app roots exactly", () => {
  const source = [
    'import { createRequire } from "node:module";',
    'import { chooseAction } from "file:///app/strategy-engine.mjs";',
    'const require = createRequire("/app/package.json");',
    'const { WebSocket } = require("ws");',
  ].join("\n");
  const adapted = rewriteGravityStandaloneEntrypoint(source);
  assert.match(adapted, /from "\.\/strategy-engine\.mjs"/);
  assert.match(adapted, /createRequire\(import\.meta\.url\)/);
  assert.doesNotMatch(adapted, /file:\/\/\/app\/|createRequire\("\/app\//);
  assert.throws(
    () => rewriteGravityStandaloneEntrypoint(adapted),
    /expected standalone-adapter source is absent/,
  );
});

test("unrecognized opponents fail closed on container-only absolute roots", () => {
  const policy = opponent();
  assert.throws(
    () => adaptStandaloneOpponentEntrypoint(
      policy,
      'import "file:///app/strategy-engine.mjs";',
    ),
    /unsupported absolute \/app import/,
  );
  assert.deepEqual(
    adaptStandaloneOpponentEntrypoint(policy, 'import "./strategy-engine.mjs";'),
    { body: 'import "./strategy-engine.mjs";', receipt: null },
  );
});

test("deduplicated dependencies retain a node_modules ancestor for ESM imports", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mickey-node-modules-test."));
  try {
    const app = path.join(root, "policies", "opponent", "app");
    const modules = path.join(app, "node_modules");
    for (const packageName of ["outer", "inner"]) {
      const packageRoot = path.join(modules, packageName);
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        path.join(packageRoot, "package.json"),
        `${JSON.stringify({ name: packageName, type: "module", exports: "./index.mjs" })}\n`,
      );
    }
    writeFileSync(
      path.join(modules, "outer", "index.mjs"),
      'import value from "inner"; export default `outer:${value}`;\n',
    );
    writeFileSync(path.join(modules, "inner", "index.mjs"), 'export default "inner";\n');
    writeFileSync(
      path.join(app, "main.mjs"),
      'import value from "outer"; console.log(value);\n',
    );

    const result = deduplicateNodeModules(root, [
      { key: "opponent", bundle_root: "policies/opponent/app" },
    ]);
    assert.deepEqual(result, { unique_node_modules_trees: 1, linked_policy_trees: 1 });
    assert.equal(path.basename(readlinkSync(path.join(app, "node_modules"))), "node_modules");
    const launched = spawnSync(process.execPath, [path.join(app, "main.mjs")], {
      encoding: "utf8",
    });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stdout.trim(), "outer:inner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated fanout index binds four distinct matched cells per arm", () => {
  const input = JSON.parse(readFileSync(path.join(REPO_ROOT, "experiments/mickey-runpod-multi-policy-bundle-input-20260721.json"), "utf8"));
  validateInput(input);
  const indexPath = path.join(REPO_ROOT, input.pair_index.path);
  const indexBody = readFileSync(indexPath);
  assert.equal(createHash("sha256").update(indexBody).digest("hex"), input.pair_index.sha256);
  const index = JSON.parse(indexBody);
  assert.equal(index.pair_count, 16);
  const specs = new Map(input.experiment_specs.map((spec) => [spec.archive_path, spec]));
  const perArm = new Map();
  for (const pair of index.pairs) {
    const candidateMeta = specs.get(pair.candidate_spec.archive_path);
    const m0Meta = specs.get(pair.m0_spec.archive_path);
    assert.equal(candidateMeta.sha256, pair.candidate_spec.sha256);
    assert.equal(m0Meta.sha256, pair.m0_spec.sha256);
    const candidate = JSON.parse(readFileSync(path.join(REPO_ROOT, candidateMeta.source), "utf8"));
    const m0 = JSON.parse(readFileSync(path.join(REPO_ROOT, m0Meta.source), "utf8"));
    assert.deepEqual(candidate.game_config, m0.game_config);
    assert.equal(candidate.game_config.map, pair.map);
    assert.equal(candidate.game_config.seed, pair.seed);
    assert.ok(pair.seed >= 0 && pair.seed <= 308915775);
    assert.equal(candidate.game_config.max_decision_steps, pair.max_decision_steps);
    assert.equal(candidate.players[pair.seat].name, "K1Z Mickey Mouse");
    assert.equal(m0.players[pair.seat].name, "K1Z Mickey Mouse");
    assert.deepEqual(candidate.players[pair.seat].env, m0.players[pair.seat].env);
    for (let seat = 0; seat < candidate.players.length; seat += 1) {
      if (seat !== pair.seat) assert.deepEqual(candidate.players[seat], m0.players[seat]);
    }
    assert.deepEqual(candidate.players.map((player) => player.name), pair.roster.map((player) => player.name));
    const arm = perArm.get(pair.arm) ?? { maps: new Set(), seats: new Set(), cells: new Set() };
    arm.maps.add(pair.map);
    arm.seats.add(pair.seat);
    arm.cells.add(`${pair.map}:${pair.seed}:${pair.seat}`);
    perArm.set(pair.arm, arm);
    const outsiderCount = pair.roster.filter((player) => player.coalition === "outsider").length;
    assert.equal(outsiderCount, pair.roster_class === "mixed-outsider-convert" ? 1 : 0);
  }
  assert.equal(perArm.size, 4);
  for (const arm of perArm.values()) {
    assert.equal(arm.cells.size, 4);
    assert.equal(arm.maps.size, 2);
    assert.equal(arm.seats.size, 2);
  }
  for (const [armID] of perArm) {
    const armPairs = index.pairs.filter((pair) => pair.arm === armID);
    for (const mapName of new Set(armPairs.map((pair) => pair.map))) {
      const mirrors = armPairs.filter((pair) => pair.map === mapName);
      assert.equal(new Set(mirrors.map((pair) => pair.seed)).size, 1);
      assert.deepEqual(new Set(mirrors.map((pair) => pair.seat)), new Set([0, 2]));
      assert.deepEqual(
        mirrors.map((pair) => pair.roster.map((player) => `${player.name}:${player.coalition}`).sort()),
        [
          mirrors[0].roster.map((player) => `${player.name}:${player.coalition}`).sort(),
          mirrors[0].roster.map((player) => `${player.name}:${player.coalition}`).sort(),
        ],
      );
    }
  }
});
