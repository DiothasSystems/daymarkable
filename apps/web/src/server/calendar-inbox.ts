/**
 * The inbound calendar address: one mailbox, every account.
 *
 * A customer forwards a meeting invite from Outlook or Google to
 * `<token>@cal.scriptumiq.com`, and it appears on their planner. No mailbox is provisioned per
 * account — one MX record and one webhook serve everybody, and the token in the local part is only a
 * lookup key.
 *
 * Two checks, doing different jobs. The token says WHICH account, and it is not a credential: it
 * travels in mail headers, forwarding chains and corporate archives, and it will leak. The SENDER
 * says whether the message may act on that account, and it must be an address the customer has
 * already told us is theirs. Getting this the other way round would let anyone who learned a token
 * write meetings into a stranger's diary.
 *
 * Nothing here logs the message, the subject or the meeting. An invite is the customer's own diary
 * and rule 5 applies to it exactly as it applies to a page — counts and outcomes only.
 */
import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, schema } from "@daymarkable/db";
import { readInboundMessage, senderAllowed, supersedes, toInviteEvent } from "@daymarkable/calendar";
import { getRuntime } from "./runtime";

/** The subdomain invites are sent to. A separate host from the one we send FROM, on purpose. */
export const INBOUND_HOST = process.env.INBOUND_CALENDAR_HOST || "cal.scriptumiq.com";

/**
 * 16 bytes, base32-ish. Long enough that the address cannot be guessed, short enough to be typed
 * into a phone's contact list once and then forgotten about.
 */
export function newCalendarToken(): string {
  return randomBytes(10).toString("hex");
}

export function calendarAddress(token: string | null): string | null {
  return token ? `${token}@${INBOUND_HOST}` : null;
}

/** The token out of whatever the provider called the recipient: `a1b2c3@cal.scriptumiq.com`. */
export function tokenFromRecipient(recipient: string): string | null {
  const at = recipient.trim().toLowerCase();
  const local = at.includes("@") ? at.slice(0, at.indexOf("@")) : at;
  // Plus-addressing tolerated on the way in, so a customer who types the address into a client that
  // helpfully appends something still gets their invite.
  const token = (local.split("+")[0] ?? "").replace(/[^a-z0-9]/g, "");
  return /^[a-f0-9]{12,}$/.test(token) ? token : null;
}

export type InboundOutcome =
  | { ok: true; added: number; updated: number; cancelled: number; ignored: number }
  | { ok: false; status: number; reason: string };

/**
 * Accept a forwarded invite.
 *
 * Returns rather than throws, and the status codes matter to the mail provider: 4xx means stop
 * trying, 5xx means retry. A message from an address we do not recognise is 403 and final — retrying
 * it would never help, and bouncing it would tell a stranger whether a token is real.
 */
export async function receiveCalendarMessage(recipient: string, raw: string): Promise<InboundOutcome> {
  const token = tokenFromRecipient(recipient);
  if (!token) return { ok: false, status: 400, reason: "no account token in the recipient address" };

  const rt = await getRuntime();
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.calendarToken, token) });
  if (!user) return { ok: false, status: 404, reason: "no account for that address" };

  const parsed = await readInboundMessage(raw);
  // Sender checked before anything is written, and the answer does not depend on whether the message
  // contained a usable invite — so a probe cannot learn a token's validity from the difference.
  const allowed = [user.email, user.settings.deliveryVerifiedAt ? user.settings.deliveryEmail : null];
  if (!senderAllowed(parsed.from, allowed)) {
    return { ok: false, status: 403, reason: "the sender is not a verified address on this account" };
  }
  if (parsed.error) return { ok: false, status: 422, reason: parsed.error };

  const zone = user.timezone || "UTC";
  let added = 0;
  let updated = 0;
  let cancelled = 0;
  let ignored = 0;

  for (const invite of parsed.invites) {
    const event = toInviteEvent(invite, zone);
    const existing = await rt.db.query.events.findFirst({
      where: and(eq(schema.events.userId, user.id), eq(schema.events.icalUid, event.icalUid)),
    });
    if (existing && !supersedes(event.icalSequence, existing.icalSequence)) {
      // A stale forward of an invitation somebody has had sitting in their inbox for a fortnight.
      ignored++;
      continue;
    }
    if (event.cancelled) {
      if (existing) {
        await rt.db
          .update(schema.events)
          .set({ status: "dropped", icalSequence: event.icalSequence, updatedAt: new Date() })
          .where(and(eq(schema.events.userId, user.id), eq(schema.events.id, existing.id)));
        cancelled++;
      } else {
        // A cancellation for a meeting we never had. Nothing to remove, and creating it in order to
        // drop it would put a dropped meeting in the working set for no reason.
        ignored++;
      }
      continue;
    }
    const values = {
      id: event.id,
      userId: user.id,
      title: event.title,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      people: event.people,
      source: "external" as const,
      // Structured data, not a reading of handwriting. It is certain, so it never goes to the Inbox
      // for confirmation (rule 3) — there is nothing for the customer to confirm about it.
      confidence: 1,
      status: "active" as const,
      rrule: event.rrule,
      exdates: event.exdates,
      icalUid: event.icalUid,
      icalSequence: event.icalSequence,
      updatedAt: new Date(),
    };
    await rt.db.insert(schema.events).values(values).onConflictDoUpdate({ target: schema.events.id, set: values });
    if (existing) updated++;
    else added++;
  }

  return { ok: true, added, updated, cancelled, ignored };
}

/**
 * Whether the caller is the mail provider we configured.
 *
 * A shared secret rather than a signature, because the inbound vendor is not chosen yet and every one
 * of them spells signing differently. Compared in constant time; length-padded first, because
 * timingSafeEqual throws on a length mismatch and that throw is itself a timing signal.
 */
export function inboundSecretOk(presented: string | null): boolean {
  const expected = process.env.INBOUND_CALENDAR_SECRET ?? "";
  if (!expected) return false;
  const a = Buffer.from(presented ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
