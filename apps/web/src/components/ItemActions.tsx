"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

type ItemType = "task" | "event" | "inbox" | "meeting_request" | "meeting";

/**
 * The web equivalent of a pen: tick the box to close an item, or cross it out to drop one that is
 * not relevant. Both write the same state a planner tick or strike-through would, so a decision
 * made here and one made on paper are indistinguishable afterwards.
 *
 * The tablet keeps its printed copies until the next run, or until "Send updated notebooks to
 * tablet" — nothing here regenerates anything (rule 12).
 */
export function TickBox({ itemType, itemId, label = "Mark done" }: { itemType: ItemType; itemId: string; label?: string }) {
  const { run, busy } = useDecide();
  return (
    <button
      type="button"
      className="box-btn"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void run(itemType, itemId, "complete")}
    >
      <span className="box" aria-hidden />
    </button>
  );
}

/** Cross-out: the item was misread, already handled elsewhere, or simply not relevant. */
export function DropButton({ itemType, itemId, text, label = "Not relevant — remove" }: { itemType: ItemType; itemId: string; text: string; label?: string }) {
  const { run, busy } = useDecide();
  return (
    <button
      type="button"
      className="drop-btn"
      aria-label={`${label}: ${text}`}
      title={label}
      disabled={busy}
      onClick={() => {
        if (!confirm(`Remove this item?\n\n${text}\n\nIt leaves the list for good — the same as crossing it out on paper.`)) return;
        void run(itemType, itemId, "drop");
      }}
    >
      ✕
    </button>
  );
}

/**
 * Delete a meeting note. Unlike dropping an action this has no paper equivalent: the note leaves every
 * view on the site and in the app, and its text is erased from the store.
 * The page on the tablet is not touched.
 */
export function DeleteNoteButton({ itemId, topic }: { itemId: string; topic: string }) {
  const { run, busy } = useDecide();
  return (
    <button
      type="button"
      className="small secondary"
      aria-label={`Delete note: ${topic}`}
      disabled={busy}
      onClick={() => {
        if (!confirm(`Delete this note?

${topic}

It is removed here and in the app, and its text is erased. Your tablet, including its daily Notes, is not changed.`)) return;
        void run("meeting", itemId, "drop");
      }}
    >
      Delete note
    </button>
  );
}

/** Delete one day of the daily Notes from the site and the app. The tablet keeps its copy. */
export function DeleteNotesDayButton({ date, label }: { date: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="small secondary"
      aria-label={`Delete notes for ${label}`}
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Delete the notes for ${label}?\n\nThey are removed here and in the app, and their text is erased. The document on your tablet is not changed.`)) return;
        setBusy(true);
        try {
          await trpc.documents.deleteNotesDay.mutate({ date });
          router.refresh();
        } catch (err) {
          alert(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Delete this day
    </button>
  );
}

function useDecide() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(itemType: ItemType, itemId: string, action: "complete" | "drop") {
    setBusy(true);
    try {
      await trpc.documents.decide.mutate({ itemType, itemId, action });
      router.refresh();
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { run, busy };
}
