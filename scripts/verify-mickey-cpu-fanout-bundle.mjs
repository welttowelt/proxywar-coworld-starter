#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--bundle-root", "--contract", "--output"].includes(key)) {
      throw new Error("usage: verify-mickey-cpu-fanout-bundle.mjs --bundle-root DIR --contract JSON --output JSON");
    }
    if (Object.hasOwn(values, key)) throw new Error(`duplicate option ${key}`);
    values[key] = value;
  }
  for (const key of ["--bundle-root", "--contract", "--output"]) {
    assert(typeof values[key] === "string" && path.isAbsolute(values[key]), `${key} must be absolute`);
  }
  return {
    bundleRoot: values["--bundle-root"],
    contractPath: values["--contract"],
    outputPath: values["--output"],
  };
}

function parseFileManifest(body) {
  const entries = new Map();
  for (const line of body.split("\n")) {
    if (line === "") continue;
    // npm scopes and game assets legitimately contain @, spaces, parentheses,
    // and Unicode punctuation. Parse the fixed hash separator, then enforce a
    // canonical relative POSIX path instead of maintaining a brittle allowlist.
    const match = line.match(/^([a-f0-9]{64})  (.+)$/u);
    assert(match, "files.sha256 contains an unsafe line");
    const relative = match[2];
    assert(
      !path.posix.isAbsolute(relative) &&
      path.posix.normalize(relative) === relative &&
      !relative.split("/").some((part) => part === "" || part === "." || part === "..") &&
      !/[\\\u0000-\u001f\u007f]/u.test(relative),
      "files.sha256 contains a non-canonical path",
    );
    assert(!entries.has(relative), "files.sha256 contains a duplicate path");
    entries.set(relative, match[1]);
  }
  assert(entries.size > 0, "files.sha256 is empty");
  return entries;
}

async function verifyPinnedFile(bundleRoot, relativePath, expectedSha256, fileManifest) {
  assert(SHA256.test(expectedSha256), `invalid expected SHA-256 for ${relativePath}`);
  assert(fileManifest.get(relativePath) === expectedSha256, `${relativePath} is not exactly pinned by files.sha256`);
  const lexical = path.resolve(bundleRoot, relativePath);
  assert(isInside(lexical, bundleRoot), `${relativePath} escapes the bundle`);
  const info = await lstat(lexical).catch(() => null);
  assert(info?.isFile() && !info.isSymbolicLink(), `${relativePath} is missing, non-regular, or a symlink`);
  const resolved = await realpath(lexical);
  assert(isInside(resolved, bundleRoot), `${relativePath} resolves outside the bundle`);
  const actual = await hashFile(resolved);
  assert(actual === expectedSha256, `${relativePath} hash mismatch`);
  return { path: relativePath, sha256: actual, bytes: (await stat(resolved)).size };
}

function validateBundlePolicy(policy, identity, label) {
  assert(isObject(policy), `${label} policy is missing from bundle manifest`);
  for (const key of [
    "policy_id",
    "key",
    "arm",
    "docker_target",
    "surrogate_source",
    "source_commit",
    "image_id",
    "architecture",
    "bundle_root",
    "run",
    "entrypoint_sha256",
    "upload_eligible",
  ]) {
    assert(Object.hasOwn(policy, key), `${label} bundle policy is missing ${key}`);
  }
  assert(policy.policy_id === identity.policy_id, `${label} policy_id mismatch`);
  assert(policy.key === identity.policy_key, `${label} policy key mismatch`);
  assert(policy.arm === identity.arm, `${label} arm mismatch`);
  assert(policy.docker_target === identity.docker_target, `${label} Docker target mismatch`);
  assert(policy.surrogate_source === identity.surrogate_source, `${label} surrogate source mismatch`);
  assert(policy.source_commit === identity.source_commit, `${label} source commit mismatch`);
  assert(policy.image_id === identity.image_id, `${label} image ID mismatch`);
  assert(policy.architecture === "amd64", `${label} image architecture is not amd64`);
  assert(policy.bundle_root === identity.bundle_root, `${label} bundle root mismatch`);
  assert(equalJson(policy.run, identity.run), `${label} run argv mismatch`);
  assert(policy.entrypoint_sha256 === identity.entrypoint_sha256, `${label} entrypoint hash mismatch`);
  assert(policy.upload_eligible === false && identity.upload_eligible === false, `${label} is not evaluation-only`);
}

