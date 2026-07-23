#!/bin/zsh
set -euo pipefail

ACTION="${1:-status}"
SERVER_URL="https://softmax.com/api"
COWORLD_VERSION="0.1.28"
POLICY_NAME="mickey-mouse-intent"
SCRIPT_DIR="${0:A:h}"
REPO="${PROXYWAR_MICKEY_REPO:-${SCRIPT_DIR:h}}"
STATE_ROOT="${PROXYWAR_OPERATOR_STATE_ROOT:-/Users/olifreuler/.stormforge/proxywar-operators}"
LOCK_DIR="$STATE_ROOT/mickey.mutation.lock"
RUNNER="${PROXYWAR_RUNNER_LEASE_SCRIPT:-$REPO/scripts/proxywar-runner-lease.sh}"
VALIDATOR="${PROXYWAR_MICKEY_GATE_VALIDATOR:-$REPO/scripts/validate-mickey-mutation-gate.mjs}"
JQ_BIN="${PROXYWAR_JQ_BIN:-jq}"
DOCKER_BIN="${PROXYWAR_DOCKER_BIN:-docker}"
NODE_BIN="${PROXYWAR_NODE_BIN:-node}"
SIGNAL_GRACE_SECONDS="${PROXYWAR_MUTATION_SIGNAL_GRACE_SECONDS:-5}"
LOOKUP_ATTEMPTS="${PROXYWAR_POLICY_LOOKUP_ATTEMPTS:-15}"
OPERATOR_HOME="${HOME:-}"
PRIMARY_HOME="${PROXYWAR_PRIMARY_HOME:-$OPERATOR_HOME}"
MICKEY_HOME="${PROXYWAR_MICKEY_HOME:-}"
EXPECTED_CREDENTIAL_SHA256="${PROXYWAR_MICKEY_CREDENTIAL_SHA256:-}"
EXPECTED_PLAYER_ID="${PROXYWAR_MICKEY_EXPECTED_PLAYER_ID:-}"
EXPECTED_LEAGUE_ID="${PROXYWAR_MICKEY_EXPECTED_LEAGUE_ID:-}"

typeset -a COWORLD_PREFIX COMMAND COWORLD_ENV
if [[ -n "${PROXYWAR_COWORLD_BIN:-}" ]]; then
  COWORLD_PREFIX=("$PROXYWAR_COWORLD_BIN")
else
  COWORLD_PREFIX=(uvx --from "coworld==$COWORLD_VERSION" coworld)
fi

LOCK_HELD=0
TOKEN=""
STARTED_AT=""
MODE=""
GATE=""
GATE_SNAPSHOT=""
GATE_SHA256=""
RECEIPT=""
RECEIPT_WRITTEN=0
FINAL_STATUS="blocked"
FINAL_REASON="wrapper exited before command completion"
COMMAND_EXIT_JSON="null"
COMMAND_SHA256=""
COMMAND_STDOUT=""
COMMAND_STDERR=""
ACTIVE_PLAYER_ID=""
CANDIDATE_COMMIT=""
CANDIDATE_PARENT_COMMIT=""
CANDIDATE_IMAGE_ID=""
CANDIDATE_POLICY_REF=""
CANDIDATE_ENTRYPOINT=""
UPLOADED_LABEL=""
POLICY_VERSION_ID=""
CHILD_PID=""
CHILD_STARTED=""
CHILD_PGID=""
REQUESTED_EXIT=0
EXTERNAL_OUTCOME_UNKNOWN=false
IDENTITY_REASON=""
IDENTITY_STATE="unconfigured"
CREDENTIAL_ISOLATED=false
EXCLUSIVE_PLAYER_ROSTER=false

usage() {
  cat >&2 <<'EOF'
usage:
  proxywar-mickey-mutation.sh status [--json]
  proxywar-mickey-mutation.sh run upload|submit ABS_GATE ABS_RECEIPT
  proxywar-mickey-mutation.sh reap-stale TOKEN

Mutation commands require all of:
  PROXYWAR_MICKEY_HOME                  dedicated absolute HOME
  PROXYWAR_MICKEY_CREDENTIAL_SHA256     exact dedicated credential hash
  PROXYWAR_MICKEY_EXPECTED_PLAYER_ID    exact ply_ UUID for Mickey
  PROXYWAR_MICKEY_EXPECTED_LEAGUE_ID    exact league_ UUID

The dedicated account must expose exactly one player: the expected active
Mickey identity. The wrapper constructs the complete Coworld command from an
immutable gate; callers cannot supply Coworld arguments. Upload requires the
local and pre-upload RCI gates. Submit additionally requires bound diagnostic,
hosted 4/4, regression 20/20, and final RCI evidence.
EOF
}

normalized_process_start() {
  local pid="$1"
  [[ "$pid" == <-> ]] || return 1
  ps -p "$pid" -o lstart= 2>/dev/null | awk '{$1=$1; print}'
}

