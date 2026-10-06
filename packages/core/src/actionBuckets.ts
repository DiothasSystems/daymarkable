/**
 * How the Action List is organised, on the tablet, the website and the phone alike: by when each
 * action is due, and within that by priority.
 *
 * It was grouped by the page an action was written on until October 2026. That answered "where did
 * this come from" — which every row now answers on its own, with its notebook and page — and left
 * the list's real question, "what do I do next", for the reader to work out. An action without a
 * date is placed by its priority (workingDate): High under Today, Medium within the next three days,
 * Low under "No date yet" at the end.
 *
 * Medium is the default priority (stored as "normal"); a handwritten high-priority mark the user
 * chose during setup, or a tick in the H box, raises one.
 */
import type { Priority } from "./types.js";

export type ActionBucketKey = "overdue" | "today" | "soon" | "later" | "undated";

export const ACTION_BUCKET_LABELS: Record<ActionBucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  soon: "Next 3 days",
  later: "Later",
  undated: "No date yet",
};

const ORDER: ActionBucketKey[] = ["overdue", "today", "soon", "later", "undated"];

/** How far ahead "soon" reaches, and where an undated Medium action is placed within it. */
export const SOON_DAYS = 3;
const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/** What the customer sees for a stored priority: "normal" is shown as Medium everywhere. */
export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", normal: "Medium", low: "Low" };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The date an action is organised by. Its own due date when it has one; without one, its priority
 * stands in (the founder's rule, October 2026): High is treated as due today, Medium as due within
 * the next three days, and Low has no date at all. The action's real due date is untouched — still
 * blank until someone writes or types one — so this decides only where it sits and in what order.
 */
export function workingDate(t: { due: string | null; priority: Priority }, today: string): string | null {
  if (t.due !== null) return t.due;
  if (t.priority === "high") return today;
  if (t.priority === "normal") return addDays(today, SOON_DAYS);
  return null;
}

export function bucketOf(due: string | null, today: string): ActionBucketKey {
  if (due === null) return "undated";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= addDays(today, SOON_DAYS)) return "soon";
  return "later";
}

interface Sortable {
  due: string | null;
  priority: Priority;
  createdOn: string;
  text: string;
}

/**
 * By working date, then priority, then age: the older of two equal actions first, because it has
 * waited longer. So within Today a High with no date sits beside the ones due today, ranked by
 * priority with them.
 */
function compare(today: string) {
  return (a: Sortable, b: Sortable): number => {
    const wa = workingDate(a, today);
    const wb = workingDate(b, today);
    if (wa !== wb && wa !== null && wb !== null) return wa < wb ? -1 : 1;
    return rank(a, b);
  };
}

function rank(a: Sortable, b: Sortable): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  if (a.createdOn !== b.createdOn) return a.createdOn < b.createdOn ? -1 : 1;
  return a.text.localeCompare(b.text);
}

export interface ActionBucket<T> {
  key: ActionBucketKey;
  label: string;
  tasks: T[];
}

/** The non-empty groups, in reading order. */
export function actionBuckets<T extends Sortable>(tasks: readonly T[], today: string): ActionBucket<T>[] {
  const by = new Map<ActionBucketKey, T[]>();
  for (const t of tasks) {
    const k = bucketOf(workingDate(t, today), today);
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return ORDER.filter((k) => by.has(k)).map((k) => ({ key: k, label: ACTION_BUCKET_LABELS[k], tasks: [...by.get(k)!].sort(compare(today)) }));
}
