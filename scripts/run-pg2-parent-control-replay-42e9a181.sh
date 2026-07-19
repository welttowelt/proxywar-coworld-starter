#!/bin/zsh

set -euo pipefail

if (( $# != 2 && $# != 7 )); then
  print -u2 "usage: $0 POD_ID OUTPUT_ROOT [PAIR LANE WAVE MAP SEED]"
  exit 64
fi

pod_id=$1
output_root=$2
repo=/Users/olifreuler/proxywar-coworld-starter
pair=${3:-asia-20260721}
lane=${4:-a}
wave=${5:-3}
map=${6:-Asia}
seed=${7:-20260721}
archive=/private/tmp/proxywar-pg2-reach-bundle-42e9a181.tar.gz
extractor=/private/tmp/proxywar-pg2-reach-bundle-42e9a181.tar.gz.extract.py
archive_sha=d2f2f154a67f43008a9b8f7cc0e2c66d44d825e088434cf165fe3b751240b9cd
source_root=$(ls -d /private/tmp/proxywar-pg2-matrix-42e9a181-a-20260719-r7.aborted-* | tail -1)
matrix=$repo/experiments/pg2-matrix-42e9a181.json
worker=$repo/scripts/run-pg2-matrix-worker-42e9a181.sh
auditor=$repo/scripts/audit-pg2-matrix-pair.py
baseline_registry=$repo/experiments/pg2-parent-control-baselines-42e9a181.json
matrix_commit=$(git -C "$repo" rev-parse HEAD)
remote_stage=/workspace/pg2-repaired-42e9a181
remote_root=/workspace/pg2-parent-control-replay-${matrix_commit[1,12]}-$(date -u +%Y%m%dT%H%M%SZ)-$$

[[ -d $output_root && -f $output_root/.proxywar-runner-claim ]]
[[ -d $source_root/specs && -f $archive && -f $extractor && -f $matrix && -f $baseline_registry && -x $worker && -x $auditor ]]
[[ $(shasum -a 256 "$archive" | awk '{print $1}') == $archive_sha ]]
[[ $matrix_commit =~ ^[a-f0-9]{40}$ ]]
mkdir -p "$output_root/specs" "$output_root/runs" "$output_root/evidence"
cp "$source_root/specs/$pair-a.json" "$source_root/specs/$pair-b.json" "$output_root/specs/"

info=$(runpodctl ssh info "$pod_id" -o json)
remote=root@$(jq -er '.ip' <<<"$info")
port=$(jq -er '.port' <<<"$info")
key=$(jq -er '.ssh_key.path' <<<"$info")
ssh_options=(-i "$key" -p "$port" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=6)
scp_options=(-i "$key" -P "$port" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=9)

[[ $(ssh "${ssh_options[@]}" "$remote" uname -m) =~ ^(x86_64|amd64)$ ]]
ssh "${ssh_options[@]}" "$remote" "set -euo pipefail; test ! -e '$remote_root'; mkdir -p '$remote_root/specs' '$remote_stage'; cd '$remote_stage'; printf '%s  %s\n' '$archive_sha' '${archive:t}' | sha256sum -c - >/dev/null; python3 '${extractor:t}' --archive '${archive:t}' --expected-sha256 '$archive_sha' --destination '$remote_root/extracted'"
scp "${scp_options[@]}" "$worker" "$matrix" "$output_root/specs/$pair-a.json" "$output_root/specs/$pair-b.json" "$remote:$remote_root/"
ssh "${ssh_options[@]}" "$remote" "set -euo pipefail; chmod 0755 '$remote_root/${worker:t}'; mv '$remote_root/$pair-a.json' '$remote_root/specs/$pair-a.json'; mv '$remote_root/$pair-b.json' '$remote_root/specs/$pair-b.json'; '$remote_root/${worker:t}' '$remote_root/extracted/proxywar-runpod-bundle' '$remote_root' '$matrix_commit' '$lane' '$wave' '$pair' '$map' '$seed'"

staging="$output_root/fetch"
mkdir -p "$staging/runs" "$staging/evidence"
scp "${scp_options[@]}" -r "$remote:$remote_root/runs/$pair-a" "$remote:$remote_root/runs/$pair-b" "$staging/runs/"
scp "${scp_options[@]}" -r "$remote:$remote_root/evidence/$pair" "$staging/evidence/"
scp "${scp_options[@]}" "$remote:$remote_root/runs/$pair-a.stdout.log" "$remote:$remote_root/runs/$pair-b.stdout.log" "$staging/runs/"
(
  cd "$staging"
  sha256sum -c "evidence/$pair/run-artifacts.sha256"
)
mv "$staging/runs/$pair-a" "$staging/runs/$pair-b" "$staging/runs/$pair-a.stdout.log" "$staging/runs/$pair-b.stdout.log" "$output_root/runs/"
mv "$staging/evidence/$pair" "$output_root/evidence/"
rmdir "$staging/runs" "$staging/evidence" "$staging"

"$auditor" --candidate "$output_root/runs/$pair-a" --parent "$output_root/runs/$pair-b" --candidate-spec "$output_root/specs/$pair-a.json" --parent-spec "$output_root/specs/$pair-b.json" --matrix-manifest "$matrix" --baseline-registry "$baseline_registry" --matrix-commit "$matrix_commit" --lane "$lane" --wave "$wave" --output "$output_root/evidence/$pair/audit.json"
verdict=$(jq -r .verdict "$output_root/evidence/$pair/audit.json")
[[ $verdict == CONTINUE || $verdict == REPLAY_REQUIRED ]]
print "PG2_PARENT_CONTROL_REPLAY_COMPLETE pair=$pair verdict=$verdict output=$output_root"