pid_matches() {
  local pid="$1"
  local expected="$2"
  local actual
  [[ "$pid" == <-> && -n "$expected" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  actual="$(normalized_process_start "$pid")" || return 1
  [[ "$actual" == "$expected" ]]
}

process_group_alive() {
  local pgid="$1"
  [[ "$pgid" == <-> && "$pgid" -gt 1 ]] || return 1
  kill -0 -- "-$pgid" 2>/dev/null
}

new_token() {
  openssl rand -hex 24
}

read_lock() {
  cat "$LOCK_DIR/$1" 2>/dev/null || true
}

file_sha_or_empty() {
  local target="$1"
  [[ -f "$target" ]] || return 0
  shasum -a 256 "$target" | awk '{print $1}'
}

file_owner_uid() {
  local target="$1"
  stat -f '%u' "$target" 2>/dev/null || stat -c '%u' "$target" 2>/dev/null
}

file_mode() {
  local target="$1"
  stat -f '%Lp' "$target" 2>/dev/null || stat -c '%a' "$target" 2>/dev/null
}

safe_private_path() {
  local target="$1"
  local owner mode
  [[ -e "$target" && ! -L "$target" ]] || return 1
  owner="$(file_owner_uid "$target")" || return 1
  mode="$(file_mode "$target")" || return 1
  [[ "$owner" == "$(id -u)" && "$mode" == <-> ]] || return 1
  (( (8#$mode & 8#077) == 0 ))
}

build_coworld_env() {
  COWORLD_ENV=(/usr/bin/env -i
    "HOME=$MICKEY_HOME"
    "PATH=${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
    "TMPDIR=${TMPDIR:-/tmp}"
    "LANG=${LANG:-C.UTF-8}"
  )
}

coworld_read() {
  build_coworld_env
  "${COWORLD_ENV[@]}" "${COWORLD_PREFIX[@]}" "$@"
}

validate_local_identity_configuration() {
  IDENTITY_STATE="unconfigured"
  IDENTITY_REASON="Mickey identity configuration is incomplete"
  CREDENTIAL_ISOLATED=false
  [[ "$EXPECTED_PLAYER_ID" =~ '^ply_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ]] ||
    return 1
  [[ "$EXPECTED_LEAGUE_ID" =~ '^league_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ]] ||
    return 1
  [[ "$EXPECTED_CREDENTIAL_SHA256" =~ '^[0-9a-f]{64}$' ]] || return 1
  [[ "$MICKEY_HOME" == /* && -d "$MICKEY_HOME" && ! -L "$MICKEY_HOME" ]] || {
    IDENTITY_STATE="credential_absent"
    IDENTITY_REASON="dedicated Mickey HOME is absent or unsafe"
    return 1
  }
  [[ -d "$MICKEY_HOME/.softmax" && ! -L "$MICKEY_HOME/.softmax" ]] || {
    IDENTITY_STATE="credential_absent"
    IDENTITY_REASON="dedicated Mickey credential directory is absent or unsafe"
    return 1
  }
  local credential="$MICKEY_HOME/.softmax/credentials.yaml"
  [[ -f "$credential" && ! -L "$credential" ]] || {
    IDENTITY_STATE="credential_absent"
    IDENTITY_REASON="dedicated Mickey credential is absent"
    return 1
  }
  safe_private_path "$MICKEY_HOME" &&
    safe_private_path "$MICKEY_HOME/.softmax" &&
    safe_private_path "$credential" || {
      IDENTITY_STATE="credential_unsafe"
      IDENTITY_REASON="dedicated Mickey HOME or credential permissions are unsafe"
      return 1
    }
  local resolved_mickey="${MICKEY_HOME:A}"
  local resolved_primary=""
  if [[ -n "$PRIMARY_HOME" && -d "$PRIMARY_HOME" ]]; then
    resolved_primary="${PRIMARY_HOME:A}"
  fi
  [[ -z "$resolved_primary" || "$resolved_mickey" != "$resolved_primary" ]] || {
    IDENTITY_STATE="same_account"
    IDENTITY_REASON="dedicated Mickey HOME is the primary account HOME"
    return 1
  }
  local actual_sha
  actual_sha="$(shasum -a 256 "$credential" | awk '{print $1}')" || return 1
  [[ "$actual_sha" == "$EXPECTED_CREDENTIAL_SHA256" ]] || {
    IDENTITY_STATE="credential_mismatch"
    IDENTITY_REASON="dedicated Mickey credential hash does not match the pinned identity"
    return 1
  }
  if [[ -n "$resolved_primary" ]]; then
    local primary_credential="$resolved_primary/.softmax/credentials.yaml"
    if [[ -f "$primary_credential" && ! -L "$primary_credential" ]]; then
      local primary_sha
      primary_sha="$(shasum -a 256 "$primary_credential" | awk '{print $1}')" || return 1
      [[ "$actual_sha" != "$primary_sha" ]] || {
        IDENTITY_STATE="same_account"
        IDENTITY_REASON="dedicated Mickey credential matches the primary account credential"
        return 1
      }
    fi
  fi
  IDENTITY_STATE="configured"
  IDENTITY_REASON=""
  CREDENTIAL_ISOLATED=true
  return 0
}

verify_player_identity() {
  ACTIVE_PLAYER_ID=""
  EXCLUSIVE_PLAYER_ROSTER=false
  validate_local_identity_configuration || return 1
  local rows total expected_count active_count active_id
  rows="$(coworld_read player list --server "$SERVER_URL" --json 2>/dev/null)" || {
    IDENTITY_STATE="query_failed"
    IDENTITY_REASON="dedicated Mickey player query failed"
    return 1
  }
  print -r -- "$rows" | "$JQ_BIN" -e 'type == "array"' >/dev/null 2>&1 || {
    IDENTITY_STATE="query_failed"
    IDENTITY_REASON="dedicated Mickey player query did not return an array"
    return 1
  }
  total="$(print -r -- "$rows" | "$JQ_BIN" -r 'length')" || return 1
  expected_count="$(print -r -- "$rows" | "$JQ_BIN" -r --arg id "$EXPECTED_PLAYER_ID" \
    '[.[] | select(.id == $id)] | length')" || return 1
  active_count="$(print -r -- "$rows" | "$JQ_BIN" -r \
    '[.[] | select(.active == true)] | length')" || return 1
  active_id="$(print -r -- "$rows" | "$JQ_BIN" -r \
    '[.[] | select(.active == true)] | if length == 1 then .[0].id // "" else "" end')" ||
    return 1
  if (( total != 1 )); then
    IDENTITY_STATE="same_account"
    IDENTITY_REASON="dedicated credential exposes a non-exclusive player roster; same-account reuse is blocked"
    return 1
  fi
  if (( expected_count == 0 )); then
    IDENTITY_STATE="player_absent"
    IDENTITY_REASON="expected Mickey player is absent from the dedicated account"
    return 1
  fi
  if (( expected_count != 1 || active_count != 1 )) || [[ "$active_id" != "$EXPECTED_PLAYER_ID" ]]; then
    IDENTITY_STATE="player_mismatch"
    IDENTITY_REASON="active player does not match the exact expected Mickey player ID"
    return 1
  fi
  ACTIVE_PLAYER_ID="$active_id"
  IDENTITY_STATE="verified"
  IDENTITY_REASON=""
  EXCLUSIVE_PLAYER_ROSTER=true
  return 0
}

lock_status_fields() {
  local state owner mode pid alive
  if [[ ! -e "$LOCK_DIR" && ! -L "$LOCK_DIR" ]]; then
    print -r -- 'free||null|null'
    return
  fi
  if [[ ! -d "$LOCK_DIR" || -L "$LOCK_DIR" ]]; then
    print -r -- 'corrupt|mickey|null|false'
    return
  fi
  pid="$(read_lock pid)"
  mode="$(read_lock mode)"
  if pid_matches "$pid" "$(read_lock started_at)"; then
    alive="true"
    [[ -e "$LOCK_DIR/ready" ]] && state="active" || state="initializing"
  else
    alive="false"
    state="stale"
  fi
  print -r -- "$state|mickey|${mode:-null}|$alive|${pid:-null}"
}

status_json() {
  local lock_fields lock_state lock_owner lock_mode lock_alive lock_pid
  lock_fields="$(lock_status_fields)"
  IFS='|' read -r lock_state lock_owner lock_mode lock_alive lock_pid <<< "$lock_fields"
  verify_player_identity >/dev/null 2>&1 || true
  "$JQ_BIN" -cn \
    --arg state "$lock_state" \
    --arg owner "$lock_owner" \
    --arg mode "$lock_mode" \
    --arg alive "$lock_alive" \
    --arg pid "${lock_pid:-null}" \
    --arg identity_state "$IDENTITY_STATE" \
    --arg identity_reason "$IDENTITY_REASON" \
    --arg expected_player_id "$EXPECTED_PLAYER_ID" \
    --arg active_player_id "$ACTIVE_PLAYER_ID" \
    --arg expected_league_id "$EXPECTED_LEAGUE_ID" \
    --argjson dedicated_home_configured "$([[ -n "$MICKEY_HOME" ]] && print true || print false)" \
    '{schema_version:1,lane:"mickey",state:$state,
      owner:($owner | select(length>0 and . != "null") // null),
      mode:($mode | select(length>0 and . != "null") // null),
      pid:($pid | select(length>0 and . != "null") // null),
      alive:(if $alive == "true" then true elif $alive == "false" then false else null end),
      identity:{state:$identity_state,
        reason:($identity_reason | select(length>0) // null),
        dedicated_home_configured:$dedicated_home_configured,
        expected_player_id:($expected_player_id | select(length>0) // null),
        active_player_id:($active_player_id | select(length>0) // null),
        expected_league_id:($expected_league_id | select(length>0) // null)}}'
}

acquire_lock() {
  mkdir -p "$STATE_ROOT"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    print -r -- "Mickey mutation lock unavailable:$(status_json)" >&2
    return 1
  fi
  LOCK_HELD=1
  TOKEN="$(new_token)"
  STARTED_AT="$(normalized_process_start "$$")" || true
  [[ -n "$STARTED_AT" ]] || return 70
  chmod 700 "$LOCK_DIR"
  printf '%s\n' "$TOKEN" > "$LOCK_DIR/token"
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  printf '%s\n' "$STARTED_AT" > "$LOCK_DIR/started_at"
  printf '%s\n' "$MODE" > "$LOCK_DIR/mode"
  printf '%s\n' "$GATE" > "$LOCK_DIR/gate_path"
  printf '%s\n' "$RECEIPT" > "$LOCK_DIR/receipt_path"
  printf '%s\n' "$EXPECTED_PLAYER_ID" > "$LOCK_DIR/expected_player_id"
  printf '%s\n' "$EXPECTED_LEAGUE_ID" > "$LOCK_DIR/expected_league_id"
  cp "$GATE" "$LOCK_DIR/gate.json"
  GATE_SNAPSHOT="$LOCK_DIR/gate.json"
  GATE_SHA256="$(file_sha_or_empty "$GATE_SNAPSHOT")"
  printf '%s\n' "$GATE_SHA256" > "$LOCK_DIR/gate_sha256"
  chmod 600 "$LOCK_DIR"/*
  : > "$LOCK_DIR/ready"
  chmod 600 "$LOCK_DIR/ready"
}

release_lock() {
  (( LOCK_HELD == 1 )) || return 0
  [[ "$(read_lock token)" == "$TOKEN" ]] || {
    print -r -- "Mickey mutation token changed; preserving lock" >&2
    return 75
  }
  local retired="${LOCK_DIR}.released.$$.$RANDOM"
  mv "$LOCK_DIR" "$retired" || return 75
  rm -rf "$retired"
  LOCK_HELD=0
}

write_receipt() {
  (( RECEIPT_WRITTEN == 0 )) || return 0
  [[ -n "$RECEIPT" ]] || return 1
  local parent temp stdout_sha stderr_sha
  parent="${RECEIPT:h}"
  [[ -d "$parent" && ! -L "$parent" ]] || return 1
  stdout_sha="$(file_sha_or_empty "$COMMAND_STDOUT")"
  stderr_sha="$(file_sha_or_empty "$COMMAND_STDERR")"
  temp="$(mktemp "$parent/.mickey-mutation-receipt.XXXXXX")" || return 1
  "$JQ_BIN" -cn \
    --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg mode "$MODE" \
    --arg status "$FINAL_STATUS" \
    --arg reason "$FINAL_REASON" \
    --arg player_id "$ACTIVE_PLAYER_ID" \
    --arg expected_player_id "$EXPECTED_PLAYER_ID" \
    --arg league_id "$EXPECTED_LEAGUE_ID" \
    --arg gate "$GATE" \
    --arg gate_sha256 "$GATE_SHA256" \
    --arg command_sha256 "$COMMAND_SHA256" \
    --arg stdout_sha256 "$stdout_sha" \
    --arg stderr_sha256 "$stderr_sha" \
    --arg candidate_source_commit "$CANDIDATE_COMMIT" \
    --arg candidate_parent_commit "$CANDIDATE_PARENT_COMMIT" \
    --arg candidate_image_id "$CANDIDATE_IMAGE_ID" \
    --arg candidate_policy_ref "$CANDIDATE_POLICY_REF" \
    --arg uploaded_label "$UPLOADED_LABEL" \
    --arg policy_version_id "$POLICY_VERSION_ID" \
    --argjson credential_isolated "$CREDENTIAL_ISOLATED" \
    --argjson exclusive_player_roster "$EXCLUSIVE_PLAYER_ROSTER" \
    --argjson command_exit "$COMMAND_EXIT_JSON" \
    --argjson external_outcome_unknown "$EXTERNAL_OUTCOME_UNKNOWN" \
    '{schema_version:1,recorded_at:$recorded_at,lane:"mickey",mode:$mode,
      status:$status,reason:$reason,
      active_player_id:($player_id | select(length>0) // null),
      expected_player_id:($expected_player_id | select(length>0) // null),
      league_id:($league_id | select(length>0) // null),
      credential_isolated:$credential_isolated,
      exclusive_player_roster:$exclusive_player_roster,
      gate_path:$gate,gate_snapshot_sha256:$gate_sha256,
      command_sha256:($command_sha256 | select(length>0) // null),
      command_stdout_sha256:($stdout_sha256 | select(length>0) // null),
      command_stderr_sha256:($stderr_sha256 | select(length>0) // null),
      command_exit:$command_exit,external_outcome_unknown:$external_outcome_unknown,
      candidate_source_commit:($candidate_source_commit | select(length>0) // null),
      candidate_parent_commit:($candidate_parent_commit | select(length>0) // null),
      candidate_image_id:($candidate_image_id | select(length>0) // null),
      candidate_policy_ref:($candidate_policy_ref | select(length>0) // null),
      uploaded_label:($uploaded_label | select(length>0) // null),
      policy_version_id:($policy_version_id | select(length>0) // null)}' > "$temp" || {
        rm -f "$temp"
        return 1
      }
  chmod 600 "$temp"
  mv "$temp" "$RECEIPT"
  RECEIPT_WRITTEN=1
}

terminate_child() {
  [[ -n "$CHILD_PID" ]] || return 0
  if pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
    [[ "$CHILD_PGID" == "$CHILD_PID" ]] || return 75
    kill -TERM -- "-$CHILD_PGID" 2>/dev/null || true
    local deadline=$(( $(date +%s) + SIGNAL_GRACE_SECONDS ))
    while pid_matches "$CHILD_PID" "$CHILD_STARTED" && (( $(date +%s) < deadline )); do
      sleep 0.05
    done
    if pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
      kill -KILL -- "-$CHILD_PGID" 2>/dev/null || true
    fi
  elif process_group_alive "$CHILD_PGID"; then
    print -r -- "child group identity is uncertain; preserving Mickey mutation lock" >&2
    return 75
  fi
}

cleanup() {
  local original_status="${1:-$?}"
  local cleanup_status=0
  trap - EXIT HUP INT TERM
  if (( LOCK_HELD == 1 )); then
    terminate_child || cleanup_status=$?
    if (( cleanup_status == 0 )) && ! write_receipt; then
      print -r -- "receipt write failed; preserving Mickey mutation lock" >&2
      cleanup_status=75
    fi
    if (( cleanup_status == 0 )); then
      release_lock || cleanup_status=$?
    fi
  fi
  (( cleanup_status == 0 )) || exit "$cleanup_status"
  exit "$original_status"
}

block() {
  FINAL_STATUS="blocked"
  FINAL_REASON="$1"
  print -r -- "$1" >&2
  cleanup "${2:-78}"
}

forward_signal() {
  local signal_name="$1"
  local exit_code="$2"
  REQUESTED_EXIT="$exit_code"
  if [[ -n "$CHILD_PID" && "$CHILD_PGID" == "$CHILD_PID" ]] &&
    pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
    kill "-$signal_name" -- "-$CHILD_PGID" 2>/dev/null || true
  fi
}

policy_lookup() {
  local label="$1"
  build_coworld_env
  if [[ -n "${PROXYWAR_POLICY_LOOKUP_BIN:-}" ]]; then
    "${COWORLD_ENV[@]}" "$PROXYWAR_POLICY_LOOKUP_BIN" "$label"
    return
  fi
  "${COWORLD_ENV[@]}" uvx --from "coworld==$COWORLD_VERSION" python -c '
import json, sys
from coworld.api_client import CoworldApiClient
label = sys.argv[1]
name, version_text = label.rsplit(":v", 1)
with CoworldApiClient.from_login(server_url="https://softmax.com/api") as client:
    row = client.lookup_policy_version(name=name, version=int(version_text))
if row is None:
    raise SystemExit(1)
print(json.dumps({"label": f"{row.resolved_name}:v{row.version}",
                  "policy_version_id": str(row.resolved_id)}))
' "$label"
}

verified_policy_lookup() {
  local label="$1"
  local expected_id="${2:-}"
  local attempt rows found_label found_id
  for (( attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt++ )); do
    rows="$(policy_lookup "$label" 2>/dev/null)" || rows=""
    found_label="$(print -r -- "$rows" | "$JQ_BIN" -r '.label // empty' 2>/dev/null)" ||
      found_label=""
    found_id="$(print -r -- "$rows" | "$JQ_BIN" -r '.policy_version_id // empty' 2>/dev/null)" ||
      found_id=""
    if [[ "$found_label" == "$label" &&
      "$found_id" =~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ]]; then
      [[ -z "$expected_id" || "$found_id" == "$expected_id" ]] || return 1
      print -r -- "$found_id"
      return 0
    fi
    (( attempt < LOOKUP_ATTEMPTS )) && sleep 2
  done
  return 1
}

start_supervised_command() {
  COMMAND_STDOUT="$LOCK_DIR/command.stdout"
  COMMAND_STDERR="$LOCK_DIR/command.stderr"
  local ready="$LOCK_DIR/child_ready"
  local go="$LOCK_DIR/child_go"
  /usr/bin/perl -MPOSIX -e '
    my ($ready, $go, @command) = @ARGV;
    POSIX::setpgid(0, 0);
    open my $fh, ">", $ready or die "ready: $!";
    close $fh;
    select undef, undef, undef, 0.01 until -e $go;
    exec @command or die "exec failed: $!";
  ' "$ready" "$go" "${COMMAND[@]}" >"$COMMAND_STDOUT" 2>"$COMMAND_STDERR" &
  CHILD_PID="$!"
  CHILD_PGID="$CHILD_PID"
  local deadline=$(( $(date +%s) + 5 ))
  while [[ ! -e "$ready" ]] && (( $(date +%s) < deadline )); do sleep 0.01; done
  [[ -e "$ready" ]] || block "mutation child did not initialize" 75
  CHILD_STARTED="$(normalized_process_start "$CHILD_PID")" || true
  [[ -n "$CHILD_STARTED" ]] || block "mutation child identity could not be pinned" 75
  printf '%s\n' "$CHILD_PID" > "$LOCK_DIR/child_pid"
  printf '%s\n' "$CHILD_STARTED" > "$LOCK_DIR/child_started_at"
  printf '%s\n' "$CHILD_PGID" > "$LOCK_DIR/child_pgid"
  chmod 600 "$LOCK_DIR/child_pid" "$LOCK_DIR/child_started_at" "$LOCK_DIR/child_pgid"
  : > "$go"
  chmod 600 "$go"
  local child_status=0
  if wait "$CHILD_PID"; then child_status=0; else child_status=$?; fi
  while pid_matches "$CHILD_PID" "$CHILD_STARTED"; do
    if wait "$CHILD_PID"; then child_status=0; else child_status=$?; fi
  done
  (( REQUESTED_EXIT == 0 )) || child_status="$REQUESTED_EXIT"
  COMMAND_EXIT_JSON="$child_status"
  [[ -f "$COMMAND_STDOUT" ]] && cat "$COMMAND_STDOUT"
  [[ -f "$COMMAND_STDERR" ]] && cat "$COMMAND_STDERR" >&2
  return "$child_status"
}

load_candidate_identity() {
  CANDIDATE_COMMIT="$("$JQ_BIN" -r '.candidate.source_commit // empty' "$GATE_SNAPSHOT")"
  CANDIDATE_PARENT_COMMIT="$("$JQ_BIN" -r '.candidate.parent_commit // empty' "$GATE_SNAPSHOT")"
  CANDIDATE_IMAGE_ID="$("$JQ_BIN" -r '.candidate.image_id // empty' "$GATE_SNAPSHOT")"
  CANDIDATE_POLICY_REF="$("$JQ_BIN" -r '.candidate.policy_ref // empty' "$GATE_SNAPSHOT")"
  CANDIDATE_ENTRYPOINT="$("$JQ_BIN" -r '.candidate.entrypoint // empty' "$GATE_SNAPSHOT")"
  [[ ${#CANDIDATE_COMMIT} == 40 && "$CANDIDATE_COMMIT" != *[^0-9a-f]* ]] ||
    block "candidate source commit is not pinned"
  [[ ${#CANDIDATE_PARENT_COMMIT} == 40 &&
    "$CANDIDATE_PARENT_COMMIT" != *[^0-9a-f]* ]] ||
    block "candidate parent commit is not pinned"
  [[ "$CANDIDATE_IMAGE_ID" =~ '^sha256:[0-9a-f]{64}$' &&
    -n "$CANDIDATE_POLICY_REF" && "$CANDIDATE_ENTRYPOINT" == "/app/llm-player.mjs" ]] ||
    block "candidate runtime identity is not pinned"
  git -C "$REPO" cat-file -e "$CANDIDATE_COMMIT^{commit}" 2>/dev/null ||
    block "candidate source commit is unavailable"
  git -C "$REPO" branch -r --contains "$CANDIDATE_COMMIT" | grep -q '[^[:space:]]' ||
    block "candidate source commit is not pushed"
  git -C "$REPO" cat-file -e "$CANDIDATE_PARENT_COMMIT^{commit}" 2>/dev/null ||
    block "candidate parent commit is unavailable"
  git -C "$REPO" branch -r --contains "$CANDIDATE_PARENT_COMMIT" | grep -q '[^[:space:]]' ||
    block "candidate parent commit is not pushed"
}

run_action() {
  (( $# == 4 )) || { usage; return 64; }
  MODE="$2"
  GATE="$3"
  RECEIPT="$4"
  [[ "$MODE" == "upload" || "$MODE" == "submit" ]] || { usage; return 64; }
  [[ "$GATE" == /* && -f "$GATE" && ! -L "$GATE" ]] || {
    print -r -- "ABS_GATE must be an existing absolute regular file" >&2
    return 64
  }
  [[ "$RECEIPT" == /* && ! -e "$RECEIPT" && -d "${RECEIPT:h}" && ! -L "${RECEIPT:h}" ]] || {
    print -r -- "ABS_RECEIPT must be a new absolute file in an existing directory" >&2
    return 64
  }
  acquire_lock || block "Mickey mutation lock is not free" 75
  validate_local_identity_configuration || block "$IDENTITY_REASON"

  local runner_state gate_player gate_league
  runner_state="$("$RUNNER" status --json)" || block "runner status failed" 75
  print -r -- "$runner_state" | "$JQ_BIN" -e '.state == "free"' >/dev/null ||
    block "runner is not free"
  verify_player_identity || block "$IDENTITY_REASON"
  printf '%s\n' "$ACTIVE_PLAYER_ID" > "$LOCK_DIR/active_player_id"
  chmod 600 "$LOCK_DIR/active_player_id"

  gate_player="$("$JQ_BIN" -r '.expected_player_id // empty' "$GATE_SNAPSHOT")"
  gate_league="$("$JQ_BIN" -r '.expected_league_id // empty' "$GATE_SNAPSHOT")"
  [[ "$gate_player" == "$EXPECTED_PLAYER_ID" ]] ||
    block "gate player ID does not match the exact expected Mickey identity"
  [[ "$gate_league" == "$EXPECTED_LEAGUE_ID" ]] ||
    block "gate league ID does not match the exact expected league"
  "$NODE_BIN" "$VALIDATOR" "$GATE_SNAPSHOT" "--require-$MODE" >/dev/null ||
    block "$MODE gate validation failed"
  load_candidate_identity
  build_coworld_env

  if [[ "$MODE" == "upload" ]]; then
    local resolved_image_id
    resolved_image_id="$("$DOCKER_BIN" image inspect "$CANDIDATE_POLICY_REF" \
      --format '{{.Id}}' 2>/dev/null)" || block "candidate image cannot be inspected"
    [[ "$resolved_image_id" == "$CANDIDATE_IMAGE_ID" ]] ||
      block "candidate image ID does not match the gate"
    COMMAND=("${COWORLD_ENV[@]}" "${COWORLD_PREFIX[@]}"
      upload-policy "$CANDIDATE_POLICY_REF"
      --name "$POLICY_NAME"
      --use-bedrock
      --run node
      --run "$CANDIDATE_ENTRYPOINT"
      --tag "source_commit=$CANDIDATE_COMMIT"
      --tag "image_id=${CANDIDATE_IMAGE_ID#sha256:}"
      --server "$SERVER_URL")
  else
    UPLOADED_LABEL="$("$JQ_BIN" -r '.candidate.uploaded_label // empty' "$GATE_SNAPSHOT")"
    POLICY_VERSION_ID="$("$JQ_BIN" -r '.candidate.policy_version_id // empty' "$GATE_SNAPSHOT")"
    [[ "$UPLOADED_LABEL" =~ '^mickey-mouse-intent:v[1-9][0-9]*$' ]] ||
      block "submit label is not pinned to mickey-mouse-intent:vN"
    local looked_up_id
    looked_up_id="$(verified_policy_lookup "$UPLOADED_LABEL" "$POLICY_VERSION_ID")" ||
      block "live policy-version identity does not match the submit gate"
    [[ "$looked_up_id" == "$POLICY_VERSION_ID" ]] ||
      block "live policy-version identity does not match the submit gate"
    COMMAND=("${COWORLD_ENV[@]}" "${COWORLD_PREFIX[@]}"
      submit "$UPLOADED_LABEL"
      --league "$EXPECTED_LEAGUE_ID"
      --no-open-browser
      --auto-champion always
      --server "$SERVER_URL")
  fi

  # Re-read both the credential bytes and the account roster immediately before
  # launching the externally mutating command. Any drift closes the gate.
  verify_player_identity || block "$IDENTITY_REASON"
  printf '%s\n' "$CREDENTIAL_ISOLATED" > "$LOCK_DIR/credential_isolated"
  printf '%s\n' "$EXCLUSIVE_PLAYER_ROSTER" > "$LOCK_DIR/exclusive_player_roster"
  chmod 600 "$LOCK_DIR/credential_isolated" "$LOCK_DIR/exclusive_player_roster"
  COMMAND_SHA256="$(printf '%s\0' "${COMMAND[@]}" | shasum -a 256 | awk '{print $1}')"
  printf '%s\n' "$COMMAND_SHA256" > "$LOCK_DIR/command_sha256"
  printf '%s\n' "$CANDIDATE_COMMIT" > "$LOCK_DIR/candidate_source_commit"
  printf '%s\n' "$CANDIDATE_PARENT_COMMIT" > "$LOCK_DIR/candidate_parent_commit"
  printf '%s\n' "$CANDIDATE_IMAGE_ID" > "$LOCK_DIR/candidate_image_id"
  printf '%s\n' "$CANDIDATE_POLICY_REF" > "$LOCK_DIR/candidate_policy_ref"
  chmod 600 "$LOCK_DIR/command_sha256" "$LOCK_DIR"/candidate_*

  local command_status=0
  if start_supervised_command; then command_status=0; else command_status=$?; fi
  if (( command_status != 0 )); then
    EXTERNAL_OUTCOME_UNKNOWN=true
    FINAL_STATUS="failed"
    FINAL_REASON="$MODE command exited nonzero; reconcile the external outcome before retry"
    return "$command_status"
  fi
  if [[ "$MODE" == "upload" ]]; then
    UPLOADED_LABEL="$(grep -Eo 'mickey-mouse-intent:v[1-9][0-9]*' "$COMMAND_STDOUT" | tail -1)" ||
      UPLOADED_LABEL=""
    if [[ ! "$UPLOADED_LABEL" =~ '^mickey-mouse-intent:v[1-9][0-9]*$' ]]; then
      EXTERNAL_OUTCOME_UNKNOWN=true
      block "upload completed but Mickey version label was not verified; reconcile before retry"
    fi
    if ! POLICY_VERSION_ID="$(verified_policy_lookup "$UPLOADED_LABEL")"; then
      EXTERNAL_OUTCOME_UNKNOWN=true
      block "upload completed but policy-version identity was not verified; reconcile before retry"
    fi
  fi
  FINAL_STATUS="completed"
  FINAL_REASON="$MODE command completed under verified isolated Mickey identity and immutable gate"
}

reap_stale_action() {
  (( $# == 2 )) || { usage; return 64; }
  [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || {
    print -r -- "no recoverable Mickey mutation lock" >&2
    return 1
  }
  TOKEN="$2"
  [[ -n "$TOKEN" && "$(read_lock token)" == "$TOKEN" ]] || {
    print -r -- "mutation token mismatch" >&2
    return 1
  }
  local pid="$(read_lock pid)"
  local started="$(read_lock started_at)"
  if pid_matches "$pid" "$started"; then
    print -r -- "active Mickey mutation:$pid" >&2
    return 1
  fi
  LOCK_HELD=1
  MODE="$(read_lock mode)"
  GATE="$(read_lock gate_path)"
  GATE_SNAPSHOT="$LOCK_DIR/gate.json"
  GATE_SHA256="$(read_lock gate_sha256)"
  RECEIPT="$(read_lock receipt_path)"
  EXPECTED_PLAYER_ID="$(read_lock expected_player_id)"
  EXPECTED_LEAGUE_ID="$(read_lock expected_league_id)"
  CREDENTIAL_ISOLATED="$(read_lock credential_isolated)"
  EXCLUSIVE_PLAYER_ROSTER="$(read_lock exclusive_player_roster)"
  [[ "$CREDENTIAL_ISOLATED" == "true" ]] || CREDENTIAL_ISOLATED=false
  [[ "$EXCLUSIVE_PLAYER_ROSTER" == "true" ]] || EXCLUSIVE_PLAYER_ROSTER=false
  COMMAND_SHA256="$(read_lock command_sha256)"
  ACTIVE_PLAYER_ID="$(read_lock active_player_id)"
  CANDIDATE_COMMIT="$(read_lock candidate_source_commit)"
  CANDIDATE_PARENT_COMMIT="$(read_lock candidate_parent_commit)"
  CANDIDATE_IMAGE_ID="$(read_lock candidate_image_id)"
  CANDIDATE_POLICY_REF="$(read_lock candidate_policy_ref)"
  COMMAND_STDOUT="$LOCK_DIR/command.stdout"
  COMMAND_STDERR="$LOCK_DIR/command.stderr"
  CHILD_PID="$(read_lock child_pid)"
  CHILD_STARTED="$(read_lock child_started_at)"
  CHILD_PGID="$(read_lock child_pgid)"
  EXTERNAL_OUTCOME_UNKNOWN=true
  FINAL_STATUS="recovered_stale"
  FINAL_REASON="stale wrapper reaped; reconcile external outcome before any retry"
  COMMAND_EXIT_JSON="null"
  terminate_child || return $?
  if [[ -e "$RECEIPT" ]]; then RECEIPT_WRITTEN=1; else write_receipt || return 75; fi
  release_lock || return $?
  print -r -- "reaped:mickey:external-outcome-unknown"
}

case "$ACTION" in
  status)
    if [[ "${2:-}" == "--json" && $# == 2 ]]; then
      status_json
    elif (( $# == 1 )); then
      status_json | "$JQ_BIN" -r '"\(.state):\(.identity.state)"'
    else
      usage
      exit 64
    fi
    ;;
  run)
    trap cleanup EXIT
    trap 'forward_signal HUP 129' HUP
    trap 'forward_signal INT 130' INT
    trap 'forward_signal TERM 143' TERM
    run_action "$@"
    ;;
  reap-stale)
    reap_stale_action "$@"
    ;;
  *)
    usage
    exit 64
    ;;
esac
