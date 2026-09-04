/** Rule 11: 3 on-demand syncs per rolling 24h, enforced server-side in one module, across surfaces. */
import { openDb, schema, type DbHandle } from "@daymarkable/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ON_DEMAND_LIMIT, getOnDemandQuota } from "./quota.js";
import * as repo from "./repo.js";

let handle: DbHandle;
let userId: string;

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
  userId = (await repo.ensureUser(handle.db, "q@example.com", "UTC")).id;
});
afterAll(() => handle.close());

async function onDemand(createdAt: Date, via: string, status: "succeeded" | "failed" | "running" = "succeeded") {
  const seq = await repo.nextSeq(handle.db, userId, "2026-09-02", "on_demand");
  const [row] = await handle.db.insert(schema.runs).values({ userId, localDate: "2026-09-02", kind: "on_demand", seq, status, requestedVia: via, createdAt, startedAt: createdAt }).returning();
  return row!;
}

describe("on-demand quota", () => {
  it("counts web and mobile together inside the rolling window", async () => {
    const now = new Date("2026-09-02T12:00:00Z");
    expect(await getOnDemandQuota(handle.db, userId, now)).toMatchObject({ limit: ON_DEMAND_LIMIT, used: 0, remaining: 3, nextAvailableAt: null });
    await onDemand(new Date("2026-09-02T09:00:00Z"), "web");
    await onDemand(new Date("2026-09-02T10:00:00Z"), "mobile", "failed");
    expect(await getOnDemandQuota(handle.db, userId, now)).toMatchObject({ used: 2, remaining: 1 });
    await onDemand(new Date("2026-09-02T11:00:00Z"), "web");
    const q = await getOnDemandQuota(handle.db, userId, now);
    expect(q.remaining).toBe(0);
    // The oldest counted run (09:00) leaves the window at 09:00 next day.
    expect(q.nextAvailableAt?.toISOString()).toBe("2026-09-03T09:00:00.000Z");
  });

  it("operator runs from the CLI do not consume the customer's quota", async () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const before = (await getOnDemandQuota(handle.db, userId, now)).remaining;
    await onDemand(new Date("2026-09-02T11:30:00Z"), "cli");
    expect((await getOnDemandQuota(handle.db, userId, now)).remaining).toBe(before);
  });

  it("frees a slot once the oldest run ages out, and nightly runs never count", async () => {
    const later = new Date("2026-09-03T09:00:01Z");
    expect((await getOnDemandQuota(handle.db, userId, later)).remaining).toBe(1);
    await handle.db.insert(schema.runs).values({ userId, localDate: "2026-09-03", kind: "nightly", seq: 0, status: "succeeded", requestedVia: "scheduler", createdAt: later });
    expect((await getOnDemandQuota(handle.db, userId, later)).remaining).toBe(1);
  });

  it("nightly attempts get sequential keys after a failure so retries are possible", async () => {
    expect(await repo.nextSeq(handle.db, userId, "2026-09-04", "nightly")).toBe(0);
    await handle.db.insert(schema.runs).values({ userId, localDate: "2026-09-04", kind: "nightly", seq: 0, status: "failed", requestedVia: "scheduler" });
    expect(await repo.nextSeq(handle.db, userId, "2026-09-04", "nightly")).toBe(1);
  });
});
