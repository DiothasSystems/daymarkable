/**
 * Handing a native session to a browser.
 *
 * Four of the app's screens are not native at all — first-time setup, settings, billing and
 * support are the web's own pages in a WebView, so there is one copy of each form rather than
 * two that drift (docs/MOBILE_PLAN.md §2, §7). A WebView has its own cookie jar and knows nothing
 * of the bearer token the app carries, so something has to bridge them.
 *
 * What does NOT bridge them, and why:
 *
 *   - Sending the session id as a query parameter. It is a credential; a credential in a URL is a
 *     credential in a log, a history entry, and a Referer header.
 *   - Injecting a `Cookie:` header on the WebView's source. It applies to the first request and
 *     then, on the first in-page navigation, does not — so /settings works and the form it posts
 *     to does not.
 *   - Signing in again inside the WebView. That is the user doing the same thing twice.
 *
 * So: a one-time ticket. The app asks for one over its bearer, the WebView loads it once, and the
 * route hands back the SAME session as a cookie. Sixty seconds and a single redemption, so a
 * captured URL is worthless before anyone can carry it anywhere.
 *
 * The pane is a name, not a path. The mapping to a URL lives on this side, which is what stops
 * the redirect from being something a caller can choose.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, type Db, schema } from "@daymarkable/db";
import { publicUrl, serviceUrl } from "@/lib/hosts";

export const HANDOFF_TTL_MS = 60_000;

/**
 * The only pages the app may open this way, and where each one lives.
 *
 * Every pane happens to sit on the service host today. The public branch is kept rather than
 * simplified away: the public host is where anything bought lives (rule 14), so the next pane that
 * needs it finds the machinery already here. `pane()` is what keeps the host a widened type, so
 * that stays a live choice rather than a comparison TypeScript narrows to never.
 */
type PaneHost = "service" | "public";
const pane = (path: string, host: PaneHost = "service") => ({ path, host });

export const PANES = {
  setup: pane("/setup"),
  /**
   * `/account`, not `/settings` — there is no /settings page and never has been, only
   * /settings/verify-delivery, which is a route handler for a link in an email. The app's Settings
   * button opened a 404 for as long as it existed.
   */
  settings: pane("/account"),
  support: pane("/support"),
  /**
   * Managing an existing subscription, which is /subscription on the service host — NOT /billing,
   * the checkout page on the public host. /billing redirects away anyone who does not need to check
   * out, so every account that had already paid was bounced out of it and the button looked broken.
   * Buying is still web-only and still shows the price there; this pane deliberately does not
   * (rule 14).
   */
  billing: pane("/subscription"),
};

export type Pane = keyof typeof PANES;
export const PANE_NAMES = Object.keys(PANES) as [Pane, ...Pane[]];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function paneUrl(pane: Pane): string {
  const { path, host } = PANES[pane];
  return `${host === "public" ? publicUrl() : serviceUrl()}${path}`;
}

/** Mint a ticket for this session. Returns the URL the WebView should load. */
export async function createHandoff(db: Db, sessionId: string, pane: Pane, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.webHandoffs).values({
    tokenHash: sha256(token),
    sessionId,
    expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
  });
  // The landing route is served on both hosts, so it is reached on whichever one the pane lives
  // on — the cookie is scoped to the parent domain and carries across either way.
  const base = PANES[pane].host === "public" ? publicUrl() : serviceUrl();
  return `${base}/auth/handoff?token=${token}&pane=${pane}`;
}

/**
 * Redeem a ticket. Returns the session it stands for, or null.
 *
 * Marked used before anything else happens, so a token that is redeemed twice — a retry, a
 * prefetch, someone with the URL — gets nothing the second time.
 */
export async function redeemHandoff(db: Db, token: string, now = new Date()): Promise<string | null> {
  const tokenHash = sha256(token);
  const rows = await db
    .update(schema.webHandoffs)
    .set({ usedAt: now })
    .where(and(eq(schema.webHandoffs.tokenHash, tokenHash), isNull(schema.webHandoffs.usedAt), gt(schema.webHandoffs.expiresAt, now)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  // The session may have been ended between minting and redeeming; a ticket is not authority of
  // its own, only a pointer at one that must still be good.
  const session = await db.query.sessions.findFirst({ where: and(eq(schema.sessions.id, row.sessionId), gt(schema.sessions.expiresAt, now)) });
  return session ? session.id : null;
}

export function isPane(value: string | null): value is Pane {
  return !!value && value in PANES;
}
