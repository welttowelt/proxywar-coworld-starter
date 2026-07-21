#!/bin/bash

set -Eeuo pipefail

if [[ $# -ne 6 ]]; then
  echo "usage: $0 PANGAEA_BUNDLE WORLD_BUNDLE PANGAEA_CANDIDATE_OUT PANGAEA_CONTROL_OUT WORLD_CANDIDATE_OUT WORLD_CONTROL_OUT" >&2
  exit 64
fi

repo=$(cd "$(dirname "$0")/.." && pwd -P)
lease_tool=$repo/scripts/proxywar-runner-lease.sh
runpodctl_bin=$(command -v runpodctl)
pangaea_archive=$1
world_archive=$2
outputs=("$3" "$4" "$5" "$6")
pod_ids=(lb4zz7jzgq9tr2 2g5whxhph9bwbz 877itccar33zdp 76stn0v7q81d47)
pod_names=(storm-lazy-a storm-lazy-b storm-lazy-c storm-lazy-d)
maps=(Pangaea Pangaea World World)
roles=(candidate control candidate control)
specs=(formal-matched-a formal-matched-b formal-matched-a formal-matched-b)
slugs=(pangaea-candidate pangaea-control world-candidate world-control)
archives=("$pangaea_archive" "$pangaea_archive" "$world_archive" "$world_archive")
extractors=("${pangaea_archive}.extract.py" "${pangaea_archive}.extract.py" "${world_archive}.extract.py" "${world_archive}.extract.py")
scratch=$(mktemp -d /private/tmp/proxywar-std1-four.XXXXXX)
stop_armed=0
pre_start_statuses=()
post_stop_statuses=()

pod_status() {
  local index=$1 document
  document=$($runpodctl_bin pod get "${pod_ids[$index]}" -o json)
  jq -er \
    --arg id "${pod_ids[$index]}" \
    --arg name "${pod_names[$index]}" '
      if .id != $id or .name != $name then
        error("pod identity mismatch")
      else
        ((.desiredStatus // .desired_status // .status //
          .runtimeStatus // .runtime_status // "") | tostring | ascii_upcase)
      end
    ' <<<"$document"
}

stop_exact_pods() {
  local index attempt=0 all_exited=0 status stop_failed=0
  local stop_pids=()
  for index in 0 1 2 3; do
    $runpodctl_bin pod stop "${pod_ids[$index]}" -o json >/dev/null 2>&1 &
    stop_pids[$index]=$!
  done
  for index in 0 1 2 3; do
    if ! wait "${stop_pids[$index]}"; then
      stop_failed=1
    fi
  done
  while (( attempt < 60 )); do
    all_exited=1
    for index in 0 1 2 3; do
      status=$(pod_status "$index" 2>/dev/null) || status=UNKNOWN
      post_stop_statuses[$index]=$status
      [[ $status == EXITED ]] || all_exited=0
    done
    (( all_exited == 1 )) && break
    attempt=$((attempt + 1))
    sleep 2
  done
  if (( all_exited != 1 )); then
    echo "STD1_RUNPOD_STOP_UNVERIFIED exact_ids=${pod_ids[*]}" >&2
    stop_failed=1
  fi
  (( stop_failed == 0 ))
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM HUP
  set +e
  local child_pids stop_failed=0
  child_pids=$(jobs -pr)
  [[ -z $child_pids ]] || kill $child_pids 2>/dev/null

  if (( stop_armed == 1 )); then
    stop_exact_pods || stop_failed=1
    if (( stop_failed != 0 && exit_code == 0 )); then
      exit_code=1
    fi
  fi

  rm -rf "$scratch"
  exit "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

marker_value() {
  local marker=$1 key=$2
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$marker"
}

for index in 0 1 2 3; do
  [[ ${outputs[$index]} == /* ]]
  [[ -d ${outputs[$index]} && ! -L ${outputs[$index]} ]]
  outputs[$index]=$(cd "${outputs[$index]}" && pwd -P)
  [[ ! -e ${outputs[$index]}/dispatcher-receipt.json ]]
done
[[ ${outputs[0]} != "${outputs[1]}" && ${outputs[0]} != "${outputs[2]}" && ${outputs[0]} != "${outputs[3]}" ]]
[[ ${outputs[1]} != "${outputs[2]}" && ${outputs[1]} != "${outputs[3]}" ]]
[[ ${outputs[2]} != "${outputs[3]}" ]]

first_claim=${outputs[0]}/.proxywar-runner-claim
[[ -f $first_claim && ! -L $first_claim ]]
run_id=$(marker_value "$first_claim" run_id)
[[ $run_id =~ ^std1([._:-][A-Za-z0-9._:-]+)?$ ]]

verify_runner() {
  local status index marker
  status=$($lease_tool status --json)
  jq -e \
    --arg run_id "$run_id" \
    --arg a "${outputs[0]}" \
    --arg b "${outputs[1]}" \
    --arg c "${outputs[2]}" \
    --arg d "${outputs[3]}" '
      .state == "active"
      and .owner == "odin"
      and .run_id == $run_id
      and .supervisor_alive == true
      and .child_alive == true
      and .reap_in_progress == false
      and (.outputs | length) == 4
      and ((.outputs | sort) == ([$a, $b, $c, $d] | sort))
    ' <<<"$status" >/dev/null
  printf '%s\n' "$status" > "$scratch/runner-status-latest.json"
  for index in 0 1 2 3; do
    marker=${outputs[$index]}/.proxywar-runner-claim
    [[ -f $marker && ! -L $marker ]]
    [[ $(marker_value "$marker" schema_version) == 1 ]]
    [[ $(marker_value "$marker" lane) == odin ]]
    [[ $(marker_value "$marker" run_id) == "$run_id" ]]
    [[ $(marker_value "$marker" path) == "${outputs[$index]}" ]]
  done
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

validate_bundle_archive() {
  local archive=$1 expected_map=$2 label=$3 manifest spec_file spec_name expected actual
  local extractor=${archive}.extract.py
  [[ -f $archive && ! -L $archive && -f $extractor && ! -L $extractor ]]
  [[ ${archive##*/} =~ ^[A-Za-z0-9._-]+$ ]]
  [[ ${extractor##*/} =~ ^[A-Za-z0-9._-]+$ ]]
  manifest=$scratch/$label-manifest.json
  tar -xOf "$archive" proxywar-runpod-bundle/manifest.json > "$manifest"
  jq -e '
    .schema_version == 1
    and .contains_credentials == false
    and .invokes_runpod_api == false
    and (.experiment_specs | length) == 2
    and any(.experiment_specs[];
      .label == "formal-matched-a" and .role == "candidate")
    and any(.experiment_specs[];
      .label == "formal-matched-b" and .role == "exact-parent")
  ' "$manifest" >/dev/null
  for spec_name in formal-matched-a formal-matched-b; do
    spec_file=$scratch/$label-$spec_name.json
    tar -xOf "$archive" "proxywar-runpod-bundle/specs/$spec_name.json" > "$spec_file"
    jq -e --arg map "$expected_map" '.game_config.map == $map' "$spec_file" >/dev/null
    expected=$(jq -er --arg label "$spec_name" \
      '.experiment_specs[] | select(.label == $label) | .sha256' "$manifest")
    actual=$(sha256_file "$spec_file")
    [[ $actual == "$expected" ]]
  done
}

verify_runner
validate_bundle_archive "$pangaea_archive" Pangaea pangaea
validate_bundle_archive "$world_archive" World world

pangaea_sha=$(sha256_file "$pangaea_archive")
world_sha=$(sha256_file "$world_archive")
pangaea_extractor_sha=$(sha256_file "${pangaea_archive}.extract.py")
world_extractor_sha=$(sha256_file "${world_archive}.extract.py")
archive_shas=("$pangaea_sha" "$pangaea_sha" "$world_sha" "$world_sha")
extractor_shas=("$pangaea_extractor_sha" "$pangaea_extractor_sha" "$world_extractor_sha" "$world_extractor_sha")

for index in 0 1 2 3; do
  status=$(pod_status "$index")
  [[ $status == EXITED ]]
  pre_start_statuses[$index]=$status
done

# Arm cleanup before any start request. Every exit stops these four exact IDs.
stop_armed=1
start_pids=()
for index in 0 1 2 3; do
  $runpodctl_bin pod start "${pod_ids[$index]}" -o json >/dev/null &
  start_pids[$index]=$!
done
start_failed=0
for index in 0 1 2 3; do
  wait "${start_pids[$index]}" || start_failed=1
done
(( start_failed == 0 )) || {
  echo "STD1_RUNPOD_START_FAILED" >&2
  exit 1
}

wait_ready() {
  local index=$1 attempt=0 status info ip port key remote arch
  while (( attempt < 90 )); do
    status=$(pod_status "$index" 2>/dev/null) || status=UNKNOWN
    if [[ $status == RUNNING ]] && info=$($runpodctl_bin ssh info "${pod_ids[$index]}" -o json 2>/dev/null); then
      ip=$(jq -er '.ip' <<<"$info" 2>/dev/null) || ip=
      port=$(jq -er '.port' <<<"$info" 2>/dev/null) || port=
      key=$(jq -er '.ssh_key.path' <<<"$info" 2>/dev/null) || key=
      if [[ $ip =~ ^[A-Za-z0-9][A-Za-z0-9.:_-]*$ && $port =~ ^[0-9]+$ ]] &&
        (( port > 0 && port < 65536 )) && [[ $key == /* && -f $key ]]; then
        remote=root@$ip
        arch=$(ssh -i "$key" -p "$port" \
          -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
          -o "UserKnownHostsFile=$scratch/known-$index" -o ConnectTimeout=15 \
          "$remote" uname -m 2>/dev/null) || arch=
        if [[ $arch == x86_64 || $arch == amd64 ]]; then
          printf '%s\t%s\t%s\n' "$ip" "$port" "$key"
          return 0
        fi
      fi
    fi
    attempt=$((attempt + 1))
    sleep 4
  done
  return 1
}

ready_pids=()
for index in 0 1 2 3; do
  wait_ready "$index" > "$scratch/ssh-$index.tsv" &
  ready_pids[$index]=$!
done
ready_failed=0
for index in 0 1 2 3; do
  wait "${ready_pids[$index]}" || ready_failed=1
done
(( ready_failed == 0 )) || {
  echo "STD1_RUNPOD_SSH_NOT_READY" >&2
  exit 1
}

pod_ip=()
pod_port=()
pod_key=()
pod_home=()
execution_id="${run_id}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
for index in 0 1 2 3; do
  IFS=$'\t' read -r pod_ip[$index] pod_port[$index] pod_key[$index] < "$scratch/ssh-$index.tsv"
  [[ ${pod_ip[$index]} =~ ^[A-Za-z0-9][A-Za-z0-9.:_-]*$ ]]
  [[ ${pod_port[$index]} =~ ^[0-9]+$ && ${pod_key[$index]} == /* && -f ${pod_key[$index]} ]]
  pod_home[$index]=/workspace/$execution_id-${pod_names[$index]}
done
verify_runner

remote_options() {
  local index=$1
  printf '%s\n' \
    -i "${pod_key[$index]}" -p "${pod_port[$index]}" \
    -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -o "UserKnownHostsFile=$scratch/known-$index" \
    -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=12
}

transfer_verified() {
  local index=$1 local_file=$2 expected_sha=$3 remote=$4 stage=$5
  local base=${local_file##*/} attempt=0 key_q known_q rsync_shell
  local ssh_options=()
  while IFS= read -r option; do ssh_options+=("$option"); done < <(remote_options "$index")
  ssh "${ssh_options[@]}" "$remote" "mkdir -p '$stage'"
  if ssh "${ssh_options[@]}" "$remote" \
    "cd '$stage' && test -f '$base' && printf '%s  %s\n' '$expected_sha' '$base' | sha256sum -c - >/dev/null"; then
    return 0
  fi
  printf -v key_q '%q' "${pod_key[$index]}"
  printf -v known_q '%q' "$scratch/known-$index"
  rsync_shell="ssh -i $key_q -p ${pod_port[$index]} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$known_q -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=12"
  while (( attempt < 3 )); do
    attempt=$((attempt + 1))
    if rsync -a --partial -e "$rsync_shell" "$local_file" "$remote:$stage/$base.part" &&
      ssh "${ssh_options[@]}" "$remote" \
        "cd '$stage' && printf '%s  %s\n' '$expected_sha' '$base.part' | sha256sum -c - >/dev/null && mv '$base.part' '$base'"; then
      return 0
    fi
  done
  return 1
}

prepare_one() {
  local index=$1 archive=${archives[$index]} extractor=${extractors[$index]}
  local archive_sha=${archive_shas[$index]} extractor_sha=${extractor_shas[$index]}
  local remote=root@${pod_ip[$index]} home=${pod_home[$index]}
  local stage=/workspace/std1-bundle-$archive_sha bundle=$home/extracted/proxywar-runpod-bundle
  local spec=${specs[$index]} role=${roles[$index]} map=${maps[$index]} canary
  local ssh_options=()
  while IFS= read -r option; do ssh_options+=("$option"); done < <(remote_options "$index")
  canary=canary-candidate-player-specs
  [[ $role == candidate ]] || canary=canary-control-player-specs

  ssh "${ssh_options[@]}" "$remote" "set -euo pipefail; test ! -e '$home'; mkdir -p '$home'"
  transfer_verified "$index" "$archive" "$archive_sha" "$remote" "$stage"
  transfer_verified "$index" "$extractor" "$extractor_sha" "$remote" "$stage"
  ssh "${ssh_options[@]}" "$remote" "set -euo pipefail;
    cd '$stage';
    printf '%s  %s\n' '$archive_sha' '${archive##*/}' | sha256sum -c - >/dev/null;
    printf '%s  %s\n' '$extractor_sha' '${extractor##*/}' | sha256sum -c - >/dev/null;
    python3 '${extractor##*/}' --archive '${archive##*/}' --expected-sha256 '$archive_sha' --destination '$home/extracted';
    test -x '$bundle/bin/runpod-proxywar-episode';
    '$bundle/bin/runpod-proxywar-episode' --spec '$bundle/specs/$canary.json' --transport-canary --validate-only >/dev/null;
    '$bundle/bin/runpod-proxywar-episode' --spec '$bundle/specs/$spec.json' --validate-only >/dev/null;
    python3 - '$bundle/specs/$spec.json' '$map' <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as handle:
    document = json.load(handle)
if document.get('game_config', {}).get('map') != sys.argv[2]:
    raise SystemExit('formal spec map mismatch')
PY"
  if [[ $role == candidate ]]; then
    ssh "${ssh_options[@]}" "$remote" "set -euo pipefail;
      '$bundle/bin/runpod-proxywar-episode' \
        --spec '$bundle/specs/$canary.json' \
        --transport-canary \
        --output-dir '$home/qualifier' \
        --run-id '$run_id-${slugs[$index]}-qualifier'"
  fi
}

prepare_pids=()
for index in 0 1 2 3; do
  prepare_one "$index" > "$scratch/prepare-$index.log" 2>&1 &
  prepare_pids[$index]=$!
done
prepare_failed=0
for index in 0 1 2 3; do
  if ! wait "${prepare_pids[$index]}"; then
    tail -80 "$scratch/prepare-$index.log" >&2
    prepare_failed=1
  fi
done
(( prepare_failed == 0 )) || {
  echo "STD1_RUNPOD_PREPARE_FAILED" >&2
  exit 1
}
verify_runner

run_one() {
  local index=$1 remote=root@${pod_ip[$index]} home=${pod_home[$index]}
  local bundle=$home/extracted/proxywar-runpod-bundle spec=${specs[$index]}
  local ssh_options=()
  while IFS= read -r option; do ssh_options+=("$option"); done < <(remote_options "$index")
  ssh "${ssh_options[@]}" "$remote" "set -euo pipefail;
    '$bundle/bin/runpod-proxywar-episode' \
      --spec '$bundle/specs/$spec.json' \
      --output-dir '$home/output' \
      --run-id '$run_id-${slugs[$index]}'"
}

run_pids=()
for index in 0 1 2 3; do
  run_one "$index" > "$scratch/run-$index.log" 2>&1 &
  run_pids[$index]=$!
done
run_failed=0
for index in 0 1 2 3; do
  if ! wait "${run_pids[$index]}"; then
    tail -80 "$scratch/run-$index.log" >&2
    run_failed=1
  fi
done
verify_runner

fetch_one() {
  local index=$1 remote=root@${pod_ip[$index]} home=${pod_home[$index]}
  local output=${outputs[$index]} attempt=0 key_q known_q rsync_shell
  printf -v key_q '%q' "${pod_key[$index]}"
  printf -v known_q '%q' "$scratch/known-$index"
  rsync_shell="ssh -i $key_q -p ${pod_port[$index]} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$known_q -o ConnectTimeout=20 -o ServerAliveInterval=20 -o ServerAliveCountMax=12"
  if [[ ${roles[$index]} == candidate ]]; then
    mkdir -p "$output/qualifier"
  fi
  while (( attempt < 3 )); do
    attempt=$((attempt + 1))
    if rsync -a --partial -e "$rsync_shell" "$remote:$home/output/" "$output/"; then
      if [[ ${roles[$index]} != candidate ]] ||
        rsync -a --partial -e "$rsync_shell" \
          "$remote:$home/qualifier/" "$output/qualifier/"; then
        return 0
      fi
    fi
  done
  return 1
}

fetch_pids=()
for index in 0 1 2 3; do
  fetch_one "$index" > "$scratch/fetch-$index.log" 2>&1 &
  fetch_pids[$index]=$!
done
fetch_failed=0
for index in 0 1 2 3; do
  if ! wait "${fetch_pids[$index]}"; then
    tail -80 "$scratch/fetch-$index.log" >&2
    fetch_failed=1
  fi
done

verify_receipt() {
  local output=$1 expected_map=$2 expected_label=$3
  python3 - "$output" "$expected_map" "$expected_label" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
expected_map = sys.argv[2]
expected_label = sys.argv[3]
receipt_path = root / "receipt.json"
receipt = json.loads(receipt_path.read_text(encoding="utf-8"))

def require(condition, message):
    if not condition:
        raise SystemExit(message)

require(receipt.get("status") == "passed", "receipt status is not passed")
require(receipt.get("execution_class") == "formal_evaluation", "run is not formal evaluation")
require(receipt.get("runtime_fingerprint", {}).get("status") == "verified", "runtime is unverified")
require(receipt.get("bundle_verification", {}).get("status") == "verified", "bundle is unverified")
require(receipt.get("post_run_attestation", {}).get("status") == "stable", "post-run attestation is not stable")
require(receipt.get("run_spec", {}).get("manifest_label") == expected_label, "formal label mismatch")
require(receipt.get("plan", {}).get("game_config", {}).get("map") == expected_map, "map mismatch")

artifacts = receipt.get("artifacts")
require(isinstance(artifacts, list) and artifacts, "receipt has no artifact hashes")
by_path = {}
for entry in artifacts:
    relative = entry.get("path") if isinstance(entry, dict) else None
    require(isinstance(relative, str) and relative, "invalid artifact path")
    pure = pathlib.PurePosixPath(relative)
    require(not pure.is_absolute() and ".." not in pure.parts, "unsafe artifact path")
    target = root.joinpath(*pure.parts)
    require(target.is_file() and not target.is_symlink(), f"missing artifact: {relative}")
    body = target.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    require(digest == entry.get("sha256"), f"artifact hash mismatch: {relative}")
    require(len(body) == entry.get("bytes"), f"artifact size mismatch: {relative}")
    by_path[relative] = entry

primary = receipt.get("primary_artifact_hashes")
require(isinstance(primary, dict) and primary, "receipt has no primary artifact hashes")
for relative, expected in primary.items():
    require(relative in by_path, f"primary artifact is unlisted: {relative}")
    require(isinstance(expected, dict), f"invalid primary artifact: {relative}")
    require(by_path[relative].get("sha256") == expected.get("sha256"), f"primary hash mismatch: {relative}")
    require(by_path[relative].get("bytes") == expected.get("bytes"), f"primary size mismatch: {relative}")

secret_name = __import__("re").compile(r"(?:^|_)(?:API_?KEY|ACCESS_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|AUTH)(?:_|$)", __import__("re").I)
for player in receipt.get("plan", {}).get("players", []):
    require(not any(secret_name.search(key) for key in player.get("env", {})), "secret-bearing player env in receipt")
PY
}

verify_qualifier_receipt() {
  local output=$1
  python3 - "$output" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
receipt = json.loads((root / "receipt.json").read_text(encoding="utf-8"))

def require(condition, message):
    if not condition:
        raise SystemExit(message)

require(receipt.get("status") == "passed", "qualifier receipt status is not passed")
require(receipt.get("execution_class") == "transport_canary", "qualifier is not a transport canary")
require(receipt.get("run_spec", {}).get("manifest_label") == "transport-canary-candidate", "qualifier label mismatch")
require(receipt.get("run_spec", {}).get("manifest_role") == "candidate", "qualifier role mismatch")
require(receipt.get("runtime_fingerprint", {}).get("status") == "verified", "qualifier runtime is unverified")
require(receipt.get("bundle_verification", {}).get("status") == "verified", "qualifier bundle is unverified")
require(receipt.get("post_run_attestation", {}).get("status") == "stable", "qualifier post-run attestation is not stable")

artifacts = receipt.get("artifacts")
require(isinstance(artifacts, list) and artifacts, "qualifier receipt has no artifact hashes")
for entry in artifacts:
    relative = entry.get("path") if isinstance(entry, dict) else None
    require(isinstance(relative, str) and relative, "invalid qualifier artifact path")
    pure = pathlib.PurePosixPath(relative)
    require(not pure.is_absolute() and ".." not in pure.parts, "unsafe qualifier artifact path")
    target = root.joinpath(*pure.parts)
    require(target.is_file() and not target.is_symlink(), f"missing qualifier artifact: {relative}")
    body = target.read_bytes()
    require(hashlib.sha256(body).hexdigest() == entry.get("sha256"), f"qualifier hash mismatch: {relative}")
    require(len(body) == entry.get("bytes"), f"qualifier size mismatch: {relative}")
PY
}

receipt_failed=0
if (( fetch_failed == 0 )); then
  for index in 0 1 2 3; do
    if ! verify_receipt "${outputs[$index]}" "${maps[$index]}" "${specs[$index]}"; then
      receipt_failed=1
    fi
    if [[ ${roles[$index]} == candidate ]] &&
      ! verify_qualifier_receipt "${outputs[$index]}/qualifier"; then
      receipt_failed=1
    fi
  done
else
  receipt_failed=1
fi
verify_runner

if (( run_failed != 0 || fetch_failed != 0 || receipt_failed != 0 )); then
  echo "STD1_RUNPOD_FOUR_FAILED run=$run_failed fetch=$fetch_failed receipt=$receipt_failed" >&2
  exit 1
fi

write_dispatch_receipts() {
  local pods_tsv=$scratch/dispatcher-pods.tsv
  local template=$scratch/dispatcher-receipt.json
  local index formal_sha qualifier_sha runner_status_sha script_sha target temp
  : > "$pods_tsv"
  for index in 0 1 2 3; do
    formal_sha=$(sha256_file "${outputs[$index]}/receipt.json")
    qualifier_sha=""
    if [[ ${roles[$index]} == candidate ]]; then
      qualifier_sha=$(sha256_file "${outputs[$index]}/qualifier/receipt.json")
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$index" "${pod_ids[$index]}" "${pod_names[$index]}" \
      "${roles[$index]}" "${maps[$index]}" "${outputs[$index]}" \
      "${pre_start_statuses[$index]}" "${post_stop_statuses[$index]}" \
      "${archive_shas[$index]}" "${extractor_shas[$index]}" \
      "$formal_sha" "$qualifier_sha" >> "$pods_tsv"
  done
  runner_status_sha=$(sha256_file "$scratch/runner-status-latest.json")
  script_sha=$(sha256_file "$repo/scripts/run-standard-rebuild-runpod-four.sh")
  python3 - \
    "$template" "$pods_tsv" "$scratch/runner-status-latest.json" \
    "$run_id" "$execution_id" "$script_sha" \
    "$pangaea_archive" "$pangaea_sha" "$pangaea_extractor_sha" \
    "$world_archive" "$world_sha" "$world_extractor_sha" \
    "$runner_status_sha" "${outputs[@]}" <<'PY'
import datetime
import json
import pathlib
import sys

(
    output_path,
    pods_path,
    runner_status_path,
    run_id,
    execution_id,
    script_sha256,
    pangaea_path,
    pangaea_sha256,
    pangaea_extractor_sha256,
    world_path,
    world_sha256,
    world_extractor_sha256,
    runner_status_sha256,
    *outputs,
) = sys.argv[1:]
runner_status = json.loads(pathlib.Path(runner_status_path).read_text(encoding="utf-8"))
pods = []
for line in pathlib.Path(pods_path).read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) != 12:
        raise SystemExit("invalid dispatcher pod evidence row")
    (
        index,
        pod_id,
        name,
        role,
        map_name,
        formal_output,
        pre_start_status,
        post_stop_status,
        bundle_sha256,
        extractor_sha256,
        formal_receipt_sha256,
        qualifier_receipt_sha256,
    ) = fields
    if pre_start_status != "EXITED" or post_stop_status != "EXITED":
        raise SystemExit("dispatcher pod lifecycle is not EXITED -> EXITED")
    pods.append({
        "index": int(index),
        "id": pod_id,
        "name": name,
        "role": role,
        "map": map_name,
        "formal_output": formal_output,
        "pre_start_status": pre_start_status,
        "post_stop_status": post_stop_status,
        "bundle_sha256": bundle_sha256,
        "extractor_sha256": extractor_sha256,
        "formal_receipt_sha256": formal_receipt_sha256,
        "qualifier_receipt_sha256": qualifier_receipt_sha256 or None,
    })
if len(pods) != 4 or len({pod["id"] for pod in pods}) != 4:
    raise SystemExit("dispatcher receipt does not bind four unique pods")
if runner_status.get("owner") != "odin" or runner_status.get("run_id") != run_id:
    raise SystemExit("dispatcher runner identity changed")
if sorted(runner_status.get("outputs", [])) != sorted(outputs):
    raise SystemExit("dispatcher runner output binding changed")
receipt_locations = [str(pathlib.Path(value) / "dispatcher-receipt.json") for value in outputs]
receipt = {
    "schema_version": "proxywar-standard-rebuild-dispatch-v1",
    "status": "passed",
    "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "run_id": run_id,
    "execution_id": execution_id,
    "dispatcher": {
        "path": "scripts/run-standard-rebuild-runpod-four.sh",
        "sha256": script_sha256,
    },
    "lease": {
        "owner": "odin",
        "run_id": run_id,
        "outputs": outputs,
        "verified_status_sha256": runner_status_sha256,
    },
    "bundles": {
        "Pangaea": {
            "archive_path": pangaea_path,
            "archive_sha256": pangaea_sha256,
            "extractor_sha256": pangaea_extractor_sha256,
        },
        "World": {
            "archive_path": world_path,
            "archive_sha256": world_sha256,
            "extractor_sha256": world_extractor_sha256,
        },
    },
    "pods": pods,
    "receipt_locations": receipt_locations,
}
pathlib.Path(output_path).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
PY
  for index in 0 1 2 3; do
    target=${outputs[$index]}/dispatcher-receipt.json
    temp=$(mktemp "${outputs[$index]}/.dispatcher-receipt.XXXXXX")
    cp "$template" "$temp"
    chmod 600 "$temp"
    mv "$temp" "$target"
  done
  local expected_sha
  expected_sha=$(sha256_file "${outputs[0]}/dispatcher-receipt.json")
  for index in 1 2 3; do
    [[ $(sha256_file "${outputs[$index]}/dispatcher-receipt.json") == "$expected_sha" ]]
  done
  printf '%s\n' "$expected_sha"
}

verify_runner
if ! stop_exact_pods; then
  echo "STD1_RUNPOD_STOP_FAILED exact_ids=${pod_ids[*]}" >&2
  exit 1
fi
stop_armed=0
dispatcher_receipt_sha=$(write_dispatch_receipts) || {
  echo "STD1_RUNPOD_DISPATCH_RECEIPT_FAILED" >&2
  exit 1
}

echo "STD1_RUNPOD_FOUR_PASSED run_id=$run_id dispatcher_receipt_sha256=$dispatcher_receipt_sha"
