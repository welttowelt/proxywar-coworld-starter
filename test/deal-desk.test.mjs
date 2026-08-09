import assert from "node:assert/strict";
import test from "node:test";

import { chooseDealMove, dealConstraints } from "../deal-desk.mjs";

// Shapes follow the canonical structured-deal starter contract
// (0xNad/proxywar-coworld-starter llm-player.mjs + starter-player.mjs,
// engine 0.1.26): deal actions ride the separate selectedDealActionId slot,
// proposals/active pacts arrive in obs.deals, obligations bind per obligor
// while status === "pending".

function dealAction(id, kind, metadata = {}) {
  return { id, kind, label: id, risk: { level: "low" }, metadata };
}

function observationWithDeals({
  ownID = "odin",
  incomingProposals = [],
  activeDeals = [],
  outgoingProposals = [],
  visiblePlayers = [],
} = {}) {
  return {
    phase: "active",
    ownState: { playerID: ownID, tileShare: 0.05, troops: 500000, troopRatio: 0.9 },
    deals: { incomingProposals, activeDeals, outgoingProposals },
    visiblePlayers: visiblePlayers.map((player) => ({
      isAlive: true,
      sharesBorder: true,
      canAttack: true,
      isAllied: false,
      ...player,
    })),
  };
}

const nap = (dealID, proposerPlayerID, proposerName) => ({
  dealID,
  proposerPlayerID,
  proposerName,
  terms: { template: "non_aggression_pact" },
});

test("deal desk accepts a non-aggression offer from a stronger neighbor", () => {
  const accept = dealAction("deal:accept:1", "deal_accept", { dealID: "d1" });
  const obs = observationWithDeals({
    incomingProposals: [nap("d1", "bigger", "Bigger")],
    visiblePlayers: [
      { playerID: "bigger", name: "Bigger", tileShare: 0.2, relativeTroopRatio: 0.7 },
    ],
  });
  const move = chooseDealMove([accept], obs, null, []);
  assert.equal(move?.id, accept.id);
});

test("deal desk rejects templates the selector cannot honor automatically", () => {
  const acceptPledge = dealAction("deal:accept:2", "deal_accept", { dealID: "d2" });
  const reject = dealAction("deal:reject:2", "deal_reject", { dealID: "d2" });
  const obs = observationWithDeals({
    incomingProposals: [{
      dealID: "d2",
      proposerPlayerID: "schemer",
      proposerName: "Schemer",
      terms: { template: "attack_pledge" },
    }],
    visiblePlayers: [
      { playerID: "schemer", name: "Schemer", tileShare: 0.1, relativeTroopRatio: 1.0 },
    ],
  });
  const move = chooseDealMove([acceptPledge, reject], obs, null, []);
  assert.equal(move?.id, reject.id);
});

test("deal desk refuses peace with the active convert target", () => {
  const accept = dealAction("deal:accept:3", "deal_accept", { dealID: "d3" });
  const obs = observationWithDeals({
    incomingProposals: [nap("d3", "prey", "Prey")],
    visiblePlayers: [
      { playerID: "prey", name: "Prey", tileShare: 0.04, relativeTroopRatio: 1.6 },
    ],
  });
  const plan = { intent: "convert", targetID: "prey", horizon: 4 };
  const move = chooseDealMove([accept], obs, plan, []);
  assert.equal(move, null);
});

test("deal desk proposes one pact to the most dangerous bordered rival", () => {
  const toBully = dealAction("deal:propose:bully", "deal_propose", {
    template: "non_aggression_pact",
    recipientID: "bully",
  });
  const toMinnow = dealAction("deal:propose:minnow", "deal_propose", {
    template: "non_aggression_pact",
    recipientID: "minnow",
  });
  const obs = observationWithDeals({
    visiblePlayers: [
      { playerID: "minnow", name: "Minnow", tileShare: 0.02, relativeTroopRatio: 1.8 },
      { playerID: "bully", name: "Bully", tileShare: 0.22, relativeTroopRatio: 0.6 },
    ],
  });
  const move = chooseDealMove([toBully, toMinnow], obs, null, []);
  assert.equal(move?.id, toBully.id);
});

