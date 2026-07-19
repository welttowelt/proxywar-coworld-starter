import assert from "node:assert/strict";
import test from "node:test";

import {
  HRAFN_DEFAULTS,
  K1Z_MEMBERS,
  canonicalizeK1ZName,
  chooseHrafnAction,
  coalitionMemberForRival,
  publicHrafnReason,
  recordHrafnDecision,
} from "../hrafn-strategy.mjs";

const lowRisk = { level: "low" };

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function rival({
  id,
  name,
  tileShare = 0.15,
  relativeTroopRatio = 1.5,
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

function observation({
  tileShare = 0.12,
  troopRatio = 1,
  incomingAttacks = 0,
  incomingAttackPlayerIDs = [],
  rivals = [],
} = {}) {
  return {
    ownState: {
      tileShare,
      troopRatio,
      troops: 500000,
      gold: 250000,
      incomingAttacks,
    },
    combat: { incomingAttackPlayerIDs },
    visiblePlayers: rivals,
  };
}

function attack(target, percent = 10) {
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

test("canonical K1Z variants resolve to one coalition name", () => {
  for (const value of [
    "[K1Z] JURYOKU-KOKU",
    "K1Z juryoku_koku",
    "k1z.juryoku...koku",
    "  K1Z   juryoku koku  ",
  ]) {
    assert.equal(canonicalizeK1ZName(value), "juryoku koku");
  }
});

test("exact player ID protects a renamed coalition member", () => {
  const member = coalitionMemberForRival({
    id: K1Z_MEMBERS[0].id,
    name: "unknown new display",
    canonicalName: "unknown new display",
  });
  assert.equal(member?.role, "king");
});

test("all harmful coalition actions fail closed", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    relativeTroopRatio: 4,
  });
  const hold = action("hold", "hold", "Hold");
  const actions = [
    attack(odin, 10),
    action("nuke:odin", "nuke", "Nuke K1Z odin free", { targetID: odin.id }),
    action("target:odin", "target_player", "Target K1Z odin free", { targetID: odin.id }),
    action("embargo:odin", "embargo", "Embargo K1Z odin free", { targetID: odin.id }),
    action("break:odin", "break_alliance", "Break K1Z odin free", { targetID: odin.id }),
    hold,
  ];
  const chosen = chooseHrafnAction(actions, observation({ rivals: [odin] }));
  assert.equal(chosen.id, hold.id);
});

test("a stable Odin alliance precedes outsider social actions", () => {
  const odin = rival({ id: K1Z_MEMBERS[0].id, name: "odin free" });
  const foe = rival({ id: "foe", name: "Foe" });
  const odinAlliance = action(
    "alliance:odin",
    "alliance_request",
    "Alliance with odin free",
    { recipientID: odin.id, relation: 1 },
  );
  const outsiderTarget = action(
    "target:foe",
    "target_player",
    "Target Foe",
    { targetID: foe.id },
  );
  const chosen = chooseHrafnAction(
    [outsiderTarget, odinAlliance],
    observation({ rivals: [odin, foe] }),
  );
  assert.equal(chosen.id, odinAlliance.id);
  assert.equal(chosen.policyMarker, "k1z");
});

test("a transient outgoing alliance cannot replace reliable expansion", () => {
  const odin = rival({ id: K1Z_MEMBERS[0].id, name: "odin free" });
  const alliance = action(
    "alliance:odin",
    "alliance_request",
    "Alliance with odin free",
    { recipientID: odin.id, relation: 2 },
  );
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const chosen = chooseHrafnAction(
    [alliance, expand],
    observation({ tileShare: 0.05, rivals: [odin] }),
  );
  assert.equal(chosen.id, expand.id);
});

