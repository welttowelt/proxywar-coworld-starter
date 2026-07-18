#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/proxywar-dashboard-update.lock"

retry() {
  local attempt=1
  local max_attempts=5

  while ! "$@"; do
    if (( attempt >= max_attempts )); then
      printf 'command failed after %d attempts: %s\n' "$attempt" "$*" >&2
      return 1
    fi
    printf 'command failed; retrying in %d seconds: %s\n' "$((attempt * 5))" "$*" >&2
    sleep "$((attempt * 5))"
    ((attempt += 1))
  done
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s\n' "dashboard update already running"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$ROOT"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf '%s\n' "dashboard update skipped: worktree is not clean"
  exit 0
fi

retry git pull --ff-only origin main
npm run data:refresh
npm run cache:prune
git add data/analysis data/processed site/data

if git diff --cached --quiet; then
  printf '%s\n' "dashboard snapshot is unchanged"
  exit 0
fi

git commit -m "Refresh Proxy War dashboard data"
retry git push origin main

if [[ "${PROXYWAR_DEPLOY_NETLIFY:-0}" == "1" ]]; then
  if ! npx --yes netlify deploy \
    --prod \
    --dir site \
    --site a18dda9f-1550-440f-a7bc-40deaa7c2e8a \
    --message "Automated Proxy War dashboard refresh"; then
    printf '%s\n' "Netlify deploy failed; GitHub Pages will publish the pushed site snapshot" >&2
  fi
else
  printf '%s\n' "Netlify entrypoint redirects to GitHub Pages; skipping credit-based deploy"
fi
