#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { preflightManifest } from "./run-mickey-cpu-fanout.mjs";
import { ensureReaperLedger } from "./runpod-exact-id-reaper.mjs";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const SELF_PATH = fileURLToPath(import.meta.url);
const EXPECTED_HOME = "/Users/olifreuler";
const STAGING_PREFIX = ".staging-";

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

function plistBody(manifest, { allowTemporaryPathsForTest = false } = {}) {
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
  for (const value of args) {
    if (value.startsWith("/private/tmp/") || value.startsWith("/tmp/")) {
      if (!allowTemporaryPathsForTest) {
        throw new Error("running reaper ProgramArguments may not depend on temporary paths");
      }
    }
  }
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
    <key>HOME</key>
    <string>${EXPECTED_HOME}</string>
    <key>PATH</key>
    <string>${xml(pathValue)}</string>
  </dict>
  <key>Umask</key>
  <integer>63</integer>
  <key>WorkingDirectory</key>
  <string>${xml(manifest.cleanup_watchdog.state_root)}</string>
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
  await writeStagedFile(temporary, body, 0o600);
  try {
    await link(temporary, filePath);
    await fsyncDirectory(path.dirname(filePath));
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function load(options, { requirePersistentServiceArtifacts = false } = {}) {
  const manifestPath = absolute(required(options, "--manifest"), "--manifest");
  const manifestSha256 = required(options, "--manifest-sha256");
  if (!SHA256.test(manifestSha256)) throw new Error("--manifest-sha256 is invalid");
  return preflightManifest(
    manifestPath,
    manifestSha256,
    { requirePersistentServiceArtifacts },
  );
}

async function render(options) {
  const preflight = await load(options);
  const plistSourcePath = absolute(required(options, "--plist"), "--plist");
  const planPath = absolute(required(options, "--plan"), "--plan");
  const body = plistBody(preflight.document);
  await writeExclusive(plistSourcePath, body);
  const plistSha256 = await sha256File(plistSourcePath);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("cannot determine launchd GUI UID");
  const domain = `gui/${uid}`;
  const target = `${domain}/${preflight.document.cleanup_watchdog.launchd_label}`;
  const installArgv = [
    preflight.document.cleanup_watchdog.node_runtime.path,
    SELF_PATH,
    "install",
    "--manifest", preflight.manifestPath,
    "--manifest-sha256", preflight.manifestSha256,
    "--plist-source", plistSourcePath,
  ];
  const attestationArgv = [
    preflight.document.cleanup_watchdog.node_runtime.path,
    SELF_PATH,
    "attest",
    "--manifest", preflight.manifestPath,
    "--manifest-sha256", preflight.manifestSha256,
    "--plist", preflight.document.cleanup_watchdog.plist_path,
    "--receipt", preflight.document.cleanup_watchdog.service_receipt_path,
  ];
  const heartbeatArgv = [
    preflight.document.cleanup_watchdog.node_runtime.path,
    SELF_PATH,
    "wait-heartbeat",
    "--manifest", preflight.manifestPath,
    "--manifest-sha256", preflight.manifestSha256,
  ];
  const plan = {
    schema_version: 1,
    kind: "mickey_runpod_reaper_launchd_install_plan",
    installed: false,
    invokes_runpod_api: false,
    manifest_sha256: preflight.manifestSha256,
    plist_source_path: plistSourcePath,
    plist_path: preflight.document.cleanup_watchdog.plist_path,
    plist_sha256: plistSha256,
    durable_state_root: preflight.document.cleanup_watchdog.state_root,
    durable_installation_directory:
      preflight.document.cleanup_watchdog.installation_directory,
    durable_reaper_path: preflight.document.cleanup_watchdog.script.path,
    durable_runpodctl_path: preflight.document.runpodctl.path,
    ledger_path: preflight.document.cleanup_watchdog.ledger_path,
    heartbeat_path: preflight.document.cleanup_watchdog.heartbeat_path,
    launchd_label: preflight.document.cleanup_watchdog.launchd_label,
    launchd_domain: domain,
    exact_commands: [
      installArgv,
      ["/bin/launchctl", "bootstrap", domain, preflight.document.cleanup_watchdog.plist_path],
      ["/bin/launchctl", "kickstart", "-k", target],
      attestationArgv,
      heartbeatArgv,
    ],
    install_contract: {
      directory_mode: "0700",
      script_mode: "0600",
      binary_mode: "0700",
      plist_mode: "0600",
      ledger_and_receipt_mode: "0600",
      overwrite_allowed: false,
      symlinks_allowed: false,
      provider_calls_during_render_or_install: 0,
      launchctl_calls_during_render_or_install: 0,
    },
    warning: "render only; no artifacts were installed and no service was started",
  };
  await writeExclusive(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function currentUid() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("cannot determine installer UID");
  return uid;
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    await handle.close();
  }
}

async function secureDirectory(directory, { mode = 0o700, create = true, exactMode = true } = {}) {
  if (create) {
    await mkdir(directory, { mode }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
  }
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    await realpath(directory) !== directory ||
    info.uid !== currentUid() ||
    (exactMode ? (info.mode & 0o777) !== mode : (info.mode & 0o022) !== 0)
  ) {
    throw new Error(`durable directory is unsafe: ${directory}`);
  }
  return info;
}

async function secureFile(filePath, { sha256 = null, mode, executable = false } = {}) {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    await realpath(filePath) !== filePath ||
    info.uid !== currentUid() ||
    (info.mode & 0o777) !== mode ||
    (executable && (info.mode & 0o111) === 0)
  ) {
    throw new Error(`durable file is unsafe: ${filePath}`);
  }
  if (sha256 !== null && await sha256File(filePath) !== sha256) {
    throw new Error(`durable file hash drift: ${filePath}`);
  }
  return info;
}

async function secureSource(filePath, sha256) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(filePath) !== filePath) {
    throw new Error(`installation source is unsafe: ${filePath}`);
  }
  if (await sha256File(filePath) !== sha256) {
    throw new Error(`installation source hash drift: ${filePath}`);
  }
  return info;
}

