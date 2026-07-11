# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 186. The source window
covers rounds 167-186, 75 episodes, 188 participant seats, and 28,856 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 187 is running with v5 in the roster. Round 186 reset the verified
consecutive first-place streak to 0 of the 10-round target.

## Current four-player field

Rounds 181-186 use the current four-player FFA format. The 19 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 19 | 7 | 36.84% | 101,766.9 | 222 | 68 |
| Auri | 19 | 3 | 15.79% | 78,444.1 | 337 | 124 |
| James Boggs | 19 | 3 | 15.79% | 32,978.0 | 133 | 15 |
| Richard Higgins | 19 | 0 | 0.00% | 2,339.2 | 60 | 1 |

The aggregate holds column includes the broken v4 round. v5 itself recorded zero
holds and zero rejected decisions in both Rounds 185 and 186.

## Policy progression

| Round | Version | Official rank | Episode wins | Mean final tiles | Holds |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 181 | v2 | 3 | 1/4 | 24,526.5 | 6 |
| 182 | v3 | 2 | 1/2 | 127,807.0 | 0 |
| 183 | v3 | 1 | 1/1 | 461,851.0 | 0 |
| 184 | v4 | 3 | 0/4 | 0.0 | 62 |
| 185 | v5 | 1 | 4/4 | 218,109.5 | 0 |
| 186 | v5 | 2 | 0/4* | 61,390.8 | 0 |

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

## Winning action profile

Four-player winners use 29.79 rival attacks per 100 decisions versus 7.00 for
non-winners, a 4.26x difference. Winners also allocate fewer decisions to neutral
expansion, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 29.79 | 7.00 |
| Neutral attacks | 35.96 | 54.22 |
| Neutral boats | 15.65 | 9.22 |
| Naval invasions | 1.14 | 1.49 |
| Builds | 5.60 | 7.67 |
| Social actions | 4.74 | 14.24 |
| Holds | 2.56 | 2.89 |

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

| Recommendation | Winners | Non-winners | v5 R185 | v5 R186 |
| --- | ---: | ---: | ---: | ---: |
| Opening tempo | 87.30% | 60.95% | 100.00% | 98.39% |
| Frontier conversion | 55.27% | 67.44% | 85.71% | 85.71% |
| Economy cadence | 7.88% | 11.48% | 10.34% | 4.75% |
| Naval control | 20.03% | 10.92% | 0.95% | 0.00% |
| Diplomacy pressure | 2.68% | 4.37% | 0.00% | 0.00% |
| Transport banking | 22.82% | 10.54% | 0.00% | 0.00% |

Opening tempo remains the strongest positive signal, but tactical adherence alone did
not detect the Europe plateau. Keep neutral land first while it increases tile share,
switch to a neutral boat when repeated accepted attacks produce no growth, then resume
rapid rival conversion. Continue sparse builds and almost no social diversion.

## Seat effect

Each seat now has 19 observed FFA appearances. v5 won exactly once from each seat
in Round 185, so that sweep was not explained by seat order. Its Round 186 Europe
spread instead points to connectivity and frontier access: one seat dominated,
one plateaued alive, and two were eliminated.

## RCI decision

1. Keep v5 champion while the plateau fix completes local Europe validation.
2. Treat Round 185 as the baseline gate: four of four episode wins, at least
   200,000 mean final tiles, zero holds, and zero rejected decisions.
3. Require every local Europe seat to escape a stagnant neutral-land frontier,
   use legal neutral boats, and avoid holds or rejected actions before upload.
4. Require a candidate to beat or match v5 across all four local seats before
   promotion, then use a non-promoting qualifier or hosted A/B run when available.
5. Promote one strategic mechanism at a time. Never replace a winning champion
   from aggregate field correlation alone.
6. Refresh after every completed round and reset the consecutive first-place
   counter after any official rank below 1.
