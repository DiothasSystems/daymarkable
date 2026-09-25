/**
 * Editing the working set by hand — from the web, and from the mobile app that is the reason
 * this exists.
 *
 * There were two write paths before this one: `repo.decideItem` (tick or drop) and the web's
 * `correctItem` (replace an item's text). Neither can move a meeting to Thursday or fix a
 * location, which is most of what editing a calendar means.
 *
 * The distinction that matters, and the reason this is a separate module rather than more
 * arguments to `correctItem`:
 *
 *   correcting  "that is not what I wrote"  — the decoder misread the page. The change is
 *               evidence about this person's handwriting, so it records a correction and
 *               promotes the changed words into their lexicon.
 *   editing     "that is not what I want any more" — the page was read correctly and the plan
 *               has changed. There is nothing to learn from it, and pretending otherwise would
 *               teach the decoder vocabulary that was never on a page.
 *
 * The lexicon is the largest lever on per-user accuracy (CLAUDE.md, "Per-user accuracy"). An app
 * whose whole purpose is editing would feed it noise all day if these were one call.
 *
 * Rule 8 still holds: this never orphans an open item. Creating merges into the one canonical
 * list the way a decoded item does, and removing is still `decideItem(..., "drop")` — there is
 * no hard delete here on purpose.
 */
import { and, eq, isNull, type Db, type Sealer, schema } from "@daymarkable/db";
import { similar, stableId, type Recurrence } from "@daymarkable/core";

export interface TaskPatch {
  text?: string | undefined;
  due?: string | null | undefined;
  dueTime?: string | null | undefined;
  priority?: "high" | "normal" | "low" | undefined;
  kind?: "action" | "follow_up" | undefined;
  project?: string | null | undefined;
}

export interface EventPatch {
  title?: string | undefined;
  date?: string | null | undefined;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  location?: string | null | undefined;
  recurrence?: Recurrence | null | undefined;
}

export interface MeetingPatch {
  topic?: string | undefined;
  date?: string | null | undefined;
  time?: string | null | undefined;
  /** The note body itself. Encrypted at rest, so a change here is an unseal / patch / reseal. */
  text?: string | undefined;
  decisions?: string[] | undefined;
  actions?: string[] | undefined;
}

export type EditableItemType = "task" | "event" | "meeting";

export type ItemEdit =
  | { itemType: "task"; itemId: string; patch: TaskPatch }
  | { itemType: "event"; itemId: string; patch: EventPatch }
  | { itemType: "meeting"; itemId: string; patch: MeetingPatch };

export type NewItem =
  | { itemType: "task"; text: string; due?: string | null | undefined; dueTime?: string | null | undefined; priority?: "high" | "normal" | "low" | undefined; kind?: "action" | "follow_up" | undefined; project?: string | null | undefined }
  | { itemType: "event"; title: string; date?: string | null | undefined; startTime?: string | null | undefined; endTime?: string | null | undefined; location?: string | null | undefined; recurrence?: Recurrence | null | undefined };

export interface EditResult {
  itemType: EditableItemType;
  itemId: string;
  /** What the item now reads as, for the caller's confirmation copy. */
  label: string;
}

export interface CreateResult {
  itemType: "task" | "event";
  itemId: string;
  /** False when an open item already said this and the new one folded into it (rule 8). */
  created: boolean;
  label: string;
}

/** The note body as it is sealed. */
interface MeetingBody {
  text: string;
  decisions: string[];
  actions: string[];
}

const trimmed = (s: string) => s.trim();
/** An emptied field is absent, not empty — the schema says null and the composer skips it. */
const orNull = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

export class ItemNotFound extends Error {
  constructor(itemType: string, itemId: string) {
    super(`no ${itemType} ${itemId} for this user`);
    this.name = "ItemNotFound";
  }
}

export type EditableItem =
  | { itemType: "task"; id: string; text: string; due: string | null; dueTime: string | null; priority: "high" | "normal" | "low"; kind: "action" | "follow_up"; project: string | null; confidence: number; source: { notebook: string | null; pageIndex: number | null } }
  | { itemType: "event"; id: string; title: string; date: string | null; startTime: string | null; endTime: string | null; location: string | null; recurrence: Recurrence | null; confidence: number; origin: "ink" | "external" | "app" }
  | { itemType: "meeting"; id: string; topic: string; date: string | null; time: string | null; text: string; decisions: string[]; actions: string[]; confidence: number; source: { notebook: string | null; pageIndex: number | null } };

