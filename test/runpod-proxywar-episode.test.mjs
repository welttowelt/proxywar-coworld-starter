import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BASE_IMAGE,
  assertSecretFreeControlEnvironment,
  assertAttestationStable,
  bindRunSpec,
  canonicalHash,
  classifyEarlyPlayerExit,
  forceFailureStatus,
  isForbiddenEnvName,
  redactSecrets,
  validateEpisodeResults,
  validateRunSpec,
  verifyBundleManifest,
  verifyRuntimeFingerprint,
} from "../scripts/runpod-proxywar-episode.mjs";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function manifestFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "proxywar-bundle-test-"));
  const policyRoot = path.join(root, "policies", "candidate", "app");
  const orchestratorPath = path.join(root, "bin", "orchestrator.mjs");
  await mkdir(policyRoot, { recursive: true });
  await mkdir(path.dirname(orchestratorPath), { recursive: true });
  await mkdir(path.join(root, "specs"), { recursive: true });
  for (const runtimeRoot of [
    "runtime/integration",
    "runtime/proxywar",
    "runtime/node",
  ]) {
    await mkdir(path.join(root, runtimeRoot), { recursive: true });
  }
  const playerBody = "process.exit(0);\n";
  const orchestratorBody = "export const fixture = true;\n";
  const extractorBody = "print('fixture')\n";
  const specABody =
    '{"arm":"candidate","game_config":{"max_decision_steps":80}}\n';
  const specBBody =
    '{"arm":"exact-parent","game_config":{"max_decision_steps":80}}\n';
  const canaryCandidateBody = '{"kind":"canary-candidate"}\n';
  const canaryControlBody = '{"kind":"canary-control"}\n';
  await writeFile(path.join(policyRoot, "player.mjs"), playerBody);
  await symlink("player.mjs", path.join(policyRoot, "linked-player.mjs"));
  await writeFile(orchestratorPath, orchestratorBody);
  await writeFile(
    path.join(root, "bin", "extract_runpod_proxywar_bundle.py"),
    extractorBody,
  );
  await writeFile(
    path.join(root, "specs", "formal-matched-a.json"),
    specABody,
  );
  await writeFile(
    path.join(root, "specs", "formal-matched-b.json"),
    specBBody,
  );
  await writeFile(
    path.join(root, "specs", "canary-candidate-player-specs.json"),
    canaryCandidateBody,
  );
  await writeFile(
    path.join(root, "specs", "canary-control-player-specs.json"),
    canaryControlBody,
  );
  const fileLines = [
    `${sha256(orchestratorBody)}  bin/orchestrator.mjs`,
    `${sha256(extractorBody)}  bin/extract_runpod_proxywar_bundle.py`,
    `${sha256(playerBody)}  policies/candidate/app/player.mjs`,
    `${sha256(specABody)}  specs/formal-matched-a.json`,
    `${sha256(specBBody)}  specs/formal-matched-b.json`,
    `${sha256(canaryCandidateBody)}  specs/canary-candidate-player-specs.json`,
    `${sha256(canaryControlBody)}  specs/canary-control-player-specs.json`,
  ];
  const linkTarget = "player.mjs";
  const linkLines = [
    `${sha256(`symlink\0${linkTarget}`)}\tpolicies/candidate/app/linked-player.mjs\t${linkTarget}`,
  ];
  const fileManifestBody = `${fileLines.join("\n")}\n`;
  const linkManifestBody = `${linkLines.join("\n")}\n`;
  await writeFile(path.join(root, "files.sha256"), fileManifestBody);
  await writeFile(path.join(root, "links.tsv"), linkManifestBody);
  const manifest = {
    schema_version: 1,
    base_image: BASE_IMAGE,
    contains_credentials: false,
    invokes_runpod_api: false,
    source: {
      commit: "d".repeat(40),
      formal_specs_commit: "e".repeat(40),
      files: {
        "scripts/prepare-runpod-proxywar-bundle.sh": "1".repeat(64),
        "scripts/runpod-proxywar-episode.mjs": sha256(orchestratorBody),
        "scripts/extract_runpod_proxywar_bundle.py": sha256(extractorBody),
        "test/runpod-proxywar-episode.test.mjs": "2".repeat(64),
        "test/test_extract_runpod_proxywar_bundle.py": "3".repeat(64),
      },
    },
    runtime: {
      mode: "self_contained_bundle",
      source_base_image: BASE_IMAGE,
      architecture: "amd64",
      node_version: "24.18.0",
      node_sha256:
        "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c",
      bundle_roots: [
        "runtime/integration",
        "runtime/proxywar",
        "runtime/node",
      ],
    },
    orchestrator_sha256: sha256(orchestratorBody),
    file_manifest: {
      path: "files.sha256",
      sha256: sha256(fileManifestBody),
      file_count: 7,
    },
    experiment_specs: [
      {
        label: "formal-matched-a",
        path: "specs/formal-matched-a.json",
        sha256: sha256(specABody),
        role: "candidate",
        max_decision_steps: 80,
      },
      {
        label: "formal-matched-b",
        path: "specs/formal-matched-b.json",
        sha256: sha256(specBBody),
        role: "exact-parent",
        max_decision_steps: 80,
      },
    ],
    transport_canaries: [
      {
        label: "transport-canary-candidate",
        path: "specs/canary-candidate-player-specs.json",
        sha256: sha256(canaryCandidateBody),
        role: "candidate",
      },
      {
        label: "transport-canary-control",
        path: "specs/canary-control-player-specs.json",
        sha256: sha256(canaryControlBody),
        role: "exact-parent",
      },
    ],
    symlink_manifest: {
      path: "links.tsv",
      sha256: sha256(linkManifestBody),
      symlink_count: 1,
    },
    policies: [
      {
        key: "candidate",
        image_id: `sha256:${"a".repeat(64)}`,
        architecture: "amd64",
        bundle_root: "policies/candidate/app",
        run: ["node", "player.mjs"],
      },
    ],
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(root, "manifest.json"), manifestBody);
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(manifestBody)}  manifest.json\n`,
  );
  const players = [
    {
      policy: "candidate",
      cwdRelative: "policies/candidate/app",
      run: ["node", "player.mjs"],
    },
  ];
  return { root, policyRoot, orchestratorPath, players };
}

async function runtimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "proxywar-runtime-test-"));
  const gameRoot = path.join(root, "integration");
  const proxyWarRepo = path.join(root, "proxywar");
  const files = [
    { root: "game", path: "runner.ts", body: "runner\n" },
    { root: "proxywar", path: "engine.ts", body: "engine\n" },
  ];
  for (const file of files) {
    const base = file.root === "game" ? gameRoot : proxyWarRepo;
    await mkdir(path.dirname(path.join(base, file.path)), { recursive: true });
    await writeFile(path.join(base, file.path), file.body);
  }
  return {
    gameRoot,
    proxyWarRepo,
    expected: files.map(({ root: fileRoot, path: filePath, body }) => ({
      root: fileRoot,
      path: filePath,
      sha256: sha256(body),
    })),
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "proxywar-runpod-test-"));
  const gameRoot = path.join(root, "game");
  const proxyWarRepo = path.join(root, "proxywar");
  await mkdir(gameRoot);
  await mkdir(proxyWarRepo);
  for (const policy of ["candidate", "parent"]) {
    const app = path.join(root, "policies", policy, "app");
    await mkdir(app, { recursive: true });
    await writeFile(path.join(app, "player.mjs"), "process.exit(0);\n");
  }
  const document = {
    schema_version: 1,
    game_config: {
      seed: 20260719,
      map: "Pangaea",
      map_size: "Normal",
      difficulty: "Easy",
      max_decision_steps: 20,
      turns_per_decision_step: 100,
      max_decision_ms: 180000,
      episode_timeout_seconds: 600,
    },
    players: [
      {
        name: "Candidate",
        policy: "candidate",
        cwd: "policies/candidate/app",
        run: ["node", "player.mjs"],
        env: { POLICY_CODENAME: "test" },
      },
      {
        name: "Parent",
        policy: "parent",
        cwd: "policies/parent/app",
        run: ["node", "player.mjs"],
      },
    ],
  };
  return { root, gameRoot, proxyWarRepo, document };
}

test("RunPod episode spec resolves two direct Node policy processes", async () => {
  const { root, gameRoot, proxyWarRepo, document } = await fixture();
  const validated = await validateRunSpec(document, {
    bundleRoot: root,
    gameRoot,
    proxyWarRepo,
  });
  assert.equal(validated.players.length, 2);
  assert.equal(validated.players[0].cwdRelative, "policies/candidate/app");
  assert.deepEqual(validated.players[0].run, ["node", "player.mjs"]);
  assert.equal(validated.gameConfig.num_agents, 2);
  assert.equal(validated.gameConfig.player_connect_timeout_seconds, 120);
});

test("RunPod episode spec rejects credentials and orchestrator-owned env", async () => {
  const { root, gameRoot, proxyWarRepo, document } = await fixture();
  document.players[0].env.RUNPOD_API_KEY = "must-not-enter-bundle";
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /RUNPOD_API_KEY/,
  );
  delete document.players[0].env.RUNPOD_API_KEY;
  document.players[0].env.COWORLD_PLAYER_WS_URL = "ws://wrong";
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /COWORLD_PLAYER_WS_URL/,
  );
  delete document.players[0].env.COWORLD_PLAYER_WS_URL;
  document.players[0].env.UNREVIEWED_SETTING = "not-secret-but-unapproved";
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /non-secret allowlist/,
  );
  assert.equal(isForbiddenEnvName("AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(isForbiddenEnvName("HRAFN_RV1"), false);
  assert.doesNotThrow(() =>
    assertSecretFreeControlEnvironment({ RUNPOD_POD_ID: "safe-metadata" }),
  );
  assert.throws(
    () =>
      assertSecretFreeControlEnvironment({
        RUNPOD_API_KEY: "must-not-reach-the-pod",
      }),
    /RUNPOD_API_KEY/,
  );
});

test("RunPod episode spec cannot escape the extracted policy root", async () => {
  const { root, gameRoot, proxyWarRepo, document } = await fixture();
  document.players[0].run = ["node", "../parent/app/player.mjs"];
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /entrypoint escapes/,
  );
});

test("RunPod episode spec rejects symlink escapes and unknown game fields", async () => {
  const { root, gameRoot, proxyWarRepo, document } = await fixture();
  const outside = path.join(root, "outside.mjs");
  await writeFile(outside, "process.exit(0);\n");
  await symlink(
    outside,
    path.join(root, "policies", "candidate", "app", "escape.mjs"),
  );
  document.players[0].run = ["node", "escape.mjs"];
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /entrypoint symlink escapes/,
  );
  document.players[0].run = ["node", "player.mjs"];
  document.game_config.runpod_api_key = "forbidden-by-schema";
  await assert.rejects(
    validateRunSpec(document, { bundleRoot: root, gameRoot, proxyWarRepo }),
    /unknown field runpod_api_key/,
  );
});

test("receipt hashes are canonical and ephemeral tokens are redacted", () => {
  assert.equal(
    canonicalHash({ b: 2, a: { d: 4, c: 3 } }),
    canonicalHash({ a: { c: 3, d: 4 }, b: 2 }),
  );
  const token = "local-ephemeral-token";
  const input = `connect ws://127.0.0.1:8080/player?slot=0&token=${token} ${token}`;
  const redacted = redactSecrets(input, [token]);
  assert.equal(redacted.includes(token), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test("bundle verification accepts a clean selected policy", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const verified = await verifyBundleManifest(root, players, {
    orchestratorPath,
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.selected_file_count, 5);
  assert.equal(verified.selected_symlink_count, 1);
  assert.equal(verified.source.commit, "d".repeat(40));
  assert.equal(verified.source.formal_specs_commit, "e".repeat(40));
  assert.equal(
    verified.source.files["scripts/runpod-proxywar-episode.mjs"],
    verified.orchestrator_sha256,
  );
  assert.equal(verified.experiment_specs.length, 2);
  assert.equal(
    verified.experiment_specs[0].sha256,
    sha256(
      '{"arm":"candidate","game_config":{"max_decision_steps":80}}\n',
    ),
  );
  assert.equal(verified.experiment_specs[0].max_decision_steps, 80);
  assert.equal(verified.policies[0].key, "candidate");
});

test("bundle verification accepts a hash-bound multi-policy spec set", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const extraBody =
    '{"arm":"second-candidate","game_config":{"max_decision_steps":80}}\n';
  const extraPath = path.join(root, "specs", "grow-low-share-candidate.json");
  await writeFile(extraPath, extraBody);
  const fileManifestPath = path.join(root, "files.sha256");
  const fileManifestBody = `${await readFile(fileManifestPath, "utf8")}${sha256(extraBody)}  specs/grow-low-share-candidate.json\n`;
  await writeFile(fileManifestPath, fileManifestBody);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.file_manifest.sha256 = sha256(fileManifestBody);
  manifest.file_manifest.file_count += 1;
  manifest.experiment_specs.push({
    label: "grow-low-share-candidate",
    path: "specs/grow-low-share-candidate.json",
    sha256: sha256(extraBody),
    role: "candidate",
    max_decision_steps: 80,
  });
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestBody);
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(manifestBody)}  manifest.json\n`,
  );
  const verified = await verifyBundleManifest(root, players, { orchestratorPath });
  assert.equal(verified.experiment_specs.length, 3);
  assert.equal(verified.experiment_specs[2].label, "grow-low-share-candidate");
});

test("bundle verification rejects a tampered selected policy file", async () => {
  const { root, policyRoot, orchestratorPath, players } =
    await manifestFixture();
  await writeFile(path.join(policyRoot, "player.mjs"), "tampered\n");
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /policy file hash mismatch/,
  );
});

test("bundle verification rejects a tampered selected policy symlink", async () => {
  const { root, policyRoot, orchestratorPath, players } =
    await manifestFixture();
  const linkPath = path.join(policyRoot, "linked-player.mjs");
  await rm(linkPath);
  await symlink("different-player.mjs", linkPath);
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /policy symlink mismatch/,
  );
});

test("bundle verification rejects a tampered orchestrator", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  await writeFile(orchestratorPath, "export const fixture = false;\n");
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /orchestrator does not match/,
  );
});

test("bundle verification rejects duplicate formal experiment identities", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.experiment_specs[1] = {
    ...manifest.experiment_specs[0],
  };
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, body);
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(body)}  manifest.json\n`,
  );
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /formal matched experiment spec identity is invalid/,
  );
});

