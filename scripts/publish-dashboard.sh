#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/proxywar-dashboard-update.lock"

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

git pull --ff-only origin main
npm run data:refresh
git add data/analysis data/processed site/data

if git diff --cached --quiet; then
  printf '%s\n' "dashboard snapshot is unchanged"
  exit 0
fi

git commit -m "Refresh Proxy War dashboard data"
git push origin main
npx --yes netlify deploy \
  --prod \
  --dir site \
  --site a18dda9f-1550-440f-a7bc-40deaa7c2e8a \
  --message "Automated Proxy War dashboard refresh"
