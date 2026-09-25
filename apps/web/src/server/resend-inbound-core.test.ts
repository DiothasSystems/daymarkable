/**
 * Proving the Resend door is shut to everyone else.
 *
 * The signature is the only thing standing between this endpoint and anyone who learns the URL, so
 * the tests are written from the attacker's side: a replayed delivery, a body edited after signing, a
 * signature made with the wrong key, and a signature made with the RIGHT secret used the wrong way.
 * The last of those is the one a reimplementation gets wrong, so it is pinned deliberately.
 *
 * Signatures here are built by hand rather than by the code under test, so the test asserts the wire
 * format Svix actually documents and not merely that the module agrees with itself.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseReceivedEvent, SVIX_TOLERANCE_SEC, verifySvixSignature } from "./resend-inbound-core";

const KEY = Buffer.from("a-32-byte-ish-signing-key-value!");
const SECRET = `whsec_${KEY.toString("base64")}`;

const ID = "msg_2abcDEF";
const NOW_MS = 1_774_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));
const BODY = JSON.stringify({ type: "email.received", data: { email_id: "e1", to: ["abc123def456@cal.scriptumiq.com"] } });

/** The documented scheme: HMAC-SHA256 over `id.timestamp.body`, keyed on the DECODED secret. */
function sign(body = BODY, ts = TS, id = ID, key: Buffer = KEY): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

const headers = (signature: string, ts = TS, id: string | null = ID) => ({ id, timestamp: ts, signature });

describe("verifying a Resend delivery", () => {
  it("accepts one that was really signed by Resend", () => {
    expect(verifySvixSignature(BODY, headers(sign()), SECRET, NOW_MS)).toEqual({ ok: true });
  });

  it("refuses a body edited after it was signed", () => {
    const tampered = BODY.replace("abc123def456", "999999999999");
    const r = verifySvixSignature(tampered, headers(sign()), SECRET, NOW_MS);
    expect(r).toEqual({ ok: false, reason: "no signature matched" });
  });

  it("refuses a signature made with a different key", () => {
    const wrong = Buffer.from("another-32-byte-ish-signing-key!!");
    expect(verifySvixSignature(BODY, headers(sign(BODY, TS, ID, wrong)), SECRET, NOW_MS).ok).toBe(false);
  });

  /** Without this, one captured delivery could be posted back for ever. */
  it("refuses a delivery older than the tolerance, and accepts one inside it", () => {
    const stale = String(Math.floor(NOW_MS / 1000) - SVIX_TOLERANCE_SEC - 1);
    expect(verifySvixSignature(BODY, headers(sign(BODY, stale), stale), SECRET, NOW_MS)).toEqual({
      ok: false,
      reason: "timestamp outside tolerance",
    });
    const fresh = String(Math.floor(NOW_MS / 1000) - SVIX_TOLERANCE_SEC + 1);
    expect(verifySvixSignature(BODY, headers(sign(BODY, fresh), fresh), SECRET, NOW_MS).ok).toBe(true);
  });

  /**
   * Rotation. Svix sends the old and new signatures together while a secret is being replaced, so a
   * verifier that checks only the first entry works until the day somebody rotates.
   */
  it("accepts when any one of several signatures matches", () => {
    const other = sign(BODY, TS, ID, Buffer.from("a-decoy-32-byte-ish-signing-key!"));
    expect(verifySvixSignature(BODY, headers(`${other} ${sign()}`), SECRET, NOW_MS).ok).toBe(true);
    expect(verifySvixSignature(BODY, headers(`${sign()} ${other}`), SECRET, NOW_MS).ok).toBe(true);
  });

  /**
   * The mistake worth pinning: the key is the secret's base64 PAYLOAD decoded, not the `whsec_…`
   * string. Signing with the string is what a reimplementation from memory produces.
   */
  it("keys on the decoded secret, so a signature over the literal whsec_ string fails", () => {
    const literal = sign(BODY, TS, ID, Buffer.from(SECRET));
    expect(verifySvixSignature(BODY, headers(literal), SECRET, NOW_MS).ok).toBe(false);
  });

  /** Stripe's header is hex; accepting hex here would widen the door for no reason. */
  it("does not accept a hex-encoded signature", () => {
    const hex = `v1,${createHmac("sha256", KEY).update(`${ID}.${TS}.${BODY}`).digest("hex")}`;
    expect(verifySvixSignature(BODY, headers(hex), SECRET, NOW_MS).ok).toBe(false);
  });

  it("refuses when a header or the secret is missing", () => {
    expect(verifySvixSignature(BODY, headers(sign()), "", NOW_MS)).toEqual({ ok: false, reason: "no signing secret configured" });
    expect(verifySvixSignature(BODY, headers(sign(), TS, null), SECRET, NOW_MS)).toEqual({ ok: false, reason: "missing svix headers" });
    expect(verifySvixSignature(BODY, { id: ID, timestamp: TS, signature: null }, SECRET, NOW_MS)).toEqual({
      ok: false,
      reason: "missing svix headers",
    });
  });

  it("refuses a timestamp that is not a number, rather than treating it as 1970", () => {
    expect(verifySvixSignature(BODY, headers(sign(), "tuesday"), SECRET, NOW_MS)).toEqual({ ok: false, reason: "malformed timestamp" });
  });

  it("tolerates a secret given without the whsec_ label", () => {
    expect(verifySvixSignature(BODY, headers(sign()), KEY.toString("base64"), NOW_MS).ok).toBe(true);
  });

  it("refuses rubbish in the signature header instead of throwing", () => {
    for (const bad of ["", "garbage", "v1", "v2,abc", ",,,"]) {
      expect(verifySvixSignature(BODY, headers(bad), SECRET, NOW_MS).ok).toBe(false);
    }
  });
});

