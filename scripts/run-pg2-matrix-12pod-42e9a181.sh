#!/bin/zsh

set -euo pipefail

if (( $# != 12 )); then
  print -u2 "usage: $0 OUTPUT_A ... OUTPUT_L"
  exit 64
fi

repo=/Users/olifreuler/proxywar-coworld-starter
matrix=$repo/experiments/pg2-matrix-42e9a181.json
pair_runner=$repo/scripts/run-pg2-parent-control-replay-42e9a181.sh
auditor=$repo/scripts/audit-pg2-matrix.mjs
pod_ids=(
  lb4zz7jzgq9tr2
  2g5whxhph9bwbz
  877itccar33zdp
  76stn0v7q81d47
  ne262xferohtdi
  ctnggpz7t6nj6c
  rkm013fsjsf87c
  0l7p9ke95cu6ms
  vbo7a33nlvsrtf
  l1evg0fagjmbgn
  a7dmwmcmh45a4b
  zadju8y8p6d5r9
)
outputs=("$@")

[[ -f $matrix && -x $pair_runner && -f $auditor ]]
for output in $outputs; do
  [[ -d $output && -f $output/.proxywar-runner-claim ]]
done

jobs=()
for wave in 1 2 3 4 5 6; do
  while IFS= read -r assignment; do
    jobs+=("$assignment")
  done < <(jq -c --argjson wave "$wave" '.assignments[] | select(.wave == $wave)' "$matrix")
done
(( ${#jobs[@]} == 24 ))

for phase in 1 2; do
  start=$(( (phase - 1) * 12 + 1 ))
  pids=()
  for index in {1..12}; do
    job_index=$(( start + index - 1 ))
    assignment=${jobs[$job_index]}
    pair=$(jq -r .pair <<<"$assignment")
    lane=$(jq -r .lane <<<"$assignment")
    wave=$(jq -r .wave <<<"$assignment")
    map=$(jq -r .map <<<"$assignment")
    seed=$(jq -r .seed <<<"$assignment")
    "$pair_runner" "${pod_ids[$index]}" "${outputs[$index]}" "$pair" "$lane" "$wave" "$map" "$seed" > "${outputs[$index]}/phase-$phase-$pair.log" 2>&1 &
    pids+=($!)
  done
  failed=0
  for pid in $pids; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  if (( failed != 0 )); then
    print -u2 "PG2_MATRIX12_PAIR_FAILURE phase=$phase"
    exit 1
  fi
  print "PG2_MATRIX12_PHASE_COMPLETE phase=$phase"
done

roots=()
for output in $outputs; do
  roots+=(--root "$output")
done
node "$auditor" --matrix "$matrix" "${roots[@]}" --output "${outputs[1]}/evidence/matrix-audit.json"
print "PG2_MATRIX12_COMPLETE"

