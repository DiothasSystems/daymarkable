/**
 * Editing the working set by hand (edits.ts).
 *
 * The property this file exists to protect is the one in the module header: an edit must not be
 * mistaken for a correction. `correctItem` teaches the decoder; `updateItem` must not, or the
 * mobile app fills the lexicon with words that were never on a page.
 */
import { Sealer, eq, generateKey, openDb, parseKey, schema, type DbHandle } from "@daymarkable/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ItemNotFound, createItem, getItem, updateItem } from "./edits.js";
import * as repo from "./repo.js";

let handle: DbHandle;
let sealer: Sealer;
let userId: string;
let otherId: string;
const TODAY = "2026-09-14";

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
  sealer = new Sealer(parseKey(generateKey()));
  userId = (await repo.ensureUser(handle.db, "edits@example.com", "UTC")).id;
  otherId = (await repo.ensureUser(handle.db, "someone-else@example.com", "UTC")).id;
});
afterAll(() => handle.close());

beforeEach(async () => {
  await handle.db.delete(schema.tasks);
  await handle.db.delete(schema.events);
  await handle.db.delete(schema.meetings);
  await handle.db.delete(schema.corrections);
});

async function task(id: string, text: string, extra: Partial<typeof schema.tasks.$inferInsert> = {}, owner = userId) {
  await handle.db.insert(schema.tasks).values({ id, userId: owner, text, confidence: 0.62, createdOn: TODAY, lastAgedOn: TODAY, ...extra });
  return id;
}

async function event(id: string, title: string, extra: Partial<typeof schema.events.$inferInsert> = {}) {
  await handle.db.insert(schema.events).values({ id, userId, title, confidence: 0.7, source: "ink", ...extra });
  return id;
}

async function meeting(id: string, topic: string, body: { text: string; decisions: string[]; actions: string[] }) {
  await handle.db.insert(schema.meetings).values({ id, userId, topic, confidence: 0.8, bodyEnc: sealer.sealJson(body) });
  return id;
}

const taskRow = (id: string) => handle.db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
const eventRow = (id: string) => handle.db.query.events.findFirst({ where: eq(schema.events.id, id) });
const meetingRow = (id: string) => handle.db.query.meetings.findFirst({ where: eq(schema.meetings.id, id) });