test("bundle preparer derives the README and manifest horizon from the formal pair", async () => {
  const source = await readFile(
    new URL("../scripts/prepare-runpod-proxywar-bundle.sh", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\b150-step\b/);
  assert.match(
    source,
    /FORMAL_MAX_DECISION_STEPS="\$formal_spec_a_steps"/,
  );
  assert.match(
    source,
    /immutable \$FORMAL_MAX_DECISION_STEPS-step matched pair/,
  );
  assert.equal(
    [...source.matchAll(/max_decision_steps: Number\(formalMaxDecisionSteps\)/g)]
      .length,
    2,
  );
});

test("bundle verification rejects a manifest horizon that differs from its formal spec", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.experiment_specs[0].max_decision_steps = 81;
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, body);
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(body)}  manifest.json\n`,
  );
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /horizon disagrees with its spec/,
  );
});

test("bundle verification rejects different horizons across the formal pair", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const specPath = path.join(root, "specs", "formal-matched-b.json");
  const specBody =
    '{"arm":"exact-parent","game_config":{"max_decision_steps":81}}\n';
  await writeFile(specPath, specBody);
  const fileManifestPath = path.join(root, "files.sha256");
  const fileManifestBody = (await readFile(fileManifestPath, "utf8")).replace(
    /^[a-f0-9]{64}  specs\/formal-matched-b\.json$/m,
    `${sha256(specBody)}  specs/formal-matched-b.json`,
  );
  await writeFile(fileManifestPath, fileManifestBody);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.file_manifest.sha256 = sha256(fileManifestBody);
  manifest.experiment_specs[1].sha256 = sha256(specBody);
  manifest.experiment_specs[1].max_decision_steps = 81;
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestBody);
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(manifestBody)}  manifest.json\n`,
  );
  await assert.rejects(
    verifyBundleManifest(root, players, { orchestratorPath }),
    /formal matched experiment horizons differ/,
  );
});

