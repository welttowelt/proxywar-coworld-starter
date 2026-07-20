#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  auditHrafnIntentJob,
  compareHrafnIntentJobs,
  HRAFN_INTENT_CELLS,
  HRAFN_INTENT_MANIFEST_SHA256,
  parsePinnedHrafnIntentManifest,
} from "./build-hrafn-intent-job.mjs";
import {
  canonicalJSON,
  HRAFN_INTENT_CAMPAIGN_ID,
  HRAFN_INTENT_MODEL,
  HRAFN_INTENT_MODEL_DIGEST,
  HRAFN_INTENT_OLLAMA_VERSION,
  HRAFN_V5_OPPONENT_IMAGE_ID,
  serializeHrafnIntentImageReceipt,
  verifyHrafnIntentImageReceiptEnvironment,
} from "./create-hrafn-intent-image-receipt.mjs";
import {
  HRAFN_OLLAMA_INTENT_SCHEMA,
  normalizeHrafnIntent,
} from "../hrafn-intent.mjs";
import {
  DEFAULT_HRAFN_LEASE_DIRECTORY,
  currentProcessStart,
  readActiveHrafnIdentity,
  validateHrafnLeaseSnapshot,
} from "../hrafn-operational-context.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";
import { verifyK1ZPacketBytes } from "../k1z-direct-line.mjs";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
export const DEFAULT_HRAFN_REPO = path.join(homedir(), "proxywar-k1z-hrafn");
export const DEFAULT_HRAFN_MAILBOX_DIRECTORY = path.join(
  homedir(),
  ".stormforge",
  "team-mailbox",
);
const DEFAULT_OUTPUT_ROOT = "/private/tmp";
const SUBJECT_NAME = "K1Z Hrafn";
const PREFLIGHT_RECEIPT_NAME = "hrafn-intent-preflight-receipt.json";
const HRAFN_INTENT_CONTAINER_OLLAMA_ENDPOINT =
  "http://host.docker.internal:11434/api/generate";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function equalJSON(left, right) {
  return canonicalJSON(left) === canonicalJSON(right);
}

async function defaultRun(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: Buffer.from(result.stdout ?? ""),
    stderr: Buffer.from(result.stderr ?? ""),
  };
}

async function readPlainFile(target) {
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`preflight artifact must be a regular file: ${target}`);
  }
  return readFile(target);
}

