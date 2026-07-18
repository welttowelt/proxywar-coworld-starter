import test from "node:test";
import assert from "node:assert/strict";

process.env.PROXYWAR_SELF_TEST = "1";
const { choose } = await import("./llm-player.mjs?kuroi-taiyo-test");

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

const observation = (rivals) => ({
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
    leaderTileShare: 0.4,
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
});

const odin = player("odin free", "odin-1", 0.4, { isAllied: true });
const strong = player("Takeda Rival", "rival-strong", 0.32, { relativeTroopRatio: 1.2 });
const weak = player("Mori Rival", "rival-weak", 0.1, { relativeTroopRatio: 2.2 });
const obs = observation([odin, strong, weak]);

const hold = { id: "hold", kind: "hold", risk: { level: "low" }, metadata: {} };
const attack = (target, percent = 40) => ({
  id: `attack:${target.playerID}:${percent}`,
  kind: "attack",
  risk: { level: "medium" },
  metadata: {
    targetID: target.playerID,
    targetName: target.name,
    relativeTroopRatio: target.relativeTroopRatio,
    targetTileShare: target.tileShare,
  },
});
const nuke = (unit, target, priority = 180) => ({
  id: `build:${unit}:silo-1`,
  kind: "nuke",
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

test("Kuroi Taiyo always fires a safe non-Odin nuke", () => {
  assert.equal(choose([attack(strong), nuke("Atom Bomb", strong), hold], obs).kind, "nuke");
});

test("Kuroi Taiyo never fires a nuke at Odin", () => {
  assert.equal(choose([nuke("Atom Bomb", odin), hold], obs).id, "hold");
});

test("Kuroi Taiyo prefers MIRV when nuclear target priority is equal", () => {
  assert.equal(
    choose([nuke("Atom Bomb", strong), nuke("Hydrogen Bomb", strong), nuke("MIRV", strong)], obs).metadata.unit,
    "MIRV",
  );
});

test("Kuroi Taiyo builds its first Missile Silo before ordinary combat", () => {
  const silo = {
    id: "build:Missile Silo:440044",
    kind: "build",
    risk: { level: "low" },
    metadata: { unit: "Missile Silo", cost: "1000000" },
  };
  assert.equal(choose([attack(weak), attack(strong), silo, hold], obs).id, silo.id);
});

test("Kuroi Taiyo attacks the strongest reachable non-Odin rival", () => {
  assert.equal(choose([attack(weak), attack(strong), hold], obs).metadata.targetID, strong.playerID);
});

test("Kuroi Taiyo never breaks its alliance with Odin", () => {
  const breakOdin = {
    id: "break_alliance:odin-1",
    kind: "break_alliance",
    risk: { level: "low" },
    metadata: { targetID: odin.playerID, targetName: odin.name },
  };
  assert.equal(choose([breakOdin, hold], obs).id, "hold");
});

const gravity = player("juryoku-koku", "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335", 0.28);
const gravityObs = observation([odin, gravity, strong, weak]);
const allianceRequest = (target) => ({
  id: `alliance_request:${target.playerID}`,
  kind: "alliance_request",
  risk: { level: "low" },
  metadata: { targetID: target.playerID, targetName: target.name },
});

test("Kuroi Taiyo immediately requests a Gravity alliance while unallied", () => {
  assert.equal(
    choose([attack(strong), allianceRequest(gravity), hold], gravityObs).kind,
    "alliance_request",
  );
});

test("Kuroi Taiyo never attacks Gravity even when Gravity is strongest", () => {
  const leadingGravity = { ...gravity, tileShare: 0.75 };
  const selected = choose(
    [attack(leadingGravity), attack(strong), hold],
    observation([odin, leadingGravity, strong, weak]),
  );
  assert.equal(selected.metadata.targetID, strong.playerID);
});

test("Kuroi Taiyo never nukes Gravity by exact player ID", () => {
  const idOnlyNuke = nuke("MIRV", gravity);
  delete idOnlyNuke.metadata.targetName;
  idOnlyNuke.label = "Nuclear strike";
  assert.equal(choose([idOnlyNuke, hold], gravityObs).id, hold.id);
});

test("Kuroi Taiyo stops requesting Gravity after the alliance is observed", () => {
  const alliedGravity = { ...gravity, isAllied: true, hasAlliance: true };
  assert.notEqual(
    choose(
      [allianceRequest(alliedGravity), attack(strong), hold],
      observation([odin, alliedGravity, strong, weak]),
    ).kind,
    "alliance_request",
  );
});
