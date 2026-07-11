CREATE OR REPLACE TEMP VIEW rounds AS
SELECT * FROM read_ndjson_auto('data/staging/rounds.ndjson');

CREATE OR REPLACE TEMP VIEW round_standings AS
SELECT * FROM read_ndjson_auto('data/staging/round_standings.ndjson');

CREATE OR REPLACE TEMP VIEW leaderboard AS
SELECT * FROM read_ndjson_auto('data/staging/leaderboard.ndjson');

CREATE OR REPLACE TEMP VIEW episodes AS
SELECT * FROM read_ndjson_auto('data/staging/episodes.ndjson');

CREATE OR REPLACE TEMP VIEW participants AS
SELECT * FROM read_ndjson_auto('data/staging/participants.ndjson');

CREATE OR REPLACE TEMP VIEW decisions AS
SELECT * FROM read_ndjson_auto('data/staging/decisions.ndjson');

COPY (SELECT * FROM rounds ORDER BY round_number)
TO 'data/processed/rounds.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM round_standings ORDER BY round_number, rank)
TO 'data/processed/round_standings.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM leaderboard ORDER BY rank)
TO 'data/processed/leaderboard.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM episodes ORDER BY completed_at, episode_id)
TO 'data/processed/episodes.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM participants ORDER BY round_id, episode_id, participant_position)
TO 'data/processed/participants.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM decisions ORDER BY round_id, episode_id, sequence)
TO 'data/processed/decisions.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

CREATE OR REPLACE TEMP VIEW decision_rollup AS
SELECT
  episode_id,
  participant_position,
  count(*) AS decisions,
  count(*) FILTER (WHERE is_neutral_attack) AS neutral_attacks,
  count(*) FILTER (WHERE is_rival_attack) AS rival_attacks,
  count(*) FILTER (WHERE is_neutral_boat) AS neutral_boats,
  count(*) FILTER (WHERE is_naval_invasion) AS naval_invasions,
  count(*) FILTER (WHERE is_build) AS builds,
  count(*) FILTER (WHERE is_social) AS social_actions,
  count(*) FILTER (WHERE is_hold) AS holds,
  count(*) FILTER (WHERE fallback_used) AS fallbacks,
  avg(decision_latency_ms) AS mean_decision_latency_ms
FROM decisions
GROUP BY episode_id, participant_position;

CREATE OR REPLACE TEMP VIEW player_matches AS
SELECT
  r.round_number,
  e.player_count,
  e.variant_name,
  e.coworld_version,
  p.*,
  coalesce(d.decisions, 0) AS decisions,
  coalesce(d.neutral_attacks, 0) AS neutral_attacks,
  coalesce(d.rival_attacks, 0) AS rival_attacks,
  coalesce(d.neutral_boats, 0) AS neutral_boats,
  coalesce(d.naval_invasions, 0) AS naval_invasions,
  coalesce(d.builds, 0) AS builds,
  coalesce(d.social_actions, 0) AS social_actions,
  coalesce(d.holds, 0) AS holds,
  coalesce(d.fallbacks, 0) AS fallbacks,
  d.mean_decision_latency_ms
FROM participants p
JOIN rounds r USING (round_id)
JOIN episodes e USING (episode_id, round_id)
LEFT JOIN decision_rollup d USING (episode_id, participant_position);

