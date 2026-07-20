import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { HRAFN_PLAYER_ID } from "./hrafn-state.mjs";

export const HRAFN_PLAYER_NAME = "K1Z Hrafn";
export const DEFAULT_HRAFN_LEASE_DIRECTORY =
  path.join(homedir(), ".stormforge", "proxywar-operators", "runner.lock");

function realDirectory(target, label) {
  if (!path.isAbsolute(target)) {
    throw new Error(`${label} must be an absolute directory`);
  }
  try {
    const canonical = realpathSync(target);
    if (!lstatSync(canonical).isDirectory()) {
      throw new Error("not a directory");
    }
    return canonical;
  } catch {
    throw new Error(`${label} must be an absolute real directory`);
  }
}

export function hrafnCoworldEnvironment(environment = process.env) {
  const requestedHome = String(environment.HRAFN_SOFTMAX_HOME ?? "").trim();
  if (!requestedHome) {
    throw new Error(
      "HRAFN_SOFTMAX_HOME is required for Hrafn Coworld identity probes",
    );
  }
  if (!path.isAbsolute(requestedHome)) {
    throw new Error(
      "HRAFN_SOFTMAX_HOME must be an absolute canonical directory",
    );
  }
  let isolatedHome;
  try {
    const stat = lstatSync(requestedHome);
    isolatedHome = realpathSync(requestedHome);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      requestedHome !== isolatedHome
    ) {
      throw new Error("not canonical");
    }
  } catch {
    throw new Error(
      "HRAFN_SOFTMAX_HOME must be an absolute canonical directory",
    );
  }
  const normalHome = realDirectory(
    String(environment.HOME ?? "").trim() || homedir(),
    "normal HOME",
  );
  if (isolatedHome === normalHome) {
    throw new Error(
      "HRAFN_SOFTMAX_HOME must be distinct from the normal HOME",
    );
  }
  return Object.freeze({
    ...environment,
    HOME: isolatedHome,
  });
}

function plainFile(directory, name) {
  const target = path.join(directory, name);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`lease ${name} must be a regular file`);
  }
  return readFileSync(target, "utf8").trim();
}

function positivePID(value, field) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`lease ${field} is invalid`);
  }
  return Number(value);
}

export function normalizeProcessStart(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function validateHrafnLeaseSnapshot({
  leaseDirectory,
  runID,
  outputDirectory,
  processPID,
  processStart,
  supervisorStart,
}) {
  if (!path.isAbsolute(leaseDirectory)) {
    throw new Error("lease directory must be absolute");
  }
  const leaseStat = lstatSync(leaseDirectory);
  if (!leaseStat.isDirectory() || leaseStat.isSymbolicLink()) {
    throw new Error("lease directory must be a real directory");
  }
  if (plainFile(leaseDirectory, "schema_version") !== "2") {
    throw new Error("foreground lease schema mismatch");
  }
  if (plainFile(leaseDirectory, "owner") !== "hrafn") {
    throw new Error("foreground lease owner is not hrafn");
  }
  if (plainFile(leaseDirectory, "run_id") !== runID) {
    throw new Error("foreground lease run ID mismatch");
  }
  plainFile(leaseDirectory, "ready");

  const childPID = positivePID(
    plainFile(leaseDirectory, "child_pid"),
    "child_pid",
  );
  if (childPID !== processPID) {
    throw new Error("launcher is not the recorded foreground child");
  }
  const recordedChildStart = normalizeProcessStart(
    plainFile(leaseDirectory, "child_started_at"),
  );
  if (
    !recordedChildStart ||
    recordedChildStart !== normalizeProcessStart(processStart(childPID))
  ) {
    throw new Error("foreground child start signature mismatch");
  }

  const supervisorPID = positivePID(
    plainFile(leaseDirectory, "supervisor_pid"),
    "supervisor_pid",
  );
  const recordedSupervisorStart = normalizeProcessStart(
    plainFile(leaseDirectory, "supervisor_started_at"),
  );
  if (
    !recordedSupervisorStart ||
    recordedSupervisorStart !==
      normalizeProcessStart(supervisorStart(supervisorPID))
  ) {
    throw new Error("foreground supervisor start signature mismatch");
  }

  const canonicalOutput = realpathSync(outputDirectory);
  const outputs = readFileSync(path.join(leaseDirectory, "outputs"), "utf8")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => realpathSync(value));
  if (!outputs.includes(canonicalOutput)) {
    throw new Error("output directory is not claimed by this lease");
  }

  return Object.freeze({
    childPID,
    supervisorPID,
    runID,
    outputDirectory: canonicalOutput,
    acquiredAt: plainFile(leaseDirectory, "acquired_at"),
  });
}

export function assertActiveHrafnPlayers(players) {
  if (!Array.isArray(players)) throw new Error("player list must be an array");
  const active = players.filter((player) => player?.active === true);
  if (
    active.length !== 1 ||
    active[0]?.id !== HRAFN_PLAYER_ID ||
    active[0]?.name !== HRAFN_PLAYER_NAME
  ) {
    throw new Error("active Coworld identity is not exactly K1Z Hrafn");
  }
  return Object.freeze({
    playerID: active[0].id,
    playerName: active[0].name,
  });
}

export function currentProcessStart(pid) {
  return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
  });
}

export function readActiveHrafnIdentity() {
  const raw = execFileSync(
    "uvx",
    ["--from", "coworld==0.1.28", "coworld", "player", "list", "--json"],
    {
      encoding: "utf8",
      env: hrafnCoworldEnvironment(),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  return assertActiveHrafnPlayers(JSON.parse(raw));
}
