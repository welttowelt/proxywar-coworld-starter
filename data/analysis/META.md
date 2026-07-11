# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 187. The source window
covers rounds 168-187, 75 episodes, 196 participant seats, and 28,882 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 188 is running with v5 in the roster. Round 187 restarted the verified
consecutive first-place streak at 1 of the 10-round target.

## Current four-player field

Rounds 181-187 use the current four-player FFA format. The 23 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 23 | 8 | 34.78% | 90,757.7 | 285 | 77 |
| Auri | 23 | 4 | 17.39% | 70,521.7 | 389 | 128 |
| James Boggs | 23 | 4 | 17.39% | 32,438.8 | 154 | 19 |
| Richard Higgins | 23 | 0 | 0.00% | 1,932.3 | 65 | 1 |

The aggregate holds column includes the broken v4 round. v5 recorded zero holds
in Rounds 185 and 186, then nine holds in one collapsing Round 187 seat. The
dataset still has zero rejected decisions.

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

## Winning action profile

Four-player winners use 29.16 rival attacks per 100 decisions versus 6.90 for
non-winners, a 4.23x difference. Winners also allocate fewer decisions to neutral
expansion, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 29.16 | 6.90 |
| Neutral attacks | 36.60 | 55.05 |
| Neutral boats | 14.12 | 9.17 |
| Naval invasions | 2.58 | 1.44 |
| Builds | 5.92 | 7.67 |
| Social actions | 5.09 | 13.01 |
| Holds | 2.05 | 2.68 |

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

| Recommendation | Winners | Non-winners | v5 R185 | v5 R186 | v5 R187 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opening tempo | 85.92% | 60.93% | 100.00% | 98.39% | 100.00% |
| Frontier conversion | 56.38% | 63.35% | 85.71% | 85.71% | 51.56% |
| Economy cadence | 8.88% | 11.56% | 10.34% | 4.75% | 7.99% |
| Naval control | 19.76% | 10.77% | 0.95% | 0.00% | 5.03% |
| Diplomacy pressure | 2.69% | 3.98% | 0.00% | 0.00% | 0.00% |
| Transport banking | 23.19% | 10.21% | 0.00% | 0.00% | 5.18% |

Opening tempo remains the strongest positive signal, but tactical adherence alone did
not detect the Europe plateau. Keep neutral land first while it increases tile share,
switch to a neutral boat when repeated accepted attacks produce no growth, then resume
rapid rival conversion. Continue sparse builds and almost no social diversion.

## Seat effect

Each seat now has 23 observed FFA appearances. v5 won exactly once from each seat
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
