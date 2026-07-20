import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHrafnIntentJob,
  compareHrafnIntentJobs,
  HRAFN_INTENT_MANIFEST_SHA256,
  HRAFN_V5_OPPONENT_IMAGE_DIGEST,
  parsePinnedHrafnIntentManifest,
} from "../scripts/build-hrafn-intent-job.mjs";
import {
  HRAFN_INTENT_CONTAINER_FILES,
  HRAFN_INTENT_IMAGE_FILES,
  HRAFN_INTENT_RUNTIME_IMPORTS,
  HRAFN_INTENT_RUNTIME_SYNTAX_FILES,
  hrafnIntentReceiptContentSHA256,
} from "../scripts/create-hrafn-intent-image-receipt.mjs";

const EXACT_V5_OPPONENT_IMAGE =
  "sha256:fb695574f4958beb29a036ed216c0882ee4da84ffa2f63c535f6c658f997522d";
const SUBJECT_IMAGE =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUBJECT_SOURCE_COMMIT =
  "1234567890abcdef1234567890abcdef12345678";

const manifest = {
  id: "cow-test",
  variants: [
    {
      id: "tournament-4p-pangaea",
      game_config: {
        map: "Pangaea",
        map_size: "Compact",
        difficulty: "Easy",
        num_agents: 4,
        players: Array.from({ length: 4 }, (_, index) => ({
          name: `Starter ${index + 1}`,
        })),
        max_decision_ms: 15000,
        max_decision_steps: 300,
        turns_per_decision_step: 100,
      },
    },
  ],
};

const subjectReceipt = {
  schema_version: 2,
  record_type: "hrafn_intent_i1_image_receipt",
  campaign_id: "hrafn-intent-i1",
  created_at: "2026-07-20T20:30:00.000Z",
  source: {
    commit: SUBJECT_SOURCE_COMMIT,
    branch: "feature/k1z-hrafn-fylking",
    upstream_ref: "origin/feature/k1z-hrafn-fylking",
    remote_name: "origin",
    remote_ref: "refs/heads/feature/k1z-hrafn-fylking",
    upstream_commit: SUBJECT_SOURCE_COMMIT,
    remote_commit: SUBJECT_SOURCE_COMMIT,
    clean: true,
    pushed: true,
  },
  image: {
    requested_reference: SUBJECT_IMAGE,
    id: SUBJECT_IMAGE,
    os: "linux",
    architecture: "amd64",
    working_dir: "/app",
    entrypoint: null,
    cmd: ["node", "/app/hrafn-intent-player.mjs"],
    container_files: [...HRAFN_INTENT_CONTAINER_FILES].sort().map((file, index) => ({
      path: `/app/${file}`,
      sha256: String(
        [...HRAFN_INTENT_IMAGE_FILES].sort().indexOf(file) + 1,
      ).padStart(64, "0"),
    })),
    runtime_smoke: {
      node_version: "v24.4.1",
      syntax_files: [...HRAFN_INTENT_RUNTIME_SYNTAX_FILES],
      module_imports: [...HRAFN_INTENT_RUNTIME_IMPORTS],
    },
  },
  coworld_player_run: ["node", "/app/hrafn-intent-player.mjs"],
  files: [...HRAFN_INTENT_IMAGE_FILES].sort().map((file, index) => ({
    path: file,
    sha256: String(index + 1).padStart(64, "0"),
  })),
  tests: {
    argv: ["npm", "test"],
    exit_code: 0,
    stdout_sha256: "b".repeat(64),
    stderr_sha256: "c".repeat(64),
  },
  planner: {
    model: "llama3:latest",
    model_digest:
      "365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1",
    ollama_version: "0.32.1",
  },
  opponent: { image_id: EXACT_V5_OPPONENT_IMAGE },
};
subjectReceipt.integrity = {
  algorithm: "sha256",
  canonicalization: "sorted-json-v1-excluding-integrity",
  content_sha256: hrafnIntentReceiptContentSHA256(subjectReceipt),
};

