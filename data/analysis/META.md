# Proxy War meta report

Snapshot collected 2026-07-12 after Competition Round 206. The source window
covers rounds 187-206, 80 episodes, 320 participant seats, and 25,451 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 206 extended the verified consecutive first-place streak to 20 of the
100-round target.

## Current four-player field

Rounds 187-206 use the current four-player FFA format. The 80 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 80 | 55 | 68.75% | 181,415.4 | 1,823 | 67 |
| Auri | 80 | 12 | 15.00% | 59,743.4 | 1,005 | 207 |
| James Boggs | 80 | 5 | 6.25% | 20,669.2 | 594 | 101 |
| Richard Higgins | 80 | 0 | 0.00% | 12,078.2 | 515 | 17 |

The aggregate holds column includes 51 Round 189 actions selected by the game's
fallback brain after the v6 container disconnected. v6's own selector recorded
zero holds in Round 190. Round 197 added one hold when a transient
pending-alliance action disappeared during simultaneous turn resolution. The
dataset has zero rejected decisions.

Round 200 added one v11 hold when an alliance request to Auri disappeared during
simultaneous resolution. The policy returned a legal action ID, but the runtime
could no longer resolve it and substituted `HOLD`.

## Policy progression

| Round | Version | Official rank | Episode wins | Mean final tiles | Holds |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 181 | v2 | 3 | 1/4 | 24,526.5 | 6 |
| 182 | v3 | 2 | 1/2 | 127,807.0 | 0 |
| 183 | v3 | 1 | 1/1 | 461,851.0 | 0 |
| 184 | v4 | 3 | 0/4 | 0.0 | 62 |
| 185 | v5 | 1 | 4/4 | 218,109.5 | 0 |
| 186 | v5 | 2 | 0/4* | 61,390.8 | 0 |
| 187 | v5 | 1 | 1/4* | 38,463.8 | 9 |
| 188 | v5 | 1 | 3/4 | 165,536.8 | 3 |
| 189 | v6 | 1 | 3/4 | 372,028.3 | 51* |
| 190 | v6 | 1 | 3/4 | 68,430.0 | 0 |
| 191 | v6 | 1 | 3/4 | 168,586.5 | 0 |
| 192 | v7 | 1 | 3/4 | 367,453.3 | 0 |
| 193 | v7 | 1 | 2/4 | 44,823.3 | 2* |
| 194 | v8 | 1 | 3/4 | 164,939.8 | 0 |
| 195 | v8 | 1 | 2/4 | 265,029.3 | 0 |
| 196 | v8 | 1 | 3/4 | 66,477.8 | 0 |
| 197 | v9 | 1 | 3/4 | 168,315.3 | 1 |
| 198 | v9 | 1 | 3/4 | 344,155.3 | 0 |
| 199 | v11 | 1 | 3/4 | 68,545.0 | 0 |
| 200 | v11 | 1 | 3/4 | 164,912.3 | 1 |
| 201 | v12 | 1 | 3/4 | 344,314.3 | 0 |
| 202 | v13 | 1 | 2/4 | 44,533.5 | 0 |
| 203 | v13 | 1 | 3/4 | 163,962.8 | 0 |
| 204 | v13 | 1 | 2/4* | 359,584.3 | 0 |
| 205 | v14 | 1 | 4/4 | 83,641.8 | 0 |
| 206 | v14 | 1 | 3/4 | 164,574.3 | 0 |

v4 misclassified the new structured neutral-land action and held instead of
expanding. v5 fixed the classifier and recovered immediately from every seat.

Round 186 used Europe and all four episodes reached the 30,400-turn cap without
a replay `winner_slot`. The official commissioner awarded v5 a 0.25 round score
and second place, equivalent to the top territorial score in one of four seats;
the replay-derived win column remains 0/4 because no episode declared a winner.

The regression is map-specific. One v5 seat reached 11,785 tiles, then submitted
about 294 additional accepted neutral-land attacks without gaining territory.
Across all four Europe seats, v5 made 610 neutral attacks and zero boat actions.
Its one dominant seat finished with 233,778 tiles; the other three finished with
11,785, 0, and 0. Auri averaged 199,803 tiles and took the official 0.75 score.

