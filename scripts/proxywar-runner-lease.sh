#!/bin/zsh
set -euo pipefail

ACTION="${1:-status}"
LANE="${2:-}"
STATE_ROOT="/Users/olifreuler/.stormforge/proxywar-operators"
LOCK_DIR="$STATE_ROOT/runner.lock"
OWNER_FILE="$LOCK_DIR/owner"
TIME_FILE="$LOCK_DIR/acquired_at"

mkdir -p "$STATE_ROOT"

case "$ACTION" in
  acquire)
    if [[ "$LANE" != "odin" && "$LANE" != "hrafn" ]]; then
      echo "usage: $0 acquire odin|hrafn" >&2
      exit 64
    fi
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$LANE" > "$OWNER_FILE"
      date -u +"%Y-%m-%dT%H:%M:%SZ" > "$TIME_FILE"
      echo "acquired:$LANE"
      exit 0
    fi
    OWNER="$(cat "$OWNER_FILE" 2>/dev/null || echo unknown)"
    if [[ "$OWNER" == "$LANE" ]]; then
      echo "already-owned:$LANE"
      exit 0
    fi
    echo "busy:$OWNER" >&2
    exit 1
    ;;
  release)
    if [[ "$LANE" != "odin" && "$LANE" != "hrafn" ]]; then
      echo "usage: $0 release odin|hrafn" >&2
      exit 64
    fi
    if [[ ! -d "$LOCK_DIR" ]]; then
      echo "free"
      exit 0
    fi
    OWNER="$(cat "$OWNER_FILE" 2>/dev/null || echo unknown)"
    if [[ "$OWNER" != "$LANE" ]]; then
      echo "owned-by:$OWNER" >&2
      exit 1
    fi
    rm -rf "$LOCK_DIR"
    echo "released:$LANE"
    ;;
  status)
    if [[ ! -d "$LOCK_DIR" ]]; then
      echo "free"
      exit 0
    fi
    OWNER="$(cat "$OWNER_FILE" 2>/dev/null || echo unknown)"
    ACQUIRED="$(cat "$TIME_FILE" 2>/dev/null || echo unknown)"
    echo "owned:$OWNER:$ACQUIRED"
    ;;
  *)
    echo "usage: $0 acquire|release|status [odin|hrafn]" >&2
    exit 64
    ;;
esac
