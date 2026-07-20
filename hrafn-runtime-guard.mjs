import {
  lstatSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import {
  HRAFN_PLAYER_ID,
  canonicalizeHrafnName,
} from "./hrafn-state.mjs";

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const TOKEN_PATTERN = /^[a-f0-9-]{32,64}$/;

function required(environment, name) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertPlainDirectory(target) {
  if (!path.isAbsolute(target)) {
    throw new Error("HRAFN_RUNTIME_LEASE_DIR must be absolute");
  }
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("HRAFN_RUNTIME_LEASE_DIR must be a real directory");
  }
}

function readPlainFile(directory, name) {
  const target = path.join(directory, name);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`lease ${name} must be a regular file`);
  }
  return readFileSync(target, "utf8").trim();
}

// This validates a caller-provided declaration against regular lease files.
// It does not prove supervisor/child PID liveness, PID start times, receipt
// ownership, or the active Coworld identity. Only the foreground supervisor's
// own status/receipt checks plus an independent live Hrafn identity check can
// authorize a Coworld command.
export function assertHrafnHostRunnerDeclaration(environment = process.env) {
  const playerID = required(environment, "HRAFN_RUNTIME_PLAYER_ID");
  if (playerID !== HRAFN_PLAYER_ID) {
    throw new Error("runtime player identity is not Hrafn");
  }
  const playerName = required(environment, "HRAFN_RUNTIME_PLAYER_NAME");
  if (canonicalizeHrafnName(playerName) !== "hrafn") {
    throw new Error("runtime player name is not Hrafn");
  }
  const lane = required(environment, "HRAFN_RUNTIME_LANE");
  if (lane !== "hrafn") {
    throw new Error("runtime lane is not hrafn");
  }
  const runID = required(environment, "HRAFN_RUNTIME_RUN_ID");
  if (!RUN_ID_PATTERN.test(runID)) {
    throw new Error("HRAFN_RUNTIME_RUN_ID is invalid");
  }
  const token = required(environment, "HRAFN_RUNTIME_LEASE_TOKEN");
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("HRAFN_RUNTIME_LEASE_TOKEN is invalid");
  }
  const leaseDirectory = required(environment, "HRAFN_RUNTIME_LEASE_DIR");
  assertPlainDirectory(leaseDirectory);

  const expected = {
    schema_version: "2",
    owner: lane,
    run_id: runID,
    token,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (readPlainFile(leaseDirectory, name) !== value) {
      throw new Error(`foreground lease ${name} mismatch`);
    }
  }
  readPlainFile(leaseDirectory, "ready");

  return Object.freeze({
    playerID,
    playerName,
    lane,
    runID,
    leaseDirectory,
  });
}

// Backward-compatible export for the focused local tests and any preregistered
// host wrapper. Uploaded policy containers must not call this function because
// the foreground runner lease exists on the host, outside Coworld's container.
export const assertHrafnHostRunnerAuthority =
  assertHrafnHostRunnerDeclaration;
export const assertHrafnRuntimeAuthority =
  assertHrafnHostRunnerDeclaration;
