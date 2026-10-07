/**
 * End-to-end pipeline test on fixtures: in-memory Postgres (PGlite), fixture tablet/renderer/
 * decoder, memory mail. No network, no keys. Exercises change detection, idempotency, merge,
 * compose, upload, email, and the cache rotation + purge log.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEWS_TOPICS } from "@daymarkable/core";
import { Sealer, generateKey, openDb, parseKey, schema, eq, type DbHandle } from "@daymarkable/db";
import { zeroUsage } from "@daymarkable/decode";
import { MemoryProvider } from "@daymarkable/mail";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalCacheStore } from "./cache.js";
import { FixtureDecoder, FixtureRenderer, FixtureTabletProvider } from "./fixtures.js";
import * as repo from "./repo.js";
import type { TabletDocument, TabletFolder, TabletProvider, TabletTree } from "@daymarkable/tablet";
import {
  FIRST_SIGHT_MAX_INKED_PAGES,
  FIRST_SIGHT_TAIL_PAGES,
  HEADLINES_FOLDER,
  LEGACY_OUTPUT_NAMES,
  OUTPUT_NAMES,
  PUZZLE_FOLDER,
  changeWindowStart,
  cleanStaleOutputs,
  inKeepFolder,
  inWatchedFolder,
  isOurDocument,
  migrateBrandFolders,
  publishDailyNotes,
  outputFolderFor,
  pageChanged,
  runPipeline,
  selectDocuments,
  writtenOn,
  type PipelineDeps,
} from "./run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "..", "..", "..", "fixtures", "notebooks");

let handle: DbHandle;
let tmp: string;
let deps: PipelineDeps;
let userId: string;
let tablet: FixtureTabletProvider;
let mail: MemoryProvider;
const logs: string[] = [];

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dm-run-"));
  handle = await openDb("pglite://memory");
  await handle.migrate();
  const sealer = new Sealer(parseKey(generateKey()));
  const user = await repo.ensureUser(handle.db, "test@example.com", "America/New_York");
  userId = user.id;
  tablet = new FixtureTabletProvider(FIXTURES, path.join(tmp, "tablet"), new Date());
  mail = new MemoryProvider();
  deps = {
    db: handle.db,
    sealer,
    cache: new LocalCacheStore(path.join(tmp, "cache"), sealer),
    tablet,
    renderer: new FixtureRenderer(FIXTURES),
    decoder: new FixtureDecoder(FIXTURES),
    mail,
    decodeModel: "fixture-model",
    newsModel: "fixture-model",
    log: (m) => logs.push(m),
    now: () => DateTime.fromISO("2026-09-02T07:05:00Z"),
  };
});

afterAll(async () => {
  await handle.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("runPipeline (fixtures)", () => {
  it("first nightly run processes the changed notebook and produces the three notebooks", async () => {
    // An edit made before the run left "send these to your tablet" waiting. The run delivers the
    // same notebooks, so the prompt must not survive it — see repo.clearPendingDelivery.
    const before = await repo.getUser(handle.db, userId);
    await handle.db
      .update(schema.users)
      .set({ settings: { ...before.settings, pendingDelivery: "2026-09-01T22:00:00.000Z" } })
      .where(eq(schema.users.id, userId));
    const out = await runPipeline(deps, { userId, kind: "nightly", requestedVia: "test" });
    expect(out.status).toBe("succeeded");
    expect(out.stats!.docsChanged).toBe(1);
    expect(out.stats!.pagesDecoded).toBe(1);
    expect(out.stats!.tasksFound).toBeGreaterThan(0);
    // The Daily Puzzle rides along: on by default, deterministic, and free. The Daily Update does
    // not, because this account has set no topics to search for.
    // The day's Notes are dated by the day the writing was done: the night's run reads the day that
    // just ended (the fixture page carries no timestamp of its own).
    expect(tablet.uploads.map((u) => u.name).sort()).toEqual(["Action List", "Daily Puzzle", "Notes - 09-01-2026", "Planner"]);
    const docs = await handle.db.query.documents.findMany({ where: eq(schema.documents.userId, userId) });
    expect(docs.map((d) => d.kind).sort()).toEqual(["action_list", "daily_puzzle", "meeting_notes", "planner"]);
    // Still one cost row: the puzzle is generated, not asked for. Nothing here called a model
    // except the decode itself, which is the property that makes the puzzle free to ship.
    const costs = await handle.db.query.runCosts.findMany();
    expect(costs).toHaveLength(1);
    expect((await repo.getUser(handle.db, userId)).settings.pendingDelivery).toBeNull();
    expect(costs[0]!.model).toBe("fixture-model");
    expect(costs[0]!.mode).toBe("batch");
    const cacheDirs = await readdir(path.join(tmp, "cache"));
    expect(cacheDirs).toHaveLength(1);
  });

  it("keeps the day's lines sealed and each page's reading as fingerprints, never as text (rule 5)", async () => {
    const days = await handle.db.query.dailyNotes.findMany({ where: eq(schema.dailyNotes.userId, userId) });
    expect(days.map((d) => d.localDate)).toEqual(["2026-09-01"]);
    expect(days[0]!.bodyEnc).not.toContain("Plume");
    expect(deps.sealer.openJson<string[]>(days[0]!.bodyEnc)[0]).toContain("Dave from Plume");
    const readings = await handle.db.query.pageReadings.findMany({ where: eq(schema.pageReadings.userId, userId) });
    expect(readings).toHaveLength(1);
    const stored = JSON.stringify(readings[0]!.lines);
    for (const word of ["Dave", "dave", "plume", "Cellular", "roadmap"]) expect(stored).not.toContain(word);
    expect(readings[0]!.lines[0]!.length).toBeGreaterThan(0);
  });

  it("keeps every day's Notes for the web and the app, and deletes a day only when asked", async () => {
    const history = await repo.loadDailyNotesHistory(handle.db, deps.sealer, userId);
    expect(history.map((e) => e.date)).toEqual(["2026-09-01"]);
    // Another account's day is not this one's to delete.
    const other = await repo.ensureUser(handle.db, "someone@example.com", "UTC");
    expect(await repo.deleteDailyNotesDay(handle.db, other.id, "2026-09-01")).toBe(0);
    expect(await repo.loadDailyNotesHistory(handle.db, deps.sealer, userId)).toHaveLength(1);
  });

  it("re-running the same local date is skipped (idempotent, rule 4)", async () => {
    const out = await runPipeline(deps, { userId, kind: "nightly", requestedVia: "test" });
    expect(out.status).toBe("skipped");
  });

  it("unchanged pages are not processed again; previous cache is purged and logged (rules 2 and 5)", async () => {
    logs.length = 0;
    const out = await runPipeline(deps, { userId, kind: "nightly", requestedVia: "test", localDate: "2026-09-03" });
    expect(out.status).toBe("succeeded");
    expect(out.stats!.docsChanged).toBe(0);
    expect(out.stats!.pagesDecoded).toBe(0);
    expect(out.stats!.purgedRunId).not.toBeNull();
    expect(out.stats!.purgedFiles).toBeGreaterThan(0);
    expect(logs.some((l) => l.startsWith("cache rotated: purged run"))).toBe(true);
    const cacheDirs = await readdir(path.join(tmp, "cache"));
    expect(cacheDirs).toHaveLength(1);
    // The Action List is regenerated from the canonical open set, not from tonight's (empty) pages.
    const tasks = await handle.db.query.tasks.findMany({ where: eq(schema.tasks.userId, userId) });
    expect(tasks.filter((t) => t.status === "carried").length).toBeGreaterThan(0);
  });

  it("a run whose pages all fail to decode is failed, and those pages are retried next run", async () => {
    const u = await repo.ensureUser(handle.db, "retry@example.com", "America/New_York");
    const failing: PipelineDeps = {
      ...deps,
      decoder: {
        decodePages: async (pages, mode) =>
          pages.map((p) => ({ key: p.key, extraction: null, raw: "", error: "API 401: invalid x-api-key", usage: [{ ...zeroUsage(), model: "fixture-model", mode, pages: 1, cost_usd: 0 }], escalated: false })),
      },
    };
    const bad = await runPipeline(failing, { userId: u.id, kind: "on_demand", requestedVia: "test", localDate: "2026-09-10", windowHours: 24 * 30 });
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/failed to decode/);
    // The tablet keeps yesterday's notebooks: nothing was composed or uploaded.
    const uploadsBefore = tablet.uploads.length;
    // Nothing was recorded as seen, so a working decoder finds the same page again.
    const good = await runPipeline(deps, { userId: u.id, kind: "on_demand", requestedVia: "test", localDate: "2026-09-10", windowHours: 24 * 30 });
    expect(good.status).toBe("succeeded");
    expect(good.stats!.pagesDecoded).toBe(1);
        // Four now: the three lists plus the Daily Puzzle, which is on by default and costs nothing.
    // The Daily Update is absent because this account has set no topics.
    expect(tablet.uploads.length).toBe(uploadsBefore + 4);
  });

  it("the night's delivery mail carries the day's Notes even when a sync already read the writing", async () => {
    const u = await repo.ensureUser(handle.db, "delivery@example.com", "America/New_York");
    const s = (await repo.getUser(handle.db, u.id)).settings;
    await handle.db
      .update(schema.users)
      .set({ settings: { ...s, deliveryEmail: "pdfs@example.com", deliveryVerifiedAt: "2026-09-01T00:00:00.000Z", deliveryDocuments: { planner: true, actionList: true, meetingNotes: true } } })
      .where(eq(schema.users.id, u.id));
    // An evening Sync now reads the page: the day's Notes are made then.
    const sync = await runPipeline(deps, { userId: u.id, kind: "on_demand", requestedVia: "test", localDate: "2026-09-20", windowHours: 24 * 30 });
    expect(sync.status).toBe("succeeded");
    // At midnight nothing is new, so the night composes no Notes of its own.
    mail.sent.length = 0;
    const night = await runPipeline(deps, { userId: u.id, kind: "nightly", requestedVia: "scheduler", localDate: "2026-09-21" });
    expect(night.status).toBe("succeeded");
    expect(night.stats!.pagesDecoded).toBe(0);
    const delivered = mail.sent.find((m) => m.to === "pdfs@example.com");
    expect(delivered?.attachments?.map((a) => a.filename)).toContain("Notes-09-20-2026.pdf");
    // Deleting the day takes it out of the store; nothing else about the account changes.
    expect(await repo.deleteDailyNotesDay(handle.db, u.id, "2026-09-20")).toBeGreaterThan(0);
    expect(await repo.loadDailyNotesHistory(handle.db, deps.sealer, u.id)).toHaveLength(0);
    expect(await handle.db.query.pageReadings.findMany({ where: eq(schema.pageReadings.userId, u.id) })).not.toHaveLength(0);
  });

  it("on-demand runs get sequential keys and satisfy the date for the scheduler (rule 11)", async () => {
    const a = await runPipeline(deps, { userId, kind: "on_demand", requestedVia: "web", localDate: "2026-09-04" });
    const b = await runPipeline(deps, { userId, kind: "on_demand", requestedVia: "mobile", localDate: "2026-09-04" });
    expect(a.status).toBe("succeeded");
    expect(b.status).toBe("succeeded");
    const runs = await handle.db.query.runs.findMany({ where: eq(schema.runs.localDate, "2026-09-04") });
    expect(runs.map((r) => r.seq).sort()).toEqual([1, 2]);
    const nightly = await runPipeline(deps, { userId, kind: "nightly", requestedVia: "scheduler", localDate: "2026-09-04" });
    expect(nightly.status).toBe("skipped");
    const since = await repo.onDemandRunsSince(handle.db, userId, new Date(Date.now() - 24 * 3600_000));
    expect(since).toHaveLength(2);
  });

  it("a note whose notebook was deleted from the tablet leaves the live Notes notebook, and comes back with it", async () => {
    const notes = () => handle.db.query.meetings.findMany({ where: eq(schema.meetings.userId, userId) });
    const before = await notes();
    expect(before.length).toBeGreaterThan(0);
    // Every note read by a run knows which notebook and page it came from.
    expect(before.every((m) => m.sourceDocId && m.sourcePageId)).toBe(true);
    expect(before.every((m) => m.sourceGone === null)).toBe(true);

    // Deleted: the notebook is in the trash, which the tree does not list. Something else is still
    // on the tablet, so the tree is not empty (an empty one would prove nothing).
    const real = tablet.listTree.bind(tablet);
    tablet.listTree = async () => {
      const t = await real();
      return { ...t, documents: [{ ...t.documents[0]!, id: "archived-planner", name: "Planner 2026-08-30", path: "/ScriptumIQ/Archive/Planner 2026-08-30" }] };
    };
    try {
      logs.length = 0;
      const out = await runPipeline(deps, { userId, kind: "on_demand", requestedVia: "test", localDate: "2026-09-05" });
      expect(out.error ?? out.status).toBe("succeeded");
      expect((await notes()).every((m) => m.sourceGone === "notebook")).toBe(true);
      expect(logs.some((l) => l.startsWith(`notes: ${before.length} left the live notebook`))).toBe(true);
    } finally {
      tablet.listTree = real;
    }

    // Restored from the trash.
    const back = await runPipeline(deps, { userId, kind: "on_demand", requestedVia: "test", localDate: "2026-09-06" });
    expect(back.status).toBe("succeeded");
    expect((await notes()).every((m) => m.sourceGone === null)).toBe(true);
  });
});

describe("selection and windows", () => {
  const doc = (p: string, fileType: "notebook" | "pdf" | "epub" = "notebook") => ({ id: p, hash: "h", name: p.split("/").pop()!, path: p, parentId: "", fileType, lastModified: null, pageCount: 0 });
  it("watches notebooks in watch folders, always includes ScriptumIQ outputs, never the archive", () => {
    const docs = [doc("/Work/Meetings"), doc("/Personal/Journal"), doc("/ScriptumIQ/Planner", "pdf"), doc("/ScriptumIQ/Archive/Planner 2026-09-01", "pdf"), doc("/Books/Novel", "epub"), doc("/Work/Spec", "pdf")];
    expect(selectDocuments(docs, { watchFolders: ["/Work"], includePdfs: false }).map((d) => d.path)).toEqual(["/Work/Meetings", "/ScriptumIQ/Planner"]);
    expect(selectDocuments(docs, { watchFolders: [], includePdfs: true }).map((d) => d.path)).toEqual(["/Work/Meetings", "/Personal/Journal", "/ScriptumIQ/Planner", "/Work/Spec"]);
  });
  it("recognises our own notebooks in either location, and never the archive", () => {
    expect(isOurDocument(doc("/ScriptumIQ/Planner", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Planner", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Action List", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Handwriting Sample", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/ScriptumIQ/Archive/Planner 2026-09-01", "pdf"))).toBe(false);
    // A user's own notebook that happens to sit in the root is not ours.
    expect(isOurDocument(doc("/Plume"))).toBe(false);
    // Nor is one merely named like ours but filed elsewhere.
    expect(isOurDocument(doc("/Work/Planner"))).toBe(false);
    expect(outputFolderFor({ outputToRoot: false })).toBe("/ScriptumIQ");
    expect(outputFolderFor({ outputToRoot: true })).toBe("/");
  });

  it("still recognises the old Notes names, and removes them", async () => {
    // Renaming the notebook must not leave the old file behind looking like the user's own —
    // it would be decoded straight back into itself. "Notes" is the meetings-only notebook the
    // daily "Notes - <date>" replaced; "Meeting Notes" is the name before that.
    expect(isOurDocument(doc("/Notes", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Meeting Notes", "pdf"))).toBe(true);

    const deleted: string[] = [];
    const tabletStub = { deleteDocument: async (d: { name: string }) => void deleted.push(d.name) } as never;
    const inFolder = { ...doc("/ScriptumIQ/Meeting Notes", "pdf"), parentId: "folder" };
    const oldNotes = { ...doc("/ScriptumIQ/Notes", "pdf"), parentId: "folder" };
    const current = { ...doc("/ScriptumIQ/Notes - 10-01-2026", "pdf"), parentId: "folder" };
    const elsewhere = { ...doc("/Planner", "pdf"), parentId: "root" };
    const removed = await cleanStaleOutputs(tabletStub, [inFolder, oldNotes, current, elsewhere], "folder", () => {});
    // The legacy names go even though they are in the right folder; the current one stays.
    expect(deleted.sort()).toEqual(["Meeting Notes", "Notes", "Planner"]);
    expect(removed).toBe(3);
  });
  it("treats the root as a selectable folder without swallowing everything under it", () => {
    const docs = [doc("/Loose Notes"), doc("/Another"), doc("/Work/Meetings"), doc("/Work/Deep/Nested")];
    // Root selected: only notebooks sitting directly in the root.
    expect(selectDocuments(docs, { watchFolders: ["/"], includePdfs: false }).map((d) => d.path)).toEqual(["/Loose Notes", "/Another"]);
    // A named folder still includes its subfolders, and excludes the root.
    expect(selectDocuments(docs, { watchFolders: ["/Work"], includePdfs: false }).map((d) => d.path)).toEqual(["/Work/Meetings", "/Work/Deep/Nested"]);
    // Both together.
    expect(selectDocuments(docs, { watchFolders: ["/", "/Work"], includePdfs: false })).toHaveLength(4);
    expect(inWatchedFolder("/Loose Notes", "/")).toBe(true);
    expect(inWatchedFolder("/Work/Meetings", "/")).toBe(false);
  });
  it("decides page changes by hash, and by page timestamp only on first sight of a document", () => {
    const w = DateTime.fromISO("2026-09-01T00:00:00", { zone: "America/New_York" });
    const snap = new Map<string, string | null>([["p1", "h1"], ["p2", "h2"]]);
    const seen = { pagesNeverSeen: false, tailPageIds: new Set<string>() };
    // On first sight the tail is whichever page ids carry ink; these cases name them directly.
    const first = (...tail: string[]) => ({ pagesNeverSeen: true, tailPageIds: new Set(tail) });

    // Snapshotted pages: the hash decides, whatever the timestamp says.
    expect(pageChanged({ pageId: "p1", index: 0, hash: "h1", modified: null }, snap, w)).toBe(false);
    expect(pageChanged({ pageId: "p2", index: 1, hash: "h9", modified: "1000" }, snap, w)).toBe(true);
    expect(pageChanged({ pageId: "blank", index: 2, hash: null, modified: null }, snap, w)).toBe(false);

    // A page added to a notebook whose pages we have recorded is new ink: read it regardless of
    // when the cloud claims it was written. This is the first defect — page 2 of a tracked
    // notebook was dropped because its timestamp did not parse the way this code assumed.
    expect(pageChanged({ pageId: "added", index: 3, hash: "h", modified: "1761573438256" }, snap, w, seen)).toBe(true);
    expect(pageChanged({ pageId: "added-secs", index: 4, hash: "h", modified: "1757000000" }, snap, w, seen)).toBe(true);

    // No page record at all: the timestamp keeps an old notebook's history out. This is the
    // SECOND defect — a document can hold a hash snapshot with no page rows behind it, and
    // reading that as "we know this notebook" decoded a year of an existing one in one night.
    const none = new Map<string, string | null>();
    expect(pageChanged({ pageId: "ancient", index: 0, hash: "h", modified: "1761573438256" }, none, w, first())).toBe(false);
    expect(pageChanged({ pageId: "recent", index: 1, hash: "h", modified: "1788288231187" }, none, w, first())).toBe(true);

    // First sight of a whole document: the timestamp keeps an old notebook's history out.
    expect(pageChanged({ pageId: "new-old", index: 0, hash: "h", modified: "1761573438256" }, snap, w, first())).toBe(false);
    expect(pageChanged({ pageId: "new-fresh", index: 1, hash: "h", modified: "1788288231187" }, snap, w, first())).toBe(true);
    // Epoch SECONDS, which read as 1970 before and silently skipped the page.
    expect(pageChanged({ pageId: "new-secs", index: 2, hash: "h", modified: "1788288231" }, snap, w, first())).toBe(true);
    expect(pageChanged({ pageId: "old-secs", index: 3, hash: "h", modified: "1761573438" }, snap, w, first())).toBe(false);
  });

  /**
   * The THIRD defect, 2026-09-15. Pages that carry no timestamp do not carry one individually: a
   * whole notebook of them read as new the moment the notebook was touched, and three notebooks
   * became 44 pages, 20 meetings spanning 2025-01 to 2026-09, and 19 emails. The tail is where
   * reMarkable puts new writing, so read that and baseline the rest.
   */
  it("reads only the tail of an undatable notebook on first sight, not its whole history", () => {
    const w = DateTime.fromISO("2026-09-01T00:00:00", { zone: "America/New_York" });
    const none = new Map<string, string | null>();
    const page = (index: number) => ({ pageId: `p${index}`, index, hash: `h${index}`, modified: null });

    // A 40-page notebook, every page inked: the tail is the last three.
    const refs = Array.from({ length: 40 }, (_, i) => page(i));
    const tailPageIds = new Set(refs.filter((r) => r.hash).slice(-FIRST_SIGHT_TAIL_PAGES).map((r) => r.pageId));
    const firstSight = { pagesNeverSeen: true, tailPageIds };
    const read = refs.filter((r) => pageChanged(r, none, w, firstSight)).map((r) => r.index);
    expect(read).toEqual([37, 38, 39]);
    expect(read).toHaveLength(FIRST_SIGHT_TAIL_PAGES);

    // A short notebook is read whole, because its tail is the whole thing.
    const shortRefs = [page(0), page(1)];
    const shortSight = { pagesNeverSeen: true, tailPageIds: new Set(shortRefs.map((r) => r.pageId)) };
    expect(shortRefs.every((r) => pageChanged(r, none, w, shortSight))).toBe(true);

    // A real timestamp still decides when there is one — the tail rule is only for pages with none.
    expect(pageChanged({ pageId: "dated-old", index: 39, hash: "h", modified: "1761573438256" }, none, w, firstSight)).toBe(false);
    expect(pageChanged({ pageId: "dated-new", index: 0, hash: "h", modified: "1788288231187" }, none, w, firstSight)).toBe(true);

    // And once a notebook's pages ARE recorded, a new page is new ink wherever it sits.
    const snap = new Map<string, string | null>([["p0", "h0"]]);
    expect(pageChanged(page(5), snap, w, { pagesNeverSeen: false, tailPageIds: new Set() })).toBe(true);
  });

  /**
   * An annotated PDF template is why first sight is decided by how MUCH ink there is rather than
   * where it sits. A 226-page planner kit annotated on scattered days is deliberate writing, and a
   * tail measured from the end of the file reads three pages of it.
   */
  it("reads every annotated page of a template, wherever they sit in the file", () => {
    const w = DateTime.fromISO("2026-09-01T00:00:00", { zone: "America/New_York" });
    const none = new Map<string, string | null>();
    // 226 pages, twenty annotated on scattered days — none of them near the end.
    const inkedAt = new Set([3, 12, 18, 25, 31, 44, 57, 63, 78, 91, 104, 117, 130, 142, 155, 168, 181, 194, 207, 210]);
    const refs = Array.from({ length: 226 }, (_, i) => ({
      pageId: `d${i}`,
      index: i,
      hash: inkedAt.has(i) ? `ink${i}` : null,
      modified: null,
    }));
    const undatable = refs.filter((r) => r.hash);
    expect(undatable.length).toBeLessThanOrEqual(FIRST_SIGHT_MAX_INKED_PAGES);

    const tailPageIds = new Set(undatable.map((r) => r.pageId)); // sparse enough: read whole
    const read = refs.filter((r) => pageChanged(r, none, w, { pagesNeverSeen: true, tailPageIds })).map((r) => r.index);
    expect(read).toEqual([...inkedAt].sort((a, b) => a - b));
    // The 206 blank pages cost nothing: no ink layer, no hash, never decoded.
    expect(read).toHaveLength(20);
  });

  /**
   * And the other side of the same rule: a notebook carrying ink on page after page is a history,
   * not a day's work. This is 2026-09-15 — three of these became 44 pages and 19 emails.
   */
  it("holds back a notebook whose every page is inked, and says so", () => {
    const w = DateTime.fromISO("2026-09-01T00:00:00", { zone: "America/New_York" });
    const none = new Map<string, string | null>();
    const refs = Array.from({ length: 60 }, (_, i) => ({ pageId: `p${i}`, index: i, hash: `h${i}`, modified: null }));
    const undatable = refs.filter((r) => r.hash);
    expect(undatable.length).toBeGreaterThan(FIRST_SIGHT_MAX_INKED_PAGES);

    const tailPageIds = new Set(undatable.slice(-FIRST_SIGHT_TAIL_PAGES).map((r) => r.pageId));
    const read = refs.filter((r) => pageChanged(r, none, w, { pagesNeverSeen: true, tailPageIds })).map((r) => r.index);
    expect(read).toEqual([57, 58, 59]);
  });

  it("opens the window at local midnight of the previous day once the account has run", () => {
    const w = changeWindowStart("2026-09-02", "America/New_York", new Date("2026-09-01T07:00:00Z"));
    expect(w.toISO()).toBe("2026-09-01T00:00:00.000-04:00");
  });
  it("reads only the previous day on the very first run, not a week of history", () => {
    // A new account's first night is a night like any other: the trial shows the product on what is
    // written next, and older notebooks are baselined until they change.
    const first = changeWindowStart("2026-09-02", "America/New_York", null);
    expect(first.toISO()).toBe("2026-09-01T00:00:00.000-04:00");
    // An explicit override still wins.
    expect(changeWindowStart("2026-09-02", "America/New_York", null, 48).toUTC() <= DateTime.utc().minus({ hours: 47 })).toBe(true);
  });
  it("reaches further back when catching up after a missed night", () => {
    const catchUp = changeWindowStart("2026-09-05", "America/New_York", new Date("2026-09-02T07:30:00Z"));
    expect(catchUp.toUTC().toISO()).toBe("2026-09-02T06:30:00.000Z");
  });
});

