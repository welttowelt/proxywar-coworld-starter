#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_HRAFN_LEASE_DIRECTORY,
  readActiveHrafnIdentity,
} from "../hrafn-operational-context.mjs";
import { HRAFN_PLAYER_ID } from "../hrafn-state.mjs";
import {
  serializeHrafnIntentPreflightReceipt,
  verifyHrafnIntentRunPreflight,
} from "./preflight-hrafn-intent-run.mjs";

const HRAFN_PLAYER_NAME = "K1Z Hrafn";
const PREFLIGHT_RECEIPT_NAME = "hrafn-intent-preflight-receipt.json";
const OPERATIONAL_RECEIPT_NAME = "hrafn-operational-receipt.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainFileBytes(target) {
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`supervisor input must be a regular file: ${target}`);
  }
  return readFileSync(target);
}

export function parseHrafnSupervisorArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error(
      "usage: --run-id ID --output ABS_DIR --preflight-spec ABS_JSON " +
      "[--lease-dir ABS_DIR] -- COMMAND [ARG ...]",
    );
  }
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let runID = "";
  let outputDirectory = "";
  let preflightSpecPath = "";
  let leaseDirectory = DEFAULT_HRAFN_LEASE_DIRECTORY;
  if (options.length % 2 !== 0) throw new Error("supervisor option requires a value");
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!value) throw new Error(`${key} requires a value`);
    if (key === "--run-id") runID = value;
    else if (key === "--output") outputDirectory = value;
    else if (key === "--lease-dir") leaseDirectory = value;
    else if (key === "--preflight-spec") preflightSpecPath = value;
    else throw new Error(`unknown option ${key}`);
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runID)) throw new Error("run ID is invalid");
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("output directory must be absolute");
  }
  if (!path.isAbsolute(leaseDirectory)) {
    throw new Error("lease directory must be absolute");
  }
  if (!path.isAbsolute(preflightSpecPath)) {
    throw new Error("preflight spec path must be absolute");
  }
  return {
    command,
    leaseDirectory,
    outputDirectory,
    preflightSpecPath,
    runID,
  };
}

