#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_PLAN = path.join(
  ROOT,
  "experiments",
  "plan-pg2-matrix-20260719.json",
);
const EXCLUDED_MANIFEST_FILES = new Set([
  "files.sha256",
  "links.tsv",
  "manifest.json",
  "manifest.sha256",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {
    plan: DEFAULT_PLAN,
    baseArchive: null,
    output: null,
    workRoot: "/private/tmp",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !key.startsWith("--")) fail(`missing value for ${key}`);
    if (key === "--plan") result.plan = path.resolve(value);
    else if (key === "--base-archive") result.baseArchive = path.resolve(value);
    else if (key === "--output") result.output = path.resolve(value);
    else if (key === "--work-root") result.workRoot = path.resolve(value);
    else fail(`unknown argument: ${key}`);
    index += 1;
  }
  if (!result.baseArchive || !result.output) {
    fail(
      "usage: build-pg2-matrix-bundle.mjs --base-archive ARCHIVE --output ARCHIVE [--plan PLAN] [--work-root DIR]",
    );
  }
  return result;
}

function sha256Buffer(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} failed with status ${result.status ?? "unknown"}`);
  }
}

function runOutput(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} failed: ${result.stderr?.trim() || result.status}`);
  }
  return result.stdout.trim();
}

function specLabel(map, seed, arm) {
  return `formal-matched-${map.toLowerCase()}-${seed}-${arm}`;
}

async function walkEntries(root, relative = "") {
  const directory = path.join(root, relative);
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const entries = [];
  for (const child of children) {
    const childRelative = path.posix.join(relative, child.name);
    if (EXCLUDED_MANIFEST_FILES.has(childRelative)) continue;
    const absolute = path.join(root, childRelative);
    if (child.isDirectory()) {
      entries.push(...(await walkEntries(root, childRelative)));
    } else if (child.isFile()) {
      entries.push({ type: "file", absolute, relative: childRelative });
    } else if (child.isSymbolicLink()) {
      entries.push({ type: "symlink", absolute, relative: childRelative });
    } else {
      fail(`unsupported bundle entry: ${childRelative}`);
    }
  }
  return entries;
}

async function regenerateFileManifests(bundleRoot) {
  const entries = await walkEntries(bundleRoot);
  const fileLines = [];
  const linkLines = [];
  let bytes = 0;
  for (const entry of entries) {
    if (entry.type === "file") {
      const body = await readFile(entry.absolute);
      bytes += body.length;
      fileLines.push(`${sha256Buffer(body)}  ${entry.relative}`);
    } else {
      const target = await readlink(entry.absolute);
      linkLines.push(
        `${sha256Buffer(`symlink\0${target}`)}\t${entry.relative}\t${target}`,
      );
    }
  }
  const fileBody = `${fileLines.join("\n")}\n`;
  const linkBody = linkLines.length === 0 ? "" : `${linkLines.join("\n")}\n`;
  await writeFile(path.join(bundleRoot, "files.sha256"), fileBody);
  await writeFile(path.join(bundleRoot, "links.tsv"), linkBody);
  return {
    fileBody,
    linkBody,
    fileCount: fileLines.length,
    linkCount: linkLines.length,
    bytes,
  };
}

async function normalizeTimes(root) {
  const fixed = new Date("1970-01-01T00:00:00Z");
  const visit = async (current) => {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) await visit(absolute);
      if (!child.isSymbolicLink()) await utimes(absolute, fixed, fixed);
    }
    await utimes(current, fixed, fixed);
  };
  await visit(root);
}

const args = parseArgs(process.argv.slice(2));
if (runOutput("git", ["status", "--porcelain"], { cwd: ROOT }) !== "") {
  fail("matrix source worktree must be clean before bundle construction");
}
const plan = JSON.parse(await readFile(args.plan, "utf8"));
const baseArchiveSha = await sha256File(args.baseArchive);
if (baseArchiveSha !== plan.base_archive?.sha256) {
  fail(
    `base archive hash mismatch: expected ${plan.base_archive?.sha256}, got ${baseArchiveSha}`,
  );
}
if (fs.existsSync(args.output)) fail(`output already exists: ${args.output}`);
if (!fs.existsSync(args.workRoot)) fail(`work root does not exist: ${args.workRoot}`);

const buildRoot = path.join(args.workRoot, `${plan.run_id}-bundle-build`);
if (fs.existsSync(buildRoot)) fail(`build root already exists: ${buildRoot}`);
await mkdir(buildRoot, { mode: 0o700 });
const extractDestination = path.join(buildRoot, "extracted");
const extractor = path.join(ROOT, "scripts", "extract_runpod_proxywar_bundle.py");
run("python3", [
  extractor,
  "--archive",
  args.baseArchive,
  "--expected-sha256",
  baseArchiveSha,
  "--destination",
  extractDestination,
]);

