CREATE OR REPLACE TEMP VIEW rounds AS
SELECT * FROM read_ndjson_auto('data/staging/rounds.ndjson');

CREATE OR REPLACE TEMP VIEW live_rounds AS
SELECT * FROM read_ndjson_auto('data/staging/live_rounds.ndjson');

CREATE OR REPLACE TEMP VIEW round_standings AS
SELECT * FROM read_ndjson_auto('data/staging/round_standings.ndjson');

CREATE OR REPLACE TEMP VIEW official_streak AS
SELECT * FROM read_json_auto('data/processed/official_streak.json');

CREATE OR REPLACE TEMP VIEW leaderboard AS
SELECT * FROM read_ndjson_auto('data/staging/leaderboard.ndjson');

CREATE OR REPLACE TEMP VIEW memberships AS
SELECT * FROM read_ndjson_auto('data/staging/memberships.ndjson');

CREATE OR REPLACE TEMP VIEW challenger_memberships AS
SELECT * FROM read_ndjson_auto('data/staging/challenger_memberships.ndjson');

CREATE OR REPLACE TEMP VIEW episodes AS
SELECT * FROM read_ndjson_auto('data/staging/episodes.ndjson');

CREATE OR REPLACE TEMP VIEW participants AS
SELECT * FROM read_ndjson_auto('data/staging/participants.ndjson');

CREATE OR REPLACE TEMP VIEW decisions AS
SELECT * FROM read_ndjson_auto('data/staging/decisions.ndjson');

COPY (SELECT * FROM rounds ORDER BY round_number)
TO 'data/processed/rounds.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM live_rounds ORDER BY round_number DESC)
TO 'data/processed/live_rounds.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM round_standings ORDER BY round_number, rank)
TO 'data/processed/round_standings.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM leaderboard ORDER BY rank)
TO 'data/processed/leaderboard.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM memberships ORDER BY policy_version DESC)
TO 'data/processed/memberships.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM challenger_memberships ORDER BY start_time DESC)
TO 'data/processed/challenger_memberships.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

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
  e.map,
  e.variant_name,
  e.coworld_version,
  p.*,
  (
    p.score > 0
    AND p.score = max(p.score) OVER (PARTITION BY p.episode_id)
  ) AS episode_lead,
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
  WITH per_round AS (
    SELECT
      round_number,
      player_name,
      count(*) AS round_matches,
      sum(won::INTEGER) AS round_wins
    FROM player_matches
    WHERE player_count = 4
    GROUP BY round_number, player_name
  ),
  rolling AS (
    SELECT
      round_number,
      player_name,
      round_matches,
      round_wins,
      sum(round_matches) OVER recent AS rolling_matches,
      sum(round_wins) OVER recent AS rolling_wins,
      round(100.0 * sum(round_wins) OVER recent / nullif(sum(round_matches) OVER recent, 0), 2)
        AS rolling_win_rate_pct,
      sum(round_matches) OVER history AS cumulative_matches,
      sum(round_wins) OVER history AS cumulative_wins,
      round(100.0 * sum(round_wins) OVER history / nullif(sum(round_matches) OVER history, 0), 2)
        AS cumulative_win_rate_pct
    FROM per_round
    WINDOW
      recent AS (
        PARTITION BY player_name
        ORDER BY round_number
        ROWS BETWEEN 4 PRECEDING AND CURRENT ROW
      ),
      history AS (
        PARTITION BY player_name
        ORDER BY round_number
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
  ),
  rivals AS (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY round_number
        ORDER BY rolling_win_rate_pct DESC, cumulative_win_rate_pct DESC, player_name
      ) AS rival_rank
    FROM rolling
    WHERE player_name <> 'odin free'
  )
  SELECT
    ours.round_number,
    ours.round_wins,
    ours.round_matches,
    ours.rolling_wins,
    ours.rolling_matches,
    ours.rolling_win_rate_pct AS odin_rolling_win_rate_pct,
    ours.cumulative_wins,
    ours.cumulative_matches,
    ours.cumulative_win_rate_pct AS odin_cumulative_win_rate_pct,
    rival.player_name AS best_rival_name,
    rival.rolling_wins AS best_rival_rolling_wins,
    rival.rolling_matches AS best_rival_rolling_matches,
    rival.rolling_win_rate_pct AS best_rival_rolling_win_rate_pct,
    round(ours.rolling_win_rate_pct - rival.rolling_win_rate_pct, 2) AS dominance_gap_pct
  FROM rolling ours
  JOIN rivals rival USING (round_number)
  WHERE ours.player_name = 'odin free' AND rival.rival_rank = 1
  ORDER BY ours.round_number
) TO 'data/analysis/ffa_dominance_trend.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    map,
    player_name,
    policy_version,
    count(*) AS matches,
    sum(won::INTEGER) AS declared_wins,
    sum(episode_lead::INTEGER) AS episode_points,
    round(100.0 * avg(episode_lead::INTEGER), 2) AS point_rate_pct,
    round(avg(final_tiles), 1) AS mean_final_tiles,
    round(100.0 * sum(rival_attacks) / nullif(sum(decisions), 0), 2) AS rival_attacks_per_100_decisions,
    round(100.0 * sum(neutral_attacks) / nullif(sum(decisions), 0), 2) AS neutral_attacks_per_100_decisions,
    round(100.0 * sum(neutral_boats) / nullif(sum(decisions), 0), 2) AS neutral_boats_per_100_decisions,
    sum(holds) AS holds
  FROM player_matches
  WHERE player_count = 4 AND map IS NOT NULL
  GROUP BY map, player_name, policy_version
  ORDER BY map, player_name, policy_version
) TO 'data/analysis/map_policy_performance.csv' (HEADER, DELIMITER ',');

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
  ORDER BY d.player_name, rival_attacks DESC, d.target_name
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
  ORDER BY round_number, wins DESC, mean_final_tiles DESC, player_name
) TO 'data/analysis/round_results.csv' (HEADER, DELIMITER ',');

