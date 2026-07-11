# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 193. The source window
covers rounds 174-193, 75 episodes, 244 participant seats, and 28,147 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 193 extended the verified consecutive first-place streak to 7 of the
10-round target.

## Current four-player field

Rounds 181-193 use the current four-player FFA format. The 47 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 47 | 25 | 53.19% | 145,422.6 | 841 | 133 |
| Auri | 47 | 7 | 14.89% | 54,773.8 | 632 | 186 |
| James Boggs | 47 | 7 | 14.89% | 35,471.1 | 349 | 31 |
| Richard Higgins | 47 | 0 | 0.00% | 7,450.3 | 212 | 5 |

The aggregate holds column includes the broken v4 round and 51 Round 189 actions
selected by the game's fallback brain after the v6 container disconnected. v6's
own selector recorded zero holds in Round 190. The dataset has zero rejected
decisions.

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

## Winning action profile

Four-player winners use 27.73 rival attacks per 100 decisions versus 7.94 for
non-winners, a 3.49x difference. Winners also allocate fewer decisions to neutral
expansion, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 27.73 | 7.94 |
| Neutral attacks | 33.74 | 51.40 |
| Neutral boats | 19.68 | 10.98 |
| Naval invasions | 1.79 | 1.26 |
| Builds | 8.39 | 8.61 |
| Social actions | 4.11 | 12.23 |
| Holds | 0.75 | 2.50 |

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
| Opening tempo | 87.91% | 61.68% | 100.00% | 98.39% | 100.00% | 100.00% |
| Frontier conversion | 59.91% | 63.41% | 85.71% | 85.71% | 51.56% | 79.01% |
| Economy cadence | 9.55% | 12.05% | 10.34% | 4.75% | 7.99% | 13.74% |
| Naval control | 18.47% | 11.25% | 0.95% | 0.00% | 5.03% | 0.00% |
| Diplomacy pressure | 2.24% | 4.16% | 0.00% | 0.00% | 0.00% | 0.00% |
| Transport banking | 22.94% | 10.82% | 0.00% | 0.00% | 5.18% | 0.00% |

Opening tempo remains the strongest positive signal, but tactical adherence alone did
not detect the Europe plateau. Keep neutral land first while it increases tile share,
switch to a neutral boat when repeated accepted attacks produce no growth, then resume
rapid rival conversion. Continue sparse builds and almost no social diversion.

## Seat effect

Each seat now has 47 observed FFA appearances. v5 won exactly once from each seat
in Round 185, so that sweep was not explained by seat order. Its Round 186 Europe
spread instead points to connectivity and frontier access: one seat dominated,
one plateaued alive, and two were eliminated.

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

## RCI decision

1. Keep the official goal strict: rank first for 10 consecutive rounds.
2. Require four of four declared wins, zero holds, and zero rejected decisions
   for a full RCI pass. Use map-specific mean-tile floors: Europe 200,000, Asia
   150,000, and Pangaea 60,000.
3. Keep v7 as champion until v8 passes its hosted qualifier. Promote v8 only
   through the normal auto-champion path, with no competition membership gap.
4. Refresh after every completed round and reset the consecutive first-place
   counter after any official rank below 1.
