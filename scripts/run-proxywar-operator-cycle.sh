#!/bin/zsh
set -euo pipefail

LANE="${1:-}"
case "$LANE" in
  odin)
    REPO="/Users/olifreuler/proxywar-coworld-starter"
    PROMPT="$REPO/.codex/operator-cycle.md"
    FORCE_AFTER=3600
    SOFT_AFTER=480
    HARD_AFTER=900
    REASONING="high"
    ;;
  *)
    echo "usage: $0 odin" >&2
    exit 64
    ;;
esac

REPO="${PROXYWAR_OPERATOR_REPO:-$REPO}"
PROMPT="${PROXYWAR_OPERATOR_PROMPT:-$PROMPT}"
MAILBOX="${PROXYWAR_OPERATOR_MAILBOX:-/Users/olifreuler/.stormforge/team-mailbox}"
CODEX_BIN="${PROXYWAR_CODEX_BIN:-/opt/homebrew/bin/codex}"
FORCE_AFTER="${PROXYWAR_OPERATOR_FORCE_AFTER:-$FORCE_AFTER}"
SOFT_AFTER="${PROXYWAR_OPERATOR_SOFT_AFTER:-$SOFT_AFTER}"
HARD_AFTER="${PROXYWAR_OPERATOR_HARD_AFTER:-$HARD_AFTER}"
MAX_TOOLS="${PROXYWAR_OPERATOR_MAX_TOOLS:-12}"
STATE_ROOT="${PROXYWAR_OPERATOR_STATE_ROOT:-/Users/olifreuler/.stormforge/proxywar-operators}"
RUNNER_LEASE="${PROXYWAR_RUNNER_LEASE_SCRIPT:-/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh}"
LOCK_DIR="$STATE_ROOT/$LANE.lock"
MAILBOX_LOCK="$STATE_ROOT/mailbox-write.lock"
CURSOR="$STATE_ROOT/$LANE-mailbox-head"
LAST_RUN="$STATE_ROOT/$LANE-last-run"
WAKE="$STATE_ROOT/$LANE.wake"
PENDING="$STATE_ROOT/$LANE-mailbox-pending"
CHECKPOINT="$STATE_ROOT/$LANE-cycle-checkpoint.md"
EVENTS="$STATE_ROOT/operator-events.jsonl"
RUNTIME_PROMPT="$STATE_ROOT/$LANE-runtime-prompt.md"
ACTIVE_ARM="${PROXYWAR_OPERATOR_ACTIVE_ARM:-$REPO/.codex/active-arm.json}"

# The old prompt acquired in one short shell and launched work later, which
# cannot be made ownership-safe. Newline-aware negative matching alone is too
# brittle, so require positive proof of this lane's complete supervised
# `run ... --output ... -- command` protocol and reject any legacy acquire form.
prompt_is_runner_v2_ready() {
  [[ -r "$PROMPT" ]] || return 1
  PROMPT_LANE="$LANE" /usr/bin/perl -0777 -e '
    use strict;
    use warnings;

    my $lane = $ENV{PROMPT_LANE} // q{};
    my $text = <>;
    $text =~ s/\\\r?\n/ /g;
    $text =~ s/\s+/ /g;

    exit 1 if $text =~
      m{proxywar-runner-lease[.]sh\s+acquire\s+(?:odin|hrafn)(?![A-Za-z0-9._-])}i;

    while ($text =~
      m{proxywar-runner-lease[.]sh\s+run\s+\Q$lane\E\s+
        [A-Za-z0-9._-]{1,80}(?![A-Za-z0-9._-])}igx) {
      my $tail = substr($text, pos($text), 1200);
      next unless $tail =~ m{--output\s+\S+};
      next unless $tail =~ m{(?:^|\s)--\s+\S+};
      exit 0;
    }
    exit 1;
  ' "$PROMPT"
}

if ! prompt_is_runner_v2_ready; then
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
WAKE_PRESENT=0
[[ -f "$WAKE" ]] && WAKE_PRESENT=1
FORCE_DUE=0
(( NOW - LAST >= FORCE_AFTER )) && FORCE_DUE=1

if [[ "$WAKE_PRESENT" == "0" && "$HEAD" == "$PREVIOUS" && "$FORCE_DUE" == "0" && ! -s "$PENDING" ]]; then
  exit 0
fi

export HOME="/Users/olifreuler"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

append_event() {
  local event="$1"
  local detail="${2:-}"
  jq -cn \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg lane "$LANE" \
    --arg event "$event" \
    --arg cycle_id "$CYCLE_ID" \
    --arg mailbox_head "$HEAD" \
    --arg detail "$detail" \
    '{timestamp:$timestamp,lane:$lane,event:$event,cycle_id:$cycle_id,mailbox_head:$mailbox_head,detail:$detail}' \
    >> "$EVENTS"
}

packet_is_addressed() {
  local packet="$1"
  grep -Eiq '^to=.*(Codex Odin|Kimi-OdinFree|K1Z odin free|(^|[^A-Za-z])Odin([^A-Za-z]|$))' "$packet"
}