describe("reading the event", () => {
  const event = (data: unknown, type = "email.received") => parseReceivedEvent({ type, data });

  it("takes the id and the recipient", () => {
    const r = event({ email_id: "e1", to: ["abc123def456@cal.scriptumiq.com"] });
    expect(r).toEqual({ ok: true, event: { emailId: "e1", recipients: ["abc123def456@cal.scriptumiq.com"] } });
  });

  /**
   * received_for is the envelope recipient. It is the one that survives a mail rule redirecting the
   * message, where To: still names whoever the meeting was originally sent to.
   */
  it("collects the envelope recipient as well as the header one", () => {
    const r = event({ email_id: "e1", to: ["someone@else.com"], received_for: "abc123def456@cal.scriptumiq.com" });
    expect(r.ok && r.event.recipients).toEqual(["someone@else.com", "abc123def456@cal.scriptumiq.com"]);
  });

  /** A webhook subscribed to more than we need, or a console ping: accept and drop, never retry. */
  it("marks another event type ignorable rather than failed", () => {
    const r = parseReceivedEvent({ type: "email.sent", data: { email_id: "e1" } });
    expect(r).toEqual({ ok: false, reason: "ignoring email.sent", ignorable: true });
  });

  it("treats a malformed email.received as a real failure, not something to drop", () => {
    expect(event({ to: ["a@b.com"] })).toEqual({ ok: false, reason: "no email_id on the event", ignorable: false });
    expect(event({ email_id: "e1" })).toEqual({ ok: false, reason: "no recipient address on the event", ignorable: false });
    expect(event({ email_id: "e1", to: [] })).toEqual({ ok: false, reason: "no recipient address on the event", ignorable: false });
  });

  it("does not fall over on anything that is not an event", () => {
    expect(parseReceivedEvent(null).ok).toBe(false);
    expect(parseReceivedEvent("email.received").ok).toBe(false);
    expect(parseReceivedEvent({}).ok).toBe(false);
    expect(event(null)).toEqual({ ok: false, reason: "no email_id on the event", ignorable: false });
    expect(event({ email_id: "e1", to: [null, 7, "abc123def456@cal.scriptumiq.com"] }).ok).toBe(true);
  });
});