function validateSpecShape(document, identity, fixture, label) {
  assert(isObject(document) && document.schema_version === 1, `${label} spec schema is invalid`);
  assert(isObject(document.game_config), `${label} game_config is missing`);
  assert(document.game_config.map === fixture.map, `${label} map does not match preregistration`);
  assert(document.game_config.seed === fixture.seed, `${label} seed does not match preregistration`);
  assert(
    document.game_config.max_decision_steps === fixture.max_decision_steps,
    `${label} decision horizon does not match preregistration`,
  );
  assert(
    document.game_config.num_agents === fixture.roster.length,
    `${label} num_agents does not match roster`,
  );
  assert(Array.isArray(document.players) && document.players.length === fixture.roster.length, `${label} players do not match roster`);
  document.players.forEach((player, seat) => {
    assert(isObject(player), `${label} player ${seat} is invalid`);
    assert(player.name === fixture.roster[seat].name, `${label} roster name mismatch at seat ${seat}`);
  });
  const tested = document.players[fixture.seat];
  assert(tested.policy === identity.policy_key, `${label} tested policy key mismatch`);
  assert(tested.cwd === identity.bundle_root, `${label} tested policy cwd mismatch`);
  assert(equalJson(tested.run, identity.run), `${label} tested policy run argv mismatch`);
}

