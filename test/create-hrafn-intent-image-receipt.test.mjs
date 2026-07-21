import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HRAFN_INTENT_CONTAINER_FILES,
  HRAFN_INTENT_IMAGE_FILES,
  HRAFN_EXACT_V5_PLAYER_RUN,
  HRAFN_NEUTRAL_OPPONENT_IMAGE_ID,
  HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
  HRAFN_NEUTRAL_OPPONENT_RUN,
  HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
  HRAFN_V5_PARENT_IMAGE_ID,
  createHrafnIntentImageReceipt,
  hrafnIntentReceiptContentSHA256,
  serializeHrafnIntentImageReceipt,
  verifyHrafnIntentImageReceipt,
  verifyHrafnIntentImageReceiptEnvironment,
} from "../scripts/create-hrafn-intent-image-receipt.mjs";
import {
  HRAFN_COWORLD_GAME_IMAGE_ID,
  HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
} from "../scripts/materialize-hrafn-coworld-manifest.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SUBJECT_IMAGE = `sha256:${"a".repeat(64)}`;
const OPPONENT_IMAGE = HRAFN_NEUTRAL_OPPONENT_IMAGE_ID;
const PARENT_IMAGE = HRAFN_V5_PARENT_IMAGE_ID;
const BRANCH = "feature/k1z-hrafn-fylking";
const UPSTREAM = `origin/${BRANCH}`;
const REMOTE_REF = `refs/heads/${BRANCH}`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureRuntime(overrides = {}) {
  const calls = [];
  const files = Object.fromEntries(HRAFN_INTENT_IMAGE_FILES.map((file) => [
    file,
    Buffer.from(`committed:${file}\n`),
  ]));
  const parentPolicyHashes = Object.fromEntries(
    [...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES].map((file, index) => [
      file,
      String(index + 201).padStart(64, "0"),
    ]),
  );
  const parentLayers = [`sha256:${"1".repeat(64)}`];
  const runtime = {
    now: () => new Date("2026-07-20T20:30:00.000Z"),
    async run(command, args) {
      calls.push([command, ...args]);
      const joined = [command, ...args].join(" ");
      if (joined.includes("git -C /repo status --porcelain")) {
        return { stdout: Buffer.from(""), stderr: Buffer.alloc(0) };
      }
      if (joined.endsWith("rev-parse HEAD")) {
        return { stdout: Buffer.from(`${SOURCE_COMMIT}\n`), stderr: Buffer.alloc(0) };
      }
      if (joined.endsWith("branch --show-current")) {
        return { stdout: Buffer.from(`${BRANCH}\n`), stderr: Buffer.alloc(0) };
      }
      if (joined.endsWith("rev-parse --abbrev-ref @{upstream}")) {
        return { stdout: Buffer.from(`${UPSTREAM}\n`), stderr: Buffer.alloc(0) };
      }
      if (joined.endsWith("rev-parse @{upstream}")) {
        return { stdout: Buffer.from(`${SOURCE_COMMIT}\n`), stderr: Buffer.alloc(0) };
      }
      if (joined.includes(`config --get branch.${BRANCH}.remote`)) {
        return { stdout: Buffer.from("origin\n"), stderr: Buffer.alloc(0) };
      }
      if (joined.includes(`config --get branch.${BRANCH}.merge`)) {
        return { stdout: Buffer.from(`${REMOTE_REF}\n`), stderr: Buffer.alloc(0) };
      }
      if (joined.includes(`ls-remote --exit-code origin ${REMOTE_REF}`)) {
        return {
          stdout: Buffer.from(`${SOURCE_COMMIT}\t${REMOTE_REF}\n`),
          stderr: Buffer.alloc(0),
        };
      }
      const show = args.indexOf("show");
      if (command === "git" && show >= 0) {
        const selector = args[show + 1];
        const file = selector.slice(selector.indexOf(":") + 1);
        if (!Object.hasOwn(files, file)) throw new Error(`unknown file ${file}`);
        return { stdout: files[file], stderr: Buffer.alloc(0) };
      }
      if (joined === `docker image inspect ${SUBJECT_IMAGE}`) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            Id: SUBJECT_IMAGE,
            Os: "linux",
            Architecture: "amd64",
            RepoTags: ["hrafn-intent-i1:test"],
            Config: {
              WorkingDir: "/app",
              Entrypoint: ["docker-entrypoint.sh"],
              Cmd: ["node", "/app/hrafn-intent-player.mjs"],
            },
          }])),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined === `docker image inspect ${HRAFN_COWORLD_GAME_IMAGE_REFERENCE}`) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            Id: HRAFN_COWORLD_GAME_IMAGE_ID,
            Os: "linux",
            Architecture: "amd64",
          }])),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined === `docker image inspect ${OPPONENT_IMAGE}`) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            Id: OPPONENT_IMAGE,
            Os: "linux",
            Architecture: "amd64",
            RootFS: {
              Type: "layers",
              Layers: [...parentLayers, `sha256:${"2".repeat(64)}`],
            },
            Config: {
              WorkingDir: "/app",
              Entrypoint: ["docker-entrypoint.sh"],
              Cmd: [...HRAFN_NEUTRAL_OPPONENT_RUN],
              Labels: {
                "proxywar.hrafn.neutral.parent-image-id": PARENT_IMAGE,
              },
            },
          }])),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined === `docker image inspect ${PARENT_IMAGE}`) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            Id: PARENT_IMAGE,
            Os: "linux",
            Architecture: "amd64",
            RootFS: { Type: "layers", Layers: parentLayers },
            Config: {
              WorkingDir: "/app",
              Entrypoint: ["docker-entrypoint.sh"],
              Cmd: ["node", "/app/llm-player.mjs"],
            },
          }])),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint /usr/bin/sha256sum ${SUBJECT_IMAGE}`,
      )) {
        return {
          stdout: Buffer.from([...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) =>
            `${sha256(files[file])}  /app/${file}`
          ).join("\n") + "\n"),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint /usr/bin/sha256sum ${OPPONENT_IMAGE}`,
      )) {
        return {
          stdout: Buffer.from([
            ...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
            ...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
          ].sort().map((file) =>
            `${parentPolicyHashes[file] ?? sha256(files[file])}  /app/${file}`
          ).join("\n") + "\n"),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint /usr/bin/sha256sum ${PARENT_IMAGE}`,
      )) {
        return {
          stdout: Buffer.from([...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES]
            .sort()
            .map((file) => `${parentPolicyHashes[file]}  /app/${file}`)
            .join("\n") + "\n"),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint node ${SUBJECT_IMAGE} --check /app/`,
      )) {
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint node ${OPPONENT_IMAGE} --check /app/`,
      )) {
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint node ${SUBJECT_IMAGE} --input-type=module --eval`,
      )) {
        return {
          stdout: Buffer.from(`${JSON.stringify({
            node_version: "v24.4.1",
            module_imports: ["ws", "file:///app/hrafn-intent.mjs"],
          })}\n`),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined.startsWith(
        `docker run --rm --network none --entrypoint node ${OPPONENT_IMAGE} --input-type=module --eval`,
      )) {
        return {
          stdout: Buffer.from(`${JSON.stringify({
            node_version: "v24.4.1",
            module_imports: ["ws", "file:///app/hrafn-neutral-opponent.mjs"],
            sample_reason: "[0UT] v5:h0d",
          })}\n`),
          stderr: Buffer.alloc(0),
        };
      }
      if (joined === "npm test") {
        return {
          stdout: Buffer.from("tests: 420 passed\n"),
          stderr: Buffer.from(""),
        };
      }
      throw new Error(`unexpected command: ${joined}`);
    },
    ...overrides,
  };
  return { calls, files, runtime };
}

