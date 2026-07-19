#!/bin/bash

set -euo pipefail

if [[ $# -ne 8 ]]; then
  echo "usage: $0 BASE_BUNDLE MATRIX_HOME MATRIX_COMMIT LANE WAVE PAIR MAP SEED" >&2
  exit 64
fi

base_bundle=$1
matrix_home=$2
matrix_commit=$3
lane=$4
wave=$5
pair=$6
map=$7
seed=$8
working_bundle=$matrix_home/working-bundles/$pair
spec_root=$matrix_home/specs
run_root=$matrix_home/runs
evidence_root=$matrix_home/evidence
matrix_manifest=$matrix_home/pg2-matrix-42e9a181.json

[[ -x $base_bundle/bin/runpod-proxywar-episode ]]
[[ -f $base_bundle/manifest.json && -f $base_bundle/files.sha256 ]]
[[ $matrix_commit =~ ^[a-f0-9]{40}$ ]]
[[ $lane =~ ^[a-d]$ ]]
[[ $wave =~ ^[1-6]$ ]]
[[ $map == World || $map == Asia || $map == Pangaea ]]
[[ $seed =~ ^[0-9]+$ ]]
[[ $pair =~ ^[a-z]+-[0-9]+$ ]]
[[ -f $matrix_manifest ]]
[[ -f $spec_root/$pair-a.json && -f $spec_root/$pair-b.json ]]
[[ ! -e $working_bundle ]]
[[ ! -e $run_root/$pair-a && ! -e $run_root/$pair-b ]]

manifest_entry=$(jq -ec \
  --arg lane "$lane" \
  --argjson wave "$wave" \
  --arg pair "$pair" \
  --arg map "$map" \
  --argjson seed "$seed" \
  '
    .assignments[]
    | select(
        .lane == $lane
        and .wave == $wave
        and .pair == $pair
        and .map == $map
        and .seed == $seed
      )
  ' "$matrix_manifest")
[[ -n $manifest_entry ]]

mkdir -p "$run_root" "$evidence_root" "${working_bundle%/*}"
cp -al "$base_bundle" "$working_bundle"
rm \
  "$working_bundle/specs/formal-matched-a.json" \
  "$working_bundle/specs/formal-matched-b.json" \
  "$working_bundle/files.sha256" \
  "$working_bundle/manifest.json" \
  "$working_bundle/manifest.sha256"

cp "$spec_root/$pair-a.json" "$working_bundle/specs/formal-matched-a.json"
cp "$spec_root/$pair-b.json" "$working_bundle/specs/formal-matched-b.json"
candidate_sha=$(sha256sum "$working_bundle/specs/formal-matched-a.json" | awk '{print $1}')
parent_sha=$(sha256sum "$working_bundle/specs/formal-matched-b.json" | awk '{print $1}')
[[ $candidate_sha == $(jq -r .candidate_sha256 <<<"$manifest_entry") ]]
[[ $parent_sha == $(jq -r .parent_sha256 <<<"$manifest_entry") ]]

awk \
  '$2 != "specs/formal-matched-a.json" && $2 != "specs/formal-matched-b.json"' \
  "$base_bundle/files.sha256" > "$working_bundle/files.sha256.unsorted"
printf '%s  specs/formal-matched-a.json\n' "$candidate_sha" \
  >> "$working_bundle/files.sha256.unsorted"
printf '%s  specs/formal-matched-b.json\n' "$parent_sha" \
  >> "$working_bundle/files.sha256.unsorted"
LC_ALL=C sort -k2,2 "$working_bundle/files.sha256.unsorted" \
  > "$working_bundle/files.sha256"
rm "$working_bundle/files.sha256.unsorted"
files_sha=$(sha256sum "$working_bundle/files.sha256" | awk '{print $1}')
matrix_manifest_sha=$(sha256sum "$matrix_manifest" | awk '{print $1}')

jq \
  --arg commit "$matrix_commit" \
  --arg manifest_sha "$matrix_manifest_sha" \
  --arg pair "$pair" \
  --arg lane "$lane" \
  --argjson wave "$wave" \
  --arg map "$map" \
  --argjson seed "$seed" \
  --arg candidate_sha "$candidate_sha" \
  --arg parent_sha "$parent_sha" \
  --arg files_sha "$files_sha" \
  '
    .experiment_specs[0].sha256 = $candidate_sha
    | .experiment_specs[1].sha256 = $parent_sha
    | .file_manifest.sha256 = $files_sha
    | .matrix_derivation = {
        schema_version: 1,
        generator_commit: $commit,
        matrix_manifest_path: "experiments/pg2-matrix-42e9a181.json",
        matrix_manifest_sha256: $manifest_sha,
        lane: $lane,
        wave: $wave,
        pair: $pair,
        map: $map,
        seed: $seed,
        candidate_spec_sha256: $candidate_sha,
        parent_spec_sha256: $parent_sha
      }
  ' "$base_bundle/manifest.json" > "$working_bundle/manifest.json"
manifest_sha=$(sha256sum "$working_bundle/manifest.json" | awk '{print $1}')
printf '%s  manifest.json\n' "$manifest_sha" > "$working_bundle/manifest.sha256"

pair_evidence=$evidence_root/$pair
mkdir "$pair_evidence"
cp \
  "$working_bundle/specs/formal-matched-a.json" \
  "$working_bundle/specs/formal-matched-b.json" \
  "$working_bundle/files.sha256" \
  "$working_bundle/manifest.json" \
  "$working_bundle/manifest.sha256" \
  "$matrix_manifest" \
  "$pair_evidence/"
(
  cd "$pair_evidence"
  sha256sum ./* | LC_ALL=C sort -k2,2 > evidence.sha256
)

runner=$working_bundle/bin/runpod-proxywar-episode
"$runner" \
  --spec "$working_bundle/specs/formal-matched-a.json" \
  --validate-only > "$pair_evidence/candidate-validation.txt"
"$runner" \
  --spec "$working_bundle/specs/formal-matched-b.json" \
  --validate-only > "$pair_evidence/parent-validation.txt"

run_candidate() {
  "$runner" \
    --spec "$working_bundle/specs/formal-matched-a.json" \
    --output-dir "$run_root/$pair-a" \
    --run-id "pg2-matrix-$pair-a" \
    | tee "$run_root/$pair-a.stdout.log"
}

run_parent() {
  "$runner" \
    --spec "$working_bundle/specs/formal-matched-b.json" \
    --output-dir "$run_root/$pair-b" \
    --run-id "pg2-matrix-$pair-b" \
    | tee "$run_root/$pair-b.stdout.log"
}

if (( seed % 2 == 1 )); then
  run_candidate
  run_parent
else
  run_parent
  run_candidate
fi

(
  cd "$matrix_home"
  candidate_decisions=$(find "runs/$pair-a/proxywar-runs" -type f -name decisions.jsonl)
  parent_decisions=$(find "runs/$pair-b/proxywar-runs" -type f -name decisions.jsonl)
  [[ $(printf '%s\n' "$candidate_decisions" | wc -l) -eq 1 ]]
  [[ $(printf '%s\n' "$parent_decisions" | wc -l) -eq 1 ]]
  sha256sum \
    "runs/$pair-a/config.json" \
    "runs/$pair-a/receipt.json" \
    "runs/$pair-a/results.json" \
    "runs/$pair-a/replay" \
    "$candidate_decisions" \
    "runs/$pair-b/config.json" \
    "runs/$pair-b/receipt.json" \
    "runs/$pair-b/results.json" \
    "runs/$pair-b/replay" \
    "$parent_decisions" \
    > "evidence/$pair/run-artifacts.sha256"
)

echo "PG2_MATRIX_PAIR_COMPLETE lane=$lane wave=$wave pair=$pair"
