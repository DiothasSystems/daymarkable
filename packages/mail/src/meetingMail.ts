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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0;white-space:pre-wrap">${esc(p.trim())}</p>`)
    .join("");
}

export function buildMeetingMail(to: string, userId: string, m: Meeting): OutgoingMail {
  const when = `${formatMeetingDate(m.date)}${m.time ? ` · ${m.time}` : ""}`;
  const attendees = m.attendees.length ? m.attendees.join(", ") : "—";
  const list = (items: string[]) => (items.length ? `<ul style="margin:0 0 12px 18px;padding:0">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p style="margin:0 0 12px 0;color:#6b6760">none recorded</p>`);
  const html = `<!doctype html><html><body style="margin:0;background:#F7F4EE;font-family:'Public Sans',Helvetica,Arial,sans-serif;color:#211F1A">
<div style="max-width:640px;margin:0 auto;padding:32px 24px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
    <span style="display:inline-block;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:16px solid #CE4B18"></span>
    <span style="font-family:'Instrument Serif',Georgia,serif;font-size:22px">dayMarkable</span>
  </div>
  <h1 style="font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:28px;margin:0 0 4px 0">${esc(m.topic)}</h1>
  <p style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:13px;color:#6b6760;margin:0 0 20px 0">${esc(when)} · with ${esc(attendees)}</p>
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#CE4B18;margin:20px 0 8px">Notes</h2>
  ${paragraphs(m.text || "(no notes captured)")}
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#CE4B18;margin:20px 0 8px">Decisions</h2>
  ${list(m.decisions)}
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#CE4B18;margin:20px 0 8px">Actions</h2>
  ${list(m.actions)}
  <p style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;color:#6b6760;margin-top:32px">Decoded from “${esc(m.source.notebook)}” page ${m.source.pageIndex + 1}, confidence ${Math.round(m.confidence * 100)}%. Written down, woken up organized.</p>
</div></body></html>`;
  const text = [
    `${m.topic}`,
    `${when} · with ${attendees}`,
    "",
    "NOTES",
    m.text || "(no notes captured)",
    "",
    "DECISIONS",
    ...(m.decisions.length ? m.decisions.map((d) => `- ${d}`) : ["none recorded"]),
    "",
    "ACTIONS",
    ...(m.actions.length ? m.actions.map((a) => `- ${a}`) : ["none recorded"]),
    "",
    `Decoded from "${m.source.notebook}" page ${m.source.pageIndex + 1}, confidence ${Math.round(m.confidence * 100)}%.`,
  ].join("\n");
  return { to, subject: meetingSubject(m), html, text, idempotencyKey: meetingIdempotencyKey(userId, m) };
}
