/**
 * Has the page a note was read from been deleted from the tablet?
 *
 * A note that has been converted is already kept: the weekly archive holds it. So once its page
 * or its notebook is gone from the tablet, the LIVE Notes notebook stops printing it — otherwise a
 * note from a notebook the customer threw away heads the notebook every night, forever. The note is
 * hidden, never deleted, and the reason is kept so a notebook that comes back (restored from the
 * trash) brings its notes back with it.
 *
 * Absence is only ever proved against what was actually listed tonight:
 * - a NOTEBOOK is gone when it is not in tonight's tree (deleted notebooks sit in the trash, which
 *   the provider does not list);
 * - a PAGE is gone only when its notebook's pages were listed tonight and it was not among them.
 *   Pages are listed only for notebooks that changed, so on a quiet night a page-level verdict is
 *   "unknown" and whatever was decided before stands.
 * An empty tree proves nothing — it is far likelier to be a sync fault than a wiped tablet.
 */
import type { TabletDocument } from "@daymarkable/tablet";

export interface NoteSource {
  id: string;
  sourceNotebook: string | null;
  sourceDocId: string | null;
  sourcePageId: string | null;
  sourceGone: string | null;
}

/** "notebook"/"page" = hide for that reason; "present" = show; "unknown" = leave as it is. */
export type SourceVerdict = "notebook" | "page" | "present" | "unknown";

export function sourceGoneVerdicts(notes: NoteSource[], documents: TabletDocument[], listedPages: Map<string, Set<string>>): Map<string, SourceVerdict> {
  const out = new Map<string, SourceVerdict>();
  if (!documents.length) {
    for (const n of notes) out.set(n.id, "unknown");
    return out;
  }
  const ids = new Set(documents.map((d) => d.id));
  const names = new Set(documents.map((d) => d.name));
  for (const n of notes) out.set(n.id, verdict(n, ids, names, listedPages));
  return out;
}

function verdict(n: NoteSource, ids: Set<string>, names: Set<string>, listedPages: Map<string, Set<string>>): SourceVerdict {
  if (n.sourceDocId) {
    if (!ids.has(n.sourceDocId)) return "notebook";
    const pages = listedPages.get(n.sourceDocId);
    if (pages && n.sourcePageId) return pages.has(n.sourcePageId) ? "present" : "page";
    // The notebook is here but its pages were not listed: a notebook-level hide is disproved,
    // a page-level one is neither proved nor disproved.
    return n.sourceGone === "page" ? "unknown" : "present";
  }
  // Read before the ids were recorded: all that is known is the notebook's name. A name that still
  // exists anywhere on the tablet counts as present — hiding a note is the riskier mistake.
  if (!n.sourceNotebook) return "unknown";
  return names.has(n.sourceNotebook) ? "present" : "notebook";
}
