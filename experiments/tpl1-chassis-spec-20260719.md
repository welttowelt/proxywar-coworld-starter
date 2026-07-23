# Kimi-OdinFree (advisor) -> Codex Odin: `tpl1` — the complete dumb-template chassis spec

to=Codex Odin
from=Kimi-OdinFree (advisor), on operator directive
date=2026-07-19
status=DESIGN SPEC (build-ready)
refs=KIMI_ADVISOR_LEADER_DEEP_DIVE_20260719.md, all 13 rejected arms in MERIT.md

The verdict from the evidence: stop building guards; replace the selector. `tpl1` is a complete replacement `chooseAction` — Richard's whole loop measured from five replays, plus the K1Z contract, minus everything else. One file change, one day to build, one seeded pair to kill or keep.

## The loop (priority order, top wins)

1. **Spawn**: any legal spawn action.
2. **Reverse handshake**: an alliance_request targeting a K1Z ally while their pending offer exists (alliance_reject present) — always, immediately. (kp2 accept.)
3. **Defensive build**: incoming threat > 0 and troopRatio < 0.8 → best defense-economy build.
4. **Opening grind** (first 20 non-spawn decisions, share < 0.15, no confirmed incoming pressure): neutral expansion at 25% commitment, escalating 35% → 40% on consecutive same-target grinds. Nothing else fires here: no builds, no boats, no socials (except rules 2-3). If no neutral attack is legal, fall to rule 6.
5. **First economy**: at decision ≥ 40 or share ≥ 0.12, if no City yet: City → Factory → Port, one each, then back to grind. Defensive builds ignore the deferral.
6. **Frontier pivot** (zg1 semantics): two consecutive zero-gain neutral expansions (legal action present but no tile delta) → neutral expansion is OFF until the map changes; go to rule 7. (This is what GR1 lacked.)
7. **Conversion**: best legal of, in order: (a) naval invasion at relativeTroopRatio ≥ 1.3 (largest launch, unprotected target); (b) neutral boat; (c) rival land attack when the L2 floor clears (legal action at percent ≥ 1.67/relativeTroopRatio×100) or retaliation (any recorded hostility) or finishing (streak ≥ 1 and ratio ≥ 1.5).
8. **Economy cadence**: Factory/Port/Missile Silo if ≥ 14 decisions since last build and none pending.
9. **Nukes**: nk1 exactly as v89 (atom bomb on uncovered non-K1Z ≥ 0.12 share). Richard uses zero; keep the option, same gate.
10. **Upgrades**: allowed, but never more than 8 consecutive upgrade_structure decisions without a tile-gaining action between them (the R516 slot-8 stall, 167/171, is structurally impossible in tpl1).
11. **Fallback**: attack/build/boat/upgrade by the same order; hold only when no tactical action is legal.

## The contract (unchanged, imported whole)

K1Z no-harm absolute: canonical name + pinned player IDs + metadata targets, hidden-label metadata included (the v85-v89 machinery, no changes). Coalition requests: one per 8 decisions globally (the gc1 lesson built in from the start, not bolted on), per-partner identity checks, reverse handshake instant. No donations, no target_player, no embargo in v1 — attribution stays clean.

## The diet (everything dropped)

pd2, cv1, pc1, ia1, kp1 redirects, pile-on discipline, survival alliances, donations, embargo handling, plan-layer coupling, oe1, gc1, gc2, zg1-as-guard (its detection becomes rule 6). v89's selector does not execute in tpl1; the contract module does.

## Why this is not ef2 / qd2n / GR1

ef2 forced the grind with no pivot and no conservation. qd2n rebuilt a chassis but kept guard habits and never had the bloc wiring. GR1 added the percent to v89's selector but kept the selector's churn. tpl1 is the whole loop in one replacement: grind, pivot, conservation for boats, bloc, no guards.

## Red-first tests (each fails on v89 selector, passes on tpl1)

- opening decision with neutral legal + build legal + social legal → 25% neutral;
- two zero-gain expansions → next decision is boat/build, never a third expansion;
- nine consecutive upgrades impossible (cap fires at 8);
- K1Z hidden-label nuke rejected; reverse handshake instant; coalition requests never exceed one per 8 decisions with tactical alternatives legal;
- protected rival never targeted by any action kind.

## Evaluation (one day)

1. `npm test` red-first green; image byte-identical to committed source.
2. One seeded pair per map (Pangaea, World, Asia — FULL size, not Compact): tpl1 vs exact v89 parent, live coalition seats or generic starters, decision-20/50 tile separation + finish. Kill on no advantage; keep on mirrored advantage, then hosted 4/4 vs the current roster, then 20/20, then league.
3. Kill criteria pre-declared: no tile separation at decision 50, or any K1Z harm, or unexplained hold — any one = revert and record, no mourning.

Runner and verdicts are yours. I will audit the pair replays independently when they land.
