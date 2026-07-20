#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASE_IMAGE =
  "public.ecr.aws/q5f4m8t9/cogames@sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1";
export const BASE_IMAGE_ID =
  "sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1";
export const NODE_SHA256 =
  "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_ARCHIVE_PATH = /^specs\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/;
const SECRET_KEY = /(api.?key|secret|password|credential|access.?token|private.?key)/i;
const EVALUATION_ARMS = Object.freeze({
  m0: ["evaluation-m0", "evaluation-m0-player.mjs"],
  "grow-opening": ["evaluation-grow-opening", "evaluation-grow-opening-player.mjs"],
  "grow-low-share": ["evaluation-grow-low-share", "evaluation-grow-low-share-player.mjs"],
  "convert-weakest": ["evaluation-convert-weakest", "evaluation-convert-weakest-player.mjs"],
  "convert-largest": ["evaluation-convert-largest", "evaluation-convert-largest-player.mjs"],
});
const REQUIRED_SHARED_FILES = Object.freeze([
  "evaluation-static-intent-player.mjs",
  "evaluation-static-intent.mjs",
  "intent-controller.mjs",
  "strategy-engine.mjs",
]);

function usage() {
  return `Usage:
  node scripts/prepare-mickey-runpod-bundle.mjs \\
    --manifest /absolute/input.json --manifest-sha256 <hex> \\
    --output /private/tmp/mickey-bundle.tar.gz [--check-images] [--keep-staging]

The input is declarative and hash-bound. The command reads exact local Docker
images, but never calls RunPod, Coworld, or any credential provider.`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label} has unknown field ${key}`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertCanonicalRelative(value, label, pattern = null) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a string`);
  assert(!path.posix.isAbsolute(value), `${label} must be relative`);
  assert(!value.split("/").some((part) => part === "" || part === "." || part === ".."), `${label} is not canonical`);
  if (pattern) assert(pattern.test(value), `${label} has an invalid form`);
}

function assertNoSecrets(value, label = "manifest") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${label}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    assert(!SECRET_KEY.test(key), `${label} contains forbidden secret-bearing field ${key}`);
    assertNoSecrets(child, `${label}.${key}`);
  }
}