function validateMatchedSpecs(candidateSpec, m0Spec, fixture) {
  assert(equalJson(candidateSpec.game_config, m0Spec.game_config), "candidate and M0 game_config must be byte-equivalent JSON values");
  assert(candidateSpec.players.length === m0Spec.players.length, "candidate and M0 roster lengths differ");
  for (let seat = 0; seat < candidateSpec.players.length; seat += 1) {
    if (seat === fixture.seat) {
      const candidate = candidateSpec.players[seat];
      const m0 = m0Spec.players[seat];
      assert(candidate.name === m0.name, "candidate and M0 tested names differ");
      assert(equalJson(candidate.env ?? {}, m0.env ?? {}), "candidate and M0 tested environments differ");
      const allowed = new Set(["name", "policy", "cwd", "run", "env"]);
      assert(Object.keys(candidate).every((key) => allowed.has(key)), "candidate tested player has an unknown field");
      assert(Object.keys(m0).every((key) => allowed.has(key)), "M0 tested player has an unknown field");
    } else {
      assert(equalJson(candidateSpec.players[seat], m0Spec.players[seat]), `non-tested roster seat ${seat} differs between candidate and M0`);
    }
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const bundleInfo = await lstat(args.bundleRoot).catch(() => null);
  assert(bundleInfo?.isDirectory() && !bundleInfo.isSymbolicLink(), "bundle root is missing or unsafe");
  const bundleRoot = await realpath(args.bundleRoot);
  assert(bundleRoot === args.bundleRoot, "bundle root must already be canonical");
  const contractInfo = await lstat(args.contractPath).catch(() => null);
  assert(contractInfo?.isFile() && !contractInfo.isSymbolicLink(), "pair contract is missing or unsafe");
  assert(!(await lstat(args.outputPath).catch(() => null)), "output must be a new path");

  const contract = JSON.parse(await readFile(args.contractPath, "utf8"));
  assert(contract.schema_version === 1, "pair contract schema is invalid");
  assert(contract.promotion_gates?.local_fanout_can_promote === false, "pair contract permits local promotion");
  assert(contract.promotion_gates?.upload_allowed === false, "pair contract permits upload");
  assert(contract.candidate?.upload_eligible === false && contract.m0?.upload_eligible === false, "pair contract contains upload-eligible policy");

  const manifestPath = path.join(bundleRoot, "manifest.json");
  const bundleManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(bundleManifest.schema_version === 1, "bundle manifest schema is invalid");
  assert(bundleManifest.contains_credentials === false, "bundle claims credentials");
  assert(bundleManifest.invokes_runpod_api === false, "bundle may invoke RunPod API");
  assert(bundleManifest.runtime?.architecture === "amd64", "bundle runtime is not amd64");
  assert(Array.isArray(bundleManifest.policies), "bundle manifest policies are missing");

  const fileManifestPath = path.join(bundleRoot, "files.sha256");
  const fileManifestBody = await readFile(fileManifestPath, "utf8");
  const fileManifest = parseFileManifest(fileManifestBody);
  if (bundleManifest.file_manifest?.sha256) {
    assert(
      bundleManifest.file_manifest.sha256 === await hashFile(fileManifestPath),
      "bundle file_manifest hash mismatch",
    );
  }

  const identities = [
    ["candidate", contract.candidate],
    ["m0", contract.m0],
  ];
  const verifiedFiles = [];
  for (const [label, identity] of identities) {
    const matches = bundleManifest.policies.filter((policy) => policy.policy_id === identity.policy_id);
    assert(matches.length === 1, `${label} policy_id must resolve exactly once in bundle manifest`);
    validateBundlePolicy(matches[0], identity, label);
    const entrypoint = `${identity.bundle_root}/${identity.run[1]}`;
    verifiedFiles.push(
      await verifyPinnedFile(bundleRoot, entrypoint, identity.entrypoint_sha256, fileManifest),
    );
    for (const shared of contract.shared_files) {
      verifiedFiles.push(
        await verifyPinnedFile(
          bundleRoot,
          `${identity.bundle_root}/${shared.path}`,
          shared.sha256,
          fileManifest,
        ),
      );
    }
  }

  const fixture = contract.fixture;
  const candidateSpecPath = fixture.candidate_spec.archive_path;
  const m0SpecPath = fixture.m0_spec.archive_path;
  verifiedFiles.push(
    await verifyPinnedFile(bundleRoot, candidateSpecPath, fixture.candidate_spec.sha256, fileManifest),
  );
  verifiedFiles.push(
    await verifyPinnedFile(bundleRoot, m0SpecPath, fixture.m0_spec.sha256, fileManifest),
  );
  if (Array.isArray(bundleManifest.experiment_specs)) {
    for (const [label, role, spec] of [
      ["candidate", "candidate", fixture.candidate_spec],
      ["m0", "exact-parent", fixture.m0_spec],
    ]) {
      const matches = bundleManifest.experiment_specs.filter(
        (entry) => entry.path === spec.archive_path && entry.sha256 === spec.sha256 && entry.role === role,
      );
      assert(matches.length === 1, `${label} spec is not exactly bound by bundle manifest experiment_specs`);
    }
  } else {
    throw new Error("bundle manifest experiment_specs are missing");
  }
  const candidateSpec = JSON.parse(await readFile(path.join(bundleRoot, candidateSpecPath), "utf8"));
  const m0Spec = JSON.parse(await readFile(path.join(bundleRoot, m0SpecPath), "utf8"));
  validateSpecShape(candidateSpec, contract.candidate, fixture, "candidate");
  validateSpecShape(m0Spec, contract.m0, fixture, "m0");
  validateMatchedSpecs(candidateSpec, m0Spec, fixture);

  const result = {
    schema_version: 1,
    status: "verified",
    manifest_sha256: contract.manifest_sha256,
    run_id: contract.run_id,
    arm_id: contract.arm_id,
    pair_id: fixture.pair_id,
    source_commit: contract.candidate.source_commit,
    candidate_image_id: contract.candidate.image_id,
    m0_image_id: contract.m0.image_id,
    candidate_spec_sha256: fixture.candidate_spec.sha256,
    m0_spec_sha256: fixture.m0_spec.sha256,
    map: fixture.map,
    seed: fixture.seed,
    seat: fixture.seat,
    order: fixture.order,
    order_draw_sha256: fixture.order_draw_sha256,
    verified_files: verifiedFiles,
    upload_eligible: false,
    local_fanout_can_promote: false,
  };
  await writeFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export {
  parseFileManifest,
  validateBundlePolicy,
  validateMatchedSpecs,
  validateSpecShape,
  verifyPinnedFile,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`MICKEY_FANOUT_BUNDLE_VERIFY_FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