describe("the daily Notes", () => {
  const doc = (p: string, parentId = "") => ({ id: p, hash: "h", name: p.split("/").pop()!, path: p, parentId, fileType: "pdf" as const, lastModified: null, pageCount: 0 });

  it("is ours wherever it is published, and never read back", () => {
    // Reading it back would report the printed lines as tomorrow's new handwriting, for ever.
    for (const d of [doc("/Notes - 10-01-2026"), doc("/ScriptumIQ/Notes - 10-01-2026")]) {
      expect(isOurDocument(d)).toBe(true);
      expect(selectDocuments([d], { watchFolders: [], includePdfs: true })).toHaveLength(0);
    }
    // The filed days are finished: not ours to tidy, not ever read.
    const filed = doc("/ScriptumIQ/Notes/Notes - 09-30-2026");
    expect(isOurDocument(filed)).toBe(false);
    expect(selectDocuments([filed], { watchFolders: [], includePdfs: true })).toHaveLength(0);
    // A user's own notebook that merely starts with the word is still theirs.
    expect(isOurDocument(doc("/Notes - project ideas"))).toBe(false);
  });

  it("dates writing by the page's own timestamp, else by the day the run reads", () => {
    const tz = "America/New_York";
    // 23:40 on the 1st, read by the run at 00:01 on the 2nd.
    expect(writtenOn("2026-10-02T03:40:00Z", "2026-10-02", tz, "nightly", "2026-10-01")).toBe("2026-10-01");
    expect(writtenOn(null, "2026-10-02", tz, "nightly", "2026-10-01")).toBe("2026-10-01");
    expect(writtenOn(null, "2026-10-01", tz, "on_demand", "2026-09-30")).toBe("2026-10-01");
    // A timestamp from long before the window is not a reason to file today's reading under it.
    expect(writtenOn("2026-03-01T12:00:00Z", "2026-10-02", tz, "nightly", "2026-10-01")).toBe("2026-10-01");
  });

  it("archived weeks from before the change are never read back in", () => {
    // Filing them anywhere the run reads would feed them into the next decode as if they were
    // the user's own notes.
    const archived = { id: "a", hash: "h", name: "Notes - Week of 09-06-2026", path: "/ScriptumIQ/Archive/Notes - Week of 09-06-2026", parentId: "arch", fileType: "pdf" as const, lastModified: null, pageCount: 0 };
    expect(selectDocuments([archived], { watchFolders: [], includePdfs: true })).toHaveLength(0);
    expect(isOurDocument(archived)).toBe(false);
  });
});