test("rv1 cannot activate before the base threshold", () => {
  const foe = rival({ id: "foe", name: "Foe", tileShare: 0.3, relativeTroopRatio: 2 });
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const chosen = chooseHrafnAction(
    [attack(foe, 25), expand],
    observation({ tileShare: 0.09, rivals: [foe] }),
  );
  assert.equal(chosen.id, expand.id);
  assert.equal(chosen.policyMarker, undefined);
});

test("a low troop-cap ratio without an attacker does not fabricate pressure", () => {
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const build = action("build:city", "build", "Build City");
  const chosen = chooseHrafnAction(
    [build, expand],
    observation({ tileShare: 0.05, troopRatio: 0.4 }),
  );
  assert.equal(chosen.id, expand.id);
  assert.equal(chosen.policyMarker, undefined);
});

test("real incoming pressure can activate the shield branch", () => {
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    incomingAttack: true,
  });
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const build = action("build:city", "build", "Build City");
  const chosen = chooseHrafnAction(
    [expand, build],
    observation({
      tileShare: 0.05,
      troopRatio: 0.4,
      incomingAttackPlayerIDs: [attacker.id],
      rivals: [attacker],
    }),
  );
  assert.equal(chosen.id, build.id);
  assert.equal(chosen.policyMarker, "sk1");
});

test("rv1 skips an oversized K1Z member and pins the strongest outsider", () => {
  const gravity = rival({
    id: K1Z_MEMBERS[2].id,
    name: "[K1Z] juryoku-koku",
    tileShare: 0.4,
    relativeTroopRatio: 3,
  });
  const leader = rival({
    id: "leader",
    name: "Leader",
    tileShare: 0.3,
    relativeTroopRatio: 1.4,
  });
  const weak = rival({
    id: "weak",
    name: "Weak",
    tileShare: 0.1,
    relativeTroopRatio: 2,
  });
  const chosen = chooseHrafnAction(
    [attack(gravity, 25), attack(leader, 25), attack(weak, 25)],
    observation({ tileShare: 0.12, rivals: [gravity, leader, weak] }),
  );
  assert.equal(chosen.id, `attack:${leader.id}:25`);
  assert.equal(chosen.policyMarker, "rv1");
});

test("rv3 opens on Auri before a larger reachable outsider", () => {
  const auri = rival({
    id: "auri",
    name: "Auri",
    tileShare: 0.2,
    relativeTroopRatio: 1.5,
  });
  const larger = rival({
    id: "larger",
    name: "Larger",
    tileShare: 0.4,
    relativeTroopRatio: 2,
  });
  const chosen = chooseHrafnAction(
    [attack(larger, 25), attack(auri, 25)],
    observation({ tileShare: 0.12, rivals: [larger, auri] }),
  );
  assert.equal(chosen.id, "attack:auri:25");
  assert.equal(chosen.policyMarker, "rv3");
});

test("rv3 targets Auri without feeding him below the attack floor", () => {
  const auri = rival({
    id: "auri",
    name: "Auri",
    tileShare: 0.3,
    relativeTroopRatio: 1.2,
  });
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    isAllied: true,
  });
  const target = action(
    "target:auri",
    "target_player",
    "Target Auri",
    { targetID: auri.id, targetName: auri.name },
  );
  const chosen = chooseHrafnAction(
    [attack(auri, 25), target],
    observation({ tileShare: 0.12, rivals: [auri, odin] }),
  );
  assert.equal(chosen.id, target.id);
  assert.equal(chosen.policyMarker, "rv3");
});

test("rv3 switches an older outsider lock to newly reachable Auri", () => {
  const auri = rival({
    id: "auri",
    name: "Auri",
    tileShare: 0.2,
    relativeTroopRatio: 1.5,
  });
  const older = rival({
    id: "older",
    name: "Older",
    tileShare: 0.4,
    relativeTroopRatio: 2,
  });
  const history = [{
    actionID: "attack:older:25",
    kind: "attack",
    targetID: older.id,
    targetName: canonicalizeK1ZName(older.name),
    tileShare: 0.12,
    policyMarker: "rv1",
    campaignStartDecision: 0,
  }];
  const chosen = chooseHrafnAction(
    [attack(older, 25), attack(auri, 25)],
    observation({ tileShare: 0.12, rivals: [older, auri] }),
    history,
  );
  assert.equal(chosen.id, "attack:auri:25");
  assert.equal(chosen.policyMarker, "rv3");
});

