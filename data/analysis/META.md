# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 188. The source window
covers rounds 169-188, 75 episodes, 204 participant seats, and 28,153 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 188 extended the verified consecutive first-place streak to 2 of the
10-round target.

## Current four-player field

Rounds 181-188 use the current four-player FFA format. The 27 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 27 | 11 | 40.74% | 101,836.1 | 399 | 80 |
| Auri | 27 | 5 | 18.52% | 69,594.0 | 452 | 129 |
| James Boggs | 27 | 4 | 14.81% | 29,263.8 | 180 | 19 |
| Richard Higgins | 27 | 0 | 0.00% | 3,255.8 | 98 | 3 |

The aggregate holds column includes the broken v4 round. v5 recorded zero holds
in Rounds 185 and 186, then nine holds in one collapsing Round 187 seat and
three in the lone Round 188 loss. The dataset still has zero rejected decisions.

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

## Winning action profile

Four-player winners use 33.14 rival attacks per 100 decisions versus 7.71 for
non-winners, a 4.30x difference. Winners also allocate fewer decisions to neutral
expansion, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 33.14 | 7.71 |
| Neutral attacks | 35.20 | 53.67 |
| Neutral boats | 12.31 | 9.65 |
| Naval invasions | 2.19 | 1.33 |
| Builds | 6.51 | 8.09 |
| Social actions | 4.32 | 12.75 |
| Holds | 1.74 | 2.56 |

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

Each seat now has 27 observed FFA appearances. v5 won exactly once from each seat
in Round 185, so that sweep was not explained by seat order. Its Round 186 Europe
spread instead points to connectivity and frontier access: one seat dominated,
one plateaued alive, and two were eliminated.

## RCI decision

1. Keep v5 champion while the plateau and survival fixes complete local validation.
2. Treat Round 185 as the baseline gate: four of four episode wins, at least
   200,000 mean final tiles, zero holds, and zero rejected decisions.
3. Require every local Europe seat to escape a stagnant neutral-land frontier,
   use legal neutral boats, and avoid holds or rejected actions before upload.
4. When no land, build, or neutral-boat action remains, require an isolated weak
   seat to invade the safest non-allied rival instead of holding to elimination.
5. Require a candidate to beat or match v5 across all four local seats before
   promotion, then use a non-promoting qualifier or hosted A/B run when available.
6. Promote one strategic mechanism at a time. Never replace a winning champion
   from aggregate field correlation alone.
7. Refresh after every completed round and reset the consecutive first-place
   counter after any official rank below 1.
