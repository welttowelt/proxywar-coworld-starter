#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  canonicalizePlayerName,
  resolveCoalitionIdentity,
} from "../controller-safety.mjs";

const contractPath = process.argv[2];
if (!contractPath || process.argv.length !== 3) {
  throw new Error("usage: audit-standard-rebuild.mjs <contract.json>");
}

const EXPECTED_SOURCE_CLOSURE = new Set([
  "llm-player.mjs",
  "standard-controller.mjs",
  "controller-safety.mjs",
  "package.json",
  "package-lock.json",
  "Dockerfile",
]);
const IMAGE_RUNTIME_FILES = new Set(
  [...EXPECTED_SOURCE_CLOSURE].filter((name) => name !== "Dockerfile"),
);
const EXPECTED_CELLS = new Set([
  "Pangaea/candidate",
  "Pangaea/control",
  "World/candidate",
  "World/control",
]);
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HARMFUL_KINDS = new Set([
  "attack", "land", "land_attack", "boat", "boat_attack", "nuke",
  "warship", "move_warship", "target", "target_player", "break_alliance",
  "alliance_reject", "reject_alliance", "embargo", "embargo_all",
]);
const SOCIAL_KINDS = new Set([
  "alliance_request", "alliance_extend", "break_alliance", "alliance_reject",
  "reject_alliance", "target", "target_player", "embargo", "embargo_all",
  "embargo_stop", "donate_gold", "donate_troops", "quick_chat", "emoji",
]);
const CONTROL_RUNTIME_MODE = "credential-free-v97-deterministic-fallback";
const BENCHMARK_RUNTIME_FILES = new Set([
  "llm-player.mjs",
  "standard-controller.mjs",
  "controller-safety.mjs",
]);
const DISPATCHER_PATH = "scripts/run-standard-rebuild-runpod-four.sh";
const DISPATCH_PODS = Object.freeze([
  { id: "lb4zz7jzgq9tr2", name: "storm-lazy-a", map: "Pangaea", role: "candidate" },
  { id: "2g5whxhph9bwbz", name: "storm-lazy-b", map: "Pangaea", role: "control" },
  { id: "877itccar33zdp", name: "storm-lazy-c", map: "World", role: "candidate" },
  { id: "76stn0v7q81d47", name: "storm-lazy-d", map: "World", role: "control" },
]);

const failures = [];
const fail = (message) => failures.push(message);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(repository, args, options = {}) {
  const spawnOptions = { maxBuffer: 16 * 1024 * 1024 };
  if (options.buffer !== true) spawnOptions.encoding = "utf8";
  return spawnSync("git", ["-C", repository, ...args], spawnOptions);
}

