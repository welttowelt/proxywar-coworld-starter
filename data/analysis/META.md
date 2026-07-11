# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 185. The source window
covers rounds 166-185, 75 episodes, 180 participant seats, and 27,179 agent
decisions. All 12 ingestion quality checks pass with zero failures.

Round 186 is running with v5 in the roster. The verified consecutive first-place
streak is therefore 1 of the 10-round target.

## Current four-player field

Rounds 181-185 use the current four-player FFA format. The 15 available episodes
produce this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Holds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| odin free | 15 | 7 | 46.67% | 112,533.9 | 186 | 68 |
| Auri | 15 | 3 | 20.00% | 46,081.6 | 246 | 39 |
| James Boggs | 15 | 3 | 20.00% | 22,257.7 | 124 | 11 |
| Richard Higgins | 15 | 0 | 0.00% | 2,177.3 | 46 | 1 |

The aggregate holds column includes the broken v4 round. v5 itself recorded zero
holds and zero rejected decisions in Round 185.

## Policy progression

| Round | Version | Official rank | Episode wins | Mean final tiles | Holds |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 181 | v2 | 3 | 1/4 | 24,526.5 | 6 |
| 182 | v3 | 2 | 1/2 | 127,807.0 | 0 |
| 183 | v3 | 1 | 1/1 | 461,851.0 | 0 |
| 184 | v4 | 3 | 0/4 | 0.0 | 62 |
| 185 | v5 | 1 | 4/4 | 218,109.5 | 0 |

v4 misclassified the new structured neutral-land action and held instead of
expanding. v5 fixed the classifier and recovered immediately from every seat.

## Winning action profile

Four-player winners use 29.79 rival attacks per 100 decisions versus 9.62 for
non-winners, a 3.10x difference. Winners also allocate fewer decisions to neutral
expansion, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 29.79 | 9.62 |
| Neutral attacks | 35.96 | 48.81 |
| Neutral boats | 15.65 | 13.02 |
| Naval invasions | 1.14 | 2.10 |
| Builds | 5.60 | 9.85 |
| Social actions | 4.74 | 8.48 |
| Holds | 2.56 | 3.07 |

v5 is more decisive than the pooled winner profile. Across its four Round 185
wins, 56.9% of decisions attacked rivals and 28.4% expanded into neutral land.

## v5 phase profile

| Phase | Decisions | Rival attacks | Neutral attacks | Builds | Holds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opening, decisions 1-10 | 40 | 0.00% | 70.00% | 0.00% | 0.00% |
| Conversion, decisions 11-25 | 60 | 56.67% | 33.33% | 10.00% | 0.00% |
| Finish, decision 26+ | 111 | 77.48% | 10.81% | 10.81% | 0.00% |

The handoff from land acquisition to conversion is consistent. The first rival
attack occurred on decisions 15, 18, 15, and 17 across the four seats.

## Targeting pattern

v5 attacked Auri 62 times, Richard Higgins 32 times, and James Boggs 26 times in
Round 185. Mean attack commitment was 26.0% at a 2.01 relative troop ratio. Its
17.24% target-switch rate is above Auri's winning 13.25% baseline but well below
James Boggs's winning 31.67% rate. No change is justified from this sample because
v5 converted all four matches decisively.

## Seat effect

Each seat now has 15 observed FFA appearances. Seats 1 and 4 each won five,
seat 2 won one, and seat 3 won two. v5 won exactly once from each seat in Round
185, so its result is not explained by the historical outer-seat advantage.

## RCI decision

1. Keep v5 champion while Round 186 is running.
2. Treat Round 185 as the baseline gate: four of four episode wins, at least
   200,000 mean final tiles, zero holds, and zero rejected decisions.
3. Require a candidate to beat or match v5 across all four local seats before
   upload, then use a non-promoting qualifier or hosted A/B run when available.
4. Promote one strategic mechanism at a time. Never replace a winning champion
   from aggregate field correlation alone.
5. Refresh after every completed round and reset the consecutive first-place
   counter after any official rank below 1.
