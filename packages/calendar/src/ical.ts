/**
 * Reading a calendar invite.
 *
 * A meeting invite forwarded from Outlook or Google carries a `text/calendar` part — RFC 5545 — and
 * that part is structured data, not prose. It is parsed here deterministically, with no model
 * involved: unlike everything else that reaches a tablet, this path costs nothing per message and
 * cannot be talked into anything by its contents.
 *
 * `ical.js` does the parsing and the recurrence arithmetic. This is the opposite call to the one
 * made for the crossword, where a dependency would have given neither validity nor verification:
 * RRULE is a real specification with real corners — BYSETPOS, ordinal BYDAY, WKST, COUNT against
 * EXDATE, UNTIL in UTC against a local DTSTART — and hand-rolling it would produce a parser that
 * looked right and quietly dropped the third Thursday.
 *
 * Nothing here does I/O, and nothing here logs: an invite is the customer's own diary (rule 5).
 */
import ICAL from "ical.js";

export type InviteMethod = "REQUEST" | "CANCEL" | "REPLY" | "PUBLISH" | "COUNTER" | "OTHER";

export interface ParsedInvite {
  /** RFC 5545 UID. The identity of the meeting across every update and cancellation it ever gets. */
  uid: string;
  /** Bumped by the organiser on each revision; an older one must never overwrite a newer. */
  sequence: number;
  method: InviteMethod;
  title: string;
  location: string | null;
  organizer: string | null;
  attendees: string[];
  /** The absolute instant the meeting starts. */
  startsAt: Date;
  endsAt: Date | null;
  /** The timezone the invite itself was written in, or null when it carries a floating time. */
  timezone: string | null;
  allDay: boolean;
  /** Raw RRULE, stored as written so expansion is never lossy. Null for a one-off. */
  rrule: string | null;
  /** Instants removed from the series by the organiser. */
  exdates: Date[];
  /**
   * Set when this message is about ONE occurrence of a series rather than the series itself — the
   * "just this meeting" move that every calendar offers. It carries the instant of the occurrence
   * being replaced.
   */
  recurrenceId: Date | null;
  /** METHOD:CANCEL, or STATUS:CANCELLED on the event. */
  cancelled: boolean;
}

export interface ParseResult {
  invites: ParsedInvite[];
  /** Why nothing was found, for a message that carried no usable calendar data. */
  error: string | null;
}

const METHODS: readonly InviteMethod[] = ["REQUEST", "CANCEL", "REPLY", "PUBLISH", "COUNTER"];

/**
 * Parse an iCalendar document into the invites it describes.
 *
 * Returns an error rather than throwing: this is fed by whatever a mail client chose to send, and a
 * malformed attachment is an ordinary Tuesday, not an exception.
 */
export function parseIcs(text: string): ParseResult {
  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    return { invites: [], error: `not iCalendar: ${(err as Error).message}` };
  }
  if (comp.name !== "vcalendar") return { invites: [], error: `expected VCALENDAR, got ${comp.name}` };

  // VTIMEZONE definitions travel inside the invite. Registering them is what makes TZID resolve;
  // without it every start time is "floating" and lands in whatever zone the server happens to be
  // in — which is how a 9am meeting in New York becomes a 9am meeting in UTC.
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vt);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz);
    } catch {
      // A malformed VTIMEZONE is not worth losing the meeting over; the time falls back to floating.
    }
  }

  const raw = String(comp.getFirstPropertyValue("method") ?? "").toUpperCase();
  const method: InviteMethod = (METHODS as readonly string[]).includes(raw) ? (raw as InviteMethod) : "OTHER";

  const invites: ParsedInvite[] = [];
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const parsed = readEvent(vevent, method);
    if (parsed) invites.push(parsed);
  }
  if (invites.length === 0) return { invites: [], error: "no VEVENT in the calendar" };
  return { invites, error: null };
}

function readEvent(vevent: ICAL.Component, method: InviteMethod): ParsedInvite | null {
  let event: ICAL.Event;
  try {
    event = new ICAL.Event(vevent);
  } catch {
    return null;
  }
  const uid = event.uid;
  const start = event.startDate;
  // Without a UID there is nothing to update or cancel later, and without a start there is no
  // meeting. Either one missing means this is not something to put on a page.
  if (!uid || !start) return null;

  const tzid = start.zone?.tzid ?? null;
  const status = String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase();
  const rrule = vevent.getFirstPropertyValue("rrule");
  const recurrenceId = vevent.getFirstPropertyValue("recurrence-id");

  return {
    uid,
    sequence: typeof event.sequence === "number" ? event.sequence : 0,
    method,
    title: (event.summary ?? "").trim() || "(no title)",
    location: (event.location ?? "").trim() || null,
    organizer: address(vevent.getFirstPropertyValue("organizer")),
    attendees: vevent
      .getAllProperties("attendee")
      .map((p) => address(p.getFirstValue()))
      .filter((a): a is string => a !== null),
    startsAt: start.toJSDate(),
    endsAt: event.endDate ? event.endDate.toJSDate() : null,
    // "floating" is ical.js's name for a time with no zone, which is not a zone anyone can be in.
    timezone: tzid && tzid !== "floating" ? tzid : null,
    allDay: start.isDate === true,
    rrule: rrule ? String(rrule) : null,
    exdates: vevent
      .getAllProperties("exdate")
      .map((p) => {
        const v = p.getFirstValue();
        return v && typeof (v as ICAL.Time).toJSDate === "function" ? (v as ICAL.Time).toJSDate() : null;
      })
      .filter((d): d is Date => d !== null),
    recurrenceId:
      recurrenceId && typeof (recurrenceId as ICAL.Time).toJSDate === "function" ? (recurrenceId as ICAL.Time).toJSDate() : null,
    cancelled: method === "CANCEL" || status === "CANCELLED",
  };
}

/** `mailto:jim@example.com` and a bare address both reduce to the address. */
function address(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const at = s.toLowerCase().startsWith("mailto:") ? s.slice(7) : s;
  return at.includes("@") ? at.toLowerCase() : null;
}