function safeGitPath(value) {
  if (typeof value !== "string" || value === "" || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return normalized === value && normalized !== ".." && !normalized.startsWith("../") &&
    !normalized.startsWith("-");
}

function verifySourceRepository(candidate) {
  const repository = candidate?.source_repo;
  const commit = candidate?.source_commit;
  if (typeof repository !== "string" || !path.isAbsolute(repository)) {
    fail("candidate source_repo must be an absolute Git repository path");
    return { repository: null, commit: null };
  }
  const root = git(repository, ["rev-parse", "--show-toplevel"]);
  let canonicalRepository = null;
  let canonicalRoot = null;
  try {
    canonicalRepository = realpathSync(repository);
    canonicalRoot = root.status === 0 ? realpathSync(root.stdout.trim()) : null;
  } catch {
    // The failure below is the fail-closed receipt.
  }
  if (root.status !== 0 || canonicalRoot !== canonicalRepository) {
    fail("candidate source_repo is not the specified Git worktree root");
    return { repository: null, commit: null };
  }
  const resolved = git(canonicalRoot, ["rev-parse", "--verify", `${commit}^{commit}`]);
  if (resolved.status !== 0 || resolved.stdout.trim() !== commit) {
    fail("candidate source_commit does not exist as the exact commit in source_repo");
    return { repository: canonicalRoot, commit: null };
  }
  return { repository: canonicalRoot, commit };
}

function gitBlob(source, relativePath, label) {
  if (!source?.repository || !source?.commit || !safeGitPath(relativePath)) {
    fail(`${label} Git path is invalid`);
    return null;
  }
  const read = git(
    source.repository,
    ["show", `${source.commit}:${relativePath}`],
    { buffer: true },
  );
  if (read.status !== 0 || !Buffer.isBuffer(read.stdout)) {
    fail(`${label} is absent from candidate source_commit`);
    return null;
  }
  return read.stdout;
}

async function readBytes(file, label) {
  try {
    return await readFile(file);
  } catch (error) {
    fail(`${label} unavailable: ${error?.code ?? error?.message ?? error}`);
    return null;
  }
}

async function readJson(file, label) {
  const bytes = await readBytes(file, label);
  if (!bytes) return { value: null, bytes: null, sha256: null };
  try {
    return { value: JSON.parse(bytes), bytes, sha256: sha256(bytes) };
  } catch {
    fail(`${label} is not valid JSON`);
    return { value: null, bytes, sha256: sha256(bytes) };
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function normalizeGameConfig(gameConfig, playerCount) {
  if (!gameConfig || typeof gameConfig !== "object" || Array.isArray(gameConfig)) {
    return null;
  }
  return {
    ...gameConfig,
    episode_timeout_seconds: gameConfig.episode_timeout_seconds ?? 3600,
    player_connect_timeout_seconds: gameConfig.player_connect_timeout_seconds ?? 120,
    num_agents: gameConfig.num_agents ?? playerCount,
  };
}

function normalizePlayerPlan(player, slot) {
  if (!player || typeof player !== "object" || Array.isArray(player)) return null;
  const env = player.env && typeof player.env === "object" && !Array.isArray(player.env)
    ? Object.fromEntries(Object.entries(player.env).sort(([left], [right]) =>
      left.localeCompare(right)))
    : null;
  return {
    slot,
    name: player.name,
    policy: player.policy,
    cwd: player.cwd,
    run: player.run,
    env,
  };
}

function normalizedPlan(document) {
  const players = Array.isArray(document?.players)
    ? document.players.map((player, slot) => normalizePlayerPlan(player, slot))
    : null;
  return {
    schema_version: 1,
    game_config: normalizeGameConfig(document?.game_config, players?.length),
    players,
  };
}

function pairComparablePlan(plan, subjectSeat) {
  const copy = structuredClone(plan);
  const subject = copy?.players?.[subjectSeat];
  if (!subject) return null;
  subject.policy = "subject-policy";
  subject.cwd = "subject-cwd";
  if (subject.env && typeof subject.env === "object") {
    delete subject.env.POLICY_CODENAME;
  }
  return copy;
}

function parseGitJson(source, relativePath, expectedSha256, label) {
  if (!safeGitPath(relativePath) || !SHA256.test(expectedSha256 ?? "")) {
    fail(`${label} Git binding is invalid`);
    return { value: null, sha256: null };
  }
  const bytes = gitBlob(source, relativePath, label);
  const actual = bytes ? sha256(bytes) : null;
  if (!actual || actual !== expectedSha256) {
    fail(`${label} SHA-256 mismatched candidate source commit`);
    return { value: null, sha256: actual };
  }
  try {
    return { value: JSON.parse(bytes), sha256: actual };
  } catch {
    fail(`${label} is not valid committed JSON`);
    return { value: null, sha256: actual };
  }
}

function verifyPreregistration(contract, source, candidate) {
  const binding = contract?.preregistration;
  const read = parseGitJson(
    source,
    binding?.path,
    binding?.sha256,
    "preregistration",
  );
  const document = read.value ?? {};
  if (document.schema_version !== 1 || document.profile !== "standard-rebuild") {
    fail("preregistration schema/profile mismatched");
  }
  if (
    document?.control?.label !== "qd1n:v97" ||
    document?.control?.source_commit !== candidate?.parent_source_commit ||
    document?.control?.image_id !== candidate?.parent_image_id ||
    document?.control?.policy_key !== "qd1n-v97"
  ) {
    fail("candidate parent is not the exact preregistered qd1n:v97 parent");
  }
  if (document?.candidate_policy_key !== "qd1n-std1") {
    fail("preregistration candidate policy key mismatched");
  }
  const cells = Array.isArray(document?.specs) ? document.specs : [];
  const keys = cells.map((cell) => `${cell?.map}/${cell?.arm}`);
  const specPaths = cells.map((cell) => cell?.path);
  if (
    cells.length !== 4 || new Set(keys).size !== 4 ||
    new Set(specPaths).size !== 4 ||
    [...EXPECTED_CELLS].some((cell) => !keys.includes(cell))
  ) {
    fail("preregistration must bind exactly the four evaluation cells");
  }
  const boundCells = new Map();
  for (const cell of cells) {
    const key = `${cell?.map}/${cell?.arm}`;
    const spec = parseGitJson(
      source,
      cell?.path,
      cell?.sha256,
      `${key} preregistered spec`,
    );
    const documentSpec = spec.value;
    const expectedPolicy = cell?.arm === "candidate"
      ? document?.candidate_policy_key
      : document?.control?.policy_key;
    if (
      !Number.isInteger(cell?.seat) ||
      documentSpec?.game_config?.map !== cell?.map ||
      documentSpec?.players?.[cell?.seat]?.policy !== expectedPolicy
    ) {
      fail(`${key} preregistered spec identity mismatched`);
    }
    if (Array.isArray(documentSpec?.players)) {
      for (let index = 0; index < documentSpec.players.length; index++) {
        if (index !== cell?.seat &&
            documentSpec.players[index]?.policy !== document?.control?.policy_key) {
          fail(`${key} non-subject slot ${index} is not the preregistered parent policy`);
        }
      }
    }
    boundCells.set(key, {
      ...cell,
      spec_path: cell?.path,
      document: documentSpec,
      normalized_plan: normalizedPlan(documentSpec),
      sha256: spec.sha256,
    });
  }
  return {
    path: binding?.path ?? null,
    sha256: read.sha256,
    document,
    cells: boundCells,
    bound: read.value !== null,
  };
}

async function findNamed(directory, filename) {
  const found = [];
  async function visit(current, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isFile() && entry.name === filename) found.push(target);
      else if (entry.isDirectory()) await visit(target, depth + 1);
    }
  }
  await visit(directory, 0);
  return found.sort();
}

function event(record, extra = {}) {
  return {
    sequence: record?.sequence ?? null,
    turn: record?.turnNumber ?? null,
    action_id: record?.selectedLegalActionId ?? null,
    kind: record?.selectedActionKind ?? null,
    reason: record?.reason ?? null,
    ...extra,
  };
}

function decisionKind(record) {
  return String(record?.selectedActionKind ?? "").trim().toLowerCase();
}

function isNuclearBuild(record) {
  if (decisionKind(record) !== "build") return false;
  const unit = canonicalizePlayerName(record?.selectedActionMetadata?.unit ?? "");
  const text = canonicalizePlayerName(
    `${record?.selectedLegalActionId ?? ""} ${record?.reason ?? ""}`,
  );
  return unit === "atom bomb" || unit === "nuke" ||
    text.includes("atom bomb") || text.split(" ").includes("nuke");
}

function isNeutralTerritory(record) {
  const kind = decisionKind(record);
  if (!["attack", "land", "land_attack", "boat", "boat_attack"].includes(kind)) {
    return false;
  }
  const id = String(record?.selectedLegalActionId ?? "").toLowerCase();
  return record?.selectedActionMetadata?.expansion === true || id.includes("terra-nullius");
}

function isHarmful(record) {
  return HARMFUL_KINDS.has(decisionKind(record)) || isNuclearBuild(record);
}

function replayPlayers(replay) {
  const snapshots = replay?.spectatorReplay?.snapshots;
  if (!Array.isArray(snapshots)) return [];
  const players = new Map();
  for (const snapshot of snapshots) {
    for (const player of snapshot?.players ?? []) {
      const id = String(player?.playerID ?? player?.id ?? "").trim();
      const name = String(player?.username ?? player?.name ?? "").trim();
      if (id || name) players.set(id || `name:${canonicalizePlayerName(name)}`, { id, name });
    }
  }
  return [...players.values()];
}

function resolveDecisionTarget(record, players) {
  const metadata = record?.selectedActionMetadata ?? {};
  const id = metadata.targetID ?? metadata.targetId ?? metadata.target_id ??
    metadata.recipientID ?? metadata.recipientId ?? metadata.recipient_id ?? "";
  const name = metadata.targetName ?? metadata.target_name ??
    metadata.recipientName ?? metadata.recipient_name ?? "";
  const direct = resolveCoalitionIdentity({ id, name }, players);
  if (direct.conflict || direct.resolved) return direct;

  const selectedID = String(record?.selectedLegalActionId ?? "").toLowerCase();
  const matches = players.filter((player) => {
    const playerTargetID = String(player.id ?? "").toLowerCase();
    return playerTargetID && selectedID.includes(playerTargetID);
  });
  if (matches.length !== 1) {
    return { resolved: false, conflict: matches.length > 1, member: null, key: null };
  }
  return resolveCoalitionIdentity(matches[0], players);
}

function parseDecisionLines(bytes, label) {
  if (!bytes) return [];
  const records = [];
  const lines = String(bytes).split(/\r?\n/).filter((line) => line.trim() !== "");
  for (let index = 0; index < lines.length; index++) {
    try {
      records.push(JSON.parse(lines[index]));
    } catch {
      fail(`${label} line ${index + 1} is not valid JSON`);
    }
  }
  if (records.length === 0) fail(`${label} contains no decisions`);
  return records;
}

function subjectRecords(records, subjectName, prefix) {
  const canonical = canonicalizePlayerName(subjectName);
  const selected = records.filter((record) =>
    canonicalizePlayerName(record?.username) === canonical
  );
  if (selected.length === 0) fail(`${prefix} has no subject decisions for ${subjectName}`);
  return selected;
}

function openingMetrics(records) {
  const opening = records.filter((record) => decisionKind(record) !== "spawn").slice(0, 20);
  const reverse = (record) =>
    decisionKind(record) === "alliance_request" &&
    String(record?.reason ?? "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim()
      .startsWith("std1 reverse handshake");
  const neutralLandAttacks = opening.filter((record) =>
    ["attack", "land", "land_attack"].includes(decisionKind(record)) &&
    isNeutralTerritory(record)
  );
  const neutralLandPercentViolations = neutralLandAttacks
    .filter((record) => Number(record?.selectedActionMetadata?.troopPercent) !== 35)
    .map((record) => event(record, {
      troop_percent: Number.isFinite(Number(record?.selectedActionMetadata?.troopPercent))
        ? Number(record.selectedActionMetadata.troopPercent)
        : null,
    }));
  return {
    active_decisions: opening.length,
    conquest_actions: opening.filter((record) =>
      ["attack", "land", "land_attack"].includes(decisionKind(record)) ||
      (["boat", "boat_attack"].includes(decisionKind(record)) && isNeutralTerritory(record))
    ).length,
    proactive_social_actions: opening.filter((record) =>
      SOCIAL_KINDS.has(decisionKind(record)) && !reverse(record)
    ).length,
    reverse_handshakes: opening.filter(reverse).length,
    build_actions: opening.filter((record) => decisionKind(record) === "build").length,
    upgrade_actions: opening.filter((record) =>
      decisionKind(record) === "upgrade_structure"
    ).length,
    boat_actions: opening.filter((record) =>
      ["boat", "boat_attack"].includes(decisionKind(record))
    ).length,
    forced_neutral_boat_actions: opening.filter((record) =>
      ["boat", "boat_attack"].includes(decisionKind(record)) &&
      isNeutralTerritory(record) &&
      Array.isArray(record?.legalActionIDs) &&
      !record.legalActionIDs.some((id) => String(id).startsWith("expand:terra-nullius:"))
    ).length,
    neutral_land_attacks: neutralLandAttacks.length,
    neutral_land_attack_percent_violations: neutralLandPercentViolations,
  };
}

async function auditArtifacts(contract, source) {
  const artifacts = Array.isArray(contract?.artifacts) ? contract.artifacts : [];
  const names = new Set(artifacts.map((artifact) => artifact?.path));
  if (
    artifacts.length !== EXPECTED_SOURCE_CLOSURE.size ||
    names.size !== EXPECTED_SOURCE_CLOSURE.size ||
    [...EXPECTED_SOURCE_CLOSURE].some((name) => !names.has(name))
  ) {
    fail("contract must bind exactly the six-file committed runtime closure");
  }
  const output = [];
  const imageID = contract?.candidate?.image_id;
  const revision = contract?.candidate?.source_commit;
  const inspected = spawnSync(
    "docker",
    [
      "image", "inspect", imageID, "--format",
      '{{.Id}}|{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ],
    { encoding: "utf8" },
  );
  if (inspected.status !== 0 || inspected.stdout.trim() !== `${imageID}|amd64|${revision}`) {
    fail("candidate Docker image ID/architecture/revision label could not be verified");
    return output;
  }
  const created = spawnSync(
    "docker",
    ["create", "--entrypoint", "/bin/true", imageID],
    { encoding: "utf8" },
  );
  const containerID = created.status === 0 ? created.stdout.trim() : "";
  if (!containerID) {
    fail("candidate Docker image could not be mounted for artifact verification");
    return output;
  }
  const extractedRoot = await mkdtemp(path.join(tmpdir(), "std1-image-artifacts-"));
  try {
  for (const name of EXPECTED_SOURCE_CLOSURE) {
    const binding = artifacts.find((artifact) => artifact?.path === name);
    if (!binding) continue;
    const committed = gitBlob(source, name, name);
    const sourceHash = committed ? sha256(committed) : null;
    if (!IMAGE_RUNTIME_FILES.has(name)) {
      output.push({
        path: name,
        source_sha256: sourceHash,
        image_sha256: null,
        binding: "git-blob+image-revision-label",
      });
      continue;
    }
    const imagePath = path.join(extractedRoot, name);
    const copied = spawnSync(
      "docker",
      ["cp", `${containerID}:/app/${name}`, imagePath],
      { encoding: "utf8" },
    );
    if (copied.status !== 0) fail(`${name} could not be extracted from candidate image`);
    const image = copied.status === 0
      ? await readBytes(imagePath, `${name} candidate image`)
      : null;
    const imageHash = image ? sha256(image) : null;
    if (!sourceHash || sourceHash !== imageHash) fail(`${name} is not byte-identical in the image`);
    output.push({
      path: name,
      source_sha256: sourceHash,
      image_sha256: imageHash,
      binding: "git-blob+docker-image-id",
    });
  }
  } finally {
    const removed = spawnSync("docker", ["rm", "-f", containerID], { encoding: "utf8" });
    if (removed.status !== 0) fail("candidate artifact-verification container cleanup failed");
    await rm(extractedRoot, { recursive: true, force: true });
  }
  return output;
}

function policyTable(receipt, location) {
  const table = location === "post"
    ? receipt?.post_run_attestation?.bundle_verification?.policies
    : receipt?.bundle_verification?.policies;
  return Array.isArray(table) ? table : [];
}

function policyImageID(receipt, key, location = "pre") {
  const matches = policyTable(receipt, location).filter((entry) => entry?.key === key);
  return matches.length === 1 ? matches[0]?.image_id : null;
}

function verifyProducerReceipt(receipt, label, expectedProducerPath, candidate, source) {
  let bound = true;
  const receiptImageID = receipt?.candidate_image_id ?? receipt?.image_id;
  const receiptSourceCommit = receipt?.candidate_source_commit ?? receipt?.source_commit;
  if (receiptImageID !== candidate?.image_id) {
    fail(`${label} candidate image ID mismatched`);
    bound = false;
  }
  if (receiptSourceCommit !== candidate?.source_commit) {
    fail(`${label} candidate source commit mismatched`);
    bound = false;
  }
  const producerPath = receipt?.producer?.script_path ?? receipt?.producer?.path;
  const declaredHash = receipt?.producer?.script_sha256 ?? receipt?.producer?.sha256;
  if (!safeGitPath(producerPath) || !SHA256.test(declaredHash ?? "")) {
    fail(`${label} producer script binding is invalid`);
    return { bound: false, script_path: producerPath ?? null, script_sha256: null };
  }
  if (producerPath !== expectedProducerPath) {
    fail(`${label} producer script path mismatched`);
    bound = false;
  }
  const committed = gitBlob(source, producerPath, `${label} producer script`);
  const committedHash = committed ? sha256(committed) : null;
  if (!committedHash || committedHash !== declaredHash) {
    fail(`${label} producer script hash mismatched candidate source commit`);
    bound = false;
  }
  return {
    bound,
    script_path: producerPath,
    script_sha256: committedHash,
  };
}

function verifyBenchmarkRuntime(receipt, candidate, source) {
  let bound = true;
  if (receipt?.executed_runtime?.image_id !== candidate?.image_id) {
    fail("benchmark executed runtime image ID mismatched");
    bound = false;
  }
  const files = receipt?.executed_runtime?.files;
  if (!files || typeof files !== "object" || Array.isArray(files) ||
      Object.keys(files).length !== BENCHMARK_RUNTIME_FILES.size) {
    fail("benchmark executed runtime file closure is invalid");
    return { bound: false, files: {} };
  }
  const verified = {};
  for (const name of BENCHMARK_RUNTIME_FILES) {
    const committed = gitBlob(source, name, `benchmark executed runtime ${name}`);
    const committedHash = committed ? sha256(committed) : null;
    const declared = files?.[name];
    if (!committedHash || declared !== committedHash) {
      fail(`benchmark executed runtime ${name} mismatched candidate source commit`);
      bound = false;
    }
    verified[name] = committedHash;
  }
  return { bound, files: verified };
}

async function verifyBoundReceiptArtifacts(receipt, label, expectedNames = null) {
  const runDirectory = receipt?.run_dir;
  const artifactObject = receipt?.artifacts && typeof receipt.artifacts === "object" &&
    !Array.isArray(receipt.artifacts) ? receipt.artifacts : null;
  const artifacts = Array.isArray(receipt?.artifacts)
    ? receipt.artifacts
    : (artifactObject
      ? Object.values(artifactObject)
      : []);
  if (typeof runDirectory !== "string" || !path.isAbsolute(runDirectory)) {
    fail(`${label} run_dir must be absolute`);
    return false;
  }
  if (artifacts.length === 0 ||
      artifacts.filter((artifact) => artifact?.path?.endsWith("decisions.jsonl")).length !== 1) {
    fail(`${label} must bind exactly one decisions.jsonl plus its run artifacts`);
    return false;
  }
  if (expectedNames) {
    const actualNames = artifactObject ? Object.keys(artifactObject).sort() : [];
    if (stable(actualNames) !== stable([...expectedNames].sort())) {
      fail(`${label} must bind exactly ${[...expectedNames].sort().join(", ")}`);
      return false;
    }
  }
  const root = path.resolve(runDirectory);
  let bound = true;
  const names = new Set();
  for (const artifact of artifacts) {
    const relative = artifact?.path;
    if (
      !safeGitPath(relative) || names.has(relative) ||
      !SHA256.test(artifact?.sha256 ?? "") ||
      !(Number.isInteger(artifact?.bytes) && artifact.bytes >= 0)
    ) {
      fail(`${label} contains an invalid artifact binding`);
      bound = false;
      continue;
    }
    names.add(relative);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      fail(`${label} artifact escaped run_dir`);
      bound = false;
      continue;
    }
    const bytes = await readBytes(target, `${label} artifact ${relative}`);
    if (!bytes || sha256(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) {
      fail(`${label} artifact ${relative} bytes/hash mismatched`);
      bound = false;
    }
  }
  return bound;
}

async function verifyQualifierRunnerReceipt(summary, candidate, preregistration) {
  const before = failures.length;
  const policyKey = preregistration?.document?.candidate_policy_key;
  const artifact = summary?.artifacts?.["runner-receipt.json"];
  const runnerPath = path.resolve(String(summary?.run_dir ?? ""), String(artifact?.path ?? ""));
  const runnerRead = await readJson(runnerPath, "qualifier bound runner receipt");
  const runner = runnerRead.value ?? {};
  const runSpec = runner?.run_spec;
  const postRunSpec = runner?.post_run_attestation?.run_spec;
  const transportDeclarations = runner?.bundle_verification?.transport_canaries;
  const plannedSubjects = Array.isArray(runner?.plan?.players)
    ? runner.plan.players.filter((player) => player?.policy === policyKey)
    : [];
  if (
    runnerRead.sha256 !== artifact?.sha256 ||
    runnerRead.bytes?.length !== artifact?.bytes ||
    summary?.policy_key !== policyKey ||
    runner?.schema_version !== 1 ||
    runner?.receipt_scope !== "transport_and_artifact_integrity_only" ||
    runner?.evaluation_verdict !== "not_evaluated" ||
    runner?.status !== "passed" || runner?.execution_class !== "transport_canary" ||
    runSpec?.manifest_label !== "transport-canary-candidate" ||
    runSpec?.manifest_role !== "candidate" ||
    runSpec?.execution_class !== "transport_canary" ||
    runSpec?.location !== "bundle" ||
    !safeGitPath(runSpec?.relative_path) ||
    !SHA256.test(runSpec?.sha256 ?? "") ||
    stable(runSpec) !== stable(postRunSpec) ||
    runner?.runtime_fingerprint?.status !== "verified" ||
    runner?.bundle_verification?.status !== "verified" ||
    runner?.post_run_attestation?.status !== "stable" ||
    runner?.post_run_attestation?.runtime_fingerprint?.status !== "verified" ||
    runner?.post_run_attestation?.bundle_verification?.status !== "verified" ||
    stable(policyTable(runner, "pre")) !== stable(policyTable(runner, "post")) ||
    policyImageID(runner, policyKey, "pre") !== candidate?.image_id ||
    policyImageID(runner, policyKey, "post") !== candidate?.image_id ||
    !Array.isArray(transportDeclarations) ||
    transportDeclarations.filter((entry) =>
      entry?.label === "transport-canary-candidate" &&
      entry?.role === "candidate" &&
      entry?.path === runSpec?.relative_path && entry?.sha256 === runSpec?.sha256
    ).length !== 1 ||
    plannedSubjects.length !== 1 ||
    String(plannedSubjects[0]?.name ?? "").trim().toLowerCase() !==
      String(summary?.subject_name ?? "").trim().toLowerCase()
  ) fail("qualifier bound runner receipt attestation is invalid");

  const runnerArtifacts = Array.isArray(runner?.artifacts) ? runner.artifacts : [];
  for (const name of ["results.json", "replay", "decisions.jsonl"]) {
    const expected = summary?.artifacts?.[name];
    const relative = String(expected?.path ?? "").split(path.sep).join("/");
    const matches = runnerArtifacts.filter((entry) => entry?.path === relative);
    if (
      matches.length !== 1 || matches[0]?.sha256 !== expected?.sha256 ||
      matches[0]?.bytes !== expected?.bytes
    ) fail(`qualifier runner receipt ${name} artifact binding is invalid`);
  }
  for (const name of ["results.json", "replay"]) {
    const expected = summary?.artifacts?.[name];
    const primary = runner?.primary_artifact_hashes?.[name];
    if (primary?.sha256 !== expected?.sha256 || primary?.bytes !== expected?.bytes) {
      fail(`qualifier runner receipt ${name} primary binding is invalid`);
    }
  }
  return failures.length === before;
}

async function verifyDispatcher(runSpecs, source) {
  const before = failures.length;
  const ordered = DISPATCH_PODS.map((pod) => runSpecs.find((spec) =>
    spec?.map === pod.map && spec?.arm === pod.role
  ));
  const directories = ordered.map((spec, index) => {
    try {
      return realpathSync(spec?.directory ?? "");
    } catch {
      fail(`${DISPATCH_PODS[index].map}/${DISPATCH_PODS[index].role} dispatcher output is unavailable`);
      return path.resolve(String(spec?.directory ?? ""));
    }
  });
  const reads = await Promise.all(directories.map((directory, index) =>
    readJson(
      path.join(directory, "dispatcher-receipt.json"),
      `${DISPATCH_PODS[index].map}/${DISPATCH_PODS[index].role} dispatcher receipt`,
    )
  ));
  const hashes = reads.map((read) => read.sha256);
  if (new Set(hashes).size !== 1 || !SHA256.test(hashes[0] ?? "")) {
    fail("the four dispatcher receipts are not byte-identical");
  }
  const receipt = reads[0]?.value ?? {};
  if (
    receipt.schema_version !== "proxywar-standard-rebuild-dispatch-v1" ||
    receipt.status !== "passed" ||
    typeof receipt.run_id !== "string" || !/^std1(?:[._:-][A-Za-z0-9._:-]+)?$/.test(receipt.run_id) ||
    typeof receipt.execution_id !== "string" || receipt.execution_id.length === 0
  ) fail("dispatcher receipt schema/status/identity is invalid");
  const dispatcherBlob = gitBlob(source, DISPATCHER_PATH, "dispatcher script");
  const dispatcherSha = dispatcherBlob ? sha256(dispatcherBlob) : null;
  if (
    receipt?.dispatcher?.path !== DISPATCHER_PATH ||
    receipt?.dispatcher?.sha256 !== dispatcherSha
  ) fail("dispatcher script is not bound to candidate source commit");
  if (
    receipt?.lease?.owner !== "odin" ||
    receipt?.lease?.run_id !== receipt.run_id ||
    !SHA256.test(receipt?.lease?.verified_status_sha256 ?? "") ||
    stable(receipt?.lease?.outputs) !== stable(directories)
  ) fail("dispatcher runner lease/output binding is invalid");
  const expectedLocations = directories.map((directory) =>
    path.join(directory, "dispatcher-receipt.json")
  );
  if (stable(receipt?.receipt_locations) !== stable(expectedLocations)) {
    fail("dispatcher receipt locations are invalid");
  }
  const pods = Array.isArray(receipt?.pods) ? receipt.pods : [];
  if (pods.length !== DISPATCH_PODS.length) {
    fail("dispatcher receipt must bind exactly four pods");
  }
  for (let index = 0; index < DISPATCH_PODS.length; index++) {
    const expected = DISPATCH_PODS[index];
    const pod = pods[index] ?? {};
    const formal = await readBytes(
      path.join(directories[index], "receipt.json"),
      `${expected.map}/${expected.role} formal runner receipt`,
    );
    const formalSha = formal ? sha256(formal) : null;
    let qualifierSha = null;
    if (expected.role === "candidate") {
      const qualifier = await readBytes(
        path.join(directories[index], "qualifier", "receipt.json"),
        `${expected.map}/candidate qualifier runner receipt`,
      );
      qualifierSha = qualifier ? sha256(qualifier) : null;
    }
    if (
      pod.index !== index || pod.id !== expected.id || pod.name !== expected.name ||
      pod.map !== expected.map || pod.role !== expected.role ||
      pod.pre_start_status !== "EXITED" || pod.post_stop_status !== "EXITED" ||
      pod.formal_output !== directories[index] ||
      !SHA256.test(pod.bundle_sha256 ?? "") ||
      !SHA256.test(pod.extractor_sha256 ?? "") ||
      pod.formal_receipt_sha256 !== formalSha ||
      (expected.role === "candidate"
        ? pod.qualifier_receipt_sha256 !== qualifierSha
        : pod.qualifier_receipt_sha256 !== null)
    ) fail(`${expected.map}/${expected.role} dispatcher pod evidence is invalid`);
  }
  return {
    verified: failures.length === before,
    sha256: hashes[0] ?? null,
    run_id: receipt.run_id ?? null,
    execution_id: receipt.execution_id ?? null,
    dispatcher_script_sha256: dispatcherSha,
    pods: pods.map((pod) => ({
      index: pod?.index ?? null,
      id: pod?.id ?? null,
      name: pod?.name ?? null,
      map: pod?.map ?? null,
      role: pod?.role ?? null,
      pre_start_status: pod?.pre_start_status ?? null,
      post_stop_status: pod?.post_stop_status ?? null,
      formal_receipt_sha256: pod?.formal_receipt_sha256 ?? null,
      qualifier_receipt_sha256: pod?.qualifier_receipt_sha256 ?? null,
    })),
  };
}

function validateDecisionTelemetry(records, replay, prefix) {
  const illegal_decisions = [];
  const rejected_decisions = [];
  const unexplained_holds = [];
  const fallback_decisions = [];
  const degraded_decisions = [];
  const normal_phase_k1z_harm = [];
  const unresolved_harmful_targets = [];
  let accepted = 0;
  let allOffered = true;
  const players = replayPlayers(replay);

  for (const record of records) {
    const selectedID = record?.selectedLegalActionId;
    const kind = record?.selectedActionKind;
    const legalIDs = record?.legalActionIDs;
    if (typeof selectedID !== "string" || typeof kind !== "string") {
      fail(`${prefix} decision ${record?.sequence ?? "unknown"} lacks selected action telemetry`);
    }
    if (!Array.isArray(legalIDs)) {
      fail(`${prefix} decision ${record?.sequence ?? "unknown"} lacks offered-ID telemetry`);
      allOffered = false;
    } else if (!legalIDs.includes(selectedID)) {
      allOffered = false;
      illegal_decisions.push(event(record));
    }
    if (record?.result?.accepted === true) accepted++;
    else rejected_decisions.push(event(record, { result_reason: record?.result?.reason ?? null }));
    if (typeof record?.fallbackUsed !== "boolean") {
      fail(`${prefix} decision ${record?.sequence ?? "unknown"} lacks fallback telemetry`);
    }
    if (record?.fallbackUsed === true) fallback_decisions.push(event(record));
    if (
      record?.fallbackUsed === true || record?.llmPlannerDegraded === true ||
      record?.plannerDegraded === true || record?.degraded === true
    ) degraded_decisions.push(event(record));
    if (decisionKind(record) === "hold") unexplained_holds.push(event(record));

    const harmful = isHarmful(record);
    const target = harmful ? resolveDecisionTarget(record, players) : null;
    const neutral = harmful && isNeutralTerritory(record) && !target?.resolved;
    if (harmful && !neutral && (target?.conflict || !target?.resolved)) {
      unresolved_harmful_targets.push(event(record, {
        conflict: target?.conflict === true,
      }));
    }
    if (harmful && target?.resolved && target.member) {
      normal_phase_k1z_harm.push(event(record, { target: target.member.key }));
    }
  }
  return {
    accepted,
    allOffered,
    illegal_decisions,
    rejected_decisions,
    unexplained_holds,
    fallback_decisions,
    degraded_decisions,
    normal_phase_k1z_harm,
    unresolved_harmful_targets,
  };
}

async function auditRun(spec, contract, preregistration) {
  const prefix = `${spec?.map ?? "unknown"}/${spec?.arm ?? "unknown"}`;
  const preregistered = preregistration?.cells?.get(prefix);
  if (!preregistered) fail(`${prefix} is absent from committed preregistration`);
  if (
    spec?.seat !== preregistered?.seat ||
    spec?.policy_key !== (spec?.arm === "candidate"
      ? preregistration?.document?.candidate_policy_key
      : preregistration?.document?.control?.policy_key)
  ) {
    fail(`${prefix} contract identity differs from committed preregistration`);
  }
  if (typeof spec?.directory !== "string" || !path.isAbsolute(spec.directory)) {
    fail(`${prefix} result directory must be absolute`);
  }
  const directory = path.resolve(String(spec?.directory ?? ""));
  const resultsFile = path.join(directory, "results.json");
  const replayFile = path.join(directory, "replay");
  const receiptFile = path.join(directory, "receipt.json");
  const decisionsFiles = (await findNamed(directory, "decisions.jsonl")).filter((filename) => {
    const relative = path.relative(directory, filename).split(path.sep);
    return relative[0] !== "qualifier";
  });
  if (decisionsFiles.length !== 1) {
    fail(`${prefix} must contain exactly one decisions.jsonl, found ${decisionsFiles.length}`);
  }
  const decisionsFile = decisionsFiles[0] ?? path.join(directory, "decisions.jsonl");
  const [resultsRead, replayRead, receiptRead, decisionBytes] = await Promise.all([
    readJson(resultsFile, `${prefix} results.json`),
    readJson(replayFile, `${prefix} replay`),
    readJson(receiptFile, `${prefix} runner receipt`),
    readBytes(decisionsFile, `${prefix} decisions.jsonl`),
  ]);
  const results = resultsRead.value ?? {};
  const replay = replayRead.value ?? {};
  const receipt = receiptRead.value ?? {};
  const config = replay?.config ?? {};
  const records = parseDecisionLines(decisionBytes, `${prefix} decisions.jsonl`);

  const expectedRole = spec.arm === "candidate" ? "candidate" : "exact-parent";
  if (
    receipt.schema_version !== 1 || receipt.status !== "passed" ||
    receipt.receipt_scope !== "transport_and_artifact_integrity_only" ||
    receipt.evaluation_verdict !== "not_evaluated" ||
    receipt?.runtime_fingerprint?.status !== "verified" ||
    receipt?.bundle_verification?.status !== "verified" ||
    receipt?.post_run_attestation?.status !== "stable" ||
    receipt?.post_run_attestation?.runtime_fingerprint?.status !== "verified" ||
    receipt?.post_run_attestation?.bundle_verification?.status !== "verified" ||
    receipt?.run_spec?.manifest_role !== expectedRole ||
    receipt?.run_spec?.sha256 !== preregistered?.sha256 ||
    stable(receipt?.post_run_attestation?.run_spec) !== stable(receipt?.run_spec)
  ) fail(`${prefix} runner attestation failed`);
  if (
    receipt?.primary_artifact_hashes?.["results.json"]?.sha256 !== resultsRead.sha256 ||
    receipt?.primary_artifact_hashes?.replay?.sha256 !== replayRead.sha256
  ) fail(`${prefix} runner primary artifact hashes mismatched`);
  const decisionArtifactPath = path.relative(directory, decisionsFile)
    .split(path.sep).join("/");
  const decisionArtifacts = Array.isArray(receipt?.artifacts)
    ? receipt.artifacts.filter((artifact) => artifact?.path === decisionArtifactPath)
    : [];
  const decisionHash = decisionBytes ? sha256(decisionBytes) : null;
  const decisionArtifact = decisionArtifacts.length === 1 ? decisionArtifacts[0] : null;
  const decisionsReceiptBound = decisionArtifact !== null &&
    decisionArtifact?.sha256 === decisionHash &&
    Number.isInteger(decisionArtifact?.bytes) &&
    decisionArtifact.bytes === decisionBytes?.length;
  if (decisionArtifacts.length !== 1) {
    fail(`${prefix} runner receipt must contain exactly one decisions.jsonl artifact entry`);
  } else if (!decisionsReceiptBound) {
    fail(`${prefix} decisions.jsonl bytes/hash mismatched runner artifact receipt`);
  }
  if (stable(policyTable(receipt, "pre")) !== stable(policyTable(receipt, "post"))) {
    fail(`${prefix} policy table changed during the run`);
  }

  if (config.map !== spec.map) fail(`${prefix} config map mismatched`);
  if (Number(config.seed) !== Number(spec.seed) || Number(results.seed) !== Number(spec.seed)) {
    fail(`${prefix} seed mismatched`);
  }
  if (!Array.isArray(config.players) || config.players.length < 2) {
    fail(`${prefix} roster telemetry is missing`);
  }
  if (!Array.isArray(results.players)) fail(`${prefix} result players are missing`);
  if (!Array.isArray(replay?.spectatorReplay?.snapshots) ||
      replay.spectatorReplay.snapshots.length === 0) {
    fail(`${prefix} replay snapshots are missing`);
  }
  const replayRoster = replay?.config?.players;
  if (!Array.isArray(replayRoster) || replayRoster.length !== config.players?.length) {
    fail(`${prefix} replay roster mismatched`);
  }

  const seat = Number(spec.seat);
  const subject = Array.isArray(results.players)
    ? results.players.find((player) => Number(player?.slot) === seat)
    : null;
  if (!Number.isInteger(seat) || !subject) fail(`${prefix} subject seat is missing`);
  const subjectName = subject?.name ?? config.players?.[seat]?.name ?? "";
  if (!subjectName) fail(`${prefix} subject identity is missing`);
  const expectedPlan = preregistered?.normalized_plan;
  if (receipt?.plan?.schema_version !== 1) {
    fail(`${prefix} runner plan schema mismatched`);
  }
  for (let index = 0; index < (receipt?.plan?.players?.length ?? 0); index++) {
    if (receipt.plan.players[index]?.slot !== index) {
      fail(`${prefix} runner plan slot mismatched at slot ${index}`);
    }
  }
  const actualPlan = normalizedPlan({
    game_config: receipt?.plan?.game_config,
    players: receipt?.plan?.players,
  });
  if (stable(actualPlan) !== stable(expectedPlan)) {
    fail(`${prefix} complete runner plan differs from committed spec`);
  }
  const plannedPlayers = actualPlan?.players;
  if (!Array.isArray(plannedPlayers) || plannedPlayers.length !== config.players?.length) {
    fail(`${prefix} runner player plan is missing or roster-sized incorrectly`);
  }
  for (let index = 0; index < (plannedPlayers?.length ?? 0); index++) {
    if (canonicalizePlayerName(plannedPlayers[index]?.name) !==
        canonicalizePlayerName(config.players[index]?.name)) {
      fail(`${prefix} runner/replay roster name mismatched at slot ${index}`);
    }
  }
  const subjectPolicyKey = plannedPlayers?.[seat]?.policy;
  if (subjectPolicyKey !== spec.policy_key) fail(`${prefix} subject policy key mismatched`);
  const expectedImageID = spec.arm === "candidate"
    ? contract?.candidate?.image_id
    : contract?.candidate?.parent_image_id;
  if (
    policyImageID(receipt, subjectPolicyKey, "pre") !== expectedImageID ||
    policyImageID(receipt, subjectPolicyKey, "post") !== expectedImageID
  ) fail(`${prefix} subject image ID was not proved by the runner receipt`);
  const decisions = subjectRecords(records, subjectName, prefix);
  const telemetry = validateDecisionTelemetry(decisions, replay, prefix);
  const score = Number(subject?.score);
  const finalTiles = Number(subject?.tiles_owned);
  if (subject?.score === null || subject?.score === undefined || !Number.isFinite(score)) {
    fail(`${prefix} subject score is missing`);
  }
  if (subject?.tiles_owned === null || subject?.tiles_owned === undefined ||
      !Number.isFinite(finalTiles)) {
    fail(`${prefix} subject final tiles are missing`);
  }
  const scores = Array.isArray(results.scores)
    ? results.scores.map(Number).filter(Number.isFinite)
    : (results.players ?? []).map((player) => Number(player?.score)).filter(Number.isFinite);
  if (scores.length === 0) fail(`${prefix} score vector is missing`);
  const won = Number.isInteger(results.winner_slot) && results.winner_slot === seat;
  const roster = (plannedPlayers ?? []).map((player, index) => {
    const imageID = policyImageID(receipt, player?.policy, "pre");
    if (!IMAGE_ID.test(imageID ?? "")) fail(`${prefix} roster slot ${index} image ID is unproved`);
    return {
      slot: index,
      name: String(player?.name ?? ""),
      image_id: index === seat ? "subject-under-test" : imageID,
    };
  });
  const rosterHash = sha256(Buffer.from(stable(roster)));
  const matchedPlan = pairComparablePlan(actualPlan, seat);
  const matchedPlanHash = matchedPlan
    ? sha256(Buffer.from(stable(matchedPlan)))
    : null;
  const runID = String(receipt?.run_id ?? replay?.runID ?? records[0]?.runID ?? "");
  const gameID = String(results?.game_id ?? replay?.gameID ?? records[0]?.matchID ?? "");
  if (!runID || !gameID) fail(`${prefix} run/game identity is missing`);
  if (results?.game_id && replay?.gameID && results.game_id !== replay.gameID) {
    fail(`${prefix} game ID mismatched between results and replay`);
  }
  for (const record of decisions) {
    if (record?.runID && replay?.runID && record.runID !== replay.runID) {
      fail(`${prefix} decision run ID mismatched replay`);
      break;
    }
    if (record?.matchID && gameID && record.matchID !== gameID) {
      fail(`${prefix} decision game ID mismatched results/replay`);
      break;
    }
  }

  const output = {
    run_id: runID,
    game_id: gameID,
    pair_id: String(spec?.pair_id ?? spec.map).toLowerCase(),
    map: spec.map,
    arm: spec.arm,
    seed: Number(spec.seed),
    seat,
    subject_name: subjectName,
    roster_sha256: rosterHash,
    matched_plan_sha256: matchedPlanHash,
    preregistration_sha256: preregistration?.sha256 ?? null,
    spec_path: preregistered?.spec_path ?? null,
    spec_sha256: preregistered?.sha256 ?? null,
    run_spec_sha256: receipt?.run_spec?.sha256 ?? null,
    replay_sha256: replayRead.sha256,
    decisions_sha256: decisionHash,
    decisions_bytes: decisionBytes?.length ?? null,
    decisions_receipt_bound: decisionsReceiptBound,
    results_sha256: resultsRead.sha256,
    config_sha256: sha256(Buffer.from(stable(config))),
    runner_receipt_sha256: receiptRead.sha256,
    policy_key: subjectPolicyKey,
    image_id: expectedImageID,
    decision_count: decisions.length,
    accepted_decisions: telemetry.accepted,
    all_selected_ids_offered: telemetry.allOffered,
    illegal_decisions: telemetry.illegal_decisions,
    rejected_decisions: telemetry.rejected_decisions,
    unexplained_holds: telemetry.unexplained_holds,
    fallback_decisions: telemetry.fallback_decisions,
    degraded_decisions: telemetry.degraded_decisions,
    normal_phase_k1z_harm: telemetry.normal_phase_k1z_harm,
    unresolved_harmful_targets: telemetry.unresolved_harmful_targets,
    score,
    final_tiles: finalTiles,
    won,
  };
  if (spec.arm === "candidate") output.opening = openingMetrics(decisions);
  return output;
}

function checkRun(run) {
  const prefix = `${run.map}/${run.arm}`;
  if (!SHA256.test(run.replay_sha256 ?? "")) fail(`${prefix} replay hash is invalid`);
  if (
    !SHA256.test(run.decisions_sha256 ?? "") ||
    !(Number.isInteger(run.decisions_bytes) && run.decisions_bytes > 0) ||
    run.decisions_receipt_bound !== true
  ) fail(`${prefix} decisions artifact proof failed`);
  if (!(run.decision_count > 0)) fail(`${prefix} has no decisions`);
  if (
    !SHA256.test(run.preregistration_sha256 ?? "") ||
    !safeGitPath(run.spec_path) ||
    !SHA256.test(run.spec_sha256 ?? "") ||
    run.run_spec_sha256 !== run.spec_sha256 ||
    !SHA256.test(run.matched_plan_sha256 ?? "")
  ) fail(`${prefix} committed spec/run-plan binding failed`);
  if (run.accepted_decisions !== run.decision_count) fail(`${prefix} has rejected decisions`);
  for (const field of [
    "illegal_decisions", "rejected_decisions", "unexplained_holds",
    "normal_phase_k1z_harm", "unresolved_harmful_targets",
  ]) {
    if (!Array.isArray(run[field]) || run[field].length > 0) fail(`${prefix} ${field} failed`);
  }
  if (run.arm === "candidate") {
    for (const field of ["fallback_decisions", "degraded_decisions"]) {
      if (!Array.isArray(run[field]) || run[field].length > 0) {
        fail(`${prefix} ${field} failed`);
      }
    }
  } else {
    const expected = (run.fallback_decisions?.length === run.decision_count) &&
      (run.degraded_decisions?.length === run.decision_count) &&
      run.fallback_decisions.every((entry) => /^(?:rul|dgd):/.test(entry.reason ?? ""));
    if (!expected) fail(`${prefix} control degradation was not the expected deterministic v97 mode`);
  }
  if (run.all_selected_ids_offered !== true) fail(`${prefix} offered-ID proof failed`);
  if (run.arm === "candidate") {
    const opening = run.opening ?? {};
    if (!(opening.active_decisions >= 20 && opening.conquest_actions >= 17)) {
      fail(`${prefix} opening conquest floor failed`);
    }
    if (
      opening.proactive_social_actions !== 0 || opening.reverse_handshakes > 1 ||
      opening.build_actions > 1 || opening.upgrade_actions !== 0 ||
      opening.boat_actions !== opening.forced_neutral_boat_actions ||
      !(opening.neutral_land_attacks > 0) ||
      !Array.isArray(opening.neutral_land_attack_percent_violations) ||
      opening.neutral_land_attack_percent_violations.length !== 0
    ) fail(`${prefix} opening discipline failed`);
  }
}

function checkOutcomeGate(runs) {
  if (new Set(runs.map((run) => run.replay_sha256)).size !== 4) {
    fail("the four replay hashes are not distinct");
  }
  for (const map of ["Pangaea", "World"]) {
    const candidate = runs.find((run) => run.map === map && run.arm === "candidate");
    const control = runs.find((run) => run.map === map && run.arm === "control");
    if (!candidate || !control) continue;
    if (!(candidate.score > control.score)) fail(`${map} candidate score did not beat control`);
    if (!(candidate.final_tiles > control.final_tiles)) {
      fail(`${map} candidate final tiles did not beat control`);
    }
    if (
      candidate.seed !== control.seed || candidate.seat !== control.seat ||
      candidate.roster_sha256 !== control.roster_sha256 ||
      candidate.matched_plan_sha256 !== control.matched_plan_sha256
    ) fail(`${map} pair is not seed/seat/full-plan matched`);
  }
  const candidates = runs.filter((run) => run.arm === "candidate");
  const controls = runs.filter((run) => run.arm === "control");
  const candidateTiles = candidates.reduce((sum, run) => sum + run.final_tiles, 0);
  const controlTiles = controls.reduce((sum, run) => sum + run.final_tiles, 0);
  if (!(candidateTiles >= controlTiles * 1.2)) fail("combined tile ratio is below 1.20x");
  if (!candidates.some((run) => run.won === true)) fail("candidate never finished first");
}

const contractRead = await readJson(path.resolve(contractPath), "audit contract");
const contract = contractRead.value ?? {};
if (contract.schema_version !== 1 || contract.profile !== "standard-rebuild") {
  fail("audit contract schema/profile mismatched");
}
if (contract.control_runtime_mode !== CONTROL_RUNTIME_MODE) {
  fail(`control_runtime_mode must be ${CONTROL_RUNTIME_MODE}`);
}
const candidate = contract.candidate ?? {};
if (!COMMIT.test(candidate.source_commit ?? "")) fail("candidate source commit is invalid");
if (!COMMIT.test(candidate.parent_source_commit ?? "")) fail("parent source commit is invalid");
if (!IMAGE_ID.test(candidate.image_id ?? "")) fail("candidate image ID is invalid");
if (!IMAGE_ID.test(candidate.parent_image_id ?? "")) fail("parent image ID is invalid");
const source = verifySourceRepository(candidate);
const preregistration = verifyPreregistration(contract, source, candidate);
if (source.repository && COMMIT.test(candidate.parent_source_commit ?? "")) {
  const parent = git(source.repository, [
    "rev-parse", "--verify", `${candidate.parent_source_commit}^{commit}`,
  ]);
  if (parent.status !== 0 || parent.stdout.trim() !== candidate.parent_source_commit) {
    fail("parent_source_commit does not exist as the exact commit in source_repo");
  }
}

const runSpecs = Array.isArray(contract.runs) ? contract.runs : [];
const cells = runSpecs.map((run) => `${run?.map}/${run?.arm}`);
const directories = runSpecs.map((run) => path.resolve(String(run?.directory ?? "")));
if (
  runSpecs.length !== 4 || new Set(cells).size !== 4 ||
  [...EXPECTED_CELLS].some((cell) => !cells.includes(cell))
) fail("contract must contain exactly the four Pangaea/World candidate/control cells");
if (new Set(directories).size !== 4) fail("the four result directories must be unique");
const dispatcher = await verifyDispatcher(runSpecs, source);

const artifacts = await auditArtifacts(contract, source);
if (!path.isAbsolute(contract?.benchmark_receipt_path ?? "")) {
  fail("benchmark receipt path must be absolute");
}
const benchmarkRead = await readJson(
  path.resolve(String(contract?.benchmark_receipt_path ?? "")),
  "benchmark receipt",
);
const benchmark = benchmarkRead.value ?? {};
if (benchmark?.schema_version !== "proxywar-standard-controller-benchmark-v2") {
  fail("benchmark receipt schema mismatched");
}
const benchmarkProducer = verifyProducerReceipt(
  benchmark,
  "benchmark receipt",
  "scripts/benchmark-standard-controller.mjs",
  candidate,
  source,
);
const benchmarkRuntime = verifyBenchmarkRuntime(benchmark, candidate, source);
const productionBenchmark = benchmark?.production ?? {};
if (
  !(productionBenchmark.iterations >= 10_000) ||
  !(productionBenchmark.p95_ms < 5) ||
  !(productionBenchmark.p99_ms < 10) ||
  !(productionBenchmark.max_ms < 100) ||
  productionBenchmark.action_count !== 47 ||
  stable(productionBenchmark.measured_path) !==
    stable(["JSON.parse", "decideResponse", "JSON.stringify"])
) {
  fail("10,000-decision production-shaped latency gate failed");
}
if (!path.isAbsolute(contract?.qualifier_receipt_path ?? "")) {
  fail("qualifier receipt path must be absolute");
}
const qualifierRead = await readJson(
  path.resolve(String(contract?.qualifier_receipt_path ?? "")),
  "qualifier receipt",
);
const qualifier = qualifierRead.value ?? {};
if (qualifier?.schema_version !== "proxywar-standard-qualifier-v1") {
  fail("qualifier receipt schema mismatched");
}
const qualifierProducer = verifyProducerReceipt(
  qualifier,
  "qualifier receipt",
  "scripts/audit-standard-qualifier.mjs",
  candidate,
  source,
);
const qualifierArtifactsBound = await verifyBoundReceiptArtifacts(
  qualifier,
  "qualifier receipt",
  new Set(["results.json", "replay", "decisions.jsonl", "runner-receipt.json"]),
);
const qualifierRunnerIndependentlyVerified = await verifyQualifierRunnerReceipt(
  qualifier,
  candidate,
  preregistration,
);
let qualifierDispatchBound = false;
try {
  const qualifierRoot = realpathSync(qualifier?.run_dir ?? "");
  const candidateIndex = DISPATCH_PODS.findIndex((pod, index) =>
    pod.role === "candidate" &&
    path.join(realpathSync(runSpecs.find((spec) =>
      spec?.map === pod.map && spec?.arm === pod.role
    )?.directory ?? ""), "qualifier") === qualifierRoot
  );
  const runnerReceiptHash = qualifier?.artifacts?.["runner-receipt.json"]?.sha256;
  qualifierDispatchBound = candidateIndex >= 0 &&
    dispatcher?.pods?.[candidateIndex]?.qualifier_receipt_sha256 === runnerReceiptHash;
} catch {
  qualifierDispatchBound = false;
}
if (!qualifierDispatchBound) {
  fail("qualifier runner receipt is not bound to a dispatched candidate canary");
}
if (
  qualifier.passed !== true || !(qualifier.decision_count > 0) ||
  qualifier.accepted_decisions !== qualifier.decision_count ||
  qualifier.fallback_decisions !== 0 || qualifier.degraded_decisions !== 0 ||
  qualifier.rejected_decisions !== 0 || qualifier.illegal_decisions !== 0 ||
  qualifier.all_selected_ids_offered !== true ||
  qualifier.result_counters_match !== true ||
  qualifier.runner_attestation_verified !== true
) fail("crash qualifier gate failed");

const runs = [];
for (const spec of runSpecs) {
  runs.push(await auditRun(spec, contract, preregistration));
}
for (const run of runs) checkRun(run);
if (runs.length === 4) checkOutcomeGate(runs);

const uniqueFailures = [...new Set(failures)];
const receipt = {
  schema_version: 1,
  profile: "standard-rebuild",
  verdict: uniqueFailures.length === 0 ? "PASS_STANDARD_REBUILD" : "FAIL_STANDARD_REBUILD",
  failures: uniqueFailures,
  candidate_source_commit: candidate.source_commit ?? null,
  candidate_source_repo: source.repository,
  source_commit_verified: source.commit === candidate.source_commit,
  candidate_image_id: candidate.image_id ?? null,
  parent_source_commit: candidate.parent_source_commit ?? null,
  parent_image_id: candidate.parent_image_id ?? null,
  image_binding_method: "docker-image-id+git-commit+revision-label",
  image_revision_label: candidate.source_commit ?? null,
  control_runtime_mode: contract.control_runtime_mode ?? null,
  contract_sha256: contractRead.sha256,
  preregistration: {
    path: preregistration.path,
    sha256: preregistration.sha256,
    candidate_source_commit: candidate.source_commit ?? null,
    source_commit_bound: preregistration.bound,
    parent_label: preregistration?.document?.control?.label ?? null,
    parent_source_commit: preregistration?.document?.control?.source_commit ?? null,
    parent_image_id: preregistration?.document?.control?.image_id ?? null,
    specs: [...(preregistration?.cells?.values?.() ?? [])].map((cell) => ({
      map: cell.map,
      arm: cell.arm,
      seat: cell.seat,
      path: cell.spec_path,
      sha256: cell.sha256,
    })),
  },
  dispatcher,
  artifacts,
  benchmark: {
    iterations: Number(productionBenchmark.iterations ?? 0),
    p50_ms: Number(productionBenchmark.p50_ms ?? 0),
    p95_ms: Number(productionBenchmark.p95_ms ?? Infinity),
    p99_ms: Number(productionBenchmark.p99_ms ?? Infinity),
    max_ms: Number(productionBenchmark.max_ms ?? Infinity),
    action_count: Number(productionBenchmark.action_count ?? 0),
    measured_path: productionBenchmark.measured_path ?? null,
    microbenchmark: benchmark?.microbenchmark ?? null,
    receipt_sha256: benchmarkRead.sha256,
    candidate_binding_verified: benchmarkProducer.bound && benchmarkRuntime.bound,
    executed_runtime_verified: benchmarkRuntime.bound,
    executed_runtime: {
      image_id: benchmark?.executed_runtime?.image_id ?? null,
      files: benchmarkRuntime.files,
    },
    producer: {
      script_path: benchmarkProducer.script_path,
      script_sha256: benchmarkProducer.script_sha256,
    },
  },
  qualifier: {
    passed: qualifier.passed === true,
    decision_count: Number(qualifier.decision_count ?? 0),
    accepted_decisions: Number(qualifier.accepted_decisions ?? 0),
    fallback_decisions: Number(qualifier.fallback_decisions ?? 0),
    degraded_decisions: Number(qualifier.degraded_decisions ?? 0),
    rejected_decisions: Number(qualifier.rejected_decisions ?? 0),
    illegal_decisions: Number(qualifier.illegal_decisions ?? 0),
    all_selected_ids_offered: qualifier.all_selected_ids_offered === true,
    result_counters_match: qualifier.result_counters_match === true,
    runner_attestation_verified: qualifier.runner_attestation_verified === true,
    receipt_sha256: qualifierRead.sha256,
    candidate_binding_verified: qualifierProducer.bound,
    artifacts_verified: qualifierArtifactsBound && qualifierDispatchBound,
    runner_attestation_independently_verified: qualifierRunnerIndependentlyVerified,
    producer: {
      script_path: qualifierProducer.script_path,
      script_sha256: qualifierProducer.script_sha256,
    },
  },
  runs,
};

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (uniqueFailures.length > 0) process.exitCode = 1;