export function validateInput(document) {
  assertNoSecrets(document);
  exactKeys(document, [
    "schema_version",
    "kind",
    "bundle_id",
    "runtime",
    "source_reach_receipt",
    "pair_index",
    "shared_files",
    "policies",
    "experiment_specs",
  ], "manifest");
  assert(document.schema_version === 1 && document.kind === "mickey_runpod_multi_policy_bundle", "manifest schema/kind mismatch");
  assert(typeof document.bundle_id === "string" && SAFE_KEY.test(document.bundle_id), "bundle_id is invalid");
  exactKeys(document.runtime, ["image", "image_id", "architecture", "node_sha256"], "runtime");
  assert(document.runtime.image === BASE_IMAGE && document.runtime.image_id === BASE_IMAGE_ID, "runtime image is not the pinned cogames image");
  assert(document.runtime.architecture === "amd64" && document.runtime.node_sha256 === NODE_SHA256, "runtime architecture or Node hash mismatch");
  exactKeys(document.source_reach_receipt, ["path", "sha256"], "source_reach_receipt");
  assertCanonicalRelative(document.source_reach_receipt.path, "source_reach_receipt.path");
  assert(SHA256.test(document.source_reach_receipt.sha256), "source reach receipt hash is invalid");
  exactKeys(document.pair_index, ["path", "sha256"], "pair_index");
  assertCanonicalRelative(document.pair_index.path, "pair_index.path");
  assert(SHA256.test(document.pair_index.sha256), "pair_index hash is invalid");

  assert(Array.isArray(document.shared_files) && document.shared_files.length === REQUIRED_SHARED_FILES.length, "shared_files must contain the four exact evaluator sources");
  const shared = new Set();
  for (const [index, record] of document.shared_files.entries()) {
    exactKeys(record, ["path", "sha256"], `shared_files[${index}]`);
    assert(REQUIRED_SHARED_FILES.includes(record.path) && !shared.has(record.path), `shared_files[${index}] is unknown or duplicate`);
    assert(SHA256.test(record.sha256), `shared_files[${index}].sha256 is invalid`);
    shared.add(record.path);
  }

  assert(Array.isArray(document.policies) && document.policies.length >= 6 && document.policies.length <= 32, "policies must contain all evaluators and at least one opponent");
  const keys = new Set();
  const arms = new Set();
  for (const [index, policy] of document.policies.entries()) {
    const label = `policies[${index}]`;
    exactKeys(policy, [
      "kind", "policy_id", "key", "arm", "docker_target", "surrogate_source",
      "source_commit", "local_reference", "image_id", "architecture", "image_user",
      "working_dir", "container_entrypoint", "container_cmd", "upload_label",
      "upload_eligible", "bundle_root", "run", "entrypoint_sha256",
    ], label);
    assert(policy.kind === "evaluation" || policy.kind === "opponent", `${label}.kind is invalid`);
    assert(typeof policy.key === "string" && SAFE_KEY.test(policy.key) && !keys.has(policy.key), `${label}.key is invalid or duplicate`);
    keys.add(policy.key);
    assert(typeof policy.local_reference === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{2,255}$/.test(policy.local_reference), `${label}.local_reference is invalid`);
    assert(IMAGE_ID.test(policy.image_id), `${label}.image_id is invalid`);
    assert(policy.architecture === "amd64", `${label}.architecture must be amd64`);
    assert(typeof policy.image_user === "string" && !/[\0\n]/.test(policy.image_user), `${label}.image_user is invalid`);
    assert(policy.working_dir === "/app", `${label}.working_dir must be /app`);
    assert(Array.isArray(policy.container_entrypoint) && JSON.stringify(policy.container_entrypoint) === JSON.stringify(["docker-entrypoint.sh"]), `${label}.container_entrypoint mismatch`);
    assert(Array.isArray(policy.container_cmd) && policy.container_cmd.length === 2 && policy.container_cmd[0] === "node" && /^\/app\/[a-zA-Z0-9._-]+\.mjs$/.test(policy.container_cmd[1]), `${label}.container_cmd is invalid`);
    assert(policy.upload_label === null || policy.upload_label === "false", `${label}.upload_label must be null or false`);
    assert(policy.upload_eligible === false, `${label}.upload_eligible must be false`);
    assert(policy.bundle_root === `policies/${policy.key}/app`, `${label}.bundle_root mismatch`);
    assert(Array.isArray(policy.run) && JSON.stringify(policy.run) === JSON.stringify(["node", path.posix.basename(policy.container_cmd[1])]), `${label}.run must match the image CMD entrypoint`);
    assert(SHA256.test(policy.entrypoint_sha256), `${label}.entrypoint_sha256 is invalid`);
    if (policy.kind === "evaluation") {
      const expected = EVALUATION_ARMS[policy.arm];
      assert(expected && !arms.has(policy.arm), `${label}.arm is unknown or duplicate`);
      arms.add(policy.arm);
      assert(policy.policy_id === `mickey-static-eval/${policy.arm}` && policy.key === `mickey-static-eval-${policy.arm}`, `${label} evaluation identity mismatch`);
      assert(policy.docker_target === expected[0] && policy.run[1] === expected[1], `${label} target or entrypoint mismatch`);
      assert(policy.surrogate_source === "static-eval-v1" && COMMIT.test(policy.source_commit), `${label} source provenance mismatch`);
      assert(policy.image_user === "node", `${label} evaluation image must run as node`);
      assert(policy.upload_label === "false", `${label} evaluation upload label must be false`);
    } else {
      assert(policy.policy_id === null && policy.arm === null && policy.docker_target === null && policy.surrogate_source === null && policy.source_commit === null, `${label} opponent metadata must not impersonate an evaluator`);
    }
  }
  assert(arms.size === Object.keys(EVALUATION_ARMS).length, "policies must contain M0 plus the four retained evaluator arms exactly once");

  assert(Array.isArray(document.experiment_specs) && document.experiment_specs.length >= 6 && document.experiment_specs.length <= 128, "experiment_specs is incomplete");
  const specLabels = new Set();
  const archivePaths = new Set();
  const roles = new Set();
  const horizons = new Set();
  for (const [index, spec] of document.experiment_specs.entries()) {
    const label = `experiment_specs[${index}]`;
    exactKeys(spec, ["label", "source", "archive_path", "sha256", "role", "max_decision_steps"], label);
    assert(typeof spec.label === "string" && SAFE_KEY.test(spec.label) && !specLabels.has(spec.label), `${label}.label is invalid or duplicate`);
    specLabels.add(spec.label);
    assertCanonicalRelative(spec.source, `${label}.source`);
    assertCanonicalRelative(spec.archive_path, `${label}.archive_path`, SAFE_ARCHIVE_PATH);
    assert(!archivePaths.has(spec.archive_path), `${label}.archive_path is duplicate`);
    archivePaths.add(spec.archive_path);
    assert(SHA256.test(spec.sha256), `${label}.sha256 is invalid`);
    assert(spec.role === "candidate" || spec.role === "exact-parent", `${label}.role is invalid`);
    roles.add(spec.role);
    assert(Number.isInteger(spec.max_decision_steps) && spec.max_decision_steps >= 1 && spec.max_decision_steps <= 600, `${label}.max_decision_steps is invalid`);
    horizons.add(spec.max_decision_steps);
  }
  assert(roles.size === 2, "experiment_specs requires candidate and exact-parent roles");
  assert(horizons.size === 1, "all matched specs must use one decision horizon");
  return document;
}

