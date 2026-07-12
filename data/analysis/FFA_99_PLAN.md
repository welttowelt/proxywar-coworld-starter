# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion. v20 (`v1g-e1dr`) executed
its isolated opening mechanism in all four hosted episodes but won only one.
It is rejected. Build the next candidate from the exact v14 source with one
isolated, wire-observable change. Promote only after the candidate records zero
outright misses in the targeted gate. The rolling-window goal is at least 99%
outright episode wins, which currently requires a perfect window.

## Current position after Round 220

| Metric | Current | Target |
| --- | ---: | ---: |
| Rolling FFA window | 58/79 (73.42%) | 79/79 (99%+) |
| Five-round form | 15/20 (75.00%) | 20/20 |
| Official first-place streak | 34/1000 | 1000/1000 |
| v14 outright results | 48/63 (76.19%) | candidate gate at 100% |

The latest miss is in Round 220. Even with perfect play from the next round,
the rolling 20-round corpus cannot become perfect until Round 220 leaves the
window after Round 240 completes.

## Failure concentration

| Map / seat | v14 wins | Rate |
| --- | ---: | ---: |
| Asia / seat 3 | 1/5 | 20.0% |
| Europe / seat 3 | 2/5 | 40.0% |
| Pangaea / seat 2 | 2/5 | 40.0% |
| Pangaea / seat 4 | 3/6 | 50.0% |
| Europe / seat 1 | 3/5 | 60.0% |

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

## Rejected `v1g-e1dr` probe

v20 pinned the exact v14 selector plus one first-decision diplomatic alliance
rule to Asia seat 3. It followed the exact objective target in all four
episodes with zero holds and zero rejected decisions, but won only one. The
single winner attacked Auri 21 times. The three losing runs never attacked
Auri, who won each episode. An accepted opening request to Richard Higgins did
not create reliable pressure on the eventual leader. v20 cannot be promoted.

## Next isolated mechanism

Keep the working source at exact v14 behavior. Compare the v20 Asia winner with
its three losses and the earlier same-roster v14 wins before selecting v21's
single mechanism. The first diagnostic question is why the losing diplomatic
runs had no legal or selected pressure on Auri while the winner attacked Auri
21 times. Do not reuse the opening alliance objective as the intervention.

## Promotion gate

Run fixed-roster hosted tests for Asia seat 3, Europe seat 3, and Pangaea seat
3 before expanding to Pangaea seat 2 and the strongest baseline profile.
Require at least four candidate episodes per profile, zero outright misses,
zero holds, and zero rejected decisions. Compare the same profiles against v14.
A 20/20 targeted pass is a regression gate, not a statistical proof of a 99%
underlying win probability; the official rolling window remains the final KPI.

Immediately before promotion, read Auri's newest active league membership and
the latest completed competition roster. Auri v5 is now active, so every new
candidate gate must use v5. A challenger version shift invalidates an older
promotion gate until the two weakest profiles are repeated against the new
version.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.