describe("publishing the daily Notes", () => {
  const folder: TabletFolder = { id: "out", hash: "h", name: "", path: "/", parentId: "" };
  const archive: TabletFolder = { id: "notes", hash: "h", name: "Notes", path: "/ScriptumIQ/Notes", parentId: "siq" };
  const live = (name: string, parentId = folder.id) => ({ id: `id:${name}:${parentId}`, hash: "h", name, path: `/${name}`, parentId, fileType: "pdf" as const, lastModified: null, pageCount: 1 });
  const note = (date: string) => ({ name: `Notes - ${date.slice(5, 7)}-${date.slice(8)}-${date.slice(0, 4)}`, notesDate: date, composed: { pdf: new Uint8Array([1]) } });

  function stub() {
    const calls: string[] = [];
    const tablet = {
      ensureFolder: async () => archive,
      moveDocument: async (d: { name: string }, to: TabletFolder) => (calls.push(`move ${d.name} -> ${to.id}`), { id: "m", hash: "h" }),
      deleteDocument: async (d: { name: string; parentId: string }) => void calls.push(`delete ${d.name} in ${d.parentId}`),
      uploadPdf: async (name: string, _b: Uint8Array, to: TabletFolder) => (calls.push(`upload ${name} -> ${to.id}`), { id: `new:${name}`, hash: "h" }),
    } as unknown as TabletProvider;
    return { calls, deps: { tablet } as unknown as PipelineDeps };
  }

  it("files the day that was live and puts the new day beside the Planner", async () => {
    const { calls, deps } = stub();
    const r = await publishDailyNotes(deps, [live("Notes - 09-30-2026")], folder, [note("2026-10-01")], () => {});
    expect(calls).toEqual(["move Notes - 09-30-2026 -> notes", "upload Notes - 10-01-2026 -> out"]);
    expect(r.touched.size).toBe(1);
    expect(r.uploaded.get("Notes - 10-01-2026")).toBe("new:Notes - 10-01-2026");
  });

  it("replaces a day a sync already published that day, in place", async () => {
    const { calls, deps } = stub();
    await publishDailyNotes(deps, [live("Notes - 10-01-2026")], folder, [note("2026-10-01")], () => {});
    expect(calls).toEqual(["upload Notes - 10-01-2026 -> out"]);
  });

  it("adds a late page to an earlier day in the archive, leaving the newest day live", async () => {
    const { calls, deps } = stub();
    const docs = [live("Notes - 10-01-2026"), live("Notes - 09-30-2026", archive.id)];
    await publishDailyNotes(deps, docs, folder, [note("2026-09-30")], () => {});
    expect(calls).toEqual(["upload Notes - 09-30-2026 -> notes"]);
  });

  it("does nothing on a day with nothing new", async () => {
    const { calls, deps } = stub();
    await publishDailyNotes(deps, [live("Notes - 09-30-2026")], folder, [], () => {});
    expect(calls).toEqual([]);
  });
});

