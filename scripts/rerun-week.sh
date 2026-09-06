#!/usr/bin/env bash
#
# Read the last N days of modified pages and rebuild the notebooks.
#
# Runs on the STANDARD API (--on-demand) so it finishes while you watch; the nightly path uses
# the Batch API, which is half price but can sit queued. It does NOT consume the Sync-now quota,
# which only counts syncs started from the web or the phone (rule 11).
#
# Usage:  scripts/rerun-week.sh [days]        (default 7)
set -euo pipefail
cd "$(dirname "$0")/.."

DAYS="${1:-7}"
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "usage: $0 [days]" >&2; exit 1; }

echo "Reading pages modified in the last $DAYS day(s)…"
docker compose exec app pnpm dev:run --live --on-demand --window "$((DAYS * 24))" --force

echo
echo "Render service summary:"
docker compose logs --tail 200 render 2>/dev/null | grep -E "render pages=" | tail -3 || echo "  (no render summary in the recent log)"
