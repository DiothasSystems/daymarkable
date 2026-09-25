/**
 * Fetching a forwarded invite out of Resend and handing it to the ingest path.
 *
 * Three hops, because Resend's inbound is built that way and there is no shortcut: the webhook
 * carries metadata only, `GET /emails/receiving/{id}` carries a signed URL, and the message itself is
 * behind that URL. Only the last of those is the thing rule 17 actually wants — a raw RFC 822
 * message — so this file exists to turn one delivery notification into one raw message and then get
 * out of the way. Everything after that is `receiveCalendarMessage`, shared with the raw endpoint, so
 * the sender check and the ingest rules cannot drift between the two doors.
 *
 * No SDK, over fetch, matching how this codebase already talks to Resend (packages/mail/provider.ts)
 * and to Stripe (server/billing.ts).
 *
 * Nothing here logs the message. An inbound invite is the customer's own diary and rule 5 covers it
 * as it covers a page — counts and outcomes only, never a subject or an address.
 */
import "server-only";
import { MAX_MESSAGE_BYTES } from "@daymarkable/calendar";
import { receiveCalendarMessage, tokenFromRecipient, type InboundOutcome } from "./calendar-inbox";
import { parseReceivedEvent, verifySvixSignature, type SvixHeaders } from "./resend-inbound-core";

const RESEND_API = "https://api.resend.com";

/** Nothing happened and nothing was wrong: an event we do not act on. */
const NOTHING: InboundOutcome = { ok: true, added: 0, updated: 0, cancelled: 0, ignored: 1 };

/**
 * Accept one `email.received` delivery.
 *
 * `rawBody` must be the body as received, not a re-serialised object — the signature is over those
 * bytes (resend-inbound-core.ts).
 *
 * Status codes are instructions to Resend: 2xx accepted, 4xx stop trying, 5xx deliver again. Getting
 * that wrong in either direction is expensive — a 4xx on a transient fault silently loses a meeting,
 * and a 5xx on a permanent one has Resend retrying until it disables the endpoint.
 */
export async function receiveResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  fetchImpl: typeof fetch = fetch,
): Promise<InboundOutcome> {
  const check = verifySvixSignature(rawBody, headers, process.env.RESEND_WEBHOOK_SECRET ?? "");
  if (!check.ok) return { ok: false, status: 401, reason: check.reason };

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, reason: "body is not JSON" };
  }

  const parsed = parseReceivedEvent(body);
  if (!parsed.ok) {
    return parsed.ignorable ? NOTHING : { ok: false, status: 400, reason: parsed.reason };
  }

  // Which of the delivery's addresses is ours is not knowable from the event alone, so take the
  // first that parses as a token. A 404 here is final: a message addressed to no account of ours is
  // not going to become one on a retry.
  const recipient = parsed.event.recipients.find((r) => tokenFromRecipient(r) !== null);
  if (!recipient) return { ok: false, status: 404, reason: "no account token in any recipient address" };

  const apiKey = process.env.EMAIL_API_KEY ?? "";
  // A 500 rather than a 4xx on purpose: this is our misconfiguration, and asking Resend to deliver
  // again means the invite arrives once the key is set instead of being lost while it was not.
  if (!apiKey) return { ok: false, status: 500, reason: "EMAIL_API_KEY is not set" };

  const raw = await fetchRawMessage(parsed.event.emailId, apiKey, fetchImpl);
  if (!raw.ok) return raw;

  return receiveCalendarMessage(recipient, raw.raw);
}

type RawFetch = { ok: true; raw: string } | { ok: false; status: number; reason: string };

/** The record, then the file the record points at. */
async function fetchRawMessage(emailId: string, apiKey: string, fetchImpl: typeof fetch): Promise<RawFetch> {
  let record: Response;
  try {
    record = await fetchImpl(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { ok: false, status: 502, reason: `could not reach Resend: ${(err as Error).message}` };
  }
  if (!record.ok) {
    // Resend's own 5xx is worth another delivery; its 4xx means this id will never work, and the
    // commonest one is a message already past its retention window.
    return { ok: false, status: record.status >= 500 ? 502 : 400, reason: `resend ${record.status} retrieving the message` };
  }

  let url: unknown;
  try {
    url = ((await record.json()) as { raw?: { download_url?: unknown } }).raw?.download_url;
  } catch {
    return { ok: false, status: 502, reason: "Resend's reply was not JSON" };
  }
  if (typeof url !== "string" || !url) return { ok: false, status: 502, reason: "no raw download url on the message" };

  let file: Response;
  try {
    file = await fetchImpl(url);
  } catch (err) {
    return { ok: false, status: 502, reason: `could not download the message: ${(err as Error).message}` };
  }
  if (!file.ok) {
    // The URL is signed and short-lived, so a 403 here is usually an expired link rather than a
    // permission problem — worth one more delivery.
    return { ok: false, status: file.status >= 500 || file.status === 403 ? 502 : 400, reason: `raw download failed: ${file.status}` };
  }

  // Content-length is the check that actually prevents buffering something absurd; the check after
  // the read only catches a missing or untruthful header, by which point the memory is already
  // spent. That is an acceptable trade at a 2MB limit against a signed URL we were just handed, and
  // it is the reason the limit is small.
  const declared = Number(file.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MESSAGE_BYTES) {
    return { ok: false, status: 413, reason: `raw message is ${declared} bytes, over the ${MAX_MESSAGE_BYTES} limit` };
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    return { ok: false, status: 413, reason: `raw message is ${bytes.byteLength} bytes, over the ${MAX_MESSAGE_BYTES} limit` };
  }
  return { ok: true, raw: new TextDecoder().decode(bytes) };
}