describe("the daily extras' own folders", () => {
  const doc = (p: string, name?: string) => ({ id: p, hash: "h", name: name ?? p.split("/").pop()!, path: p, parentId: "", fileType: "pdf" as const, lastModified: null, pageCount: 0 });

  it("keeps puzzles and headlines in folders of their own", () => {
    expect(PUZZLE_FOLDER).toBe("/ScriptumIQ/Puzzles");
    expect(HEADLINES_FOLDER).toBe("/ScriptumIQ/Daily Headlines");
    expect(inKeepFolder("/ScriptumIQ/Puzzles/Daily Puzzle 2026-09-21")).toBe(true);
    expect(inKeepFolder("/ScriptumIQ/Daily Headlines/Daily Update 2026-09-21")).toBe(true);
    expect(inKeepFolder("/ScriptumIQ/Planner")).toBe(false);
  });

  /**
   * The trap worth a test. `cleanStaleOutputs` deletes anything of OURS sitting outside the output
   * folder — which, if an archived puzzle counted as ours, is the entire archive, silently, on the
   * first night after it was created.
   */
  it("does not let the stale-output cleaner eat the archive", async () => {
    const deleted: string[] = [];
    const docs = [
      doc("/ScriptumIQ/Daily Puzzle"),
      doc("/ScriptumIQ/Puzzles/Daily Puzzle 2026-09-21", "Daily Puzzle 2026-09-21"),
      doc("/ScriptumIQ/Daily Headlines/Daily Update 2026-09-21", "Daily Update 2026-09-21"),
      doc("/ScriptumIQ/Archive/Planner 2026-09-01", "Planner 2026-09-01"),
    ];
    const tablet = { deleteDocument: async (d: { name: string }) => void deleted.push(d.name) } as unknown as Parameters<typeof cleanStaleOutputs>[0];
    // parentId "" matches the live notebook's, so nothing here is in the wrong place.
    await cleanStaleOutputs(tablet, docs, "", () => {});
    expect(deleted).toEqual([]);
  });

  /**
   * The other half of a rename: the copy written under the OLD name has to go, or the tablet shows
   * two puzzles and the stale one — no longer matching an output name — gets decoded back into
   * itself. This is what LEGACY_OUTPUT_NAMES is for, and it did the same job for "Meeting Notes".
   *
   * The names went "Daily" → "dayLy" → "Daily", so the direction of this test flipped with the
   * rename to ScriptumIQ: it is the dayLy copy that goes now, and the Daily one that stays.
   */
  it("removes the notebook left behind under the previous name", async () => {
    const deleted: string[] = [];
    const docs = [doc("/ScriptumIQ/Daily Puzzle"), doc("/ScriptumIQ/dayLy Puzzle"), doc("/ScriptumIQ/dayLy Update")];
    const tablet = { deleteDocument: async (d: { name: string }) => void deleted.push(d.name) } as unknown as Parameters<typeof cleanStaleOutputs>[0];
    await cleanStaleOutputs(tablet, docs, "", () => {});
    expect(deleted.sort()).toEqual(["dayLy Puzzle", "dayLy Update"]);
  });

  /**
   * A name can come back into use, as "Daily Update" just did. If it were still on the legacy list the
   * cleaner would delete tonight's notebook the moment it landed — every night, silently.
   */
  it("never lists a name it writes today as a legacy name", () => {
    for (const name of OUTPUT_NAMES) expect(LEGACY_OUTPUT_NAMES as readonly string[]).not.toContain(name);
  });

  /**
   * A crossword is output, not an input form. Decoding a grid full of hand-written letters costs
   * money to produce nonsense, and the closed loop does not apply to it.
   */
  it("never reads a puzzle or a brief back, live or archived", () => {
    const docs = [
      doc("/ScriptumIQ/Planner"),
      doc("/ScriptumIQ/Daily Puzzle"),
      doc("/ScriptumIQ/Daily Update"),
      // The names from before the rename are excluded too, for as long as a copy can still exist.
      doc("/ScriptumIQ/dayLy Puzzle"),
      doc("/ScriptumIQ/Puzzles/Daily Puzzle 2026-09-21", "Daily Puzzle 2026-09-21"),
      doc("/ScriptumIQ/Daily Headlines/Daily Update 2026-09-21", "Daily Update 2026-09-21"),
    ];
    expect(selectDocuments(docs, { watchFolders: [], includePdfs: true }).map((d) => d.name)).toEqual(["Planner"]);
  });
});

