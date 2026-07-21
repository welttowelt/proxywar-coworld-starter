import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { chooseAction } from "../strategy-engine.mjs";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/pf1-r589-turn4900.json", import.meta.url),
  "utf8",
));

function historyEntry(actionID) {
  if (actionID.startsWith("spawn:")) {
    return { actionID, kind: "spawn", neutral: false, policyMarker: null };
  }
  if (actionID.startsWith("expand:terra-nullius:")) {
    return {
      actionID,
      kind: "attack",
      neutral: true,
      targetName: "Terra Nullius",
      targetID: null,
      policyMarker: null,
    };
  }
  if (actionID.startsWith("boat:")) {
    return {
      actionID,
      kind: "boat",
      neutral: true,
      targetName: "Terra Nullius",
      targetID: null,
      policyMarker: null,
    };
  }
  if (actionID.startsWith("build:")) {
    return { actionID, kind: "build", neutral: false, policyMarker: null };
  }
  if (actionID.startsWith("alliance:")) {
    return {
      actionID,
      kind: "alliance_request",
      neutral: false,
      targetName: "K1Z Hrafn",
      targetID: "1wy62oh4",
      policyMarker: null,
    };
  }
  throw new Error(`unknown fixture action: ${actionID}`);
}

function fixtureHistory() {
  return fixture.history_action_ids.map(historyEntry);
}

function runFixture(options = {}) {
  const plan = Object.hasOwn(options, "plan") ? options.plan : fixture.plan_variants[2];
  return chooseAction(
    structuredClone(options.actions ?? fixture.actions),
    structuredClone(options.state ?? fixture.state),
    structuredClone(plan),
    structuredClone(options.history ?? fixtureHistory()),
  );
}

function withCommitments(ownTroops, targetTroops) {
  const actions = structuredClone(fixture.actions);
  for (const action of actions) {
    const percent = Number(action.metadata.troopPercent);
    action.metadata.ownTroops = ownTroops;
    action.metadata.targetTroops = targetTroops;
    action.metadata.troops = Math.floor(ownTroops * percent / 100);
    action.metadata.relativeTroopRatio = ownTroops / targetTroops;
  }
  const state = structuredClone(fixture.state);
  state.self.troops = ownTroops;
  state.rivals[0].relativeTroopRatio = ownTroops / targetTroops;
  return { actions, state };
}

test("PF1 raises the hash-bound R589 first contact to the smallest floor-clearer", () => {
  for (const plan of fixture.plan_variants) {
    const selected = runFixture({ plan });
    assert.equal(selected.id, fixture.expected_pf1.id);
    assert.equal(selected.policyMarker, fixture.expected_pf1.policyMarker);
  }
});

test("PF1 uses 40 percent only when 25 percent cannot clear five-thirds", () => {
  const { actions, state } = withCommitments(1_272_348, 203_513);
  const selected = runFixture({ actions, state });
  assert.equal(actions[1].metadata.troops * 3 < 203_513 * 5, true);
  assert.equal(actions[2].metadata.troops * 3 >= 203_513 * 5, true);
  assert.equal(selected.id, "attack:idjkf73n:40");
  assert.equal(selected.policyMarker, "pf1");
});