export function validateImageRecord(policy, actual) {
  assert(actual.Id === policy.image_id, `${policy.key}: image ID mismatch: expected ${policy.image_id}, got ${actual.Id}`);
  assert(actual.Architecture === policy.architecture && actual.Os === "linux", `${policy.key}: image architecture/OS mismatch`);
  const config = actual.Config ?? {};
  assert((config.User ?? "") === policy.image_user, `${policy.key}: image user mismatch`);
  assert(config.WorkingDir === policy.working_dir, `${policy.key}: image working directory mismatch`);
  assert(JSON.stringify(config.Entrypoint ?? null) === JSON.stringify(policy.container_entrypoint), `${policy.key}: image entrypoint mismatch`);
  assert(JSON.stringify(config.Cmd ?? null) === JSON.stringify(policy.container_cmd), `${policy.key}: image CMD mismatch`);
  const actualUpload = config.Labels?.["com.welttowelt.proxywar.upload-eligible"] ?? null;
  assert(actualUpload === policy.upload_label, `${policy.key}: upload-eligibility label mismatch`);
  if (policy.kind === "evaluation") {
    assert(config.Labels?.["com.welttowelt.proxywar.evaluation-source"] === policy.surrogate_source, `${policy.key}: evaluation-source label mismatch`);
  }
  return true;
}

function hashBytes(body) {
  return createHash("sha256").update(body).digest("hex");
}

function hashFile(filePath) {
  return hashBytes(readFileSync(filePath));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function parseArgs(argv) {
  const options = { manifest: null, manifestSha256: null, output: null, checkImages: false, keepStaging: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check-images") options.checkImages = true;
    else if (arg === "--keep-staging") options.keepStaging = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--manifest", "--manifest-sha256", "--output"].includes(arg)) {
      assert(index + 1 < argv.length, `${arg} requires a value`);
      const key = { "--manifest": "manifest", "--manifest-sha256": "manifestSha256", "--output": "output" }[arg];
      options[key] = argv[++index];
    } else throw new Error(`unknown option: ${arg}`);
  }
  if (!options.help) {
    assert(path.isAbsolute(options.manifest ?? ""), "--manifest must be absolute");
    assert(SHA256.test(options.manifestSha256 ?? ""), "--manifest-sha256 must be 64 lowercase hex");
    assert(path.isAbsolute(options.output ?? "") && options.output.endsWith(".tar.gz"), "--output must be an absolute .tar.gz path");
  }
  return options;
}

function readVerifiedInput(options) {
  const info = lstatSync(options.manifest);
  assert(info.isFile() && !info.isSymbolicLink(), "manifest must be a regular non-symlink file");
  assert(realpathSync(options.manifest) === options.manifest, "manifest path must already be canonical");
  const body = readFileSync(options.manifest);
  assert(hashBytes(body) === options.manifestSha256, "manifest SHA-256 mismatch");
  return validateInput(JSON.parse(body));
}

