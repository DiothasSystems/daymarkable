/**
 * Turning a parsed invite into the row that puts it on a planner page.
 *
 * Pure: an instant and a timezone in, a local date and time out. The conversion is the whole job and
 * it is the part most likely to be wrong in a way nobody notices — a 9am meeting in New York read by
 * a server in UTC is a 1pm meeting, and it will look plausible on the page.
 */
import { DateTime } from "luxon";
import { createHash } from "node:crypto";
import type { ParsedInvite } from "./ical.js";

export interface InviteEvent {
  /** Deterministic from the UID, so the same meeting always lands on the same row (rule 4). */
  id: string;
  icalUid: string;
  icalSequence: number;
  title: string;
  /** The series anchor, as a local date in the ACCOUNT's timezone. */
  date: string;
  /** HH:MM local, or null for an all-day entry. */
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  /** Organiser and attendees, as addresses. Shown on the page; never mailed to (rule 10). */
  people: string[];
  rrule: string | null;
  exdates: string[];
  /** METHOD:CANCEL or STATUS:CANCELLED — the meeting comes OFF the planner. */
  cancelled: boolean;
}

/**
 * An id that is a function of the UID and nothing else.
 *
 * Forwarding the same invite twice, or an organiser sending three updates, must converge on one row
 * rather than three meetings on one morning. Hashed rather than used raw because a UID is
 * organiser-chosen text of any length and shape, and this ends up in a page's item code.
 */
export function eventIdForUid(uid: string): string {
  return `ext-${createHash("sha1").update(uid).digest("hex").slice(0, 24)}`;
}

/**
 * Map an invite onto an event in the account's own timezone.
 *
 * `timezone` is the account's zone, not the invite's. A meeting is put on the page the customer will
 * be looking at: an invite written in Europe/London for 14:00 belongs at 09:00 on an America/New_York
 * planner, because that is when its owner has to be somewhere.
 */
export function toInviteEvent(invite: ParsedInvite, timezone: string): InviteEvent {
  const zone = DateTime.now().setZone(timezone).isValid ? timezone : "UTC";
  const start = DateTime.fromJSDate(invite.startsAt).setZone(zone);
  const end = invite.endsAt ? DateTime.fromJSDate(invite.endsAt).setZone(zone) : null;

  const people = [invite.organizer, ...invite.attendees].filter((a): a is string => !!a);
  return {
    id: eventIdForUid(invite.uid),
    icalUid: invite.uid,
    icalSequence: invite.sequence,
    title: invite.title,
    date: start.toISODate()!,
    startTime: invite.allDay ? null : start.toFormat("HH:mm"),
    // An all-day invite has no end time worth printing, and DTEND on one is the day AFTER it finishes.
    endTime: invite.allDay || !end ? null : end.toFormat("HH:mm"),
    location: invite.location,
    people: [...new Set(people)].slice(0, 12),
    rrule: invite.rrule,
    exdates: invite.exdates
      .map((d) => DateTime.fromJSDate(d).setZone(zone).toISODate())
      .filter((d): d is string => d !== null),
    cancelled: invite.cancelled,
  };
}

/**
 * Should this message be allowed to write to this account?
 *
 * The address the invite was sent TO identifies the account; this decides whether the sender may act
 * on it. The token travels in mail headers and forwarding chains and will leak eventually, so on its
 * own it is not a credential — an invite is taken only from an address the customer has already told
 * us is theirs.
 *
 * Case-insensitive, and Gmail's dots-and-plus aliasing is deliberately NOT normalised: guessing that
 * two addresses are the same person is how a check like this becomes a hole.
 */
export function senderAllowed(from: string | null, allowed: readonly (string | null | undefined)[]): boolean {
  if (!from) return false;
  const f = from.trim().toLowerCase();
  if (!f.includes("@")) return false;
  return allowed.some((a) => typeof a === "string" && a.trim().toLowerCase() === f);
}

/** Does an incoming revision supersede what is already stored? */
export function supersedes(incomingSequence: number, storedSequence: number | null): boolean {
  if (storedSequence === null || storedSequence === undefined) return true;
  // Equal sequences are allowed through: a cancellation is often sent at the same SEQUENCE as the
  // invitation it withdraws, and re-sending an unchanged invite is harmless because the row it
  // produces is identical.
  return incomingSequence >= storedSequence;
}