test("image receipt is generated from clean pushed Git, Docker inspect, and a real test run", async () => {
  const { calls, files, runtime } = fixtureRuntime();
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: "/repo",
    imageReference: SUBJECT_IMAGE,
  }, runtime);
  const report = verifyHrafnIntentImageReceipt(receipt);

  assert.equal(report.valid, true, report.errors.join("; "));
  assert.equal(receipt.source.commit, SOURCE_COMMIT);
  assert.equal(receipt.source.upstream_commit, SOURCE_COMMIT);
  assert.equal(receipt.source.remote_commit, SOURCE_COMMIT);
  assert.equal(receipt.source.clean, true);
  assert.equal(receipt.source.pushed, true);
  assert.deepEqual(receipt.image, {
    requested_reference: SUBJECT_IMAGE,
    id: SUBJECT_IMAGE,
    os: "linux",
    architecture: "amd64",
    working_dir: "/app",
    entrypoint: ["docker-entrypoint.sh"],
    cmd: ["node", "/app/hrafn-intent-player.mjs"],
    container_files: [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file) => ({
      path: `/app/${file}`,
      sha256: sha256(files[file]),
    })),
    runtime_smoke: {
      node_version: "v24.4.1",
      syntax_files: [
        "/app/hrafn-intent-player.mjs",
        "/app/hrafn-intent.mjs",
        "/app/hrafn-safety.mjs",
        "/app/hrafn-state.mjs",
        "/app/hrafn-strategy.mjs",
      ],
      module_imports: ["ws", "file:///app/hrafn-intent.mjs"],
    },
  });
  assert.deepEqual(
    receipt.coworld_player_run,
    ["node", "/app/hrafn-intent-player.mjs"],
  );
  assert.equal(Object.hasOwn(receipt, "entrypoint"), false);
  assert.equal(receipt.tests.exit_code, 0);
  assert.deepEqual(receipt.tests.argv, ["npm", "test"]);
  assert.equal(receipt.tests.stdout_sha256, sha256("tests: 420 passed\n"));
  assert.deepEqual(receipt.game, {
    reference: HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
    id: HRAFN_COWORLD_GAME_IMAGE_ID,
    os: "linux",
    architecture: "amd64",
  });
  assert.equal(receipt.opponent.image_id, OPPONENT_IMAGE);
  assert.equal(receipt.opponent.parent_image_id, PARENT_IMAGE);
  assert.equal(receipt.opponent.architecture, "amd64");
  assert.deepEqual(receipt.opponent.cmd, HRAFN_NEUTRAL_OPPONENT_RUN);
  assert.deepEqual(receipt.opponent.coworld_player_run, HRAFN_NEUTRAL_OPPONENT_RUN);
  assert.deepEqual(
    receipt.opponent.parent_coworld_player_run,
    HRAFN_EXACT_V5_PLAYER_RUN,
  );
  assert.equal(
    receipt.opponent.rootfs_layers.length >
      receipt.opponent.parent_rootfs_layers.length,
    true,
  );
  assert.deepEqual(
    receipt.opponent.rootfs_layers.slice(
      0,
      receipt.opponent.parent_rootfs_layers.length,
    ),
    receipt.opponent.parent_rootfs_layers,
  );
  assert.equal(receipt.opponent.runtime_smoke.sample_reason, "[0UT] v5:h0d");
  assert.doesNotMatch(receipt.opponent.runtime_smoke.sample_reason, /\[K1Z\]/);
  for (const file of HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES) {
    assert.equal(
      receipt.opponent.container_files.find((entry) =>
        entry.path === `/app/${file}`
      )?.sha256,
      sha256(files[file]),
    );
  }
  assert.deepEqual(
    receipt.files.map((entry) => entry.path),
    [...HRAFN_INTENT_IMAGE_FILES].sort(),
  );
  for (const entry of receipt.files) {
    assert.equal(entry.sha256, sha256(files[entry.path]));
  }
  assert.equal(
    calls.some((call) => call.join(" ") === "npm test"),
    true,
  );
  assert.equal(
    calls.some((call) => call.join(" ").includes("ls-remote --exit-code")),
    true,
  );
  assert.equal(
    calls.some((call) => call.join(" ").includes("--check /app/hrafn-intent-player.mjs")),
    true,
  );
  assert.equal(
    calls.some((call) => call.join(" ").includes("--input-type=module --eval")),
    true,
  );
});

