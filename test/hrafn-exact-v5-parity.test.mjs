import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import {
  K1Z_MEMBERS,
  chooseHrafnAction as chooseCurrent,
  publicHrafnReason as reasonCurrent,
} from "../hrafn-strategy.mjs";

const frozenSource = execFileSync(
  "git",
  ["show", "0c151570f7e650a32a5705ff71692aa930012097:hrafn-strategy.mjs"],
  { encoding: "utf8" },
);
const frozen = await import(
  `data:text/javascript;base64,${Buffer.from(frozenSource).toString("base64")}`
);
const lowRisk = { level: "low" };

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function rival({
  id,
  name,
  tileShare,
  relativeTroopRatio,
  sharesBorder = true,
  canAttack = true,
  isAllied = false,
  incomingAttack = false,
} = {}) {
  return {
    id,
    name,
    tileShare,
    relativeTroopRatio,
    sharesBorder,
    canAttack,
    isAllied,
    incomingAttack,
    isAlive: true,
  };
}

const odin = rival({
  id: K1Z_MEMBERS[0].id,
  name: "K1Z odin free",
  tileShare: 0.04,
  relativeTroopRatio: 1,
  isAllied: true,
});
const auri = rival({
  id: "auri",
  name: "Auri",
  tileShare: 0.23,
  relativeTroopRatio: 1.5,
});
const leader = rival({
  id: "leader",
  name: "Richard Higgins",
  tileShare: 0.29,
  relativeTroopRatio: 1.4,
});

function attack(target, percent) {
  return action(
    `attack:${target.id}:${percent}`,
    "attack",
    `Attack ${target.name} ${percent}%`,
    {
      targetID: target.id,
      targetName: target.name,
      troopPercent: percent,
    },
  );
}

const hold = action("hold", "hold", "Hold");
const expand = action(
  "expand:terra-nullius:35",
  "attack",
  "Expand Terra Nullius 35%",
  { expansion: true, troopPercent: 35 },
);
const donation = action(
  "donate_troops:odin",
  "donate_troops",
  "Donate troops to Odin",
  { recipientID: odin.id, recipientName: odin.name },
);
const alliance = action(
  "alliance:odin",
  "alliance_request",
  "Alliance with Odin",
  { recipientID: odin.id, recipientName: odin.name, relation: 1 },
);

const menus = [
  [action("spawn:100", "spawn", "Spawn 100"), hold],
  [alliance, donation, attack(auri, 25), expand, hold],
  [donation, attack(auri, 25), attack(leader, 25), expand, hold],
  [attack(auri, 25), attack(leader, 25), expand, hold],
  [
    expand,
    action("build:city", "build", "Build City"),
    action("build:factory", "build", "Build Factory"),
    hold,
  ],
  [
    action("boat:terra-nullius:8", "boat", "Boat Terra Nullius 8%", {
      expansion: true,
      troopPercent: 8,
    }),
    action("upgrade:city", "upgrade_structure", "Upgrade City"),
    hold,
  ],
  [
    action("boat:withdrawn:8", "boat", "Boat 8%", { troopPercent: 8 }),
    action("chat:raven", "quick_chat", "Raven signal"),
    action("emoji:raven", "emoji", "Raven"),
    action("embargo:stop", "embargo_stop", "Stop embargo"),
    hold,
  ],
  [
    action("build:sam", "build", "Build SAM Launcher"),
    action("retreat", "retreat", "Retreat"),
    attack(leader, 10),
    hold,
  ],
];

const histories = [
  [],
  [{
    actionID: "attack:leader:25",
    kind: "attack",
    targetID: leader.id,
    targetName: "richard higgins",
    policyMarker: "rv1",
    campaignStartDecision: 0,
  }],
  [{
    actionID: donation.id,
    kind: donation.kind,
    targetID: odin.id.toLowerCase(),
    targetName: "odin free",
    policyMarker: "dn1",
  }],
  [{
    actionID: "embargo:stop",
    kind: "embargo_stop",
    targetID: leader.id,
    targetName: "richard higgins",
  }],
  Array.from({ length: 12 }, (_, index) => ({
    actionID: `prior:${index}`,
    kind: index === 0 ? "build" : "hold",
    targetID: null,
    targetName: null,
  })),
];

test("exact-v5 mode matches frozen 0c151570 across the strategy corpus", () => {
  let compared = 0;
  for (const tileShare of [0.05, 0.08, 0.12, 0.25, 0.31]) {
    for (const troopRatio of [0.6, 1]) {
      for (const incomingAttacks of [0, 1, 2]) {
        for (const menu of menus) {
          for (const history of histories) {
            const observation = {
              ownState: {
                tileShare,
                troopRatio,
                troops: 500000,
                gold: 250000,
                incomingAttacks,
              },
              combat: {
                incomingAttackPlayerIDs: incomingAttacks > 0
                  ? [leader.id]
                  : [],
              },
              visiblePlayers: [
                odin,
                auri,
                { ...leader, incomingAttack: incomingAttacks > 0 },
              ],
            };
            const expected = frozen.chooseHrafnAction(
              menu,
              observation,
              structuredClone(history),
              { rv1Enabled: true },
            );
            const actual = chooseCurrent(
              menu,
              observation,
              structuredClone(history),
              { rv1Enabled: true, exactV5: true },
            );
            assert.deepEqual(actual, expected);
            assert.equal(reasonCurrent(actual), frozen.publicHrafnReason(expected));
            compared += 1;
          }
        }
      }
    }
  }
  assert.equal(compared, 1200);
});