const options = {
  manifestSHA256: HRAFN_INTENT_MANIFEST_SHA256,
  variantID: "tournament-4p-pangaea",
  subjectImage: SUBJECT_IMAGE,
  opponentImage: EXACT_V5_OPPONENT_IMAGE,
  subjectReceipt,
  subjectSlot: 1,
  seed: 240721,
};

function comparisonOptions() {
  return {
    subjectReceipt: options.subjectReceipt,
    subjectImage: options.subjectImage,
    opponentImage: options.opponentImage,
    manifest,
  };
}

test("HI1 pins the opponent image to the audited exact-v5 rebuild", () => {
  assert.equal(HRAFN_V5_OPPONENT_IMAGE_DIGEST, EXACT_V5_OPPONENT_IMAGE);
});

test("HI1 paired jobs differ only by the subject intent flag", () => {
  const control = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: false,
  });
  const candidate = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: true,
  });
  const comparison = compareHrafnIntentJobs(
    control,
    candidate,
    comparisonOptions(),
  );

  assert.equal(comparison.valid, true);
  assert.deepEqual(comparison.differences, [{
    path: "players[1].env.HRAFN_INTENT_ENABLED",
    control: "0",
    candidate: "1",
  }]);
  assert.equal(control.game_config.players[1].name, "K1Z Hrafn");
  assert.equal(control.game_config.seed, 240721);
  assert.equal(control.game_config.tokens, null);
  assert.equal(control.players[1].image, options.subjectImage);
  assert.deepEqual(
    control.players[1].run,
    ["node", "/app/hrafn-intent-player.mjs"],
  );
  assert.deepEqual(
    control.players.filter((_player, index) => index !== 1).map((player) => ({
      image: player.image,
      run: player.run,
    })),
    Array.from({ length: 3 }, () => ({
      image: options.opponentImage,
      run: ["node", "/app/hrafn-player.mjs"],
    })),
  );
  assert.doesNotMatch(JSON.stringify(control), /qd1n|odin/i);
  assert.doesNotMatch(JSON.stringify(candidate), /qd1n|odin/i);
});

test("HI1 job builder supports the preregistered Asia seat", () => {
  const asiaManifest = structuredClone(manifest);
  asiaManifest.variants[0].id = "tournament-4p-asia";
  asiaManifest.variants[0].game_config.map = "Asia";
  const job = buildHrafnIntentJob(asiaManifest, {
    ...options,
    variantID: "tournament-4p-asia",
    subjectSlot: 2,
    seed: 240722,
    intentEnabled: true,
  });
  assert.equal(job.game_config.map, "Asia");
  assert.equal(job.game_config.players[2].name, "K1Z Hrafn");
  assert.equal(job.players[2].env.HRAFN_INTENT_ENABLED, "1");
});

test("HI1 job builder pins raw manifest SHA and exact four cells", () => {
  assert.throws(
    () => parsePinnedHrafnIntentManifest(Buffer.from(JSON.stringify(manifest))),
    /raw SHA-256/,
  );
  for (const mutation of [
    { manifestSHA256: "f".repeat(64) },
    { subjectSlot: 2 },
    { seed: 240722 },
    { variantID: "tournament-4p-asia" },
  ]) {
    assert.throws(() => buildHrafnIntentJob(manifest, {
      ...options,
      ...mutation,
      intentEnabled: false,
    }), /manifest|preregistered|cell/i);
  }
});

