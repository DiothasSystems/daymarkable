/**
 * Native sign-in (device-login.ts): the app holds a secret, the link is tapped wherever it lands,
 * and the session is handed over exactly once.
 *
 * The properties worth protecting here are the quiet ones — that an unknown secret is
 * indistinguishable from one that is merely waiting, and that a claimed secret is spent.
 */
import { eq, openDb, schema, type DbHandle } from "@daymarkable/db";
import { defaultSettings } from "@daymarkable/pipeline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEVICE_LOGIN_TTL_MS,
  MAX_POLLS,
  bearerFrom,
  bindSession,
  claimDeviceLogin,
  decoyPollSecret,
  hashSecret,
  isMobileLogin,
  startDeviceLogin,
} from "./device-login";

let handle: DbHandle;
let userId: string;
let n = 0;

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
  const [u] = await handle.db.insert(schema.users).values({ email: "phone@example.com", timezone: "UTC", settings: defaultSettings() }).returning();
  userId = u!.id;
});
afterAll(() => handle.close());

/** A login token hash, unique per attempt, standing in for the one requestMagicLink mints. */
const tokenHash = () => `token-${++n}`;

async function session(client: "web" | "mobile" = "mobile", at = new Date()): Promise<string> {
  const id = `sess-${++n}`;
  await handle.db.insert(schema.sessions).values({ id, userId, expiresAt: new Date(at.getTime() + 3600_000), client });
  return id;
}

/** What /auth/verify does once it has verified the link: create the session, then hand it over. */
async function tapTheLink(th: string, at = new Date()): Promise<string> {
  const id = await session("mobile", at);
  await bindSession(handle.db, th, id, at);
  return id;
}

describe("native sign-in", () => {
  it("stays pending until the link is tapped, then hands over the session once", async () => {
    const th = tokenHash();
    const secret = await startDeviceLogin(handle.db, th);

    expect(await claimDeviceLogin(handle.db, secret)).toEqual({ status: "pending" });

    const sessionId = await tapTheLink(th);
    expect(await claimDeviceLogin(handle.db, secret)).toEqual({ status: "ready", sessionId });

    // Spent. A replay of the same secret — a stolen one, or a retried request — gets nothing.
    expect(await claimDeviceLogin(handle.db, secret)).toEqual({ status: "expired" });
  });

  it("stores only the hash of the secret", async () => {
    const th = tokenHash();
    const secret = await startDeviceLogin(handle.db, th);
    const row = await handle.db.query.deviceLogins.findFirst({ where: eq(schema.deviceLogins.tokenHash, th) });
    expect(row!.secretHash).toBe(hashSecret(secret));
    expect(row!.secretHash).not.toBe(secret);
  });

  it("answers the same for a secret that was never issued as for one still waiting", async () => {
    // This is the whole of rule 15's incuriosity on the mobile path: requestLink hands a decoy
    // secret to an address that may not sign in, and the difference must not be observable.
    expect(await claimDeviceLogin(handle.db, decoyPollSecret())).toEqual({ status: "pending" });
    const waiting = await startDeviceLogin(handle.db, tokenHash());
    expect(await claimDeviceLogin(handle.db, waiting)).toEqual({ status: "pending" });
  });

  it("expires with the login token, tapped or not", async () => {
    const th = tokenHash();
    const secret = await startDeviceLogin(handle.db, th);
    const late = new Date(Date.now() + DEVICE_LOGIN_TTL_MS + 1000);
    await tapTheLink(th, late);
    expect(await claimDeviceLogin(handle.db, secret, late)).toEqual({ status: "expired" });
  });

  it("reports a link tapped after the attempt died as no longer waiting", async () => {
    const th = tokenHash();
    await startDeviceLogin(handle.db, th);
    const late = new Date(Date.now() + DEVICE_LOGIN_TTL_MS + 1000);
    expect(await bindSession(handle.db, th, await session("mobile", late), late)).toBe(false);
  });

  it("gives up on a client that polls forever", async () => {
    const th = tokenHash();
    const secret = await startDeviceLogin(handle.db, th);
    await handle.db.update(schema.deviceLogins).set({ attempts: MAX_POLLS }).where(eq(schema.deviceLogins.secretHash, hashSecret(secret)));
    expect(await claimDeviceLogin(handle.db, secret)).toEqual({ status: "expired" });
  });

  it("counts the polls it answers", async () => {
    const secret = await startDeviceLogin(handle.db, tokenHash());
    await claimDeviceLogin(handle.db, secret);
    await claimDeviceLogin(handle.db, secret);
    const row = await handle.db.query.deviceLogins.findFirst({ where: eq(schema.deviceLogins.secretHash, hashSecret(secret)) });
    expect(row!.attempts).toBe(2);
  });

  it("binds nothing when the link was a browser's, and says so", async () => {
    const th = tokenHash();
    expect(await isMobileLogin(handle.db, th)).toBe(false);
    expect(await bindSession(handle.db, th, await session("web"))).toBe(false);
    await startDeviceLogin(handle.db, th);
    expect(await isMobileLogin(handle.db, th)).toBe(true);
  });

  it("hands one session to one attempt, not to an earlier abandoned one", async () => {
    // Ask twice from the same phone (a retry, a second tap on "email me a link"). Each attempt has
    // its own token, so the session the tapped link created goes only to the attempt that asked.
    const firstSecret = await startDeviceLogin(handle.db, tokenHash());
    const second = tokenHash();
    const secondSecret = await startDeviceLogin(handle.db, second);

    const sessionId = await tapTheLink(second);
    expect(await claimDeviceLogin(handle.db, firstSecret)).toEqual({ status: "pending" });
    expect(await claimDeviceLogin(handle.db, secondSecret)).toEqual({ status: "ready", sessionId });
  });
});

describe("bearer header", () => {
  const withHeader = (v: string) => bearerFrom(new Request("https://app.scriptumiq.com/api/trpc/x", { headers: { authorization: v } }));

  it("reads the session id after the scheme", () => {
    expect(withHeader("Bearer abc.123_-")).toBe("abc.123_-");
    expect(withHeader("bearer abc")).toBe("abc"); // the scheme is case-insensitive (RFC 7235)
    expect(withHeader("  Bearer   abc  ")).toBe("abc");
  });

  it("refuses anything that is not a bearer credential", () => {
    expect(bearerFrom(new Request("https://app.scriptumiq.com/x"))).toBeNull();
    expect(withHeader("")).toBeNull();
    expect(withHeader("Bearer")).toBeNull();
    expect(withHeader("Bearer ")).toBeNull();
    expect(withHeader("Basic abc")).toBeNull();
    expect(withHeader("Bearer a b")).toBeNull(); // one credential, not a phrase
  });
});
