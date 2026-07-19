#!/bin/zsh
set -euo pipefail

LANE="${1:-}"
case "$LANE" in
  odin)
    REPO="/Users/olifreuler/proxywar-coworld-starter"
    PROMPT="$REPO/.codex/operator-cycle.md"
    FORCE_AFTER=3600
    REASONING="high"
    ;;
  hrafn)
    REPO="/Users/olifreuler/proxywar-k1z-hrafn"
    PROMPT="$REPO/.codex/operator-cycle.md"
    FORCE_AFTER=14400
    REASONING="xhigh"
    ;;
  *)
    echo "usage: $0 odin|hrafn" >&2
    exit 64
    ;;
esac

REPO="${PROXYWAR_OPERATOR_REPO:-$REPO}"
PROMPT="${PROXYWAR_OPERATOR_PROMPT:-$PROMPT}"
MAILBOX="/Users/olifreuler/.stormforge/team-mailbox"
STATE_ROOT="${PROXYWAR_OPERATOR_STATE_ROOT:-/Users/olifreuler/.stormforge/proxywar-operators}"
RUNNER_LEASE="${PROXYWAR_RUNNER_LEASE_SCRIPT:-/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh}"
LOCK_DIR="$STATE_ROOT/$LANE.lock"
MAILBOX_LOCK="$STATE_ROOT/mailbox-write.lock"
CURSOR="$STATE_ROOT/$LANE-mailbox-head"
LAST_RUN="$STATE_ROOT/$LANE-last-run"
WAKE="$STATE_ROOT/$LANE.wake"

# The old prompt acquired in one short shell and launched work later, which
# cannot be made ownership-safe. Refuse that transition before consuming a wake
# marker or mailbox cursor. The lane owner must migrate the prompt to `run`.
if [[ ! -r "$PROMPT" ]] ||
  grep -Eq 'proxywar-runner-lease\.sh[[:space:]]+acquire[[:space:]]+(odin|hrafn)' \
    "$PROMPT"; then
  print -r -- "${LANE}: operator prompt is not runner-v2 ready; preserving wake and cursor" >&2
  exit 78
fi

# A same-lane active, stale, or legacy lease owns runner decisions. Global
# initialization, corruption, and reaping states also fail closed. Perform
# this check before lane locks, mailbox access, cursor changes, or wake removal.
if ! RUNNER_STATE="$("$RUNNER_LEASE" status --json)"; then
  print -r -- "${LANE}: runner status failed; preserving wake and cursor" >&2
  exit 75
fi
if ! print -r -- "$RUNNER_STATE" | jq -e '
  (.state | IN("free", "active", "stale", "legacy", "initializing", "reaping", "corrupt"))
  and (has("owner") and has("reap_in_progress"))' >/dev/null; then
  print -r -- "${LANE}: runner status is invalid; preserving wake and cursor" >&2
  exit 75
fi
if print -r -- "$RUNNER_STATE" | jq -e --arg lane "$LANE" '
  .state == "initializing"
  or .state == "reaping"
  or .state == "corrupt"
  or ((.state == "active" or .state == "stale" or .state == "legacy")
      and .owner == $lane)' >/dev/null; then
  exit 0
fi

mkdir -p "$STATE_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
MAILBOX_LOCK_HELD=0
cleanup() {
  if [[ "$MAILBOX_LOCK_HELD" == "1" ]]; then
    rm -rf "$MAILBOX_LOCK"
  fi
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

acquire_mailbox_lock() {
  if mkdir "$MAILBOX_LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$MAILBOX_LOCK/pid"
    MAILBOX_LOCK_HELD=1
    return 0
  fi
  local lock_pid
  lock_pid="$(cat "$MAILBOX_LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    return 1
  fi
  rm -rf "$MAILBOX_LOCK"
  mkdir "$MAILBOX_LOCK"
  printf '%s\n' "$$" > "$MAILBOX_LOCK/pid"
  MAILBOX_LOCK_HELD=1
}

release_mailbox_lock() {
  rm -rf "$MAILBOX_LOCK"
  MAILBOX_LOCK_HELD=0
}

if ! acquire_mailbox_lock; then
  exit 0
fi
if ! git -C "$MAILBOX" pull --ff-only >/dev/null 2>&1; then
  release_mailbox_lock
  echo "${LANE}: mailbox fast-forward pull failed" >&2
  exit 1
fi
HEAD="$(git -C "$MAILBOX" rev-parse HEAD)"
release_mailbox_lock
PREVIOUS="$(cat "$CURSOR" 2>/dev/null || true)"
NOW="$(date +%s)"
LAST="$(cat "$LAST_RUN" 2>/dev/null || echo 0)"

if [[ ! -f "$WAKE" && "$HEAD" == "$PREVIOUS" && $((NOW - LAST)) -lt $FORCE_AFTER ]]; then
  exit 0
fi
rm -f "$WAKE"

export HOME="/Users/olifreuler"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

/opt/homebrew/bin/codex exec \
  --strict-config \
  --dangerously-bypass-approvals-and-sandbox \
  --model "gpt-5.6-sol" \
  --config "model_reasoning_effort=\"$REASONING\"" \
  -C "$REPO" \
  - < "$PROMPT"

# Advance only through the mailbox head that triggered this cycle. A message
# arriving while Codex is working must remain unread so the next launch runs
# immediately instead of silently consuming it.
printf '%s\n' "$HEAD" > "$CURSOR"
date +%s > "$LAST_RUN"