describe("carrying a tablet across the rename to ScriptumIQ", () => {
  const folder = (path: string, id: string, parentId = ""): TabletFolder => ({ id, hash: `h-${id}`, name: path.split("/").pop()!, path, parentId });
  const doc = (p: string, parentId: string, name?: string) => ({ id: p, hash: "h", name: name ?? p.split("/").pop()!, path: p, parentId, fileType: "pdf" as const, lastModified: null, pageCount: 0 });
  const recorder = (refuse = false) => {
    const renames: string[] = [];
    const tablet = {
      renameFolder: async (f: TabletFolder, name: string) => {
        if (refuse) throw new Error("the cloud said no");
        renames.push(`${f.name} -> ${name}`);
        return { id: f.id, hash: "renamed" };
      },
    } as unknown as TabletProvider;
    return { tablet, renames };
  };

  it("renames the old folder, then the headlines folder inside it, on the first run", async () => {
    const { tablet, renames } = recorder();
    const tree = {
      folders: [folder("/dayMarkable", "dm"), folder("/dayMarkable/dayLy Headlines", "hl", "dm"), folder("/dayMarkable/Archive", "ar", "dm")],
      documents: [],
    };
    expect(await migrateBrandFolders(tablet, tree, () => {})).toBe(true);
    // The subfolder is found by its parent's id, so it follows even though every path in the tree
    // still says /dayMarkable.
    expect(renames).toEqual(["dayMarkable -> ScriptumIQ", "dayLy Headlines -> Daily Headlines"]);
  });

  it("does nothing on every run after that", async () => {
    const { tablet, renames } = recorder();
    const tree = { folders: [folder("/ScriptumIQ", "si"), folder("/ScriptumIQ/Daily Headlines", "hl", "si")], documents: [] };
    expect(await migrateBrandFolders(tablet, tree, () => {})).toBe(false);
    expect(renames).toEqual([]);
  });

  /** Two Planners, and no way to know unattended which one has today's ticks on it. */
  it("merges nothing when both names exist", async () => {
    const { tablet, renames } = recorder();
    const tree = { folders: [folder("/dayMarkable", "dm"), folder("/ScriptumIQ", "si")], documents: [] };
    expect(await migrateBrandFolders(tablet, tree, () => {})).toBe(false);
    expect(renames).toEqual([]);
  });

  it("survives a rename the cloud refuses, and says so", async () => {
    const { tablet } = recorder(true);
    const logged: string[] = [];
    const tree = { folders: [folder("/dayMarkable", "dm")], documents: [] };
    expect(await migrateBrandFolders(tablet, tree, (m) => logged.push(m))).toBe(false);
    expect(logged.join("\n")).toMatch(/could not rename \/dayMarkable/);
  });

  /**
   * What the migration exists to prevent, held true even when it does not happen. Were the old folder
   * simply no longer ours, its printed planners would go to the decoder as the customer's handwriting
   * and every printed task would come back as a new one on an append-only list (rule 8). So until it
   * is renamed, nothing under it is read, and nothing under it is deleted.
   */
  it("never reads or deletes anything left under the old folder", async () => {
    const docs = [
      doc("/dayMarkable/Planner", "dm"),
      doc("/dayMarkable/Notes", "dm"),
      doc("/dayMarkable/dayLy Update", "dm"),
      doc("/dayMarkable/Archive/Planner 2026-09-01", "ar", "Planner 2026-09-01"),
    ];
    expect(selectDocuments(docs, { watchFolders: [], includePdfs: true })).toEqual([]);
    for (const d of docs) expect(isOurDocument(d)).toBe(false);
    const deleted: string[] = [];
    const tablet = { deleteDocument: async (d: { name: string }) => void deleted.push(d.name) } as unknown as Parameters<typeof cleanStaleOutputs>[0];
    await cleanStaleOutputs(tablet, docs, "si", () => {});
    expect(deleted).toEqual([]);
  });

  /** A headlines folder whose own rename failed is still an archive, not a pile of strays. */
  it("keeps an archived brief safe when its folder kept the old name", () => {
    const brief = doc("/ScriptumIQ/dayLy Headlines/dayLy Update 2026-09-21", "hl", "dayLy Update 2026-09-21");
    expect(inKeepFolder(brief.path)).toBe(true);
    expect(isOurDocument(brief)).toBe(false);
  });
});

