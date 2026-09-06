#!/usr/bin/env bash
#
# Delete every decoded item and the change-detection snapshots, so the next run re-reads the
# pages instead of seeing "0 changed documents".
#
# DELETED: tasks, events, meetings, meeting requests, inbox items, and the doc/page snapshots.
#          Dropping `runs` also clears each run's costs, printed item codes and cached documents,
#          and is what makes the next run count as a first run (7-day lookback).
# KEPT:    your account, the tablet pairing, the handwriting calibration sample, the lexicon,
#          your corrections, and feedback ratings.
#
# Usage:  scripts/clear-lists.sh [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--yes" ]]; then
  echo "This deletes every decoded action, event, meeting and inbox item."
  echo "Your account, tablet pairing, calibration sample and lexicon are kept."
  read -r -p "Type 'clear' to continue: " answer
  [[ "$answer" == "clear" ]] || { echo "Cancelled."; exit 1; }
fi

# One transaction: either the whole working set goes or none of it does.
docker compose exec -T db psql \
  -U "${POSTGRES_USER:-daymarkable}" \
  -d "${POSTGRES_DB:-daymarkable}" \
  -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM inbox_items;
DELETE FROM meeting_requests;
DELETE FROM meetings;
DELETE FROM events;
DELETE FROM tasks;
DELETE FROM page_snapshots;
DELETE FROM doc_snapshots;
DELETE FROM runs;
COMMIT;
SQL

echo "Cleared. Run scripts/rerun-week.sh to read the pages again."
