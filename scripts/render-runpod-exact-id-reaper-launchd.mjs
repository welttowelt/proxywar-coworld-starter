#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { preflightManifest } from "./run-mickey-cpu-fanout.mjs";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const SELF_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`unknown or incomplete option: ${key}`);
    if (options.has(key)) throw new Error(`duplicate option: ${key}`);
    options.set(key, value);
  }
  return { command, options };
}

function required(options, key) {
  const value = options.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function absolute(value, label) {
  if (!path.isAbsolute(value) || value.includes("\0") || value.includes("\n")) {
    throw new Error(`${label} must be an absolute safe path`);
  }
  return value;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistBody(manifest) {
  const watchdog = manifest.cleanup_watchdog;
  const logRoot = path.dirname(watchdog.ledger_path);
  const args = [
    watchdog.node_runtime.path,
    watchdog.script.path,
    "poll",
    "--ledger",
    watchdog.ledger_path,
    "--runpodctl",
    manifest.runpodctl.path,
    "--interval-seconds",
    String(watchdog.poll_interval_seconds),
    "--heartbeat",
    watchdog.heartbeat_path,
  ];
  const array = args.map((arg) => `      <string>${xml(arg)}</string>`).join("\n");
  const pathValue = [
    path.dirname(manifest.runpodctl.path),
    path.dirname(watchdog.node_runtime.path),
    "/usr/bin",
    "/bin",
  ].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(watchdog.launchd_label)}</string>
  <key>ProgramArguments</key>
  <array>
${array}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(pathValue)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(path.join(logRoot, "runpod-reaper.stdout.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(logRoot, "runpod-reaper.stderr.log"))}</string>
</dict>
</plist>
`;
}

async function writeExclusive(filePath, body) {
  absolute(filePath, "output path");
  const temporary = `${filePath}.part-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
  await rename(temporary, filePath);
}

async function load(options) {
  const manifestPath = absolute(required(options, "--manifest"), "--manifest");
  const manifestSha256 = required(options, "--manifest-sha256");
  if (!SHA256.test(manifestSha256)) throw new Error("--manifest-sha256 is invalid");
  return preflightManifest(manifestPath, manifestSha256);
}

async function render(options) {
  const preflight = await load(options);
  const plistPath = absolute(required(options, "--plist"), "--plist");
  const planPath = absolute(required(options, "--plan"), "--plan");
  const body = plistBody(preflight.document);
  await writeExclusive(plistPath, body);
  const plistSha256 = await sha256File(plistPath);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("cannot determine launchd GUI UID");
  const domain = `gui/${uid}`;
  const target = `${domain}/${preflight.document.cleanup_watchdog.launchd_label}`;
  const attestationArgv = [
    preflight.document.cleanup_watchdog.node_runtime.path,
    SELF_PATH,
    "attest",
    "--manifest", preflight.manifestPath,
    "--manifest-sha256", preflight.manifestSha256,
    "--plist", plistPath,
    "--receipt", preflight.document.cleanup_watchdog.service_receipt_path,
  ];
  const plan = {
    schema_version: 1,
    kind: "mickey_runpod_reaper_launchd_install_plan",
    installed: false,
    invokes_runpod_api: false,
    manifest_sha256: preflight.manifestSha256,
    plist_path: plistPath,
    plist_sha256: plistSha256,
    ledger_path: preflight.document.cleanup_watchdog.ledger_path,
    heartbeat_path: preflight.document.cleanup_watchdog.heartbeat_path,
    launchd_label: preflight.document.cleanup_watchdog.launchd_label,
    launchd_domain: domain,
    exact_commands: [
      ["/bin/launchctl", "bootstrap", domain, plistPath],
      ["/bin/launchctl", "kickstart", "-k", target],
      attestationArgv,
    ],
    warning: "render only; no service was installed or started",
  };
  await writeExclusive(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

async function attest(options) {
  const preflight = await load(options);
  const plistPath = absolute(required(options, "--plist"), "--plist");
  const receiptPath = absolute(required(options, "--receipt"), "--receipt");
  if (receiptPath !== preflight.document.cleanup_watchdog.service_receipt_path) {
    throw new Error("--receipt must equal the manifest-pinned service receipt path");
  }
  const info = await lstat(plistPath);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(plistPath) !== plistPath) {
    throw new Error("reaper plist is unsafe");
  }
  if (await readFile(plistPath, "utf8") !== plistBody(preflight.document)) {
    throw new Error("reaper plist differs from the exact manifest-derived service");
  }
  const plistSha256 = await sha256File(plistPath);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("cannot determine launchd GUI UID");
  const domain = `gui/${uid}`;
  const target = `${domain}/${preflight.document.cleanup_watchdog.launchd_label}`;
  let service;
  try {
    service = await execFileAsync("/bin/launchctl", ["print", target], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`reaper LaunchAgent is not inspectable: ${error.message}`);
  }
  if (
    !/(?:^|\n)\s*state\s*=\s*running\s*(?:\n|$)/.test(service.stdout) ||
    !/(?:^|\n)\s*pid\s*=\s*[1-9][0-9]*\s*(?:\n|$)/.test(service.stdout)
  ) {
    throw new Error("reaper LaunchAgent is not running");
  }
  const nodeInfo = await stat(preflight.document.cleanup_watchdog.node_runtime.path);
  if ((nodeInfo.mode & 0o111) === 0) throw new Error("reaper Node runtime is not executable");
  const receipt = {
    schema_version: 1,
    kind: "mickey_runpod_exact_id_reaper_service",
    status: "active",
    manifest_sha256: preflight.manifestSha256,
    launchd_label: preflight.document.cleanup_watchdog.launchd_label,
    launchd_domain: domain,
    plist_path: plistPath,
    plist_sha256: plistSha256,
    ledger_path: preflight.document.cleanup_watchdog.ledger_path,
    heartbeat_path: preflight.document.cleanup_watchdog.heartbeat_path,
    runpodctl_sha256: preflight.document.runpodctl.sha256,
    reaper_sha256: preflight.document.cleanup_watchdog.script.sha256,
    node_path: preflight.document.cleanup_watchdog.node_runtime.path,
    node_sha256: preflight.document.cleanup_watchdog.node_runtime.sha256,
    attested_at: new Date().toISOString(),
  };
  await writeExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "render") return render(options);
  if (command === "attest") return attest(options);
  throw new Error("command must be render or attest");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`MICKEY_REAPER_LAUNCHD_FAILED: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
