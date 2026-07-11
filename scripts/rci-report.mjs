import { spawnSync } from "node:child_process";
import process from "node:process";

const strict = process.argv.includes("--strict");
const query = `
  WITH latest AS (
    SELECT *
    FROM read_csv_auto('data/analysis/policy_round_performance.csv')
    ORDER BY round_number DESC
    LIMIT 1
  )
  SELECT
    p.round_number,
    p.rank,
    p.score,
    p.policy_version,
    p.matches,
    p.wins,
    p.win_rate_pct,
    p.mean_final_tiles,
    p.decisions,
    p.holds,
    p.fallbacks,
    (
      SELECT any_value(e.map)
      FROM read_parquet('data/processed/episodes.parquet') e
      JOIN read_parquet('data/processed/rounds.parquet') r USING (round_id)
      WHERE r.round_number = p.round_number
    ) AS map,
    s.current_first_place_streak,
    s.target_first_place_streak,
    (
      SELECT count(*)
      FROM read_parquet('data/processed/decisions.parquet') d
      JOIN read_parquet('data/processed/rounds.parquet') r USING (round_id)
      WHERE r.round_number = p.round_number
        AND d.policy_version_id = p.policy_version_id
        AND d.accepted = false
    ) AS rejected_decisions
  FROM latest p
  CROSS JOIN read_json_auto('site/data/snapshot.json') s
`;

const result = spawnSync("duckdb", ["-json", "-c", query], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const [latest] = JSON.parse(result.stdout);
if (!latest) {
  process.stderr.write("RCI gate failed: no policy round performance row\n");
  process.exit(1);
}

const mapTileFloors = { Europe: 200000, Asia: 150000, Pangaea: 60000 };
const tileFloor = mapTileFloors[latest.map] ?? 200000;
const checks = [
  ["official rank #1", Number(latest.rank) === 1],
  ["four completed episodes", Number(latest.matches) >= 4],
  ["100% episode win rate", Number(latest.wins) === Number(latest.matches)],
  [`mean final tiles >= ${tileFloor.toLocaleString("en-US")} on ${latest.map}`, Number(latest.mean_final_tiles) >= tileFloor],
  ["zero holds", Number(latest.holds) === 0],
  ["zero rejected decisions", Number(latest.rejected_decisions) === 0],
];
const failed = checks.filter(([, passed]) => !passed).map(([label]) => label);
const status = failed.length === 0 ? "PASS" : "FAIL";

process.stdout.write(
  `RCI ROUND ${latest.round_number} v${latest.policy_version}: ${status}\n` +
  `map=${latest.map} rank=#${latest.rank} episodes=${latest.wins}/${latest.matches} ` +
  `mean_tiles=${Math.round(Number(latest.mean_final_tiles))} holds=${latest.holds} ` +
  `rejected=${latest.rejected_decisions} fallbacks=${latest.fallbacks} ` +
  `streak=${latest.current_first_place_streak}/${latest.target_first_place_streak}\n`,
);
if (failed.length > 0) process.stdout.write(`failed_checks=${failed.join("; ")}\n`);
if (strict && failed.length > 0) process.exit(1);
