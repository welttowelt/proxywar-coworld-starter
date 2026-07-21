#!/bin/zsh
set -euo pipefail

ACTION="${1:-status}"
EXPECTED_PLAYER_ID="ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c"
EXPECTED_LEAGUE_ID="league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42"
EXPECTED_POLICY_NAME="qd1n"
SERVER_URL="https://softmax.com/api"
COWORLD_VERSION="0.1.28"
REPO="${PROXYWAR_QD1N_REPO:-/Users/olifreuler/proxywar-coworld-starter}"
STATE_ROOT="${PROXYWAR_OPERATOR_STATE_ROOT:-/Users/olifreuler/.stormforge/proxywar-operators}"
LOCK_DIR="$STATE_ROOT/qd1n.mutation.lock"
RUNNER="${PROXYWAR_RUNNER_LEASE_SCRIPT:-$REPO/scripts/proxywar-runner-lease.sh}"
VALIDATOR="${PROXYWAR_PREFLIGHT_VALIDATOR:-$REPO/scripts/validate-experiment-preflight.mjs}"
STANDARD_VALIDATOR="${PROXYWAR_STANDARD_REBUILD_VALIDATOR:-$REPO/scripts/validate-standard-rebuild.mjs}"
JQ_BIN="${PROXYWAR_JQ_BIN:-jq}"
DOCKER_BIN="${PROXYWAR_DOCKER_BIN:-docker}"
SIGNAL_GRACE_SECONDS="${PROXYWAR_MUTATION_SIGNAL_GRACE_SECONDS:-5}"
LOOKUP_ATTEMPTS="${PROXYWAR_POLICY_LOOKUP_ATTEMPTS:-15}"
CHAMPION_LOOKUP_ATTEMPTS="${PROXYWAR_CHAMPION_LOOKUP_ATTEMPTS:-30}"
CHAMPION_LOOKUP_INTERVAL_SECONDS="${PROXYWAR_CHAMPION_LOOKUP_INTERVAL_SECONDS:-2}"

typeset -a COWORLD_PREFIX COMMAND
if [[ -n "${PROXYWAR_COWORLD_BIN:-}" ]]; then
  COWORLD_PREFIX=("$PROXYWAR_COWORLD_BIN")
else
  COWORLD_PREFIX=(uvx --from "coworld==$COWORLD_VERSION" coworld)
fi

LOCK_HELD=0
TOKEN=""
STARTED_AT=""
MODE=""
PREFLIGHT=""
PREFLIGHT_SNAPSHOT=""
PREFLIGHT_SHA256=""
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
PREFLIGHT_PROFILE=""
UPLOADED_LABEL=""
POLICY_VERSION_ID=""
MEMBERSHIP_ID=""
CHAMPION_OBSERVED_COUNT=""
CHAMPION_OBSERVED_POLICY_VERSION_ID=""
CHAMPION_LOOKUP_SHA256=""
CHILD_PID=""
CHILD_STARTED=""
CHILD_PGID=""
REQUESTED_SIGNAL=""
REQUESTED_EXIT=0
EXTERNAL_OUTCOME_UNKNOWN=false
MUTATION_RETRY_PROHIBITED=false

