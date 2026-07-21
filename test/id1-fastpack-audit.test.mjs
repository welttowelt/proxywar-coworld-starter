import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const preregPath = path.join(
  repoRoot,
  "experiments/preregister-qd1n-id1-static-fastpack-20260721.json",
);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("ID1 fastpack auditor accepts only a clean two-orientation lift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "id1-fastpack-audit-"));
  const manifestPath = path.join(repoRoot, "experiments", `.tmp-id1-fastpack-${process.pid}.json`);
  const receiptPath = path.join(root, "receipt.json");
  try {
    const manifest = JSON.parse(await readFile(preregPath, "utf8"));
    manifest.receipts.local_audit_path = receiptPath;
    manifest.auditor.sha256 = digest(await readFile(path.join(repoRoot, manifest.auditor.path)));

    for (const job of manifest.jobs) {
      job.output_dir = path.join(root, job.id);
      const runDir = path.join(job.output_dir, "proxywar-runs", "synthetic");
      await mkdir(runDir, { recursive: true });
      const candidate = job.arm === "candidate";
      const decisions = Array.from({ length: 20 }, (_, index) => ({
        username: "K1Z odin free",
        selectedActionKind: "attack",
        selectedLegalActionId: "expand:terra-nullius:10",
        selectedActionMetadata: {
          expansion: true,
          targetID: null,
          targetName: "Terra Nullius",
        },
        result: { accepted: true, reason: "accepted" },
        fallbackUsed: false,
        llmPlannerDegraded: false,
        policyMarker: candidate && job.orientation === "b" && index === 0 ? "id1" : null,
        policyMarkers: candidate && job.orientation === "a" && index === 0 ? ["id1"] : [],
        reason: "pln:atk",
        auditBefore: { tilesOwned: candidate ? 200 + index * 2 : 100 + index },
      }));
      await writeFile(
        path.join(runDir, "decisions.jsonl"),
        `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`,
      );
      await writeFile(
        path.join(runDir, "match-summary.json"),
        `${JSON.stringify({
          finalState: [
            { username: "K1Z odin free", playerID: "odin-runtime" },
            { username: "K1Z Gravity", playerID: "gravity-runtime" },
            { username: "K1Z katanasan", playerID: "katanasan-runtime" },
            { username: "K1Z Hrafn", playerID: "hrafn-runtime" },
          ],
        })}\n`,
      );
      const boundJob = JSON.parse(await readFile(path.join(repoRoot, job.job_path), "utf8"));
      await writeFile(
        path.join(job.output_dir, "config.json"),
        `${JSON.stringify(boundJob.game_config)}\n`,
      );
      await writeFile(path.join(job.output_dir, "results.json"), "{}\n");
      await writeFile(path.join(job.output_dir, "replay"), `${job.id}-replay\n`);
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      [manifest.auditor.path, "--manifest", manifestPath],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.verdict, "PASS_FASTPACK");
    assert.deepEqual(receipt.failures, []);
    assert.equal(receipt.league_mutation, false);
    assert.equal(receipt.jobs.length, 4);
    assert.equal(receipt.comparisons.every((cell) =>
      cell.candidate_auc20_strict_win && cell.candidate_decision_20_strict_win
    ), true);

    const harmfulJob = manifest.jobs.find((job) => job.id === "a-control");
    const decisionsPath = path.join(
      harmfulJob.output_dir,
      "proxywar-runs",
      "synthetic",
      "decisions.jsonl",
    );
    const decisions = String(await readFile(decisionsPath))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    decisions[0] = {
      ...decisions[0],
      selectedActionKind: "warship",
      selectedLegalActionId: "warship:hidden",
      selectedActionMetadata: {},
      result: { accepted: true, submittedIntent: { targetID: "gravity-runtime" } },
    };
    await writeFile(
      decisionsPath,
      `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`,
    );
    const submittedIntentResult = spawnSync(
      process.execPath,
      [manifest.auditor.path, "--manifest", manifestPath],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(submittedIntentResult.status, 1, submittedIntentResult.stderr);
    assert.match(await readFile(receiptPath, "utf8"), /harmful_k1z_actions=1/);

    decisions[0] = {
      ...decisions[0],
      selectedActionKind: "alliance_reject",
      selectedLegalActionId: "alliance_reject:gravity-runtime",
      result: { accepted: true },
    };
    await writeFile(
      decisionsPath,
      `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`,
    );
    const actionIDResult = spawnSync(
      process.execPath,
      [manifest.auditor.path, "--manifest", manifestPath],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(actionIDResult.status, 1, actionIDResult.stderr);
    assert.match(await readFile(receiptPath, "utf8"), /harmful_k1z_actions=1/);
  } finally {
    await rm(manifestPath, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
