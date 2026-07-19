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

manifest_hashes=$(python3 - \
  "$matrix_manifest" \
  "$lane" \
  "$wave" \
  "$pair" \
  "$map" \
  "$seed" <<'PY'
import json
import sys

manifest_path, lane, wave, pair, map_name, seed = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)

matches = [
    assignment
    for assignment in manifest["assignments"]
    if assignment.get("lane") == lane
    and assignment.get("wave") == int(wave)
    and assignment.get("pair") == pair
    and assignment.get("map") == map_name
    and assignment.get("seed") == int(seed)
]
if len(matches) != 1:
    raise SystemExit(
        f"expected one matrix assignment, found {len(matches)}"
    )

entry = matches[0]
print(entry["candidate_sha256"], entry["parent_sha256"], sep="\t")
PY
)
IFS=$'\t' read -r expected_candidate_sha expected_parent_sha \
  <<< "$manifest_hashes"
[[ $expected_candidate_sha =~ ^[a-f0-9]{64}$ ]]
[[ $expected_parent_sha =~ ^[a-f0-9]{64}$ ]]

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
[[ $candidate_sha == "$expected_candidate_sha" ]]
[[ $parent_sha == "$expected_parent_sha" ]]

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

python3 - \
  "$base_bundle/manifest.json" \
  "$working_bundle/manifest.json" \
  "$matrix_commit" \
  "$matrix_manifest_sha" \
  "$pair" \
  "$lane" \
  "$wave" \
  "$map" \
  "$seed" \
  "$candidate_sha" \
  "$parent_sha" \
  "$files_sha" <<'PY'
import json
import sys

(
    source_path,
    output_path,
    commit,
    manifest_sha,
    pair,
    lane,
    wave,
    map_name,
    seed,
    candidate_sha,
    parent_sha,
    files_sha,
) = sys.argv[1:]

with open(source_path, encoding="utf-8") as handle:
    manifest = json.load(handle)

manifest["experiment_specs"][0]["sha256"] = candidate_sha
manifest["experiment_specs"][1]["sha256"] = parent_sha
manifest["file_manifest"]["sha256"] = files_sha
manifest["matrix_derivation"] = {
    "schema_version": 1,
    "generator_commit": commit,
    "matrix_manifest_path": "experiments/pg2-matrix-42e9a181.json",
    "matrix_manifest_sha256": manifest_sha,
    "lane": lane,
    "wave": int(wave),
    "pair": pair,
    "map": map_name,
    "seed": int(seed),
    "candidate_spec_sha256": candidate_sha,
    "parent_spec_sha256": parent_sha,
}

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
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
