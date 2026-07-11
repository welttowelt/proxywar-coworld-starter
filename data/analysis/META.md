# Proxy War meta report

Snapshot collected 2026-07-11 after Competition Round 182. The source window
covers rounds 163-182, 78 episodes, 168 participant seats, and 29,147 agent
decisions. All seven ingestion quality checks pass with zero failures.

## Current four-player field

Rounds 181-182 are the current four-player FFA format. The six available
episodes produced this table:

| Player | Matches | Wins | Win rate | Mean final tiles | Rival attacks | Neutral boats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Auri | 6 | 2 | 33.33% | 64,885.7 | 138 | 89 |
| odin free | 6 | 2 | 33.33% | 58,953.3 | 54 | 174 |
| James Boggs | 6 | 2 | 33.33% | 31,245.5 | 83 | 35 |
| Richard Higgins | 6 | 0 | 0% | 1,150.0 | 25 | 39 |

Our versions are split across the two rounds. v2 won 1 of 4 matches. v3 won 1
of 2, averaged 127,807 final tiles, and finished Round 182 second only because
Auri won the seed-order tiebreak at the same 0.5 round score.

## Winning action profile

Four-player winners used **32.87 rival attacks per 100 decisions**, versus
**14.04** for non-winners. That is a 2.34x difference. Winners also spent less
of their action budget on neutral boats, builds, social actions, and holds.

| Actions per 100 decisions | Winners | Non-winners |
| --- | ---: | ---: |
| Rival attacks | 32.87 | 14.04 |
| Neutral attacks | 21.30 | 28.36 |
| Neutral boats | 19.91 | 22.31 |
| Naval invasions | 2.55 | 5.42 |
| Builds | 6.71 | 11.11 |
| Social actions | 8.80 | 11.20 |
| Holds | 1.85 | 2.13 |

The current policy's clearest leak is conversion tempo. Across the six FFA
matches, Auri issued 138 rival attacks while we issued 54, but we launched 174
neutral boats versus Auri's 89. The v4 strategy engine directly addresses this
with target continuity, 10/25/40 attack escalation, a dynamic attack floor, and
a two-boat streak cap.

## Targeting pattern

Auri first converts vulnerable opponents: 65 attacks into Richard, 26 into
James, then 47 into us. We attacked Auri 23 times, Richard 17, and James 14.
The data supports finishing the weakest profitable target before spending the
same decision budget contesting the leader directly.

## Seat effect

The six FFA winners came only from positions 0 and 3. Each position won three
matches; positions 1 and 2 won none. In Round 182 both episodes were won by
position 0, once by us and once by Auri. Spawn actions are deterministic by
seat in the replays, so this is a scheduling and map confound rather than a
clean policy comparison.

The sample is too small to estimate a stable seat adjustment. Keep raw seat
results in every round report and require at least ten FFA rounds before
treating a small win-rate difference as durable.

## Operating loop

1. Run `npm run data:refresh` after each completed competition round.
2. Require zero failures in `data_quality.csv`.
3. Compare `ffa_player_performance.csv`, `ffa_action_profile_by_outcome.csv`,
   `ffa_attack_targets.csv`, and `seat_performance.csv`.
4. Change one strategic mechanism at a time and publish a new policy version.
5. Attribute results by policy version and seat. Do not merge v2, v3, and v4
   when deciding whether a code change worked.
