import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function build(order) {
  const directory = mkdtempSync(path.join(tmpdir(), "hrafn-c3-job-"));
  const manifestPath = path.join(directory, "manifest.json");
  const outputPath = path.join(directory, "job.json");
  const manifest = {
    game: { name: "proxywar" },
    variants: [{
      id: "pangaea-2p",
      game_config: {
        map: "Pangaea",
        players: [{ name: "slot-0" }, { name: "slot-1" }],
        num_agents: 2,
        max_decision_steps: 300,
      },
    }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [
    "scripts/build-hrafn-matched-job.mjs",
    manifestPath,
    outputPath,
    "pangaea-2p",
    "hrafn-c3:exact",
    "hrafn-c2:exact",
    order,
    "chassis-control",
    "240720",
  ], { cwd: process.cwd(), encoding: "utf8" });
  return {
    result,
    job: result.status === 0
      ? JSON.parse(readFileSync(outputPath, "utf8"))
      : null,
  };
}

test("C3 crossover fixes names and seed while swapping only exact images", () => {
  const first = build("candidate-first");
  const second = build("control-first");
  assert.equal(first.result.status, 0, first.result.stderr);
  assert.equal(second.result.status, 0, second.result.stderr);

  for (const { job } of [first, second]) {
    assert.equal(job.game_config.seed, 240720);
    assert.equal(job.game_config.tokens, null);
    assert.deepEqual(job.game_config.players, [
      { name: "K1Z Hrafn" },
      { name: "Hrafn comparison" },
    ]);
    assert.deepEqual(
      job.players.map((player) => player.run),
      [
        ["node", "/app/hrafn-chassis-player.mjs"],
        ["node", "/app/hrafn-chassis-player.mjs"],
      ],
    );
  }
  assert.deepEqual(
    first.job.players.map((player) => player.image),
    ["hrafn-c3:exact", "hrafn-c2:exact"],
  );
  assert.deepEqual(
    second.job.players.map((player) => player.image),
    ["hrafn-c2:exact", "hrafn-c3:exact"],
  );
});
