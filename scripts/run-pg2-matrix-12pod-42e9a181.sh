#!/bin/zsh

set -euo pipefail

if (( $# < 4 || $# > 12 )); then
  print -u2 "usage: $0 OUTPUT_A ... OUTPUT_N (4 to 12 outputs)"
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
  825a2frvggm1k4
  lshjhv5avqjsaj
  szlrnk3ucex44f
  sxrtmdyd62n3ia
  67yzvbbp54aizm
  rwvsgeancauyug
)
outputs=("$@")

[[ -f $matrix && -x $pair_runner && -f $auditor ]]
(( ${#outputs[@]} <= ${#pod_ids[@]} ))
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

phase=1
start=1
while (( start <= ${#jobs[@]} )); do
  pids=()
  for (( index = 1; index <= ${#outputs[@]}; index++ )); do
    job_index=$(( start + index - 1 ))
    (( job_index > ${#jobs[@]} )) && break
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
  start=$(( start + ${#outputs[@]} ))
  phase=$(( phase + 1 ))
done

roots=()
for output in $outputs; do
  roots+=(--root "$output")
done
node "$auditor" --matrix "$matrix" "${roots[@]}" --output "${outputs[1]}/evidence/matrix-audit.json"
print "PG2_MATRIX12_COMPLETE"