test("rv3 hands off from suppressed Auri to a runaway Richard", () => {
  const auri = rival({
    id: "auri",
    name: "Auri",
    tileShare: 0.18,
    relativeTroopRatio: 2,
  });
  const richard = rival({
    id: "richard",
    name: "Richard Higgins",
    tileShare: 0.3,
    relativeTroopRatio: 1.5,
  });
  const history = [{
    actionID: "target:auri",
    kind: "target_player",
    targetID: auri.id,
    targetName: canonicalizeK1ZName(auri.name),
    tileShare: 0.12,
    policyMarker: "rv3",
    campaignStartDecision: 0,
  }];
  const chosen = chooseHrafnAction(
    [attack(auri, 25), attack(richard, 25)],
    observation({ tileShare: 0.12, rivals: [auri, richard] }),
    history,
  );
  assert.equal(chosen.id, "attack:richard:25");
  assert.equal(chosen.policyMarker, "rv3");
});

test("rv3 cooldown grows neutrals instead of feeding a weak leader or side target", () => {
  const auri = rival({
    id: "auri",
    name: "Auri",
    tileShare: 0.18,
    relativeTroopRatio: 2,
  });
  const richard = rival({
    id: "richard",
    name: "Richard Higgins",
    tileShare: 0.3,
    relativeTroopRatio: 1.2,
  });
  const side = rival({
    id: "side",
    name: "Side",
    tileShare: 0.1,
    relativeTroopRatio: 3,
  });
  const target = action(
    "target:richard",
    "target_player",
    "Target Richard Higgins",
    { targetID: richard.id, targetName: richard.name },
  );
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const history = [{
    actionID: target.id,
    kind: target.kind,
    targetID: richard.id,
    targetName: canonicalizeK1ZName(richard.name),
    tileShare: 0.12,
    policyMarker: "rv3",
    campaignStartDecision: 0,
  }];
  const chosen = chooseHrafnAction(
    [attack(richard, 25), attack(side, 25), target, expand],
    observation({ tileShare: 0.12, rivals: [auri, richard, side] }),
    history,
  );
  assert.equal(chosen.id, expand.id);
  assert.equal(chosen.policyMarker, undefined);
});

test("rv1 respects the configured troop-ratio floor", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    tileShare: 0.3,
    relativeTroopRatio: HRAFN_DEFAULTS.minimumRelativeTroopRatio - 0.01,
  });
  const build = action("build:city", "build", "Build City");
  const chosen = chooseHrafnAction(
    [attack(foe, 25), build],
    observation({ tileShare: 0.12, rivals: [foe] }),
  );
  assert.equal(chosen.id, build.id);
  assert.equal(chosen.policyMarker, undefined);
});

test("an active rv1 campaign holds one front", () => {
  const alpha = rival({
    id: "alpha",
    name: "Alpha",
    tileShare: 0.2,
    relativeTroopRatio: 1.3,
  });
  const beta = rival({
    id: "beta",
    name: "Beta",
    tileShare: 0.4,
    relativeTroopRatio: 3,
  });
  const history = [{
    actionID: "attack:alpha:25",
    kind: "attack",
    targetID: "alpha",
    targetName: "alpha",
    tileShare: 0.12,
    policyMarker: "rv1",
    campaignStartDecision: 0,
  }];
  const chosen = chooseHrafnAction(
    [attack(alpha, 10), attack(beta, 25)],
    observation({ tileShare: 0.13, rivals: [alpha, beta] }),
    history,
  );
  assert.equal(chosen.id, "attack:alpha:10");
  assert.equal(chosen.policyMarker, "rv1");
  assert.equal(chosen.campaignStartDecision, 0);
});

