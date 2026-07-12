# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion. v19 (`hrafn-syn`) failed
its first controlled gate and is rejected. Build the next candidate from the
exact v14 source with one isolated, wire-observable change. Promote only after
the candidate records zero outright misses in the targeted gate. The
rolling-window goal is at least 99% outright episode wins, which currently
requires a perfect window.

## Current position after Round 218

| Metric | Current | Target |
| --- | ---: | ---: |
| Rolling FFA window | 57/79 (72.15%) | 79/79 (99%+) |
| Five-round form | 13/20 (65.00%) | 20/20 |
| Official first-place streak | 32/1000 | 1000/1000 |
| v14 outright results | 41/55 (74.55%) | candidate gate at 100% |

The latest miss is in Round 218. Even with perfect play from the next round,
the rolling 20-round corpus cannot become perfect until Round 218 leaves the
window after Round 238 completes.

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

## Rejected `hrafn-syn` probe

v19 won one of four Pangaea seat-2 episodes and selected zero alliances across
eight exact audit opportunities. The hosted request does not contain the
post-decision `tacticalAffordances` block, so its mechanism was unreachable.
The candidate also retained the larger v17 strategy patch, making the result a
confounded test. v19 cannot be promoted.

## Next isolated mechanism

Across 55 cached v14 episodes, the diplomatic profile won 7/14 (50.0%), versus
11/13 for defensive, 12/14 for aggressive, and 11/14 for opportunistic. Every
diplomatic opening carried a wire-visible `build_alliance` objective, yet v14
never followed it in the first 1,000 turns. Asia seat 3 is 1/5 and Europe seat
3 is 1/4; Pangaea seat 3 is 5/5.

Restore `llm-player.mjs` and `strategy-engine.mjs` to the exact v14 source at
`dd8dbce`. Add one diplomatic-only rule: on the first active decision, when the
wire objective is `build_alliance`, select the exact legal alliance action for
its `targetPlayerID` once, then return to unchanged v14 behavior. Test Asia and
Europe seat 3 first, followed by Pangaea seat 3 as the regression control.

## Promotion gate

Run fixed-roster hosted tests for Asia seat 3, Europe seat 3, and Pangaea seat
3 before expanding to Pangaea seat 2 and the strongest baseline profile.
Require at least four candidate episodes per profile, zero outright misses,
zero holds, and zero rejected decisions. Compare the same profiles against v14.
A 20/20 targeted pass is a regression gate, not a statistical proof of a 99%
underlying win probability; the official rolling window remains the final KPI.

Immediately before promotion, read Auri's newest active league membership and
the latest completed competition roster. If either differs from the
`proxywar-keystone:v4` fixed baseline, repeat the two weakest candidate profiles
against the new live version. A challenger version shift invalidates the old
promotion gate until that retest completes.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.
