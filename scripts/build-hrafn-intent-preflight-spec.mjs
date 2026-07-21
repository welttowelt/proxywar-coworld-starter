#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  HRAFN_INTENT_CELLS,
  parsePinnedHrafnIntentManifest,
} from "./build-hrafn-intent-job.mjs";
import { expectedHrafnIntentCoworldArgv } from
  "./preflight-hrafn-intent-run.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const ATTEMPT = /^[a-z][a-z0-9-]{0,15}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function option(argv, name) {
  const exact = `--${name}`;
  const inline = argv.find((argument) => argument.startsWith(`${exact}=`));
  if (inline) return inline.slice(exact.length + 1);
  const index = argv.indexOf(exact);
  return index >= 0 ? argv[index + 1] : null;
}

function regularFile(target, label) {
  if (!path.isAbsolute(target ?? "")) throw new Error(`${label} must be absolute`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return readFileSync(target);
}

export function buildHrafnIntentPreflightSpec({
  repoPath,
  manifestPath,
  artifactDirectory,
  identityWindowPath,
  jobID,
  attempt = "r2",
  outputRoot = "/private/tmp",
  leaseDirectory = path.join(
    homedir(),
    ".stormforge",
    "proxywar-operators",
    "runner.lock",
  ),
  pangaeaReportPath = null,
} = {}) {
  for (const [label, value] of Object.entries({
    repoPath,
    manifestPath,
    artifactDirectory,
    identityWindowPath,
    outputRoot,
    leaseDirectory,
  })) {
    if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  }
  if (!ATTEMPT.test(attempt)) throw new Error("attempt label is invalid");
  const active = HRAFN_INTENT_CELLS.find((cell) => cell.id === jobID);
  if (!active) throw new Error("unknown HI1 job ID");

  parsePinnedHrafnIntentManifest(regularFile(manifestPath, "manifest"));
  regularFile(identityWindowPath, "identity window");
  const preregistrationPath = path.join(
    repoPath,
    "experiments",
    "hrafn-intent-i1-preregistration-20260720.json",
  );
  regularFile(preregistrationPath, "preregistration");
  const receiptPath = path.join(artifactDirectory, "image-receipt.json");
  const receipt = JSON.parse(regularFile(receiptPath, "image receipt"));
  const sourceCommit = receipt?.source?.commit;
  if (!COMMIT.test(sourceCommit ?? "")) {
    throw new Error("image receipt has no exact source commit");
  }
  const shortCommit = sourceCommit.slice(0, 8);
  const outputFor = (cell) => path.join(
    outputRoot,
    `hrafn-hi1-${cell.id}-${shortCommit}-${attempt}`,
  );
  const activeOutput = outputFor(active);
  if (existsSync(activeOutput)) throw new Error("active output path already exists");

  const campaignJobs = HRAFN_INTENT_CELLS.map((cell) => {
    const target = path.join(artifactDirectory, `${cell.id}.json`);
    return {
      id: cell.id,
      order: cell.order,
      role: cell.role,
      map: cell.map,
      seed: cell.seed,
      subject_slot: cell.subject_slot,
      path: target,
      sha256: sha256(regularFile(target, `job ${cell.id}`)),
    };
  });
  const predecessors = HRAFN_INTENT_CELLS.slice(0, active.order).map((cell) => {
    const target = path.join(outputFor(cell), "hrafn-operational-receipt.json");
    return {
      job_id: cell.id,
      path: target,
      sha256: sha256(regularFile(target, `predecessor ${cell.id}`)),
    };
  });
  let continuation = null;
  if (active.order >= 2) {
    if (!path.isAbsolute(pangaeaReportPath ?? "")) {
      throw new Error("Asia stages require an absolute Pangaea report path");
    }
    continuation = {
      path: pangaeaReportPath,
      sha256: sha256(regularFile(pangaeaReportPath, "Pangaea pair report")),
    };
  }
  const activeJob = campaignJobs[active.order];
  return {
    schema_version: 1,
    record_type: "hrafn_intent_i1_preflight_spec",
    campaign_id: "hrafn-intent-i1",
    run_id: `hi1-${active.id}-${shortCommit}-${attempt}`,
    job_id: active.id,
    role: active.role,
    repo_path: repoPath,
    output_directory: activeOutput,
    lease_directory: leaseDirectory,
    manifest_path: manifestPath,
    job_path: activeJob.path,
    image_receipt_path: receiptPath,
    preregistration_path: preregistrationPath,
    identity_window_path: identityWindowPath,
    predecessor_operational_receipts: predecessors,
    pangaea_continuation_pair_report: continuation,
    campaign_jobs: campaignJobs,
    expected_argv: expectedHrafnIntentCoworldArgv({
      manifestPath,
      jobPath: activeJob.path,
      outputDirectory: activeOutput,
    }),
  };
}

export function main(argv = process.argv.slice(2)) {
  const output = option(argv, "output");
  const spec = buildHrafnIntentPreflightSpec({
    repoPath: option(argv, "repo"),
    manifestPath: option(argv, "manifest"),
    artifactDirectory: option(argv, "artifact-dir"),
    identityWindowPath: option(argv, "identity-window"),
    jobID: option(argv, "job-id"),
    attempt: option(argv, "attempt") ?? "r2",
    outputRoot: option(argv, "output-root") ?? "/private/tmp",
    leaseDirectory: option(argv, "lease-directory") ?? path.join(
      homedir(),
      ".stormforge",
      "proxywar-operators",
      "runner.lock",
    ),
    pangaeaReportPath: option(argv, "pangaea-report"),
  });
  if (!path.isAbsolute(output ?? "")) {
    throw new Error(
      "usage: build-hrafn-intent-preflight-spec --repo ABS --manifest ABS " +
        "--artifact-dir ABS --identity-window ABS --job-id ID --output ABS",
    );
  }
  writeFileSync(output, `${JSON.stringify(spec, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