test("formal run spec binds its raw hash and rejects post-verify tampering", async () => {
  const { root, orchestratorPath, players } = await manifestFixture();
  const verification = await verifyBundleManifest(root, players, {
    orchestratorPath,
  });
  const specPath = path.join(root, "specs", "formal-matched-a.json");
  const originalBody =
    '{"arm":"candidate","game_config":{"max_decision_steps":80}}\n';
  const binding = await bindRunSpec(
    specPath,
    root,
    sha256(originalBody),
    verification,
  );
  assert.equal(binding.relative_path, "specs/formal-matched-a.json");
  assert.equal(binding.manifest_label, "formal-matched-a");
  assert.equal(binding.manifest_role, "candidate");
  assert.equal(binding.execution_class, "formal_evaluation");
  const tampered = '{"arm":"tampered"}\n';
  await writeFile(specPath, tampered);
  await assert.rejects(
    bindRunSpec(specPath, root, sha256(tampered), verification),
    /does not match manifest/,
  );
  const canaryPath = path.join(
    root,
    "specs",
    "canary-candidate-player-specs.json",
  );
  const canaryBody = '{"kind":"canary-candidate"}\n';
  await assert.rejects(
    bindRunSpec(canaryPath, root, sha256(canaryBody), verification),
    /requires the explicit --transport-canary/,
  );
  const canary = await bindRunSpec(
    canaryPath,
    root,
    sha256(canaryBody),
    verification,
    { transportCanary: true },
  );
  assert.equal(canary.execution_class, "transport_canary");
});