describe("updateItem", () => {
  it("teaches the decoder nothing — that is what corrections are for", async () => {
    // The whole reason this module is separate from correctItem. A plan that changed is not
    // evidence about handwriting, and promoting "Friday" into the lexicon would be a lie about
    // what was on the page.
    await task("t1", "Call the dentist");
    await updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t1", patch: { text: "Call the dentist on Friday", due: "2026-09-18" } });
    expect(await handle.db.query.corrections.findMany()).toEqual([]);
    const user = await repo.getUser(handle.db, userId);
    expect(user.settings.lexicon).toEqual([]);
  });

  it("changes only the fields it was given", async () => {
    await task("t2", "Draft the Q4 note", { due: "2026-09-20", priority: "high", project: "Q4", kind: "follow_up" });
    await updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t2", patch: { priority: "low" } });
    const row = await taskRow("t2");
    expect(row).toMatchObject({ text: "Draft the Q4 note", due: "2026-09-20", priority: "low", project: "Q4", kind: "follow_up" });
  });

  it("treats an emptied field as absent rather than blank", async () => {
    await task("t3", "Book the room", { due: "2026-09-20", project: "Offsite" });
    await updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t3", patch: { due: null, project: "   " } });
    expect(await taskRow("t3")).toMatchObject({ due: null, project: null });
  });

  it("stops being a guess once the words are the user's", async () => {
    await task("t4", "Call Kolb");
    await updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t4", patch: { text: "Call Cobb" } });
    expect((await taskRow("t4"))!.confidence).toBe(1);

    // A field change that leaves the words alone says nothing about the reading, so it leaves
    // the decoder's confidence where it was.
    await task("t5", "Call Kolb");
    await updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t5", patch: { priority: "high" } });
    expect((await taskRow("t5"))!.confidence).toBeCloseTo(0.62);
  });

  it("moves an event's date, time, place and recurrence", async () => {
    await event("e1", "Standup", { date: "2026-09-14", startTime: "09:00", endTime: "09:15" });
    await updateItem(handle.db, sealer, userId, {
      itemType: "event",
      itemId: "e1",
      patch: { date: "2026-09-17", startTime: "10:30", endTime: null, location: "Room 2", recurrence: "weekly" },
    });
    expect(await eventRow("e1")).toMatchObject({ date: "2026-09-17", startTime: "10:30", endTime: null, location: "Room 2", recurrence: "weekly" });
  });

  it("rewrites a note body through the sealer, leaving the rest of it alone", async () => {
    await meeting("m1", "Pricing", { text: "We discussed tiers.", decisions: ["Hold at $10"], actions: ["Send the deck"] });
    await updateItem(handle.db, sealer, userId, {
      itemType: "meeting",
      itemId: "m1",
      patch: { text: "We discussed tiers and landed on two.", time: "14:00" },
    });
    const row = await meetingRow("m1");
    expect(row!.time).toBe("14:00");
    const body = sealer.openJson<{ text: string; decisions: string[]; actions: string[] }>(row!.bodyEnc);
    expect(body).toEqual({ text: "We discussed tiers and landed on two.", decisions: ["Hold at $10"], actions: ["Send the deck"] });
  });

  it("keeps the note body encrypted at rest", async () => {
    await meeting("m2", "Renewal", { text: "Acme renews in March.", decisions: [], actions: [] });
    await updateItem(handle.db, sealer, userId, { itemType: "meeting", itemId: "m2", patch: { text: "Acme renews in April." } });
    const row = await meetingRow("m2");
    expect(row!.bodyEnc).not.toContain("April");
    expect(row!.bodyEnc).not.toContain("Acme");
  });

  it("refuses to empty an item rather than storing a blank one", async () => {
    await task("t6", "Something");
    await expect(updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t6", patch: { text: "   " } })).rejects.toThrow(/needs words/);
    expect((await taskRow("t6"))!.text).toBe("Something");
  });

  it("will not edit another account's item", async () => {
    await task("t7", "Not yours", {}, otherId);
    await expect(updateItem(handle.db, sealer, userId, { itemType: "task", itemId: "t7", patch: { text: "Mine now" } })).rejects.toThrow(ItemNotFound);
    expect((await taskRow("t7"))!.text).toBe("Not yours");
  });
});

describe("getItem", () => {
  it("hands an editor the series anchor, not the occurrence a list would show", async () => {
    // The hazard this exists to avoid: getRegistry and getCalendar both project a series onto a
    // date it lands on. An editor that loaded one of those and saved it back would rewrite the
    // anchor, rescheduling every future occurrence because someone fixed a typo in the title.
    await event("e10", "Board meeting", { date: "2026-01-05", recurrence: "monthly", status: "active" });
    const item = await getItem(handle.db, sealer, userId, "event", "e10");
    expect(item).toMatchObject({ itemType: "event", date: "2026-01-05", recurrence: "monthly" });
  });

  it("unseals a note body for editing", async () => {
    await meeting("m10", "Pricing", { text: "Two tiers.", decisions: ["Hold at $10"], actions: ["Send the deck"] });
    expect(await getItem(handle.db, sealer, userId, "meeting", "m10")).toMatchObject({
      topic: "Pricing",
      text: "Two tiers.",
      decisions: ["Hold at $10"],
      actions: ["Send the deck"],
    });
  });

  it("reports what the decoder made of it, so an editor can offer to correct the reading", async () => {
    await task("t10", "Call Kolb", { confidence: 0.44 });
    expect(await getItem(handle.db, sealer, userId, "task", "t10")).toMatchObject({ text: "Call Kolb", confidence: 0.44 });
  });

  it("will not open another account's item", async () => {
    await task("t11", "Not yours", {}, otherId);
    await expect(getItem(handle.db, sealer, userId, "task", "t11")).rejects.toThrow(ItemNotFound);
  });
});

describe("createItem", () => {
  it("adds an action the user typed, with honest provenance", async () => {
    const r = await createItem(handle.db, userId, { itemType: "task", text: "Renew the domain", due: "2026-09-30", priority: "high" }, TODAY);
    expect(r.created).toBe(true);
    const row = await taskRow(r.itemId);
    expect(row).toMatchObject({
      text: "Renew the domain",
      due: "2026-09-30",
      priority: "high",
      status: "open",
      confidence: 1,
      // No page said this, and nothing downstream should count it as decoding.
      sourceNotebook: null,
      sourcePageIndex: null,
      createdRunId: null,
    });
  });

  it("folds into an open action that already says the same thing (rule 8)", async () => {
    await task("t8", "Call the dentist", { status: "open" });
    const r = await createItem(handle.db, userId, { itemType: "task", text: "call the dentist" }, TODAY);
    expect(r).toMatchObject({ created: false, itemId: "t8" });
    expect(await handle.db.query.tasks.findMany()).toHaveLength(1);
  });

  it("writes a finished action again rather than resurrecting it", async () => {
    await task("t9", "Water the plants", { status: "done", completedOn: TODAY });
    const r = await createItem(handle.db, userId, { itemType: "task", text: "Water the plants" }, TODAY);
    expect(r.created).toBe(true);
    expect(r.itemId).not.toBe("t9");
    expect((await taskRow("t9"))!.status).toBe("done");
  });

  it("marks a typed event as the app's, not the ink's", async () => {
    const r = await createItem(handle.db, userId, { itemType: "event", title: "Dentist", date: "2026-09-18", startTime: "11:00" }, TODAY);
    expect(await eventRow(r.itemId)).toMatchObject({ title: "Dentist", date: "2026-09-18", startTime: "11:00", source: "app", confidence: 1, status: "active" });
  });

  it("folds an event into one already on that day, and keeps a different day separate", async () => {
    await event("e2", "Dentist", { date: "2026-09-18", status: "active" });
    expect(await createItem(handle.db, userId, { itemType: "event", title: "dentist", date: "2026-09-18" }, TODAY)).toMatchObject({ created: false, itemId: "e2" });
    expect(await createItem(handle.db, userId, { itemType: "event", title: "Dentist", date: "2026-09-25" }, TODAY)).toMatchObject({ created: true });
  });

  it("does not hand one account's item to another who typed the same words", async () => {
    // Found by driving the live API: `tasks.id` is a bare primary key and the id was derived from
    // text and date alone, so two people writing "call the dentist" on the same day computed the
    // SAME id. The second insert hit onConflictDoNothing, vanished, and the caller was handed a
    // row belonging to the first. Invisible with one account; cross-account data loss with two.
    const mine = await createItem(handle.db, userId, { itemType: "task", text: "Call the dentist" }, TODAY);
    const theirs = await createItem(handle.db, otherId, { itemType: "task", text: "Call the dentist" }, TODAY);
    expect(theirs.created).toBe(true);
    expect(theirs.itemId).not.toBe(mine.itemId);
    expect((await taskRow(theirs.itemId))!.userId).toBe(otherId);
    expect((await taskRow(mine.itemId))!.userId).toBe(userId);
  });

  it("says so rather than claiming a creation when the very same row already exists", async () => {
    const first = await createItem(handle.db, userId, { itemType: "event", title: "Dentist", date: "2026-10-01" }, TODAY);
    await handle.db.update(schema.events).set({ status: "dropped" }).where(eq(schema.events.id, first.itemId));
    // Dropped, so the dedupe no longer sees it — but the row is still there under the same id.
    const again = await createItem(handle.db, userId, { itemType: "event", title: "Dentist", date: "2026-10-01" }, TODAY);
    expect(again).toMatchObject({ itemId: first.itemId, created: false });
  });

  it("refuses an empty item", async () => {
    await expect(createItem(handle.db, userId, { itemType: "task", text: "  " }, TODAY)).rejects.toThrow(/needs words/);
    await expect(createItem(handle.db, userId, { itemType: "event", title: "" }, TODAY)).rejects.toThrow(/needs a title/);
  });
});
