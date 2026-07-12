import assert from "node:assert/strict";
import test from "node:test";

import {
  applyParityPulse,
  PARITY_PULSE_MARKER,
} from "../scripts/keystone-parity-pulse.mjs";

function fixture({
  ratio = 0.95,
  gap = 0.1,
  incoming = [],
  recentDecisions = [],
  selectedActionID = "boat:neutral:16",
} = {}) {
  const ownTileShare = 0.27;
  const leaderTileShare = ownTileShare + gap;
  const input = {
    observation: {
      alivePlayerCount: 3,
      ownState: {
        isAlive: true,
        tileShare: ownTileShare,
      },
      visiblePlayers: [
        {
          playerID: "auri",
          name: "Auri",
          isAlive: true,
          isTeammate: false,
          isAllied: false,
          canAttack: true,
          tileShare: leaderTileShare,
          relativeTroopRatio: ratio,
        },
        {
          playerID: "james",
          name: "James",
          isAlive: true,
          isTeammate: false,
          isAllied: true,
          canAttack: false,
          tileShare: 1 - ownTileShare - leaderTileShare,
          relativeTroopRatio: 1.1,
        },
      ],
      combat: { incomingAttackPlayerIDs: incoming },
      recentDecisions,
    },
    legalActions: [
      {
        id: selectedActionID,
        kind: selectedActionID.startsWith("attack:") ? "attack" : "boat",
        risk: { level: "low" },
        metadata: selectedActionID.startsWith("attack:")
          ? { targetID: "james", troopPercent: 25, expansion: false }
          : { expansion: true },
      },
      {
        id: "attack:auri:10",
        kind: "attack",
        risk: { level: "medium" },
        metadata: {
          targetID: "auri",
          targetName: "Auri",
          troopPercent: 10,
          expansion: false,
        },
      },
      {
        id: "attack:auri:25",
        kind: "attack",
        risk: { level: "medium" },
        metadata: {
          targetID: "auri",
          targetName: "Auri",
          troopPercent: 25,
          expansion: false,
        },
      },
    ],
  };
  const decision = {
    actionID: selectedActionID,
    actionIDs: [selectedActionID, "hold"],
    reason: "parent decision",
    metadata: { plannerFallbackUsed: true },
  };
  return { input, decision };
}

test("parity pulse replaces a noncombat action inside the measured window", () => {
  const { input, decision } = fixture();
  const result = applyParityPulse(input, decision);

  assert.equal(result.actionID, "attack:auri:10");
  assert.equal(result.actionIDs, undefined);
  assert.match(result.reason, new RegExp(PARITY_PULSE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.reason, /gap=0\.100 ratio=0\.950/);
  assert.equal(result.metadata.plannerFallbackUsed, true);
  assert.equal(result.metadata.parityPulse, true);
});

test("parity pulse does not fire below the troop floor", () => {
  const { input, decision } = fixture({ ratio: 0.89 });
  assert.equal(applyParityPulse(input, decision), decision);
});

test("parity pulse does not fire after the leader gap has escaped", () => {
  const { input, decision } = fixture({ gap: 0.23 });
  assert.equal(applyParityPulse(input, decision), decision);
});

test("parity pulse does not open a second front under incoming pressure", () => {
  const { input, decision } = fixture({ incoming: ["james"] });
  assert.equal(applyParityPulse(input, decision), decision);
});

test("parity pulse observes the two-decision attack cooldown", () => {
  const { input, decision } = fixture({
    recentDecisions: [
      {
        accepted: true,
        actionID: "attack:auri:10",
        actionKind: "attack",
        targetID: "auri",
        expansion: false,
      },
    ],
  });
  assert.equal(applyParityPulse(input, decision), decision);
});

test("parity pulse preserves an existing hostile attack", () => {
  const { input, decision } = fixture({ selectedActionID: "attack:james:25" });
  assert.equal(applyParityPulse(input, decision), decision);
});
