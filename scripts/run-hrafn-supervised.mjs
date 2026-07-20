#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  lstatSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  DEFAULT_HRAFN_LEASE_DIRECTORY,
  currentProcessStart,
  readActiveHrafnIdentity,
  validateHrafnLeaseSnapshot,
} from "../hrafn-operational-context.mjs";

function fail(message) {
  process.stderr.write(`hrafn launcher refused: ${message}\n`);
  process.exit(78);
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("usage: --run-id ID --output ABS_DIR -- COMMAND [ARG ...]");
  }
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let runID = "";
  let outputDirectory = "";
  let leaseDirectory = DEFAULT_HRAFN_LEASE_DIRECTORY;
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!value) throw new Error(`${key} requires a value`);
    if (key === "--run-id") runID = value;
    else if (key === "--output") outputDirectory = value;
    else if (key === "--lease-dir") leaseDirectory = value;
    else throw new Error(`unknown option ${key}`);
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runID)) {
    throw new Error("run ID is invalid");
  }
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("output directory must be absolute");
  }
  return { command, leaseDirectory, outputDirectory, runID };
}

function atomicJSON(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
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

let parsed;
try {
  parsed = parseArguments(process.argv.slice(2));
  await waitForLeaseChild(parsed.leaseDirectory);
  const lease = validateHrafnLeaseSnapshot({
    ...parsed,
    processPID: process.pid,
    processStart: currentProcessStart,
    supervisorStart: currentProcessStart,
  });
  const identity = readActiveHrafnIdentity();
  const receiptPath = path.join(
    lease.outputDirectory,
    "hrafn-operational-receipt.json",
  );
  const startedAt = new Date().toISOString();
  const baseReceipt = {
    schema_version: 1,
    lane: "hrafn",
    run_id: lease.runID,
    player_id: identity.playerID,
    player_name: identity.playerName,
    supervisor_pid: lease.supervisorPID,
    launcher_pid: lease.childPID,
    lease_acquired_at: lease.acquiredAt,
    started_at: startedAt,
    command: path.basename(parsed.command[0]),
    state: "running",
  };
  atomicJSON(receiptPath, baseReceipt);

  const child = spawn(parsed.command[0], parsed.command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      HRAFN_RUNTIME_LANE: "hrafn",
      HRAFN_RUNTIME_PLAYER_ID: identity.playerID,
      HRAFN_RUNTIME_PLAYER_NAME: identity.playerName,
      HRAFN_RUNTIME_RUN_ID: lease.runID,
      HRAFN_RUNTIME_LEASE_DIR: parsed.leaseDirectory,
    },
  });
  let requestedSignal = null;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      requestedSignal = signal;
      if (!child.killed) child.kill(signal);
    });
  }
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const finalIdentity = readActiveHrafnIdentity();
  const exitCode = Number.isInteger(result.code) ? result.code : 128;
  atomicJSON(receiptPath, {
    ...baseReceipt,
    completed_at: new Date().toISOString(),
    final_player_id: finalIdentity.playerID,
    final_player_name: finalIdentity.playerName,
    exit_code: exitCode,
    signal: result.signal ?? requestedSignal,
    state: exitCode === 0 && !result.signal ? "completed" : "failed",
  });
  process.exit(exitCode);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
