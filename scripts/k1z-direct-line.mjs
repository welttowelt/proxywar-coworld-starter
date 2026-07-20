#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";

import {
  sealK1ZPacket,
  summarizeK1ZLearning,
  validateK1ZPacketLedger,
} from "../k1z-direct-line.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function readJSON(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function atomicJSON(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, target);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) fail(`${name} is required`);
  return args[index + 1];
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "seal") {
    if (args.length !== 2) fail("usage: seal DRAFT.json OUTPUT.json");
    const sealed = sealK1ZPacket(await readJSON(args[0]));
    await atomicJSON(args[1], sealed);
    process.stdout.write(`${JSON.stringify(sealed)}\n`);
  } else if (command === "validate") {
    if (args.length === 0) fail("usage: validate PACKET.json [PACKET.json ...]");
    const report = validateK1ZPacketLedger(
      await Promise.all(args.map((target) => readJSON(target))),
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.valid ? 0 : 1;
  } else if (command === "learn") {
    if (args.length < 5) {
      fail("usage: learn RECORDS.ndjson --candidate ARM --parent ARM");
    }
    const rows = (await readFile(args[0], "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const report = summarizeK1ZLearning(rows, {
      candidateArm: option(args, "--candidate"),
      parentArm: option(args, "--parent"),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.valid ? 0 : 1;
  } else {
    fail(
      "usage: k1z-direct-line.mjs seal|validate|learn ...",
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
