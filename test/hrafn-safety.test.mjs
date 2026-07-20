import assert from "node:assert/strict";
import test from "node:test";

import {
  K1Z_MEMBERS,
  buildHrafnChassisState,
} from "../hrafn-state.mjs";
import {
  assertFreshHrafnAction,
  classifyHrafnActionSafety,
  failClosedHrafnHold,
  filterHrafnSafeActions,
} from "../hrafn-safety.mjs";
import {
  action,
  attack,
  hold,
  invasion,
  neutralBoat,
  observation,
  rival,
} from "./helpers/hrafn-fixtures.mjs";

function stateFor(rivals, actions) {
  return buildHrafnChassisState(observation({ rivals }), actions);
}

test("every harmful action kind targeting K1Z is rejected", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    relativeTroopRatio: 5,
  });
  const cases = [
    attack(odin, 10),
    invasion(odin, 25),
    action(`nuke:${odin.id}`, "nuke", "Nuke Odin", {
      targetID: odin.id,
      targetName: odin.name,
    }),
    action(`target:${odin.id}`, "target_player", "Target Odin", {
      targetID: odin.id,
    }),
    action(`embargo:${odin.id}`, "embargo", "Embargo Odin", {
      targetID: odin.id,
    }),
    action(`break:${odin.id}`, "break_alliance", "Break Odin", {
      targetID: odin.id,
    }),
    action(`reject:${odin.id}`, "alliance_reject", "Reject Odin", {
      targetID: odin.id,
    }),
  ];
  const state = stateFor([odin], cases);
  for (const candidate of cases) {
    const result = classifyHrafnActionSafety(candidate, state);
    assert.equal(result.safe, false, candidate.kind);
    assert.equal(result.reason, "k1z-protected", candidate.kind);
  }
});

test("K1Z protection survives a renamed exact configured ID", () => {
  const renamed = rival({
    id: K1Z_MEMBERS[2].id,
    name: "Unrecognizable Shield",
  });
  const harmful = attack(renamed, 40);
  const state = stateFor([renamed], [harmful]);
  assert.deepEqual(
    classifyHrafnActionSafety(harmful, state),
    {
      safe: false,
      reason: "k1z-protected",
      rival: state.rivals[0],
    },
  );
});

test("K1Z protection covers an unknown but explicitly tagged member", () => {
  const tagged = rival({
    id: "runtime-new-k1z",
    name: "K1Z new shield",
  });
  const harmful = attack(tagged, 40);
  const state = stateFor([tagged], [harmful]);
  const result = classifyHrafnActionSafety(harmful, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "k1z-protected");
});

test("explicit K1Z target metadata stays protected when observation text drops the tag", () => {
  const inconsistent = rival({
    id: "runtime-random",
    name: "Random",
  });
  const harmful = action(
    `attack:${inconsistent.id}:25`,
    "attack",
    "Attack Random 25%",
    {
      targetID: inconsistent.id,
      targetName: "K1Z Random",
      troopPercent: 25,
    },
  );
  const state = stateFor([inconsistent], [harmful]);
  const result = classifyHrafnActionSafety(harmful, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "k1z-protected");
});

test("harm against a current outsider ally is rejected", () => {
  const ally = rival({
    id: "ally",
    name: "Temporary Ally",
    isAllied: true,
  });
  const harmful = attack(ally, 25);
  const state = stateFor([ally], [harmful]);
  const result = classifyHrafnActionSafety(harmful, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "allied-protected");
});

test("resolved outsider attacks and invasions remain available", () => {
  const foe = rival({ id: "foe", name: "Foe" });
  const cases = [attack(foe, 25), invasion(foe, 25)];
  const state = stateFor([foe], cases);
  for (const candidate of cases) {
    const result = classifyHrafnActionSafety(candidate, state);
    assert.equal(result.safe, true, candidate.kind);
    assert.equal(result.reason, "resolved-outsider", candidate.kind);
  }
});

test("neutral expansion is safe without resolving a player target", () => {
  const boat = neutralBoat(991, 16);
  const land = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const state = stateFor([], [boat, land]);
  assert.equal(classifyHrafnActionSafety(boat, state).safe, true);
  assert.equal(classifyHrafnActionSafety(land, state).safe, true);
});

test("neutral-looking metadata cannot conceal a K1Z boat target", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const disguised = action(
    "boat:match-odin:16",
    "boat",
    "Boat to Odin 16%",
    {
      targetID: odin.id,
      targetName: odin.name,
      expansion: true,
      invasion: false,
      troopPercent: 16,
    },
  );
  const state = stateFor([odin], [disguised]);
  const result = classifyHrafnActionSafety(disguised, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "k1z-protected");
});

test("neutral-looking metadata cannot conceal an ID-encoded K1Z land target", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const disguised = action(
    "attack:match-odin:35",
    "attack",
    "Opaque expansion",
    {
      expansion: true,
      invasion: false,
      troopPercent: 35,
    },
  );
  const state = stateFor([odin], [disguised]);
  const result = classifyHrafnActionSafety(disguised, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "k1z-protected");
});

test("conflicting explicit target signals fail closed", () => {
  const outsider = rival({ id: "outsider", name: "Outsider" });
  const conflict = action(
    "attack:outsider:25",
    "attack",
    "Attack Outsider 25%",
    {
      targetID: K1Z_MEMBERS[0].id,
      targetName: "K1Z odin free",
      troopPercent: 25,
    },
  );
  const state = stateFor([outsider], [conflict]);
  const result = classifyHrafnActionSafety(conflict, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "k1z-protected");
});