/**
 * One item, exactly as stored, for an editor to open.
 *
 * Deliberately not "read it out of the registry". `getRegistry` and `getCalendar` both project a
 * repeating series onto a date it lands on — the next occurrence, or the day of the grid cell —
 * because that is what a list and a grid want to show. An editor that loaded one of those and
 * saved it back would write an occurrence's date over the series anchor, quietly rescheduling
 * every future occurrence of a monthly meeting because someone corrected its title. What an
 * editor needs is the row.
 */
export async function getItem(db: Db, sealer: Sealer, userId: string, itemType: EditableItemType, itemId: string): Promise<EditableItem> {
  if (itemType === "task") {
    const row = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, itemId)) });
    if (!row) throw new ItemNotFound("task", itemId);
    return {
      itemType: "task",
      id: row.id,
      text: row.text,
      due: row.due,
      dueTime: row.dueTime,
      priority: row.priority,
      kind: row.kind,
      project: row.project,
      confidence: row.confidence,
      source: { notebook: row.sourceNotebook, pageIndex: row.sourcePageIndex },
    };
  }
  if (itemType === "event") {
    const row = await db.query.events.findFirst({ where: and(eq(schema.events.userId, userId), eq(schema.events.id, itemId)) });
    if (!row) throw new ItemNotFound("event", itemId);
    return {
      itemType: "event",
      id: row.id,
      title: row.title,
      // The series anchor, not an occurrence.
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      location: row.location,
      recurrence: row.recurrence,
      confidence: row.confidence,
      origin: row.source,
    };
  }
  const row = await db.query.meetings.findFirst({ where: and(eq(schema.meetings.userId, userId), eq(schema.meetings.id, itemId), isNull(schema.meetings.deletedAt)) });
  if (!row) throw new ItemNotFound("meeting", itemId);
  const body = sealer.openJson<MeetingBody>(row.bodyEnc);
  return {
    itemType: "meeting",
    id: row.id,
    topic: row.topic,
    date: row.date,
    time: row.time,
    text: body.text,
    decisions: body.decisions,
    actions: body.actions,
    confidence: row.confidence,
    source: { notebook: row.sourceNotebook, pageIndex: row.sourcePageIndex },
  };
}

/**
 * Change fields on an item the user already has.
 *
 * Records nothing in `corrections` and touches no lexicon — see the header. Confidence goes to 1
 * only when the displayed text changes, because that is the field confidence was ever about: the
 * decoder's guess at those words has been overwritten by the person who wrote them.
 */
export async function updateItem(db: Db, sealer: Sealer, userId: string, edit: ItemEdit): Promise<EditResult> {
  const now = new Date();

  if (edit.itemType === "task") {
    const row = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, edit.itemId)) });
    if (!row) throw new ItemNotFound("task", edit.itemId);
    const p = edit.patch;
    const text = p.text === undefined ? row.text : trimmed(p.text);
    if (!text) throw new Error("an action needs words");
    const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now };
    if (p.text !== undefined) {
      set.text = text;
      if (text !== row.text) set.confidence = 1;
    }
    if (p.due !== undefined) set.due = orNull(p.due);
    if (p.dueTime !== undefined) set.dueTime = orNull(p.dueTime);
    if (p.priority !== undefined) set.priority = p.priority;
    if (p.kind !== undefined) set.kind = p.kind;
    if (p.project !== undefined) set.project = orNull(p.project);
    await db.update(schema.tasks).set(set).where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, edit.itemId)));
    return { itemType: "task", itemId: edit.itemId, label: text };
  }

  if (edit.itemType === "event") {
    const row = await db.query.events.findFirst({ where: and(eq(schema.events.userId, userId), eq(schema.events.id, edit.itemId)) });
    if (!row) throw new ItemNotFound("event", edit.itemId);
    const p = edit.patch;
    const title = p.title === undefined ? row.title : trimmed(p.title);
    if (!title) throw new Error("an event needs a title");
    const set: Partial<typeof schema.events.$inferInsert> = { updatedAt: now };
    if (p.title !== undefined) {
      set.title = title;
      if (title !== row.title) set.confidence = 1;
    }
    if (p.date !== undefined) set.date = orNull(p.date);
    if (p.startTime !== undefined) set.startTime = orNull(p.startTime);
    if (p.endTime !== undefined) set.endTime = orNull(p.endTime);
    if (p.location !== undefined) set.location = orNull(p.location);
    if (p.recurrence !== undefined) set.recurrence = p.recurrence ?? null;
    await db.update(schema.events).set(set).where(and(eq(schema.events.userId, userId), eq(schema.events.id, edit.itemId)));
    return { itemType: "event", itemId: edit.itemId, label: title };
  }

  const row = await db.query.meetings.findFirst({ where: and(eq(schema.meetings.userId, userId), eq(schema.meetings.id, edit.itemId), isNull(schema.meetings.deletedAt)) });
  if (!row) throw new ItemNotFound("meeting", edit.itemId);
  const p = edit.patch;
  const topic = p.topic === undefined ? row.topic : trimmed(p.topic);
  if (!topic) throw new Error("a meeting needs a topic");
  const set: Partial<typeof schema.meetings.$inferInsert> = {};
  if (p.topic !== undefined) {
    set.topic = topic;
    if (topic !== row.topic) set.confidence = 1;
  }
  if (p.date !== undefined) set.date = orNull(p.date);
  if (p.time !== undefined) set.time = orNull(p.time);
  // The body is sealed, so any change to it is read-modify-write through the sealer. The
  // plaintext exists only inside this function and must not reach a log or an error (rule 5).
  if (p.text !== undefined || p.decisions !== undefined || p.actions !== undefined) {
    const body = sealer.openJson<MeetingBody>(row.bodyEnc);
    const next: MeetingBody = {
      text: p.text ?? body.text,
      decisions: p.decisions ?? body.decisions,
      actions: p.actions ?? body.actions,
    };
    set.bodyEnc = sealer.sealJson(next);
  }
  await db.update(schema.meetings).set(set).where(and(eq(schema.meetings.userId, userId), eq(schema.meetings.id, edit.itemId)));
  return { itemType: "meeting", itemId: edit.itemId, label: topic };
}

