/**
 * Meeting-notes email, styled per the brand handoff ("Tablet Pages and Email", panel 1):
 * Midnight brand bar with the compass rose + wordmark + SYNCED time, Source Serif headline,
 * a Notepaper card (title, mono time + page ref, summary, ink-quote strip, gold-arrow actions),
 * a Midnight CTA, and a mono footer. One email per meeting (CLAUDE.md), subject unchanged.
 */
import type { Meeting } from "@daymarkable/core";
import type { OutgoingMail } from "./provider.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatMeetingDate(date: string | null): string {
  if (!date) return "undated";
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Subject line contract (CLAUDE.md packages/mail): "<topic> — <date> <time>". */
export function meetingSubject(m: Meeting): string {
  return `${m.topic} — ${formatMeetingDate(m.date)}${m.time ? ` ${m.time}` : ""}`;
}

export function meetingIdempotencyKey(userId: string, m: Meeting): string {
  return `meeting:${userId}:${m.id}:${m.date ?? "undated"}`;
}

export interface MeetingMailOptions {
  /** e.g. "02:14" in the user's timezone. */
  syncedAt?: string;
  /** Link for the CTA (web app documents page). */
  appUrl?: string;
  /** Counts for the footer line. */
  notebooksRead?: number;
  pagesRead?: number;
}

const ROSE = `<svg width="26" height="26" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"><circle cx="36" cy="36" r="26" fill="none" stroke="#c9973f" stroke-width="5"></circle><path d="M 36 2 L 41 12 L 36 18 L 31 12 Z" fill="#c9973f"></path><path d="M 36 70 L 41 60 L 36 54 L 31 60 Z" fill="#c9973f"></path><path d="M 2 36 L 12 31 L 18 36 L 12 41 Z" fill="#c9973f"></path><path d="M 70 36 L 60 31 L 54 36 L 60 41 Z" fill="#c9973f"></path></svg>`;

const SERIF = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const SANS = "'Public Sans', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="font-family:${SANS};font-size:13px;line-height:1.6;color:#4a5266;margin:10px 0 12px;white-space:pre-wrap">${esc(p.trim())}</p>`)
    .join("");
}

/** The first decision, else the first line of ink, as the "source reference" quote. */
function inkQuote(m: Meeting): string | null {
  const q = m.decisions[0] ?? m.text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? null;
  return q ? (q.length > 120 ? `${q.slice(0, 117)}…` : q) : null;
}