Round 187 returned to Pangaea. v5 took official first place with a 0.50 score:
one declared episode win, one timeout where it held the largest territorial
score, and two episode losses. This passes the official-rank check but fails the
strict RCI gate on declared wins, mean territory, and holds. All nine holds came
from one seat after its land collapsed and only rival boat invasions remained.
The selector rejected those boats below its normal invasion threshold, even
though holding guaranteed elimination.

Round 188 used Asia. v5 won three seats decisively with 217,413, 212,814, and
231,921 final tiles, while Auri won the fourth. The losing seat peaked at 61,881
tiles, then held three times despite bordered rivals and a legal Defense Post.
Official first place and a 0.75 score extend the streak, but the strict RCI gate
still fails on four-seat coverage, mean territory, and zero-hold execution.

Round 189 returned to Europe. v6 won three seats outright with 465,402, 466,579,
and 461,380 final tiles, then finished third by territory in the 30,400-turn
seat. The three wins produced an official 0.75 score and first place, a clear
improvement over v5's 0.25 and second place on the same map. The long seat reached
94,752 tiles before the policy stopped responding at turn 10,500. The game then
used its generic diplomatic fallback for 201 decisions, including all 51 holds;
these were not selected by v6. The replay recorded zero rejected actions.

Round 190 used Pangaea. v6 won seats 1, 3, and 4 with 84,267, 87,920, and 89,438
tiles. Auri won seat 2 after v6 peaked at 26,881 and finished with 12,095. v6
recorded zero holds and zero rejected actions across the round. Its 0.75 score
and first place improve on v5's 0.50 Pangaea result in Round 187.

Round 191 used Asia. v6 won seats 1, 2, and 4 with 233,256, 221,801, and 215,054
tiles, while Auri won seat 3. The losing seat peaked at 56,003 before a tactical
collapse and finished with 4,235. v6 again recorded zero holds and zero rejected
actions. Its third consecutive 0.75 first-place score extended the streak to five.

Round 192 returned to Europe for v7's first field test. v7 won seats 1, 2, and 4
with 455,479, 459,043, and 455,288 tiles. James Boggs won seat 3, where v7 still
finished with 100,003. Across 758 v7 decisions and runs as long as 25,400 turns,
the policy recorded zero game timeouts, disconnect fallbacks, holds, or rejected
actions. The resiliency fix passed its intended live stress test, and the 0.75
first-place score extended the streak to six.

Round 193 used Pangaea and split 2-2 between v7 and James Boggs. v7 retained
official first place through the published seed-order tie-break, extending the
streak to seven, but this was the weakest result in the current run. In one loss,
James attacked v7 17 times while v7 kept selecting neutral expansion as its tile
share collapsed despite safe builds remaining legal. The second loss was an
isolated 664-tile state with no tactical actions; its two holds were forced after
all transports were already retreating. v8 detects a sustained 15% territory
drop, inserts an emergency build cadence, and prioritizes a legal counterattack
over neutral expansion during an active attack. It has 25 passing tests and a
four-seat local Pangaea run with a decisive 92,242-tile winner, zero holds, and
zero rejected actions.

Round 194 used Asia for v8's first field test. v8 won seats 1, 2, and 4 with
224,982, 213,555, and 215,734 final tiles. Auri won seat 3 after attacking v8
26 times from turns 1,200 through 4,400; that seat peaked at 44,449 tiles and
finished with 5,488. v8 used five builds and 12 rival attacks in the loss, with
zero holds and zero rejected actions across all four seats. Nineteen decisions
used the deterministic selector after planner failures, but no player socket
disconnected. The 0.75 first-place score extended the official streak to eight.

Round 195 returned to Europe and split 2-2 between v8 and Auri. v8 won seats 2
and 4 outright with 465,880 and 463,855 final tiles. The two losses reached the
30,400-turn cap with 5,819 and 124,563 tiles after taking 42 and 43 incoming
rival attacks respectively. Both losing seats were pressured by Auri and Richard
Higgins; the stronger seat peaked at 330,594 tiles before the late collapse.
Across 992 v8 decisions, the policy recorded zero holds, zero rejected actions,
and no socket disconnect. The strict RCI gate fails only the four-of-four win
check. The official 0.50 score and seed-order tie-break extended the streak to
nine first-place rounds.

