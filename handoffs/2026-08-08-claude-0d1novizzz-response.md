# Forensic review — 0d1novizzz / xX_UwU_Senpai_420_Xx:v10, round 1325

Reviewer: Claude (0d1novizzz handover lane, 2026-08-08). Review-only: no upload,
submit, retire, or membership change. Repo at commit `084e82d6`. All four replays
downloaded and SHA-256-verified against
`experiments/evidence-round-1325-v0125-dual-handoff-20260808.json` (4/4 exact match).

## Verdict label (calibrated)

**CANDIDATE (marker `ug1`) — World-only upgrade-replacement guard.**
Load-bearing caveats in the label: the transport arm's filter pass-rate is
UNMEASURED (replay decision records carry legal-action IDs only, no metadata);
the attack arm's firing band is measured SMALL (~12 decisions across 4 episodes);
no artifact-to-commit receipt proves repo HEAD is the deployed v10 image, so all
line cites below are to HEAD `084e82d6`, whose public-reason family matches the
replays but is not receipt-proven identical.

## Why rank 22 despite overall #1

Round score 0 = 0/4 episode wins (two eliminations, two frozen survivors).
Overall rank 1 is the 344-round accumulator, untouched by one bad round.
Three measured failure signatures, in order of decisions burned:

1. **Upgrade-lock at a frozen frontier** (the in-scope one). When the plateau
   menu has no neutral land, no favorable invasion, and build is on cadence
   cooldown, `chooseParentAction` falls through to `chooseUtility`
   (strategy-engine.mjs:945), which returns the FIRST legal
   upgrade unconditionally — no reserve, exposure, or value check
   (strategy-engine.mjs:779-793, order list at 783-785). The existing `cv1`
   rescue cannot fire in this state: `boatConversionStalled` requires ≥6 boats
   in the last 10 decisions (strategy-engine.mjs:663-675), and an upgrade-lock
   produces no boats. `chooseBoat` returned null throughout the plateaus because
   the offered boats are tile-target transports whose rival is unresolvable or
   whose `relativeTroopRatio` fails the ≥1.15 favorable-invasion bar
   (strategy-engine.mjs:744-746), and no neutral boats remained.
2. **Degraded-runtime action mix** (out of scope for this arm, but dominant in
   ep 0776897b): 364 fallback / 361 degraded decisions in the round; ep
   0776897b alone burned 60 decisions on `dgd:err:nuk` and 39 on `dgd:err:atk`
   while holding a 40,000-tile plateau (turns 13200–16400), then collapsed.
3. **Overextension collapse under degradation** (ep ab2e1fcd): 88,631 →
   100,370 tiles at turn 10000 via `dgd:err:atk`, bled back to 51,936 by turn
   10400 — a 400-turn round-trip that shows unguarded conversion pressure has a
   real cost side.

Deals are correctly excluded: the only two structured-deal users ranked 14th
and 15th. The field gap is conversion volume: daveey (rank 1) 406 attack / 387
boat / 178 upgrade vs Odin 200 / 200 / 327.

## 1. Earliest optional upgrade before each irreversible frontier loss

"Optional" = `upgrade_structure` selected while attack or boat actions were
legal. Loss anchor = last decision at ≥80% of episode peak tiles.

| Episode | Outcome | Loss anchor (turn/tiles) | Earliest optional upgrade | Evidence |
|---|---|---|---|---|
| de60a365 (Andre win) | eliminated | turn 16800 / 38,389 | **seq 1120, turn 13100**: chose `upgrade:Port:306` with `attack:28k1hctz` (= SIAN VOIDCROWN) legal at 10/25/40%, 12 boats legal, 1.23M troops, 48.3M gold; own obs said `attackable=1, bordered=1`. 36 optional upgrades total before the anchor; plateau frozen at 39,450 tiles from turn 13100. | replay de60a365, decisions.jsonl seq 1120-1311 |
| ab2e1fcd (Andre win) | alive 45,969 | (peak-band anchor distorted by the turn-10000 spike) real freeze: turns 12900–21300 at 46,015 tiles | **seq 1227, turn 13100**: chose `upgrade:City:1833` with 6+ transports legal (`boat:<tile>:8/16/25`), 0 attacks, 2.04M troops, 28.1M gold. 83 upgrades in the 85-decision frozen run; 199/200 episode upgrades had boats legal, 0/200 had attacks legal. | replay ab2e1fcd, seq 1227-1913 |
| 0776897b (Auri win) | eliminated | turn 21400 / 38,188 | **seq 1801, turn 21300** (`dgd:err:upg`, 9 boats legal) — but only 2 optional upgrades exist pre-anchor; the plateau (turns 13200–16400 at 40,000 tiles) was burned on 32 nukes, not upgrades. The guard would have had ~no effect here. | replay 0776897b, seq 1801, 1806 |
| 31865160 (SIAN win) | alive 1,861 | turn 8300 / 29,607 | **seq 757, turn 7400** (`dgd:err:upg:cv1`, 16 boats legal, gold only 291k — reserve constraint would matter). Single optional upgrade pre-anchor; this loss was a fast military collapse, not an upgrade sink. | replay 31865160, seq 757 |

