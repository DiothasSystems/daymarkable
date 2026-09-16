#!/usr/bin/env bash
#
# Remove decoded items that came off OLD pages, leaving recent work alone.
#
# Why this exists: a run that re-reads a notebook's history merges months of it into the live
# lists. Change detection no longer does that, but the items already merged do not retract
# themselves, and they carry forward on the Action List until something removes them.
#
# This is the narrow tool for that. `clear-lists.sh` is the blunt one — it drops everything and
# makes the next run re-read from scratch, which costs money and loses this week too.
#
# What "old" means, per table, because they date themselves differently:
#   tasks         the date the writer put on the source page (source_page_date)
#   events        the event's own date
#   meetings      the meeting's own date
#   inbox_items   when it landed in the Inbox (created_on) — these carry no page date
#
# An item with NO date is never touched: not knowing when something is from is not evidence
# that it is old.
#
# Usage:
#   scripts/prune-old-items.sh 2026-09-01           # preview only, changes nothing
#   scripts/prune-old-items.sh 2026-09-01 --yes     # delete after a typed confirmation
set -euo pipefail
cd "$(dirname "$0")/.."

CUTOFF="${1:-}"
CONFIRM="${2:-}"

if [[ ! "$CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Usage: scripts/prune-old-items.sh YYYY-MM-DD [--yes]"
  echo
  echo "Removes decoded items dated BEFORE that date. Items with no date are kept."
  echo "Without --yes it only shows what would go."
  exit 1
fi

psql() {
  docker compose exec -T db psql \
    -U "${POSTGRES_USER:-daymarkable}" \
    -d "${POSTGRES_DB:-daymarkable}" \
    -v ON_ERROR_STOP=1 "$@"
}

echo "== what is dated before $CUTOFF"
psql <<SQL
\\set cutoff '$CUTOFF'
select 'tasks' as kind, source_notebook, count(*) as items, min(source_page_date) as oldest, max(source_page_date) as newest
  from tasks where source_page_date is not null and source_page_date < :'cutoff' group by 1, 2
union all
select 'events', source_notebook, count(*), min(date), max(date)
  from events where date is not null and date < :'cutoff' group by 1, 2
union all
select 'meetings', source_notebook, count(*), min(date), max(date)
  from meetings where date is not null and date < :'cutoff' group by 1, 2
union all
select 'inbox', source_notebook, count(*), min(created_on), max(created_on)
  from inbox_items where created_on < :'cutoff' group by 1, 2
order by 1, 3 desc;
SQL

echo
echo "== what is KEPT (dated on or after $CUTOFF, or carrying no date at all)"
psql <<SQL
\\set cutoff '$CUTOFF'
select 'tasks' as kind,
       count(*) filter (where source_page_date is null) as undated_kept,
       count(*) filter (where source_page_date >= :'cutoff') as recent_kept
  from tasks
union all
select 'events',
       count(*) filter (where date is null),
       count(*) filter (where date >= :'cutoff')
  from events
union all
select 'meetings',
       count(*) filter (where date is null),
       count(*) filter (where date >= :'cutoff')
  from meetings;
SQL

if [[ "$CONFIRM" != "--yes" ]]; then
  echo
  echo "Preview only. Nothing was changed. Add --yes to delete."
  exit 0
fi

echo
echo "This permanently deletes the items listed in the first table."
read -r -p "Type the cutoff date ($CUTOFF) to confirm: " answer
[[ "$answer" == "$CUTOFF" ]] || { echo "Cancelled."; exit 1; }

# One transaction: either the whole set goes or none of it does. printed_items rows that pointed
# at a deleted item are removed too — they map a checkbox on a printed page back to its item, and
# one pointing at nothing would leave a tick that resolves to no item on the next run.
psql <<SQL
\\set cutoff '$CUTOFF'
BEGIN;
delete from printed_items where item_type = 'task' and item_id in
  (select id from tasks where source_page_date is not null and source_page_date < :'cutoff');
delete from printed_items where item_type = 'inbox' and item_id in
  (select id from inbox_items where created_on < :'cutoff');
delete from tasks where source_page_date is not null and source_page_date < :'cutoff';
delete from events where date is not null and date < :'cutoff';
delete from meetings where date is not null and date < :'cutoff';
delete from inbox_items where created_on < :'cutoff';
COMMIT;
SQL

echo
echo "Done. The lists on the tablet still show the old items until they are rebuilt —"
echo "open Documents in the app and press 'Send updated notebooks to tablet', or wait for tonight."