/**
 * Add an action or an event the user typed rather than wrote.
 *
 * It joins the same list under the same rules a decoded item does, including the dedupe — "call
 * the dentist" typed while an open action already says so is one action, not two (rule 8). The
 * provenance is honest: `source: "app"` and no notebook or page, so nothing downstream counts
 * typing as decoding, and confidence is 1 because there was no guess involved.
 */
export async function createItem(db: Db, userId: string, item: NewItem, today: string): Promise<CreateResult> {
  const now = new Date();

  if (item.itemType === "task") {
    const text = trimmed(item.text);
    if (!text) throw new Error("an action needs words");
    // The same dedupe the nightly merge applies, for the same reason: two ways of saying the
    // same intent are one item. Open and carried only — a finished action written again is a
    // new one.
    const open = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, "open")) });
    const carried = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, "carried")) });
    const dup = [...open, ...carried].find((t) => similar(t.text, text));
    if (dup) return { itemType: "task", itemId: dup.id, created: false, label: dup.text };

    // The user is IN the namespace. `tasks.id` is a bare primary key, so an id derived from text
    // and date alone is shared by everyone who writes the same words on the same day — and
    // `onConflictDoNothing` would then silently drop the second person's item and hand them back
    // a row belonging to the first. Invisible while there is one account; data loss across two.
    const id = stableId(`task:app:${userId}:${today}`, text);
    const inserted = await db
      .insert(schema.tasks)
      .values({
        id,
        userId,
        text,
        due: orNull(item.due),
        dueTime: orNull(item.dueTime),
        priority: item.priority ?? "normal",
        kind: item.kind ?? "action",
        project: orNull(item.project),
        people: [],
        confidence: 1,
        sourceConvention: null,
        sourceNotebook: null,
        sourcePageIndex: null,
        sourcePageDate: null,
        status: "open",
        carriedCount: 0,
        lastAgedOn: today,
        createdOn: today,
        completedOn: null,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    // Nothing came back: this exact item already exists. Say so rather than claiming a creation.
    return { itemType: "task", itemId: id, created: inserted.length > 0, label: text };
  }

  const title = trimmed(item.title);
  if (!title) throw new Error("an event needs a title");
  const date = orNull(item.date);
  const active = await db.query.events.findMany({ where: and(eq(schema.events.userId, userId), eq(schema.events.status, "active")) });
  const dup = active.find((e) => e.date === date && similar(e.title, title));
  if (dup) return { itemType: "event", itemId: dup.id, created: false, label: dup.title };

  const id = stableId(`event:app:${userId}`, `${title} ${date ?? ""} ${item.startTime ?? ""}`);
  const inserted = await db
    .insert(schema.events)
    .values({
      id,
      userId,
      title,
      date,
      startTime: orNull(item.startTime),
      endTime: orNull(item.endTime),
      location: orNull(item.location),
      people: [],
      source: "app",
      confidence: 1,
      status: "active",
      recurrence: item.recurrence ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  return { itemType: "event", itemId: id, created: inserted.length > 0, label: title };
}