Round 196 used Pangaea. v8 won seats 1, 3, and 4 with 88,560, 84,186, and
92,541 final tiles. Auri won seat 2 after v8 peaked at 35,127 and took 31 attacks
from all three rivals. v8 made 294 decisions with zero holds and zero rejected
actions. The 0.75 score reached the 10-round checkpoint while preserving the
expanded 100-round objective.

Round 197 used Asia for v9's first field test. v9 won seats 1, 2, and 4 with
233,481, 220,971, and 215,789 final tiles. Auri won seat 3 after v9 peaked at
60,760, took 23 attacks from Auri, seven from Richard Higgins, and one from
James Boggs, then finished with 3,020 tiles. The policy submitted a valid
survival-alliance request to Auri at turn 4,100, but the replay did not expose an
active alliance afterward and Auri kept attacking through turn 4,800. A separate
relation-2 pending request disappeared during simultaneous turn resolution at
turn 2,200 and the game replaced it with a hold despite productive tactical
actions. The round had zero rejected decisions. The 0.75 score and first place
extended the streak to 11.

Round 198 returned to Europe. v9 won seats 1, 2, and 4 with 455,479, 465,025,
and 456,117 final tiles. The seat-3 loss peaked at 58,267 tiles and was
eliminated by turn 4,100 after 15 attacks from Richard Higgins and 10 from Auri;
the episode itself continued to the 30,400-turn cap. A relation-2 pending request
to James Boggs was accepted at turn 2,700, and James subsequently donated troops
to v9, showing that pending requests can be useful despite the race during
simultaneous turn execution. Across 571 decisions, v9 recorded zero holds, zero
rejected actions, and 12 planner fallbacks. The 0.75 score and first place
extended the streak to 12.

Round 199 used Pangaea for v11's first field test. v11 won seats 1, 3, and 4
with 87,364, 82,412, and 90,082 final tiles. Auri won seat 2 after v11 peaked at
20,149 and finished with 14,322. Auri attacked that seat five times and reached
79% territory by turn 3,400; map geometry exposed no legal attack on Auri, so
v11 attacked Richard Higgins three times and James Boggs once. It sent a stable
alliance request to Auri at turn 3,100, but the replay confirmed only the
outgoing request and never exposed an active alliance. Across 178 decisions,
v11 recorded zero holds, zero rejected actions, and 38 planner fallbacks. Its
0.75 score and first place extended the streak to 13.

Recent Pangaea rounds show the same seat effect: our seat 2 finished with 12,095
tiles in Round 190, 624 in Round 196, and 14,322 in Round 199 while seats 1, 3,
and 4 won. A defensive-spawn candidate was tested and rejected. The Coworld
runtime labels these actions `deterministic-spawn` and records
`externalActionCall=false`, so the external policy cannot alter spawn choice.
The controlled candidate replay was identical to v11 at 12,211 seat-2 tiles and
a 90,000-tile seat-3 winner. The candidate was removed and never promoted.

Round 200 used Asia. v11 won seats 1, 2, and 3 with 218,623, 223,563, and
216,093 final tiles. Auri won seat 4 after v11 peaked at 58,100 and finished
with 1,370. At turn 2,500 v11 selected a legal stable alliance request to Auri;
the action disappeared during simultaneous resolution and the game replaced the
unknown ID with a hold. The other 238 decisions were accepted, and the round had
zero rejected actions. The 0.75 score and first place extended the streak to 14.

Round 201 returned to Europe for v12's first official field test. v12 won seats
1, 2, and 4 with 459,446, 460,611, and 457,200 final tiles. Seat 3 peaked at
72,160 and was eliminated by turn 3,900 after 14 attacks from Auri, nine from
James Boggs, and three from Richard Higgins. The episode continued to the
30,400-turn cap, where Auri held 329,906 tiles and James held 237,878. v12 made
479 decisions with zero holds, zero rejected actions, and 23 planner fallbacks.
Its 0.75 score and first place extended the streak to 15.

