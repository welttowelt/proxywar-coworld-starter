import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLeaderClamp,
  LEADER_SEVER_MARKER,
  PARITY_PULSE_MARKER,
} from "../scripts/keystone-leader-clamp.mjs";

function fixture({
  allied = false,
  canAttack = true,
  ratio = 0.95,
  gap = 0.1,
  incoming = [],
  recentDecisions = [],
  selectedActionID = "boat:neutral:16",
  includeSever = true,
} = {}) {
  const ownTileShare = 0.27;
  const leaderTileShare = ownTileShare + gap;
  const legalActions = [
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
  ];
  if (includeSever) {
    legalActions.push({
      id: "break_alliance:auri",
      kind: "break_alliance",
      risk: { level: "low" },
      metadata: { targetID: "auri", targetName: "Auri" },
    });
  }
  const input = {
    observation: {
      alivePlayerCount: 3,
      ownState: { isAlive: true, tileShare: ownTileShare },
      visiblePlayers: [
        {
          playerID: "auri",
          name: "Auri",
          isAlive: true,
          isTeammate: false,
          isAllied: allied,
          canAttack,
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
    legalActions,
  };
  const decision = {
    actionID: selectedActionID,
    actionIDs: [selectedActionID, "hold"],
    reason: "parent decision",
    metadata: { plannerFallbackUsed: true },
  };
  return { input, decision };
}

test("leader clamp preserves the replay-proven parity strike", () => {
  const { input, decision } = fixture();
  const result = applyLeaderClamp(input, decision);

  assert.equal(result.actionID, "attack:auri:10");
  assert.equal(result.actionIDs, undefined);
  assert.match(result.reason, new RegExp(PARITY_PULSE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.reason, /mode=strike leader=Auri gap=0\.100 ratio=0\.950/);
  assert.equal(result.metadata.plannerFallbackUsed, true);
  assert.equal(result.metadata.leaderClamp, "strike");
});

test("leader clamp severs a parity-window alliance with the leader", () => {
  const { input, decision } = fixture({ allied: true, ratio: 1.07 });
  const result = applyLeaderClamp(input, decision);

  assert.equal(result.actionID, "break_alliance:auri");
  assert.match(result.reason, new RegExp(LEADER_SEVER_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.reason, /mode=sever leader=Auri gap=0\.100 ratio=1\.070/);
  assert.equal(result.metadata.leaderClamp, "sever");
});

test("leader clamp requires a live sever action", () => {
  const { input, decision } = fixture({ allied: true, includeSever: false });
  assert.equal(applyLeaderClamp(input, decision), decision);
});

test("leader clamp stays off below the troop floor", () => {
  const { input, decision } = fixture({ allied: true, ratio: 0.89 });
  assert.equal(applyLeaderClamp(input, decision), decision);
});

test("leader clamp stays off after the leader gap escapes", () => {
  const { input, decision } = fixture({ allied: true, gap: 0.23 });
  assert.equal(applyLeaderClamp(input, decision), decision);
});

test("leader clamp does not open a front under incoming pressure", () => {
  const { input, decision } = fixture({ allied: true, incoming: ["james"] });
  assert.equal(applyLeaderClamp(input, decision), decision);
});

test("leader clamp observes the strike cooldown", () => {
  const { input, decision } = fixture({
    recentDecisions: [{
      accepted: true,
      actionID: "attack:auri:10",
      actionKind: "attack",
      targetID: "auri",
      expansion: false,
    }],
  });
  assert.equal(applyLeaderClamp(input, decision), decision);
});

test("leader clamp preserves an existing hostile attack", () => {
  const { input, decision } = fixture({
    allied: true,
    selectedActionID: "attack:james:25",
  });
  assert.equal(applyLeaderClamp(input, decision), decision);
});
