import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  root,
  "scripts",
  "run-standard-rebuild-runpod-four.sh",
);
const source = readFileSync(scriptPath, "utf8");

test("standard rebuild dispatcher is valid shell with four pinned pod identities", () => {
  execFileSync("/bin/bash", ["-n", scriptPath]);
  for (const [id, name] of [
    ["7p0nqjordosvuy", "storm-evidence-32a"],
    ["9u8oumfcvyyhy5", "storm-evidence-32b"],
    ["877itccar33zdp", "storm-lazy-c"],
    ["76stn0v7q81d47", "storm-lazy-d"],
  ]) {
    assert.match(source, new RegExp(id));
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /stop_armed=1[\s\S]*pod start/);
});

test("candidate lanes execute and fetch a real transport qualifier", () => {
  assert.match(
    source,
    /if \[\[ \$role == candidate \]\]; then[\s\S]*--transport-canary[\s\S]*--output-dir '\$home\/qualifier'/,
  );
  assert.match(
    source,
    /\$remote:\$home\/qualifier\/[\s\S]*\$output\/qualifier\//,
  );
  assert.match(source, /execution_class"\) == "transport_canary"/);
  assert.match(source, /transport-canary-candidate/);
});

test("success follows exact stop verification and durable receipt creation", () => {
  for (const field of [
    "pre_start_status",
    "post_stop_status",
    "bundle_sha256",
    "run_id",
    '"owner": "odin"',
    "formal_receipt_sha256",
    "dispatcher-receipt.json",
  ]) {
    assert.match(source, new RegExp(field));
  }
  const terminalStop = source.lastIndexOf("stop_exact_pods");
  const terminalReceipt = source.lastIndexOf("write_dispatch_receipts");
  const terminalSuccess = source.lastIndexOf("STD1_RUNPOD_FOUR_PASSED");
  assert.ok(terminalStop > 0);
  assert.ok(terminalReceipt > terminalStop);
  assert.ok(terminalSuccess > terminalReceipt);
  assert.match(
    source.slice(terminalStop, terminalReceipt),
    /stop_armed=0/,
  );
});