function resolveRepoFile(relative, expectedHash, label) {
  const absolute = path.resolve(REPO_ROOT, relative);
  assert(absolute.startsWith(`${REPO_ROOT}${path.sep}`), `${label} escapes the repository`);
  const info = lstatSync(absolute);
  assert(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular file`);
  assert(hashFile(absolute) === expectedHash, `${label} hash mismatch`);
  return absolute;
}

function inspectImages(document) {
  const base = JSON.parse(run("docker", ["image", "inspect", document.runtime.image]))[0];
  assert(base.Id === document.runtime.image_id && base.Architecture === "amd64" && base.Os === "linux", "pinned runtime image identity mismatch");
  const inspected = new Map();
  for (const policy of document.policies) {
    const record = JSON.parse(run("docker", ["image", "inspect", policy.local_reference]))[0];
    validateImageRecord(policy, record);
    inspected.set(policy.key, record);
  }
  return inspected;
}

function walk(root, relative = "") {
  const entries = [];
  for (const child of readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const next = path.posix.join(relative.split(path.sep).join("/"), child.name);
    const absolute = path.join(root, ...next.split("/"));
    if (child.isDirectory()) entries.push(...walk(root, next));
    else if (child.isFile()) entries.push({ type: "file", relative: next, absolute });
    else if (child.isSymbolicLink()) entries.push({ type: "symlink", relative: next, absolute });
    else throw new Error(`unsupported file type: ${next}`);
  }
  return entries;
}

function treeDigest(root) {
  const hash = createHash("sha256");
  for (const entry of walk(root)) {
    hash.update(`${entry.type}\0${entry.relative}\0`);
    if (entry.type === "file") hash.update(readFileSync(entry.absolute));
    else hash.update(readlinkSync(entry.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function deduplicateNodeModules(bundleRoot, policies) {
  const sharedRoot = path.join(bundleRoot, "shared", "node-modules");
  mkdirSync(sharedRoot, { recursive: true });
  const unique = new Map();
  let linkedPolicies = 0;
  for (const policy of policies) {
    const app = path.join(bundleRoot, policy.bundle_root);
    const modules = path.join(app, "node_modules");
    assert(existsSync(modules) && lstatSync(modules).isDirectory(), `${policy.key}: node_modules missing after extraction`);
    const digest = treeDigest(modules);
    const canonical = path.join(sharedRoot, digest);
    if (!unique.has(digest)) {
      renameSync(modules, canonical);
      unique.set(digest, canonical);
    } else {
      rmSync(modules, { recursive: true });
    }
    const target = path.relative(app, canonical);
    symlinkSync(target, modules);
    linkedPolicies += 1;
  }
  return { unique_node_modules_trees: unique.size, linked_policy_trees: linkedPolicies };
}

function createContainer(reference) {
  return run("docker", ["create", "--platform", "linux/amd64", reference]);
}

function removeContainer(id) {
  try { run("docker", ["rm", id]); } catch { /* best-effort cleanup of our own temporary container */ }
}

function copyFromImage(reference, containerPath, destination) {
  const id = createContainer(reference);
  try {
    mkdirSync(destination, { recursive: true });
    run("docker", ["cp", `${id}:${containerPath}`, destination]);
  } finally {
    removeContainer(id);
  }
}

function checkSecretFilenames(bundleRoot) {
  const forbidden = new Set([".env", ".env.local", ".npmrc", "credentials", "credentials.json", "id_rsa", "id_ed25519", "service-account.json"]);
  for (const entry of walk(bundleRoot)) {
    assert(!forbidden.has(path.posix.basename(entry.relative)), `refusing secret-bearing filename: ${entry.relative}`);
  }
}

function gitSourceReceipt(paths) {
  run("git", ["-C", REPO_ROOT, "ls-files", "--error-unmatch", ...paths]);
  execFileSync("git", ["-C", REPO_ROOT, "diff", "--quiet", "HEAD", "--", ...paths]);
  execFileSync("git", ["-C", REPO_ROOT, "diff", "--cached", "--quiet", "HEAD", "--", ...paths]);
  return run("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"]);
}

function writeWrapper(bundleRoot) {
  const wrapper = path.join(bundleRoot, "bin", "runpod-proxywar-episode");
  writeFileSync(wrapper, `#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BUNDLE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
case "$(uname -m)" in x86_64|amd64) ;; *) echo "unsupported architecture" >&2; exit 1;; esac
cd "$BUNDLE_ROOT"
exec "$BUNDLE_ROOT/runtime/node/bin/node" "$BUNDLE_ROOT/bin/runpod-proxywar-episode.mjs" --bundle-root "$BUNDLE_ROOT" "$@"
`, { mode: 0o755 });
}

function canonicalPolicy(policy) {
  if (policy.kind === "evaluation") {
    return {
      policy_id: policy.policy_id,
      key: policy.key,
      arm: policy.arm,
      docker_target: policy.docker_target,
      surrogate_source: policy.surrogate_source,
      source_commit: policy.source_commit,
      local_reference: policy.local_reference,
      image_id: policy.image_id,
      architecture: policy.architecture,
      image_user: policy.image_user,
      container_entrypoint: policy.container_entrypoint,
      container_cmd: policy.container_cmd,
      upload_label: policy.upload_label,
      bundle_root: policy.bundle_root,
      run: policy.run,
      entrypoint_sha256: policy.entrypoint_sha256,
      upload_eligible: false,
    };
  }
  return {
    key: policy.key,
    kind: "opponent",
    local_reference: policy.local_reference,
    image_id: policy.image_id,
    architecture: policy.architecture,
    image_user: policy.image_user,
    container_entrypoint: policy.container_entrypoint,
    container_cmd: policy.container_cmd,
    upload_label: policy.upload_label,
    bundle_root: policy.bundle_root,
    run: policy.run,
    entrypoint_sha256: policy.entrypoint_sha256,
    upload_eligible: false,
  };
}

function materialize(document, options) {
  const sidecars = [options.output, `${options.output}.sha256`, `${options.output}.extract.py`, `${options.output}.extract.py.sha256`, `${options.output}.manifest.json`, `${options.output}.manifest.json.sha256`, `${options.output}.input.json`, `${options.output}.input.json.sha256`, `${options.output}.fanout-fragment.json`, `${options.output}.fanout-fragment.json.sha256`];
  for (const output of sidecars) assert(!existsSync(output), `refusing to overwrite ${output}`);
  const sourcePaths = [
    "scripts/prepare-runpod-proxywar-bundle.sh",
    "scripts/prepare-mickey-runpod-bundle.mjs",
    "scripts/generate-mickey-fanout-specs.mjs",
    "scripts/runpod-proxywar-episode.mjs",
    "scripts/extract_runpod_proxywar_bundle.py",
    "test/prepare-mickey-runpod-bundle.test.mjs",
    "test/runpod-proxywar-episode.test.mjs",
    "test/test_extract_runpod_proxywar_bundle.py",
    path.relative(REPO_ROOT, options.manifest),
    document.source_reach_receipt.path,
    document.pair_index.path,
    ...document.experiment_specs.map((spec) => spec.source),
  ];
  const sourceCommit = gitSourceReceipt([...new Set(sourcePaths)]);
  const staging = mkdtempSync(path.join(os.tmpdir(), "mickey-multi-policy-bundle."));
  const bundleRoot = path.join(staging, "proxywar-runpod-bundle");
  mkdirSync(path.join(bundleRoot, "bin"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "policies"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "specs"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "evidence"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "runtime", "integration"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "runtime", "proxywar"), { recursive: true });
  mkdirSync(path.join(bundleRoot, "runtime", "node", "bin"), { recursive: true });

  const runnerSource = path.join(REPO_ROOT, "scripts", "runpod-proxywar-episode.mjs");
  const extractorSource = path.join(REPO_ROOT, "scripts", "extract_runpod_proxywar_bundle.py");
  copyFileSync(runnerSource, path.join(bundleRoot, "bin", "runpod-proxywar-episode.mjs"));
  copyFileSync(extractorSource, path.join(bundleRoot, "bin", "extract_runpod_proxywar_bundle.py"));
  chmodSync(path.join(bundleRoot, "bin", "runpod-proxywar-episode.mjs"), 0o755);
  chmodSync(path.join(bundleRoot, "bin", "extract_runpod_proxywar_bundle.py"), 0o755);
  writeWrapper(bundleRoot);

  const runtimeID = createContainer(document.runtime.image);
  try {
    run("docker", ["cp", `${runtimeID}:/app/integration/.`, path.join(bundleRoot, "runtime", "integration")]);
    run("docker", ["cp", `${runtimeID}:/app/proxywar/.`, path.join(bundleRoot, "runtime", "proxywar")]);
    run("docker", ["cp", `${runtimeID}:/usr/local/bin/node`, path.join(bundleRoot, "runtime", "node", "bin", "node")]);
  } finally { removeContainer(runtimeID); }
  chmodSync(path.join(bundleRoot, "runtime", "node", "bin", "node"), 0o755);
  assert(hashFile(path.join(bundleRoot, "runtime", "node", "bin", "node")) === NODE_SHA256, "bundled Node binary hash mismatch");

  for (const policy of document.policies) {
    const app = path.join(bundleRoot, policy.bundle_root);
    copyFromImage(policy.local_reference, "/app/.", app);
    const entrypoint = path.join(app, policy.run[1]);
    assert(existsSync(entrypoint) && hashFile(entrypoint) === policy.entrypoint_sha256, `${policy.key}: extracted entrypoint hash mismatch`);
    if (policy.kind === "evaluation") {
      for (const shared of document.shared_files) {
        assert(hashFile(path.join(app, shared.path)) === shared.sha256, `${policy.key}: shared file ${shared.path} mismatch`);
      }
    }
  }
  const deduplication = deduplicateNodeModules(bundleRoot, document.policies);

  const receiptSource = resolveRepoFile(document.source_reach_receipt.path, document.source_reach_receipt.sha256, "source reach receipt");
  copyFileSync(receiptSource, path.join(bundleRoot, "evidence", "mickey-static-intent-source-reach.json"));
  const pairIndexSource = resolveRepoFile(document.pair_index.path, document.pair_index.sha256, "pair index");
  copyFileSync(pairIndexSource, path.join(bundleRoot, "evidence", "mickey-fanout-pair-index.json"));
  for (const spec of document.experiment_specs) {
    const source = resolveRepoFile(spec.source, spec.sha256, `spec ${spec.label}`);
    const parsed = JSON.parse(readFileSync(source, "utf8"));
    assert(parsed?.game_config?.max_decision_steps === spec.max_decision_steps, `${spec.label}: source horizon mismatch`);
    const destination = path.join(bundleRoot, ...spec.archive_path.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  const candidateCanary = JSON.parse(readFileSync(resolveRepoFile(document.experiment_specs.find((spec) => spec.label === "grow-opening-candidate").source, document.experiment_specs.find((spec) => spec.label === "grow-opening-candidate").sha256, "candidate canary source"), "utf8"));
  const controlCanary = JSON.parse(readFileSync(resolveRepoFile(document.experiment_specs.find((spec) => spec.label === "grow-m0").source, document.experiment_specs.find((spec) => spec.label === "grow-m0").sha256, "control canary source"), "utf8"));
  for (const [name, spec] of [["canary-candidate-player-specs.json", candidateCanary], ["canary-control-player-specs.json", controlCanary]]) {
    spec.game_config.max_decision_steps = 3;
    spec.game_config.episode_timeout_seconds = 300;
    writeFileSync(path.join(bundleRoot, "specs", name), `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o644 });
  }
  checkSecretFilenames(bundleRoot);

  const excluded = new Set(["files.sha256", "links.tsv", "manifest.json", "manifest.sha256"]);
  const manifestEntries = () => walk(bundleRoot).filter((entry) => !excluded.has(entry.relative));
  const fileLines = [];
  const linkLines = [];
  let fileBytes = 0;
  for (const entry of manifestEntries()) {
    if (entry.type === "file") {
      const body = readFileSync(entry.absolute);
      fileBytes += body.length;
      fileLines.push(`${hashBytes(body)}  ${entry.relative}`);
    } else {
      const target = readlinkSync(entry.absolute);
      linkLines.push(`${hashBytes(`symlink\0${target}`)}\t${entry.relative}\t${target}`);
    }
  }
  writeFileSync(path.join(bundleRoot, "files.sha256"), `${fileLines.join("\n")}\n`);
  writeFileSync(path.join(bundleRoot, "links.tsv"), linkLines.length ? `${linkLines.join("\n")}\n` : "");
  const canaryCandidatePath = path.join(bundleRoot, "specs", "canary-candidate-player-specs.json");
  const canaryControlPath = path.join(bundleRoot, "specs", "canary-control-player-specs.json");
  const sourceFiles = Object.fromEntries(sourcePaths.filter((relative) => relative !== path.relative(REPO_ROOT, options.manifest)).map((relative) => [relative, hashFile(path.join(REPO_ROOT, relative))]));
  const bundleManifest = {
    schema_version: 1,
    base_image: BASE_IMAGE,
    created_by: "scripts/prepare-mickey-runpod-bundle.mjs",
    contains_credentials: false,
    invokes_runpod_api: false,
    source: {
      commit: sourceCommit,
      formal_specs_commit: sourceCommit,
      policy_source_commit: document.policies.find((policy) => policy.kind === "evaluation").source_commit,
      input_manifest_sha256: options.manifestSha256,
      source_reach_receipt_sha256: document.source_reach_receipt.sha256,
      files: sourceFiles,
    },
    runtime: {
      mode: "self_contained_bundle",
      source_base_image: BASE_IMAGE,
      architecture: "amd64",
      node_version: "24.18.0",
      node_sha256: NODE_SHA256,
      bundle_roots: ["runtime/integration", "runtime/proxywar", "runtime/node"],
    },
    experiment_specs: document.experiment_specs.map(({ label, archive_path: specPath, sha256, role, max_decision_steps }) => ({ label, path: specPath, sha256, role, max_decision_steps })),
    transport_canaries: [
      { label: "transport-canary-candidate", path: "specs/canary-candidate-player-specs.json", sha256: hashFile(canaryCandidatePath), role: "candidate" },
      { label: "transport-canary-control", path: "specs/canary-control-player-specs.json", sha256: hashFile(canaryControlPath), role: "exact-parent" },
    ],
    orchestrator_sha256: hashFile(path.join(bundleRoot, "bin", "runpod-proxywar-episode.mjs")),
    file_manifest: { path: "files.sha256", sha256: hashFile(path.join(bundleRoot, "files.sha256")), file_count: fileLines.length, uncompressed_file_bytes: fileBytes },
    symlink_manifest: { path: "links.tsv", sha256: hashFile(path.join(bundleRoot, "links.tsv")), symlink_count: linkLines.length },
    deduplication,
    policies: document.policies.map(canonicalPolicy),
  };
  writeFileSync(path.join(bundleRoot, "manifest.json"), `${JSON.stringify(bundleManifest, null, 2)}\n`, { mode: 0o644 });
  const bundleManifestSha = hashFile(path.join(bundleRoot, "manifest.json"));
  writeFileSync(path.join(bundleRoot, "manifest.sha256"), `${bundleManifestSha}  manifest.json\n`, { mode: 0o644 });

  const epoch = new Date(1000);
  for (const entry of walk(bundleRoot)) {
    try {
      if (entry.type === "symlink") lutimesSync(entry.absolute, epoch, epoch);
      else utimesSync(entry.absolute, epoch, epoch);
    } catch { /* platform may not support symlink timestamps */ }
  }
  mkdirSync(path.dirname(options.output), { recursive: true });
  const tarPath = options.output.slice(0, -3);
  assert(!existsSync(tarPath), `refusing to overwrite ${tarPath}`);
  const listPath = path.join(staging, "archive-files.txt");
  const archiveFiles = walk(bundleRoot).map((entry) => `proxywar-runpod-bundle/${entry.relative}`).sort();
  writeFileSync(listPath, `${archiveFiles.join("\n")}\n`);
  const tarVersion = run("tar", ["--version"]);
  const tarArgs = tarVersion.toLowerCase().includes("bsdtar")
    ? ["--no-xattrs", "--no-mac-metadata", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root", "-cf", tarPath, "-C", staging, "-T", listPath]
    : ["--no-xattrs", "--owner=0", "--group=0", "--numeric-owner", "-cf", tarPath, "-C", staging, "-T", listPath];
  execFileSync("tar", tarArgs, { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  execFileSync("gzip", ["-n", "-9", tarPath], { stdio: "inherit" });
  assert(existsSync(options.output), "gzip did not produce the requested archive");
  const archiveSha = hashFile(options.output);
  writeFileSync(`${options.output}.sha256`, `${archiveSha}  ${path.basename(options.output)}\n`);
  copyFileSync(extractorSource, `${options.output}.extract.py`);
  chmodSync(`${options.output}.extract.py`, 0o755);
  const extractorSha = hashFile(`${options.output}.extract.py`);
  writeFileSync(`${options.output}.extract.py.sha256`, `${extractorSha}  ${path.basename(options.output)}.extract.py\n`);
  copyFileSync(path.join(bundleRoot, "manifest.json"), `${options.output}.manifest.json`);
  writeFileSync(`${options.output}.manifest.json.sha256`, `${bundleManifestSha}  ${path.basename(options.output)}.manifest.json\n`);
  copyFileSync(options.manifest, `${options.output}.input.json`);
  writeFileSync(`${options.output}.input.json.sha256`, `${options.manifestSha256}  ${path.basename(options.output)}.input.json\n`);
  const pairIndex = JSON.parse(readFileSync(pairIndexSource, "utf8"));
  const fanoutFragment = {
    schema_version: 1,
    kind: "mickey_cpu_fanout_bundle_fragment",
    evidence_scope: "diagnostic_only",
    bundle: { path: options.output, sha256: archiveSha },
    extractor: { path: `${options.output}.extract.py`, sha256: extractorSha },
    bundle_manifest: { path: `${options.output}.manifest.json`, sha256: bundleManifestSha },
    input_manifest: { path: `${options.output}.input.json`, sha256: options.manifestSha256 },
    source_reach_receipt: {
      path: path.join(REPO_ROOT, document.source_reach_receipt.path),
      sha256: document.source_reach_receipt.sha256,
    },
    source_commit: sourceCommit,
    policy_source_commit: bundleManifest.source.policy_source_commit,
    shared_files: document.shared_files,
    policies: document.policies.map(canonicalPolicy),
    pair_count: pairIndex.pair_count,
    pairs: pairIndex.pairs,
  };
  const fanoutFragmentBody = `${JSON.stringify(fanoutFragment, null, 2)}\n`;
  writeFileSync(`${options.output}.fanout-fragment.json`, fanoutFragmentBody, { mode: 0o644 });
  const fanoutFragmentSha = hashBytes(fanoutFragmentBody);
  writeFileSync(`${options.output}.fanout-fragment.json.sha256`, `${fanoutFragmentSha}  ${path.basename(options.output)}.fanout-fragment.json\n`);
  const result = {
    bundle: options.output,
    bundle_sha256: archiveSha,
    bundle_bytes: statSync(options.output).size,
    extractor: `${options.output}.extract.py`,
    extractor_sha256: extractorSha,
    bundle_manifest: `${options.output}.manifest.json`,
    bundle_manifest_sha256: bundleManifestSha,
    input_manifest: `${options.output}.input.json`,
    input_manifest_sha256: options.manifestSha256,
    fanout_fragment: `${options.output}.fanout-fragment.json`,
    fanout_fragment_sha256: fanoutFragmentSha,
    source_commit: sourceCommit,
    policy_source_commit: bundleManifest.source.policy_source_commit,
    source_reach_receipt_sha256: document.source_reach_receipt.sha256,
    ...deduplication,
    staging: options.keepStaging ? bundleRoot : null,
  };
  if (!options.keepStaging) rmSync(staging, { recursive: true });
  return result;
}

export function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const document = readVerifiedInput(options);
  inspectImages(document);
  if (options.checkImages) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: "images_verified", policies: document.policies.map(({ key, image_id }) => ({ key, image_id })) }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...materialize(document, options) }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`MICKEY_BUNDLE_FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