queue_new_packets() {
  local range active_id packet score order
  local candidates="$STATE_ROOT/$LANE-mailbox-candidates.$$"
  local queued="$STATE_ROOT/$LANE-mailbox-pending.$$"
  : > "$candidates"
  : > "$queued"

  if [[ -n "$PREVIOUS" ]] &&
     git -C "$MAILBOX" cat-file -e "$PREVIOUS^{commit}" 2>/dev/null &&
     git -C "$MAILBOX" merge-base --is-ancestor "$PREVIOUS" "$HEAD" 2>/dev/null; then
    range="$PREVIOUS..$HEAD"
  else
    range="$HEAD^..$HEAD"
  fi

  git -C "$MAILBOX" log --format= --name-only "$range" 2>/dev/null |
    awk 'NF && !seen[$0]++' > "$candidates"
  active_id="$(jq -r '.arm.id // empty' "$ACTIVE_ARM" 2>/dev/null || true)"
  order=0
  while IFS= read -r relative; do
    [[ -n "$relative" ]] || continue
    packet="$MAILBOX/$relative"
    [[ -f "$packet" ]] || continue
    packet_is_addressed "$packet" || continue
    order=$((order + 1))
    score=50
    if grep -Eiq '^(verdict|status)=.*(BLOCK|REJECT|REVISE|INSUFFICIENT|NO.RUN|NO SUBMIT)' "$packet"; then
      score=10
    elif [[ -n "$active_id" ]] &&
         grep -Eiq "$active_id" "$packet" &&
         grep -Eiq '^(verdict|status)=.*APPROVE' "$packet"; then
      score=20
    elif grep -Eiq '^(verdict|status)=.*APPROVE' "$packet"; then
      score=30
    elif grep -Eiq 'requested_verdict|review request|request.*review' "$packet"; then
      score=40
    fi
    printf '%s\t%06d\t%s\t%s\n' "$score" "$order" "$HEAD" "$relative" >> "$queued"
  done < "$candidates"
  rm -f "$candidates"
  if [[ -s "$queued" ]]; then
    sort -n -k1,1 -k2,2 "$queued" > "$PENDING"
  fi
  rm -f "$queued"
}

if [[ ! -s "$PENDING" && "$HEAD" != "$PREVIOUS" ]]; then
  queue_new_packets
fi

# Unaddressed mailbox traffic must not wake an expensive reasoning cycle.
if [[ ! -s "$PENDING" && "$WAKE_PRESENT" == "0" && "$FORCE_DUE" == "0" ]]; then
  printf '%s\n' "$HEAD" > "$CURSOR"
  exit 0
fi

PRIORITY_PACKET=""
PRIORITY_RECORD=""
if [[ -s "$PENDING" ]]; then
  PRIORITY_RECORD="$(head -n 1 "$PENDING")"
  PRIORITY_PACKET="$MAILBOX/$(print -r -- "$PRIORITY_RECORD" | cut -f4-)"
fi

CYCLE_ID="${LANE}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
SOFT_DEADLINE=$((NOW + SOFT_AFTER))
HARD_DEADLINE=$((NOW + HARD_AFTER))
TRIGGER="scheduled"
[[ "$WAKE_PRESENT" == "1" ]] && TRIGGER="wake"
[[ -n "$PRIORITY_PACKET" ]] && TRIGGER="mailbox_packet"

{
  print "# Runtime dispatch envelope"
  print
  print "cycle_id=$CYCLE_ID"
  print "lane=$LANE"
  print "trigger=$TRIGGER"
  print "mailbox_head=$HEAD"
  print "priority_packet=${PRIORITY_PACKET:-none}"
  print "active_arm=$ACTIVE_ARM"
  print "soft_deadline_epoch=$SOFT_DEADLINE"
  print "hard_deadline_epoch=$HARD_DEADLINE"
  print "tool_call_budget=$MAX_TOOLS"
  print
  print "Act on the priority packet first. Complete exactly one main-effort transition."
  print "Do not perform a broad history, replay, scoreboard, or documentation sweep."
  print "At the soft deadline or tool-call budget, write the exact checkpoint and exit."
  print "Do not begin a second effort. Never use Slack."
  print
  cat "$PROMPT"
} > "$RUNTIME_PROMPT"

{
  print "# ProxyWar operator checkpoint"
  print
  print "cycle_id=$CYCLE_ID"
  print "status=started"
  print "trigger=$TRIGGER"
  print "priority_packet=${PRIORITY_PACKET:-none}"
  print "mailbox_head=$HEAD"
} > "$CHECKPOINT"
append_event "cycle_started" "trigger=$TRIGGER packet=${PRIORITY_PACKET:-none}"

set +e
"$CODEX_BIN" exec \
  --strict-config \
  --disable apps \
  --dangerously-bypass-approvals-and-sandbox \
  --model "gpt-5.6-sol" \
  --config "model_reasoning_effort=\"$REASONING\"" \
  --output-last-message "$CHECKPOINT" \
  -C "$REPO" \
  - < "$RUNTIME_PROMPT"
CODEX_STATUS=$?
set -e

if (( CODEX_STATUS != 0 )); then
  touch "$WAKE"
  append_event "cycle_failed" "status=$CODEX_STATUS; packet preserved"
  exit "$CODEX_STATUS"
fi

if [[ -n "$PRIORITY_RECORD" ]]; then
  tail -n +2 "$PENDING" > "$PENDING.next"
  mv "$PENDING.next" "$PENDING"
fi
if [[ -s "$PENDING" ]]; then
  touch "$WAKE"
else
  rm -f "$PENDING" "$WAKE"
  # Advance only through the mailbox head that triggered this cycle. A message
  # arriving during execution remains unread for the next launch.
  printf '%s\n' "$HEAD" > "$CURSOR"
fi
date +%s > "$LAST_RUN"
append_event "cycle_completed" "packet=${PRIORITY_PACKET:-none}; pending=$([[ -s "$PENDING" ]] && print yes || print no)"