function atomicJSON(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function atomicText(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
}

async function waitForLeaseChild(leaseDirectory) {
  const childFile = path.join(leaseDirectory, "child_pid");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const stat = lstatSync(childFile);
      if (stat.isFile() && !stat.isSymbolicLink()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("foreground supervisor did not publish child identity");
}

function exactHrafnIdentity(identity) {
  return identity?.playerID === HRAFN_PLAYER_ID &&
    identity?.playerName === HRAFN_PLAYER_NAME;
}

function operationalBase({
  parsed,
  preflight,
  preflightSpecSHA256,
  preflightReceiptPath,
  preflightReceiptSHA256,
  initialIdentity,
  startedAt,
}) {
  return {
    schema_version: 2,
    record_type: "hrafn_intent_i1_operational_receipt",
    campaign_id: "hrafn-intent-i1",
    lane: "hrafn",
    run_id: parsed.runID,
    started_at: startedAt,
    runner_lease: {
      directory: parsed.leaseDirectory,
      child_pid: preflight.lease.child_pid,
      supervisor_pid: preflight.lease.supervisor_pid,
      acquired_at: preflight.lease.acquired_at,
    },
    initial_identity: {
      player_id: initialIdentity.playerID,
      player_name: initialIdentity.playerName,
    },
    preflight_spec: {
      path: parsed.preflightSpecPath,
      file_sha256: preflightSpecSHA256,
    },
    preflight_receipt: {
      path: preflightReceiptPath,
      file_sha256: preflightReceiptSHA256,
      verified_at: preflight.verified_at,
    },
    command_argv: [...parsed.command],
    output_directory: parsed.outputDirectory,
    bindings: {
      source_commit: preflight.source.commit,
      job: preflight.job,
      campaign_jobs: preflight.campaign_jobs,
      image_receipt: preflight.image_receipt,
      preregistration: preflight.preregistration,
      manifest: preflight.manifest,
      images: preflight.images,
      planner: preflight.planner,
      identity_window: preflight.identity_window,
      lifecycle: preflight.lifecycle,
    },
    state: "running",
  };
}

export async function runHrafnSupervised(argv, runtimeOverrides = {}) {
  const parsed = parseHrafnSupervisorArguments(argv);
  const runtime = {
    processPID: process.pid,
    now: () => new Date(),
    waitForLeaseChild,
    verifyPreflight: verifyHrafnIntentRunPreflight,
    readIdentity: readActiveHrafnIdentity,
    spawn,
    atomicJSON,
    atomicText,
    ...runtimeOverrides,
  };
  await runtime.waitForLeaseChild(parsed.leaseDirectory);

  const preflightSpecBytes = plainFileBytes(parsed.preflightSpecPath);
  let spec;
  try {
    spec = JSON.parse(preflightSpecBytes.toString("utf8"));
  } catch {
    throw new Error("preflight spec is not valid JSON");
  }
  const preflight = await runtime.verifyPreflight(spec, {
    command: parsed.command,
    processPID: runtime.processPID,
  });
  if (preflight?.record_type !== "hrafn_intent_i1_preflight_receipt" ||
    preflight?.run_id !== parsed.runID ||
    preflight?.output?.directory !== parsed.outputDirectory ||
    JSON.stringify(preflight?.argv) !== JSON.stringify(parsed.command)
  ) {
    throw new Error("integrated preflight receipt does not bind this supervisor run");
  }

  const preflightReceiptPath = path.join(
    parsed.outputDirectory,
    PREFLIGHT_RECEIPT_NAME,
  );
  const preflightReceiptWire = serializeHrafnIntentPreflightReceipt(preflight);
  runtime.atomicText(preflightReceiptPath, preflightReceiptWire);
  const preflightReceiptSHA256 = sha256(preflightReceiptWire);
  const initialIdentity = runtime.readIdentity();
  if (!exactHrafnIdentity(initialIdentity) ||
    preflight.identity?.player_id !== initialIdentity.playerID ||
    preflight.identity?.player_name !== initialIdentity.playerName
  ) {
    throw new Error("Hrafn identity changed between preflight and dispatch");
  }

  const receiptPath = path.join(parsed.outputDirectory, OPERATIONAL_RECEIPT_NAME);
  const baseReceipt = operationalBase({
    parsed,
    preflight,
    preflightSpecSHA256: sha256(preflightSpecBytes),
    preflightReceiptPath,
    preflightReceiptSHA256,
    initialIdentity,
    startedAt: runtime.now().toISOString(),
  });
  runtime.atomicJSON(receiptPath, baseReceipt);

  const child = runtime.spawn(parsed.command[0], parsed.command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      HRAFN_RUNTIME_LANE: "hrafn",
      HRAFN_RUNTIME_PLAYER_ID: initialIdentity.playerID,
      HRAFN_RUNTIME_PLAYER_NAME: initialIdentity.playerName,
      HRAFN_RUNTIME_RUN_ID: parsed.runID,
      HRAFN_RUNTIME_LEASE_DIR: parsed.leaseDirectory,
      HRAFN_RUNTIME_PREFLIGHT_SHA256: preflightReceiptSHA256,
    },
  });
  let requestedSignal = null;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      requestedSignal = signal;
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const childResult = await new Promise((resolve) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, error: null });
    });
  });
  for (const [signal, handler] of handlers) process.off(signal, handler);

  let finalIdentity = null;
  let finalIdentityError = null;
  try {
    const observed = runtime.readIdentity();
    if (!exactHrafnIdentity(observed)) {
      throw new Error("active identity is no longer exactly K1Z Hrafn");
    }
    finalIdentity = {
      player_id: observed.playerID,
      player_name: observed.playerName,
    };
  } catch (error) {
    finalIdentityError = error instanceof Error ? error.message : String(error);
  }
  const childExitCode = Number.isInteger(childResult.code) ? childResult.code : null;
  const cleanChildExit = childExitCode === 0 &&
    !childResult.signal && !childResult.error;
  const completed = cleanChildExit && finalIdentity !== null;
  const supervisorExitCode = completed
    ? 0
    : finalIdentity === null || childResult.error
      ? 78
      : childExitCode ?? 128;
  const finalReceipt = {
    ...baseReceipt,
    completed_at: runtime.now().toISOString(),
    child_exit_code: childExitCode,
    child_signal: childResult.signal ?? requestedSignal,
    child_spawn_error: childResult.error?.message ?? null,
    final_identity: finalIdentity,
    final_identity_error: finalIdentityError,
    supervisor_exit_code: supervisorExitCode,
    state: completed ? "completed" : "failed",
  };
  runtime.atomicJSON(receiptPath, finalReceipt);
  return { exitCode: supervisorExitCode, receipt: finalReceipt };
}

async function main(argv) {
  const result = await runHrafnSupervised(argv);
  process.exit(result.exitCode);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `hrafn launcher refused: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(78);
  }
}