test("HI1 job builder rejects unsafe rosters and malformed cells", () => {
  for (const mutation of [
    { subjectSlot: 4 },
    { seed: -1 },
    {
      opponentImage:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    { opponentImage: "proxywar-agent-llm:qd1n-v89" },
    { opponentImage: "odin-policy:latest" },
    { variantID: "missing" },
  ]) {
    assert.throws(() => buildHrafnIntentJob(manifest, {
      ...options,
      intentEnabled: false,
      ...mutation,
    }));
  }
});

test("HI1 job builder fails closed on absent or unbound subject receipts", () => {
  const invalidReceipts = [
    null,
    {},
    { ...options.subjectReceipt, schema_version: 1 },
    { ...options.subjectReceipt, record_type: "other_image_receipt" },
    { ...options.subjectReceipt, campaign_id: "other-campaign" },
    {
      ...options.subjectReceipt,
      image: { ...options.subjectReceipt.image, id:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    },
    { ...options.subjectReceipt, image: {
      ...options.subjectReceipt.image,
      architecture: "arm64",
    } },
    { ...options.subjectReceipt, coworld_player_run: ["node", "/app/hrafn-player.mjs"] },
    { ...options.subjectReceipt, source: { ...options.subjectReceipt.source, commit: "12345678" } },
    { ...options.subjectReceipt, tests: { ...options.subjectReceipt.tests, exit_code: 414 } },
    { ...options.subjectReceipt, tests: { ...options.subjectReceipt.tests, exit_code: 1 } },
    { ...options.subjectReceipt, planner: { ...options.subjectReceipt.planner, model: "other:latest" } },
    { ...options.subjectReceipt, planner: { ...options.subjectReceipt.planner, model_digest: "bad" } },
    { ...options.subjectReceipt, planner: { ...options.subjectReceipt.planner, ollama_version: "0.0.0" } },
    {
      ...options.subjectReceipt,
      opponent: { image_id:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
    },
    { ...options.subjectReceipt, identity: "Odin" },
    { ...options.subjectReceipt, player_name: "qd1n" },
  ];

  for (const subjectReceipt of invalidReceipts) {
    assert.throws(() => buildHrafnIntentJob(manifest, {
      ...options,
      subjectReceipt,
      intentEnabled: false,
    }));
  }
});

test("HI1 job builder rejects forbidden identity material in the manifest", () => {
  for (const forbiddenName of ["Odin", "qd1n"]) {
    const unsafeManifest = structuredClone(manifest);
    unsafeManifest.variants[0].game_config.players[0].name = forbiddenName;
    assert.throws(() => buildHrafnIntentJob(unsafeManifest, {
      ...options,
      intentEnabled: false,
    }), /qd1n|Odin/i);
  }
});

test("pair comparison rejects every non-intent difference", () => {
  const control = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: false,
  });
  const candidate = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: true,
  });
  candidate.game_config.seed += 1;
  const comparison = compareHrafnIntentJobs(control, candidate, comparisonOptions());
  assert.equal(comparison.valid, false);
  assert.equal(
    comparison.differences.some((entry) => entry.path === "game_config.seed"),
    true,
  );
});

test("pair comparison itself requires the matching subject receipt", () => {
  const control = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: false,
  });
  const candidate = buildHrafnIntentJob(manifest, {
    ...options,
    intentEnabled: true,
  });
  assert.equal(compareHrafnIntentJobs(control, candidate).valid, false);
  assert.equal(compareHrafnIntentJobs(control, candidate, {
    ...comparisonOptions(),
    subjectReceipt: {
      ...options.subjectReceipt,
      source: { ...options.subjectReceipt.source, commit: "short" },
    },
  }).valid, false);
});

test("pair comparison rejects identically unsafe opponent or identity drift", () => {
  for (const mutate of [
    (job) => {
      job.players[0].image =
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    },
    (job) => {
      job.game_config.players[1].name = "Odin";
    },
    (job) => {
      job.game_config.players[1].name = "qd1n";
    },
    (job) => {
      job.players[1].env.HRAFN_INTENT_ENDPOINT = "http://planner.invalid";
    },
    (job) => {
      job.game_config.max_decision_steps = 301;
    },
    (job) => {
      job.game_config.unregistered_override = true;
    },
    (job) => {
      job.players[0].unregistered_override = true;
    },
  ]) {
    const control = buildHrafnIntentJob(manifest, {
      ...options,
      intentEnabled: false,
    });
    const candidate = buildHrafnIntentJob(manifest, {
      ...options,
      intentEnabled: true,
    });
    mutate(control);
    mutate(candidate);
    assert.equal(compareHrafnIntentJobs(
      control,
      candidate,
      comparisonOptions(),
    ).valid, false);
  }
});
