import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HRAFN_NEUTRAL_REASON_NAMESPACE,
  chooseNeutralOpponentAction,
  publicNeutralOpponentReason,
} from "../hrafn-neutral-opponent.mjs";
import {
  HRAFN_V5_PARENT_IMAGE_ID,
} from "../scripts/create-hrafn-intent-image-receipt.mjs";
import { publicHrafnReason } from "../hrafn-strategy.mjs";

const frozenSource = execFileSync(
  "git",
  ["show", "0c151570f7e650a32a5705ff71692aa930012097:hrafn-strategy.mjs"],
  { encoding: "utf8" },
);
const frozen = await import(
  `data:text/javascript;base64,${Buffer.from(frozenSource).toString("base64")}`
);

const hold = {
  id: "hold",
  kind: "hold",
  label: "Hold",
  risk: { level: "low" },
};
const spawn = {
  id: "spawn:100",
  kind: "spawn",
  label: "Spawn 100",
  risk: { level: "low" },
};
const expand = {
  id: "expand:terra-nullius:35",
  kind: "attack",
  label: "Expand Terra Nullius 35%",
  metadata: { expansion: true, troopPercent: 35 },
  risk: { level: "low" },
};
const build = {
  id: "build:city",
  kind: "build",
  label: "Build City",
  risk: { level: "low" },
};

function observation(tileShare) {
  return {
    ownState: {
      tileShare,
      troopRatio: 1,
      troops: 500_000,
      gold: 250_000,
      incomingAttacks: 0,
    },
    combat: { incomingAttackPlayerIDs: [] },
    visiblePlayers: [],
  };
}

test("neutral opponent preserves exact-v5 selected action IDs and history", () => {
  const trace = [
    { actions: [spawn, hold], observation: observation(0) },
    { actions: [expand, hold], observation: observation(0.04) },
    { actions: [expand, build, hold], observation: observation(0.12) },
    { actions: [expand, build, hold], observation: observation(0.22) },
  ];
  const expectedHistory = [];
  const actualHistory = [];

  for (const step of trace) {
    const expected = frozen.chooseHrafnAction(
      step.actions,
      step.observation,
      expectedHistory,
      { rv1Enabled: true },
    );
    frozen.recordHrafnDecision(expectedHistory, expected, step.observation);
    const actual = chooseNeutralOpponentAction(
      step.actions,
      step.observation,
      actualHistory,
      { rv1Enabled: true },
    );
    assert.equal(actual.id, expected.id);
  }

  assert.deepEqual(actualHistory, expectedHistory);
});

test("neutral formatter changes only the public reason namespace", () => {
  const chosen = {
    ...expand,
    policyMarker: "rv1",
    intentMarker: "open",
    requestMarker: "q0123456789",
  };
  const original = publicHrafnReason(chosen);
  const neutral = publicNeutralOpponentReason(chosen);

  assert.equal(HRAFN_NEUTRAL_REASON_NAMESPACE, "[0UT] v5:");
  assert.equal(neutral, `${HRAFN_NEUTRAL_REASON_NAMESPACE}${original.slice("[K1Z] r4vn:".length)}`);
  assert.doesNotMatch(neutral, /\[K1Z\]/);
  assert.match(neutral, /^\[0UT\] v5:[a-z0-9]{3}(?::[a-z0-9.]+)?$/);
});

test("neutral opponent Dockerfile derives from the exact v5 parent", () => {
  const dockerfile = readFileSync(
    new URL("../Dockerfile.hrafn-neutral-opponent", import.meta.url),
    "utf8",
  );
  assert.match(dockerfile, new RegExp(`ARG HRAFN_V5_PARENT_IMAGE_ID=${HRAFN_V5_PARENT_IMAGE_ID}`));
  assert.match(dockerfile, /ARG HRAFN_V5_PARENT_IMAGE=hrafn-fylking-v5:0c151570/);
  assert.match(dockerfile, /FROM \$\{HRAFN_V5_PARENT_IMAGE\}/);
  assert.match(dockerfile, /CMD \["node", "\/app\/hrafn-neutral-opponent-player\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /COPY .*hrafn-strategy\.mjs/);
});