Honest band statement (no overgeneralization): the guard's real firing band is
**de60a365 + ab2e1fcd** (~106 optional-upgrade decisions). It does not address
0776897b (nuke sink) or 31865160 (fast collapse), and must not be sold as a
4-episode fix.

## 2. Do the needed fields reach the selector? Yes — with one gap

`buildState` (strategy-engine.mjs:176-229) delivers, per decision, without raw
state: reserve (`self.troops`, `self.troopRatio`, `self.gold`), exposure
(`self.borderTiles`, `self.incomingAttacks`, `self.incomingAttackerIDs`,
`hasCurrentPressure` at 997-1001), target quality (per-rival `tileShare`,
`relativeTroopRatio`, `sharesBorder`, `isAllied`, `relation`, `canAttack`),
frontier-freeze detection (`history[].tileShare`, recorded at 1161-1188), and
the raw `actions` array with `metadata.targetID/expansion/troopPercent` +
`risk.level` reaching the selector directly (llm-player.mjs:199-219).
**Gap:** `tacticalAffordances` is empty on all 979 Odin decisions in the round
— the trigger must not rely on affordances (see missing data).

## 3. Preregistered guard (World-only, no deal logic, no planner change)

Wrap only the utility-fallback upgrade (the return path through
strategy-engine.mjs:945-946). Never touches defensive builds, cv1, collapse
handling, or any non-World map.

