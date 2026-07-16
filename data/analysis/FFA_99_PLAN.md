# FFA 99 plan

## Decision

Keep v14 (`b0lverk-h0gg`) as the official champion. v20 (`v1g-e1dr`) executed
its isolated opening mechanism in all four hosted episodes but won only one.
It is rejected. Build the next candidate from the exact v14 source with one
isolated, wire-observable change. Promote only after the candidate records zero
outright misses in the targeted gate. The rolling-window goal is at least 99%
outright episode wins, which currently requires a perfect window.

## Current position after Round 221

| Metric | Current | Target |
| --- | ---: | ---: |
| Rolling FFA window | 58/79 (73.42%) | 79/79 (99%+) |
| Five-round form | 15/20 (75.00%) | 20/20 |
| Official first-place streak | 35/1000 | 1000/1000 |
| v14 outright results | 51/67 (76.12%) | candidate gate at 100% |

The latest miss is in Round 221. Even with perfect play from the next round,
the rolling 20-round corpus cannot become perfect until Round 221 leaves the
window after Round 241 completes.

## Failure concentration

| Map / seat | v14 wins | Rate |
| --- | ---: | ---: |
| Asia / seat 3 | 1/6 | 16.7% |
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

## Rejected v21 mechanism

v21 (`skuld-h0gg`) starts from exact v14 and changes one selector branch. During
measured territory collapse, a Claude attack plan may keep 10% counterpressure
on its exact named runaway leader before neutral growth when the leader is at
least 15 points ahead, the policy retains at least 8% territory, and the
relative troop ratio is at least 0.60. A reliable economic build still wins.

This targets a repeated Asia seat-3 failure. Auri won all five v14 losses in
that profile. Auri attacks were legal on 34-41 decisions per loss, but v14
selected only 0-2 of them and instead chose neutral growth 19-25 times while
Auri remained legal. Round 221 was the strongest instance: 37 legal pressure
opportunities, two selected Auri attacks, 14 neutral land attacks, and 11
neutral boats before v14 fell from a 55,872-tile peak to 2,491. The complete
replay-hash ledger is in `experiments/diagnosis-v21-asia-seat3.json`.

The hosted gate failed 0/4 while Auri v5 won 4/4. Claude named Auri in 67
decisions and Auri was legally attackable in 64, but the new branch executed
zero times. v21 instead attacked Richard Higgins 42 times while the active plan
named Auri, including 22 decisions under incoming pressure. Auri attacked v21
64 times. v21 is rejected; lowering the same 0.60 floor is not a new mechanism.

## Rejected v22 mechanism

v22 (`gr1mnir-vard`) started from exact v14 and tested buffer preservation.
When Claude explicitly targets the top rival, that leader is legally reachable,
and incoming pressure is active, the selector must not convert a weaker third
player. It will prefer an existing legal retreat, then a low-commitment neutral
expansion. This keeps the third player alive as a second front and conserves
troops while the leader is already spending attacks on us.

The hosted gate failed 0/4 while Auri v5 won 4/4. The branch executed an
estimated 14 times from replay reconstruction and raised average final territory
from 1,234 under v21 to 18,949, but Auri still averaged 217,032 tiles. Richard
survived only one episode, down from two under v21. v22 is rejected.

## Rejected v23 mechanism

v23 (`v1g-l0k`) started from exact v14 and preserved opening troop reserves.
Auri used 25% for 98 of 128 hostile attacks and never used 40% in the opening.
Our selector escalated to 40% at turn 1,700 and made 27 such attacks while its
own troop reserve ratio was below 0.75. Auri began attacking at turn 1,900 with
a 1.66 troop advantage. v23 retained the 10% to 25% target-continuity ramp
but suppressed 40% commitments during the first 20 active decisions. Later finish
pressure remains unchanged.

The hosted gate finished 1/4: v23 won one, Auri won two, and James Boggs won
one. The lock reduced Auri's first relative troop advantage from 1.66 to 1.31
and its opening commitment from 25% to 10%, but did not move below Auri's 1.20
attack floor. In the win, v23 attacked Auri 14 times and received five attacks;
the losses attacked Auri 0-2 times and received 13-14. v23 is rejected.

## Rejected v24 mechanism

v24 (`j4rn-l0k`) replaced the elapsed-decision lock with live reserve
feedback. During the opening, a hostile attack is capped at 10% whenever the
own troop reserve ratio is below 0.75; 25% remains available at or above 0.75,
and 40% remains locked. Post-opening v14 behavior stayed unchanged. The gate
required Auri's first advantage below 1.20 as well as 4/4 wins.

The hosted gate finished 3/4 with three decisive 222k-226k tile wins. The
opening controller removed Auri's turn-1,900 pressure in every replay. The one
loss came after exact v14 behavior resumed: two 40% Richard attacks at turns
2,400 and 2,500 dropped reserve to 0.59; Auri reached a 1.30 advantage at turn
3,200 and attacked 20 times. v24 is rejected by the hard promotion gate.