test("runtime fingerprint accepts exact files and rejects a changed engine", async () => {
  const { gameRoot, proxyWarRepo, expected } = await runtimeFixture();
  const verified = await verifyRuntimeFingerprint(
    { gameRoot, proxyWarRepo },
    expected,
  );
  assert.equal(verified.status, "verified");
  assert.equal(verified.files.length, 2);
  await writeFile(path.join(proxyWarRepo, "engine.ts"), "changed\n");
  await assert.rejects(
    verifyRuntimeFingerprint({ gameRoot, proxyWarRepo }, expected),
    /runtime fingerprint mismatch/,
  );
});

test("post-run attestation rejects any selected-input drift", () => {
  const before = {
    bundle: { sha256: "a".repeat(64) },
    runtime: { sha256: "b".repeat(64) },
  };
  assert.doesNotThrow(() =>
    assertAttestationStable("selected inputs", before, structuredClone(before)),
  );
  assert.throws(
    () =>
      assertAttestationStable("selected inputs", before, {
        ...before,
        runtime: { sha256: "c".repeat(64) },
      }),
    /changed during episode execution/,
  );
});

test("clean player exit is still early unless the game finishes in grace", async () => {
  const outcome = { code: 0, signal: null, error: null };
  const early = await classifyEarlyPlayerExit(
    "player-clean",
    outcome,
    () => false,
    0,
  );
  assert.equal(early.kind, "player-exit");
  assert.equal(early.outcome.code, 0);
  let gameComplete = false;
  const finalizing = classifyEarlyPlayerExit(
    "player-final",
    outcome,
    () => gameComplete,
    1,
  );
  gameComplete = true;
  assert.equal(await finalizing, null);
});

