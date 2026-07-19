# GC2 substitution-causal diagnosis

Date: 2026-07-19  
Candidate: `sha256:593eedf2...` at source `9efe990d`  
Parent: exact v89 `sha256:ebd9eed3...`  
Verdict: broad GC2 rejected; outputs quarantined for advancement

## Result

Broad GC2 changed the deterministic outcome and finished `253` tiles and
`0.0024752717` score behind exact v89. Odin remained alive and derived second
in both arms, but candidate degraded decisions rose from `146` to `147`.

Only the first substitution is a clean per-decision counterfactual. Candidate
and parent are identical through turn 400. At turn 500, GC2 replaces a Juryoku
alliance request with a neutral 10-percent land attack; the legal sets and
request state are still identical before that choice. At the next audit
checkpoint, the candidate is `+432` tiles and `+18,247` troops. Every later
comparison is downstream-confounded by the diverged ownership, action history,
legal IDs, and unit numbering.

## Eleven candidate substitutions

| Turn | Candidate | Same-ordinal parent | Assessment |
| ---: | --- | --- | --- |
| 500 | neutral land attack 10% | request Juryoku | clean early benefit |
| 600 | neutral land attack 10% | request Katanasan | likely benefit, confounded |
| 800 | neutral land attack 20% | neutral land attack 10% | mixed, confounded |
| 3800 | neutral boat 16% | Factory upgrade | likely harm |
| 4000 | neutral boat 8% | neutral boat 16% | likely harm |
| 7000 | build Warship | build Port | harm; warship absent next checkpoint |
| 7200 | upgrade Missile Silo | upgrade City | likely harm |
| 10200 | upgrade Port | upgrade Port | structurally neutral |
| 10400 | upgrade City | upgrade City | structurally neutral |
| 13400 | upgrade City | upgrade City | structurally neutral |
| 13600 | upgrade Port | upgrade City | mixed |

The first three markers occur at own tile shares `0`, `0`, and `0.01`, with
neutral land legal and no incoming threat. The other eight occur at shares
`0.28-0.29`, with zero neutral-land actions. Candidate alliances still form
earlier than the parent: Juryoku turn `700` versus `3600`, Katanasan `900`
versus `3700`, and Hrafn `3600` versus `4300`. That confirms the broad arm did
not buy its early expansion by permanently losing the coalition.

Final candidate versus parent:

- tiles: `29,877` versus `30,130`;
- score: `0.2923070902` versus `0.2947823620`;
- troops: candidate `+467`;
- gold: candidate `-15,582,286`.

## Smallest next arm: GC2-NL1

Preregister one narrow arbitration rule:

1. The selected action is an outbound, non-K1Z alliance request.
2. Reverse-handshake and K1Z-priority paths remain unchanged.
3. The replacement is an `attack` on Terra Nullius with
   `metadata.expansion=true`.
4. The replacement is land, never a boat.
5. Own tile share is below `0.12`.
6. At least one neutral-land action is legal.
7. Incoming threat is zero and territory is not collapsing.

This rule predicts exactly three markers on the observed candidate trace:
turns `500`, `600`, and `800`. It prohibits the two boats, the Warship, and all
five upgrades.

Pre-registered stop conditions:

- reject if pinned-fixture reach is not exactly three;
- reject any marker at tile share `>=0.12`, on a non-land action, or against a
  protected K1Z identity;
- reject any hold, rejected decision, first-contact loss, or alliance formation
  later than candidate turns `700/900/3600`;
- reject unless every marked attack gains tiles at its next audit checkpoint;
- in the exact matched pair, require score `>0.2947823619766953` and final
  tiles `>30130`, with no reliability-count regression;
- if that pair passes, require advantage in a separate mirrored seat/seed pair
  before any hosted gate.

## Evidence boundary

The source pair began without Hrafn's required exact-hash pre-run approval.
Both outputs remain quarantined and cannot qualify or promote any policy. This
diagnosis uses them only to reject broad GC2 and to form a testable narrower
hypothesis. It does not establish GC2-NL1 advantage.

Primary audit:
`audit-qd1n-global-alliance-arbitration-gc2-matched-20260719.json`.
