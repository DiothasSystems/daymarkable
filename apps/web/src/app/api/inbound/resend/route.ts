import { receiveResendWebhook } from "@/server/resend-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Resend delivers a forwarded calendar invite.
 *
 *   POST /api/inbound/resend
 *   svix-id / svix-timestamp / svix-signature
 *   { "type": "email.received", "data": { "email_id": "…", "to": ["<token>@cal.scriptumiq.com"] } }
 *
 * The sibling of /api/inbound/calendar rather than a replacement for it: that one takes a raw message
 * behind a shared header and serves anything that can set headers, which Resend cannot (see
 * server/resend-inbound-core.ts). Both end up in the same `receiveCalendarMessage`, so the sender
 * check and the ingest rules are shared and cannot drift.
 *
 * Status codes are instructions to Resend: 2xx accepted, 4xx stop trying, 5xx deliver again.
 */
export async function POST(req: Request): Promise<Response> {
  // text() and not json(): the signature is over the bytes as received, and parsing then
  // re-serialising changes them.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return Response.json({ error: "could not read the body" }, { status: 400 });
  }

  try {
    const result = await receiveResendWebhook(rawBody, {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    });
    if (!result.ok) {
      // The reason describes the delivery, never its contents (rule 5).
      console.warn(`[resend-inbound] rejected: ${result.reason}`);
      return Response.json({ error: result.reason }, { status: result.status });
    }
    console.log(
      `[resend-inbound] ${result.added} added, ${result.updated} updated, ${result.cancelled} cancelled, ${result.ignored} ignored`,
    );
    return Response.json(result);
  } catch (err) {
    // A 500 asks for another delivery, which is safe: the same invite applied twice lands on the same
    // row, because the id is a function of the UID (rule 4).
    console.error(`[resend-inbound] failed: ${(err as Error).message}`);
    return Response.json({ error: "could not process the delivery" }, { status: 500 });
  }
}
