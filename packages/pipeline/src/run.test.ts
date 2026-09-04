/**
 * End-to-end pipeline test on fixtures: in-memory Postgres (PGlite), fixture tablet/renderer/
 * decoder, memory mail. No network, no keys. Exercises change detection, idempotency, merge,
 * compose, upload, email, and the cache rotation + purge log.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sealer, generateKey, openDb, parseKey, schema, eq, type DbHandle } from "@daymarkable/db";
import { zeroUsage } from "@daymarkable/decode";
import { MemoryProvider } from "@daymarkable/mail";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalCacheStore } from "./cache.js";
import { FixtureDecoder, FixtureRenderer, FixtureTabletProvider } from "./fixtures.js";
import * as repo from "./repo.js";
import { changeWindowStart, inWatchedFolder, isOurDocument, outputFolderFor, pageChanged, runPipeline, selectDocuments, type PipelineDeps } from "./run.js";

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
    const out = await runPipeline(deps, { userId, kind: "nightly", requestedVia: "test" });
    expect(out.status).toBe("succeeded");
    expect(out.stats!.docsChanged).toBe(1);
    expect(out.stats!.pagesDecoded).toBe(1);
    expect(out.stats!.tasksFound).toBeGreaterThan(0);
    expect(tablet.uploads.map((u) => u.name).sort()).toEqual(["Action List", "Meeting Notes", "Planner"]);
    const docs = await handle.db.query.documents.findMany({ where: eq(schema.documents.userId, userId) });
    expect(docs).toHaveLength(3);
    const costs = await handle.db.query.runCosts.findMany();
    expect(costs).toHaveLength(1);
    expect(costs[0]!.model).toBe("fixture-model");
    expect(costs[0]!.mode).toBe("batch");
    const cacheDirs = await readdir(path.join(tmp, "cache"));
    expect(cacheDirs).toHaveLength(1);
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
          pages.map((p) => ({ key: p.key, extraction: null, raw: "", error: "API 401: invalid x-api-key", usage: [{ ...zeroUsage(), model: "fixture-model", mode, cost_usd: 0 }], escalated: false })),
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
    expect(tablet.uploads.length).toBe(uploadsBefore + 3);
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
});

describe("selection and windows", () => {
  const doc = (p: string, fileType: "notebook" | "pdf" | "epub" = "notebook") => ({ id: p, hash: "h", name: p.split("/").pop()!, path: p, parentId: "", fileType, lastModified: null, pageCount: 0 });
  it("watches notebooks in watch folders, always includes dayMarkable outputs, never the archive", () => {
    const docs = [doc("/Work/Meetings"), doc("/Personal/Journal"), doc("/dayMarkable/Planner", "pdf"), doc("/dayMarkable/Archive/Planner 2026-09-01", "pdf"), doc("/Books/Novel", "epub"), doc("/Work/Spec", "pdf")];
    expect(selectDocuments(docs, { watchFolders: ["/Work"], includePdfs: false }).map((d) => d.path)).toEqual(["/Work/Meetings", "/dayMarkable/Planner"]);
    expect(selectDocuments(docs, { watchFolders: [], includePdfs: true }).map((d) => d.path)).toEqual(["/Work/Meetings", "/Personal/Journal", "/dayMarkable/Planner", "/Work/Spec"]);
  });
  it("recognises our own notebooks in either location, and never the archive", () => {
    expect(isOurDocument(doc("/dayMarkable/Planner", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Planner", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Action List", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/Handwriting Sample", "pdf"))).toBe(true);
    expect(isOurDocument(doc("/dayMarkable/Archive/Planner 2026-09-01", "pdf"))).toBe(false);
    // A user's own notebook that happens to sit in the root is not ours.
    expect(isOurDocument(doc("/Plume"))).toBe(false);
    // Nor is one merely named like ours but filed elsewhere.
    expect(isOurDocument(doc("/Work/Planner"))).toBe(false);
    expect(outputFolderFor({ outputToRoot: false })).toBe("/dayMarkable");
    expect(outputFolderFor({ outputToRoot: true })).toBe("/");
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
  it("decides page changes by hash, and by page timestamp on first sight", () => {
    const w = DateTime.fromISO("2026-09-01T00:00:00", { zone: "America/New_York" });
    const snap = new Map<string, string | null>([["p1", "h1"], ["p2", "h2"]]);
    expect(pageChanged({ pageId: "p1", hash: "h1", modified: null }, snap, w)).toBe(false);
    expect(pageChanged({ pageId: "p2", hash: "h9", modified: "1000" }, snap, w)).toBe(true);
    expect(pageChanged({ pageId: "new-old", hash: "h", modified: "1761573438256" }, snap, w)).toBe(false);
    expect(pageChanged({ pageId: "new-fresh", hash: "h", modified: "1788288231187" }, snap, w)).toBe(true);
    expect(pageChanged({ pageId: "new-unknown", hash: "h", modified: null }, snap, w)).toBe(true);
    expect(pageChanged({ pageId: "blank", hash: null, modified: null }, snap, w)).toBe(false);
  });
  it("opens the window at local midnight of the previous day once the account has run", () => {
    const w = changeWindowStart("2026-09-02", "America/New_York", new Date("2026-09-01T07:00:00Z"));
    expect(w.toISO()).toBe("2026-09-01T00:00:00.000-04:00");
  });
  it("looks back a week on the very first run, so the first planner is not empty", () => {
    const first = changeWindowStart("2026-09-02", "America/New_York", null);
    expect(first.toISO()).toBe("2026-08-26T00:00:00.000-04:00");
    // An explicit override still wins.
    expect(changeWindowStart("2026-09-02", "America/New_York", null, 48).toUTC() <= DateTime.utc().minus({ hours: 47 })).toBe(true);
  });
  it("reaches further back when catching up after a missed night", () => {
    const catchUp = changeWindowStart("2026-09-05", "America/New_York", new Date("2026-09-02T07:30:00Z"));
    expect(catchUp.toUTC().toISO()).toBe("2026-09-02T06:30:00.000Z");
  });
});