COPY (
  SELECT
    p.round_number,
    s.rank,
    s.score,
    p.policy_version,
    p.policy_version_id,
    count(*) AS matches,
    sum(p.won::INTEGER) AS wins,
    round(100.0 * avg(p.won::INTEGER), 2) AS win_rate_pct,
    round(avg(p.final_tiles), 1) AS mean_final_tiles,
    sum(p.decisions) AS decisions,
    sum(p.rival_attacks) AS rival_attacks,
    sum(p.neutral_attacks) AS neutral_attacks,
    sum(p.neutral_boats) AS neutral_boats,
    sum(p.builds) AS builds,
    sum(p.social_actions) AS social_actions,
    sum(p.holds) AS holds,
    sum(p.fallbacks) AS fallbacks
  FROM player_matches p
  JOIN round_standings s
    ON s.round_id = p.round_id
    AND s.policy_version_id = p.policy_version_id
  WHERE p.player_name = 'odin free'
  GROUP BY p.round_number, s.rank, s.score, p.policy_version, p.policy_version_id
  ORDER BY p.round_number
) TO 'data/analysis/policy_round_performance.csv' (HEADER, DELIMITER ',');

COPY (
  WITH ordered AS (
    SELECT
      d.*,
      p.won,
      row_number() OVER (
        PARTITION BY d.episode_id, d.participant_position
        ORDER BY d.sequence
      ) AS own_decision
    FROM decisions d
    JOIN episodes e USING (episode_id, round_id)
    JOIN participants p USING (episode_id, round_id, participant_position)
    WHERE e.player_count = 4
  )
  SELECT
    player_name,
    policy_version,
    won,
    CASE
      WHEN own_decision <= 10 THEN 'opening'
      WHEN own_decision <= 25 THEN 'conversion'
      ELSE 'finish'
    END AS phase,
    count(*) AS decisions,
    round(100.0 * avg(is_rival_attack::INTEGER), 2) AS rival_attack_rate_pct,
    round(100.0 * avg(is_neutral_attack::INTEGER), 2) AS neutral_attack_rate_pct,
    round(100.0 * avg(is_build::INTEGER), 2) AS build_rate_pct,
    round(100.0 * avg(is_social::INTEGER), 2) AS social_rate_pct,
    round(100.0 * avg(is_hold::INTEGER), 2) AS hold_rate_pct,
    round(avg(relative_troop_ratio) FILTER (WHERE is_rival_attack), 2) AS mean_attack_ratio,
    round(avg(troop_percent) FILTER (WHERE is_rival_attack), 1) AS mean_attack_percent
  FROM ordered
  GROUP BY player_name, policy_version, won, phase
  ORDER BY player_name, policy_version, won DESC,
    CASE phase WHEN 'opening' THEN 1 WHEN 'conversion' THEN 2 ELSE 3 END
) TO 'data/analysis/ffa_phase_profile.csv' (HEADER, DELIMITER ',');