async function writeStagedFile(filePath, body, mode) {
  const handle = await open(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(body);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureSecureEmptyFile(filePath) {
  let info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) {
    await writeStagedFile(filePath, Buffer.alloc(0), 0o600);
    info = await lstat(filePath);
  }
  await secureFile(filePath, { mode: 0o600 });
  return info;
}

async function assertOptionalSecureStateFile(filePath) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (info) await secureFile(filePath, { mode: 0o600 });
}

async function installVersionedArtifacts(manifest) {
  const watchdog = manifest.cleanup_watchdog;
  await secureSource(watchdog.script.install_source_path, watchdog.script.sha256);
  const runpodctlSourceInfo = await secureSource(
    manifest.runpodctl.install_source_path,
    manifest.runpodctl.sha256,
  );
  if ((runpodctlSourceInfo.mode & 0o111) === 0) {
    throw new Error("runpodctl installation source is not executable");
  }

  await secureDirectory(watchdog.state_root);
  await secureDirectory(watchdog.bin_root);
  await secureDirectory(watchdog.installations_root);
  const installed = await lstat(watchdog.installation_directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!installed) {
    const staging = path.join(watchdog.installations_root, `${STAGING_PREFIX}${randomUUID()}`);
    await secureDirectory(staging);
    try {
      await writeStagedFile(
        path.join(staging, path.basename(watchdog.script.path)),
        await readFile(watchdog.script.install_source_path),
        0o600,
      );
      await writeStagedFile(
        path.join(staging, path.basename(manifest.runpodctl.path)),
        await readFile(manifest.runpodctl.install_source_path),
        0o700,
      );
      await secureFile(path.join(staging, path.basename(watchdog.script.path)), {
        sha256: watchdog.script.sha256,
        mode: 0o600,
      });
      await secureFile(path.join(staging, path.basename(manifest.runpodctl.path)), {
        sha256: manifest.runpodctl.sha256,
        mode: 0o700,
        executable: true,
      });
      await fsyncDirectory(staging);
      await execFileAsync("/bin/mv", ["-n", staging, watchdog.installation_directory]);
      if (await lstat(staging).catch(() => null)) {
        throw new Error("durable installation destination appeared concurrently; refusing overwrite");
      }
      await fsyncDirectory(watchdog.installations_root);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  await secureDirectory(watchdog.installation_directory, { create: false });
  await secureFile(watchdog.script.path, { sha256: watchdog.script.sha256, mode: 0o600 });
  await secureFile(manifest.runpodctl.path, {
    sha256: manifest.runpodctl.sha256,
    mode: 0o700,
    executable: true,
  });
}

export function renderReaperPlistForTest(manifest) {
  if (manifest?.run_id !== "mickey-fanout-unit") {
    throw new Error("temporary plist rendering is restricted to the unit fixture");
  }
  return plistBody(manifest, { allowTemporaryPathsForTest: true });
}

export async function stageDurableReaperInstallation({
  manifest,
  manifestSha256,
  plistSourcePath,
  allowTemporaryPathsForTest = false,
}) {
  if (!SHA256.test(manifestSha256)) throw new Error("installation manifest SHA-256 is invalid");
  absolute(plistSourcePath, "plist source");
  if (
    allowTemporaryPathsForTest &&
    (
      manifest?.run_id !== "mickey-fanout-unit" ||
      !manifest.cleanup_watchdog.state_root.startsWith(`${path.resolve("/private/tmp")}/`)
    )
  ) {
    throw new Error("temporary durable staging is restricted to the unit fixture under /private/tmp");
  }
  const expectedPlist = plistBody(manifest, { allowTemporaryPathsForTest });
  await secureSource(plistSourcePath, createHash("sha256").update(expectedPlist).digest("hex"));
  if (/api.?key|authorization|bearer|MICKEY_CONTROL_PLANE_NONCE|--env(?:-stdin)?/i.test(expectedPlist)) {
    throw new Error("durable reaper plist contains a forbidden credential or nonce channel");
  }

  await secureDirectory(manifest.cleanup_watchdog.state_root);
  const ledger = await ensureReaperLedger({ ledgerPath: manifest.cleanup_watchdog.ledger_path });
  if (ledger.records.some((record) => record.state === "pending" || record.state === "active")) {
    throw new Error("durable install refuses an unresolved pending or active cleanup record");
  }
  await secureFile(manifest.cleanup_watchdog.ledger_path, { mode: 0o600 });
  await installVersionedArtifacts(manifest);

  const launchAgents = path.dirname(manifest.cleanup_watchdog.plist_path);
  await secureDirectory(launchAgents, { create: true, exactMode: false });
  const existingPlist = await lstat(manifest.cleanup_watchdog.plist_path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!existingPlist) {
    await writeExclusive(manifest.cleanup_watchdog.plist_path, expectedPlist);
    await chmod(manifest.cleanup_watchdog.plist_path, 0o600);
    await fsyncDirectory(launchAgents);
  }
  await secureFile(manifest.cleanup_watchdog.plist_path, {
    sha256: createHash("sha256").update(expectedPlist).digest("hex"),
    mode: 0o600,
  });

  await ensureSecureEmptyFile(path.join(manifest.cleanup_watchdog.state_root, "runpod-reaper.stdout.log"));
  await ensureSecureEmptyFile(path.join(manifest.cleanup_watchdog.state_root, "runpod-reaper.stderr.log"));
  await assertOptionalSecureStateFile(manifest.cleanup_watchdog.heartbeat_path);
  await assertOptionalSecureStateFile(manifest.cleanup_watchdog.service_receipt_path);
  return {
    schema_version: 1,
    kind: "mickey_runpod_reaper_durable_installation",
    installed: true,
    provider_calls: 0,
    launchctl_calls: 0,
    manifest_sha256: manifestSha256,
    installation_id: manifest.cleanup_watchdog.installation_id,
    installation_directory: manifest.cleanup_watchdog.installation_directory,
    reaper_path: manifest.cleanup_watchdog.script.path,
    reaper_sha256: manifest.cleanup_watchdog.script.sha256,
    runpodctl_path: manifest.runpodctl.path,
    runpodctl_sha256: manifest.runpodctl.sha256,
    plist_path: manifest.cleanup_watchdog.plist_path,
    plist_sha256: await sha256File(manifest.cleanup_watchdog.plist_path),
    ledger_path: manifest.cleanup_watchdog.ledger_path,
  };
}

async function install(options) {
  const preflight = await load(options);
  const plistSourcePath = absolute(required(options, "--plist-source"), "--plist-source");
  return stageDurableReaperInstallation({
    manifest: preflight.document,
    manifestSha256: preflight.manifestSha256,
    plistSourcePath,
  });
}

async function attest(options) {
  const preflight = await load(options, { requirePersistentServiceArtifacts: true });
  const plistPath = absolute(required(options, "--plist"), "--plist");
  const receiptPath = absolute(required(options, "--receipt"), "--receipt");
  if (receiptPath !== preflight.document.cleanup_watchdog.service_receipt_path) {
    throw new Error("--receipt must equal the manifest-pinned service receipt path");
  }
  if (plistPath !== preflight.document.cleanup_watchdog.plist_path) {
    throw new Error("--plist must equal the manifest-pinned persistent LaunchAgent path");
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
  const pidMatch = service.stdout.match(/(?:^|\n)\s*pid\s*=\s*([1-9][0-9]*)\s*(?:\n|$)/);
  const servicePid = Number(pidMatch[1]);
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
    pid: servicePid,
    attested_at: new Date().toISOString(),
  };
  await writeExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function waitHeartbeat(options) {
  const preflight = await load(options, { requirePersistentServiceArtifacts: true });
  const watchdog = preflight.document.cleanup_watchdog;
  const receipt = JSON.parse(await readFile(watchdog.service_receipt_path, "utf8"));
  if (
    receipt.manifest_sha256 !== preflight.manifestSha256 ||
    receipt.pid < 1 ||
    receipt.plist_path !== watchdog.plist_path ||
    receipt.ledger_path !== watchdog.ledger_path ||
    receipt.heartbeat_path !== watchdog.heartbeat_path
  ) {
    throw new Error("reaper service receipt does not bind the durable heartbeat wait");
  }
  const target = `${receipt.launchd_domain}/${receipt.launchd_label}`;
  const deadline = Date.now() + (watchdog.heartbeat_max_age_seconds + 30) * 1_000;
  while (Date.now() < deadline) {
    const service = await execFileAsync("/bin/launchctl", ["print", target], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const pidMatch = service.stdout.match(/(?:^|\n)\s*pid\s*=\s*([1-9][0-9]*)\s*(?:\n|$)/);
    if (pidMatch && Number(pidMatch[1]) === receipt.pid) {
      const heartbeat = await readFile(watchdog.heartbeat_path, "utf8")
        .then((body) => JSON.parse(body))
        .catch(() => null);
      const age = heartbeat ? Date.now() - Date.parse(heartbeat.probed_at) : Infinity;
      if (
        heartbeat?.status === "provider_list_succeeded" &&
        heartbeat.pid === receipt.pid &&
        heartbeat.ledger_path === watchdog.ledger_path &&
        heartbeat.runpodctl_path === preflight.document.runpodctl.path &&
        heartbeat.identifiers_recorded === false &&
        heartbeat.credentials_recorded === false &&
        Number.isSafeInteger(heartbeat.pod_count) &&
        heartbeat.pod_count >= 0 &&
        Number.isFinite(age) &&
        age >= -5_000 &&
        age <= watchdog.heartbeat_max_age_seconds * 1_000
      ) {
        return {
          status: "ready",
          provider_probe: "provider_list_succeeded",
          pid: receipt.pid,
          pod_count: heartbeat.pod_count,
          age_ms: age,
          identifiers_recorded: false,
          credentials_recorded: false,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("durable reaper did not produce a fresh service-PID provider heartbeat");
}

export async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "render") return render(options);
  if (command === "install") return install(options);
  if (command === "attest") return attest(options);
  if (command === "wait-heartbeat") return waitHeartbeat(options);
  throw new Error("command must be render, install, attest, or wait-heartbeat");
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
