# qd2n architecture blueprint, 2026-07-18

Goal: a new deterministic policy built around the winners' measured decision
architecture, replacing the v77 line rather than patching it. Every element
below cites counted evidence from the 16 hosted episodes and the league
rounds; every element carries its failure lesson from the falsified arms.

## Evidence spine

1. **Surplus is the fortress.** Richard peaks at 12.9M troops (e3) and 7.0M
   (80e2); qd1n peaks at 3.9M and 2.0M in the same games. The 35% opening
   grind is what builds that reserve; pile-ons are survived by regen, not by
   peace (Auri faces as many attackers as qd1n — diplomacy does not shield).
2. **Finish, don't fence.** qd1n's kills come from focused escalation on one
   weakening target; its losses come from rotating 25% attacks across three
   rivals (ch1 mirror autopsy). Sticky finishing flipped asia-a (ch2).
3. **Grind is position-bounded.** ef2 and both chassis iterations starve
   candidate seats whose frontier closes early; the grind must stop when the
   frontier stops producing, not at a fixed tile share.
4. **Holds are fatal.** Every gate rejects on holds; the probe-before-hold
   emergency path cut them 51→14 but the chassis must never plan to hold.
5. **The plan layer is unreliable.** Bedrock throttling hit 57% of decisions
   in sp1's diagnostic; the policy must be fully deterministic.

## Engine: `strategy-chassis.mjs` v3 ("ch3")

Decision order:

1. Spawn: best legal (unchanged).
2. Threat: if 2+ current/recent attackers and troopRatio < 0.8, defensive
   economy build; if a current attacker is attackable at ratio ≥ 0.9,
   retaliate at 25% (sticky).
3. Frontier-aware grind: while `tileShare < ceiling` and the last neutral
   attacks produced tiles (rolling gain check) and troops ≥ 100k, commit 35%.
   Below the floor or after stall: v77 cadence, then early conversion.
   Ceiling: 0.12 on Asia/Pangaea, 0.08 on World (World killed the grind in
   all four chassis runs; convert earlier there).
4. Contact: sticky 25% on the started target while ratio ≥ 1.0, 40% to
   finish at streak ≥ 2 and ratio ≥ 1.5; new targets only at ratio ≥ 1.3
   (opening) or best scored (after), never at 10%.
5. Attrition from surplus only: ratio ≥ 1.3 or ownTroops ≥ 2× target troops.
6. Boats capped at 2 consecutive, only when no land conversion exists.
7. Economy cadence: City/Factory/Port on the v77 cadence; Defense Post stays
   excluded (stale-ID hold risk) pending a dedicated re-measurement.
8. Alliances only as tie-breaker: request when no tactical action exists and
   a stronger rival borders (evidence for peace value is weak).
9. Emergency 10% probe before hold; hold never.

## Gates (unchanged pipeline)

unit tests → `34/34` qualifier → six mirrored matched runs vs exact v77
(Asia/World/Pangaea, both parities) → hosted `4/4` diagnostic on the current
league roster → independent `20/20` regression → submit only if all pass.

Failure pre-registration: if ch3 fails any mirror, the failing map's trace
goes back to the mx3 route (proven) and the hybrid is re-gated; if the
hybrid fails, the architecture project records its verdict and stops.