test("deal desk keeps at most one open outgoing proposal", () => {
  const toBully = dealAction("deal:propose:bully", "deal_propose", {
    template: "non_aggression_pact",
    recipientID: "bully",
  });
  const obs = observationWithDeals({
    outgoingProposals: [{ recipientPlayerID: "elsewhere" }],
    visiblePlayers: [
      { playerID: "bully", name: "Bully", tileShare: 0.22, relativeTroopRatio: 0.6 },
    ],
  });
  const move = chooseDealMove([toBully], obs, null, []);
  assert.equal(move, null);
});

test("deal desk never proposes to the convert target or an ally", () => {
  const toPrey = dealAction("deal:propose:prey", "deal_propose", {
    template: "non_aggression_pact",
    recipientID: "prey",
  });
  const toFriend = dealAction("deal:propose:friend", "deal_propose", {
    template: "non_aggression_pact",
    recipientID: "friend",
  });
  const obs = observationWithDeals({
    visiblePlayers: [
      { playerID: "prey", name: "Prey", tileShare: 0.2, relativeTroopRatio: 1.6 },
      { playerID: "friend", name: "Friend", tileShare: 0.25, relativeTroopRatio: 0.7, isAllied: true },
    ],
  });
  const plan = { intent: "convert", targetID: "prey", horizon: 4 };
  const move = chooseDealMove([toPrey, toFriend], obs, plan, []);
  assert.equal(move, null);
});

test("deal desk is silent when the match offers no deal surface", () => {
  const obs = { phase: "active", ownState: { playerID: "odin" } };
  assert.equal(chooseDealMove([dealAction("x", "deal_accept", { dealID: "d" })], obs, null, []), null);
});

test("deal constraints bind only pending own obligations", () => {
  const obs = observationWithDeals({
    activeDeals: [
      {
        template: "non_aggression_pact",
        proposerPlayerID: "odin",
        recipientPlayerID: "partner",
        proposerName: "Odin",
        recipientName: "Partner",
        obligations: [
          { obligorPlayerID: "odin", status: "pending" },
          { obligorPlayerID: "partner", status: "pending" },
        ],
      },
      {
        template: "non_aggression_pact",
        proposerPlayerID: "done", recipientPlayerID: "odin",
        proposerName: "Done", recipientName: "Odin",
        obligations: [{ obligorPlayerID: "odin", status: "fulfilled" }],
      },
      {
        template: "trade_security_pact",
        proposerPlayerID: "trader", recipientPlayerID: "odin",
        proposerName: "Trader", recipientName: "Odin",
        obligations: [{ obligorPlayerID: "odin", status: "pending" }],
      },
    ],
  });
  const constraints = dealConstraints(obs);
  assert.deepEqual([...constraints.noAttack].sort(), ["partner", "trader"]);
  assert.deepEqual([...constraints.noEmbargo], ["trader"]);
});

test("strategy-engine's inline pact extractor stays in parity with the deal desk", async () => {
  const { buildState } = await import("../strategy-engine.mjs");
  const obs = observationWithDeals({
    activeDeals: [
      {
        template: "non_aggression_pact",
        proposerPlayerID: "partner", recipientPlayerID: "odin",
        proposerName: "Partner", recipientName: "Odin",
        obligations: [{ obligorPlayerID: "odin", status: "pending" }],
      },
      {
        template: "trade_security_pact",
        proposerPlayerID: "odin", recipientPlayerID: "trader",
        proposerName: "Odin", recipientName: "Trader",
        obligations: [{ obligorPlayerID: "odin", status: "pending" }],
      },
      {
        template: "non_aggression_pact",
        proposerPlayerID: "lapsed", recipientPlayerID: "odin",
        proposerName: "Lapsed", recipientName: "Odin",
        obligations: [{ obligorPlayerID: "odin", status: "fulfilled" }],
      },
    ],
  });
  const fromDesk = [...dealConstraints(obs).noAttack]
    .map((partnerID) => partnerID.toLowerCase()).sort();
  const state = buildState(obs, [], []);
  assert.deepEqual([...state.self.dealNoAttackIDs].sort(), fromDesk);
});