function parseJSON(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export function expectedHrafnIntentCoworldArgv({
  manifestPath,
  jobPath,
  outputDirectory,
} = {}) {
  for (const [label, value] of Object.entries({
    manifestPath,
    jobPath,
    outputDirectory,
  })) {
    if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  }
  return [
    "uvx",
    "--from",
    "coworld==0.1.28",
    "coworld",
    "run-episode",
    manifestPath,
    jobPath,
    "--output-dir",
    outputDirectory,
    "--episodes",
    "1",
    "--timeout-seconds",
    "3600",
    "--verify-replay",
  ];
}

async function jsonResponse(response, label) {
  if (!response?.ok) throw new Error(`${label} HTTP request failed`);
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
  return parsed;
}

export async function probeHrafnIntentOllama({
  fetch: fetchImpl = globalThis.fetch,
  baseURL = "http://127.0.0.1:11434",
} = {}) {
  if (baseURL !== "http://127.0.0.1:11434") {
    throw new Error("HI1 Ollama probe must use the pinned local endpoint");
  }
  const get = (route) => fetchImpl(`${baseURL}${route}`, {
    signal: AbortSignal.timeout(5000),
  });
  const post = (route, body) => fetchImpl(`${baseURL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const version = await jsonResponse(await get("/api/version"), "Ollama version");
  if (version?.version !== HRAFN_INTENT_OLLAMA_VERSION) {
    throw new Error("observed Ollama version does not match HI1");
  }
  const tags = await jsonResponse(await get("/api/tags"), "Ollama tags");
  const matching = Array.isArray(tags?.models)
    ? tags.models.filter((model) => model?.name === HRAFN_INTENT_MODEL)
    : [];
  const observedDigest = String(matching[0]?.digest ?? "").replace(/^sha256:/, "");
  if (matching.length !== 1 || observedDigest !== HRAFN_INTENT_MODEL_DIGEST) {
    throw new Error("observed Ollama tag digest does not match HI1");
  }
  const show = await jsonResponse(
    await post("/api/show", { model: HRAFN_INTENT_MODEL }),
    "Ollama show",
  );
  if (!show?.details || typeof show.details !== "object" ||
    Object.keys(show.details).length === 0 || !show?.model_info ||
    typeof show.model_info !== "object" || Object.keys(show.model_info).length === 0
  ) {
    throw new Error("Ollama show did not expose pinned model metadata");
  }
  const probeBody = {
    model: HRAFN_INTENT_MODEL,
    stream: false,
    format: HRAFN_OLLAMA_INTENT_SCHEMA,
    prompt: "Return one intent JSON object. Choose grow with targetID null and horizon 8.",
    options: { temperature: 0, seed: 240721 },
  };
  const probe = await jsonResponse(
    await post("/api/generate", probeBody),
    "Ollama schema probe",
  );
  if (probe?.model !== HRAFN_INTENT_MODEL || probe?.done !== true ||
    typeof probe?.response !== "string"
  ) {
    throw new Error("Ollama schema probe model response is invalid");
  }
  let parsedIntent;
  try {
    parsedIntent = JSON.parse(probe.response);
  } catch {
    throw new Error("Ollama schema probe response is not JSON");
  }
  const intent = normalizeHrafnIntent(parsedIntent);
  if (!intent) throw new Error("Ollama schema probe intent is invalid");
  return {
    version: version.version,
    model: HRAFN_INTENT_MODEL,
    model_digest: observedDigest,
    tags_response_sha256: sha256(canonicalJSON(tags)),
    show_response_sha256: sha256(canonicalJSON(show)),
    schema_sha256: sha256(canonicalJSON(HRAFN_OLLAMA_INTENT_SCHEMA)),
    probe_response_sha256: sha256(canonicalJSON(probe)),
    probe_intent: intent,
  };
}

export async function probeHrafnIntentOllamaFromContainer({
  imageID,
  runtime = { run: defaultRun },
} = {}) {
  if (!IMAGE_ID.test(imageID ?? "")) {
    throw new Error("container Ollama probe requires an exact subject image ID");
  }
  const requestBody = {
    model: HRAFN_INTENT_MODEL,
    stream: false,
    format: HRAFN_OLLAMA_INTENT_SCHEMA,
    prompt: "Return one intent JSON object. Choose grow with targetID null and horizon 8.",
    options: { temperature: 0, seed: 240721 },
  };
  const probeSource = [
    `const endpoint=${JSON.stringify(HRAFN_INTENT_CONTAINER_OLLAMA_ENDPOINT)};`,
    `const body=${JSON.stringify(requestBody)};`,
    "const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});",
    "if(!response.ok)throw new Error(`container Ollama HTTP ${response.status}`);",
    "const payload=await response.json();",
    "process.stdout.write(JSON.stringify(payload));",
  ].join("");
  const result = await runtime.run("docker", [
    "run",
    "--rm",
    "--network",
    "bridge",
    "--entrypoint",
    "node",
    imageID,
    "--input-type=module",
    "--eval",
    probeSource,
  ]);
  const probe = parseJSON(result.stdout, "container Ollama schema probe");
  if (probe?.model !== HRAFN_INTENT_MODEL || probe?.done !== true ||
    typeof probe?.response !== "string"
  ) {
    throw new Error("container Ollama schema probe model response is invalid");
  }
  let parsedIntent;
  try {
    parsedIntent = JSON.parse(probe.response);
  } catch {
    throw new Error("container Ollama schema probe response is not JSON");
  }
  const intent = normalizeHrafnIntent(parsedIntent);
  if (!intent) throw new Error("container Ollama schema probe intent is invalid");
  return {
    endpoint: HRAFN_INTENT_CONTAINER_OLLAMA_ENDPOINT,
    image_id: imageID,
    model: HRAFN_INTENT_MODEL,
    schema_sha256: sha256(canonicalJSON(HRAFN_OLLAMA_INTENT_SCHEMA)),
    response_sha256: sha256(canonicalJSON(probe)),
    probe_intent: intent,
  };
}

async function inspectImage(imageID, runtime) {
  if (!IMAGE_ID.test(imageID ?? "")) throw new Error("image ID is invalid");
  const result = await runtime.run("docker", ["image", "inspect", imageID]);
  const parsed = parseJSON(result.stdout, "Docker inspect");
  if (!Array.isArray(parsed) || parsed.length !== 1 ||
    parsed[0]?.Id !== imageID || parsed[0]?.Os !== "linux" ||
    parsed[0]?.Architecture !== "amd64"
  ) {
    throw new Error("live Docker image is not the exact linux/amd64 ID");
  }
  return { id: imageID, os: "linux", architecture: "amd64" };
}

async function verifyMailboxFilesCommitted(paths, mailboxDirectory, runtime) {
  const text = async (args) => {
    const result = await runtime.run("git", ["-C", mailboxDirectory, ...args]);
    return Buffer.from(result.stdout ?? "").toString("utf8").trim();
  };
  const head = await text(["rev-parse", "HEAD"]);
  const upstream = await text(["rev-parse", "@{upstream}"]);
  const remoteName = await text(["config", "--get", "branch.main.remote"]);
  const remoteRef = await text(["config", "--get", "branch.main.merge"]);
  const remoteRaw = await text(["ls-remote", "--exit-code", remoteName, remoteRef]);
  const remoteCommit = remoteRaw.match(/^([a-f0-9]{40})\s+/)?.[1] ?? "";
  if (!/^[a-f0-9]{40}$/.test(head) || head !== upstream || head !== remoteCommit ||
    remoteName !== "origin" || remoteRef !== "refs/heads/main"
  ) {
    throw new Error("coordination mailbox HEAD is not pushed to origin/main");
  }
  for (const target of paths) {
    const relative = path.relative(mailboxDirectory, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("coordination artifact is outside the mailbox");
    }
    await runtime.run("git", ["-C", mailboxDirectory, "ls-files", "--error-unmatch", "--", relative]);
    await runtime.run("git", ["-C", mailboxDirectory, "diff", "--quiet", "HEAD", "--", relative]);
    const committed = await runtime.run("git", ["-C", mailboxDirectory, "show", `HEAD:${relative}`]);
    const live = await readPlainFile(target);
    if (!Buffer.from(committed.stdout ?? "").equals(live)) {
      throw new Error("coordination artifact bytes differ from committed mailbox bytes");
    }
  }
  return { head_commit: head, remote_commit: remoteCommit };
}

function validateSpec(spec) {
  if (!exactKeys(spec, [
    "schema_version",
    "record_type",
    "campaign_id",
    "run_id",
    "job_id",
    "role",
    "repo_path",
    "output_directory",
    "lease_directory",
    "manifest_path",
    "job_path",
    "image_receipt_path",
    "preregistration_path",
    "identity_window_path",
    "predecessor_operational_receipts",
    "pangaea_continuation_pair_report",
    "campaign_jobs",
    "expected_argv",
  ])) {
    throw new Error("preflight spec fields are not exact");
  }
  if (spec.schema_version !== 1 ||
    spec.record_type !== "hrafn_intent_i1_preflight_spec" ||
    spec.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(spec.run_id ?? "") ||
    !["control", "candidate"].includes(spec.role)
  ) {
    throw new Error("preflight spec header is invalid");
  }
  for (const key of [
    "repo_path",
    "output_directory",
    "lease_directory",
    "manifest_path",
    "job_path",
    "image_receipt_path",
    "preregistration_path",
    "identity_window_path",
  ]) {
    if (!path.isAbsolute(spec[key] ?? "")) throw new Error(`${key} must be absolute`);
  }
  if (!Array.isArray(spec.campaign_jobs) || spec.campaign_jobs.length !== 4 ||
    !Array.isArray(spec.expected_argv) ||
    !Array.isArray(spec.predecessor_operational_receipts) ||
    !(
      spec.pangaea_continuation_pair_report === null ||
      exactKeys(spec.pangaea_continuation_pair_report, ["path", "sha256"])
    )
  ) {
    throw new Error("preflight spec campaign jobs, lifecycle, or argv are invalid");
  }
  for (const predecessor of spec.predecessor_operational_receipts) {
    if (!exactKeys(predecessor, ["job_id", "path", "sha256"]) ||
      !path.isAbsolute(predecessor.path ?? "") ||
      !SHA256.test(predecessor.sha256 ?? "")
    ) {
      throw new Error("predecessor operational receipt declaration is invalid");
    }
  }
  if (spec.pangaea_continuation_pair_report !== null &&
    (!path.isAbsolute(spec.pangaea_continuation_pair_report.path ?? "") ||
      !SHA256.test(spec.pangaea_continuation_pair_report.sha256 ?? ""))
  ) {
    throw new Error("Pangaea continuation declaration is invalid");
  }
}

async function mailboxAuthority(mailboxDirectory) {
  const names = await readdir(mailboxDirectory);
  const formalApprovals = [];
  const identityWindows = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const target = path.join(mailboxDirectory, name);
    let bytes;
    let packet;
    try {
      bytes = await readPlainFile(target);
      packet = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    if (packet?.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID) continue;
    if (packet?.authority?.formal_approval === true &&
      packet?.payload?.decision === "APPROVE"
    ) {
      formalApprovals.push({ target, bytes, packet });
    }
    if (packet?.payload?.state === "HI1_IDENTITY_WINDOW_READY") {
      identityWindows.push({ target, bytes, packet });
    }
  }
  return { formalApprovals, identityWindows };
}

function campaignBinding(jobs) {
  return jobs.map(({ path: _path, ...entry }) => entry);
}

function exactArtifactBindings({
  subjectReceipt,
  receiptBytes,
  preregistration,
  preregistrationBytes,
  manifestSHA,
  campaignJobs,
}) {
  return {
    scope: "hrafn-only",
    source_commit: subjectReceipt.source.commit,
    subject_image_id: subjectReceipt.image.id,
    image_receipt: {
      file_sha256: sha256(receiptBytes),
      content_sha256: subjectReceipt.integrity.content_sha256,
    },
    preregistration: {
      file_sha256: sha256(preregistrationBytes),
      content_sha256: sha256(canonicalJSON(preregistration)),
    },
    manifest_sha256: manifestSHA,
    planner: {
      model: HRAFN_INTENT_MODEL,
      model_digest: HRAFN_INTENT_MODEL_DIGEST,
      ollama_version: HRAFN_INTENT_OLLAMA_VERSION,
    },
    jobs: campaignBinding(campaignJobs),
  };
}

function canonicalArtifact(bytes, label) {
  const value = parseJSON(bytes, label);
  if (bytes.toString("utf8") !== `${JSON.stringify(value, null, 2)}\n`) {
    throw new Error(`${label} wire bytes are not canonical`);
  }
  return value;
}

function operationalCommonBindingMatches(bindings, expected) {
  return bindings?.source_commit === expected.source_commit &&
    equalJSON(bindings?.campaign_jobs, expected.campaign_jobs) &&
    equalJSON(bindings?.image_receipt, expected.image_receipt) &&
    equalJSON(bindings?.preregistration, expected.preregistration) &&
    equalJSON(bindings?.manifest, expected.manifest) &&
    equalJSON(bindings?.images, expected.images) &&
    bindings?.planner?.model === HRAFN_INTENT_MODEL &&
    bindings?.planner?.model_digest === HRAFN_INTENT_MODEL_DIGEST &&
    bindings?.planner?.version === HRAFN_INTENT_OLLAMA_VERSION &&
    equalJSON(bindings?.identity_window, expected.identity_window);
}

function assertContinuationReport(report, expectedOperationalHashes) {
  const cleanAndReached = report?.checks?.provenance_bound === true &&
    report?.checks?.jobs_only_intent_flag === true &&
    report?.checks?.same_map_seed_slot === true &&
    report?.checks?.control_clean === true &&
    report?.checks?.candidate_operational === true &&
    report?.checks?.candidate_reach === true &&
    report?.checks?.pretreatment_equivalent === true &&
    report?.checks?.opening_metrics_complete === true;
  if (report?.record_type !== "hrafn_intent_i1_pair_audit" ||
    report?.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID ||
    report?.map !== "Pangaea" || report?.seed !== 240721 ||
    report?.subject_slot !== 1 ||
    !["PAIR_PASS", "REJECT_NO_LIFT"].includes(report?.verdict) ||
    !cleanAndReached ||
    report?.control?.provenance?.operational_sha256 !==
      expectedOperationalHashes[0] ||
    report?.candidate?.provenance?.operational_sha256 !==
      expectedOperationalHashes[1]
  ) {
    throw new Error("Pangaea continuation report does not prove a clean reached pair");
  }
}

async function verifyLifecycleEvidence({
  spec,
  active,
  expectedCommon,
  verifiedAt,
}) {
  const expectedPredecessors = HRAFN_INTENT_CELLS.slice(0, active.order);
  if (spec.predecessor_operational_receipts.length !== expectedPredecessors.length ||
    !spec.predecessor_operational_receipts.every((entry, index) =>
      entry.job_id === expectedPredecessors[index].id)
  ) {
    throw new Error("predecessor receipts do not match the exact dispatch prefix");
  }
  const predecessors = [];
  let priorCompletedAt = null;
  const observedOutputs = new Set([spec.output_directory]);
  for (const [index, declaration] of
    spec.predecessor_operational_receipts.entries()) {
    const bytes = await readPlainFile(declaration.path);
    if (sha256(bytes) !== declaration.sha256) {
      throw new Error("predecessor operational receipt hash drift");
    }
    const receipt = canonicalArtifact(bytes, "predecessor operational receipt");
    const cell = expectedPredecessors[index];
    const startedAt = Date.parse(receipt?.started_at);
    const completedAt = Date.parse(receipt?.completed_at);
    if (receipt?.schema_version !== 2 ||
      receipt?.record_type !== "hrafn_intent_i1_operational_receipt" ||
      receipt?.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID ||
      receipt?.lane !== "hrafn" || receipt?.state !== "completed" ||
      receipt?.child_exit_code !== 0 || receipt?.supervisor_exit_code !== 0 ||
      receipt?.child_signal !== null || receipt?.child_spawn_error !== null ||
      receipt?.initial_identity?.player_id !== HRAFN_PLAYER_ID ||
      receipt?.initial_identity?.player_name !== SUBJECT_NAME ||
      receipt?.final_identity?.player_id !== HRAFN_PLAYER_ID ||
      receipt?.final_identity?.player_name !== SUBJECT_NAME ||
      receipt?.final_identity_error !== null ||
      receipt?.bindings?.job?.id !== cell.id ||
      receipt?.bindings?.job?.order !== cell.order ||
      receipt?.bindings?.job?.role !== cell.role ||
      receipt?.bindings?.job?.map !== cell.map ||
      receipt?.bindings?.job?.seed !== cell.seed ||
      receipt?.bindings?.job?.subject_slot !== cell.subject_slot ||
      !operationalCommonBindingMatches(receipt?.bindings, expectedCommon) ||
      !Number.isFinite(startedAt) || !Number.isFinite(completedAt) ||
      completedAt < startedAt ||
      (priorCompletedAt !== null && startedAt < priorCompletedAt) ||
      completedAt > Date.parse(verifiedAt) ||
      observedOutputs.has(receipt?.output_directory)
    ) {
      throw new Error(`predecessor operational receipt is invalid: ${cell.id}`);
    }
    const expectedPrefix = predecessors.map((entry) => ({
      job_id: entry.job_id,
      order: entry.order,
      path: entry.path,
      file_sha256: entry.file_sha256,
      run_id: entry.run_id,
      started_at: entry.started_at,
      completed_at: entry.completed_at,
    }));
    if (receipt?.bindings?.lifecycle?.active_order !== cell.order ||
      !equalJSON(receipt?.bindings?.lifecycle?.predecessors, expectedPrefix) ||
      (cell.order < 2 &&
        receipt?.bindings?.lifecycle?.pangaea_continuation !== null)
    ) {
      throw new Error(`predecessor lifecycle chain is invalid: ${cell.id}`);
    }
    observedOutputs.add(receipt.output_directory);
    priorCompletedAt = completedAt;
    predecessors.push({
      job_id: cell.id,
      order: cell.order,
      path: declaration.path,
      file_sha256: declaration.sha256,
      run_id: receipt.run_id,
      started_at: receipt.started_at,
      completed_at: receipt.completed_at,
    });
  }

  const needsContinuation = active.order >= 2;
  if (needsContinuation !== (spec.pangaea_continuation_pair_report !== null)) {
    throw new Error("Pangaea continuation evidence does not match active dispatch order");
  }
  let pangaeaContinuation = null;
  if (needsContinuation) {
    const declaration = spec.pangaea_continuation_pair_report;
    const bytes = await readPlainFile(declaration.path);
    if (sha256(bytes) !== declaration.sha256) {
      throw new Error("Pangaea continuation report hash drift");
    }
    const report = canonicalArtifact(bytes, "Pangaea continuation pair report");
    const hashes = predecessors.slice(0, 2).map((entry) => entry.file_sha256);
    assertContinuationReport(report, hashes);
    pangaeaContinuation = {
      path: declaration.path,
      file_sha256: declaration.sha256,
      verdict: report.verdict,
      control_operational_sha256: hashes[0],
      candidate_operational_sha256: hashes[1],
    };
    for (const predecessor of spec.predecessor_operational_receipts.slice(2)) {
      const bytes = await readPlainFile(predecessor.path);
      const receipt = canonicalArtifact(bytes, "Asia predecessor operational receipt");
      if (!equalJSON(
        receipt?.bindings?.lifecycle?.pangaea_continuation,
        pangaeaContinuation,
      )) {
        throw new Error("Asia predecessor does not bind the Pangaea continuation report");
      }
    }
  }
  return {
    active_order: active.order,
    predecessors,
    pangaea_continuation: pangaeaContinuation,
  };
}

export async function verifyHrafnIntentRunPreflight(
  spec,
  {
    command,
    processPID = process.pid,
    expectedRepoPath = DEFAULT_HRAFN_REPO,
    expectedMailboxDirectory = DEFAULT_HRAFN_MAILBOX_DIRECTORY,
    expectedOutputRoot = DEFAULT_OUTPUT_ROOT,
    expectedManifestSHA256 = HRAFN_INTENT_MANIFEST_SHA256,
  } = {},
  runtimeOverrides = {},
) {
  validateSpec(spec);
  if (spec.repo_path !== expectedRepoPath) throw new Error("preflight repo path is not Hrafn");
  if (spec.lease_directory !== DEFAULT_HRAFN_LEASE_DIRECTORY &&
    expectedRepoPath === DEFAULT_HRAFN_REPO
  ) {
    throw new Error("preflight lease path is not the shared foreground lease");
  }
  const outputRoot = await realpath(expectedOutputRoot);
  const outputDirectory = await realpath(spec.output_directory);
  if (outputDirectory !== outputRoot && !outputDirectory.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("preflight output is outside the allowed fresh-output root");
  }
  const outputStat = await lstat(outputDirectory);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw new Error("preflight output is not a real directory");
  }
  const initialEntries = (await readdir(outputDirectory)).sort();
  if (!equalJSON(initialEntries, [".proxywar-runner-claim"])) {
    throw new Error("preflight output is not fresh");
  }
  const claimStat = await lstat(path.join(outputDirectory, ".proxywar-runner-claim"));
  if (!claimStat.isFile() || claimStat.isSymbolicLink()) {
    throw new Error("foreground output claim is invalid");
  }

  const runtime = {
    now: () => new Date(),
    run: defaultRun,
    verifyImageEnvironment: (receipt) =>
      verifyHrafnIntentImageReceiptEnvironment(receipt, {
        repoPath: spec.repo_path,
      }),
    inspectImage: (imageID) => inspectImage(imageID, runtime),
    probeOllama: () => probeHrafnIntentOllama(),
    probeContainerOllama: (imageID) =>
      probeHrafnIntentOllamaFromContainer({ imageID, runtime }),
    readIdentity: readActiveHrafnIdentity,
    validateLease: () => validateHrafnLeaseSnapshot({
      leaseDirectory: spec.lease_directory,
      runID: spec.run_id,
      outputDirectory,
      processPID,
      processStart: currentProcessStart,
      supervisorStart: currentProcessStart,
    }),
    verifyMailboxEnvironment: (paths) =>
      verifyMailboxFilesCommitted(paths, expectedMailboxDirectory, runtime),
    ...runtimeOverrides,
  };

  const manifestBytes = await readPlainFile(spec.manifest_path);
  const manifestSHA = sha256(manifestBytes);
  if (manifestSHA !== expectedManifestSHA256) {
    throw new Error("raw manifest SHA-256 is not pinned");
  }
  const manifest = expectedManifestSHA256 === HRAFN_INTENT_MANIFEST_SHA256
    ? parsePinnedHrafnIntentManifest(manifestBytes)
    : parseJSON(manifestBytes, "test manifest");

  const receiptBytes = await readPlainFile(spec.image_receipt_path);
  const subjectReceipt = parseJSON(receiptBytes, "image receipt");
  if (Buffer.from(serializeHrafnIntentImageReceipt(subjectReceipt)).compare(receiptBytes) !== 0) {
    throw new Error("image receipt wire bytes are not canonical");
  }
  const liveImageEnvironment = await runtime.verifyImageEnvironment(subjectReceipt);
  if (liveImageEnvironment?.valid !== true ||
    liveImageEnvironment.source_commit !== subjectReceipt.source.commit ||
    liveImageEnvironment.subject_image !== subjectReceipt.image.id
  ) {
    throw new Error("live source/image environment does not match image receipt");
  }

  const preregistrationBytes = await readPlainFile(spec.preregistration_path);
  const preregistration = parseJSON(preregistrationBytes, "preregistration");
  if (preregistration?.campaign_id !== HRAFN_INTENT_CAMPAIGN_ID ||
    preregistration?.record_type !== "hrafn_intent_i1_preregistration" ||
    preregistration?.status !== "PREREGISTERED_AMENDED_NO_RUNTIME_AUTHORITY"
  ) {
    throw new Error("preregistration is not the frozen no-runtime HI1 record");
  }
  const preregistrationSourceEntries = subjectReceipt.files.filter((entry) =>
    entry?.path === "experiments/hrafn-intent-i1-preregistration-20260720.json"
  );
  if (preregistrationSourceEntries.length !== 1 ||
    preregistrationSourceEntries[0].sha256 !== sha256(preregistrationBytes)
  ) {
    throw new Error("live preregistration bytes do not match committed image-receipt source");
  }

  const expectedCells = HRAFN_INTENT_CELLS.map((cell) => ({
    id: cell.id,
    order: cell.order,
    role: cell.role,
    map: cell.map,
    seed: cell.seed,
    subject_slot: cell.subject_slot,
  }));
  const declaredCells = spec.campaign_jobs.map(({ path: _path, sha256: _sha, ...entry }) => entry);
  if (!equalJSON(declaredCells, expectedCells)) {
    throw new Error("campaign jobs are not the exact ordered preregistered cells");
  }
  const auditedJobs = new Map();
  for (const declared of spec.campaign_jobs) {
    if (!path.isAbsolute(declared.path ?? "") || !SHA256.test(declared.sha256 ?? "")) {
      throw new Error("campaign job path or hash is invalid");
    }
    const bytes = await readPlainFile(declared.path);
    if (sha256(bytes) !== declared.sha256) throw new Error("campaign job hash drift");
    const job = parseJSON(bytes, `job ${declared.id}`);
    if (bytes.toString("utf8") !== `${JSON.stringify(job, null, 2)}\n`) {
      throw new Error("campaign job wire bytes are not canonical");
    }
    const audit = auditHrafnIntentJob(job, {
      role: declared.role,
      subjectReceipt,
      subjectImage: subjectReceipt.image.id,
      opponentImage: HRAFN_V5_OPPONENT_IMAGE_ID,
      manifest,
    });
    if (!audit.valid || audit.cell?.id !== declared.id ||
      audit.subjectSlot !== declared.subject_slot
    ) {
      throw new Error(`campaign job contract failed: ${declared.id}: ${audit.errors.join("; ")}`);
    }
    auditedJobs.set(declared.id, job);
  }
  for (const map of ["pangaea", "asia"]) {
    const controlEntry = spec.campaign_jobs.find((job) =>
      job.id === `${map}-control`
    );
    const candidateEntry = spec.campaign_jobs.find((job) =>
      job.id === `${map}-candidate`
    );
    const comparison = compareHrafnIntentJobs(
      auditedJobs.get(controlEntry?.id),
      auditedJobs.get(candidateEntry?.id),
      {
        subjectReceipt,
        subjectImage: subjectReceipt.image.id,
        opponentImage: HRAFN_V5_OPPONENT_IMAGE_ID,
        manifest,
      },
    );
    if (!comparison.valid) throw new Error(`${map} paired jobs differ beyond intent enablement`);
  }
  const active = spec.campaign_jobs.find((entry) => entry.id === spec.job_id);
  if (!active || active.role !== spec.role || active.path !== spec.job_path) {
    throw new Error("active job ID/path/role is not exact");
  }

  const expectedArgv = expectedHrafnIntentCoworldArgv({
    manifestPath: spec.manifest_path,
    jobPath: spec.job_path,
    outputDirectory,
  });
  if (!equalJSON(spec.expected_argv, expectedArgv) || !equalJSON(command, expectedArgv)) {
    throw new Error("full Coworld argv does not match the exact job run contract");
  }

  const subjectImage = await runtime.inspectImage(subjectReceipt.image.id);
  const opponentImage = await runtime.inspectImage(HRAFN_V5_OPPONENT_IMAGE_ID);
  for (const [label, image] of Object.entries({
    subject: subjectImage,
    opponent: opponentImage,
  })) {
    if (!IMAGE_ID.test(image?.id ?? "") || image?.os !== "linux" ||
      image?.architecture !== "amd64"
    ) {
      throw new Error(`${label} live image observation is invalid`);
    }
  }
  if (subjectImage.id !== subjectReceipt.image.id ||
    opponentImage.id !== HRAFN_V5_OPPONENT_IMAGE_ID
  ) {
    throw new Error("live subject or opponent image ID drifted");
  }
  const hostPlanner = await runtime.probeOllama();
  if (hostPlanner?.version !== HRAFN_INTENT_OLLAMA_VERSION ||
    hostPlanner?.model !== HRAFN_INTENT_MODEL ||
    hostPlanner?.model_digest !== HRAFN_INTENT_MODEL_DIGEST ||
    !normalizeHrafnIntent(hostPlanner?.probe_intent)
  ) {
    throw new Error("live Ollama probe does not match the pinned planner");
  }
  const containerPlanner = await runtime.probeContainerOllama(subjectReceipt.image.id);
  if (containerPlanner?.endpoint !== HRAFN_INTENT_CONTAINER_OLLAMA_ENDPOINT ||
    containerPlanner?.image_id !== subjectReceipt.image.id ||
    containerPlanner?.model !== HRAFN_INTENT_MODEL ||
    containerPlanner?.schema_sha256 !== hostPlanner.schema_sha256 ||
    !SHA256.test(containerPlanner?.response_sha256 ?? "") ||
    !normalizeHrafnIntent(containerPlanner?.probe_intent)
  ) {
    throw new Error("subject-container Ollama probe does not match the pinned planner");
  }
  const planner = {
    ...hostPlanner,
    container_probe: containerPlanner,
  };

  const identity = runtime.readIdentity();
  if (identity?.playerID !== HRAFN_PLAYER_ID || identity?.playerName !== SUBJECT_NAME) {
    throw new Error("active Coworld identity is not exactly K1Z Hrafn");
  }
  const expectedBindings = exactArtifactBindings({
    subjectReceipt,
    receiptBytes,
    preregistration,
    preregistrationBytes,
    manifestSHA,
    campaignJobs: spec.campaign_jobs,
  });
  const mailboxDirectory = await realpath(expectedMailboxDirectory);
  if (path.dirname(await realpath(spec.identity_window_path)) !== mailboxDirectory) {
    throw new Error("identity-window receipt is outside the mailbox");
  }
  const { formalApprovals, identityWindows } = await mailboxAuthority(mailboxDirectory);
  if (formalApprovals.length !== 0) {
    throw new Error("HI1 diagnostic preflight must consume zero formal approvals");
  }
  if (identityWindows.length !== 1 ||
    await realpath(identityWindows[0].target) !==
      await realpath(spec.identity_window_path)
  ) {
    throw new Error("HI1 requires exactly one Odin advisory identity-window receipt");
  }
  const identityWindow = identityWindows[0];
  const identityWindowReport = verifyK1ZPacketBytes(identityWindow.bytes, {}, {
    requireDeclaredContract: true,
  });
  const exactWindowPayload = {
    state: "HI1_IDENTITY_WINDOW_READY",
    active_identity: {
      player_id: HRAFN_PLAYER_ID,
      player_name: SUBJECT_NAME,
    },
    formal_approvals_consumed: 0,
    ordered_diagnostic_scope: HRAFN_INTENT_CELLS.map((cell) => cell.id),
    bindings: expectedBindings,
  };
  if (!identityWindowReport.valid || identityWindowReport.identity_action_eligible ||
    identityWindow.packet?.from !== "odin" ||
    identityWindow.packet?.to !== "hrafn" ||
    identityWindow.packet?.kind !== "coordination" ||
    identityWindow.packet?.authority?.advisory !== true ||
    identityWindow.packet?.authority?.formal_approval !== false ||
    identityWindow.packet?.authority?.mutation_scope !== "none" ||
    !equalJSON(identityWindow.packet?.payload, exactWindowPayload) ||
    identityWindow.packet?.evidence?.source_commit !== subjectReceipt.source.commit ||
    identityWindow.packet?.evidence?.image_digest !== subjectReceipt.image.id ||
    !equalJSON(identityWindow.packet?.evidence?.replay_sha256, [])
  ) {
    throw new Error("Odin advisory identity-window receipt is invalid or artifact-unbound");
  }
  const mailboxGit = await runtime.verifyMailboxEnvironment([
    spec.identity_window_path,
  ]);
  const identityWindowBinding = {
    path: spec.identity_window_path,
    message_id: identityWindow.packet.message_id,
    content_sha256: identityWindowReport.content_sha256,
    file_sha256: identityWindowReport.file_sha256,
    formal_approval: false,
    formal_approvals_consumed: 0,
    mailbox_head_commit: mailboxGit?.head_commit ?? null,
    mailbox_remote_commit: mailboxGit?.remote_commit ?? null,
  };
  const verifiedAt = runtime.now().toISOString();
  const lifecycle = await verifyLifecycleEvidence({
    spec,
    active,
    verifiedAt,
    expectedCommon: {
      source_commit: subjectReceipt.source.commit,
      campaign_jobs: campaignBinding(spec.campaign_jobs),
      image_receipt: {
        path: spec.image_receipt_path,
        file_sha256: sha256(receiptBytes),
        content_sha256: subjectReceipt.integrity.content_sha256,
      },
      preregistration: {
        path: spec.preregistration_path,
        file_sha256: sha256(preregistrationBytes),
        content_sha256: sha256(canonicalJSON(preregistration)),
      },
      manifest: { path: spec.manifest_path, sha256: manifestSHA },
      images: { subject: subjectImage, opponent: opponentImage },
      planner,
      identity_window: identityWindowBinding,
    },
  });
  const lease = runtime.validateLease();
  if (lease?.runID !== spec.run_id || lease?.outputDirectory !== outputDirectory ||
    lease?.childPID !== processPID
  ) {
    throw new Error("active foreground Hrafn lease does not bind this run");
  }

  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_preflight_receipt",
    campaign_id: HRAFN_INTENT_CAMPAIGN_ID,
    verified_at: verifiedAt,
    run_id: spec.run_id,
    job: {
      id: active.id,
      order: active.order,
      role: active.role,
      map: active.map,
      seed: active.seed,
      subject_slot: active.subject_slot,
      path: active.path,
      sha256: active.sha256,
    },
    campaign_jobs: campaignBinding(spec.campaign_jobs),
    source: { ...subjectReceipt.source },
    image_receipt: {
      path: spec.image_receipt_path,
      file_sha256: sha256(receiptBytes),
      content_sha256: subjectReceipt.integrity.content_sha256,
    },
    preregistration: {
      path: spec.preregistration_path,
      file_sha256: sha256(preregistrationBytes),
      content_sha256: sha256(canonicalJSON(preregistration)),
    },
    manifest: { path: spec.manifest_path, sha256: manifestSHA },
    images: { subject: subjectImage, opponent: opponentImage },
    planner,
    identity_window: identityWindowBinding,
    lifecycle,
    identity: { player_id: identity.playerID, player_name: identity.playerName },
    lease: {
      directory: spec.lease_directory,
      child_pid: lease.childPID,
      supervisor_pid: lease.supervisorPID,
      acquired_at: lease.acquiredAt,
    },
    argv: [...expectedArgv],
    output: { directory: outputDirectory, initial_entries: initialEntries },
    checks: {
      exact_raw_manifest: true,
      exact_four_jobs: true,
      paired_jobs_flag_only: true,
      generated_image_receipt_live: true,
      exact_linux_amd64_images: true,
      pinned_ollama_probe: true,
      subject_container_ollama_probe: true,
      one_odin_advisory_identity_window: true,
      zero_formal_approvals_consumed: true,
      identity_window_artifact_pushed: true,
      exact_dispatch_order: true,
      pangaea_stop_rule: true,
      exact_hrafn_identity: true,
      active_foreground_hrafn_lease: true,
      full_coworld_argv: true,
      fresh_output: true,
    },
  };
}

export function serializeHrafnIntentPreflightReceipt(receipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function option(argv, name) {
  const exact = `--${name}`;
  const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
  if (inline) return inline.slice(exact.length + 1);
  const index = argv.indexOf(exact);
  return index >= 0 ? argv[index + 1] : null;
}

async function main(argv) {
  const specPath = option(argv, "spec");
  const outputPath = option(argv, "output");
  if (!path.isAbsolute(specPath ?? "") || !path.isAbsolute(outputPath ?? "")) {
    throw new Error("usage: preflight-hrafn-intent-run --spec ABS_JSON --output ABS_JSON");
  }
  const spec = parseJSON(await readPlainFile(specPath), "preflight spec");
  if (outputPath !== path.join(spec.output_directory, PREFLIGHT_RECEIPT_NAME)) {
    throw new Error(`preflight output must be ${PREFLIGHT_RECEIPT_NAME} in run output`);
  }
  const receipt = await verifyHrafnIntentRunPreflight(spec, {
    command: spec.expected_argv,
  });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, serializeHrafnIntentPreflightReceipt(receipt), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, outputPath);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