test("own incoming attacker receives vanguard priority", () => {
  const larger = rival({
    id: "larger",
    name: "Larger",
    tileShare: 0.31,
    relativeTroopRatio: 1.4,
  });
  const attacker = rival({
    id: "attacker",
    name: "Attacker",
    tileShare: 0.2,
    relativeTroopRatio: 1.4,
    incomingAttack: true,
  });
  const chosen = chooseHrafnAction(
    [attack(larger, 25), attack(attacker, 25)],
    observation({
      tileShare: 0.12,
      incomingAttackPlayerIDs: [attacker.id],
      rivals: [larger, attacker],
    }),
  );
  assert.equal(chosen.id, "attack:attacker:25");
});

test("unrelated Odin-like fields do not fabricate shared threat telemetry", () => {
  const leader = rival({
    id: "leader",
    name: "Leader",
    tileShare: 0.3,
    relativeTroopRatio: 1.4,
  });
  const bystander = rival({
    id: "bystander",
    name: "Bystander",
    tileShare: 0.1,
    relativeTroopRatio: 1.4,
  });
  const obs = observation({ tileShare: 0.12, rivals: [leader, bystander] });
  obs.odinIncomingAttackPlayerIDs = [bystander.id];
  const chosen = chooseHrafnAction([attack(leader, 25), attack(bystander, 25)], obs);
  assert.equal(chosen.id, "attack:leader:25");
});

test("Hrafn v3 does not donate before it has a meaningful lead over Odin", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "odin free",
    isAllied: true,
  });
  const donation = action(
    "donate:odin",
    "donate_troops",
    "Donate troops to odin free",
    { recipientID: odin.id },
  );
  const hold = action("hold", "hold", "Hold");
  const chosen = chooseHrafnAction([donation, hold], observation({ rivals: [odin] }));
  assert.equal(chosen.id, hold.id);
});

test("dn1 transfers troops to a lagging Odin after Hrafn establishes a lead", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    tileShare: 0.04,
    isAllied: true,
  });
  const donation = action(
    "donate_troops:odin",
    "donate_troops",
    "Donate troops to odin free",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const chosen = chooseHrafnAction(
    [expand, donation],
    observation({ tileShare: 0.08, rivals: [odin] }),
  );
  assert.equal(chosen.id, donation.id);
  assert.equal(chosen.policyMarker, "dn1");
  assert.equal(publicHrafnReason(chosen), "[K1Z] r4vn:dnt:dn1");
});

test("dn1 respects its cooldown instead of draining Hrafn every decision", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    tileShare: 0.04,
    isAllied: true,
  });
  const donation = action(
    "donate_troops:odin",
    "donate_troops",
    "Donate troops to odin free",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const expand = action(
    "expand:terra-nullius:35",
    "attack",
    "Expand Terra Nullius 35%",
    { expansion: true, troopPercent: 35 },
  );
  const history = [{
    actionID: donation.id,
    kind: donation.kind,
    targetID: odin.id,
    targetName: "odin free",
    policyMarker: "dn1",
  }];
  const chosen = chooseHrafnAction(
    [expand, donation],
    observation({ tileShare: 0.08, rivals: [odin] }),
    history,
  );
  assert.equal(chosen.id, expand.id);
});

test("public quick chat is never selected because its game-authored prose cannot be leet", () => {
  const chat = action("chat:raven", "quick_chat", "Raven signal");
  const hold = action("hold", "hold", "Hold");
  const chosen = chooseHrafnAction([hold, chat], observation());
  assert.equal(chosen.id, hold.id);
  assert.equal(publicHrafnReason(chosen), "[K1Z] r4vn:h0d");
});

