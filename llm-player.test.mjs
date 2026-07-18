import test from "node:test";
import assert from "node:assert/strict";

process.env.PROXYWAR_SELF_TEST = "1";
const { ALLIANCE_TAG, choose } = await import("./llm-player.mjs?juryoku-koku-test");

const player = (name, playerID, tileShare, overrides = {}) => ({
  name,
  playerID,
  isAlive: true,
  tileShare,
  relativeTroopRatio: 1.5,
  sharesBorder: true,
  canAttack: true,
  isAllied: false,
  ...overrides,
});

const odin = player("odin free", "odin-1", 0.40);
const katanasan = player("katanasan", "katana-1", 0.31);
const strong = player("Takeda Rival", "rival-strong", 0.34, { relativeTroopRatio: 1.2 });
const weak = player("Mori Rival", "rival-weak", 0.10, { relativeTroopRatio: 2.2 });

const observation = (rivals = [odin, katanasan, strong, weak], overrides = {}) => ({
  turnNumber: 12000,
  phase: "active",
  ownState: {
    tileShare: 0.24,
    troops: 2_000_000,
    troopRatio: 0.8,
    gold: 10_000_000,
    incomingAttacks: [],
  },
  visiblePlayers: rivals,
  endgame: {
    leaderName: "odin free",
    leaderTileShare: 0.40,
    ownTileShare: 0.24,
    turnsToTimer: 100,
  },
  tacticalAffordances: {
    transportTroopBanking: { incomingThreatRatio: 0 },
    economyCadence: {
      homeDanger: "low",
      recommended: false,
      recentExpansionCount: 4,
      recentBuildCount: 1,
    },
    navalControl: { recommended: false },
  },
  ...overrides,
});

const hold = { id: "hold", kind: "hold", risk: { level: "low" }, metadata: {} };
const neutral = {
  id: "attack:neutral:35",
  kind: "attack",
  label: "Expand into neutral territory",
  risk: { level: "low" },
  metadata: { expansion: true, targetName: "Terra Nullius" },
};
const targeted = (kind, target, overrides = {}) => ({
  id: `${kind}:${target.playerID}:40`,
  kind,
  label: `${kind} ${target.name}`,
  risk: { level: "medium" },
  metadata: {
    targetID: target.playerID,
    targetName: target.name,
    relativeTroopRatio: target.relativeTroopRatio,
    targetTileShare: target.tileShare,
  },
  ...overrides,
});
const attack = (target) => targeted("attack", target);
const allianceRequest = (target) => targeted("alliance_request", target, { risk: { level: "low" } });
const donate = (target, kind = "donate_gold") => targeted(kind, target, { risk: { level: "low" } });
const nuke = (unit, target, priority = 180) => ({
  id: `nuke:${target.playerID}:${unit}`,
  kind: "nuke",
  label: `${unit} against ${target.name}`,
  risk: { level: "high" },
  metadata: {
    unit,
    targetID: target.playerID,
    targetName: target.name,
    nuclearTargetPriority: priority,
    targetStructurePriority: 94,
    targetSamCoverage: 0,
  },
});

for (const ally of [odin, katanasan]) {
  test(`Gravity immediately requests alliance with ${ally.name}`, () => {
    assert.equal(
      choose([neutral, attack(strong), allianceRequest(ally), hold], observation()).id,
      allianceRequest(ally).id,
    );
  });

  test(`Gravity retries ${ally.name} request while observation is not allied`, () => {
    const action = allianceRequest(ally);
    assert.equal(choose([action, neutral, hold], observation()).id, action.id);
    assert.equal(choose([action, neutral, hold], observation()).id, action.id);
  });

  test(`Gravity stops privileging ${ally.name} request after hasAlliance`, () => {
    const allied = { ...ally, isAllied: true, hasAlliance: true };
    const rivals = [
      ...(ally === odin ? [allied, katanasan] : [odin, allied]),
      strong,
      weak,
    ];
    assert.notEqual(
      choose([allianceRequest(allied), neutral, hold], observation(rivals)).kind,
      "alliance_request",
    );
  });
}

for (const ally of [odin, katanasan]) {
  for (const kind of [
    "attack", "boat", "warship", "move_warship", "embargo",
    "target_player", "alliance_reject", "break_alliance",
  ]) {
    test(`Gravity never selects ${kind} against ${ally.name}`, () => {
      assert.equal(choose([targeted(kind, ally), hold], observation()).id, hold.id);
    });
  }

  test(`Gravity never nukes ${ally.name}`, () => {
    assert.equal(choose([nuke("Atom Bomb", ally), hold], observation()).id, hold.id);
  });
}

test("Gravity protects an ally matched only by normalized observed player ID", () => {
  const spacedOdin = player("  ODIN   FREE  ", odin.playerID, odin.tileShare);
  const idOnlyAttack = targeted("attack", odin);
  delete idOnlyAttack.metadata.targetName;
  idOnlyAttack.label = "Attack player";
  assert.equal(
    choose([idOnlyAttack, hold], observation([spacedOdin, katanasan, strong])).id,
    hold.id,
  );
});

test("Gravity protects a Unicode-normalized katanasan name", () => {
  const fullwidth = targeted("attack", katanasan);
  delete fullwidth.metadata.targetID;
  fullwidth.metadata.targetName = "ＫＡＴＡＮＡＳＡＮ";
  fullwidth.label = "Attack player";
  assert.equal(choose([fullwidth, hold], observation()).id, hold.id);
});

test("Gravity protects both visible K1Z alliance names", () => {
  const taggedOdin = player("K1Z odin free", "odin-live", odin.tileShare);
  const taggedKatana = player("K1Z katanasan", "katana-live", katanasan.tileShare);
  const taggedOdinAttack = targeted("attack", taggedOdin);
  const taggedKatanaNuke = nuke("Atom Bomb", taggedKatana);
  taggedOdinAttack.label = "Attack player";
  taggedKatanaNuke.label = "Nuclear strike";
  assert.equal(
    choose([taggedOdinAttack, hold], observation([taggedOdin, taggedKatana, strong])).id,
    hold.id,
  );
  assert.equal(
    choose([taggedKatanaNuke, hold], observation([taggedOdin, taggedKatana, strong])).id,
    hold.id,
  );
});

test("Gravity attacks the strongest reachable outsider, never an ally", () => {
  const giantKatana = { ...katanasan, tileShare: 0.70 };
  const selected = choose(
    [attack(giantKatana), attack(weak), attack(strong), hold],
    observation([odin, giantKatana, strong, weak]),
  );
  assert.equal(selected.metadata.targetID, strong.playerID);
});

test("Gravity always fires a safe outsider nuke", () => {
  assert.equal(choose([attack(strong), nuke("Atom Bomb", strong), hold], observation()).kind, "nuke");
});

test("Gravity prefers MIRV when outsider nuclear priority is equal", () => {
  assert.equal(
    choose([
      nuke("Atom Bomb", strong),
      nuke("Hydrogen Bomb", strong),
      nuke("MIRV", strong),
    ], observation()).metadata.unit,
    "MIRV",
  );
});

test("Gravity supports Odin before katanasan", () => {
  assert.equal(
    choose([donate(katanasan), donate(odin), hold], observation()).metadata.targetID,
    odin.playerID,
  );
});

test("Gravity can support katanasan when Odin support is unavailable", () => {
  assert.equal(choose([donate(katanasan), hold], observation()).metadata.targetID, katanasan.playerID);
});

test("K1Z is Gravity's only shared alliance layer", () => {
  assert.equal(ALLIANCE_TAG, "[K1Z]");
});
