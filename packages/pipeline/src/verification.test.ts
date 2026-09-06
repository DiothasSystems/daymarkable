/**
 * Delivery-address confirmation tokens, against a real database.
 *
 * These are the rules that keep rule 10 honest — single use, expiring, and unable to confirm an
 * address the user has since changed — so they are worth testing against Postgres rather than a
 * stub.
 */
import { openDb, type DbHandle } from "@daymarkable/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as repo from "./repo.js";

let handle: DbHandle;
let userId: string;
let otherId: string;

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
  userId = (await repo.ensureUser(handle.db, "owner@example.com", "UTC")).id;
  otherId = (await repo.ensureUser(handle.db, "someone-else@example.com", "UTC")).id;
});

afterAll(async () => {
  await handle.close();
});

describe("delivery verification tokens", () => {
  it("issues a token that resolves back to its user and address", async () => {
    const token = await repo.createDeliveryVerification(handle.db, userId, "inbox@example.com");
    expect(token.length).toBeGreaterThan(20);
    expect(await repo.consumeDeliveryVerification(handle.db, token)).toEqual({ userId, email: "inbox@example.com" });
  });

  it("is single use", async () => {
    const token = await repo.createDeliveryVerification(handle.db, userId, "inbox@example.com");
    expect(await repo.consumeDeliveryVerification(handle.db, token)).not.toBeNull();
    expect(await repo.consumeDeliveryVerification(handle.db, token)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await repo.consumeDeliveryVerification(handle.db, "not-a-real-token")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await repo.createDeliveryVerification(handle.db, userId, "inbox@example.com", -1);
    expect(await repo.consumeDeliveryVerification(handle.db, token)).toBeNull();
  });

  it("retires the previous link when a new address is saved", async () => {
    // Otherwise the link mailed to the OLD address could confirm the account's delivery.
    const first = await repo.createDeliveryVerification(handle.db, userId, "old@example.com");
    const second = await repo.createDeliveryVerification(handle.db, userId, "new@example.com");
    expect(await repo.consumeDeliveryVerification(handle.db, first)).toBeNull();
    expect(await repo.consumeDeliveryVerification(handle.db, second)).toEqual({ userId, email: "new@example.com" });
  });

  it("clearing removes an outstanding link", async () => {
    const token = await repo.createDeliveryVerification(handle.db, userId, "inbox@example.com");
    await repo.clearDeliveryVerifications(handle.db, userId);
    expect(await repo.consumeDeliveryVerification(handle.db, token)).toBeNull();
  });

  it("one account's token is never another's", async () => {
    const mine = await repo.createDeliveryVerification(handle.db, userId, "mine@example.com");
    const theirs = await repo.createDeliveryVerification(handle.db, otherId, "theirs@example.com");
    expect((await repo.consumeDeliveryVerification(handle.db, mine))?.userId).toBe(userId);
    expect((await repo.consumeDeliveryVerification(handle.db, theirs))?.userId).toBe(otherId);
  });

  it("issuing for one account leaves another account's link alone", async () => {
    const theirs = await repo.createDeliveryVerification(handle.db, otherId, "theirs@example.com");
    await repo.createDeliveryVerification(handle.db, userId, "mine@example.com");
    expect(await repo.consumeDeliveryVerification(handle.db, theirs)).not.toBeNull();
  });
});