## Next isolated mechanism

v25 (`j4rn-d0mr`) will preserve live reserve feedback through midgame. Hostile
commitments use three bands: 10% below 0.75 reserve, at most 25% from 0.75 to
0.89, and exact v14 escalation only at 0.90 or above. This removes the v24
post-opening cliff while leaving target choice and full-bank finish pressure
unchanged. Promotion still requires 4/4 and then 20/20 regression.

## Qd1n social-efficiency candidate

The rounds 391-410 window contains 110 qd1n target marks across twelve losing
episodes and none in a winning episode. Only eighteen were first marks for an
episode-target pair. Replay ordering classifies sixteen more as retaliation
after the same rival attacked qd1n; the other 76 were nonretaliatory repeats.
The waste concentrates in Pangaea seat 3, Pangaea seat 4, and World seat 4.
Those profiles account for 105 of 110 marks and zero episode wins.

OpenFront's source gives the mechanism a concrete cost. A target mark tells
allies whom to attack, and execution reduces that target's relation toward the
requestor by 40. Relations clamp at -100. The first rewrite blocked same-target
repeats but simply rotated all ten actions across more rivals, so RCI rejected
it. The corrected candidate keeps one live campaign target. A dead or allied
target permits a fresh `fr1`; renewed incoming hostility permits `rt1`.

The exact current-package replay held all 645 decisions, winner, turn count, and
final tiles constant. Parent target marks fell from ten to three, all three were
fresh, and holds rose from two to nine. The 70% action cut matches the historical
lower-bound projection of 76/110 nonretaliatory repeats. This proves the social
mechanism and runtime isolation, not a win-rate lift.

This candidate is locally gated only. Qd1n:v77 remains the live champion after
round 411 rank one and round 412 rank two. Do not replace it until hosted `4/4`
and separate `20/20` regression gates complete.

## Qd1n collapse-exposure candidate

Rounds 414-417 placed `9, 2, 9, 9`; rounds 416 and 417 supplied zero wins from
six appearances. Replay inspection rejected an alliance-first response. The
game recommended a survival alliance throughout one collapse, and the rewrite
executed four `sv1` requests in the matched field, but a parent seat still won.

The corrected diagnosis is commitment size after territory has already fallen
at least fifteen percent from its recent eight-decision peak. Across rounds
398-417, qd1n losing episodes selected 57 neutral 35% attacks in that proxy
state across nineteen episodes. Winning episodes selected six neutral attacks
there: four at 10% and two at 20%, with none at 35%. Round 417 Asia seat five
alone contained eight of the losing 35% actions.

Rci-6 preserves the normal `10, 10, 20, 35` expansion cadence and caps only a
detected-collapse neutral attack at 20%. A reached cap emits `cp1`. The exact
current-package qualifier accepted `34/34` decisions. In the alternating-seat
Pangaea replay, `cp1` had zero reach and the parent again won slot three at turn
8,500 with 358,927 tiles; all `645/645` decisions were accepted. This is a
bounded source correction, not promotion evidence. Keep v77 live until a
current matched sample reaches `cp1` and clears `4/4` plus `20/20`.

## Promotion gate

First run a four-episode diagnostic on the exact Round 221 Asia seat-3 roster.
Require 4/4 outright wins, zero holds, zero rejected decisions, and replay proof
that the branch executed when its guards were true. If it passes, run four
episodes each on Asia seat 3, Europe seat 3, Pangaea seat 2, Pangaea seat 4,
and the Asia seat-1 baseline. Promotion requires 20/20. Compare the same
profiles against v14. A 20/20 targeted pass is a regression gate, not a
statistical proof of a 99% underlying win probability; the official rolling
window remains the final KPI.

Immediately before promotion, read Auri's newest active league membership and
the latest completed competition roster. Auri v5 is now active, so every new
candidate gate must use v5. A challenger version shift invalidates an older
promotion gate until the two weakest profiles are repeated against the new
version.

If the candidate misses any profile, keep v14 champion and assign the next
codename only after the mechanism changes. Reserved release names live in
`experiments/codenames.json`.

## Qd1n policy-population candidate

The rci-7 ratio-only conversion hypothesis is closed. It reached `cv2` twelve
times in a matched eight-seat Pangaea replay, but the candidate won no seat and
parent slot eight won with 377,432 tiles. A strong observational split—100
skipped conversion windows in losses against three in wins—did not identify a
safe target rule by itself.

The next loop should follow a small policy-space response-oracle design. Keep
v77 as the main policy and evaluate separate, interpretable exploiters for
leader pressure, retaliatory counterplay, economy-first growth, and bounded
conversion. Build an empirical payoff matrix across current opponents, maps,
and seat profiles. Sample policy arms with nonzero exploration so a short hot
streak cannot collapse the population into one predictable script. Promotion
still requires direct branch reach, a matched parent win advantage, `4/4`, and
the independent `20/20` gate.