/**
 * A tablet that models folders the way the cloud does — a child names its parent by id, and a path
 * is worked out from that chain — so a folder rename moves everything under it, as it really does.
 * Standing on the fixture tablet for the notebooks that are decoded.
 */
class SwitchNightTablet extends FixtureTabletProvider {
  readonly folderRenames: string[] = [];
  readonly filed: string[] = [];
  readonly deleted: string[] = [];
  private readonly dirs = [
    { id: "dm", hash: "h", name: "dayMarkable", parentId: "" },
    { id: "hl", hash: "h", name: "dayLy Headlines", parentId: "dm" },
    { id: "pz", hash: "h", name: "Puzzles", parentId: "dm" },
    { id: "ar", hash: "h", name: "Archive", parentId: "dm" },
  ];
  private files = [
    // Yesterday's puzzle, written under the name it had before the rename.
    { id: "yesterdays-puzzle", name: "dayLy Puzzle", parentId: "dm" },
    // Inside the week the planner archive keeps, so anything deleted tonight is the rename's doing.
    { id: "old-planner", name: "Planner 2026-09-20", parentId: "ar" },
    { id: "old-brief", name: "dayLy Update 2026-09-20", parentId: "hl" },
  ];
  private pathOf(id: string): string {
    if (!id) return "";
    const d = this.dirs.find((x) => x.id === id)!;
    return `${this.pathOf(d.parentId)}/${d.name}`;
  }
  override async listTree(): Promise<TabletTree> {
    const base = await super.listTree();
    return {
      folders: this.dirs.map((d) => ({ ...d, path: this.pathOf(d.id) })),
      documents: [
        ...base.documents,
        ...this.files.map((f) => ({
          id: f.id,
          hash: "h",
          name: f.name,
          path: `${this.pathOf(f.parentId)}/${f.name}`,
          parentId: f.parentId,
          fileType: "pdf" as const,
          lastModified: new Date("2026-09-21T15:00:00Z"),
          pageCount: 1,
        })),
      ],
    };
  }
  override async ensureFolder(p: string): Promise<TabletFolder> {
    const hit = this.dirs.find((d) => this.pathOf(d.id) === p);
    if (hit) return { ...hit, path: p };
    const parentPath = p.slice(0, p.lastIndexOf("/"));
    const parent = this.dirs.find((d) => this.pathOf(d.id) === parentPath);
    const made = { id: `new:${p}`, hash: "h", name: p.split("/").pop()!, parentId: parent?.id ?? "" };
    this.dirs.push(made);
    return { ...made, path: p };
  }
  override async renameFolder(f: TabletFolder, name: string) {
    const d = this.dirs.find((x) => x.id === f.id)!;
    this.folderRenames.push(`${d.name} -> ${name}`);
    d.name = name;
    return { id: d.id, hash: "renamed" };
  }
  override async renameDocument(doc: TabletDocument, name: string) {
    const f = this.files.find((x) => x.id === doc.id);
    if (f) f.name = name;
    return { id: doc.id, hash: "renamed" };
  }
  override async moveDocument(doc: TabletDocument, to: TabletFolder) {
    const f = this.files.find((x) => x.id === doc.id);
    if (f) {
      f.parentId = to.id;
      this.filed.push(`${this.pathOf(to.id)}/${f.name}`);
    }
    return { id: doc.id, hash: "moved" };
  }
  override async deleteDocument(doc: TabletDocument): Promise<void> {
    this.deleted.push(doc.id);
    this.files = this.files.filter((x) => x.id !== doc.id);
  }
}

