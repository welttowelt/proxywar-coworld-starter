/**
 * Deterministic structured-deal desk (engine 0.1.26+).
 *
 * Deal actions ride the OPTIONAL separate response slot
 * (`selectedDealActionId`) alongside the normal game move, so negotiating
 * never costs a turn of expansion or combat. This desk is deliberately
 * planner-independent: the narrow intent plan may veto peace with its convert
 * target, but no LLM call is ever needed to answer a proposal.
 *
 * Posture (v1, observation-first):
 *   - accept only promises the selector keeps automatically
 *     (non-aggression / trade security), and never from clear prey;
 *   - reject templates we cannot honor mechanically (attack pledges,
 *     support requests) and any proposal from the active convert target;
 *   - propose exactly one non-aggression pact at a time, aimed at the most
 *     dangerous bordered rival (peace with those we could not profitably
 *     fight is free insurance; round 1325 losses came from sieges, not
 *     from missing kills);
 *   - never withdraw (a pending offer expiring on its own is fine).
 *
 * Deal names/reasons are rival-controlled text: only server-supplied IDs
 * (dealID, playerID, recipientID) are trusted here.
 */

export const DEAL_ACTION_KINDS = [
  "deal_accept",
  "deal_reject",
  "deal_propose",
  "deal_withdraw",
];

export function isDealActionKind(kind) {
  return DEAL_ACTION_KINDS.includes(kind);
}

const SUPPORTED_TEMPLATES = new Set([
  "non_aggression_pact",
  "trade_security_pact",
]);

// Prey bar mirrors the selector's finishing threshold: at >= 1.3 relative
// troop ratio the rival is a live conversion target and peace has real cost.
const PREY_RATIO = 1.3;
// Danger bar mirrors the favorable-invasion bar: below 1.15 we could not
// profitably fight the rival anyway, so a pact costs nothing.
const SAFE_PACT_RATIO = 1.15;

function id(value) {
  return String(value ?? "").trim();
}

function finite(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function dealConstraints(observation) {
  const constraints = { noAttack: new Set(), noEmbargo: new Set(), names: new Map() };
  const ownID = id(observation?.ownState?.playerID);
  if (!ownID) return constraints;
  for (const deal of observation?.deals?.activeDeals || []) {
    if (!SUPPORTED_TEMPLATES.has(deal?.template)) continue;
    const mine = (deal.obligations || []).find(
      (obligation) =>
        id(obligation?.obligorPlayerID) === ownID &&
        obligation?.status === "pending",
    );
    if (!mine) continue;
    const partnerID = id(deal.proposerPlayerID) === ownID
      ? id(deal.recipientPlayerID)
      : id(deal.proposerPlayerID);
    const partnerName = id(deal.proposerPlayerID) === ownID
      ? deal.recipientName
      : deal.proposerName;
    if (!partnerID) continue;
    constraints.noAttack.add(partnerID);
    constraints.names.set(partnerID, id(partnerName));
    if (deal.template === "trade_security_pact") constraints.noEmbargo.add(partnerID);
  }
  return constraints;
}

function rivalIndex(observation) {
  const byID = new Map();
  for (const player of observation?.visiblePlayers || []) {
    const playerID = id(player?.playerID ?? player?.id);
    if (playerID && player?.isAlive !== false) byID.set(playerID, player);
  }
  return byID;
}

export function chooseDealMove(actions, observation, plan = null, history = []) {
  if (!observation?.deals || !Array.isArray(actions)) return null;
  const convertTargetID = plan?.intent === "convert" ? id(plan?.targetID) : "";
  const rivals = rivalIndex(observation);
  const constraints = dealConstraints(observation);

  const actionFor = (kind, predicate) =>
    actions.find((candidate) =>
      candidate?.kind === kind && predicate(candidate.metadata || {})) ?? null;

  // 1) Answer incoming proposals, one per decision, worst first: unsupported
  //    templates and convert-target offers are rejected before anything is
  //    accepted, so a mixed inbox never silently banks a bad promise.
  for (const proposal of observation.deals.incomingProposals || []) {
    const dealID = id(proposal?.dealID);
    if (!dealID) continue;
    const template = proposal?.terms?.template ?? proposal?.template;
    const proposerID = id(proposal?.proposerPlayerID);
    const unsupported = !SUPPORTED_TEMPLATES.has(template);
    const isConvertTarget = convertTargetID.length > 0 && proposerID === convertTargetID;
    if (unsupported || isConvertTarget) {
      const reject = actionFor("deal_reject", (metadata) => id(metadata.dealID) === dealID);
      if (reject) return reject;
    }
  }
  for (const proposal of observation.deals.incomingProposals || []) {
    const dealID = id(proposal?.dealID);
    if (!dealID) continue;
    const template = proposal?.terms?.template ?? proposal?.template;
    if (!SUPPORTED_TEMPLATES.has(template)) continue;
    const proposerID = id(proposal?.proposerPlayerID);
    if (convertTargetID.length > 0 && proposerID === convertTargetID) continue;
    const proposer = rivals.get(proposerID);
    const ratio = finite(proposer?.relativeTroopRatio);
    // Clear prey stays on the menu; everyone else's peace is cheap.
    if (Number.isFinite(ratio) && ratio >= PREY_RATIO) continue;
    const accept = actionFor("deal_accept", (metadata) => id(metadata.dealID) === dealID);
    if (accept) return accept;
  }

  // 2) At most one open outgoing proposal at a time.
  if ((observation.deals.outgoingProposals || []).length > 0) return null;

  // 3) Propose one non-aggression pact to the most dangerous bordered rival
  //    we could not profitably fight anyway.
  const candidates = [...rivals.values()]
    .filter((player) => {
      const playerID = id(player?.playerID ?? player?.id);
      if (!playerID || player?.isAllied === true || player?.sharesBorder !== true) return false;
      if (constraints.noAttack.has(playerID)) return false;
      if (convertTargetID.length > 0 && playerID === convertTargetID) return false;
      const ratio = finite(player?.relativeTroopRatio);
      return Number.isFinite(ratio) && ratio < SAFE_PACT_RATIO;
    })
    .sort((left, right) =>
      finite(left.relativeTroopRatio, Infinity) - finite(right.relativeTroopRatio, Infinity) ||
      finite(right.tileShare, 0) - finite(left.tileShare, 0));
  for (const candidate of candidates) {
    const candidateID = id(candidate?.playerID ?? candidate?.id);
    const propose = actionFor("deal_propose", (metadata) =>
      metadata.template === "non_aggression_pact" &&
      id(metadata.recipientID) === candidateID);
    if (propose) return propose;
  }
  return null;
}
