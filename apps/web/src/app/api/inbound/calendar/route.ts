import { inboundSecretOk, receiveCalendarMessage } from "@/server/calendar-inbox";
import { MAX_MESSAGE_BYTES } from "@daymarkable/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where forwarded calendar invites arrive.
 *
 * Takes the RAW RFC 822 message rather than a provider's own parsed JSON, because every inbound
 * vendor invents a different payload shape and the raw message is the one thing all of them can hand
 * over. Swapping Cloudflare for SES should not reach past this file.
 *
 *   POST /api/inbound/calendar
 *   X-Inbound-Secret: <INBOUND_CALENDAR_SECRET>
 *   { "to": "a1b2c3d4e5f6@cal.daymarkable.com", "raw": "<the whole message>" }
 *
 * Status codes are instructions to the provider: 2xx accepted, 4xx stop trying, 5xx retry. A message
 * from an unverified sender is 403 and final — retrying cannot help, and bouncing would tell a
 * stranger whether a token is real.
 */
export async function POST(req: Request): Promise<Response> {
  if (!inboundSecretOk(req.headers.get("x-inbound-secret"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let to: string;
  let raw: string;
  try {
    const body = (await req.json()) as { to?: unknown; raw?: unknown };
    if (typeof body.to !== "string" || typeof body.raw !== "string") {
      return Response.json({ error: "expected { to, raw }" }, { status: 400 });
    }
    to = body.to;
    raw = body.raw;
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (raw.length > MAX_MESSAGE_BYTES) {
    return Response.json({ error: "message too large" }, { status: 413 });
  }

  try {
    const result = await receiveCalendarMessage(to, raw);
    if (!result.ok) {
      // The reason describes the message, never its contents (rule 5).
      console.warn(`[calendar-inbox] rejected: ${result.reason}`);
      return Response.json({ error: result.reason }, { status: result.status });
    }
    console.log(`[calendar-inbox] ${result.added} added, ${result.updated} updated, ${result.cancelled} cancelled, ${result.ignored} ignored`);
    return Response.json(result);
  } catch (err) {
    // A 500 asks the provider to try again, which is safe: the same invite applied twice lands on the
    // same row, because the id is a function of the UID (rule 4).
    console.error(`[calendar-inbox] failed: ${(err as Error).message}`);
    return Response.json({ error: "could not process the message" }, { status: 500 });
  }
}
