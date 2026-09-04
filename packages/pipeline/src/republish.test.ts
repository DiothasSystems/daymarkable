/** Republish rebuilds the notebooks from stored data and uploads them: no sync, no decode. */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sealer, eq, generateKey, openDb, parseKey, schema, type DbHandle } from "@daymarkable/db";
import { MemoryProvider } from "@daymarkable/mail";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalCacheStore } from "./cache.js";
import { FixtureDecoder, FixtureRenderer, FixtureTabletProvider } from "./fixtures.js";
import * as repo from "./repo.js";
import { republishNotebooks } from "./republish.js";
import { runPipeline } from "./run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "..", "..", "..", "fixtures", "notebooks");

let handle: DbHandle;
let tmp: string;
let tablet: FixtureTabletProvider;
let sealer: Sealer;
let cache: LocalCacheStore;
let userId: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "dm-rep-"));
  handle = await openDb("pglite://memory");
  await handle.migrate();
  sealer = new Sealer(parseKey(generateKey()));
  cache = new LocalCacheStore(path.join(tmp, "cache"), sealer);
  tablet = new FixtureTabletProvider(FIXTURES, path.join(tmp, "tablet"), new Date());
  userId = (await repo.ensureUser(handle.db, "rep@example.com", "America/New_York")).id;
  await runPipeline(
    { db: handle.db, sealer, cache, tablet, renderer: new FixtureRenderer(FIXTURES), decoder: new FixtureDecoder(FIXTURES), mail: new MemoryProvider(), decodeModel: "fixture-model", log: () => {}, now: () => DateTime.fromISO("2026-09-02T07:05:00Z") },
    { userId, kind: "nightly", requestedVia: "test" },
  );
});

afterAll(async () => {
  await handle.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("republishNotebooks", () => {
  it("pushes a corrected item to the tablet without decoding anything", async () => {
    const before = tablet.uploads.length;
    const task = (await handle.db.query.tasks.findMany({ where: eq(schema.tasks.userId, userId) }))[0]!;
    await handle.db.update(schema.tasks).set({ text: "Call Warburton about Streambow" }).where(eq(schema.tasks.id, task.id));

    const r = await republishNotebooks({ db: handle.db, sealer, cache, tablet, log: () => {} }, userId);
    expect(r.uploaded.sort()).toEqual(["Action List", "Meeting Notes", "Planner"]);
    expect(tablet.uploads.length).toBe(before + 3);
    // No run row was created and no cost recorded: this calls no model.
    const runs = await handle.db.query.runs.findMany({ where: eq(schema.runs.userId, userId) });
    expect(runs).toHaveLength(1);
    expect(await handle.db.query.runCosts.findMany()).toHaveLength(1);

    // The reprinted pages carry fresh item codes, and the old ones for that run are gone.
    const printed = await handle.db.query.printedItems.findMany({ where: eq(schema.printedItems.userId, userId) });
    expect(printed.length).toBeGreaterThan(0);
    expect(printed.filter((p) => p.itemId === task.id).length).toBeGreaterThan(0);
    const codes = printed.map((p) => `${p.pageCode}|${p.itemCode}`);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