test("failure or signal can never retain passed status", () => {
  assert.equal(forceFailureStatus("passed", new Error("failure"), null), "failed");
  assert.equal(forceFailureStatus("passed", null, "SIGTERM"), "failed");
  assert.equal(forceFailureStatus("passed", null, null), "passed");
});

test("episode results bind seed, slot order, scores, and counters", async () => {
  const { root, gameRoot, proxyWarRepo, document } = await fixture();
  const validated = await validateRunSpec(document, {
    bundleRoot: root,
    gameRoot,
    proxyWarRepo,
  });
  const results = {
    game_id: "TESTGAME",
    seed: 20260719,
    winner_slot: null,
    turn_count: 100,
    tick: 100,
    decision_count: 20,
    accepted_decision_count: 20,
    fallback_count: 0,
    degraded_count: 0,
    scores: [0.5, 0.5],
    players: [
      { slot: 0, name: "Candidate", score: 0.5 },
      { slot: 1, name: "Parent", score: 0.5 },
    ],
  };
  assert.equal(validateEpisodeResults(results, validated).game_id, "TESTGAME");
  await assert.rejects(
    Promise.resolve().then(() =>
      validateEpisodeResults({ ...results, seed: 1 }, validated),
    ),
    /seed mismatch/,
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      validateEpisodeResults(
        {
          ...results,
          players: results.players.toReversed(),
        },
        validated,
      ),
    ),
    /identity\/order mismatch/,
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      validateEpisodeResults(
        {
          ...results,
          accepted_decision_count: 21,
        },
        validated,
      ),
    ),
    /cannot exceed/,
  );
});