test("image receipt creation fails on dirty, unpushed, wrong-branch, or non-amd64 observations", async () => {
  const failures = [
    {
      match: "status --porcelain",
      result: { stdout: Buffer.from(" M hrafn-intent.mjs\n"), stderr: Buffer.alloc(0) },
      error: /clean/,
    },
    {
      match: "rev-parse @{upstream}",
      result: { stdout: Buffer.from(`${"2".repeat(40)}\n`), stderr: Buffer.alloc(0) },
      error: /pushed|upstream/,
    },
    {
      match: "branch --show-current",
      result: { stdout: Buffer.from("main\n"), stderr: Buffer.alloc(0) },
      error: /branch/,
    },
    {
      match: "docker image inspect",
      result: {
        stdout: Buffer.from(JSON.stringify([{
          Id: SUBJECT_IMAGE,
          Os: "linux",
          Architecture: "arm64",
        }])),
        stderr: Buffer.alloc(0),
      },
      error: /linux\/amd64/,
    },
    {
      match: `docker image inspect ${HRAFN_COWORLD_GAME_IMAGE_REFERENCE}`,
      result: {
        stdout: Buffer.from(JSON.stringify([{
          Id: `sha256:${"9".repeat(64)}`,
          Os: "linux",
          Architecture: "amd64",
        }])),
        stderr: Buffer.alloc(0),
      },
      error: /Coworld game tag.*pinned linux\/amd64/,
    },
  ];

  for (const failure of failures) {
    const base = fixtureRuntime();
    const original = base.runtime.run;
    base.runtime.run = async (command, args) => {
      const joined = [command, ...args].join(" ");
      if (joined.includes(failure.match)) return failure.result;
      return original(command, args);
    };
    await assert.rejects(
      createHrafnIntentImageReceipt({
        repoPath: "/repo",
        imageReference: SUBJECT_IMAGE,
      }, base.runtime),
      failure.error,
    );
  }
});

