/**
 * Resend's half of the inbound invite path, with no I/O in it: proving a delivery came from Resend,
 * and reading the shape of what it sent. The fetches live in resend-inbound.ts; everything that
 * decides something lives here, so it can be tested without a network or a key.
 *
 * Why this exists next to /api/inbound/calendar rather than instead of it. That endpoint takes a RAW
 * message behind a shared header, which is the seam rule 17 wanted: anything that can set its own
 * headers — a Cloudflare Worker, an SES Lambda — can use it and a vendor swap reaches no further.
 * Resend can do neither half. Its webhooks carry a Svix signature and no configurable headers, and
 * the payload is metadata with the message behind two more calls. So the raw endpoint stays as it is
 * and Resend gets its own door, with the provider-specific part confined to these two files.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Five minutes, matching Svix's own guidance for how stale a delivery may be. */
export const SVIX_TOLERANCE_SEC = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/** The three headers Svix signs with, exactly as they arrive — absent ones included. */
export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Verify a webhook came from Resend and not from someone who found the URL.
 *
 * Svix signs `id.timestamp.body` with HMAC-SHA256, keyed on the BASE64 PAYLOAD of the secret — the
 * part after `whsec_`, decoded — and not on the literal string. Keying on the string is the easy
 * mistake and it produces a verifier that rejects every real delivery, which at least fails loudly.
 *
 * The signature header is a space-delimited list of `v1,<base64>` entries and the delivery is valid
 * if ANY entry matches. That is how a secret is rotated without dropping deliveries mid-rotation, so
 * checking only the first entry would break exactly once, months from now, during a rotation.
 *
 * `payload` must be the body as received. Parsing the JSON and re-serialising it changes the bytes
 * and nothing will match — the commonest cause of a verifier that works until a subject line
 * contains a non-ASCII character.
 *
 * Both halves matter, for the same reasons they matter on Stripe (billing-core.ts): without the
 * signature, anyone who learns this URL can post a meeting into a stranger's diary, and without the
 * timestamp a single captured delivery can be replayed for ever.
 */
export function verifySvixSignature(
  payload: string,
  headers: SvixHeaders,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSec: number = SVIX_TOLERANCE_SEC,
): SignatureCheck {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing svix headers" };

  const sentSec = Number(timestamp);
  if (!Number.isFinite(sentSec)) return { ok: false, reason: "malformed timestamp" };
  if (Math.abs(nowMs / 1000 - sentSec) > toleranceSec) return { ok: false, reason: "timestamp outside tolerance" };

  const key = secretKey(secret);
  if (!key) return { ok: false, reason: "signing secret is not base64 after whsec_" };

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest();
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0) continue;
    if (entry.slice(0, comma).trim() !== "v1") continue;
    // Buffer.from silently drops characters it cannot decode rather than throwing, so a malformed
    // entry becomes a short buffer and is rejected by the length check rather than by an exception.
    const given = Buffer.from(entry.slice(comma + 1).trim(), "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "no signature matched" };
}

/** The HMAC key: the secret's base64 payload, with the `whsec_` label removed if it is there. */
function secretKey(secret: string): Buffer | null {
  const b64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (!b64) return null;
  const key = Buffer.from(b64, "base64");
  return key.length > 0 ? key : null;
}

export interface ReceivedEvent {
  emailId: string;
  /**
   * Every address the delivery was for, header and envelope. One of them carries the account token;
   * which one is not knowable here, so the caller tries each.
   */
  recipients: string[];
}

export type ParsedEvent =
  | { ok: true; event: ReceivedEvent }
  /** `ignorable` means a retry could never help AND nothing is wrong — accept and drop. */
  | { ok: false; reason: string; ignorable: boolean };

/**
 * Read an `email.received` delivery.
 *
 * Both `to` and `received_for` are collected. `to` is the parsed To: header, which is our address on
 * an ordinary forward; `received_for` is the envelope recipient from the Received header's `for`
 * clause, which is the one that survives a mail rule that redirected the message or a client that
 * put our address in Bcc. Either can be the one with the token, so both go to the caller.
 *
 * An event of another type is `ignorable` rather than an error. A webhook subscribed to more than
 * `email.received`, or a console test ping, is a configuration detail and not a failure; answering
 * 4xx would make Resend retry something that can never succeed and eventually disable the endpoint.
 */
export function parseReceivedEvent(body: unknown): ParsedEvent {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "body is not an object", ignorable: false };
  const ev = body as { type?: unknown; data?: unknown };
  if (typeof ev.type !== "string") return { ok: false, reason: "no event type", ignorable: false };
  if (ev.type !== "email.received") return { ok: false, reason: `ignoring ${ev.type}`, ignorable: true };

  const data = (typeof ev.data === "object" && ev.data !== null ? ev.data : {}) as {
    email_id?: unknown;
    to?: unknown;
    received_for?: unknown;
  };
  if (typeof data.email_id !== "string" || !data.email_id) {
    return { ok: false, reason: "no email_id on the event", ignorable: false };
  }
  const recipients = [...addresses(data.to), ...addresses(data.received_for)];
  if (recipients.length === 0) return { ok: false, reason: "no recipient address on the event", ignorable: false };
  return { ok: true, event: { emailId: data.email_id, recipients } };
}

/** `to` is documented as an array, but a single string is cheap to tolerate and costs nothing. */
function addresses(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}
