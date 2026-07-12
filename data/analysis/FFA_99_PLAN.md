# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion while v17
(`v1drir-v0rn`) runs through controlled
map-seat tests. Promote only after the candidate records zero outright misses
in the targeted gate. The rolling-window goal is at least 99% outright episode
wins, which currently requires a perfect window.

## Current position after Round 215

| Metric | Current | Target |
| --- | ---: | ---: |
| Rolling FFA window | 58/79 (73.42%) | 79/79 (99%+) |
| Five-round form | 15/20 (75.00%) | 20/20 |
| Official first-place streak | 29/100 | 100/100 |
| v14 outright results | 33/43 (76.74%) | candidate gate at 100% |

The latest miss is in Round 215. Even with perfect play from the next round,
the rolling 20-round corpus cannot become perfect until Round 215 leaves the
window after Round 235.

## Failure concentration

| Map / seat | v14 wins | Rate |
| --- | ---: | ---: |
| Europe / seat 3 | 0/3 | 0.0% |
| Asia / seat 3 | 1/4 | 25.0% |
| Pangaea / seat 4 | 2/4 | 50.0% |
| Pangaea / seat 2 | 2/3 | 66.7% |
| Europe / seat 1 | 2/3 | 66.7% |

Every other observed v14 map-seat profile is 100%. Spawn selection is owned by
the game runtime, so the policy can only improve post-spawn survival and
conversion.

## `v1drir-v0rn` mechanism

1. Keep safe troop percentage ahead of anti-repeat novelty, preventing a safe
   25% attack from being forced to 40%.
2. Cap non-finishing rival attacks at 10% under incoming pressure.
3. Retreat exposed fronts before restarting expansion during a collapse.
4. Permit a stable survival alliance while collapsing, but reject transient
   pending-request action IDs.
5. Suppress high-percentage neutral expansion during collapse.
6. Open a naval front on the remaining leader before late neutral farming.
7. Bank for a Missile Silo after the core economy and use a legal nuke before
   more expansion in a mature stalemate.

## Promotion gate

Run fixed-roster hosted tests for Europe seat 3, Asia seat 3, Pangaea seat 4,
Pangaea seat 2, and Europe seat 1. Require at least four candidate episodes per
profile, zero outright misses, zero holds, and zero rejected decisions. Compare
the same profiles against v14. A 20/20 targeted pass is a regression gate, not
a statistical proof of a 99% underlying win probability; the official rolling
window remains the final KPI.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.
