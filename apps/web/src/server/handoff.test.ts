/**
 * Handing a native session to a browser (handoff.ts).
 *
 * This ticket travels in a URL, which is the whole reason it is built the way it is. The tests
 * that matter are the ones about how quickly it stops working.
 */
import { eq, openDb, schema, type DbHandle } from "@daymarkable/db";
import { defaultSettings } from "@daymarkable/pipeline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HANDOFF_TTL_MS, PANES, PANE_NAMES, createHandoff, isPane, redeemHandoff } from "./handoff";

let handle: DbHandle;
let userId: string;
let n = 0;

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
  const [u] = await handle.db.insert(schema.users).values({ email: "pane@example.com", timezone: "UTC", settings: defaultSettings() }).returning();
  userId = u!.id;
});
afterAll(() => handle.close());

async function session(ttlMs = 3600_000): Promise<string> {
  const id = `sess-${++n}`;
  await handle.db.insert(schema.sessions).values({ id, userId, expiresAt: new Date(Date.now() + ttlMs), client: "mobile" });
  return id;
}

/** The app never sees the token itself; the URL it is handed carries it. */
const tokenIn = (url: string) => new URL(url).searchParams.get("token")!;

describe("web handoff", () => {
  it("redeems once, for the session it was minted for", async () => {
    const id = await session();
    const token = tokenIn(await createHandoff(handle.db, id, "settings"));
    expect(await redeemHandoff(handle.db, token)).toBe(id);
    // Spent. A prefetch, a retry, or someone who caught the URL gets nothing.
    expect(await redeemHandoff(handle.db, token)).toBeNull();
  });

  it("dies a minute after it is made", async () => {
    const id = await session();
    const token = tokenIn(await createHandoff(handle.db, id, "setup"));
    const late = new Date(Date.now() + HANDOFF_TTL_MS + 1000);
    expect(await redeemHandoff(handle.db, token, late)).toBeNull();
  });

  it("is worthless once the session it points at has ended", async () => {
    // A ticket is a pointer at authority, never authority of its own: signing out on the phone
    // must not leave a live way into the account sitting in a URL.
    const id = await session();
    const token = tokenIn(await createHandoff(handle.db, id, "settings"));
    await handle.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    expect(await redeemHandoff(handle.db, token)).toBeNull();
  });

  it("refuses a token that was never issued", async () => {
    expect(await redeemHandoff(handle.db, "not-a-token")).toBeNull();
  });

  it("stores only the hash", async () => {
    const id = await session();
    const url = await createHandoff(handle.db, id, "support");
    const token = tokenIn(url);
    const rows = await handle.db.query.webHandoffs.findMany();
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("only knows the four panes, so the redirect is never a caller's choice", () => {
    expect(PANE_NAMES.sort()).toEqual(["billing", "settings", "setup", "support"]);
    expect(isPane("settings")).toBe(true);
    expect(isPane("/etc/passwd")).toBe(false);
    expect(isPane("https://example.com")).toBe(false);
    expect(isPane(null)).toBe(false);
  });

  it("opens pages that exist: the account page, not the /settings route handler", () => {
    // There is no /settings PAGE - only /settings/verify-delivery, a route handler for a link in
    // an email - so this pane pointed the app at a 404 for as long as it existed. The assertion is
    // on the path rather than on a rendered page because that is the whole of what went wrong.
    expect(PANES.settings.path).toBe("/account");
  });

  it("sends the subscription pane to management, not to checkout (rule 14)", () => {
    // /billing is where a plan is BOUGHT: public host, prices on it, and it redirects away anyone
    // who does not need to check out - which is every account that has one and might want to look
    // at it. Managing an existing subscription is its own page on the service host, and carries no
    // price, so nothing the app can open shows a figure.
    expect(PANES.billing.path).toBe("/subscription");
    expect(PANES.billing.host).toBe("service");
    expect(Object.values(PANES).every((p) => p.path !== "/billing")).toBe(true);
  });
});
