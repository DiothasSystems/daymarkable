/**
 * Notes whose tablet page or notebook was deleted leave the live Notes notebook (sourceGone.ts).
 *
 * The failure this guards against is the quiet one in the other direction: a sync fault or a quiet
 * night must never hide a note whose page is still on the tablet.
 */
import { Sealer, eq, generateKey, openDb, parseKey, schema, type DbHandle } from "@daymarkable/db";
import type { TabletDocument } from "@daymarkable/tablet";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as repo from "./repo.js";
import { sourceGoneVerdicts, type NoteSource } from "./sourceGone.js";

const doc = (id: string, name: string): TabletDocument => ({ id, hash: "h", name, path: `/${name}`, parentId: "", fileType: "notebook", lastModified: null, pageCount: 1 });
const note = (over: Partial<NoteSource> = {}): NoteSource => ({ id: "n", sourceNotebook: "Work", sourceDocId: "d1", sourcePageId: "p1", sourceGone: null, ...over });

describe("sourceGoneVerdicts", () => {
  const tree = [doc("d1", "Work"), doc("d2", "Home")];

  it("a notebook missing from tonight's tree is gone", () => {
    expect(sourceGoneVerdicts([note({ sourceDocId: "deleted" })], tree, new Map()).get("n")).toBe("notebook");
  });

  it("a page is gone only when its notebook's pages were listed and it was not among them", () => {
    const listed = new Map([["d1", new Set(["p2"])]]);
    expect(sourceGoneVerdicts([note()], tree, listed).get("n")).toBe("page");
    expect(sourceGoneVerdicts([note()], tree, new Map([["d1", new Set(["p1"])]])).get("n")).toBe("present");
  });

  it("a quiet night neither proves nor clears a deleted page", () => {
    expect(sourceGoneVerdicts([note({ sourceGone: "page" })], tree, new Map()).get("n")).toBe("unknown");
  });

  it("a notebook restored from the trash brings its notes back", () => {
    expect(sourceGoneVerdicts([note({ sourceGone: "notebook" })], tree, new Map()).get("n")).toBe("present");
  });

  it("an empty tree proves nothing", () => {
    expect(sourceGoneVerdicts([note({ sourceDocId: "deleted" })], [], new Map()).get("n")).toBe("unknown");
  });

  it("a note read before ids were recorded is judged by its notebook's name", () => {
    const legacy = (name: string | null) => note({ sourceDocId: null, sourcePageId: null, sourceNotebook: name });
    expect(sourceGoneVerdicts([legacy("Work")], tree, new Map()).get("n")).toBe("present");
    expect(sourceGoneVerdicts([legacy("Old project")], tree, new Map()).get("n")).toBe("notebook");
    expect(sourceGoneVerdicts([legacy("")], tree, new Map()).get("n")).toBe("unknown");
  });
});

describe("applySourceGone", () => {
  let handle: DbHandle;
  let sealer: Sealer;
  let userId: string;

  beforeAll(async () => {
    handle = await openDb("pglite://memory");
    await handle.migrate();
    sealer = new Sealer(parseKey(generateKey()));
    userId = (await repo.ensureUser(handle.db, "gone@example.com", "UTC")).id;
  });
  afterAll(() => handle.close());
  beforeEach(async () => {
    await handle.db.delete(schema.meetings);
  });

  const insert = (id: string, extra: Partial<typeof schema.meetings.$inferInsert> = {}) =>
    handle.db.insert(schema.meetings).values({ id, userId, topic: id, date: "2026-09-20", confidence: 0.9, bodyEnc: sealer.sealJson({ text: "", decisions: [], actions: [] }), ...extra });

  it("hides a deleted notebook's note, carries the flag into the working set, and restores it", async () => {
    await insert("deleted", { sourceNotebook: "Scratch", sourceDocId: "gone-doc", sourcePageId: "p" });
    await insert("kept", { sourceNotebook: "Work", sourceDocId: "d1", sourcePageId: "p1" });
    const tree = [doc("d1", "Work")];

    expect(await repo.applySourceGone(handle.db, userId, (n) => sourceGoneVerdicts(n, tree, new Map()))).toEqual({ hidden: 1, restored: 0 });
    const row = await handle.db.query.meetings.findFirst({ where: eq(schema.meetings.id, "deleted") });
    expect(row?.sourceGone).toBe("notebook");
    expect(row?.sourceGoneAt).toBeInstanceOf(Date);

    const ws = await repo.loadWorkingSet(handle.db, sealer, userId);
    expect(ws.meetings.find((m) => m.id === "deleted")?.sourceGone).toBe("notebook");
    expect(ws.meetings.find((m) => m.id === "kept")?.sourceGone).toBeUndefined();
    expect(ws.meetings.find((m) => m.id === "kept")?.source).toMatchObject({ docId: "d1", pageId: "p1" });

    // Saving the working set (as every run does) must not clear the flag.
    const run = await repo.createRun(handle.db, { userId, localDate: "2026-09-21", kind: "nightly", seq: 0, requestedVia: "test", decodeModel: "test", cacheDir: null });
    await repo.saveWorkingSet(handle.db, sealer, userId, run.id, ws, []);
    expect((await handle.db.query.meetings.findFirst({ where: eq(schema.meetings.id, "deleted") }))?.sourceGone).toBe("notebook");

    // A second night with the same tree writes nothing.
    expect(await repo.applySourceGone(handle.db, userId, (n) => sourceGoneVerdicts(n, tree, new Map()))).toEqual({ hidden: 0, restored: 0 });

    // Restored from the trash.
    const back = [...tree, doc("gone-doc", "Scratch")];
    expect(await repo.applySourceGone(handle.db, userId, (n) => sourceGoneVerdicts(n, back, new Map()))).toEqual({ hidden: 0, restored: 1 });
    const again = await handle.db.query.meetings.findFirst({ where: eq(schema.meetings.id, "deleted") });
    expect(again?.sourceGone).toBeNull();
    expect(again?.sourceGoneAt).toBeNull();
  });
});