test("ambiguous harmful targets fail closed", () => {
  const first = rival({ id: "first", name: "Twin" });
  const second = rival({ id: "second", name: "Twin" });
  const harmful = action("attack:twin:25", "attack", "Attack Twin 25%", {
    targetName: "Twin",
    troopPercent: 25,
  });
  const state = stateFor([first, second], [harmful]);
  const result = classifyHrafnActionSafety(harmful, state);
  assert.equal(result.safe, false);
  assert.equal(result.reason, "ambiguous-harm-target");
});

test("unresolved and missing harmful targets fail closed", () => {
  const signaled = action(
    "attack:ghost:25",
    "attack",
    "Attack Ghost 25%",
    { targetID: "ghost", troopPercent: 25 },
  );
  const missing = action("nuke:unknown", "nuke", "Launch weapon");
  const state = stateFor([], [signaled, missing]);
  assert.equal(
    classifyHrafnActionSafety(signaled, state).reason,
    "unresolved-harm-target",
  );
  assert.equal(
    classifyHrafnActionSafety(missing, state).reason,
    "unresolved-harm-target",
  );
});

test("indiscriminate embargo is always rejected", () => {
  const embargoAll = action("embargo:all", "embargo_all", "Embargo all");
  const state = stateFor([], [embargoAll]);
  assert.deepEqual(
    classifyHrafnActionSafety(embargoAll, state),
    { safe: false, reason: "indiscriminate-harm", rival: null },
  );
});

test("donations are structurally limited to Odin", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const katanasan = rival({
    id: "match-katana",
    name: "K1Z katanasan",
  });
  const outsider = rival({ id: "outsider", name: "Outsider" });
  const donations = [
    action(`donate:${odin.id}`, "donate_troops", "Donate Odin", {
      recipientID: odin.id,
      recipientName: odin.name,
    }),
    action(`donate:${katanasan.id}`, "donate_troops", "Donate Katanasan", {
      recipientID: katanasan.id,
      recipientName: katanasan.name,
    }),
    action(`donate:${outsider.id}`, "donate_gold", "Donate Outsider", {
      recipientID: outsider.id,
      recipientName: outsider.name,
    }),
    action("donate:ghost", "donate_gold", "Donate Ghost", {
      recipientID: "ghost",
    }),
  ];
  const state = stateFor([odin, katanasan, outsider], donations);
  assert.equal(classifyHrafnActionSafety(donations[0], state).safe, true);
  assert.equal(
    classifyHrafnActionSafety(donations[1], state).reason,
    "non-odin-donation",
  );
  assert.equal(
    classifyHrafnActionSafety(donations[2], state).reason,
    "non-odin-donation",
  );
  assert.equal(
    classifyHrafnActionSafety(donations[3], state).reason,
    "unresolved-donation-target",
  );
});

test("non-harmful builds, upgrades, retreats, and holds remain safe", () => {
  const cases = [
    action("build:City", "build", "Build City"),
    action("upgrade:City", "upgrade_structure", "Upgrade City"),
    action("retreat:land", "retreat", "Retreat"),
    action("boat-retreat:1", "boat_retreat", "Retreat boat"),
    hold(),
  ];
  const state = stateFor([], cases);
  for (const candidate of cases) {
    assert.equal(
      classifyHrafnActionSafety(candidate, state).safe,
      true,
      candidate.kind,
    );
  }
});

test("safe-action filtering records exact rejection reasons", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const safeHold = hold();
  const harmful = attack(odin, 40);
  const unresolved = action("attack:ghost:25", "attack", "Attack Ghost", {
    targetID: "ghost",
    troopPercent: 25,
  });
  const actions = [harmful, unresolved, safeHold];
  const state = stateFor([odin], actions);
  const filtered = filterHrafnSafeActions(actions, state);
  assert.deepEqual(filtered.safe.map((candidate) => candidate.id), ["hold"]);
  assert.deepEqual(
    filtered.rejected.map(({ reason }) => reason),
    ["k1z-protected", "unresolved-harm-target"],
  );
});

test("fresh-action assertion rejects stale and unsafe selections", () => {
  const odin = rival({
    id: "match-odin",
    name: "K1Z odin free",
  });
  const safeHold = hold();
  const harmful = attack(odin, 25);
  const state = stateFor([odin], [safeHold, harmful]);
  assert.equal(assertFreshHrafnAction(safeHold, state), safeHold);
  assert.throws(
    () => assertFreshHrafnAction(
      action("build:stale", "build", "Stale build"),
      state,
    ),
    /stale or unknown legal action/,
  );
  assert.throws(
    () => assertFreshHrafnAction(harmful, state),
    /unsafe action.*k1z-protected/,
  );
});

test("fail-closed hold requires a currently legal hold", () => {
  const safeHold = hold();
  const state = stateFor([], [safeHold]);
  assert.equal(failClosedHrafnHold([safeHold], state), safeHold);
  assert.throws(
    () => failClosedHrafnHold([], state),
    /no legal hold/,
  );
});

test("invalid action shapes are rejected before classification", () => {
  const state = stateFor([], []);
  assert.equal(
    classifyHrafnActionSafety(null, state).reason,
    "invalid-action",
  );
  assert.equal(
    classifyHrafnActionSafety({ id: "", kind: "hold" }, state).reason,
    "missing-action-identity",
  );
});