export function buildMeetingMail(to: string, userId: string, m: Meeting, opts: MeetingMailOptions = {}): OutgoingMail {
  const when = `${m.time ? `${m.time} · ` : ""}${m.source.notebook} · p.${m.source.pageIndex + 1}`;
  const attendees = m.attendees.length ? m.attendees.join(", ") : "—";
  const quote = inkQuote(m);
  const actions = m.actions
    .map(
      (a) =>
        `<tr><td style="font-family:${SANS};font-size:13px;color:#1e2a44;padding:3px 0"><span style="color:#b8862f;font-weight:700">→</span>&nbsp; ${esc(a)}</td></tr>`,
    )
    .join("");
  const decisions = m.decisions.length ? `<ul style="margin:10px 0 0 18px;padding:0;font-family:${SANS};font-size:13px;color:#1e2a44;line-height:1.6">${m.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
  const cta = opts.appUrl ? `<div style="margin-top:24px;text-align:center"><a href="${esc(opts.appUrl)}" style="display:inline-block;background:#1e2a44;color:#f7f0e3;text-decoration:none;border-radius:4px;padding:12px 28px;font-family:${SANS};font-size:14px;font-weight:600">Open in dayMarkable</a></div>` : "";
  const footer = [opts.notebooksRead ? `READ FROM ${opts.notebooksRead} NOTEBOOK${opts.notebooksRead === 1 ? "" : "S"}` : null, opts.pagesRead ? `${opts.pagesRead} PAGE${opts.pagesRead === 1 ? "" : "S"}` : null, `${Math.round(m.confidence * 100)}% CONFIDENCE`].filter(Boolean).join(" · ");

  const html = `<!doctype html><html><body style="margin:0;padding:24px 0;background:#e8e2d4;font-family:${SANS};color:#1e2a44">
<div style="width:560px;max-width:100%;margin:0 auto;background:#f7f0e3;border:1px solid #cfc5ac;border-radius:6px;overflow:hidden">
  <div style="background:#1e2a44;padding:18px 32px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="vertical-align:middle;width:26px">${ROSE}</td>
      <td style="vertical-align:middle;padding-left:12px;font-family:${SERIF};font-size:20px;font-weight:700;color:#f7f0e3"><span style="color:#c9973f">day</span>Markable</td>
      <td style="vertical-align:middle;text-align:right;font-family:${MONO};font-size:10px;color:#a09372">${opts.syncedAt ? `SYNCED ${esc(opts.syncedAt)}` : formatMeetingDate(m.date).toUpperCase()}</td>
    </tr></table>
  </div>
  <div style="padding:28px 32px">
    <div style="font-family:${SERIF};font-size:24px;font-weight:600;line-height:1.25;color:#1e2a44">${esc(m.topic)}</div>
    <div style="margin-top:6px;font-family:${MONO};font-size:11px;color:#8a7d5f">${esc(formatMeetingDate(m.date))}${m.time ? ` · ${esc(m.time)}` : ""} · with ${esc(attendees)}</div>
    <div style="margin-top:22px;background:#fdfaf3;border:1px solid #e3d9c2;border-radius:6px;padding:20px 22px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="font-family:${SANS};font-weight:700;font-size:15px;color:#1e2a44">Notes</td>
        <td style="text-align:right;font-family:${MONO};font-size:10px;color:#8a7d5f">${esc(when)}</td>
      </tr></table>
      ${paragraphs(m.text || "(no notes captured)")}
      ${quote ? `<div style="border-left:3px solid #c9973f;padding:6px 12px;background:#f7f0e3;font-family:${SANS};font-size:12px;font-style:italic;color:#4a5266">“${esc(quote)}”</div><div style="font-family:${MONO};font-size:10px;color:#8a7d5f;margin-top:6px">${esc(m.source.notebook.toUpperCase())} · p.${m.source.pageIndex + 1}</div>` : ""}
      ${m.decisions.length ? `<div style="margin-top:14px;font-family:${MONO};font-size:10px;letter-spacing:0.12em;color:#8a7d5f">DECISIONS</div>${decisions}` : ""}
      ${m.actions.length ? `<div style="margin-top:14px;font-family:${MONO};font-size:10px;letter-spacing:0.12em;color:#8a7d5f">ACTIONS</div><table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:6px">${actions}</table>` : ""}
    </div>
    ${cta}
  </div>
  <div style="border-top:1px solid #e3d9c2;padding:14px 32px;font-family:${MONO};font-size:10px;color:#8a7d5f;text-align:center">${esc(footer)} · SENT ONLY TO YOUR REGISTERED ADDRESS</div>
</div></body></html>`;

  const text = [
    `${m.topic}`,
    `${formatMeetingDate(m.date)}${m.time ? ` · ${m.time}` : ""} · with ${attendees}`,
    `${when}`,
    "",
    "NOTES",
    m.text || "(no notes captured)",
    "",
    "DECISIONS",
    ...(m.decisions.length ? m.decisions.map((d) => `- ${d}`) : ["none recorded"]),
    "",
    "ACTIONS",
    ...(m.actions.length ? m.actions.map((a) => `→ ${a}`) : ["none recorded"]),
    "",
    opts.appUrl ? `Open in dayMarkable: ${opts.appUrl}` : "",
    footer,
  ].join("\n");
  return { to, subject: meetingSubject(m), html, text, idempotencyKey: meetingIdempotencyKey(userId, m) };
}