const bundleRoot = path.join(extractDestination, "proxywar-runpod-bundle");
const manifestPath = path.join(bundleRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const baseCandidatePath = path.join(bundleRoot, "specs", "formal-matched-a.json");
const baseParentPath = path.join(bundleRoot, "specs", "formal-matched-b.json");
const baseCandidate = JSON.parse(await readFile(baseCandidatePath, "utf8"));
const baseParent = JSON.parse(await readFile(baseParentPath, "utf8"));
const expectedRoster = [
  "K1Z odin free",
  "K1Z Hrafn",
  "K1Z juryoku-koku",
  "K1Z katanasan",
];
const expectedPolicies = [
  plan.candidate,
  plan.parent,
  ...plan.coalition,
];
for (const expected of expectedPolicies) {
  const actual = manifest.policies?.find(
    (policy) => policy.key === expected.policy,
  );
  if (!actual || actual.image_id !== expected.image_id) {
    fail(`base bundle policy drift: ${expected.policy}`);
  }
}
if (
  plan.game.seat !== 0 ||
  plan.game.map_size !== "Compact" ||
  plan.game.max_decision_steps !== 80 ||
  baseCandidate.players?.[0]?.policy !== plan.candidate.policy ||
  baseParent.players?.[0]?.policy !== plan.parent.policy ||
  JSON.stringify(baseCandidate.players?.map((player) => player.name)) !==
    JSON.stringify(expectedRoster) ||
  JSON.stringify(baseParent.players?.map((player) => player.name)) !==
    JSON.stringify(expectedRoster) ||
  JSON.stringify(baseCandidate.game_config) !==
    JSON.stringify(baseParent.game_config) ||
  JSON.stringify(baseCandidate.players?.slice(1)) !==
    JSON.stringify(baseParent.players?.slice(1))
) {
  fail("base formal pair does not match the fixed PG2 matrix identity");
}
await rm(baseCandidatePath);
await rm(baseParentPath);

const workerBySeed = new Map();
for (const [worker, seeds] of Object.entries(plan.workers)) {
  for (const seed of seeds) {
    if (workerBySeed.has(seed)) fail(`seed assigned twice: ${seed}`);
    workerBySeed.set(seed, worker);
  }
}
if (
  plan.seeds.length !== 8 ||
  plan.maps.length !== 3 ||
  new Set(plan.maps).size !== 3 ||
  new Set(plan.seeds).size !== 8 ||
  Object.keys(plan.workers).length !== 4 ||
  Object.values(plan.workers).some((seeds) => seeds.length !== 2) ||
  workerBySeed.size !== plan.seeds.length ||
  plan.seeds.some((seed) => !workerBySeed.has(seed))
) {
  fail("plan must bind exactly eight seeds and three maps to four workers");
}

const formalSpecs = [];
const pairs = [];
for (const map of plan.maps) {
  for (const seed of plan.seeds) {
    const pairID = `${map.toLowerCase()}-${seed}`;
    const pair = {
      pair_id: pairID,
      map,
      seed,
      worker: workerBySeed.get(seed),
      seat: plan.game.seat,
      arm_order: ["candidate", "parent"],
      specs: {},
    };
    for (const [arm, role, source] of [
      ["a", "candidate", baseCandidate],
      ["b", "exact-parent", baseParent],
    ]) {
      const label = specLabel(map, seed, arm);
      const relative = `specs/${label}.json`;
      const document = structuredClone(source);
      document.game_config.map = map;
      document.game_config.seed = seed;
      const body = `${JSON.stringify(document, null, 2)}\n`;
      await writeFile(path.join(bundleRoot, relative), body, { mode: 0o644 });
      const digest = sha256Buffer(body);
      formalSpecs.push({
        label,
        path: relative,
        sha256: digest,
        role,
        max_decision_steps: plan.game.max_decision_steps,
      });
      pair.specs[role] = { label, path: relative, sha256: digest };
    }
    pairs.push(pair);
  }
}

const sourceCommit = runOutput("git", ["rev-parse", "HEAD"], { cwd: ROOT });
const builderSha = await sha256File(
  path.join(ROOT, "scripts", "build-pg2-matrix-bundle.mjs"),
);
const repositoryPlanSha = await sha256File(args.plan);
const bundledPlan = {
  ...plan,
  generated: {
    source_commit: sourceCommit,
    builder_sha256: builderSha,
    repository_plan_sha256: repositoryPlanSha,
    pair_count: pairs.length,
    formal_spec_count: formalSpecs.length,
  },
  pairs,
};
const bundledPlanBody = `${JSON.stringify(bundledPlan, null, 2)}\n`;
const bundledPlanRelative = "specs/pg2-matrix-plan.json";
await writeFile(
  path.join(bundleRoot, bundledPlanRelative),
  bundledPlanBody,
  { mode: 0o644 },
);
const bundledPlanSha = sha256Buffer(bundledPlanBody);

const runnerSource = path.join(ROOT, "scripts", "runpod-proxywar-episode.mjs");
const runnerDestination = path.join(
  bundleRoot,
  "bin",
  "runpod-proxywar-episode.mjs",
);
await copyFile(runnerSource, runnerDestination);
await chmod(runnerDestination, 0o755);
const runnerSha = await sha256File(runnerSource);
const sourceFiles = {
  "scripts/prepare-runpod-proxywar-bundle.sh": await sha256File(
    path.join(ROOT, "scripts", "prepare-runpod-proxywar-bundle.sh"),
  ),
  "scripts/runpod-proxywar-episode.mjs": runnerSha,
  "scripts/extract_runpod_proxywar_bundle.py": await sha256File(
    path.join(ROOT, "scripts", "extract_runpod_proxywar_bundle.py"),
  ),
  "test/runpod-proxywar-episode.test.mjs": await sha256File(
    path.join(ROOT, "test", "runpod-proxywar-episode.test.mjs"),
  ),
  "test/test_extract_runpod_proxywar_bundle.py": await sha256File(
    path.join(ROOT, "test", "test_extract_runpod_proxywar_bundle.py"),
  ),
};
manifest.created_by = "scripts/build-pg2-matrix-bundle.mjs";
manifest.source.commit = sourceCommit;
manifest.source.formal_specs_commit = sourceCommit;
manifest.source.files = sourceFiles;
manifest.experiment_specs = formalSpecs;
manifest.orchestrator_sha256 = runnerSha;
manifest.matrix_plan = {
  path: bundledPlanRelative,
  sha256: bundledPlanSha,
  pair_count: pairs.length,
  formal_spec_count: formalSpecs.length,
  approval_commit: plan.approval_commit,
  base_archive_sha256: baseArchiveSha,
  builder_sha256: builderSha,
};
await writeFile(
  path.join(bundleRoot, "README.txt"),
  [
    "ProxyWar PG2 24-pair local matrix bundle",
    "",
    `run_id=${plan.run_id}`,
    `approval_commit=${plan.approval_commit}`,
    `candidate_commit=${plan.candidate.commit}`,
    `parent_commit=${plan.parent.commit}`,
    `pairs=${pairs.length}`,
    "arms=candidate_then_parent_on_same_worker",
    "hosted=false",
    "upload=false",
    "submission=false",
    "champion_change=false",
    "",
  ].join("\n"),
  { mode: 0o644 },
);

const fileStats = await regenerateFileManifests(bundleRoot);
manifest.file_manifest = {
  path: "files.sha256",
  sha256: sha256Buffer(fileStats.fileBody),
  file_count: fileStats.fileCount,
  uncompressed_file_bytes: fileStats.bytes,
};
manifest.symlink_manifest = {
  path: "links.tsv",
  sha256: sha256Buffer(fileStats.linkBody),
  symlink_count: fileStats.linkCount,
};
const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, manifestBody, { mode: 0o644 });
const manifestSha = sha256Buffer(manifestBody);
await writeFile(
  path.join(bundleRoot, "manifest.sha256"),
  `${manifestSha}  manifest.json\n`,
  { mode: 0o644 },
);
await normalizeTimes(bundleRoot);
await mkdir(path.dirname(args.output), { recursive: true });
run(
  "tar",
  [
    "--no-xattrs",
    "--no-mac-metadata",
    "--uid",
    "0",
    "--gid",
    "0",
    "--uname",
    "root",
    "--gname",
    "root",
    "-czf",
    args.output,
    "-C",
    extractDestination,
    "proxywar-runpod-bundle",
  ],
  { env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
const archiveInfo = await lstat(args.output);
const archiveSha = await sha256File(args.output);
const receipt = {
  schema_version: 1,
  status: "built",
  run_id: plan.run_id,
  archive_path: args.output,
  archive_sha256: archiveSha,
  archive_bytes: archiveInfo.size,
  manifest_sha256: manifestSha,
  files_sha256: manifest.file_manifest.sha256,
  links_sha256: manifest.symlink_manifest.sha256,
  matrix_plan_sha256: bundledPlanSha,
  source_commit: sourceCommit,
  runner_sha256: runnerSha,
  builder_sha256: builderSha,
  pair_count: pairs.length,
  formal_spec_count: formalSpecs.length,
};
await writeFile(
  `${args.output}.build.json`,
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
await rm(buildRoot, { recursive: true, force: true });
console.log(
  `PG2_MATRIX_BUNDLE_BUILT archive_sha256=${archiveSha} manifest_sha256=${manifestSha} pairs=${pairs.length}`,
);
