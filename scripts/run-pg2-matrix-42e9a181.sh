#!/bin/zsh

set -euo pipefail

if (( $# != 4 )); then
  print -u2 "usage: $0 OUTPUT_A OUTPUT_B OUTPUT_C OUTPUT_D"
  exit 64
fi

repo=/Users/olifreuler/proxywar-coworld-starter
archive=/private/tmp/proxywar-pg2-reach-bundle-42e9a181.tar.gz
extractor=/private/tmp/proxywar-pg2-reach-bundle-42e9a181.tar.gz.extract.py
archive_sha=d2f2f154a67f43008a9b8f7cc0e2c66d44d825e088434cf165fe3b751240b9cd
extractor_sha=b15104d711a0e40284bb7c551d9764a7d5953d7134ce68b2560da44ccdfa7d54
candidate_spec=/Users/olifreuler/proxywar-qd1n-pg2/experiments/runpod-pg2-reach-matched-a-20260719.json
parent_spec=/Users/olifreuler/proxywar-qd1n-pg2/experiments/runpod-pg2-reach-matched-b-20260719.json
candidate_spec_sha=a2e75d096904e0612d083d9bb58aafc7ab8cae75f0e2f6cc073eb800b6e8341c
parent_spec_sha=7df76692757232999644d2deb9d011597ae8bc12be025ebc89cf2815044d6c22
worker=$repo/scripts/run-pg2-matrix-worker-42e9a181.sh
auditor=$repo/scripts/audit-pg2-matrix-pair.py
matrix_manifest=$repo/experiments/pg2-matrix-42e9a181.json
remote_stage=/workspace/pg2-repaired-42e9a181
expected_run_id=pg2-matrix-42e9a181
state_root=/Users/olifreuler/.stormforge/proxywar-operators/runner.lock

tracked=(
  scripts/run-pg2-matrix-42e9a181.sh
  scripts/run-pg2-matrix-worker-42e9a181.sh
  scripts/audit-pg2-matrix-pair.py
  experiments/pg2-matrix-42e9a181.json
)
for tracked_path in $tracked; do
  git -C "$repo" ls-files --error-unmatch "$tracked_path" >/dev/null
  git -C "$repo" diff --quiet HEAD -- "$tracked_path"
done
matrix_commit=$(git -C "$repo" rev-parse HEAD)
[[ $matrix_commit =~ ^[a-f0-9]{40}$ ]]
execution_id="pg2-42e9a181-${matrix_commit[1,12]}-$(date -u +%Y%m%dT%H%M%SZ)-$$"

[[ -f $archive && -f $extractor && -f $candidate_spec && -f $parent_spec ]]
[[ -x $worker && -x $auditor ]]
[[ $(shasum -a 256 "$archive" | awk '{print $1}') == $archive_sha ]]
[[ $(shasum -a 256 "$extractor" | awk '{print $1}') == $extractor_sha ]]
[[ $(shasum -a 256 "$candidate_spec" | awk '{print $1}') == $candidate_spec_sha ]]
[[ $(shasum -a 256 "$parent_spec" | awk '{print $1}') == $parent_spec_sha ]]
jq -e '
  .schema_version == 1
  and .arm == "pg2"
  and (.assignments | length) == 24
  and ([.assignments[].lane] | group_by(.) | all(length == 6))
  and ([.assignments[].map] | group_by(.) | all(length == 8))
  and ([.assignments[].wave] | group_by(.) | all(length == 4))
' "$matrix_manifest" >/dev/null

typeset -A pod_id pod_ip pod_port pod_key pod_remote pod_output pod_home pod_bundle
pod_id=(
  a lb4zz7jzgq9tr2
  b 2g5whxhph9bwbz
  c 877itccar33zdp
  d 76stn0v7q81d47
)
pod_output=(a "$1" b "$2" c "$3" d "$4")

runner_owned() {
  local label=${1:-}
  local lease_status
  lease_status=$("$repo/scripts/proxywar-runner-lease.sh" status --json)
  jq -e \
    --arg run_id "$expected_run_id" \
    --arg a "${pod_output[a]}" \
    --arg b "${pod_output[b]}" \
    --arg c "${pod_output[c]}" \
    --arg d "${pod_output[d]}" \
    '
      .state == "active"
      and .owner == "odin"
      and .run_id == $run_id
      and .supervisor_alive == true
      and .child_alive == true
      and .reap_in_progress == false
      and (.outputs | length) == 4
      and (.outputs | index($a) != null)
      and (.outputs | index($b) != null)
      and (.outputs | index($c) != null)
      and (.outputs | index($d) != null)
    ' <<<"$lease_status" >/dev/null
  if [[ -n $label ]]; then
    print -r -- "$lease_status" > "${pod_output[a]}/evidence/runner-$label.json"
  fi
  [[ -f $state_root/owner && -f $state_root/run_id && -f $state_root/ready ]]
  [[ $(<$state_root/owner) == odin ]]
  [[ $(<$state_root/run_id) == $expected_run_id ]]
  for lane in a b c d; do
    [[ -f ${pod_output[$lane]}/.proxywar-runner-claim ]]
    grep -qx "lane=odin" "${pod_output[$lane]}/.proxywar-runner-claim"
    grep -qx "run_id=$expected_run_id" "${pod_output[$lane]}/.proxywar-runner-claim"
  done
}

for lane in a b c d; do
  output=${pod_output[$lane]}
  [[ -d $output && -f $output/.proxywar-runner-claim ]]
  mkdir -p "$output/specs" "$output/runs" "$output/evidence"

  info=$(runpodctl ssh info "${pod_id[$lane]}" -o json)
  pod_ip[$lane]=$(jq -er '.ip' <<<"$info")
  pod_port[$lane]=$(jq -er '.port' <<<"$info")
  pod_key[$lane]=$(jq -er '.ssh_key.path' <<<"$info")
  pod_remote[$lane]=root@${pod_ip[$lane]}
  pod_home[$lane]=/workspace/proxywar-pg2-matrix-$execution_id-$lane
  pod_bundle[$lane]=${pod_home[$lane]}/extracted/proxywar-runpod-bundle

  jq -n \
    --arg execution_id "$execution_id" \
    --arg matrix_commit "$matrix_commit" \
    --arg lane "$lane" \
    --arg id "${pod_id[$lane]}" \
    --arg ip "${pod_ip[$lane]}" \
    --argjson port "${pod_port[$lane]}" \
    --arg remote_home "${pod_home[$lane]}" \
    '{
      execution_id:$execution_id,
      matrix_commit:$matrix_commit,
      lane:$lane,
      pod_id:$id,
      ip:$ip,
      port:$port,
      remote_home:$remote_home
    }' > "$output/pod.json"
done

while IFS= read -r assignment; do
  lane=$(jq -r .lane <<<"$assignment")
  map=$(jq -r .map <<<"$assignment")
  seed=$(jq -r .seed <<<"$assignment")
  pair=$(jq -r .pair <<<"$assignment")
  expected_candidate=$(jq -r .candidate_sha256 <<<"$assignment")
  expected_parent=$(jq -r .parent_sha256 <<<"$assignment")
  output=${pod_output[$lane]}
  jq --arg map "$map" --argjson seed "$seed" \
    '.game_config.map = $map | .game_config.seed = $seed' \
    "$candidate_spec" > "$output/specs/$pair-a.json"
  jq --arg map "$map" --argjson seed "$seed" \
    '.game_config.map = $map | .game_config.seed = $seed' \
    "$parent_spec" > "$output/specs/$pair-b.json"
  [[ $(shasum -a 256 "$output/specs/$pair-a.json" | awk '{print $1}') == $expected_candidate ]]
  [[ $(shasum -a 256 "$output/specs/$pair-b.json" | awk '{print $1}') == $expected_parent ]]
done < <(jq -c '.assignments[]' "$matrix_manifest")

for lane in a b c d; do
  (
    cd "${pod_output[$lane]}/specs"
    shasum -a 256 ./*.json | sort > specs.sha256
  )
done

prepare_pod() {
  local lane=$1
  local output=${pod_output[$lane]}
  local remote=${pod_remote[$lane]}
  local home=${pod_home[$lane]}
  local bundle=${pod_bundle[$lane]}
  local ssh_options=(-i "${pod_key[$lane]}" -p "${pod_port[$lane]}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
  local scp_options=(-i "${pod_key[$lane]}" -P "${pod_port[$lane]}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

  arch=$(ssh "${ssh_options[@]}" "$remote" uname -m)
  [[ $arch == x86_64 || $arch == amd64 ]]
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; test ! -e '$home'; mkdir -p '$home/specs' '$home/runs' '$home/evidence'"

  ssh "${ssh_options[@]}" "$remote" "mkdir -p '$remote_stage'"
  if ! ssh "${ssh_options[@]}" "$remote" \
    "cd '$remote_stage' && test -f '${archive:t}' && printf '%s  %s\n' '$archive_sha' '${archive:t}' | sha256sum -c - >/dev/null"; then
    scp "${scp_options[@]}" "$archive" "$remote:$remote_stage/${archive:t}.part"
    ssh "${ssh_options[@]}" "$remote" \
      "cd '$remote_stage'; printf '%s  %s\n' '$archive_sha' '${archive:t}.part' | sha256sum -c -; mv '${archive:t}.part' '${archive:t}'"
  fi
  if ! ssh "${ssh_options[@]}" "$remote" \
    "cd '$remote_stage' && test -f '${extractor:t}' && printf '%s  %s\n' '$extractor_sha' '${extractor:t}' | sha256sum -c - >/dev/null"; then
    scp "${scp_options[@]}" "$extractor" "$remote:$remote_stage/${extractor:t}.part"
    ssh "${ssh_options[@]}" "$remote" \
      "cd '$remote_stage'; printf '%s  %s\n' '$extractor_sha' '${extractor:t}.part' | sha256sum -c -; mv '${extractor:t}.part' '${extractor:t}'"
  fi
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; cd '$remote_stage'; python3 '${extractor:t}' --archive '${archive:t}' --expected-sha256 '$archive_sha' --destination '$home/extracted'"

  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; test -x '$bundle/bin/runpod-proxywar-episode'; test -f '$bundle/manifest.json'; test -f '$bundle/files.sha256'"
  scp "${scp_options[@]}" -r "$output/specs/." "$remote:$home/specs/"
  scp "${scp_options[@]}" "$worker" "$matrix_manifest" "$remote:$home/"
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; chmod 0755 '$home/${worker:t}'; cd '$home/specs'; sha256sum -c specs.sha256; '$bundle/bin/runpod-proxywar-episode' --spec '$bundle/specs/canary-candidate-player-specs.json' --transport-canary --validate-only > '$home/transport-validation.txt'"
}

prepare_pids=()
for lane in a b c d; do
  prepare_pod "$lane" > "${pod_output[$lane]}/prepare.log" 2>&1 &
  prepare_pids+=($!)
done
prepare_failed=0
for pid in $prepare_pids; do
  if ! wait "$pid"; then
    prepare_failed=1
  fi
done
if (( prepare_failed != 0 )); then
  print -u2 "PG2_MATRIX_PREPARE_FAILED"
  exit 1
fi
runner_owned prepared

run_pair() {
  local lane=$1 wave=$2 pair=$3 map=$4 seed=$5
  local remote=${pod_remote[$lane]}
  local home=${pod_home[$lane]}
  local bundle=${pod_bundle[$lane]}
  local ssh_options=(-i "${pod_key[$lane]}" -p "${pod_port[$lane]}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=6)
  ssh "${ssh_options[@]}" "$remote" \
    "'$home/${worker:t}' '$bundle' '$home' '$matrix_commit' '$lane' '$wave' '$pair' '$map' '$seed'"
}

fetch_pair() {
  local lane=$1 pair=$2
  local output=${pod_output[$lane]}
  local remote=${pod_remote[$lane]}
  local home=${pod_home[$lane]}
  local scp_options=(-i "${pod_key[$lane]}" -P "${pod_port[$lane]}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
  scp "${scp_options[@]}" -r "$remote:$home/runs/$pair-a" "$output/runs/"
  scp "${scp_options[@]}" -r "$remote:$home/runs/$pair-b" "$output/runs/"
  scp "${scp_options[@]}" -r "$remote:$home/evidence/$pair" "$output/evidence/"
  scp "${scp_options[@]}" \
    "$remote:$home/runs/$pair-a.stdout.log" \
    "$remote:$home/runs/$pair-b.stdout.log" \
    "$output/runs/"
}

map_gate() {
  local map=$1 final=$2 output=${pod_output[a]}/evidence
  python3 - "$map" "$final" "$output" "${pod_output[@]}" <<'PY'
import json
import statistics
import sys
from pathlib import Path

map_name, final_text, report_root, *roots = sys.argv[1:]
runs = []
for root in roots:
    for path in Path(root, "evidence").glob("*/audit.json"):
        report = json.loads(path.read_text())
        if report.get("map") == map_name and report.get("verdict") == "CONTINUE":
            runs.append(report)

violations = []
if len(runs) != 8:
    violations.append(f"expected 8 {map_name} pairs, found {len(runs)}")

def delta(field):
    return [
        item["candidate"][field] - item["parent"][field]
        for item in runs
        if item["candidate"].get(field) is not None
        and item["parent"].get(field) is not None
    ]

marker_reach = sum(item["candidate"]["marker_count"] > 0 for item in runs)
tile20 = delta("tile_at_decision_20")
tile50 = delta("tile_at_decision_50")
score = delta("final_score")
candidate_wins = sum(item["candidate"]["declared_win"] for item in runs)
parent_wins = sum(item["parent"]["declared_win"] for item in runs)
if len(runs) == 8:
    if marker_reach < 6:
        violations.append(f"marker reach {marker_reach}/8 is below 6/8")
    for label, values in (("decision20", tile20), ("decision50", tile50), ("score", score)):
        if len(values) != 8 or statistics.median(values) <= 0:
            violations.append(f"{label} paired median is not positive")
    if candidate_wins < parent_wins:
        violations.append("candidate declared-win count is below parent")

overall = []
if final_text == "true":
    for root in roots:
        for path in Path(root, "evidence").glob("*/audit.json"):
            report = json.loads(path.read_text())
            if report.get("verdict") == "CONTINUE":
                overall.append(report)
    if len(overall) != 24:
        violations.append(f"expected 24 total pairs, found {len(overall)}")
    else:
        positive = sum(
            item["candidate"]["final_score"] > item["parent"]["final_score"]
            for item in overall
        )
        if positive < 15:
            violations.append(f"positive final-score pairs {positive}/24 is below 15/24")
        if sum(x["candidate"]["declared_win"] for x in overall) < sum(
            x["parent"]["declared_win"] for x in overall
        ):
            violations.append("overall candidate declared-win count is below parent")

report = {
    "schema_version": 1,
    "arm": "pg2",
    "map": map_name,
    "pair_count": len(runs),
    "marker_reach": marker_reach,
    "median_tile_delta_decision_20": statistics.median(tile20) if tile20 else None,
    "median_tile_delta_decision_50": statistics.median(tile50) if tile50 else None,
    "median_final_score_delta": statistics.median(score) if score else None,
    "candidate_declared_wins": candidate_wins,
    "parent_declared_wins": parent_wins,
    "final_matrix_check": final_text == "true",
    "verdict": "CONTINUE" if not violations else "STOP",
    "violations": violations,
}
target = Path(report_root, f"map-{map_name.lower()}-gate.json")
target.write_text(json.dumps(report, indent=2) + "\n")
print(f"PG2_MAP_GATE={report['verdict']} map={map_name} violations={len(violations)}")
raise SystemExit(0 if not violations else 1)
PY
}

for wave in {1..6}; do
  runner_owned "wave-$wave-before"
  typeset -A wave_pair wave_map wave_seed
  pair_pids=()
  for lane in a b c d; do
    assignment=$(jq -ec \
      --arg lane "$lane" --argjson wave "$wave" \
      '.assignments[] | select(.lane == $lane and .wave == $wave)' \
      "$matrix_manifest")
    wave_pair[$lane]=$(jq -r .pair <<<"$assignment")
    wave_map[$lane]=$(jq -r .map <<<"$assignment")
    wave_seed[$lane]=$(jq -r .seed <<<"$assignment")
    run_pair "$lane" "$wave" "${wave_pair[$lane]}" "${wave_map[$lane]}" "${wave_seed[$lane]}" \
      > "${pod_output[$lane]}/wave-$wave-${wave_pair[$lane]}.runner.log" 2>&1 &
    pair_pids+=($!)
  done

  wave_failed=0
  for pid in $pair_pids; do
    if ! wait "$pid"; then
      wave_failed=1
    fi
  done

  fetch_failed=0
  for lane in a b c d; do
    if ! fetch_pair "$lane" "${wave_pair[$lane]}" \
      > "${pod_output[$lane]}/wave-$wave-${wave_pair[$lane]}.fetch.log" 2>&1; then
      fetch_failed=1
    fi
  done
  if (( wave_failed != 0 || fetch_failed != 0 )); then
    print -u2 "PG2_MATRIX_WAVE_INCOMPLETE wave=$wave run_failed=$wave_failed fetch_failed=$fetch_failed"
    exit 1
  fi

  audit_failed=0
  for lane in a b c d; do
    pair=${wave_pair[$lane]}
    if ! "$auditor" \
      --candidate "${pod_output[$lane]}/runs/$pair-a" \
      --parent "${pod_output[$lane]}/runs/$pair-b" \
      --candidate-spec "${pod_output[$lane]}/specs/$pair-a.json" \
      --parent-spec "${pod_output[$lane]}/specs/$pair-b.json" \
      --matrix-manifest "$matrix_manifest" \
      --matrix-commit "$matrix_commit" \
      --lane "$lane" \
      --wave "$wave" \
      --output "${pod_output[$lane]}/evidence/$pair/audit.json"; then
      audit_failed=1
    fi
  done
  if (( audit_failed != 0 )); then
    print -u2 "PG2_MATRIX_SEMANTIC_STOP wave=$wave"
    exit 1
  fi
  runner_owned "wave-$wave-after"

  if (( wave % 2 == 0 )); then
    map=${wave_map[a]}
    final=false
    (( wave == 6 )) && final=true
    map_gate "$map" "$final"
  fi
  print "PG2_MATRIX_WAVE_CONTINUE wave=$wave"
done

print "PG2_MATRIX_COMPLETE execution_id=$execution_id commit=$matrix_commit"
