import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HRAFN_INTENT_CELLS } from
  "../scripts/build-hrafn-intent-job.mjs";
import {
  buildHrafnIntentPreflightSpec,
} from "../scripts/build-hrafn-intent-preflight-spec.mjs";
import {
  HRAFN_COWORLD_MANIFEST_SOURCE_PATH,
  materializeHrafnCoworldManifest,
} from "../scripts/materialize-hrafn-coworld-manifest.mjs";

test("preflight-spec builder binds fresh r2 cells and ordered predecessors", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hrafn-spec-"));
  const repo = path.join(root, "repo");
  const artifacts = path.join(root, "artifacts");
  const outputs = path.join(root, "outputs");
  const manifestPath = path.join(root, "manifest.json");
  const identityWindowPath = path.join(root, "identity.json");
  try {
    mkdirSync(path.join(repo, "experiments"), { recursive: true });
    mkdirSync(artifacts);
    mkdirSync(outputs);
    writeFileSync(
      manifestPath,
      materializeHrafnCoworldManifest(
        readFileSync(HRAFN_COWORLD_MANIFEST_SOURCE_PATH),
      ).bytes,
    );
    writeFileSync(identityWindowPath, "{}\n");
    writeFileSync(
      path.join(repo, "experiments", "hrafn-intent-i1-preregistration-20260720.json"),
      "{}\n",
    );
    writeFileSync(path.join(artifacts, "image-receipt.json"), `${JSON.stringify({
      source: { commit: "1".repeat(40) },
    })}\n`);
    for (const cell of HRAFN_INTENT_CELLS) {
      writeFileSync(path.join(artifacts, `${cell.id}.json`), `${cell.id}\n`);
    }
    const first = buildHrafnIntentPreflightSpec({
      repoPath: repo,
      manifestPath,
      artifactDirectory: artifacts,
      identityWindowPath,
      jobID: "pangaea-control",
      outputRoot: outputs,
      leaseDirectory: path.join(root, "runner.lock"),
    });
    assert.equal(first.job_id, "pangaea-control");
    assert.equal(first.campaign_jobs[0].seed, 240723);
    assert.equal(first.campaign_jobs[2].seed, 240724);
    assert.deepEqual(first.predecessor_operational_receipts, []);

    mkdirSync(first.output_directory);
    writeFileSync(
      path.join(first.output_directory, "hrafn-operational-receipt.json"),
      "control receipt\n",
    );
    assert.throws(
      () => buildHrafnIntentPreflightSpec({
        repoPath: repo,
        manifestPath,
        artifactDirectory: artifacts,
        identityWindowPath,
        jobID: "pangaea-control",
        outputRoot: outputs,
        leaseDirectory: path.join(root, "runner.lock"),
      }),
      /active output path already exists/,
    );
    const second = buildHrafnIntentPreflightSpec({
      repoPath: repo,
      manifestPath,
      artifactDirectory: artifacts,
      identityWindowPath,
      jobID: "pangaea-candidate",
      outputRoot: outputs,
      leaseDirectory: path.join(root, "runner.lock"),
    });
    assert.deepEqual(
      second.predecessor_operational_receipts.map((entry) => entry.job_id),
      ["pangaea-control"],
    );
    assert.equal(second.expected_argv.at(-1), "--verify-replay");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight-spec builder rejects an unknown cell", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "hrafn-spec-existing-"));
  try {
    assert.throws(
      () => buildHrafnIntentPreflightSpec({
        repoPath: root,
        manifestPath: path.join(root, "missing"),
        artifactDirectory: root,
        identityWindowPath: path.join(root, "missing"),
        jobID: "unknown",
        outputRoot: root,
        leaseDirectory: path.join(root, "runner.lock"),
      }),
      /unknown HI1 job ID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