COPY (
  WITH attacks AS (
    SELECT
      d.player_name,
      d.policy_version,
      p.won,
      d.episode_id,
      d.participant_position,
      d.sequence,
      d.target_name,
      d.relative_troop_ratio,
      d.troop_percent,
      lag(d.target_name) OVER (
        PARTITION BY d.episode_id, d.participant_position
        ORDER BY d.sequence
      ) AS previous_target
    FROM decisions d
    JOIN episodes e USING (episode_id, round_id)
    JOIN participants p USING (episode_id, round_id, participant_position)
    WHERE e.player_count = 4 AND d.is_rival_attack
  )
  SELECT
    player_name,
    policy_version,
    won,
    count(*) AS rival_attacks,
    count(*) FILTER (
      WHERE previous_target IS NOT NULL AND target_name <> previous_target
    ) AS target_switches,
    round(100.0 * count(*) FILTER (
      WHERE previous_target IS NOT NULL AND target_name <> previous_target
    ) / nullif(count(*) FILTER (WHERE previous_target IS NOT NULL), 0), 2) AS switch_rate_pct,
    round(avg(relative_troop_ratio), 2) AS mean_attack_ratio,
    round(avg(troop_percent), 1) AS mean_attack_percent
  FROM attacks
  GROUP BY player_name, policy_version, won
  ORDER BY won DESC, rival_attacks DESC
) TO 'data/analysis/target_continuity.csv' (HEADER, DELIMITER ',');