test("PF1 preserves the parent probe when no legal commitment clears the floor", () => {
  const { actions, state } = withCommitments(700_000, 300_000);
  const selected = runFixture({ actions, state });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 never rearms on a later front", () => {
  const history = fixtureHistory();
  history.push({
    actionID: "attack:other:10",
    kind: "attack",
    neutral: false,
    targetName: "Other",
    targetID: "other",
    policyMarker: null,
  });
  const selected = runFixture({ history });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 stays inside the first one hundred active decisions", () => {
  const history = fixtureHistory();
  let active = history.filter((entry) => entry.kind !== "spawn").length;
  while (active <= 100) {
    history.push({
      actionID: `build:City:late-${active}`,
      kind: "build",
      neutral: false,
      policyMarker: null,
    });
    active++;
  }
  const selected = runFixture({ history });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 preserves the parent below the high-reserve band", () => {
  const state = structuredClone(fixture.state);
  state.self.troopRatio = 0.89;
  const selected = runFixture({ state });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 preserves the parent under protocol-visible incoming pressure", () => {
  const state = structuredClone(fixture.state);
  state.self.allProtocolAttackerIDs = ["attacker"];
  const selected = runFixture({ state });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 preserves the parent under direct incoming pressure", () => {
  const state = structuredClone(fixture.state);
  state.self.incomingAttacks = [{ attackerID: "attacker" }];
  const selected = runFixture({ state });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 preserves the parent outside the observed weak-target band", () => {
  const state = structuredClone(fixture.state);
  state.rivals[0].tileShare = 0.13;
  const selected = runFixture({ state });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 fails open when exact commitment metadata is absent", () => {
  const actions = structuredClone(fixture.actions);
  delete actions[1].metadata.troops;
  delete actions[2].metadata.targetTroops;
  const selected = runFixture({ actions });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);

  const missingParent = structuredClone(fixture.actions);
  delete missingParent[0].metadata.troops;
  const parentSelected = runFixture({ actions: missingParent });
  assert.equal(parentSelected.id, fixture.expected_parent.id);
  assert.equal(parentSelected.policyMarker, undefined);
});

test("PF1 never selects a high-risk floor-clearer", () => {
  const actions = structuredClone(fixture.actions);
  actions[1].risk.level = "high";
  actions[2].risk.level = "high";
  const selected = runFixture({ actions });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 never magnifies a conflicting executable target ID", () => {
  const actions = structuredClone(fixture.actions);
  for (const action of actions) {
    action.id = action.id.replace("idjkf73n", "2rmhbq4h");
  }
  const selected = runFixture({ actions });
  assert.equal(selected.id, "attack:2rmhbq4h:10");
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 never targets a protected K1Z identity", () => {
  const hrafnID = "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863";
  const actions = structuredClone(fixture.actions);
  for (const action of actions) {
    action.id = `attack:${hrafnID}:${action.metadata.troopPercent}`;
    action.metadata.targetID = hrafnID;
    action.metadata.targetName = "K1Z Hrafn";
  }
  actions.push({ id: "hold", kind: "hold", label: "Hold", risk: { level: "low" } });
  const state = structuredClone(fixture.state);
  state.rivals[0].id = hrafnID;
  state.rivals[0].name = "K1Z Hrafn";
  const selected = runFixture({ actions, state });
  assert.equal(selected.id, "hold");
  assert.equal(selected.policyMarker, undefined);
});

test("PF1 skips an avoided floor-clearer and uses the next smallest safe action", () => {
  const history = fixtureHistory();
  history.push(
    { actionID: "attack:idjkf73n:25", kind: "emoji", neutral: false },
    { actionID: "attack:idjkf73n:25", kind: "emoji", neutral: false },
  );
  const selected = runFixture({ history });
  assert.equal(selected.id, "attack:idjkf73n:40");
  assert.equal(selected.policyMarker, "pf1");
});

test("PF1 does not hide under the existing conversion marker", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: index < 6 ? `boat:terra:${index}` : `emoji:${index}`,
    kind: index < 6 ? "boat" : "emoji",
    neutral: index < 6,
    tileShare: fixture.state.self.tileShare,
    policyMarker: null,
  }));
  const selected = runFixture({ history });
  assert.equal(selected.id, fixture.expected_parent.id);
  assert.equal(selected.policyMarker, "cv1");
});

test("PF1 remains available while the conversion route is cooling down", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    actionID: index < 6 ? `boat:terra:${index}` : `emoji:${index}`,
    kind: index < 6 ? "boat" : "emoji",
    neutral: index < 6,
    tileShare: fixture.state.self.tileShare,
    policyMarker: index === 6 ? "cv1" : null,
  }));
  const selected = runFixture({ history });
  assert.equal(selected.id, fixture.expected_pf1.id);
  assert.equal(selected.policyMarker, fixture.expected_pf1.policyMarker);
});