test("image receipt verification fails on self-declared or tampered evidence", async () => {
  const { runtime } = fixtureRuntime();
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: "/repo",
    imageReference: SUBJECT_IMAGE,
  }, runtime);

  for (const mutate of [
    (copy) => { copy.source.pushed = false; },
    (copy) => { copy.source.remote_commit = "2".repeat(40); },
    (copy) => { copy.image.architecture = "arm64"; },
    (copy) => { copy.image.working_dir = "/tmp"; },
    (copy) => { copy.image.entrypoint = null; },
    (copy) => { copy.image.cmd = ["node", "/app/other.mjs"]; },
    (copy) => { copy.image.container_files[0].sha256 = "0".repeat(64); },
    (copy) => { copy.image.runtime_smoke.node_version = "v22.0.0"; },
    (copy) => { copy.image.runtime_smoke.module_imports = ["ws"]; },
    (copy) => { copy.tests.exit_code = 1; },
    (copy) => { copy.coworld_player_run = ["node", "/app/other.mjs"]; },
    (copy) => { copy.entrypoint = "/app/hrafn-intent-player.mjs"; },
    (copy) => { copy.planner.model_digest = "3".repeat(64); },
    (copy) => { copy.game.id = `sha256:${"8".repeat(64)}`; },
    (copy) => { copy.game.architecture = "arm64"; },
    (copy) => { copy.opponent.image_id = `sha256:${"4".repeat(64)}`; },
    (copy) => { copy.opponent.image_id = PARENT_IMAGE; },
    (copy) => { copy.opponent.parent_image_id = copy.opponent.image_id; },
    (copy) => { copy.opponent.architecture = "arm64"; },
    (copy) => { copy.opponent.cmd = ["node", "/app/hrafn-player.mjs"]; },
    (copy) => { copy.opponent.parent_coworld_player_run = ["node", "/app/other.mjs"]; },
    (copy) => { copy.opponent.rootfs_layers = [...copy.opponent.parent_rootfs_layers]; },
    (copy) => { copy.opponent.container_files[0].sha256 = "6".repeat(64); },
    (copy) => { copy.opponent.parent_policy_files[0].sha256 = "7".repeat(64); },
    (copy) => { copy.opponent.runtime_smoke.sample_reason = "[K1Z] r4vn:h0d"; },
    (copy) => { copy.files[0].sha256 = "5".repeat(64); },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.equal(verifyHrafnIntentImageReceipt(copy).valid, false);
  }

  const freshIntegrity = structuredClone(receipt);
  freshIntegrity.game.id = `sha256:${"8".repeat(64)}`;
  freshIntegrity.integrity.content_sha256 =
    hrafnIntentReceiptContentSHA256(freshIntegrity);
  assert.equal(verifyHrafnIntentImageReceipt(freshIntegrity).valid, false);
});