The lost seat requested an alliance with Auri at turn 2,400 while rival and
neutral attacks remained legal. Auri continued attacking through turn 3,900.
v13 would keep a tactical action ahead of that request, reinforcing the separate
hosted A/B result without claiming the request alone caused the elimination.

Round 202 used Pangaea for v13's first field test. v13 won seats 1 and 3 with
86,828 and 84,484 final tiles. James Boggs won seat 2, where v13 peaked at
17,824 and finished with 1,088 after seven James attacks, three Auri attacks,
and one Richard Higgins attack. Auri won seat 4, where v13 peaked at 33,333 and
finished with 5,734 after 12 Auri attacks. Across 208 decisions, v13 recorded
zero holds, zero rejected actions, and zero alliance requests. Its 0.50 score
was a clear first place and extended the streak to 16.

Both losses exposed favorable rival attacks while stalled neutral expansion was
forcing escape boats. v14 (`ff03ffe7-4b94-4070-9602-ecfe1db05394`) moves a
valid rival conversion ahead of that boat branch. All 35 tests pass. A local
Pangaea run preserved a winner and zero holds while moving the weak defensive
seat from 12,211 to 14,045 tiles.

The pinned hosted seat-4 A/B split 1/2 for both v13 and v14. v14 raised final
tiles from 7,554 to 14,020 in the loss and from 88,348 to 89,765 in the win. Its
loss used 26 rival attacks and 16 boats versus v13's 13 attacks and 27 boats, so
the tactical reorder executed. At turn 6,300, however, the v14 player timed out
and never reconnected; the game's generic fallback produced 57 holds. No policy
logs were available to classify the timeout. v14 remained benched pending a
reliability retry, and v13 stayed champion through the Round 204 entrant lock.

A same-roster v14 reliability retry after Round 203 won 2/2 with 90,409 and
83,616 final tiles. Across 169 v14 decisions, both episodes recorded zero holds,
zero rejected actions, zero timeouts, and zero socket disconnects. The retry
cleared the first request's unclassified reliability blocker. Round 204 locked
v13 in its entrant list at 02:30:20 UTC; v14 was promoted immediately afterward
and verified as the sole active champion for subsequent rounds. Request IDs,
costs, replay hashes, and action counts are recorded in `experiments/`.

Round 203 used Asia. v13 won seats 1, 2, and 4 with 213,968, 223,297, and
215,679 final tiles. Auri won seat 3 after v13 peaked at 62,924 and finished
with 2,907. Auri attacked that seat 21 times from turns 1,200 through 4,800;
Richard Higgins added eight attacks and James Boggs one. The loss recorded 51
decisions, 10 rival attacks, 24 neutral-land attacks, 10 boats, four builds,
zero social actions, zero holds, and zero rejected actions.

The losing seat converted James Boggs while troop ratios were favorable, then
counterattacked Auri and Richard as their ratios approached parity. Once Auri's
troop advantage crossed the policy threshold, no favorable hostile conversion
remained. Neutral and boat recovery briefly raised the seat from 39,371 to its
62,924 peak before renewed multi-rival pressure collapsed it. This closely
repeats the Round 197 Asia seat-3 pattern, which peaked at 60,760 under 23 Auri,
seven Richard, and one James attack. The replay exposes no selector race,
timeout, rejection, or missed favorable attack, so v13 remains champion without
a speculative policy change. The 0.75 score and first place extend the streak
to 17.

Round 204 returned to Europe. v13 won seats 2 and 4 outright with 461,167 and
456,116 final tiles. Seats 1 and 3 reached the 30,400-turn cap without a replay
winner. Seat 3 led Auri 335,461 to 232,874 at the cap, while seat 1 trailed Auri
185,593 to 331,568. The commissioner therefore awarded v13 a 0.75 round score
and clear first place; the replay-derived win column remains 2/4 because only
two episodes declared a winner.

Across 892 v13 decisions, the round recorded zero holds, zero rejected actions,
and no socket disconnect. Its 38 planner fallbacks remained inside the policy's
deterministic selector. The territorial-win seat survived 20 Richard Higgins,
nine Auri, and one James Boggs attack; the territorial-loss seat took 18 Auri
and one Richard attack. Both remained alive through the cap. The strict RCI gate
fails only the four-of-four declared-winner check, while official first place
extends the streak to 18.