COPY (
  SELECT
    round_number,
    rank,
    score,
    player_name,
    policy_name,
    policy_version,
    policy_version_id,
    completed_episode_count,
    seed_order
  FROM round_standings
  ORDER BY round_number, rank
) TO 'data/analysis/round_standings.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    rank,
    player_name,
    score,
    rounds_played,
    episode_wins,
    episodes_played,
    win_rate,
    collected_at
  FROM leaderboard
  ORDER BY rank
) TO 'data/analysis/leaderboard_snapshot.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    player_count,
    player_name,
    policy_name,
    policy_version,
    policy_version_id,
    count(*) AS matches,
    sum(won::INTEGER) AS wins,
    round(100.0 * avg(won::INTEGER), 2) AS win_rate_pct,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    round(median(final_tiles), 1) AS median_final_tiles,
    sum(decisions) AS decisions,
    sum(rival_attacks) AS rival_attacks,
    sum(neutral_attacks) AS neutral_attacks,
    sum(neutral_boats) AS neutral_boats,
    sum(naval_invasions) AS naval_invasions,
    sum(builds) AS builds,
    sum(social_actions) AS social_actions,
    sum(holds) AS holds,
    round(100.0 * sum(fallbacks) / nullif(sum(decisions), 0), 2) AS fallback_rate_pct
  FROM player_matches
  GROUP BY player_count, player_name, policy_name, policy_version, policy_version_id
  ORDER BY player_count DESC, win_rate_pct DESC, mean_final_tiles DESC
) TO 'data/analysis/player_performance.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    player_count,
    won,
    count(*) AS player_matches,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    round(100.0 * sum(rival_attacks) / nullif(sum(decisions), 0), 2) AS rival_attacks_per_100_decisions,
    round(100.0 * sum(neutral_attacks) / nullif(sum(decisions), 0), 2) AS neutral_attacks_per_100_decisions,
    round(100.0 * sum(neutral_boats) / nullif(sum(decisions), 0), 2) AS neutral_boats_per_100_decisions,
    round(100.0 * sum(naval_invasions) / nullif(sum(decisions), 0), 2) AS invasions_per_100_decisions,
    round(100.0 * sum(builds) / nullif(sum(decisions), 0), 2) AS builds_per_100_decisions,
    round(100.0 * sum(social_actions) / nullif(sum(decisions), 0), 2) AS social_per_100_decisions,
    round(100.0 * sum(holds) / nullif(sum(decisions), 0), 2) AS holds_per_100_decisions
  FROM player_matches
  GROUP BY player_count, won
  ORDER BY player_count DESC, won DESC
) TO 'data/analysis/winner_action_profile.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    player_name,
    count(*) AS matches,
    sum(won::INTEGER) AS wins,
    round(100.0 * avg(won::INTEGER), 2) AS win_rate_pct,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    round(median(final_tiles), 1) AS median_final_tiles,
    sum(decisions) AS decisions,
    sum(rival_attacks) AS rival_attacks,
    sum(neutral_attacks) AS neutral_attacks,
    sum(neutral_boats) AS neutral_boats,
    sum(naval_invasions) AS naval_invasions,
    sum(builds) AS builds,
    sum(social_actions) AS social_actions,
    sum(holds) AS holds
  FROM player_matches
  WHERE player_count = 4
  GROUP BY player_name
  ORDER BY wins DESC, mean_final_tiles DESC
) TO 'data/analysis/ffa_player_performance.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    won,
    count(*) AS player_matches,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    round(100.0 * sum(rival_attacks) / nullif(sum(decisions), 0), 2) AS rival_attacks_per_100_decisions,
    round(100.0 * sum(neutral_attacks) / nullif(sum(decisions), 0), 2) AS neutral_attacks_per_100_decisions,
    round(100.0 * sum(neutral_boats) / nullif(sum(decisions), 0), 2) AS neutral_boats_per_100_decisions,
    round(100.0 * sum(naval_invasions) / nullif(sum(decisions), 0), 2) AS invasions_per_100_decisions,
    round(100.0 * sum(builds) / nullif(sum(decisions), 0), 2) AS builds_per_100_decisions,
    round(100.0 * sum(social_actions) / nullif(sum(decisions), 0), 2) AS social_per_100_decisions,
    round(100.0 * sum(holds) / nullif(sum(decisions), 0), 2) AS holds_per_100_decisions
  FROM player_matches
  WHERE player_count = 4
  GROUP BY won
  ORDER BY won DESC
) TO 'data/analysis/ffa_action_profile_by_outcome.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    d.player_name AS attacker,
    d.target_name,
    count(*) AS rival_attacks,
    round(avg(d.relative_troop_ratio), 2) AS mean_relative_troop_ratio,
    round(median(d.relative_troop_ratio), 2) AS median_relative_troop_ratio,
    round(avg(d.troop_percent), 1) AS mean_troop_percent
  FROM decisions d
  JOIN episodes e USING (episode_id, round_id)
  WHERE e.player_count = 4 AND d.is_rival_attack AND d.target_name IS NOT NULL
  GROUP BY d.player_name, d.target_name
  ORDER BY d.player_name, rival_attacks DESC
) TO 'data/analysis/ffa_attack_targets.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    round_number,
    player_count,
    player_name,
    policy_version,
    count(*) AS matches,
    sum(won::INTEGER) AS wins,
    round(100.0 * avg(won::INTEGER), 2) AS win_rate_pct,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    sum(rival_attacks) AS rival_attacks,
    sum(neutral_boats) AS neutral_boats,
    sum(builds) AS builds,
    sum(social_actions) AS social_actions
  FROM player_matches
  GROUP BY round_number, player_count, player_name, policy_version
  ORDER BY round_number, wins DESC, mean_final_tiles DESC
) TO 'data/analysis/round_results.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    player_count,
    participant_position,
    count(*) AS player_matches,
    sum(won::INTEGER) AS wins,
    round(100.0 * avg(won::INTEGER), 2) AS win_rate_pct,
    round(avg(final_tiles), 1) AS mean_final_tiles
  FROM player_matches
  GROUP BY player_count, participant_position
  ORDER BY player_count, participant_position
) TO 'data/analysis/seat_performance.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    e.player_count,
    min(r.round_number) AS first_round,
    max(r.round_number) AS last_round,
    count(DISTINCT e.round_id) AS rounds,
    count(DISTINCT e.episode_id) AS episodes,
    count(p.episode_id) AS participant_rows
  FROM episodes e
  JOIN rounds r USING (round_id)
  JOIN participants p USING (episode_id, round_id)
  GROUP BY e.player_count
  ORDER BY e.player_count
) TO 'data/analysis/format_summary.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    e.player_count,
    CASE
      WHEN relative_troop_ratio < 0.9 THEN '<0.9'
      WHEN relative_troop_ratio < 1.0 THEN '0.9-0.99'
      WHEN relative_troop_ratio < 1.2 THEN '1.0-1.19'
      WHEN relative_troop_ratio < 1.5 THEN '1.2-1.49'
      WHEN relative_troop_ratio < 2.0 THEN '1.5-1.99'
      ELSE '2.0+'
    END AS relative_troop_ratio_bin,
    troop_percent,
    count(*) AS rival_attacks,
    count(DISTINCT episode_id) AS episodes
  FROM decisions
  JOIN episodes e USING (episode_id, round_id)
  WHERE is_rival_attack AND relative_troop_ratio IS NOT NULL
  GROUP BY 1, 2, 3
  ORDER BY e.player_count, min(relative_troop_ratio), troop_percent
) TO 'data/analysis/attack_ratio_profile.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT 'duplicate_round_ids' AS check_name,
    count(*) - count(DISTINCT round_id) AS failures, count(*) AS rows_checked
  FROM rounds
  UNION ALL
  SELECT 'duplicate_episode_ids', count(*) - count(DISTINCT episode_id), count(*) FROM episodes
  UNION ALL
  SELECT 'duplicate_round_standing_grain',
    count(*) - count(DISTINCT round_id || ':' || policy_version_id), count(*) FROM round_standings
  UNION ALL
  SELECT 'round_standing_count_mismatch',
    abs((SELECT count(*) FROM round_standings) - (SELECT sum(entrant_count) FROM rounds)),
    (SELECT count(*) FROM round_standings)
  UNION ALL
  SELECT 'duplicate_leaderboard_ranks', count(*) - count(DISTINCT rank), count(*) FROM leaderboard
  UNION ALL
  SELECT 'duplicate_participant_grain', count(*) - count(DISTINCT episode_id || ':' || participant_position), count(*) FROM participants
  UNION ALL
  SELECT 'duplicate_decision_sequence', count(*) - count(DISTINCT episode_id || ':' || sequence), count(*) FROM decisions
  UNION ALL
  SELECT 'decisions_without_participant', count(*) FILTER (WHERE policy_version_id IS NULL), count(*) FROM decisions
  UNION ALL
  SELECT 'participants_without_final_tiles', count(*) FILTER (WHERE final_tiles IS NULL), count(*) FROM participants
  UNION ALL
  SELECT 'rejected_decisions', count(*) FILTER (WHERE accepted = false), count(*) FROM decisions
  UNION ALL
  SELECT 'participant_count_mismatch',
    abs((SELECT count(*) FROM participants) - (SELECT sum(player_count) FROM episodes)),
    (SELECT count(*) FROM participants)
  UNION ALL
  SELECT 'decisions_without_episode', count(*) FILTER (WHERE e.episode_id IS NULL), count(*)
  FROM decisions d LEFT JOIN episodes e USING (episode_id, round_id)
) TO 'data/analysis/data_quality.csv' (HEADER, DELIMITER ',');
