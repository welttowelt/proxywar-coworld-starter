import { spawnSync } from "node:child_process";
import process from "node:process";

const strict = process.argv.includes("--strict");
const query = `
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
    s.current_first_place_streak,
    s.target_first_place_streak,
    q.failures AS rejected_decisions
  FROM read_csv_auto('data/analysis/policy_round_performance.csv') p
  CROSS JOIN read_json_auto('site/data/snapshot.json') s
  CROSS JOIN (
    SELECT failures
    FROM read_csv_auto('data/analysis/data_quality.csv')
    WHERE check_name = 'rejected_decisions'
  ) q
  ORDER BY p.round_number DESC
  LIMIT 1
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

const checks = [
  ["official rank #1", Number(latest.rank) === 1],
  ["four completed episodes", Number(latest.matches) >= 4],
  ["100% episode win rate", Number(latest.wins) === Number(latest.matches)],
  ["mean final tiles >= 200,000", Number(latest.mean_final_tiles) >= 200000],
  ["zero holds", Number(latest.holds) === 0],
  ["zero rejected decisions", Number(latest.rejected_decisions) === 0],
];
const failed = checks.filter(([, passed]) => !passed).map(([label]) => label);
const status = failed.length === 0 ? "PASS" : "FAIL";

process.stdout.write(
  `RCI ROUND ${latest.round_number} v${latest.policy_version}: ${status}\n` +
  `rank=#${latest.rank} episodes=${latest.wins}/${latest.matches} ` +
  `mean_tiles=${Math.round(Number(latest.mean_final_tiles))} holds=${latest.holds} ` +
  `rejected=${latest.rejected_decisions} fallbacks=${latest.fallbacks} ` +
  `streak=${latest.current_first_place_streak}/${latest.target_first_place_streak}\n`,
);
if (failed.length > 0) process.stdout.write(`failed_checks=${failed.join("; ")}\n`);
if (strict && failed.length > 0) process.exit(1);