test("receipt rejects the original K1Z-tagging parent with fresh integrity", async () => {
  const { runtime } = fixtureRuntime();
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: "/repo",
    imageReference: SUBJECT_IMAGE,
  }, runtime);
  receipt.opponent.image_id = PARENT_IMAGE;
  receipt.opponent.parent_image_id = PARENT_IMAGE;
  receipt.opponent.runtime_smoke.sample_reason = "[K1Z] r4vn:h0d";
  receipt.integrity.content_sha256 = hrafnIntentReceiptContentSHA256(receipt);

  const report = verifyHrafnIntentImageReceipt(receipt);
  assert.equal(report.valid, false);
  assert.equal(
    report.errors.includes("neutral exact-v5 opponent binding is invalid"),
    true,
  );
  assert.equal(
    report.errors.includes("neutral opponent runtime evidence is invalid"),
    true,
  );
});

test("serialized receipt has stable wire bytes and verified content integrity", async () => {
  const { runtime } = fixtureRuntime();
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: "/repo",
    imageReference: SUBJECT_IMAGE,
  }, runtime);
  const wire = serializeHrafnIntentImageReceipt(receipt);
  assert.equal(wire.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(wire), receipt);
  assert.equal(verifyHrafnIntentImageReceipt(JSON.parse(wire)).valid, true);

  const copy = JSON.parse(wire);
  copy.source.commit = "f".repeat(40);
  assert.equal(verifyHrafnIntentImageReceipt(copy).valid, false);
});

test("live image receipt verification reruns file, Node, and dependency probes", async () => {
  const fixture = fixtureRuntime();
  const receipt = await createHrafnIntentImageReceipt({
    repoPath: "/repo",
    imageReference: SUBJECT_IMAGE,
  }, fixture.runtime);
  const priorCallCount = fixture.calls.length;
  const result = await verifyHrafnIntentImageReceiptEnvironment(
    receipt,
    { repoPath: "/repo" },
    fixture.runtime,
  );
  assert.deepEqual(result, {
    valid: true,
    source_commit: SOURCE_COMMIT,
    subject_image: SUBJECT_IMAGE,
    game_image: HRAFN_COWORLD_GAME_IMAGE_ID,
    opponent_image: OPPONENT_IMAGE,
    opponent_parent_image: PARENT_IMAGE,
  });
  const liveCalls = fixture.calls.slice(priorCallCount).map((call) => call.join(" "));
  assert.equal(liveCalls.some((call) => call.includes("/usr/bin/sha256sum")), true);
  assert.equal(liveCalls.some((call) => call.includes("--check /app/hrafn-intent-player.mjs")), true);
  assert.equal(liveCalls.some((call) => call.includes("--input-type=module --eval")), true);

  const originalRun = fixture.runtime.run;
  fixture.runtime.run = async (command, args, options) => {
    if ([command, ...args].join(" ") ===
      `docker image inspect ${HRAFN_COWORLD_GAME_IMAGE_REFERENCE}`
    ) {
      return {
        stdout: Buffer.from(JSON.stringify([{
          Id: `sha256:${"9".repeat(64)}`,
          Os: "linux",
          Architecture: "amd64",
        }])),
        stderr: Buffer.alloc(0),
      };
    }
    return originalRun(command, args, options);
  };
  await assert.rejects(
    verifyHrafnIntentImageReceiptEnvironment(
      receipt,
      { repoPath: "/repo" },
      fixture.runtime,
    ),
    /Coworld game/,
  );
});