**Trigger — all must hold:**
- `state.mapFingerprint === "World"`;
- baseline selection is `upgrade_structure` from `chooseUtility`;
- no exposure: `hasCurrentPressure(state)` false and `incomingThreatCount` 0;
- upgrade-lock signature (distinct from cv1's boat-stall): ≥4
  `upgrade_structure` entries in the last 8 history entries AND `tileShare`
  flat within ±0.002 over those 8;
- reserve: `troopRatio ≥ 0.8` and `troops ≥ 200000` (floor inferred from the
  measured band's 1.2M–2.2M troops — no emit run; tune in the experiment).

**Replacement — first that qualifies, else keep the parent's upgrade (never
hold, never reject):**
1. best safe land attack: non-neutral, `risk.level !== "high"`, rival resolves,
   not allied/protected/reciprocal-set, `relativeTroopRatio ≥ 1.15`, lowest
   percent tier;
2. else neutral expansion attack (`isNeutralExpansion`, safe);
3. else transport at the 8% tier: neutral boat, or invasion boat passing the
   same 1.15 bar with resolvable rival.

**Marker:** `ug1` (public reason `pln:atk:ug1` / `pln:b0t:ug1` /
`dgd:err:b0t:ug1`), consistent with the cu1/cv1/gc1 family
(llm-player.mjs:171-181).

**Known risk (cost side):** each firing commits 8–25% of a 1–2M troop stack;
ab2e1fcd's own turn-10000 spike (+11,739 then −48,434 tiles in 400 turns) is
the measured warning that conversion pressure without the exposure gate loses
tiles. The reject conditions below are the containment.

## 4. Red regression first

Add to `test/strategy-engine.test.mjs` (World state via spawn tile 1088580,
following the existing cv1 fixtures at lines 70-114):
- RED: history = 8 entries, ≥4 upgrades, flat `tileShare` 0.16; actions =
  [upgrade:City, safe rival attack with `relativeTroopRatio` 1.3, hold] →
  assert selector returns the attack with `policyMarker === "ug1"` (fails on
  parent, which returns the upgrade — that is the bug under test);
- safety (must stay green on parent AND candidate): incoming attack present →
  upgrade unchanged; `troopRatio` 0.7 → unchanged; Pangaea/Asia fingerprint →
  unchanged; no qualifying target → upgrade unchanged, never hold.

## 5. Smallest valid experiment (in order — step 1 gates step 2)

1. **Metadata-logging local episode (no membership, no upload):** one local
   World 12P episode with `DEBUG_ACTIONS` extended to dump full legal-action
   metadata (expansion flag, targetID, risk) during a plateau. Purpose: measure
   the transport arm's pass-rate through the replacement filters — the one
   number the replays cannot provide. If pass-rate ≈ 0, the guard collapses to
   its (small, ~12-decision) attack arm and the arm should be re-scoped before
   any fleet run.
2. **Mirrored-seat pair run:** candidate vs exact parent v10 image, World-only,
   ≥4 mirrored seat pairs (0.1.24+ deterministic spawns make seats comparable).
   Reject on: zero `ug1` firings, any unexplained hold/reject, coalition harm
   (any ug1 action resolving to an allied/reciprocal-set rival), or no matched
   advantage (tiles at fixed turn / episode wins) vs parent.

## Missing data (blocking or degrading confidence)

1. `tacticalAffordances` = `{}` on every Odin decision in all four replays —
   the collector's `conversion_recommended`/`*_recommended` columns are
   silently null for this policy on engine 0.1.25. Either the engine stopped
   emitting affordances or the policy runtime never surfaces them. Worth an
   upstream check; until then no trigger may reference affordances.
2. Legal-action metadata absent from replay decision records (IDs only, e.g.
   `boat:651658:8`) — transport eligibility unmeasurable offline; hence
   experiment step 1.
3. No artifact-to-commit receipt for the deployed v10 image (handoff already
   flags this). Repo-HEAD cites are consistent with replay reason strings
   (`pln:upg`, `dgd:err:*`, `cv1`) but not proven identical.
4. `observationSummary` is a truncated string (usable for cross-checks like
   `attackable=1` at de60a365 seq 1120, not for reconstruction).

## Addendum (2026-08-08, post-review implementation pass under /goal)

The guard has been sharpened and LANDED LOCALLY (branch pending push; no
upload/submit/membership touched):

1. **Root cause sharpened to one line.** Selected-boat metadata in the replays
   proves invasion transports resolve rivals and carry ratios
   (ab2e1fcd seq 901: `boat:93699:8` → targetID `r5o3pta1`, ratio 6.9,
   navalInvasion true). The boat lane died in the plateaus because the invasion
   pool only opens at `tileShare >= 0.15` (`chooseBoat`,
   strategy-engine.mjs:755 pre-diff), unreachable on World-Normal 12P
   (Odin's 46k tiles ≈ 0.05 share). The existing `forceConversion` bypass
   (ratio ≥ 1.0, ignores the share gate) was only reachable via cv1, which
   needs ≥6 boats/10 decisions — impossible during an upgrade-lock. The
   attack arm was dropped: `chooseRivalAttack` already accepts any resolvable
   unprotected rival at ratio ≥ 1.0, so a 1.15 attack arm added nothing.
2. **Final ug1 form:** cv1-shaped interrupt in the utility fallback — when
   World + upgrade-lock signature (≥4 upgrades in last 8, tileShare flat
   ±0.002) + no pressure + troopRatio ≥ 0.8 + not collapsing + ≥6 decisions
   since last ug1, release `chooseBoat(actions, state, history, avoid, false,
   true)` (the existing forced-conversion path with all cv1 target filters);
   else keep the parent upgrade. Marker `ug1`.
3. **Red regression → green:** 8 new tests appended to
   test/strategy-engine.test.mjs (main red case + pressure/reserve/World-only/
   coalition/cooldown/signature/moving-frontier safety). Full suite 415 pass /
   6 fail, failures a strict subset of the 7 pre-existing baseline failures
   (mickey fanout manifests, launchd reaper, live-data RCI) — zero new.
4. **Band measured (gate 0b):** counterfactual simulation with the cooldown
   over the four round-1325 streams: 33 firings — de60a365 5 (turns
   13900–16700, the pre-collapse window), ab2e1fcd 28 (the frozen plateau),
   0776897b 0, 31865160 0. Upper bound (pressure/troopRatio gates not in
   replay audits). Fires exactly where the diagnosis is, inert elsewhere.
5. Adversarial refutation panel (5 lenses + critic) run on the diff before
   commit; verdicts recorded in the mailbox note.

## Explicitly out of scope (per handoff — separate arms, not bundled)

Degraded-mode nuke spam (0776897b: 60 `dgd:err:nuk`), planner-degradation rate
(364/979 fallback), deal support, prompt compression. Named here only because
signature 2 burned more decisions than the upgrade sink in one of the four
losses — the next-biggest lever after ug1 is a planner-degradation arm, not
upgrade tuning refinements.