describe("the first night after the rename, end to end", () => {
  /**
   * The three things that must all be true on the one night that matters. The folder is renamed
   * before anything is chosen for reading. Yesterday's puzzle — under its old name — is FILED, not
   * binned: the tree the cleaner sees was listed before filing, so without the exclusion it takes the
   * just-archived copy for a legacy stray and deletes it by id. And the old archive is never decoded.
   */
  it("renames the folders, files yesterday's puzzle under its new name, and deletes nothing", async () => {
    const switchTablet = new SwitchNightTablet(FIXTURES, path.join(tmp, "switch-tablet"), new Date());
    const user = await repo.ensureUser(handle.db, "switch@example.com", "America/New_York");
    // A Tuesday: the puzzle is generated rather than asked of a model, so this runs with no network.
    const out = await runPipeline({ ...deps, tablet: switchTablet }, { userId: user.id, kind: "nightly", requestedVia: "test", localDate: "2026-09-22" });
    expect(out.status).toBe("succeeded");

    expect(switchTablet.folderRenames).toEqual(["dayMarkable -> ScriptumIQ", "dayLy Headlines -> Daily Headlines"]);
    expect(switchTablet.filed).toEqual(["/ScriptumIQ/Puzzles/Daily Puzzle 2026-09-21"]);
    expect(switchTablet.deleted).toEqual([]);
    // The archive that was built up under /dayMarkable is the archive now: /ScriptumIQ/Archive resolved
    // to the renamed folder rather than a new, empty one alongside it.
    expect((await switchTablet.listTree()).folders.filter((f) => f.name === "Archive").map((f) => f.path)).toEqual(["/ScriptumIQ/Archive"]);
    // Tonight's notebooks land in the renamed folder, under tonight's names.
    const tonight = switchTablet.uploads.map((u) => `${u.folder}/${u.name}`).sort();
    expect(tonight).toContain("/ScriptumIQ/Daily Puzzle");
    expect(tonight).toContain("/ScriptumIQ/Planner");
    expect(tonight.some((u) => u.includes("dayMarkable") || u.includes("dayLy"))).toBe(false);
  });
});

