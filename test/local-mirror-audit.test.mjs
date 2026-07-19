import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("local mirror auditor uses accepted booleans, stable ally IDs, and hold classes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mirror-audit-"));
  const runDirectory = path.join(directory, "proxywar-runs", "fixture");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(path.join(directory, "config.json"), '{"fixture":true}\n');
  writeFileSync(path.join(directory, "replay"), "fixture-replay\n");
  const requestPath = path.join(directory, "request.json");
  writeFileSync(requestPath, '{"request":true}\n');
  writeFileSync(
    path.join(directory, "results.json"),
    JSON.stringify({
      game_id: "TESTGAME",
      winner_slot: 1,
      turn_count: 1000,
      players: [
        { slot: 0, name: "odin free", score: 0, tiles_owned: 10, is_alive: false },
        { slot: 1, name: "katanasan", score: 1, tiles_owned: 90, is_alive: true }
      ]
    }),
  );
  const decisions = [
    {
      username: "katanasan",
      selectedActionKind: "spawn",
      result: { accepted: true },
      auditAfter: { playerID: "ally-local" }
    },
    {
      username: "odin free",
      turnNumber: 500,
      selectedActionKind: "attack",
      selectedLegalActionId: "attack:ally-local:25",
      selectedActionMetadata: { targetID: "ally-local", targetName: "K1Z katanasan" },
      result: { accepted: false },
      reason: "gc2:kp1",
      policyMarkers: ["gc2", "kp1"],
      auditBefore: { playerID: "odin-local" }
    },
    {
      username: "odin free",
      turnNumber: 600,
      selectedActionKind: "hold",
      legalActionIDsByKind: { build: ["build:City:1"], hold: ["hold"] },
      result: { accepted: true },
      reason: "h0d",
      auditBefore: { playerID: "odin-local" }
    },
    {
      username: "odin free",
      turnNumber: 700,
      selectedActionKind: "hold",
      legalActionIDsByKind: {
        donate_troops: ["donate_troops:ally-local"],
        donate_gold: ["donate_gold:ally-local"],
        hold: ["hold"]
      },
      result: { accepted: true },
      reason: "protected-only",
      auditBefore: { playerID: "odin-local" }
    }
  ];
  writeFileSync(
    path.join(runDirectory, "decisions.jsonl"),
    `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`,
  );

  const raw = execFileSync(
    process.execPath,
    [
      "scripts/audit-local-mirrors.mjs",
      "--arm",
      "gc2",
      "--marker",
      "gc2",
      "--run",
      `fixture:0:${directory}`,
      "--request",
      `fixture:${requestPath}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const report = JSON.parse(raw);
  const candidate = report.runs[0].seats.find((seat) => seat.arm === "gc2");
  assert.equal(report.runs[0].request_path, requestPath);
  assert.match(report.runs[0].request_sha256, /^[0-9a-f]{64}$/);
  assert.match(report.runs[0].effective_config_sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.runs[0].k1z_identity_map.katanasan, "ally-local");
  assert.equal(candidate.marker_count, 1);
  assert.equal(candidate.accepted_decisions, 2);
  assert.equal(candidate.rejected_decisions, 1);
  assert.equal(candidate.k1z_harmful_actions, 1);
  assert.equal(candidate.holds, 2);
  assert.equal(candidate.unexplained_holds, 1);
  assert.equal(candidate.hold_details[0].classification, "unexplained");
  assert.equal(candidate.hold_details[1].classification, "protected_k1z_only");
});
