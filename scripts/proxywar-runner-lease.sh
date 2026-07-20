#!/bin/zsh
set -euo pipefail

ACTION="${1:-status}"
STATE_ROOT="${PROXYWAR_OPERATOR_STATE_ROOT:-/Users/olifreuler/.stormforge/proxywar-operators}"
LOCK_DIR="$STATE_ROOT/runner.lock"
MUTATION_DIR="$STATE_ROOT/runner.mutation.lock"
STAGING_PREFIX="$STATE_ROOT/.runner.lock.staging"
JQ_BIN="${PROXYWAR_JQ_BIN:-jq}"
DOCKER_BIN="${PROXYWAR_DOCKER_BIN:-docker}"
OUTPUT_ROOTS_SPEC="${PROXYWAR_RUNNER_OUTPUT_ROOTS:-/private/tmp}"
INIT_GRACE_SECONDS="${PROXYWAR_RUNNER_INIT_GRACE_SECONDS:-30}"
SIGNAL_GRACE_SECONDS="${PROXYWAR_RUNNER_SIGNAL_GRACE_SECONDS:-5}"
CLAIM_MARKER=".proxywar-runner-claim"
MAX_RUN_ID_LENGTH=80

MUTATION_HELD=0
MUTATION_TOKEN=""
MUTATION_STARTED=""
RUN_OWNS_LOCK=0
RUN_COMPLETED=0
RUN_STAGING=""
CHILD_PID=""
CHILD_STARTED=""
CHILD_PGID=""
REQUESTED_SIGNAL=""
REQUESTED_EXIT=0
LANE=""
RUN_ID=""
TOKEN=""

usage() {
  cat >&2 <<'EOF'
usage:
  proxywar-runner-lease.sh status [--json]
  proxywar-runner-lease.sh run odin|hrafn RUN_ID --output ABS_DIR [--output ABS_DIR ...] -- COMMAND [ARG ...]
  proxywar-runner-lease.sh release odin|hrafn RUN_ID TOKEN
  proxywar-runner-lease.sh release odin|hrafn
  proxywar-runner-lease.sh reap-stale odin|hrafn RUN_ID TOKEN

The two-argument release form exists only for a pure tokenless v1 lock already
present during migration. New standalone acquisition is deliberately disabled:
every new batch must remain under the foreground `run` supervisor.
EOF
}

valid_lane() {
  [[ "$1" == "odin" || "$1" == "hrafn" ]]
}

