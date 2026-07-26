#!/bin/zsh
set -euo pipefail

if (( $# != 5 )); then
  print -u2 -- \
    "usage: run-cyan7-matched-batch.sh MANIFEST CONTROL_REQUEST CANDIDATE_REQUEST CONTROL_OUTPUT CANDIDATE_OUTPUT"
  exit 64
fi

MANIFEST="$1"
CONTROL_REQUEST="$2"
CANDIDATE_REQUEST="$3"
CONTROL_OUTPUT="$4"
CANDIDATE_OUTPUT="$5"
DOCKER_SOCKET="unix:///Users/m1/.colima/default/docker.sock"
COWORLD_VERSION="0.1.34"
TIMEOUT_SECONDS="4700"

for input in "$MANIFEST" "$CONTROL_REQUEST" "$CANDIDATE_REQUEST"; do
  [[ "$input" == /* && -f "$input" && ! -L "$input" ]] || {
    print -u2 -- "invalid input file: $input"
    exit 65
  }
done

for output in "$CONTROL_OUTPUT" "$CANDIDATE_OUTPUT"; do
  [[ "$output" == /* && -d "$output" && ! -L "$output" ]] || {
    print -u2 -- "invalid lease-owned output directory: $output"
    exit 65
  }
  [[ -f "$output/.proxywar-runner-claim" ]] || {
    print -u2 -- "missing runner claim marker: $output"
    exit 65
  }
done

[[ "$CONTROL_OUTPUT" != "$CANDIDATE_OUTPUT" ]] || {
  print -u2 -- "matched outputs must differ"
  exit 65
}

CONTROL_PID=""
CANDIDATE_PID=""

stop_children() {
  trap - HUP INT TERM
  [[ -n "$CONTROL_PID" ]] && kill "$CONTROL_PID" 2>/dev/null || true
  [[ -n "$CANDIDATE_PID" ]] && kill "$CANDIDATE_PID" 2>/dev/null || true
  [[ -n "$CONTROL_PID" ]] && wait "$CONTROL_PID" 2>/dev/null || true
  [[ -n "$CANDIDATE_PID" ]] && wait "$CANDIDATE_PID" 2>/dev/null || true
  exit 130
}
trap stop_children HUP INT TERM

env \
  DOCKER_HOST="$DOCKER_SOCKET" \
  DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  uvx --from "coworld==$COWORLD_VERSION" coworld run-episode \
  "$MANIFEST" "$CONTROL_REQUEST" \
  --output-dir "$CONTROL_OUTPUT" \
  --timeout-seconds "$TIMEOUT_SECONDS" \
  --no-verify-replay \
  > "$CONTROL_OUTPUT/operator.stdout.log" \
  2> "$CONTROL_OUTPUT/operator.stderr.log" &
CONTROL_PID="$!"

env \
  DOCKER_HOST="$DOCKER_SOCKET" \
  DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  uvx --from "coworld==$COWORLD_VERSION" coworld run-episode \
  "$MANIFEST" "$CANDIDATE_REQUEST" \
  --output-dir "$CANDIDATE_OUTPUT" \
  --timeout-seconds "$TIMEOUT_SECONDS" \
  --no-verify-replay \
  > "$CANDIDATE_OUTPUT/operator.stdout.log" \
  2> "$CANDIDATE_OUTPUT/operator.stderr.log" &
CANDIDATE_PID="$!"

set +e
wait "$CONTROL_PID"
CONTROL_STATUS="$?"
wait "$CANDIDATE_PID"
CANDIDATE_STATUS="$?"
set -e

printf '{"control_status":%d,"candidate_status":%d}\n' \
  "$CONTROL_STATUS" "$CANDIDATE_STATUS"

(( CONTROL_STATUS == 0 && CANDIDATE_STATUS == 0 ))
