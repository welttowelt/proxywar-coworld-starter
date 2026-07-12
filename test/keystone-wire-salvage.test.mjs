import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWireSalvage,
  WIRE_SALVAGE_MARKER,
} from "../scripts/keystone-wire-salvage.mjs";

function action(id, kind, metadata = {}, level = "low") {
  return { id, kind, metadata, risk: { level } };
}

function fixture({
  ratio = 1.1,
  gap = 0.2,
  alivePlayerCount = 3,
  incoming = [],
  legalActions,
} = {}) {
  const ownShare = alivePlayerCount === 2 ? 0.54 : 0.3;
  return {
    input: {
      observation: {
        alivePlayerCount,
        ownState: { isAlive: true, tileShare: ownShare },
        visiblePlayers: [
          {
            playerID: "leader",
            name: "Leader",
            isAlive: true,
            isTeammate: false,
            isAllied: false,
            canAttack: true,
            tileShare: ownShare + gap,
            relativeTroopRatio: ratio,
          },
          ...(alivePlayerCount >= 3
            ? [{
                playerID: "other",
                name: "Other",
                isAlive: true,
                isTeammate: false,
                isAllied: true,
                canAttack: false,
                tileShare: 0.1,
                relativeTroopRatio: 2,
              }]
            : []),
        ],
        combat: { incomingAttackPlayerIDs: incoming },
      },
      legalActions: legalActions ?? [
        action("attack:leader:10", "attack", {
          targetID: "leader",
          targetName: "Leader",
          troopPercent: 10,
          expansion: false,
        }, "medium"),
        action("build:City:10", "build", { economicValue: 0.8 }),
        action("hold", "hold"),
      ],
    },
    decision: {
      actionID: "alliance:missing",
      reason: "parent decision",
      metadata: { plannerFallbackUsed: true },
    },
  };
}

test("wire salvage leaves every currently legal parent action untouched", () => {
  const { input, decision } = fixture();
  decision.actionID = "build:City:10";
  assert.equal(applyWireSalvage(input, decision), decision);
});

test("wire salvage converts an unknown action into live leader pressure", () => {
  const { input, decision } = fixture();
  const result = applyWireSalvage(input, decision);

  assert.equal(result.actionID, "attack:leader:10");
  assert.match(result.reason, /\[g4lga-v4rd:w1re\]/);
  assert.match(result.reason, /unknown=alliance:missing/);
  assert.equal(result.metadata.plannerFallbackUsed, true);
  assert.equal(result.metadata.wireSalvage, true);
  assert.equal(WIRE_SALVAGE_MARKER, "[g4lga-v4rd:w1re]");
});

test("wire salvage avoids feeding a leader below the ratio floor", () => {
  const { input, decision } = fixture({
    ratio: 0.8,
    legalActions: [
      action("attack:leader:10", "attack", {
        targetID: "leader",
        troopPercent: 10,
        expansion: false,
      }, "medium"),
      action("boat_retreat:7", "boat_retreat"),
      action("build:City:10", "build", { economicValue: 0.8 }),
      action("hold", "hold"),
    ],
  });
  assert.equal(applyWireSalvage(input, decision).actionID, "boat_retreat:7");
});

test("wire salvage prioritizes a legal retreat under incoming pressure", () => {
  const { input, decision } = fixture({
    incoming: ["leader"],
    legalActions: [
      action("retreat:9:50", "retreat"),
      action("boat_retreat:7", "boat_retreat"),
      action("build:City:10", "build", { economicValue: 0.8 }),
      action("hold", "hold"),
    ],
  });
  assert.equal(applyWireSalvage(input, decision).actionID, "retreat:9:50");
});

test("wire salvage pressures the only rival in a credible duel", () => {
  const { input, decision } = fixture({ alivePlayerCount: 2, ratio: 0.9, gap: -0.08 });
  assert.equal(applyWireSalvage(input, decision).actionID, "attack:leader:10");
});

test("wire salvage uses hold only when no productive current action exists", () => {
  const { input, decision } = fixture({
    legalActions: [action("hold", "hold")],
  });
  assert.equal(applyWireSalvage(input, decision).actionID, "hold");
});