valid_run_id() {
  local value="$1"
  (( ${#value} >= 1 && ${#value} <= MAX_RUN_ID_LENGTH )) || return 1
  [[ "$value" =~ '^[A-Za-z0-9._-]+$' ]]
}

read_file_from() {
  local directory="$1"
  local name="$2"
  cat "$directory/$name" 2>/dev/null || true
}

read_lock_file() {
  read_file_from "$LOCK_DIR" "$1"
}

normalized_process_start() {
  local pid="$1"
  [[ "$pid" == <-> ]] || return 1
  ps -p "$pid" -o lstart= 2>/dev/null | awk '{$1=$1; print}'
}

pid_matches() {
  local pid="$1"
  local expected_start="$2"
  local actual_start
  [[ "$pid" == <-> && -n "$expected_start" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  actual_start="$(normalized_process_start "$pid")" || return 1
  [[ -n "$actual_start" && "$actual_start" == "$expected_start" ]]
}

process_group_alive() {
  local pgid="$1"
  [[ "$pgid" == <-> && "$pgid" -gt 1 ]] || return 1
  kill -0 -- "-$pgid" 2>/dev/null
}

directory_mtime_epoch() {
  local directory="$1"
  stat -f '%m' "$directory" 2>/dev/null ||
    stat -c '%Y' "$directory" 2>/dev/null
}

directory_is_past_grace() {
  local directory="$1"
  local mtime now
  [[ "$INIT_GRACE_SECONDS" == <-> ]] || return 1
  mtime="$(directory_mtime_epoch "$directory")" || return 1
  now="$(date +%s)"
  (( now - mtime >= INIT_GRACE_SECONDS ))
}

new_token() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi
  print -rn -- "${$}:${RANDOM}:${RANDOM}:$(date +%s%N)" |
    shasum -a 256 | awk '{print $1}'
}

canonical_directory() {
  local directory="$1"
  (cd -P "$directory" 2>/dev/null && pwd -P)
}

canonicalize_roots() {
  local root canonical
  local -a raw seen
  raw=("${(@s/:/)OUTPUT_ROOTS_SPEC}")
  CANONICAL_ROOTS=()
  seen=()
  for root in "${raw[@]}"; do
    [[ -n "$root" && "$root" == /* && "$root" != *$'\n'* &&
      "$root" != *$'\t'* ]] || return 1
    canonical="$(canonical_directory "$root")" || return 1
    [[ "$canonical" != "/" ]] || return 1
    if (( ${seen[(Ie)$canonical]} == 0 )); then
      seen+=("$canonical")
      CANONICAL_ROOTS+=("$canonical")
    fi
  done
  (( ${#CANONICAL_ROOTS[@]} > 0 ))
}

path_is_under_roots() {
  local candidate="$1"
  shift
  local root
  for root in "$@"; do
    if [[ "$candidate" == "$root"/* ]]; then
      return 0
    fi
  done
  return 1
}

canonical_new_output_path() {
  local output="$1"
  shift
  local parent basename canonical_parent canonical
  [[ "$output" == /* && "$output" != *$'\n'* && "$output" != *$'\t'* ]] ||
    return 1
  parent="${output:h}"
  basename="${output:t}"
  [[ -n "$basename" && "$basename" != "." && "$basename" != ".." ]] || return 1
  canonical_parent="$(canonical_directory "$parent")" || return 1
  canonical="$canonical_parent/$basename"
  [[ ! -e "$canonical" && ! -L "$canonical" ]] || return 1
  path_is_under_roots "$canonical" "$@" || return 1
  print -r -- "$canonical"
}

outputs_do_not_overlap() {
  local left right
  local -a outputs
  outputs=("$@")
  for left in "${outputs[@]}"; do
    for right in "${outputs[@]}"; do
      [[ "$left" == "$right" ]] && continue
      if [[ "$left" == "$right"/* || "$right" == "$left"/* ]]; then
        return 1
      fi
    done
  done
}

path_identity() {
  local source_path="$1"
  /usr/bin/stat -f '%d %i' "$source_path" 2>/dev/null ||
    /usr/bin/stat -c '%d %i' "$source_path" 2>/dev/null
}

marker_value() {
  local marker="$1"
  local key="$2"
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' \
    "$marker" 2>/dev/null
}

claim_digest() {
  local token="$1"
  local final_path="$2"
  local device="$3"
  local inode="$4"
  printf '%s\0%s\0%s\0%s' "$token" "$final_path" "$device" "$inode" |
    shasum -a 256 | awk '{print $1}'
}

write_claim_marker() {
  local directory="$1"
  local lane="$2"
  local run_id="$3"
  local token="$4"
  local device="$5"
  local inode="$6"
  local final_path="$7"
  local marker="$directory/$CLAIM_MARKER"
  local digest
  digest="$(claim_digest "$token" "$final_path" "$device" "$inode")" || return 1
  [[ -n "$digest" ]] || return 1
  {
    printf 'schema_version=1\n'
    printf 'lane=%s\n' "$lane"
    printf 'run_id=%s\n' "$run_id"
    printf 'claim_digest=%s\n' "$digest"
    printf 'device=%s\n' "$device"
    printf 'inode=%s\n' "$inode"
    printf 'path=%s\n' "$final_path"
  } > "$marker"
  chmod 600 "$marker"
}

claim_marker_matches() {
  local directory="$1"
  local lane="$2"
  local run_id="$3"
  local token="$4"
  local device="$5"
  local inode="$6"
  local final_path="$7"
  local marker="$directory/$CLAIM_MARKER"
  local expected_digest
  expected_digest="$(claim_digest "$token" "$final_path" "$device" "$inode")" ||
    return 1
  [[ -n "$expected_digest" ]] || return 1
  [[ -f "$marker" && ! -L "$marker" ]] || return 1
  [[ "$(marker_value "$marker" schema_version)" == "1" ]] || return 1
  [[ "$(marker_value "$marker" lane)" == "$lane" ]] || return 1
  [[ "$(marker_value "$marker" run_id)" == "$run_id" ]] || return 1
  [[ "$(marker_value "$marker" claim_digest)" == "$expected_digest" ]] || return 1
  [[ "$(marker_value "$marker" device)" == "$device" ]] || return 1
  [[ "$(marker_value "$marker" inode)" == "$inode" ]] || return 1
  [[ "$(marker_value "$marker" path)" == "$final_path" ]]
}

read_roots_from() {
  local directory="$1"
  ROOTS_FROM_RECORD=()
  [[ -f "$directory/allowed_roots" ]] || return 1
  ROOTS_FROM_RECORD=("${(@f)$(<"$directory/allowed_roots")}")
  (( ${#ROOTS_FROM_RECORD[@]} > 0 )) || return 1
  local root canonical
  for root in "${ROOTS_FROM_RECORD[@]}"; do
    [[ -n "$root" && "$root" == /* && "$root" != "/" ]] || return 1
    canonical="$(canonical_directory "$root")" || return 1
    [[ "$canonical" == "$root" ]] || return 1
  done
}

validate_claimed_output() {
  local record_dir="$1"
  local source="$2"
  local expected_device="$3"
  local expected_inode="$4"
  local lane="$5"
  local run_id="$6"
  local token="$7"
  local canonical identity device inode
  [[ "$source" == /* && "$source" != *$'\n'* && "$source" != *$'\t'* ]] ||
    return 1
  [[ -d "$source" && ! -L "$source" ]] || return 1
  canonical="$(canonical_directory "$source")" || return 1
  [[ "$canonical" == "$source" ]] || return 1
  read_roots_from "$record_dir" || return 1
  path_is_under_roots "$canonical" "${ROOTS_FROM_RECORD[@]}" || return 1
  identity="$(path_identity "$source")" || return 1
  device="${identity%% *}"
  inode="${identity##* }"
  [[ "$device" == "$expected_device" && "$inode" == "$expected_inode" ]] ||
    return 1
  claim_marker_matches "$source" "$lane" "$run_id" "$token" \
    "$expected_device" "$expected_inode" "$source"
}

emit_event() {
  local event="$1"
  local detail="${2:-}"
  "$JQ_BIN" -cn \
    --arg event "$event" \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg lane "${LANE:-}" \
    --arg run_id "${RUN_ID:-}" \
    --arg supervisor_pid "$$" \
    --arg child_pid "${CHILD_PID:-}" \
    --arg detail "$detail" \
    '{
      component: "proxywar-runner-lease",
      event: $event,
      timestamp: $timestamp,
      lane: (if $lane == "" then null else $lane end),
      run_id: (if $run_id == "" then null else $run_id end),
      supervisor_pid: ($supervisor_pid | tonumber),
      child_pid: (try ($child_pid | tonumber) catch null),
      detail: (if $detail == "" then null else $detail end)
    }' >&2 2>/dev/null || true
}

has_v2_marker() {
  [[ "$(read_lock_file schema_version)" == "2" ||
    -e "$LOCK_DIR/ready" ||
    -e "$LOCK_DIR/run_id" ||
    -e "$LOCK_DIR/token" ||
    -e "$LOCK_DIR/supervisor_pid" ||
    -e "$LOCK_DIR/supervisor_started_at" ||
    -e "$LOCK_DIR/outputs" ||
    -e "$LOCK_DIR/output_claims" ||
    -e "$LOCK_DIR/allowed_roots" ||
    -e "$LOCK_DIR/child_pid" ||
    -e "$LOCK_DIR/recovery" ]]
}

is_pure_legacy_lock() {
  [[ -d "$LOCK_DIR" && -s "$LOCK_DIR/owner" && -s "$LOCK_DIR/acquired_at" ]] ||
    return 1
  has_v2_marker && return 1
  local entry
  for entry in "$LOCK_DIR"/*(N); do
    [[ "${entry:t}" == "owner" || "${entry:t}" == "acquired_at" ]] || return 1
  done
}

v2_metadata_complete() {
  [[ "$(read_lock_file schema_version)" == "2" && -e "$LOCK_DIR/ready" ]] ||
    return 1
  local owner run_id token supervisor_pid supervisor_start
  owner="$(read_lock_file owner)"
  run_id="$(read_lock_file run_id)"
  token="$(read_lock_file token)"
  supervisor_pid="$(read_lock_file supervisor_pid)"
  supervisor_start="$(read_lock_file supervisor_started_at)"
  valid_lane "$owner" || return 1
  valid_run_id "$run_id" || return 1
  [[ -n "$token" && "$token" != *$'\n'* ]] || return 1
  [[ "$supervisor_pid" == <-> && -n "$supervisor_start" ]] || return 1
  [[ -s "$LOCK_DIR/acquired_at" && -s "$LOCK_DIR/outputs" &&
    -f "$LOCK_DIR/output_claims" && -s "$LOCK_DIR/allowed_roots" ]] || return 1
}

lock_kind() {
  if [[ ! -e "$LOCK_DIR" ]]; then
    if [[ -e "$MUTATION_DIR" ]]; then
      print -r -- "initializing"
    else
      print -r -- "free"
    fi
    return
  fi
  [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || {
    print -r -- "corrupt"
    return
  }
  if has_v2_marker; then
    if [[ "$(read_lock_file schema_version)" == "2" && ! -e "$LOCK_DIR/ready" ]]; then
      print -r -- "initializing"
    elif v2_metadata_complete; then
      print -r -- "v2"
    else
      print -r -- "corrupt"
    fi
    return
  fi
  if is_pure_legacy_lock; then
    print -r -- "legacy"
  else
    print -r -- "corrupt"
  fi
}

lock_matches() {
  local lane="$1"
  local run_id="$2"
  local token="$3"
  [[ "$(lock_kind)" == "v2" ]] || return 1
  [[ "$(read_lock_file owner)" == "$lane" ]] || return 1
  [[ "$(read_lock_file run_id)" == "$run_id" ]] || return 1
  [[ "$(read_lock_file token)" == "$token" ]]
}

recovery_alive() {
  local pid started
  [[ -d "$LOCK_DIR/recovery" ]] || return 1
  pid="$(read_file_from "$LOCK_DIR/recovery" pid)"
  started="$(read_file_from "$LOCK_DIR/recovery" started_at)"
  pid_matches "$pid" "$started"
}

status_json() {
  local kind state owner acquired run_id supervisor_pid supervisor_start
  local child_pid child_start child_pgid supervisor_alive child_alive
  local outputs_json schema_json reap_json
  kind="$(lock_kind)"
  owner=""
  acquired=""
  run_id=""
  supervisor_pid=""
  supervisor_start=""
  child_pid=""
  child_start=""
  child_pgid=""
  outputs_json='[]'
  supervisor_alive="null"
  child_alive="null"
  reap_json="false"

  if [[ -d "$LOCK_DIR" ]]; then
    owner="$(read_lock_file owner)"
    acquired="$(read_lock_file acquired_at)"
    run_id="$(read_lock_file run_id)"
    supervisor_pid="$(read_lock_file supervisor_pid)"
    supervisor_start="$(read_lock_file supervisor_started_at)"
    child_pid="$(read_lock_file child_pid)"
    child_start="$(read_lock_file child_started_at)"
    child_pgid="$(read_lock_file child_pgid)"
    if [[ -f "$LOCK_DIR/outputs" ]]; then
      outputs_json="$("$JQ_BIN" -Rsc \
        'split("\n") | map(select(length > 0))' < "$LOCK_DIR/outputs" 2>/dev/null)" ||
        outputs_json='[]'
    fi
  fi

  case "$kind" in
    free)
      state="free"
      schema_json="2"
      ;;
    v2)
      schema_json="2"
      if [[ -d "$LOCK_DIR/recovery" ]]; then
        state="reaping"
        reap_json="true"
      elif pid_matches "$supervisor_pid" "$supervisor_start"; then
        state="active"
      else
        state="stale"
      fi
      if pid_matches "$supervisor_pid" "$supervisor_start"; then
        supervisor_alive="true"
      else
        supervisor_alive="false"
      fi
      if [[ -n "$child_pid" ]]; then
        if pid_matches "$child_pid" "$child_start"; then
          child_alive="true"
        else
          child_alive="false"
        fi
      fi
      ;;
    legacy)
      state="legacy"
      schema_json="1"
      ;;
    initializing)
      state="initializing"
      schema_json="2"
      ;;
    *)
      state="corrupt"
      schema_json="null"
      ;;
  esac

  "$JQ_BIN" -cn \
    --arg state "$state" \
    --argjson schema_version "$schema_json" \
    --arg owner "$owner" \
    --arg run_id "$run_id" \
    --arg supervisor_pid "$supervisor_pid" \
    --argjson supervisor_alive "$supervisor_alive" \
    --arg child_pid "$child_pid" \
    --arg child_pgid "$child_pgid" \
    --argjson child_alive "$child_alive" \
    --arg acquired_at "$acquired" \
    --argjson outputs "$outputs_json" \
    --argjson reap_in_progress "$reap_json" \
    '{
      state: $state,
      schema_version: $schema_version,
      owner: (if $owner == "" then null else $owner end),
      run_id: (if $run_id == "" then null else $run_id end),
      supervisor_pid: (try ($supervisor_pid | tonumber) catch null),
      supervisor_alive: $supervisor_alive,
      child_pid: (try ($child_pid | tonumber) catch null),
      child_pgid: (try ($child_pgid | tonumber) catch null),
      child_alive: $child_alive,
      acquired_at: (if $acquired_at == "" then null else $acquired_at end),
      outputs: $outputs,
      reap_in_progress: $reap_in_progress
    }'
}

status_plain() {
  local json
  json="$(status_json)"
  print -r -- "$json" | "$JQ_BIN" -r '
    if .state == "free" then "free"
    elif .state == "active" then
      "owned:\(.owner):\(.run_id):\(.supervisor_pid):\(.acquired_at)"
    elif .state == "stale" then
      "stale:\(.owner):\(.run_id):\(.supervisor_pid):\(.acquired_at)"
    elif .state == "legacy" then
      "owned:\(.owner):legacy:\(.acquired_at)"
    else "\(.state):\(.owner // "unknown"):\(.run_id // "unknown")"
    end'
}

atomic_retire_directory() {
  local directory="$1"
  local label="$2"
  local retired="${directory}.${label}.$$.$RANDOM"
  mv "$directory" "$retired" || return 1
  rm -rf "$retired"
}

cleanup_staging_directory() {
  local staging="$1"
  [[ -d "$staging" && ! -L "$staging" ]] || return 1
  local lane run_id token source device inode temp marker identity
  lane="$(read_file_from "$staging" owner)"
  run_id="$(read_file_from "$staging" run_id)"
  token="$(read_file_from "$staging" token)"
  if [[ -f "$staging/outputs" ]]; then
    while IFS= read -r source; do
      [[ -n "$source" ]] || continue
      temp="${source}.proxywar-claiming-${token}"
      if [[ -d "$temp" && ! -L "$temp" ]]; then
        marker="$temp/$CLAIM_MARKER"
        if [[ -f "$marker" ]]; then
          identity="$(path_identity "$temp")" || return 1
          device="${identity%% *}"
          inode="${identity##* }"
          claim_marker_matches "$temp" "$lane" "$run_id" "$token" \
            "$device" "$inode" "$source" || return 1
          rm "$marker"
        fi
        rmdir "$temp" || return 1
      elif [[ -e "$temp" || -L "$temp" ]]; then
        return 1
      fi
      if [[ -d "$source" && ! -L "$source" ]]; then
        identity="$(path_identity "$source")" || return 1
        device="${identity%% *}"
        inode="${identity##* }"
        claim_marker_matches "$source" "$lane" "$run_id" "$token" \
          "$device" "$inode" "$source" || return 1
        rm "$source/$CLAIM_MARKER"
        rmdir "$source" || return 1
      elif [[ -e "$source" || -L "$source" ]]; then
        return 1
      fi
    done < "$staging/outputs"
  fi
  atomic_retire_directory "$staging" "discarded"
}

cleanup_orphan_staging() {
  local staging
  for staging in "$STAGING_PREFIX".*(N); do
    cleanup_staging_directory "$staging" || {
      print -r -- "unsafe orphan staging; refusing mutation:${staging}" >&2
      return 1
    }
    emit_event "bootstrap_staging_recovered" "${staging:t}"
  done
}

mutation_acquire() {
  mkdir -p "$STATE_ROOT"
  local contender_pid contender_start retired
  MUTATION_STARTED="$(normalized_process_start "$$")" || true
  [[ -n "$MUTATION_STARTED" ]] || {
    print -r -- "cannot bind mutation guard without process start signature" >&2
    return 70
  }
  MUTATION_TOKEN="$(new_token)"
  while ! mkdir "$MUTATION_DIR" 2>/dev/null; do
    [[ -d "$MUTATION_DIR" && ! -L "$MUTATION_DIR" ]] || {
      print -r -- "corrupt mutation guard; refusing mutation" >&2
      return 75
    }
    contender_pid="$(read_file_from "$MUTATION_DIR" pid)"
    contender_start="$(read_file_from "$MUTATION_DIR" started_at)"
    if [[ -e "$MUTATION_DIR/ready" ]] &&
      pid_matches "$contender_pid" "$contender_start"; then
      print -r -- "runner mutation in progress:${contender_pid}" >&2
      return 1
    fi
    if [[ ! -e "$MUTATION_DIR/ready" ]] &&
      ! directory_is_past_grace "$MUTATION_DIR"; then
      print -r -- "runner mutation initializing; retry later" >&2
      return 1
    fi
    retired="${MUTATION_DIR}.stale.$$.$RANDOM"
    mv "$MUTATION_DIR" "$retired" 2>/dev/null || continue
    rm -rf "$retired"
  done
  MUTATION_HELD=1
  chmod 700 "$MUTATION_DIR" || return 75
  printf '%s\n' "$$" > "$MUTATION_DIR/pid" || return 75
  printf '%s\n' "$MUTATION_STARTED" > "$MUTATION_DIR/started_at" || return 75
  printf '%s\n' "$MUTATION_TOKEN" > "$MUTATION_DIR/token" || return 75
  chmod 600 "$MUTATION_DIR/pid" "$MUTATION_DIR/started_at" \
    "$MUTATION_DIR/token" || return 75
  : > "$MUTATION_DIR/ready" || return 75
  chmod 600 "$MUTATION_DIR/ready" || return 75
  cleanup_orphan_staging || return 75
}

mutation_release() {
  (( MUTATION_HELD == 1 )) || return 0
  if [[ -f "$MUTATION_DIR/token" &&
    "$(read_file_from "$MUTATION_DIR" token)" != "$MUTATION_TOKEN" ]]; then
    print -r -- "mutation identity changed; refusing release" >&2
    return 75
  fi
  atomic_retire_directory "$MUTATION_DIR" "released" || return 75
  MUTATION_HELD=0
}

maybe_inject_bootstrap_failure() {
  local point="$1"
  if [[ "${PROXYWAR_RUNNER_TEST_MODE:-0}" == "1" &&
    "${PROXYWAR_RUNNER_TEST_FAIL_AFTER:-}" == "$point" ]]; then
    print -r -- "injected bootstrap failure:${point}" >&2
    return 72
  fi
}

write_staging_metadata() {
  local staging="$1"
  local output
  mkdir "$staging"
  chmod 700 "$staging"
  printf '2\n' > "$staging/schema_version"
  maybe_inject_bootstrap_failure schema_version
  printf '%s\n' "$LANE" > "$staging/owner"
  maybe_inject_bootstrap_failure owner
  printf '%s\n' "$RUN_ID" > "$staging/run_id"
  maybe_inject_bootstrap_failure run_id
  printf '%s\n' "$TOKEN" > "$staging/token"
  maybe_inject_bootstrap_failure token
  printf '%s\n' "$$" > "$staging/supervisor_pid"
  maybe_inject_bootstrap_failure supervisor_pid
  printf '%s\n' "$SUPERVISOR_STARTED" > "$staging/supervisor_started_at"
  maybe_inject_bootstrap_failure supervisor_started_at
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$staging/acquired_at"
  maybe_inject_bootstrap_failure acquired_at
  : > "$staging/outputs"
  for output in "${OUTPUTS[@]}"; do
    printf '%s\n' "$output" >> "$staging/outputs"
  done
  maybe_inject_bootstrap_failure outputs
  : > "$staging/output_claims"
  printf '%s\n' "${CANONICAL_ROOTS[@]}" > "$staging/allowed_roots"
  maybe_inject_bootstrap_failure allowed_roots
  chmod 600 "$staging"/*
}

claim_output_directory() {
  local staging="$1"
  local output="$2"
  local temp="${output}.proxywar-claiming-${TOKEN}"
  local identity device inode
  [[ ! -e "$temp" && ! -L "$temp" && ! -e "$output" && ! -L "$output" ]] ||
    return 1
  mkdir -m 700 "$temp"
  identity="$(path_identity "$temp")" || return 1
  device="${identity%% *}"
  inode="${identity##* }"
  write_claim_marker "$temp" "$LANE" "$RUN_ID" "$TOKEN" "$device" "$inode" \
    "$output"
  printf '%s\t%s\t%s\n' "$output" "$device" "$inode" >> "$staging/output_claims"
  [[ ! -e "$output" && ! -L "$output" ]] || return 1
  mv "$temp" "$output"
  validate_claimed_output "$staging" "$output" "$device" "$inode" \
    "$LANE" "$RUN_ID" "$TOKEN"
}

claim_all_outputs() {
  local staging="$1"
  local output
  for output in "${OUTPUTS[@]}"; do
    claim_output_directory "$staging" "$output" || {
      print -r -- "failed to claim output directory:${output}" >&2
      return 73
    }
  done
  maybe_inject_bootstrap_failure output_claims
}

claim_recovery() {
  local mode="$1"
  local recovery="$LOCK_DIR/recovery"
  local pid started retired
  if [[ -e "$recovery" ]]; then
    [[ -d "$recovery" && ! -L "$recovery" ]] || return 1
    pid="$(read_file_from "$recovery" pid)"
    started="$(read_file_from "$recovery" started_at)"
    if pid_matches "$pid" "$started"; then
      print -r -- "recovery already in progress:${pid}" >&2
      return 1
    fi
    retired="${recovery}.stale.$$.$RANDOM"
    mv "$recovery" "$retired" || return 1
    rm -rf "$retired"
  fi
  mkdir "$recovery" || return 1
  chmod 700 "$recovery" || return 1
  printf '%s\n' "$$" > "$recovery/pid" || return 1
  normalized_process_start "$$" > "$recovery/started_at" || return 1
  [[ -s "$recovery/started_at" ]] || return 1
  printf '%s\n' "$mode" > "$recovery/mode" || return 1
  chmod 600 "$recovery/pid" "$recovery/started_at" "$recovery/mode" || return 1
  : > "$recovery/ready" || return 1
  chmod 600 "$recovery/ready" || return 1
}

load_and_validate_claims() {
  CLAIM_PATHS=()
  CLAIM_DEVICES=()
  CLAIM_INODES=()
  local source device inode
  [[ -s "$LOCK_DIR/output_claims" ]] || return 1
  while IFS=$'\t' read -r source device inode; do
    [[ -n "$source" && "$device" == <-> && "$inode" == <-> ]] || return 1
    validate_claimed_output "$LOCK_DIR" "$source" "$device" "$inode" \
      "$LANE" "$RUN_ID" "$TOKEN" || return 1
    CLAIM_PATHS+=("$source")
    CLAIM_DEVICES+=("$device")
    CLAIM_INODES+=("$inode")
  done < "$LOCK_DIR/output_claims"
  (( ${#CLAIM_PATHS[@]} > 0 ))
}

recorded_child_matches() {
  local pid started pgid
  pid="$(read_lock_file child_pid)"
  started="$(read_lock_file child_started_at)"
  pgid="$(read_lock_file child_pgid)"
  [[ "$pgid" == "$pid" && "$pgid" == <-> && "$pgid" -gt 1 ]] || return 1
  pid_matches "$pid" "$started"
}

wait_for_group_exit() {
  local pgid="$1"
  local tenths="$2"
  local count=0
  while process_group_alive "$pgid"; do
    (( count >= tenths )) && return 1
    sleep 0.1
    count=$((count + 1))
  done
}

terminate_recorded_child() {
  local child_pid child_started child_pgid tenths
  child_pid="$(read_lock_file child_pid)"
  child_started="$(read_lock_file child_started_at)"
  child_pgid="$(read_lock_file child_pgid)"
  [[ -n "$child_pid" ]] || return 0
  [[ "$child_pid" == <-> && "$child_pgid" == "$child_pid" &&
    "$child_pgid" -gt 1 && -n "$child_started" ]] || {
    print -r -- "invalid child identity; refusing recovery" >&2
    return 1
  }
  if ! process_group_alive "$child_pgid"; then
    return 0
  fi
  pid_matches "$child_pid" "$child_started" || {
    print -r -- "child group exists without matching leader; refusing unsafe signal" >&2
    return 1
  }
  emit_event "child_group_term" "pgid=${child_pgid}"
  kill -TERM -- "-$child_pgid" 2>/dev/null || return 1
  tenths=$(( ${SIGNAL_GRACE_SECONDS%.*} * 10 ))
  (( tenths > 0 )) || tenths=1
  if ! wait_for_group_exit "$child_pgid" "$tenths"; then
    emit_event "child_group_kill" "pgid=${child_pgid}"
    kill -KILL -- "-$child_pgid" 2>/dev/null || return 1
    wait_for_group_exit "$child_pgid" 20 || {
      print -r -- "child group survived SIGKILL:${child_pgid}" >&2
      return 1
    }
  fi
}

child_group_lost_recorded_leader() {
  local child_pid child_started child_pgid
  child_pid="$(read_lock_file child_pid)"
  child_started="$(read_lock_file child_started_at)"
  child_pgid="$(read_lock_file child_pgid)"
  [[ "$child_pid" == <-> && "$child_pgid" == "$child_pid" &&
    "$child_pgid" -gt 1 && -n "$child_started" ]] || return 1
  process_group_alive "$child_pgid" && ! pid_matches "$child_pid" "$child_started"
}

docker_list_all() {
  # Docker Desktop can retain uninspectable "created" summary rows after the
  # underlying container object is gone. Keep state and summary mounts only to
  # identify that narrow 404 case; every inspectable row still uses exact
  # mount sources from `docker inspect`.
  "$DOCKER_BIN" ps -a --no-trunc --format '{{.ID}}\t{{.State}}\t{{.Mounts}}'
}

scan_matching_containers() {
  local listed row remainder container container_state mount_summary
  local mounts inspect_error mount output
  local -a rows mount_lines
  MATCHED_CONTAINERS=()
  listed="$(docker_list_all)" || {
    print -r -- "docker list failed; preserving lease" >&2
    return 69
  }
  rows=("${(@f)listed}")
  for row in "${rows[@]}"; do
    [[ -n "$row" ]] || continue
    [[ "$row" == *$'\t'* ]] || {
      print -r -- "invalid docker list row; preserving lease" >&2
      return 69
    }
    container="${row%%$'\t'*}"
    remainder="${row#*$'\t'}"
    [[ "$remainder" == *$'\t'* ]] || {
      print -r -- "invalid docker list fields; preserving lease" >&2
      return 69
    }
    container_state="${remainder%%$'\t'*}"
    mount_summary="${remainder#*$'\t'}"
    [[ -n "$container" ]] || {
      print -r -- "empty docker container id; preserving lease" >&2
      return 69
    }
    [[ -n "$container_state" ]] || {
      print -r -- "empty docker container state; preserving lease" >&2
      return 69
    }
    if ! mounts="$("$DOCKER_BIN" inspect \
      --format '{{range .Mounts}}{{println .Source}}{{end}}' \
      "$container" 2>&1)"; then
      inspect_error="${mounts:l}"
      # Docker Desktop 29 can list a persistent, mount-free Created row whose
      # object endpoint returns 404. Ignore only that exact contradiction.
      # A mount-bearing summary, another state, or another inspect error stays
      # fail-closed.
      if [[ -z "$mount_summary" && "$container_state" == "created" &&
        ( "$inspect_error" == *"no such object"* ||
          "$inspect_error" == *"no such container"* ) ]]; then
        emit_event "docker_ghost_ignored" "container=${container[1,12]}"
        continue
      fi
      print -r -- "docker inspect failed:${container}; preserving lease" >&2
      return 69
    fi
    mount_lines=("${(@f)mounts}")
    for mount in "${mount_lines[@]}"; do
      for output in "${CLAIM_PATHS[@]}"; do
        if [[ -n "$mount" && "$mount" == "$output" ]]; then
          MATCHED_CONTAINERS+=("$container")
          break 2
        fi
      done
    done
  done
}

scoped_container_cleanup() {
  command -v "$DOCKER_BIN" >/dev/null 2>&1 || {
    print -r -- "docker unavailable; preserving lease" >&2
    return 69
  }
  scan_matching_containers || return
  local -a first_scan
  local container running stopped=0
  first_scan=("${MATCHED_CONTAINERS[@]}")
  for container in "${first_scan[@]}"; do
    running="$("$DOCKER_BIN" inspect --format '{{.State.Running}}' "$container")" ||
      {
        print -r -- "docker state inspect failed:${container}; preserving lease" >&2
        return 69
      }
    if [[ "$running" == "true" ]]; then
      "$DOCKER_BIN" stop -t 2 "$container" >/dev/null || {
        print -r -- "docker stop failed:${container}; preserving lease" >&2
        return 69
      }
    elif [[ "$running" != "false" ]]; then
      print -r -- "invalid docker running state:${container}; preserving lease" >&2
      return 69
    fi
    "$DOCKER_BIN" rm "$container" >/dev/null || {
      print -r -- "docker remove failed:${container}; preserving lease" >&2
      return 69
    }
    stopped=$((stopped + 1))
  done
  scan_matching_containers || return
  (( ${#MATCHED_CONTAINERS[@]} == 0 )) || {
    print -r -- "matching containers remain after cleanup; preserving lease" >&2
    return 69
  }
  CLEANED_CONTAINER_COUNT="$stopped"
  emit_event "containers_cleaned" "count=${stopped}"
}

abort_destination() {
  local source="$1"
  local stamp destination suffix
  stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  destination="${source}.aborted-${stamp}-${RUN_ID}"
  suffix=1
  while [[ -e "$destination" || -L "$destination" ]]; do
    destination="${source}.aborted-${stamp}-${RUN_ID}-${suffix}"
    suffix=$((suffix + 1))
  done
  print -r -- "$destination"
}

write_abort_receipt() {
  local destination="$1"
  local source="$2"
  local reason="$3"
  "$JQ_BIN" -n \
    --arg lane "$LANE" \
    --arg run_id "$RUN_ID" \
    --arg reason "$reason" \
    --arg source "$source" \
    --arg quarantined_path "$destination" \
    --arg quarantined_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      schema_version: 1,
      lane: $lane,
      run_id: $run_id,
      reason: $reason,
      source_path: $source,
      quarantined_path: $quarantined_path,
      quarantined_at: $quarantined_at,
      evidence_eligible: false
    }' > "$destination/runner-abort-receipt.json"
}

quarantine_claimed_outputs() {
  local reason="$1"
  local source destination
  load_and_validate_claims || {
    print -r -- "output ownership validation failed; preserving lease" >&2
    return 74
  }
  for source in "${CLAIM_PATHS[@]}"; do
    rm "$source/$CLAIM_MARKER" || return 74
    destination="$(abort_destination "$source")"
    mv "$source" "$destination" || return 74
    write_abort_receipt "$destination" "$source" "$reason" || return 74
    emit_event "output_quarantined" "${source}->${destination}"
  done
}

release_successful_output_claims() {
  local source
  load_and_validate_claims || {
    print -r -- "output ownership validation failed; preserving lease" >&2
    return 74
  }
  for source in "${CLAIM_PATHS[@]}"; do
    rm "$source/$CLAIM_MARKER" || return 74
  done
}

release_exact_internal() {
  local lane="$1"
  local run_id="$2"
  local token="$3"
  (( MUTATION_HELD == 1 )) || {
    print -r -- "internal error: exact release without mutation guard" >&2
    return 75
  }
  lock_matches "$lane" "$run_id" "$token" || return 1
  if [[ "${PROXYWAR_RUNNER_TEST_MODE:-0}" == "1" &&
    -n "${PROXYWAR_RUNNER_TEST_RETIRE_BARRIER:-}" ]]; then
    mkdir -p "$PROXYWAR_RUNNER_TEST_RETIRE_BARRIER"
    : > "$PROXYWAR_RUNNER_TEST_RETIRE_BARRIER/entered"
    while [[ ! -e "$PROXYWAR_RUNNER_TEST_RETIRE_BARRIER/continue" ]]; do
      sleep 0.01
    done
  fi
  atomic_retire_directory "$LOCK_DIR" "released"
}

finalize_owned_run() {
  local command_status="$1"
  local reason
  mutation_acquire || {
    emit_event "cleanup_refused" "mutation-guard"
    return 75
  }
  lock_matches "$LANE" "$RUN_ID" "$TOKEN" || {
    emit_event "cleanup_refused" "lease-identity-changed"
    return 75
  }
  claim_recovery "owner-cleanup" || {
    emit_event "cleanup_refused" "recovery-owned"
    return 75
  }
  terminate_recorded_child || {
    emit_event "cleanup_refused" "child-group-uncertain"
    return 75
  }
  load_and_validate_claims || {
    emit_event "cleanup_refused" "output-ownership"
    return 74
  }
  scoped_container_cleanup || {
    emit_event "cleanup_refused" "docker-uncertain"
    return 69
  }
  if (( command_status == 0 && RUN_COMPLETED == 1 )); then
    release_successful_output_claims || return
  else
    reason="supervised_command_exit_${command_status}"
    [[ -n "$REQUESTED_SIGNAL" ]] &&
      reason="supervised_signal_${REQUESTED_SIGNAL}"
    quarantine_claimed_outputs "$reason" || return
  fi
  release_exact_internal "$LANE" "$RUN_ID" "$TOKEN" || return 75
  RUN_OWNS_LOCK=0
  emit_event "lease_released" "command_status=${command_status}"
}

run_exit_cleanup() {
  local command_status=$?
  local cleanup_status=0
  trap - EXIT HUP INT TERM ZERR
  if (( RUN_OWNS_LOCK == 1 )); then
    finalize_owned_run "$command_status" || cleanup_status=$?
  elif [[ -n "$RUN_STAGING" && -d "$RUN_STAGING" ]]; then
    cleanup_staging_directory "$RUN_STAGING" || cleanup_status=74
  fi
  mutation_release || cleanup_status=$?
  if (( cleanup_status != 0 )); then
    print -r -- "runner cleanup incomplete; lease/evidence preserved:${cleanup_status}" >&2
    exit "$cleanup_status"
  fi
  exit "$command_status"
}

release_exit_cleanup() {
  local command_status=$?
  trap - EXIT ZERR
  mutation_release || command_status=$?
  exit "$command_status"
}

forward_signal() {
  local signal_name="$1"
  local exit_code="$2"
  REQUESTED_SIGNAL="$signal_name"
  REQUESTED_EXIT="$exit_code"
  emit_event "signal_received" "$signal_name"
  if [[ -n "$CHILD_PID" && -n "$CHILD_STARTED" && -n "$CHILD_PGID" &&
    "$CHILD_PGID" == "$CHILD_PID" ]] &&
    pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
    kill "-$signal_name" -- "-$CHILD_PGID" 2>/dev/null || true
    emit_event "signal_forwarded" "${signal_name}:pgid=${CHILD_PGID}"
  fi
}

run_action() {
  LANE="${2:-}"
  RUN_ID="${3:-}"
  valid_lane "$LANE" || {
    usage
    return 64
  }
  valid_run_id "$RUN_ID" || {
    print -r -- "RUN_ID must be 1-${MAX_RUN_ID_LENGTH} letters, digits, dots, underscores, or hyphens" >&2
    return 64
  }
  shift 3
  canonicalize_roots || {
    print -r -- "PROXYWAR_RUNNER_OUTPUT_ROOTS must contain existing absolute roots other than /" >&2
    return 64
  }
  OUTPUTS=()
  local canonical_output
  while (( $# > 0 )); do
    case "$1" in
      --output)
        (( $# >= 2 )) || {
          usage
          return 64
        }
        canonical_output="$(canonical_new_output_path "$2" \
          "${CANONICAL_ROOTS[@]}")" || {
          print -r -- "output paths must be new dedicated directories under PROXYWAR_RUNNER_OUTPUT_ROOTS" >&2
          return 64
        }
        if (( ${OUTPUTS[(Ie)$canonical_output]} > 0 )); then
          print -r -- "duplicate output path:${canonical_output}" >&2
          return 64
        fi
        OUTPUTS+=("$canonical_output")
        shift 2
        ;;
      --)
        shift
        break
        ;;
      *)
        usage
        return 64
        ;;
    esac
  done
  (( ${#OUTPUTS[@]} > 0 && $# > 0 )) || {
    print -r -- "at least one --output directory and a command are required" >&2
    usage
    return 64
  }
  outputs_do_not_overlap "${OUTPUTS[@]}" || {
    print -r -- "output paths must not contain or overlap each other" >&2
    return 64
  }

  SUPERVISOR_STARTED="$(normalized_process_start "$$")" || true
  [[ -n "$SUPERVISOR_STARTED" ]] || {
    print -r -- "cannot bind lease without supervisor start signature" >&2
    return 70
  }
  TOKEN="$(new_token)"

  mutation_acquire
  if [[ -e "$LOCK_DIR" ]]; then
    local existing_owner existing_run
    existing_owner="$(read_lock_file owner)"
    existing_run="$(read_lock_file run_id)"
    print -r -- "busy:${existing_owner:-unknown}:${existing_run:-legacy-or-initializing}" >&2
    return 1
  fi
  RUN_STAGING="${STAGING_PREFIX}.${$}.${RANDOM}"
  write_staging_metadata "$RUN_STAGING"
  claim_all_outputs "$RUN_STAGING"
  : > "$RUN_STAGING/ready"
  chmod 600 "$RUN_STAGING/ready"
  maybe_inject_bootstrap_failure ready
  mv "$RUN_STAGING" "$LOCK_DIR"
  RUN_OWNS_LOCK=1
  RUN_STAGING=""
  mutation_release
  emit_event "lease_acquired" "outputs=${#OUTPUTS[@]}"

  /usr/bin/perl -MPOSIX -e \
    'POSIX::setpgid(0,0); exec @ARGV or die "exec failed: $!\n"' -- "$@" &
  CHILD_PID="$!"
  CHILD_PGID="$CHILD_PID"
  CHILD_STARTED="$(normalized_process_start "$CHILD_PID")" || true
  if [[ -z "$CHILD_STARTED" ]]; then
    print -r -- "cannot bind child start signature" >&2
    return 70
  fi
  printf '%s\n' "$CHILD_PID" > "$LOCK_DIR/child_pid"
  printf '%s\n' "$CHILD_STARTED" > "$LOCK_DIR/child_started_at"
  printf '%s\n' "$CHILD_PGID" > "$LOCK_DIR/child_pgid"
  chmod 600 "$LOCK_DIR/child_pid" "$LOCK_DIR/child_started_at" \
    "$LOCK_DIR/child_pgid"
  emit_event "child_started" "pgid=${CHILD_PGID}"

  local child_status=0
  if wait "$CHILD_PID"; then
    child_status=0
  else
    child_status=$?
  fi
  while pid_matches "$CHILD_PID" "$CHILD_STARTED"; do
    if wait "$CHILD_PID"; then
      child_status=0
    else
      child_status=$?
    fi
  done
  if (( REQUESTED_EXIT != 0 )); then
    child_status="$REQUESTED_EXIT"
  fi
  emit_event "child_exited" "status=${child_status}"
  if (( child_status == 0 )); then
    RUN_COMPLETED=1
  fi
  return "$child_status"
}

release_action() {
  LANE="${2:-}"
  valid_lane "$LANE" || {
    usage
    return 64
  }
  mutation_acquire
  local kind owner supervisor_pid supervisor_started output
  if [[ ! -e "$LOCK_DIR" ]]; then
    print -r -- "free"
    return 0
  fi
  kind="$(lock_kind)"
  if (( $# == 2 )); then
    if [[ "$kind" != "legacy" ]]; then
      print -r -- "tokenless release is restricted to a pure v1 migration lock" >&2
      return 64
    fi
    owner="$(read_lock_file owner)"
    [[ "$owner" == "$LANE" ]] || {
      print -r -- "owned-by:${owner:-unknown}" >&2
      return 1
    }
    atomic_retire_directory "$LOCK_DIR" "legacy-released"
    emit_event "legacy_lease_released"
    print -r -- "released-legacy:${LANE}"
    return 0
  fi
  (( $# == 4 )) || {
    usage
    return 64
  }
  RUN_ID="$3"
  TOKEN="$4"
  lock_matches "$LANE" "$RUN_ID" "$TOKEN" || {
    print -r -- "lease-mismatch:${LANE}:${RUN_ID}" >&2
    return 1
  }
  supervisor_pid="$(read_lock_file supervisor_pid)"
  supervisor_started="$(read_lock_file supervisor_started_at)"
  if pid_matches "$supervisor_pid" "$supervisor_started"; then
    print -r -- "active-run:${LANE}:${RUN_ID}:${supervisor_pid}" >&2
    return 1
  fi
  if [[ -d "$LOCK_DIR/recovery" ]]; then
    local recovery_pid recovery_started recovery_mode retired
    [[ ! -L "$LOCK_DIR/recovery" ]] || {
      print -r -- "reap-in-progress:${LANE}:${RUN_ID}" >&2
      return 1
    }
    recovery_pid="$(read_file_from "$LOCK_DIR/recovery" pid)"
    recovery_started="$(read_file_from "$LOCK_DIR/recovery" started_at)"
    recovery_mode="$(read_file_from "$LOCK_DIR/recovery" mode)"
    if [[ "$recovery_mode" == "stale-reap" || "$recovery_mode" == "owner-cleanup" ]] &&
      ! pid_matches "$recovery_pid" "$recovery_started"; then
      # A forced-stop or Docker crash can strand a dead cleanup marker. The
      # exact-token release path may clear only that dead marker; recorded
      # outputs remain fail-closed in the loop below and require reap-stale.
      retired="${LOCK_DIR}/recovery.stale-release.$$.$RANDOM"
      mv "$LOCK_DIR/recovery" "$retired" || return 1
      rm -rf "$retired"
    else
      print -r -- "reap-in-progress:${LANE}:${RUN_ID}" >&2
      return 1
    fi
  fi
  while IFS= read -r output; do
    if [[ -n "$output" && (-e "$output" || -L "$output") ]]; then
      print -r -- "recorded-output-present:${output}:use-reap-stale" >&2
      return 1
    fi
  done < "$LOCK_DIR/outputs"
  release_exact_internal "$LANE" "$RUN_ID" "$TOKEN"
  emit_event "lease_released" "external-empty-stale"
  print -r -- "released:${LANE}:${RUN_ID}"
}

reap_action() {
  (( $# == 4 )) || {
    usage
    return 64
  }
  LANE="$2"
  RUN_ID="$3"
  TOKEN="$4"
  valid_lane "$LANE" && valid_run_id "$RUN_ID" || {
    usage
    return 64
  }
  mutation_acquire
  lock_matches "$LANE" "$RUN_ID" "$TOKEN" || {
    print -r -- "lease-mismatch:${LANE}:${RUN_ID}" >&2
    return 1
  }
  local supervisor_pid supervisor_started
  supervisor_pid="$(read_lock_file supervisor_pid)"
  supervisor_started="$(read_lock_file supervisor_started_at)"
  if pid_matches "$supervisor_pid" "$supervisor_started"; then
    print -r -- "active-run:${LANE}:${RUN_ID}:${supervisor_pid}" >&2
    return 1
  fi
  claim_recovery "stale-reap" || return 1
  emit_event "stale_reap_started" "supervisor=${supervisor_pid}"
  load_and_validate_claims || {
    emit_event "recovery_refused" "output-ownership"
    return 74
  }
  local leaderless_group=0
  if ! terminate_recorded_child; then
    child_group_lost_recorded_leader || {
      emit_event "recovery_refused" "child-group-uncertain"
      return 75
    }
    leaderless_group=1
    emit_event "leaderless-group-preserved" "container-cleanup-only"
  fi
  scoped_container_cleanup || {
    emit_event "recovery_refused" "docker-uncertain"
    return 69
  }
  if (( leaderless_group == 1 )); then
    emit_event "leaderless-group-containers-cleared" "containers=${CLEANED_CONTAINER_COUNT:-0}"
  fi
  quarantine_claimed_outputs "stale_supervisor" || return
  release_exact_internal "$LANE" "$RUN_ID" "$TOKEN" || return 75
  emit_event "stale_reap_completed" "containers=${CLEANED_CONTAINER_COUNT:-0}"
  print -r -- "reaped:${LANE}:${RUN_ID}:containers=${CLEANED_CONTAINER_COUNT:-0}"
}

case "$ACTION" in
  status)
    if [[ "${2:-}" == "--json" && $# == 2 ]]; then
      status_json
    elif (( $# == 1 )); then
      status_plain
    else
      usage
      exit 64
    fi
    ;;
  acquire)
    LANE="${2:-}"
    valid_lane "$LANE" || {
      usage
      exit 64
    }
    emit_event "legacy_acquire_refused" "use-supervised-run"
    print -r -- "transition-required:${LANE}:standalone acquire is disabled; use supervised 'run'" >&2
    exit 78
    ;;
  run)
    trap run_exit_cleanup EXIT
    trap run_exit_cleanup ZERR
    trap 'forward_signal HUP 129' HUP
    trap 'forward_signal INT 130' INT
    trap 'forward_signal TERM 143' TERM
    run_action "$@"
    ;;
  release)
    trap release_exit_cleanup EXIT
    trap release_exit_cleanup ZERR
    release_action "$@"
    ;;
  reap-stale)
    trap release_exit_cleanup EXIT
    trap release_exit_cleanup ZERR
    reap_action "$@"
    ;;
  *)
    usage
    exit 64
    ;;
esac
