#!/usr/bin/env bash
#
# Clear the decoded lists, then read the last N days again. The two steps you almost always run
# together after a change to decoding, merging or the page templates.
#
# Usage:  scripts/reset-week.sh [days] [--yes]        (default 7 days, prompts before deleting)
set -euo pipefail
cd "$(dirname "$0")/.."

DAYS=7
YES=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES="--yes" ;;
    *) DAYS="$arg" ;;
  esac
done

scripts/clear-lists.sh $YES
scripts/rerun-week.sh "$DAYS"
