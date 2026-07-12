# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion while v18
(`ygg-v0rn`) runs through controlled
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

## Rejected `v1drir-v0rn` probe

v17 lost its first two Pangaea seat-2 hosted episodes, both to James Boggs.
Replay inspection showed that its late survival alliance could race out of the
legal action set, while its retreat rule failed once an incoming attack cleared
between decision ticks. v17 cannot be promoted.

## `ygg-v0rn` mechanism

1. Read the runtime's defensive and diplomatic profiles instead of treating
   every spawn as the same tactical position.
2. Take the runtime-recommended stable survival alliance in the first two
   active decisions, before pressure makes social action IDs volatile.
3. Retreat defensive or diplomatic profiles at the first 6% drawdown and all
   profiles after a confirmed 15% collapse, even when the incoming attack has
   cleared during the current tick.
4. Keep tactical moves ahead of late alliance requests so simultaneous
   resolution cannot turn a disappearing social action into a hold.
5. Suppress high-risk economy builds while defending or collapsing.
6. Preserve the bounded troop, target-conversion, naval, and silo rules that
   already passed under `b0lverk-h0gg`.

## Promotion gate

Run fixed-roster hosted tests for Europe seat 3, Asia seat 3, Pangaea seat 4,
Pangaea seat 2, and Europe seat 1. Require at least four candidate episodes per
profile, zero outright misses, zero holds, and zero rejected decisions. Compare
the same profiles against v14. A 20/20 targeted pass is a regression gate, not
a statistical proof of a 99% underlying win probability; the official rolling
window remains the final KPI.

Immediately before promotion, read Auri's policy version from the latest
completed competition roster. If it differs from the `proxywar-keystone:v4`
fixed baseline, repeat the two weakest candidate profiles against the new live
version. A challenger version shift invalidates the old promotion gate until
that retest completes.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.
