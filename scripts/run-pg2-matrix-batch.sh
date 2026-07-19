#!/bin/zsh

set -euo pipefail

if (( $# != 3 )); then
  print -u2 "usage: $0 MATRIX_ARCHIVE BUILD_RECEIPT OUTPUT_ROOT"
  exit 64
fi

ROOT="${0:A:h:h}"
MATRIX_ARCHIVE="${1:A}"
BUILD_RECEIPT="${2:A}"
OUTPUT_ROOT="${3:A}"
RUNNER="$ROOT/scripts/proxywar-runner-lease.sh"
AUDITOR="$ROOT/scripts/audit-pg2-matrix.mjs"
EXTRACTOR="$ROOT/scripts/extract_runpod_proxywar_bundle.py"
RUN_ID="$(jq -er '.run_id' "$BUILD_RECEIPT")"
ARCHIVE_SHA="$(jq -er '.archive_sha256' "$BUILD_RECEIPT")"
MANIFEST_SHA="$(jq -er '.manifest_sha256' "$BUILD_RECEIPT")"
PLAN="$OUTPUT_ROOT/matrix-plan.json"
WORKERS_ROOT="$OUTPUT_ROOT/workers"

[[ -f "$MATRIX_ARCHIVE" && -f "$BUILD_RECEIPT" && -d "$OUTPUT_ROOT" ]]
[[ "$(shasum -a 256 "$MATRIX_ARCHIVE" | awk '{print $1}')" == "$ARCHIVE_SHA" ]]
[[ "$(jq -er '.pair_count' "$BUILD_RECEIPT")" == "24" ]]
[[ "$(jq -er '.formal_spec_count' "$BUILD_RECEIPT")" == "48" ]]

cp "$BUILD_RECEIPT" "$OUTPUT_ROOT/bundle-build-receipt.json"
tar -xOf "$MATRIX_ARCHIVE" \
  proxywar-runpod-bundle/specs/pg2-matrix-plan.json |
  jq --arg manifest "$MANIFEST_SHA" \
    '. + {bundle_manifest_sha256: $manifest}' > "$PLAN"
[[ "$(jq -er '.pairs | length' "$PLAN")" == "24" ]]
mkdir -p "$WORKERS_ROOT"

worker_rows=(
  "storm-lazy-a|lb4zz7jzgq9tr2"
  "storm-lazy-b|2g5whxhph9bwbz"
  "storm-lazy-c|877itccar33zdp"
  "storm-lazy-d|76stn0v7q81d47"
)
typeset -a worker_pids
typeset -a worker_labels
typeset -a worker_pods
CLEANUP_ARMED=0

ssh_fields() {
  local pod_id="$1"
  local info
  info="$(runpodctl ssh info "$pod_id" -o json)"
  jq -er '[.ip, (.port | tostring), .ssh_key.path] | @tsv' <<<"$info"
}

assert_runner_owned() {
  local state
  state="$("$RUNNER" status --json)"
  [[ "$(jq -r '.state' <<<"$state")" == "active" ]]
  [[ "$(jq -r '.owner' <<<"$state")" == "odin" ]]
  [[ "$(jq -r '.run_id' <<<"$state")" == "$RUN_ID" ]]
}

remote_stop() {
  local label="$1"
  local pod_id="$2"
  local fields ip port key remote remote_root
  fields="$(ssh_fields "$pod_id" 2>/dev/null)" || return 0
  IFS=$'\t' read -r ip port key <<<"$fields"
  remote="root@$ip"
  remote_root="/workspace/$RUN_ID-$label"
  ssh -i "$key" -p "$port" -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 "$remote" \
    "pkill -TERM -f '$remote_root/.*/bi[n]/runpod-proxywar-episode' 2>/dev/null || true; sleep 8; pkill -KILL -f '$remote_root/.*/bi[n]/runpod-proxywar-episode' 2>/dev/null || true" \
    >/dev/null 2>&1 || true
}

stop_all_workers() {
  local index attempt alive pid
  local -a remote_stop_pids
  for (( index = 1; index <= ${#worker_pids}; index++ )); do
    kill -TERM "${worker_pids[$index]}" 2>/dev/null || true
  done
  for (( index = 1; index <= ${#worker_labels}; index++ )); do
    remote_stop "${worker_labels[$index]}" "${worker_pods[$index]}" &
    remote_stop_pids+=("$!")
  done
  for attempt in {1..20}; do
    alive=0
    for pid in "${worker_pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    if (( alive == 0 )); then
      break
    fi
    sleep 0.25
  done
  for pid in "${worker_pids[@]}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  for pid in "${remote_stop_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  for pid in "${worker_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT INT TERM HUP
  if (( CLEANUP_ARMED == 1 )); then
    stop_all_workers
  fi
  exit "$status"
}

trap cleanup_on_exit EXIT
trap 'exit 143' INT TERM HUP

run_worker() {
  local label="$1"
  local pod_id="$2"
  local local_root="$WORKERS_ROOT/$label"
  local fields ip port key remote remote_root bundle_root
  local pair_id candidate_spec parent_spec role spec remote_output local_output
  local episode_run_id

  mkdir -p "$local_root"
  fields="$(ssh_fields "$pod_id")"
  IFS=$'\t' read -r ip port key <<<"$fields"
  remote="root@$ip"
  remote_root="/workspace/$RUN_ID-$label"
  bundle_root="$remote_root/extracted/proxywar-runpod-bundle"
  local -a ssh_options=(
    -i "$key" -p "$port" -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20
  )
  local -a scp_options=(
    -i "$key" -P "$port" -o BatchMode=yes
    -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20
  )

  assert_runner_owned
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; test ! -e '$remote_root'; mkdir -p '$remote_root/staging'"
  scp "${scp_options[@]}" "$MATRIX_ARCHIVE" \
    "$remote:$remote_root/staging/bundle.tar.gz"
  scp "${scp_options[@]}" "$EXTRACTOR" \
    "$remote:$remote_root/staging/extract.py"
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; cd '$remote_root/staging'; printf '%s  %s\n' '$ARCHIVE_SHA' bundle.tar.gz | sha256sum -c -; python3 extract.py --archive bundle.tar.gz --expected-sha256 '$ARCHIVE_SHA' --destination '$remote_root/extracted'"
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; printf 'arch=%s\n' \"\$(uname -m)\"; printf 'nproc=%s\n' \"\$(nproc)\"; sha256sum '$bundle_root/manifest.json' '$bundle_root/files.sha256' '$bundle_root/links.tsv'" \
    > "$local_root/runtime-fingerprint.txt"
  ssh "${ssh_options[@]}" "$remote" \
    "set -euo pipefail; '$bundle_root/bin/runpod-proxywar-episode' --spec '$bundle_root/specs/canary-candidate-player-specs.json' --transport-canary --validate-only" \
    > "$local_root/transport-validation.txt"

  while IFS=$'\t' read -r pair_id candidate_spec parent_spec; do
    [[ -n "$pair_id" ]]
    assert_runner_owned
    for role in candidate parent; do
      if [[ "$role" == "candidate" ]]; then
        spec="$candidate_spec"
        episode_run_id="pg2m-${pair_id}-a"
      else
        spec="$parent_spec"
        episode_run_id="pg2m-${pair_id}-b"
      fi
      remote_output="$remote_root/outputs/$pair_id/$role"
      local_output="$local_root/$pair_id/$role"
      mkdir -p "$local_output"
      ssh "${ssh_options[@]}" "$remote" \
        "set -euo pipefail; mkdir -p '${remote_output:h}'; '$bundle_root/bin/runpod-proxywar-episode' --spec '$bundle_root/$spec' --output-dir '$remote_output' --run-id '$episode_run_id' > '$remote_output.stdout.log' 2>&1"
      scp "${scp_options[@]}" -r "$remote:$remote_output/." "$local_output/"
      scp "${scp_options[@]}" "$remote:$remote_output.stdout.log" \
        "$local_output/episode.stdout.log"
      jq -e '.status == "passed" and .post_run_attestation.status == "stable"' \
        "$local_output/receipt.json" >/dev/null
    done
    node "$AUDITOR" --mode pair \
      --candidate "$local_root/$pair_id/candidate" \
      --parent "$local_root/$pair_id/parent" \
      --plan "$PLAN" \
      --pair-id "$pair_id" \
      --output "$local_root/$pair_id/pair-audit.json"
  done < <(
    jq -r --arg worker "$label" '
      .pairs[]
      | select(.worker == $worker)
      | [.pair_id, .specs.candidate.path, .specs["exact-parent"].path]
      | @tsv
    ' "$PLAN"
  )
  print "complete" > "$local_root/worker.complete"
}

CLEANUP_ARMED=1
for row in "${worker_rows[@]}"; do
  label="${row%%|*}"
  pod_id="${row##*|}"
  worker_labels+=("$label")
  worker_pods+=("$pod_id")
  status_file="$WORKERS_ROOT/$label.status"
  (
    set -e
    trap 'status=$?; print "$status" > "$status_file"' EXIT
    run_worker "$label" "$pod_id" > "$WORKERS_ROOT/$label.log" 2>&1
  ) &
  worker_pids+=("$!")
done

while true; do
  complete=0
  for label in "${worker_labels[@]}"; do
    status_file="$WORKERS_ROOT/$label.status"
    if [[ -f "$status_file" ]]; then
      status="$(<"$status_file")"
      if [[ "$status" != "0" ]]; then
        print -u2 "worker failed: $label status=$status"
        exit "$status"
      fi
      complete=$((complete + 1))
    fi
  done
  (( complete == ${#worker_labels} )) && break
  assert_runner_owned
  sleep 2
done

for pid in "${worker_pids[@]}"; do
  wait "$pid"
done
node "$AUDITOR" --mode matrix \
  --root "$OUTPUT_ROOT" \
  --plan "$PLAN" \
  --output "$OUTPUT_ROOT/matrix-audit.json"
jq -e '.pair_count == 24 and .hard_stop_pass == true' \
  "$OUTPUT_ROOT/matrix-audit.json" >/dev/null
print "complete" > "$OUTPUT_ROOT/matrix.complete"
CLEANUP_ARMED=0
print "PG2_MATRIX_COMPLETE run_id=$RUN_ID output=$OUTPUT_ROOT"