usage() {
  cat >&2 <<'EOF'
usage:
  proxywar-qd1n-mutation.sh status [--json]
  proxywar-qd1n-mutation.sh run diagnostic|promotion PREFLIGHT ABS_RECEIPT
  proxywar-qd1n-mutation.sh reap-stale TOKEN

The wrapper constructs the complete Coworld command. Callers cannot supply
command arguments. Diagnostic mode uploads the exact image pinned by the
preflight. Promotion mode submits the exact qd1n:vN label and policy-version ID
bound by the diagnostic receipt and promotion evidence.

Preflights with profile=standard-rebuild use the separately validated emergency
four-game contract and omit Bedrock from the uploaded runtime. The normal
hosted 4/4 plus 20/20 profile remains unchanged.

After a killed wrapper, read the private token from the stale lock and use
reap-stale. Recovery terminates the exact recorded child group and writes an
explicit unknown-outcome receipt before releasing the lock.
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

status_json() {
  if [[ ! -e "$LOCK_DIR" && ! -L "$LOCK_DIR" ]]; then
    "$JQ_BIN" -cn '{state:"free",owner:null,mode:null,pid:null,alive:null}'
    return
  fi
  [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || {
    "$JQ_BIN" -cn '{state:"corrupt",owner:"qd1n",mode:null,pid:null,alive:null}'
    return
  }
  local pid started mode state alive
  pid="$(read_lock pid)"
  started="$(read_lock started_at)"
  mode="$(read_lock mode)"
  if pid_matches "$pid" "$started"; then
    alive="true"
    [[ -e "$LOCK_DIR/ready" ]] && state="active" || state="initializing"
  else
    alive="false"
    state="stale"
  fi
  "$JQ_BIN" -cn \
    --arg state "$state" \
    --arg mode "$mode" \
    --arg pid "$pid" \
    --argjson alive "$alive" \
    '{state:$state,owner:"qd1n",mode:($mode | select(length>0) // null),
      pid:($pid | select(length>0) // null),alive:$alive}'
}

acquire_lock() {
  mkdir -p "$STATE_ROOT"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local state
    state="$(status_json)"
    print -r -- "qd1n mutation lock unavailable:${state}" >&2
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
  printf '%s\n' "$PREFLIGHT" > "$LOCK_DIR/preflight_path"
  printf '%s\n' "$RECEIPT" > "$LOCK_DIR/receipt_path"
  cp "$PREFLIGHT" "$LOCK_DIR/preflight.json"
  PREFLIGHT_SNAPSHOT="$LOCK_DIR/preflight.json"
  PREFLIGHT_SHA256="$(shasum -a 256 "$PREFLIGHT_SNAPSHOT" | awk '{print $1}')"
  printf '%s\n' "$PREFLIGHT_SHA256" > "$LOCK_DIR/preflight_sha256"
  chmod 600 "$LOCK_DIR"/*
  : > "$LOCK_DIR/ready"
  chmod 600 "$LOCK_DIR/ready"
}

release_lock() {
  (( LOCK_HELD == 1 )) || return 0
  [[ "$(read_lock token)" == "$TOKEN" ]] || {
    print -r -- "qd1n mutation token changed; preserving lock" >&2
    return 75
  }
  local retired="${LOCK_DIR}.released.$$.$RANDOM"
  mv "$LOCK_DIR" "$retired" || return 75
  rm -rf "$retired"
  LOCK_HELD=0
}

file_sha_or_empty() {
  local target="$1"
  [[ -f "$target" ]] || return 0
  shasum -a 256 "$target" | awk '{print $1}'
}

write_receipt() {
  (( RECEIPT_WRITTEN == 0 )) || return 0
  [[ -n "$RECEIPT" ]] || return 1
  local parent temp stdout_sha stderr_sha
  parent="${RECEIPT:h}"
  [[ -d "$parent" && ! -L "$parent" ]] || return 1
  stdout_sha="$(file_sha_or_empty "$COMMAND_STDOUT")"
  stderr_sha="$(file_sha_or_empty "$COMMAND_STDERR")"
  temp="$(mktemp "$parent/.qd1n-mutation-receipt.XXXXXX")" || return 1
  "$JQ_BIN" -cn \
    --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg mode "$MODE" \
    --arg status "$FINAL_STATUS" \
    --arg reason "$FINAL_REASON" \
    --arg player_id "$ACTIVE_PLAYER_ID" \
    --arg league_id "$EXPECTED_LEAGUE_ID" \
    --arg preflight "$PREFLIGHT" \
    --arg preflight_sha256 "$PREFLIGHT_SHA256" \
    --arg command_sha256 "$COMMAND_SHA256" \
    --arg stdout_sha256 "$stdout_sha" \
    --arg stderr_sha256 "$stderr_sha" \
    --arg candidate_source_commit "$CANDIDATE_COMMIT" \
    --arg candidate_parent_commit "$CANDIDATE_PARENT_COMMIT" \
    --arg candidate_image_id "$CANDIDATE_IMAGE_ID" \
    --arg candidate_policy_ref "$CANDIDATE_POLICY_REF" \
    --arg preflight_profile "$PREFLIGHT_PROFILE" \
    --arg uploaded_label "$UPLOADED_LABEL" \
    --arg policy_version_id "$POLICY_VERSION_ID" \
    --arg membership_id "$MEMBERSHIP_ID" \
    --arg champion_observed_count "$CHAMPION_OBSERVED_COUNT" \
    --arg champion_observed_policy_version_id "$CHAMPION_OBSERVED_POLICY_VERSION_ID" \
    --arg champion_lookup_sha256 "$CHAMPION_LOOKUP_SHA256" \
    --argjson command_exit "$COMMAND_EXIT_JSON" \
    --argjson external_outcome_unknown "$EXTERNAL_OUTCOME_UNKNOWN" \
    --argjson mutation_retry_prohibited "$MUTATION_RETRY_PROHIBITED" \
    '{
      schema_version:2,
      recorded_at:$recorded_at,
      lane:"qd1n",
      mode:$mode,
      status:$status,
      reason:$reason,
      active_player_id:($player_id | select(length>0) // null),
      expected_player_id:"ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c",
      league_id:$league_id,
      preflight_path:$preflight,
      preflight_snapshot_sha256:$preflight_sha256,
      command_sha256:($command_sha256 | select(length>0) // null),
      command_stdout_sha256:($stdout_sha256 | select(length>0) // null),
      command_stderr_sha256:($stderr_sha256 | select(length>0) // null),
      command_exit:$command_exit,
      external_outcome_unknown:$external_outcome_unknown,
      mutation_retry_prohibited:$mutation_retry_prohibited,
      candidate_source_commit:($candidate_source_commit | select(length>0) // null),
      candidate_parent_commit:($candidate_parent_commit | select(length>0) // null),
      candidate_image_id:($candidate_image_id | select(length>0) // null),
      candidate_policy_ref:($candidate_policy_ref | select(length>0) // null),
      preflight_profile:($preflight_profile | select(length>0) // null),
      uploaded_label:($uploaded_label | select(length>0) // null),
      policy_version_id:($policy_version_id | select(length>0) // null),
      champion_membership_id:($membership_id | select(length>0) // null),
      champion_observed_count:(
        if ($champion_observed_count | length) > 0
        then ($champion_observed_count | tonumber)
        else null
        end
      ),
      champion_observed_policy_version_id:($champion_observed_policy_version_id | select(length>0) // null),
      champion_lookup_sha256:($champion_lookup_sha256 | select(length>0) // null)
    }' > "$temp" || {
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
    while pid_matches "$CHILD_PID" "$CHILD_STARTED" &&
      (( $(date +%s) < deadline )); do
      sleep 0.05
    done
    if pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
      kill -KILL -- "-$CHILD_PGID" 2>/dev/null || true
    fi
  elif process_group_alive "$CHILD_PGID"; then
    print -r -- "child group identity is uncertain; preserving mutation lock" >&2
    return 75
  fi
  return 0
}

cleanup() {
  local original_status="${1:-$?}"
  local cleanup_status=0
  trap - EXIT HUP INT TERM
  if (( LOCK_HELD == 1 )); then
    terminate_child || cleanup_status=$?
    if (( cleanup_status == 0 )) && ! write_receipt; then
      print -r -- "receipt write failed; preserving Qd1n mutation lock" >&2
      cleanup_status=75
    fi
    if (( cleanup_status == 0 )); then
      release_lock || cleanup_status=$?
    fi
  fi
  if (( cleanup_status != 0 )); then
    exit "$cleanup_status"
  fi
  exit "$original_status"
}

block() {
  FINAL_STATUS="blocked"
  FINAL_REASON="$1"
  print -r -- "$1" >&2
  cleanup "${2:-78}"
}

external_outcome_unknown() {
  EXTERNAL_OUTCOME_UNKNOWN=true
  MUTATION_RETRY_PROHIBITED=true
  FINAL_STATUS="external_outcome_unknown"
  FINAL_REASON="$1"
  print -r -- "$1; do not retry submission until live membership is reconciled" >&2
  cleanup "${2:-75}"
}

forward_signal() {
  local signal_name="$1"
  local exit_code="$2"
  REQUESTED_SIGNAL="$signal_name"
  REQUESTED_EXIT="$exit_code"
  if [[ -n "$CHILD_PID" && "$CHILD_PGID" == "$CHILD_PID" ]] &&
    pid_matches "$CHILD_PID" "$CHILD_STARTED"; then
    kill "-$signal_name" -- "-$CHILD_PGID" 2>/dev/null || true
  fi
}

policy_lookup() {
  local label="$1"
  if [[ -n "${PROXYWAR_POLICY_LOOKUP_BIN:-}" ]]; then
    "$PROXYWAR_POLICY_LOOKUP_BIN" "$label"
    return
  fi
  uvx --from "coworld==$COWORLD_VERSION" python -c '
import json, sys
from coworld.api_client import CoworldApiClient
label = sys.argv[1]
name, version_text = label.rsplit(":v", 1)
with CoworldApiClient.from_login(server_url="https://softmax.com/api") as client:
    row = client.lookup_policy_version(name=name, version=int(version_text))
if row is None:
    raise SystemExit(1)
print(json.dumps({
    "label": f"{row.resolved_name}:v{row.version}",
    "policy_version_id": str(row.resolved_id),
}))
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
      if [[ -z "$expected_id" || "$found_id" == "$expected_id" ]]; then
        print -r -- "$found_id"
        return 0
      fi
      return 1
    fi
    (( attempt < LOOKUP_ATTEMPTS )) && sleep 2
  done
  return 1
}

membership_lookup() {
  if [[ -n "${PROXYWAR_MEMBERSHIP_LOOKUP_BIN:-}" ]]; then
    "$PROXYWAR_MEMBERSHIP_LOOKUP_BIN" "$EXPECTED_LEAGUE_ID" "$EXPECTED_PLAYER_ID"
    return
  fi
  "${COWORLD_PREFIX[@]}" memberships \
    --league "$EXPECTED_LEAGUE_ID" \
    --json \
    --server "$SERVER_URL"
}

verify_live_champion_membership() {
  local expected_policy_version_id="$1"
  local attempt rows summary count membership_id observed_policy_id
  local observation="$LOCK_DIR/champion-memberships.json"
  for (( attempt = 1; attempt <= CHAMPION_LOOKUP_ATTEMPTS; attempt++ )); do
    rows="$(membership_lookup 2>/dev/null)" || rows=""
    if [[ -n "$rows" ]] && print -r -- "$rows" | "$JQ_BIN" -e . >/dev/null 2>&1; then
      printf '%s\n' "$rows" > "$observation"
      chmod 600 "$observation"
      CHAMPION_LOOKUP_SHA256="$(file_sha_or_empty "$observation")"
      summary="$(print -r -- "$rows" | "$JQ_BIN" -c \
        --arg player_id "$EXPECTED_PLAYER_ID" '
          def membership_rows:
            if type == "array" then .
            elif (.entries | type) == "array" then .entries
            elif (.memberships | type) == "array" then .memberships
            elif (.items | type) == "array" then .items
            else [] end;
          [membership_rows[] |
            select((.player.id // .player_id // "") == $player_id) |
            select(.is_champion == true) |
            select(((.status // "") | ascii_downcase) == "competing") |
            select(
              .active == true or
              (((.substatus // "") | ascii_downcase) == "active")
            ) |
            {
              membership_id:(.id // ""),
              policy_version_id:(.policy_version.id // .policy_version_id // "")
            }
          ] as $champions |
          {
            count:($champions | length),
            membership_id:(if ($champions | length) == 1 then $champions[0].membership_id else "" end),
            policy_version_id:(if ($champions | length) == 1 then $champions[0].policy_version_id else "" end)
          }
        ' 2>/dev/null)" || summary=""
      count="$(print -r -- "$summary" | "$JQ_BIN" -r '.count // empty' 2>/dev/null)" || count=""
      membership_id="$(print -r -- "$summary" | "$JQ_BIN" -r '.membership_id // empty' 2>/dev/null)" || membership_id=""
      observed_policy_id="$(print -r -- "$summary" | "$JQ_BIN" -r '.policy_version_id // empty' 2>/dev/null)" || observed_policy_id=""
      CHAMPION_OBSERVED_COUNT="$count"
      CHAMPION_OBSERVED_POLICY_VERSION_ID="$observed_policy_id"
      if [[ "$count" == "1" && "$membership_id" =~ '^lpm_[A-Za-z0-9-]+$' &&
        "$observed_policy_id" == "$expected_policy_version_id" ]]; then
        MEMBERSHIP_ID="$membership_id"
        return 0
      fi
    fi
    (( attempt < CHAMPION_LOOKUP_ATTEMPTS )) && sleep "$CHAMPION_LOOKUP_INTERVAL_SECONDS"
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
  while [[ ! -e "$ready" ]] && (( $(date +%s) < deadline )); do
    sleep 0.01
  done
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
  COMMAND_EXIT_JSON="$child_status"
  [[ -f "$COMMAND_STDOUT" ]] && cat "$COMMAND_STDOUT"
  [[ -f "$COMMAND_STDERR" ]] && cat "$COMMAND_STDERR" >&2
  return "$child_status"
}

load_candidate_identity() {
  PREFLIGHT_PROFILE="$("$JQ_BIN" -r '.profile // "default"' "$PREFLIGHT_SNAPSHOT")"
  CANDIDATE_COMMIT="$("$JQ_BIN" -r '.candidate.source_commit // empty' "$PREFLIGHT_SNAPSHOT")"
  CANDIDATE_PARENT_COMMIT="$("$JQ_BIN" -r '.candidate.parent_commit // empty' "$PREFLIGHT_SNAPSHOT")"
  CANDIDATE_IMAGE_ID="$("$JQ_BIN" -r '.candidate.image_id // empty' "$PREFLIGHT_SNAPSHOT")"
  CANDIDATE_POLICY_REF="$("$JQ_BIN" -r '.candidate.policy_ref // empty' "$PREFLIGHT_SNAPSHOT")"
  [[ ${#CANDIDATE_COMMIT} == 40 && "$CANDIDATE_COMMIT" != *[^0-9a-f]* ]] ||
    block "candidate source commit is not pinned"
  [[ ${#CANDIDATE_PARENT_COMMIT} == 40 &&
    "$CANDIDATE_PARENT_COMMIT" != *[^0-9a-f]* ]] ||
    block "candidate parent commit is not pinned"
  [[ "$CANDIDATE_IMAGE_ID" =~ '^sha256:[0-9a-f]{64}$' &&
    -n "$CANDIDATE_POLICY_REF" ]] ||
    block "candidate image identity is not pinned"
  git -C "$REPO" cat-file -e "$CANDIDATE_COMMIT^{commit}" 2>/dev/null ||
    block "candidate source commit is unavailable"
  git -C "$REPO" branch -r --contains "$CANDIDATE_COMMIT" |
    grep -q '[^[:space:]]' ||
    block "candidate source commit is not pushed"
  git -C "$REPO" cat-file -e "$CANDIDATE_PARENT_COMMIT^{commit}" 2>/dev/null ||
    block "candidate parent commit is unavailable"
  git -C "$REPO" branch -r --contains "$CANDIDATE_PARENT_COMMIT" |
    grep -q '[^[:space:]]' ||
    block "candidate parent commit is not pushed"
}

validate_preflight() {
  local strict_flag="$1"
  if [[ "$PREFLIGHT_PROFILE" == "standard-rebuild" ]]; then
    node "$STANDARD_VALIDATOR" "$PREFLIGHT_SNAPSHOT" "$strict_flag"
  else
    node "$VALIDATOR" "$PREFLIGHT_SNAPSHOT" "$strict_flag"
  fi
}

run_action() {
  (( $# == 4 )) || {
    usage
    return 64
  }
  MODE="$2"
  PREFLIGHT="$3"
  RECEIPT="$4"
  [[ "$MODE" == "diagnostic" || "$MODE" == "promotion" ]] || {
    usage
    return 64
  }
  [[ "$PREFLIGHT" == /* && -f "$PREFLIGHT" ]] || {
    print -r -- "PREFLIGHT must be an existing absolute file" >&2
    return 64
  }
  [[ "$RECEIPT" == /* && ! -e "$RECEIPT" && -d "${RECEIPT:h}" ]] || {
    print -r -- "ABS_RECEIPT must be a new absolute file in an existing directory" >&2
    return 64
  }

  acquire_lock || block "Qd1n mutation lock is not free" 75

  local runner_state player_rows
  runner_state="$("$RUNNER" status --json)" || block "runner status failed" 75
  print -r -- "$runner_state" | "$JQ_BIN" -e '.state == "free"' >/dev/null ||
    block "runner is not free"

  player_rows="$("${COWORLD_PREFIX[@]}" player list --server "$SERVER_URL" --json)" ||
    block "active player query failed" 75
  ACTIVE_PLAYER_ID="$(print -r -- "$player_rows" | "$JQ_BIN" -r '
    [.[] | select(.active == true)] |
    if length == 1 then .[0].id else empty end
  ')"
  printf '%s\n' "$ACTIVE_PLAYER_ID" > "$LOCK_DIR/active_player_id"
  chmod 600 "$LOCK_DIR/active_player_id"
  [[ "$ACTIVE_PLAYER_ID" == "$EXPECTED_PLAYER_ID" ]] ||
    block "active player is not K1Z odin free"

  load_candidate_identity
  if [[ "$MODE" == "diagnostic" ]]; then
    local resolved_image_id
    resolved_image_id="$("$DOCKER_BIN" image inspect "$CANDIDATE_POLICY_REF" \
      --format '{{.Id}}' 2>/dev/null)" ||
      block "candidate image cannot be inspected"
    [[ "$resolved_image_id" == "$CANDIDATE_IMAGE_ID" ]] ||
      block "candidate image ID does not match preflight"
    validate_preflight --require-diagnostic >/dev/null ||
      block "diagnostic preflight validation failed"
    COMMAND=(
      "${COWORLD_PREFIX[@]}"
      upload-policy "$CANDIDATE_POLICY_REF"
      --name "$EXPECTED_POLICY_NAME"
    )
    if [[ "$PREFLIGHT_PROFILE" != "standard-rebuild" ]]; then
      COMMAND+=(--use-bedrock)
    fi
    COMMAND+=(
      --run node
      --run /app/llm-player.mjs
      --tag "source_commit=$CANDIDATE_COMMIT"
      --tag "image_id=${CANDIDATE_IMAGE_ID#sha256:}"
      --server "$SERVER_URL"
    )
  else
    validate_preflight --require-promotion >/dev/null ||
      block "promotion preflight validation failed"
    UPLOADED_LABEL="$("$JQ_BIN" -r '.candidate.uploaded_label // empty' \
      "$PREFLIGHT_SNAPSHOT")"
    POLICY_VERSION_ID="$("$JQ_BIN" -r '.candidate.policy_version_id // empty' \
      "$PREFLIGHT_SNAPSHOT")"
    [[ "$UPLOADED_LABEL" =~ '^qd1n:v[1-9][0-9]*$' ]] ||
      block "promotion label is not pinned to qd1n:vN"
    local looked_up_id
    looked_up_id="$(verified_policy_lookup "$UPLOADED_LABEL" "$POLICY_VERSION_ID")" ||
      block "live policy-version identity does not match promotion preflight"
    [[ "$looked_up_id" == "$POLICY_VERSION_ID" ]] ||
      block "live policy-version identity does not match promotion preflight"
    COMMAND=(
      "${COWORLD_PREFIX[@]}"
      submit "$UPLOADED_LABEL"
      --league "$EXPECTED_LEAGUE_ID"
      --no-open-browser
      --auto-champion always
      --server "$SERVER_URL"
    )
  fi

  COMMAND_SHA256="$(printf '%s\0' "${COMMAND[@]}" | shasum -a 256 | awk '{print $1}')"
  printf '%s\n' "$COMMAND_SHA256" > "$LOCK_DIR/command_sha256"
  printf '%s\n' "$CANDIDATE_COMMIT" > "$LOCK_DIR/candidate_source_commit"
  printf '%s\n' "$CANDIDATE_PARENT_COMMIT" > "$LOCK_DIR/candidate_parent_commit"
  printf '%s\n' "$CANDIDATE_IMAGE_ID" > "$LOCK_DIR/candidate_image_id"
  printf '%s\n' "$CANDIDATE_POLICY_REF" > "$LOCK_DIR/candidate_policy_ref"
  chmod 600 "$LOCK_DIR/command_sha256" "$LOCK_DIR"/candidate_*

  local command_status=0
  if start_supervised_command; then
    command_status=0
  else
    command_status=$?
  fi
  if (( command_status != 0 )); then
    FINAL_STATUS="failed"
    FINAL_REASON="$MODE command exited nonzero"
    return "$command_status"
  fi

  if [[ "$MODE" == "diagnostic" ]]; then
    UPLOADED_LABEL="$(grep -Eo 'qd1n:v[1-9][0-9]*' "$COMMAND_STDOUT" | tail -1)"
    [[ "$UPLOADED_LABEL" =~ '^qd1n:v[1-9][0-9]*$' ]] ||
      block "upload completed but qd1n version label was not verified"
    POLICY_VERSION_ID="$(verified_policy_lookup "$UPLOADED_LABEL")" ||
      block "upload completed but policy-version identity was not verified"
  else
    MUTATION_RETRY_PROHIBITED=true
    verify_live_champion_membership "$POLICY_VERSION_ID" ||
      external_outcome_unknown \
        "submission returned success but a unique active competing champion membership was not verified"
  fi
  FINAL_STATUS="completed"
  FINAL_REASON="$MODE command completed under verified Qd1n identity and immutable gate"
}

reap_stale_action() {
  (( $# == 2 )) || {
    usage
    return 64
  }
  [[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || {
    print -r -- "no recoverable Qd1n mutation lock" >&2
    return 1
  }
  TOKEN="$2"
  [[ -n "$TOKEN" && "$(read_lock token)" == "$TOKEN" ]] || {
    print -r -- "mutation token mismatch" >&2
    return 1
  }
  local pid started
  pid="$(read_lock pid)"
  started="$(read_lock started_at)"
  if pid_matches "$pid" "$started"; then
    print -r -- "active Qd1n mutation:${pid}" >&2
    return 1
  fi

  LOCK_HELD=1
  MODE="$(read_lock mode)"
  PREFLIGHT="$(read_lock preflight_path)"
  PREFLIGHT_SNAPSHOT="$LOCK_DIR/preflight.json"
  PREFLIGHT_SHA256="$(read_lock preflight_sha256)"
  RECEIPT="$(read_lock receipt_path)"
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
  MUTATION_RETRY_PROHIBITED=true
  FINAL_STATUS="recovered_stale"
  FINAL_REASON="stale wrapper reaped; reconcile external outcome before any retry"
  COMMAND_EXIT_JSON="null"

  terminate_child || return $?
  if [[ -e "$RECEIPT" ]]; then
    RECEIPT_WRITTEN=1
  else
    write_receipt || {
      print -r -- "stale recovery receipt failed; preserving lock" >&2
      return 75
    }
  fi
  release_lock || return $?
  print -r -- "reaped:qd1n:external-outcome-unknown"
}

case "$ACTION" in
  status)
    if [[ "${2:-}" == "--json" && $# == 2 ]]; then
      status_json
    elif (( $# == 1 )); then
      status_json | "$JQ_BIN" -r '.state'
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