COPY (
  WITH ffa AS (
    SELECT d.*, p.won
    FROM decisions d
    JOIN episodes e USING (episode_id, round_id)
    JOIN participants p USING (episode_id, round_id, participant_position)
    WHERE e.player_count = 4
  ), tactical AS (
    SELECT player_name, policy_version, won, 'opening_tempo' AS tactic,
      count(*) FILTER (WHERE opening_tempo_recommended) AS recommendations,
      count(*) FILTER (WHERE opening_tempo_recommended AND opening_tempo_aligned) AS aligned
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'frontier_conversion',
      count(*) FILTER (WHERE conversion_recommended),
      count(*) FILTER (WHERE conversion_recommended AND conversion_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'finish_pressure',
      count(*) FILTER (WHERE finish_recommended),
      count(*) FILTER (WHERE finish_recommended AND finish_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'economy_cadence',
      count(*) FILTER (WHERE economy_recommended),
      count(*) FILTER (WHERE economy_recommended AND economy_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'naval_control',
      count(*) FILTER (WHERE naval_recommended),
      count(*) FILTER (WHERE naval_recommended AND naval_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'diplomacy_pressure',
      count(*) FILTER (WHERE diplomacy_recommended),
      count(*) FILTER (WHERE diplomacy_recommended AND diplomacy_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'transport_banking',
      count(*) FILTER (WHERE banking_recommended),
      count(*) FILTER (WHERE banking_recommended AND banking_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
    UNION ALL
    SELECT player_name, policy_version, won, 'strike_targeting',
      count(*) FILTER (WHERE strike_recommended),
      count(*) FILTER (WHERE strike_recommended AND strike_aligned)
    FROM ffa GROUP BY player_name, policy_version, won
  )
  SELECT
    player_name,
    policy_version,
    won,
    tactic,
    recommendations,
    aligned,
    round(100.0 * aligned / nullif(recommendations, 0), 2) AS adherence_rate_pct
  FROM tactical
  WHERE recommendations > 0
  ORDER BY won DESC, player_name, policy_version, tactic
) TO 'data/analysis/tactical_adherence.csv' (HEADER, DELIMITER ',');

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

COPY (
  SELECT
    strftime(max(r.collected_at), '%Y-%m-%dT%H:%M:%S.%gZ') AS collected_at,
    count(DISTINCT r.round_id) AS collected_rounds,
    min(r.round_number) AS first_round,
    max(r.round_number) AS last_completed_round,
    (SELECT count(*) FROM episodes) AS episodes,
    (SELECT count(*) FROM participants) AS participant_rows,
    (SELECT count(*) FROM decisions) AS decisions,
    (SELECT current_first_place_streak FROM official_streak) AS current_first_place_streak,
    100 AS target_first_place_streak,
    (SELECT first_place_finishes FROM official_streak) AS first_place_finishes,
    (
      SELECT wins
      FROM read_csv_auto('data/analysis/ffa_player_performance.csv')
      WHERE player_name = 'odin free'
    ) AS current_ffa_wins,
    (
      SELECT matches
      FROM read_csv_auto('data/analysis/ffa_player_performance.csv')
      WHERE player_name = 'odin free'
    ) AS current_ffa_matches,
    (
      SELECT win_rate_pct
      FROM read_csv_auto('data/analysis/ffa_player_performance.csv')
      WHERE player_name = 'odin free'
    ) AS current_ffa_win_rate_pct,
    99.0 AS target_ffa_win_rate_pct,
    (
      SELECT ceil(0.99 * matches)::BIGINT
      FROM read_csv_auto('data/analysis/ffa_player_performance.csv')
      WHERE player_name = 'odin free'
    ) AS target_ffa_wins,
    (
      SELECT coalesce(sum(failures), 0)
      FROM read_csv_auto('data/analysis/data_quality.csv')
    ) AS data_quality_failures
  FROM rounds r
) TO 'site/data/snapshot.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    r.round_id,
    r.round_number,
    r.status,
    r.entrant_count,
    count(DISTINCT e.episode_id) AS episodes,
    max(e.player_count) AS player_count,
    strftime(r.started_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS started_at,
    strftime(r.completed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS completed_at
  FROM rounds r
  LEFT JOIN episodes e USING (round_id)
  GROUP BY ALL
  ORDER BY r.round_number DESC
) TO 'site/data/rounds.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    round_id,
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
  ORDER BY round_number DESC, rank
) TO 'site/data/round-standings.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    round_id,
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
  WHERE player_name = 'odin free'
  ORDER BY round_number DESC
) TO 'site/data/our-results.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/ffa_player_performance.csv')
  ORDER BY wins DESC, mean_final_tiles DESC
) TO 'site/data/ffa-players.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/ffa_dominance_trend.csv')
  ORDER BY round_number
) TO 'site/data/dominance-trend.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT release.version, release.codename, release.status
  FROM (
    SELECT unnest(releases) AS release
    FROM read_json_auto('experiments/codenames.json')
  )
  ORDER BY try_cast(replace(release.version, 'v', '') AS INTEGER)
) TO 'site/data/policy-codenames.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/map_policy_performance.csv')
  ORDER BY map, player_name, policy_version
) TO 'site/data/map-performance.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/ffa_action_profile_by_outcome.csv')
  ORDER BY won DESC
) TO 'site/data/outcome-profile.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/seat_performance.csv')
  WHERE player_count = 4
  ORDER BY participant_position
) TO 'site/data/seat-performance.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM read_csv_auto('data/analysis/tactical_adherence.csv')
  ORDER BY won DESC, player_name, policy_version, tactic
) TO 'site/data/tactical-adherence.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT *
  FROM leaderboard
  ORDER BY rank
) TO 'site/data/leaderboard.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    round_id,
    round_number,
    status,
    entrant_policy_version_ids,
    entrant_count,
    strftime(created_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS created_at,
    strftime(started_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS started_at,
    strftime(completed_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS completed_at,
    error,
    strftime(collected_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS collected_at
  FROM live_rounds
  ORDER BY round_number DESC
) TO 'site/data/live-rounds.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    membership_id,
    status,
    substatus,
    is_champion,
    division_id,
    division_name,
    policy_id,
    policy_name,
    policy_version,
    policy_version_id,
    policy_label,
    player_id,
    player_name,
    strftime(start_time, '%Y-%m-%dT%H:%M:%S.%gZ') AS start_time,
    strftime(end_time::TIMESTAMP, '%Y-%m-%dT%H:%M:%S.%gZ') AS end_time,
    strftime(collected_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS collected_at
  FROM memberships
  ORDER BY is_champion DESC, policy_version DESC
) TO 'site/data/memberships.json' (FORMAT JSON, ARRAY true);

COPY (
  SELECT
    membership_id,
    substatus,
    is_champion,
    policy_version,
    policy_version_id,
    player_name,
    strftime(start_time, '%Y-%m-%dT%H:%M:%S.%gZ') AS start_time,
    strftime(collected_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS collected_at
  FROM challenger_memberships
  ORDER BY start_time DESC, policy_version DESC
) TO 'site/data/challenger-memberships.json' (FORMAT JSON, ARRAY true);