Round 205 used Pangaea for v14's first official field test. v14 swept all four
seats with 84,267, 84,467, 83,426, and 82,407 final tiles. The historically
weak seat 2 won after 49 land attacks, 20 boats, and six builds, improving on
the 12,095, 624, 14,322, and 1,088 results from earlier Pangaea rounds in that
seat. The other three seats also declared outright winners rather than relying
on timeout territory scoring.

Across 257 decisions, v14 used 90 rival attacks, 69 neutral-land attacks, 36
boats, and 20 builds. All 245 post-spawn decisions remained under external
policy control. The round recorded zero holds, zero rejected actions, zero
timeouts, and zero socket disconnects; 42 planner fallbacks stayed inside the
deterministic selector. This is the first four-of-four field sweep since Round
185 and passes every strict RCI check. The 1.00 score and first place extend the
official streak to 19.

Round 206 used Asia. v14 won seats 1, 2, and 4 with 213,402, 225,095, and
215,679 final tiles. Auri won seat 3 after v14 peaked at 64,349 and finished
with 4,121. That seat took 17 attacks from Auri, six from Richard Higgins, and
one from James Boggs while making 30 rival attacks, 11 boat launches, three
boat retreats, and five builds. Across 209 v14 decisions, the round recorded
zero holds, zero rejected actions, zero socket disconnects, and 18 planner
fallbacks. The 0.75 score and first place extend the official streak to 20.

The seat-3 replay exposed favorable Richard Higgins conversions at 1.23x and
1.17x relative troop ratios on turns 2,700 and 2,800, but a refreshed Claude
plan listed Richard under `avoidTargets`, so the deterministic selector resumed
neutral expansion. At turn 3,300 the same planner veto suppressed a 1.26x
executor-ready conversion and the policy launched a boat. Candidate v15 lets
active incoming pressure override that planner veto only after 12% territory
and at least a 1.15x favorable ratio. All 36 tests pass, and a four-seat local
Asia replay completed 224 accepted decisions with zero holds or rejections.

The exact hosted seat-3 A/B rejected v15. v14 won 2/2 with 221,193 and 225,038
tiles; v15 lost 0/2 to Auri with 4,048 and 20,384 tiles. Both v15 episodes
completed normally with 103 policy decisions, zero holds, zero rejected actions,
and no timeout or disconnect signal. The small unpaired sample does not prove
the override caused either loss, but it provides no promotion case against a
2/2 baseline. v15 remains non-champion and the candidate rule was removed from
the source branch.

## Winning action profile

Four-player winners use 31.61 rival attacks per 100 decisions versus 10.28 for
non-winners, a 3.08x difference. Winners also allocate fewer decisions to
neutral expansion, social actions, and holds while using more neutral boats.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 31.61 | 10.28 |
| Neutral attacks | 33.89 | 44.09 |
| Neutral boats | 19.07 | 14.41 |
| Naval invasions | 1.83 | 0.88 |
| Builds | 7.97 | 8.49 |
| Social actions | 1.84 | 11.20 |
| Holds | 0.03 | 2.02 |

v5 was more decisive than the pooled winner profile in Round 185. Across those
four wins, 56.9% of decisions attacked rivals and 28.4% expanded into neutral
land. In its four Round 186 Europe seats, those rates reversed to 5.2% rival
attacks and 88.3% neutral attacks, exposing a failed frontier-to-conversion handoff.

## v5 phase profile

| Phase | Decisions | Rival attacks | Neutral attacks | Builds | Holds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opening, decisions 1-10 | 40 | 0.00% | 70.00% | 0.00% | 0.00% |
| Conversion, decisions 11-25 | 60 | 56.67% | 33.33% | 10.00% | 0.00% |
| Finish, decision 26+ | 111 | 77.48% | 10.81% | 10.81% | 0.00% |

The Round 185 handoff from land acquisition to conversion was consistent. The
first rival attack occurred on decisions 15, 18, 15, and 17 across the four
seats. Round 186 did not preserve that behavior: two seats never attacked a rival,
and the longest-lived stalled seat repeated neutral expansion through decision 303.

## Targeting pattern

