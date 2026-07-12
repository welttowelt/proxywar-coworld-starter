# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion while v19
(`hrafn-syn`) runs through controlled map-seat tests. Promote only after the
candidate records zero outright misses
in the targeted gate. The rolling-window goal is at least 99% outright episode
wins, which currently requires a perfect window.

## Current position after Round 217

| Metric | Current | Target |
| --- | ---: | ---: |
| Rolling FFA window | 57/79 (72.15%) | 79/79 (99%+) |
| Five-round form | 12/20 (60.00%) | 20/20 |
| Official first-place streak | 31/100 | 100/100 |
| v14 outright results | 38/51 (74.51%) | candidate gate at 100% |

The latest miss is in Round 217. Even with perfect play from the next round,
the rolling 20-round corpus cannot become perfect until Round 217 leaves the
window after Round 237.

## Failure concentration

| Map / seat | v14 wins | Rate |
| --- | ---: | ---: |
| Europe / seat 3 | 1/4 | 25.0% |
| Asia / seat 3 | 1/4 | 25.0% |
| Pangaea / seat 4 | 2/5 | 40.0% |
| Pangaea / seat 2 | 2/4 | 50.0% |
| Europe / seat 1 | 2/4 | 50.0% |

Every other observed v14 map-seat profile is 100%. Spawn selection is owned by
the game runtime, so the policy can only improve post-spawn survival and
conversion.

## Rejected `v1drir-v0rn` probe

v17 lost all four Pangaea seat-2 hosted episodes. The same-roster v14 baseline
won three of four. Replay inspection showed that v17 delayed its survival
alliance until the legal action could race out of the action set, while its
retreat rule failed once an incoming attack cleared between decision ticks.
v17 cannot be promoted.

## Rejected `ygg-v0rn` probe

v18 also lost all four Pangaea seat-2 episodes. It recorded zero holds and zero
rejected decisions, but never selected an alliance action. The hosted payload
carried the defensive profile in the request envelope rather than the nested
observation, and the selector did not bind the tactical target's exact action
ID. The intended opening branch was therefore unreachable. v18 cannot be
promoted.

## `hrafn-syn` mechanism

1. Recover the runtime profile from the request envelope when the observation
   omits it.
2. Bind the runtime's exact `bestAllyTargetID` to the matching legal alliance
   action in the first two active decisions.
3. Keep the opening alliance independent of the profile branch because the
   tactical recommendation already encodes the runtime's survival assessment.
4. Preserve the confirmed-drawdown retreat, bounded troop, target-conversion,
   naval, and silo rules that already passed under `b0lverk-h0gg`.

## Promotion gate

Run fixed-roster hosted tests for Europe seat 3, Asia seat 3, Pangaea seat 4,
Pangaea seat 2, and Europe seat 1. Require at least four candidate episodes per
profile, zero outright misses, zero holds, and zero rejected decisions. Compare
the same profiles against v14. A 20/20 targeted pass is a regression gate, not
a statistical proof of a 99% underlying win probability; the official rolling
window remains the final KPI.

Immediately before promotion, read Auri's newest active league membership and
the latest completed competition roster. If either differs from the
`proxywar-keystone:v4` fixed baseline, repeat the two weakest candidate profiles
against the new live version. A challenger version shift invalidates the old
promotion gate until that retest completes.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.