test("public quick chat stays suppressed after a prior public signal", () => {
  const chat = action("chat:raven", "quick_chat", "Raven signal");
  const hold = action("hold", "hold", "Hold");
  const history = [{
    actionID: chat.id,
    kind: chat.kind,
    targetID: null,
    targetName: null,
  }];
  const chosen = chooseHrafnAction([hold, chat], observation(), history);
  assert.equal(chosen.id, hold.id);
});

test("wr1 replaces an embargo-stop withdrawal hold with the smallest boat", () => {
  const actions = [
    action("boat:260373:8", "boat", "Launch boat 8%"),
    action("boat:260373:16", "boat", "Launch boat 16%"),
    action("hold", "hold", "Hold"),
  ];
  const history = [{
    actionID: "embargo:28k1hctz:stop",
    kind: "embargo_stop",
    targetID: "28k1hctz",
    targetName: "daveey",
  }];
  const chosen = chooseHrafnAction(actions, observation(), history);
  assert.equal(chosen.id, "boat:260373:8");
  assert.equal(chosen.policyMarker, "wr1");
});

test("wr1 uses a bounded outsider attack and never targets K1Z", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    relativeTroopRatio: 4,
  });
  const outsider = rival({
    id: "outsider",
    name: "daveey",
    relativeTroopRatio: 1,
  });
  const history = [{
    actionID: "embargo:outsider:stop",
    kind: "embargo_stop",
    targetID: outsider.id,
    targetName: outsider.name,
  }];
  const chosen = chooseHrafnAction(
    [attack(odin, 10), attack(outsider, 10), action("hold", "hold", "Hold")],
    observation({ rivals: [odin, outsider] }),
    history,
  );
  assert.equal(chosen.id, "attack:outsider:10");
  assert.equal(chosen.policyMarker, "wr1");
});

test("wr1 stays dormant while the prior embargo-stop action remains offered", () => {
  const embargoStop = action(
    "embargo:outsider:stop",
    "embargo_stop",
    "Stop embargo outsider",
  );
  const history = [{
    actionID: embargoStop.id,
    kind: embargoStop.kind,
    targetID: "outsider",
    targetName: "daveey",
  }];
  const chosen = chooseHrafnAction(
    [embargoStop, action("boat:260373:8", "boat"), action("hold", "hold", "Hold")],
    observation(),
    history,
  );
  assert.equal(chosen.id, "hold");
  assert.equal(chosen.policyMarker, undefined);
});

test("recorded rv1 decisions retain the campaign identity", () => {
  const foe = rival({ id: "foe", name: "Foe" });
  const chosen = {
    ...attack(foe, 25),
    policyMarker: "rv1",
    campaignStartDecision: 7,
  };
  const history = [];
  recordHrafnDecision(history, chosen, observation({ rivals: [foe] }));
  assert.deepEqual(
    {
      targetID: history[0].targetID,
      marker: history[0].policyMarker,
      start: history[0].campaignStartDecision,
    },
    { targetID: "foe", marker: "rv1", start: 7 },
  );
});

test("public game text is tagged, leet, ASCII, and bounded", () => {
  const reason = publicHrafnReason({ kind: "attack", policyMarker: "rv1" });
  assert.equal(reason, "[K1Z] r4vn:atk:rv1");
  assert.ok(reason.length <= 48);
  assert.match(reason, /^[\x20-\x7e]+$/);
});

test("v0 disables only the rv1 campaign branch", () => {
  const foe = rival({
    id: "foe",
    name: "Foe",
    tileShare: 0.3,
    relativeTroopRatio: 1.3,
  });
  const build = action("build:city", "build", "Build City");
  const chosen = chooseHrafnAction(
    [attack(foe, 25), build],
    observation({ tileShare: 0.12, rivals: [foe] }),
    [],
    { rv1Enabled: false },
  );
  assert.equal(chosen.id, build.id);
  assert.equal(chosen.policyMarker, undefined);
});