v5 attacked Auri 62 times, Richard Higgins 32 times, and James Boggs 26 times in
Round 185. Mean attack commitment was 26.0% at a 2.01 relative troop ratio. Its
17.24% target-switch rate is above Auri's winning 13.25% baseline but well below
James Boggs's winning 31.67% rate. No change is justified from this sample because
v5 converted all four matches decisively.

## Tactical recommendation audit

The replay exposes structured game recommendations independently of each policy's
selected action. Comparing recommendation adherence separates useful game signals
from suggestions that consume winning tempo.

| Recommendation | Winners | Non-winners | v5 R185 | v5 R186 | v5 R187 | v5 R188 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening tempo | 94.81% | 66.20% | 100.00% | 98.39% | 100.00% | 100.00% |
| Frontier conversion | 71.23% | 63.18% | 85.71% | 85.71% | 51.56% | 79.01% |
| Economy cadence | 15.23% | 14.62% | 10.34% | 4.75% | 7.99% | 13.74% |
| Naval control | 26.91% | 15.17% | 0.95% | 0.00% | 5.03% | 0.00% |
| Diplomacy pressure | 0.93% | 4.05% | 0.00% | 0.00% | 0.00% | 0.00% |
| Transport banking | 46.98% | 16.40% | 0.00% | 0.00% | 5.18% | 0.00% |

Opening tempo remains the strongest positive signal, but tactical adherence alone did
not detect the Europe plateau. Keep neutral land first while it increases tile share,
switch to a neutral boat when repeated accepted attacks produce no growth, then resume
rapid rival conversion. Continue sparse builds and almost no social diversion.

## Seat effect

Each seat now has 80 observed FFA appearances. Seats 1 and 4 produced 23 and 24
wins, seat 2 produced 15, and seat 3 produced 10. v5 won exactly once from each
seat in Round 185, so that sweep was not explained by seat order. The aggregate
gap and repeated Asia seat-3 losses still support map geometry and frontier
access as a live risk rather than a deterministic seat outcome.

## v6 promotion

Policy `oli-codex-proxywar:v6` (`cfd3c268-6d23-4aef-b9de-8cae82afd381`)
became the active champion on 2026-07-11 after two successful hosted crash-check
episodes. Auto-promotion was disabled for the first qualifier and enabled only
after the local replay audit.

The local four-seat Europe run ended at turn 19,600 with a 466,171-tile winner.
Every seat used neutral boats instead of repeating land attacks indefinitely;
the four seats reached peak territory of 148,417, 450,773, 70,120, and 109,609
tiles with zero rejected decisions. Six holds in that run mapped to exposed
`boat_retreat` actions or stale `Defense Post` IDs. v6 now handles the retreat
and emergency-attack paths and excludes `Defense Post`; all 22 strategy tests pass.

v6 passed its Europe and Pangaea field tests with consecutive 0.75 first-place
scores. The Round 189 long-seat failure began with a 15-second external decision
timeout, followed by a disconnected player socket. v7 cancels timed-out Bedrock
requests, adds a planner failure cooldown, sends websocket heartbeats, and
reconnects after unexpected socket closure. Its integration suite has 23 passing
tests, including an explicit reconnect test. v7 passed two hosted five-step
qualifier episodes and became the active champion at 20:19 UTC, before Round 192.

v8 (`3f957c73-307d-4a29-a16d-615c9ecf87e5`) passed two hosted five-step
qualifier episodes and became the active champion before Round 194. Its first
field round won three of four Asia seats without holds, rejected actions, or a
socket disconnect. The isolated loss was driven by sustained 26-action pressure
from Auri with a growing troop advantage. Round 195 added two Europe wins and
two multi-rival pressure losses, again without holds, rejected actions, or a
disconnect. Round 196 added three Pangaea wins and a third multi-rival pressure
loss. v8 has three official first-place finishes and eight wins across 12 field
episodes.

v9 adds one survival-alliance action under sustained midgame
pressure, waits at least 18 decisions before retrying, and breaks an alliance
only after reaching 45% territory. Its 29 tests passed. A four-seat local Pangaea
run produced a decisive 90,000-tile winner, two alliance requests across 268
decisions, zero holds, and zero rejected actions. The test ran in deterministic
fallback mode because the local Coworld Bedrock path requires an absent `aws`
binary; hosted qualification exercised the normal Bedrock container path. v9
won three of four Asia seats in Round 197 and took official first place.