describe("the Daily Update's shared edition", () => {
  /** Stands in for the API: one headline per topic it was asked about, and a count of requests. */
  function newsStub() {
    const stub = { requests: 0 };
    const client = {
      messages: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          stub.requests += 1;
          const ids = [...req.messages[0]!.content.matchAll(/^- ([a-z-]+):/gm)].map((m) => m[1]!);
          return {
            stop_reason: "end_turn",
            usage: { input_tokens: 1000, output_tokens: 100 },
            content: [
              ...ids.map(() => ({ type: "web_search_tool_result", content: [] })),
              { type: "text", text: JSON.stringify({ sections: ids.map((id) => ({ topic: id, items: [{ headline: `Headline for ${id}`, summary: "It happened.", source: "Wire" }] })) }) },
            ],
          };
        },
      },
    };
    return { stub, client: client as unknown as NonNullable<PipelineDeps["newsClient"]> };
  }

  async function subscriber(email: string, topics: string[]) {
    const u = await repo.ensureUser(handle.db, email, "America/Chicago");
    const s = (await repo.getUser(handle.db, u.id)).settings;
    await handle.db.update(schema.users).set({ settings: { ...s, dailyUpdate: { enabled: true, topics } } }).where(eq(schema.users.id, u.id));
    return u.id;
  }

  it("is written once a night for the whole list, booked to the house, and every customer reads their own slice of it", async () => {
    const { stub, client } = newsStub();
    const withNews = { ...deps, newsClient: client };
    const a = await subscriber("news-a@example.com", ["telecom", "nfl"]);
    const b = await subscriber("news-b@example.com", ["ai"]);
    const date = "2026-10-08";

    const first = await runPipeline(withNews, { userId: a, kind: "on_demand", requestedVia: "test", localDate: date, windowHours: 24 * 30 });
    expect(first.status).toBe("succeeded");
    // The whole list, in requests of six.
    const requests = Math.ceil(NEWS_TOPICS.length / 6);
    expect(stub.requests).toBe(requests);
    const stored = await repo.getDailyBrief(handle.db, date, "us");
    expect(stored).toHaveLength(NEWS_TOPICS.length);

    const second = await runPipeline(withNews, { userId: b, kind: "on_demand", requestedVia: "test", localDate: date, windowHours: 24 * 30 });
    expect(second.status).toBe("succeeded");
    // The second customer's brief came from the stored edition: nothing more was searched.
    expect(stub.requests).toBe(requests);
    expect(logs.some((l) => l.includes("us edition for 2026-10-08 already written, shared"))).toBe(true);

    // The edition's cost is nobody's: rule 16's house row, not the first customer's.
    const news = (await handle.db.query.runCosts.findMany()).filter((c) => c.stage === "news");
    expect(news).toHaveLength(1);
    expect(news[0]!.userId).toBeNull();
  });

  it("prints nothing for a customer whose saved topics are not on the list", async () => {
    const { stub, client } = newsStub();
    const legacy = await subscriber("news-legacy@example.com", ["broadband hardware"]);
    await runPipeline({ ...deps, newsClient: client }, { userId: legacy, kind: "on_demand", requestedVia: "test", localDate: "2026-10-09", windowHours: 24 * 30 });
    expect(stub.requests).toBe(0);
    expect(logs.some((l) => l.includes("news: skipped, no topics chosen"))).toBe(true);
  });
});
