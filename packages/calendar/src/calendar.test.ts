/**
 * Reading real invites.
 *
 * The fixtures here are the shapes that actually arrive: Outlook with the calendar inline and a
 * VTIMEZONE of its own, Gmail with an `invite.ics` attachment, an update, a cancellation, and a
 * forward that lost the calendar altogether. Every one is a whole MIME message rather than a bare
 * `.ics`, because finding the calendar inside the email is half the job and the half more likely to
 * break.
 */
import { describe, expect, it } from "vitest";
import { eventIdForUid, parseIcs, readInboundMessage, senderAllowed, supersedes, toInviteEvent } from "./index.js";

const NY_VTIMEZONE = `BEGIN:VTIMEZONE\r
TZID:America/New_York\r
BEGIN:DAYLIGHT\r
TZOFFSETFROM:-0500\r
TZOFFSETTO:-0400\r
DTSTART:20070311T020000\r
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r
END:DAYLIGHT\r
BEGIN:STANDARD\r
TZOFFSETFROM:-0400\r
TZOFFSETTO:-0500\r
DTSTART:20071104T020000\r
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r
END:STANDARD\r
END:VTIMEZONE`;

function ics(body: string, method = "REQUEST"): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\nMETHOD:${method}\r\n${NY_VTIMEZONE}\r\n${body}\r\nEND:VCALENDAR`;
}

/** Outlook's shape: text/calendar as a body part, not an attachment. */
function outlookMessage(calendar: string, from = "jim@example.com"): string {
  return [
    `From: Jim <${from}>`,
    "To: a1b2c3d4e5f6@cal.daymarkable.com",
    "Subject: FW: Board meeting",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="_000_bound_"',
    "",
    "--_000_bound_",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Forwarding this one.",
    "",
    "--_000_bound_",
    'Content-Type: text/calendar; charset=utf-8; method=REQUEST',
    "",
    calendar,
    "",
    "--_000_bound_--",
    "",
  ].join("\r\n");
}

/** Gmail's shape: the calendar as an attached invite.ics. */
function gmailMessage(calendar: string, from = "jim@example.com"): string {
  return [
    `From: ${from}`,
    "To: a1b2c3d4e5f6@cal.daymarkable.com",
    "Subject: Fwd: Standup",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="xx"',
    "",
    "--xx",
    "Content-Type: text/plain",
    "",
    "see attached",
    "",
    "--xx",
    'Content-Type: application/ics; name="invite.ics"',
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    calendar,
    "",
    "--xx--",
    "",
  ].join("\r\n");
}

const RECURRING = `BEGIN:VEVENT\r
UID:040000820000000@example.com\r
SEQUENCE:0\r
SUMMARY:Board meeting\r
LOCATION:Room 4\r
ORGANIZER;CN=Chair:mailto:chair@example.com\r
ATTENDEE;CN=Jim:mailto:jim@example.com\r
DTSTART;TZID=America/New_York:20260917T090000\r
DTEND;TZID=America/New_York:20260917T103000\r
RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3;COUNT=6\r
EXDATE;TZID=America/New_York:20261119T090000\r
END:VEVENT`;

describe("reading an invite out of an email", () => {
  it("finds the calendar inline, the way Outlook sends it", async () => {
    const r = await readInboundMessage(outlookMessage(ics(RECURRING)));
    expect(r.error).toBeNull();
    expect(r.from).toBe("jim@example.com");
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0]!.title).toBe("Board meeting");
    expect(r.invites[0]!.location).toBe("Room 4");
  });

  it("finds it as an attachment, the way Gmail sends it", async () => {
    const r = await readInboundMessage(gmailMessage(ics(RECURRING)));
    expect(r.error).toBeNull();
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0]!.uid).toBe("040000820000000@example.com");
  });

  /** The commonest real failure: the client forwarded a description, not the meeting. */
  it("says plainly when the forward carried no calendar at all", async () => {
    const plain = ["From: jim@example.com", "To: a1@cal.daymarkable.com", "Subject: lunch?", "", "Tuesday at one?", ""].join("\r\n");
    const r = await readInboundMessage(plain);
    expect(r.invites).toEqual([]);
    expect(r.error).toMatch(/forwarded as plain text/);
    // The sender still comes back, so the caller can refuse an unknown one before saying anything else.
    expect(r.from).toBe("jim@example.com");
  });

  it("keeps the newest revision when a message carries two", async () => {
    const older = RECURRING.replace("SEQUENCE:0", "SEQUENCE:1").replace("Board meeting", "Board meeting (old)");
    const newer = RECURRING.replace("SEQUENCE:0", "SEQUENCE:4");
    const r = await readInboundMessage(outlookMessage(ics(`${older}\r\n${newer}`)));
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0]!.sequence).toBe(4);
    expect(r.invites[0]!.title).toBe("Board meeting");
  });

  it("refuses a message bigger than any real invite", async () => {
    const r = await readInboundMessage("x".repeat(3 * 1024 * 1024));
    expect(r.error).toMatch(/over the/);
  });
});

describe("the calendar data itself", () => {
  const parsed = parseIcs(ics(RECURRING));

  it("reads the rule, the exclusions and the people", () => {
    const inv = parsed.invites[0]!;
    expect(inv.rrule).toContain("BYSETPOS=3");
    expect(inv.exdates).toHaveLength(1);
    expect(inv.organizer).toBe("chair@example.com");
    expect(inv.attendees).toEqual(["jim@example.com"]);
    expect(inv.cancelled).toBe(false);
  });

  /**
   * The failure that would look plausible on the page. 09:00 in New York is 13:00 UTC; a server that
   * ignored the invite's own VTIMEZONE would print the meeting four hours late and nothing would
   * look broken.
   */
  it("resolves the invite's own timezone rather than the server's", () => {
    const inv = parsed.invites[0]!;
    expect(inv.timezone).toBe("America/New_York");
    expect(inv.startsAt.toISOString()).toBe("2026-09-17T13:00:00.000Z");
  });

  it("recognises a cancellation", () => {
    const cancelled = parseIcs(ics(RECURRING, "CANCEL"));
    expect(cancelled.invites[0]!.cancelled).toBe(true);
  });

  it("recognises a single moved occurrence of a series", () => {
    const one = RECURRING.replace("RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3;COUNT=6\r\n", "RECURRENCE-ID;TZID=America/New_York:20261015T090000\r\n");
    const inv = parseIcs(ics(one)).invites[0]!;
    expect(inv.recurrenceId).not.toBeNull();
    expect(inv.rrule).toBeNull();
  });

  it("reports rubbish as rubbish instead of throwing", () => {
    expect(parseIcs("this is not a calendar").error).not.toBeNull();
    expect(parseIcs(ics("")).error).toMatch(/no VEVENT/);
  });

  it("ignores an event with no UID, which could never be updated or cancelled", () => {
    const noUid = RECURRING.replace("UID:040000820000000@example.com\r\n", "");
    expect(parseIcs(ics(noUid)).invites).toEqual([]);
  });
});

describe("mapping onto a planner row", () => {
  const inv = parseIcs(ics(RECURRING)).invites[0]!;

  it("puts the meeting on the page the customer will be looking at", () => {
    const ny = toInviteEvent(inv, "America/New_York");
    expect(ny.date).toBe("2026-09-17");
    expect(ny.startTime).toBe("09:00");
    expect(ny.endTime).toBe("10:30");

    // Same instant, different reader: 13:00 in London, and the RULE travels unchanged.
    const london = toInviteEvent(inv, "Europe/London");
    expect(london.date).toBe("2026-09-17");
    expect(london.startTime).toBe("14:00");
    expect(london.rrule).toBe(ny.rrule);
  });

  it("falls back to UTC rather than throwing on a timezone it does not know", () => {
    expect(toInviteEvent(inv, "Mars/Olympus").startTime).toBe("13:00");
  });

  /** Rule 4: forwarding the same invite twice must land on one row, not two meetings one morning. */
  it("gives the same meeting the same id every time", () => {
    expect(toInviteEvent(inv, "America/New_York").id).toBe(toInviteEvent(inv, "Europe/London").id);
    expect(eventIdForUid("a")).not.toBe(eventIdForUid("b"));
    expect(eventIdForUid("a")).toMatch(/^ext-[0-9a-f]{24}$/);
  });

  it("carries the exclusion through as a local date", () => {
    expect(toInviteEvent(inv, "America/New_York").exdates).toEqual(["2026-11-19"]);
  });
});

describe("who may write to an account", () => {
  /**
   * The token in the address identifies; the sender authorises. The token travels in mail headers and
   * forwarding chains and will leak, so on its own it cannot be the thing that lets a message write
   * into somebody's diary.
   */
  it("accepts only an address the account has already claimed", () => {
    expect(senderAllowed("jim@example.com", ["jim@example.com", null])).toBe(true);
    expect(senderAllowed("JIM@Example.COM", ["jim@example.com"])).toBe(true);
    expect(senderAllowed("someone@else.com", ["jim@example.com"])).toBe(false);
    expect(senderAllowed(null, ["jim@example.com"])).toBe(false);
    expect(senderAllowed("jim@example.com", [null, undefined])).toBe(false);
  });

  /**
   * Gmail aliasing is deliberately NOT normalised. Deciding that j.im+x@gmail.com is the same person
   * as jim@gmail.com is a guess, and a guess is how a check like this turns into a hole.
   */
  it("does not try to be clever about aliases", () => {
    expect(senderAllowed("j.im+cal@gmail.com", ["jim@gmail.com"])).toBe(false);
  });

  it("lets a newer revision win and an older one lose", () => {
    expect(supersedes(3, null)).toBe(true);
    expect(supersedes(3, 2)).toBe(true);
    // Equal is allowed: a cancellation usually carries the sequence of the invitation it withdraws.
    expect(supersedes(2, 2)).toBe(true);
    expect(supersedes(1, 4)).toBe(false);
  });
});
