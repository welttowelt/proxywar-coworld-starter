#!/usr/bin/env node

/**
 * Inert renderer only. It never calls launchctl and never creates a job, pod,
 * output directory, plist, daemon, cron entry, or background process.
 *
 * The rendered launchctl-submit argv keeps the existing foreground Mickey
 * runner lease as the supervisor. An operator may execute it only after a
 * separate explicit approval for launchd use.
 */

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { preflightManifest } from "./run-mickey-cpu-fanout.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const FANOUT = path.join(REPO_ROOT, "scripts", "run-mickey-cpu-fanout.mjs");
const RUNNER = path.join(REPO_ROOT, "scripts", "proxywar-runner-lease.sh");

function parseArgs(argv) {
  const options = {
    manifest: null,
    manifestSha256: null,
    output: null,
    resumeFrom: null,
    runpodctl: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const field = {
      "--manifest": "manifest",
      "--manifest-sha256": "manifestSha256",
      "--output": "output",
      "--resume-from": "resumeFrom",
      "--runpodctl": "runpodctl",
    }[argv[index]];
    if (!field || index + 1 >= argv.length) throw new Error(`unknown or incomplete option: ${argv[index]}`);
    options[field] = argv[++index];
  }
  if (!options.manifest || !options.manifestSha256 || !options.output) {
    throw new Error("--manifest, --manifest-sha256, and --output are required");
  }
  return options;
}

async function requireAbsoluteExistingFile(value, label) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  const info = await lstat(value).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (await realpath(value) !== value) throw new Error(`${label} must already be canonical`);
}

export async function render(argv) {
  const options = parseArgs(argv);
  const preflight = await preflightManifest(options.manifest, options.manifestSha256);
  const runpodctl = options.runpodctl ?? preflight.document.runpodctl.path;
  if (runpodctl !== preflight.document.runpodctl.path) {
    throw new Error("--runpodctl must equal the path/hash-pinned manifest binary");
  }
  if (!path.isAbsolute(options.output) || !options.output.startsWith("/private/tmp/")) {
    throw new Error("--output must be a new absolute path under /private/tmp");
  }
  if (await lstat(options.output).catch(() => null)) throw new Error("--output already exists");
  const parent = path.dirname(options.output);
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("output parent is missing or unsafe");
  await requireAbsoluteExistingFile(runpodctl, "--runpodctl");
  if (options.resumeFrom !== null) {
    if (!path.isAbsolute(options.resumeFrom)) throw new Error("--resume-from must be absolute");
    const resumeInfo = await lstat(options.resumeFrom).catch(() => null);
    if (!resumeInfo?.isDirectory() || resumeInfo.isSymbolicLink()) throw new Error("--resume-from is missing or unsafe");
  }

  const labelSuffix = preflight.document.run_id.replaceAll(/[^a-zA-Z0-9.-]/g, "-").slice(0, 60);
  const label = `com.welttowelt.proxywar.mickey-fanout.${labelSuffix}`;
  const stdoutPath = `${options.output}.launchd.stdout.log`;
  const stderrPath = `${options.output}.launchd.stderr.log`;
  const pathValue = [
    path.dirname(process.execPath),
    path.dirname(runpodctl),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((value, index, all) => all.indexOf(value) === index).join(":");
  const childArgs = [
    process.execPath,
    FANOUT,
    "--manifest",
    options.manifest,
    "--manifest-sha256",
    options.manifestSha256,
    "--output",
    options.output,
  ];
  if (options.resumeFrom) childArgs.push("--resume-from", options.resumeFrom);
  const launchctlArgs = [
    "submit",
    "-l",
    label,
    "-o",
    stdoutPath,
    "-e",
    stderrPath,
    "--",
    "/usr/bin/env",
    `PATH=${pathValue}`,
    `RUNPODCTL_BIN=${runpodctl}`,
    "SSH_BIN=/usr/bin/ssh",
    "SCP_BIN=/usr/bin/scp",
    `PROXYWAR_RUNNER_LEASE_SCRIPT=${RUNNER}`,
    RUNNER,
    "run",
    "mickey",
    preflight.document.run_id,
    "--output",
    options.output,
    "--",
    ...childArgs,
  ];
  return {
    schema_version: 1,
    kind: "inert_launchd_one_shot_plan",
    rendered_only: true,
    executed: false,
    approval_required_before_execution: true,
    foreground_runner_supervisor_preserved: true,
    manifest_sha256: preflight.manifestSha256,
    run_id: preflight.document.run_id,
    output: options.output,
    label,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    command: "/bin/launchctl",
    argv: launchctlArgs,
    warning: "Do not execute without explicit approval; normal execution uses the existing foreground Mickey runner lease.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  render(process.argv.slice(2)).then(
    (plan) => process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`),
    (error) => {
      process.stderr.write(`MICKEY_LAUNCHD_RENDER_FAILED: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    },
  );
}