v10 (`db62655d-f184-450f-b07d-d0cf1608a2b3`) initially excluded relation-2
pending alliance actions after the Round 197 race. It also added stable alliance
or target pressure when an isolated seat has no tactical action. Its four-seat
local Asia run produced a 223,763-tile winner at turn 7,600 with 251 accepted
decisions, zero holds, and zero rejected actions. Hosted qualifier Round 30
completed successfully and promoted v10 after Round 198 had already locked v9.

Round 198 inverted the blanket exclusion hypothesis: v9's relation-2 request to
James was accepted and generated later troop donations. v11
(`83469663-89e5-46b0-8d6f-38f7dc4e806f`) therefore prefers stable requests but
allows a pending-only request inside the active survival gate; no-pressure
last-resort selection still excludes pending requests. All 32 tests pass. Its
four-seat local Pangaea run produced a 90,000-tile winner at turn 8,500 with 268
accepted decisions, zero holds, and zero rejected actions. Hosted qualifier
Round 32 completed successfully, promoted v11, and locked it into Round 199.
Round 199 then produced three Pangaea wins with zero holds or rejected actions.

v12 (`023aa491-19eb-44ee-9872-6b1b3070b5c6`) prevents a refreshed Claude
`avoidTargets` list from cancelling an already-started finish when the target
remains at least 1.5x favorable. All 33 tests pass. Its local four-seat Pangaea
run repeated the v11 safety baseline with 268 accepted decisions, zero holds,
and zero rejections. Hosted Qualifier Round 34 passed both crash checks.

A pinned hosted Pangaea seat-2 A/B used the same Auri, Richard Higgins, and
James Boggs roster for both versions. v11 went 1/2 with final results of 0 and
87,140 tiles. v12 went 2/2 with 85,795 and 91,398 tiles, zero holds, and zero
rejected actions. The candidate replays show it preserving favorable attacks
across conflicting plan refreshes. v12 became the sole active champion after
Round 200; the request IDs and replay hashes are recorded in `experiments/`.

v13 (`1d8e42be-f732-4624-a72f-58ca6b1081af`) keeps legal attacks, expansion,
boats, retreats, builds, and strikes ahead of race-prone alliance requests.
Alliance requests remain available when no tactical move exists, and dominant
players can still break an alliance to finish. All 34 tests pass. A local Europe
run reached turn 17,400 with a 455,799-tile winner, 552 accepted decisions, zero
holds, and zero rejected actions. Its only alliance request occurred when no
tactical action was legal.

A pinned hosted Asia seat-4 A/B reproduced the Round 200 failure. Both v12 and
v13 won 2/2, but v12 again returned a disappearing alliance ID while nine attacks
and 18 boats were legal, producing one fallback hold. v13 recorded zero holds,
zero rejections, and zero alliance requests across its two wins. Hosted
Qualifier Round 36 passed, and v13 became the sole champion after Round 201 had
already locked v12.

## PUA/PIP operating loop

1. Read the official result and every failed-seat replay before changing policy.
2. Record exact failure signals, test the opposite hypothesis, and isolate the
   smallest selector or reliability defect that replay evidence supports.
3. Require passing unit and integration tests, a four-seat local run, and hosted
   qualifier success before replacing the active champion.
4. Close every round by refreshing analytics, checking data quality, committing,
   pushing, deploying, and verifying the public streak counter.

## RCI decision

1. Keep the official goal strict: rank first for 100 consecutive rounds.
2. Require four of four declared wins, zero holds, and zero rejected decisions
   for a full RCI pass. Use map-specific mean-tile floors: Europe 200,000, Asia
   150,000, and Pangaea 60,000.
3. Keep qualified v14 as the sole champion after its 2/2 reliability retry and
   4/4 first official field sweep completed without timeout, disconnect, hold,
   or rejection. The v15 pressure-override candidate failed its pinned hosted
   A/B 0/2 against v14's 2/2 and was rejected.
4. Refresh after every completed round and reset the consecutive first-place
   counter after any official rank below 1.
