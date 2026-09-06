/**
 * The nightly delivery: the three notebooks as PDF attachments, sent to the address the user
 * typed into their settings and confirmed.
 *
 * Rule 10 still holds — this address is not read off a page and not guessed. The user typed it,
 * and it received a confirmation link before anything else was sent to it. The verification
 * mail lives here too, so both sides of that promise are in one file.
 */
import type { MailAttachment, OutgoingMail } from "./provider.js";

const SANS = "'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "'Source Serif 4',Georgia,'Times New Roman',serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shell(headline: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 0;background:#e8e2d4;font-family:${SANS};color:#1e2a44">
<div style="max-width:560px;margin:0 auto;background:#f7f0e3;border:1px solid #e3d9c2;border-radius:6px;overflow:hidden">
  <div style="background:#1e2a44;color:#f7f0e3;padding:14px 22px;font-family:${SERIF};font-size:18px;font-weight:700">
    <span style="color:#c9973f">day</span>Markable
  </div>
  <div style="padding:22px">
    <h1 style="font-family:${SERIF};font-size:24px;font-weight:600;margin:0 0 14px;color:#1e2a44">${esc(headline)}</h1>
    ${body}
  </div>
</div></body></html>`;
}

export interface DeliveryDocument {
  /** "Planner", "Action List", "Meeting Notes". */
  name: string;
  pdf: Uint8Array;
  pageCount: number;
}

export function deliveryIdempotencyKey(userId: string, localDate: string, to: string): string {
  return `delivery:${userId}:${localDate}:${to}`;
}

/** One email per run carrying the night's documents. */
export function buildDeliveryMail(to: string, userId: string, localDate: string, docs: readonly DeliveryDocument[], summary: { openActions: number; meetings: number }): OutgoingMail {
  const rows = docs
    .map(
      (d) =>
        `<tr><td style="padding:6px 0;font-size:14px;color:#4a5266">${esc(d.name)}</td>` +
        `<td style="padding:6px 0;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a7d5f;text-align:right">${d.pageCount} page${d.pageCount === 1 ? "" : "s"}</td></tr>`,
    )
    .join("");
  const html = shell(
    `Your notebooks for ${localDate}`,
    `<p style="font-size:14px;line-height:1.6;color:#4a5266;margin:0 0 14px">${summary.openActions} open action${summary.openActions === 1 ? "" : "s"}, ${summary.meetings} meeting${summary.meetings === 1 ? "" : "s"}. The PDFs are attached.</p>
     <table style="width:100%;border-collapse:collapse;border-top:1px solid #e3d9c2">${rows}</table>`,
  );
  const text = [
    `dayMarkable — your notebooks for ${localDate}`,
    `${summary.openActions} open actions, ${summary.meetings} meetings.`,
    ...docs.map((d) => `- ${d.name} (${d.pageCount} pages)`),
  ].join("\n");
  const attachments: MailAttachment[] = docs.map((d) => ({ filename: `${d.name.replace(/\s+/g, "-")}-${localDate}.pdf`, content: d.pdf }));
  return { to, subject: `dayMarkable — ${localDate}`, html, text, idempotencyKey: deliveryIdempotencyKey(userId, localDate, to), attachments };
}

/**
 * Sent the moment the address is saved. Until its link is clicked, nothing else goes to that
 * address — which is what stops a typo delivering someone's notes to a stranger every night.
 */
export function buildDeliveryVerificationMail(to: string, userId: string, verifyUrl: string): OutgoingMail {
  const html = shell(
    "Confirm this address",
    `<p style="font-size:14px;line-height:1.6;color:#4a5266;margin:0 0 18px">Someone asked dayMarkable to deliver their planner, action list and meeting notes to this address. Confirm it and the nightly delivery begins; ignore this and nothing further is sent here.</p>
     <p style="margin:0 0 18px"><a href="${esc(verifyUrl)}" style="display:inline-block;background:#1e2a44;color:#f7f0e3;text-decoration:none;padding:11px 18px;border-radius:4px;font-size:14px;font-weight:600">Confirm this address</a></p>
     <p style="font-size:12px;line-height:1.6;color:#8a7d5f;margin:0">Or paste this link into a browser:<br>${esc(verifyUrl)}</p>`,
  );
  const text = `Confirm delivery of dayMarkable documents to this address:\n${verifyUrl}\n\nIf you were not expecting this, ignore it — nothing further will be sent here.`;
  return { to, subject: "Confirm your dayMarkable delivery address", html, text, idempotencyKey: `verify:${userId}:${to}:${Date.now()}` };
}
