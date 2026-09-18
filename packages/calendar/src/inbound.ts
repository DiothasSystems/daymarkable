/**
 * Finding the calendar inside an email.
 *
 * A forwarded invite does not arrive in one predictable shape. Outlook sends `text/calendar` inline
 * with the body; Gmail attaches `invite.ics`; a forward through a corporate gateway can bury it a
 * level deeper in a `message/rfc822`; and some clients drop it entirely and send prose describing a
 * meeting, which is not something to guess at. So every part is walked, and anything that looks like
 * iCalendar is tried.
 *
 * Nothing here logs the message. An inbound email is the customer's own correspondence and rule 5
 * applies to it exactly as it applies to a page.
 */
import PostalMime from "postal-mime";
import { parseIcs, type ParsedInvite } from "./ical.js";

export interface InboundResult {
  invites: ParsedInvite[];
  /** The envelope/header sender, lowercased — what authorises the message. */
  from: string | null;
  subject: string | null;
  error: string | null;
}

/** Bigger than any real invite. A calendar part is kilobytes; anything larger is not one. */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

/**
 * Pull the invites out of a raw RFC 822 message.
 *
 * Deliberately takes the RAW message rather than a provider's pre-parsed JSON. Every inbound vendor
 * invents its own payload shape, and the raw message is the one thing all of them can hand over —
 * so the provider can be swapped without touching this.
 */
export async function readInboundMessage(raw: string | ArrayBuffer): Promise<InboundResult> {
  const size = typeof raw === "string" ? raw.length : raw.byteLength;
  if (size > MAX_MESSAGE_BYTES) {
    return { invites: [], from: null, subject: null, error: `message is ${size} bytes, over the ${MAX_MESSAGE_BYTES} limit` };
  }
  let mail: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    mail = await PostalMime.parse(raw);
  } catch (err) {
    return { invites: [], from: null, subject: null, error: `could not read the message: ${(err as Error).message}` };
  }

  const from = mail.from?.address?.trim().toLowerCase() ?? null;
  const subject = mail.subject?.trim() ?? null;

  const candidates: string[] = [];
  for (const att of mail.attachments ?? []) {
    const type = (att.mimeType ?? "").toLowerCase();
    const name = (att.filename ?? "").toLowerCase();
    if (type.includes("calendar") || name.endsWith(".ics")) candidates.push(textOf(att.content));
  }
  // Outlook puts the calendar in the body rather than as an attachment, where postal-mime surfaces
  // it as text rather than in `attachments`.
  for (const body of [mail.text, mail.html]) {
    if (body && body.includes("BEGIN:VCALENDAR")) candidates.push(body);
  }

  const invites: ParsedInvite[] = [];
  const errors: string[] = [];
  for (const text of candidates) {
    const trimmed = extractCalendar(text);
    if (!trimmed) continue;
    const parsed = parseIcs(trimmed);
    if (parsed.error) errors.push(parsed.error);
    else invites.push(...parsed.invites);
  }

  if (invites.length === 0) {
    return {
      invites: [],
      from,
      subject,
      // The commonest real failure by far, and the one worth naming plainly: the client forwarded a
      // description of a meeting rather than the meeting.
      error: errors[0] ?? "no calendar attachment — the invite may have been forwarded as plain text",
    };
  }
  // Newest revision of each UID wins, and a cancellation beats an invitation at the same sequence.
  const best = new Map<string, ParsedInvite>();
  for (const inv of invites) {
    const key = `${inv.uid}|${inv.recurrenceId?.toISOString() ?? ""}`;
    const prev = best.get(key);
    if (!prev || inv.sequence > prev.sequence || (inv.sequence === prev.sequence && inv.cancelled)) best.set(key, inv);
  }
  return { invites: [...best.values()], from, subject, error: null };
}

/** An HTML body can carry the calendar inside markup; take from BEGIN to END and let the parser judge. */
function extractCalendar(text: string): string | null {
  const start = text.indexOf("BEGIN:VCALENDAR");
  if (start < 0) return null;
  const end = text.indexOf("END:VCALENDAR", start);
  if (end < 0) return null;
  return text.slice(start, end + "END:VCALENDAR".length);
}

/** An attachment arrives as text, an ArrayBuffer, or a view over one, depending on the encoding. */
function textOf(content: string | ArrayBuffer | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}
