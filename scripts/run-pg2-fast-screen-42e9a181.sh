#!/bin/zsh

# Two-pair PG2 screen: fast rejection evidence, never promotion evidence.
set -euo pipefail

if (( $# != 2 )); then
  print -u2 "usage: $0 WORLD_OUTPUT PANGAEA_OUTPUT"
  exit 64
fi

repo=/Users/olifreuler/proxywar-coworld-starter
pair_runner=$repo/scripts/run-pg2-parent-control-replay-42e9a181.sh
protocol=$repo/experiments/lean-prototype-protocol-20260719.json
world_output=$1
pangaea_output=$2

[[ -x $pair_runner && -f $protocol ]]
[[ -d $world_output && -f $world_output/.proxywar-runner-claim ]]
[[ -d $pangaea_output && -f $pangaea_output/.proxywar-runner-claim ]]

"$pair_runner" lb4zz7jzgq9tr2 "$world_output" world-20260721 a 1 World 20260721 >"$world_output/world.log" 2>&1 &
world_pid=$!
"$pair_runner" 2g5whxhph9bwbz "$pangaea_output" pangaea-20260721 a 5 Pangaea 20260721 >"$pangaea_output/pangaea.log" 2>&1 &
pangaea_pid=$!

wait "$world_pid"
wait "$pangaea_pid"

python3 - "$world_output/evidence/world-20260721/audit.json" "$pangaea_output/evidence/pangaea-20260721/audit.json" "$world_output/evidence/fast-screen-audit.json" <<'PY'
import datetime as dt
import json
import sys

audit_paths = sys.argv[1:3]
output_path = sys.argv[3]
audits = [json.load(open(path, encoding="utf-8")) for path in audit_paths]
failures = []
scores = []
control_replays = []
for audit in audits:
    candidate = audit.get("candidate", {})
    pair = audit.get("pair")
    if audit.get("verdict") == "REPLAY_REQUIRED":
        control_replays.append(pair)
    elif audit.get("verdict") != "CONTINUE":
        failures.append(f"{pair}: pair verdict {audit.get('verdict')}")
    for key in ("violations", "rejected_decisions", "unexplained_holds", "k1z_harmful_actions"):
        if candidate.get(key):
            failures.append(f"{pair}: candidate {key}")
    if int(candidate.get("marker_count") or 0) == 0:
        failures.append(f"{pair}: zero marker reach")
    score = (audit.get("paired_deltas") or {}).get("final_score")
    if not isinstance(score, (int, float)):
        failures.append(f"{pair}: missing paired final score")
    else:
        scores.append(score)

if failures:
    verdict = "STOP"
    reason = "candidate integrity or safety failure"
elif control_replays:
    verdict = "REPLAY_REQUIRED"
    reason = "parent control anomaly requires one exact replay"
elif all(score < 0 for score in scores):
    verdict = "STOP"
    reason = "negative paired final score in both screen cells"
else:
    verdict = "CONTINUE_TO_PROOF"
    reason = "clean screen with at least one non-negative paired final score"

report = {
    "schema_version": 1,
    "arm": "pg2",
    "kind": "fast_screen",
    "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    "verdict": verdict,
    "reason": reason,
    "pair_audits": audit_paths,
    "paired_final_scores": scores,
    "failures": failures,
    "control_replays": control_replays,
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
    handle.write("\n")
print(f"PG2_FAST_SCREEN={verdict}")
PY
