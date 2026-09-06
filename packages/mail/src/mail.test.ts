import type { Meeting } from "@daymarkable/core";
import { describe, expect, it } from "vitest";
import { buildDeliveryMail, buildDeliveryVerificationMail } from "./deliveryMail.js";
import { buildMeetingMail, meetingSubject } from "./meetingMail.js";
import { MemoryProvider, ResendProvider } from "./provider.js";

const m: Meeting = {
  id: "abc",
  topic: "Roadmap sync",
  date: "2026-09-02",
  time: "10:00",
  attendees: ["Priya"],
  text: "Discussed Q4.\n\nBudget ok.",
  decisions: ["Ship in Oct"],
  actions: ["Send Priya the deck"],
  confidence: 0.8,
  source: { notebook: "Work", pageIndex: 3 },
};

describe("meeting mail", () => {
  it("uses the topic — date time subject contract", () => {
    expect(meetingSubject(m)).toBe("Roadmap sync — Wed 2 Sep 2026 10:00");
    expect(meetingSubject({ ...m, time: null })).toBe("Roadmap sync — Wed 2 Sep 2026");
  });
  it("builds html + text parts with an idempotency key per (user, meeting, date)", () => {
    const mail = buildMeetingMail("jim@example.com", "user-1", m);
    expect(mail.to).toBe("jim@example.com");
    expect(mail.idempotencyKey).toBe("meeting:user-1:abc:2026-09-02");
    expect(mail.text).toContain("Ship in Oct");
    expect(mail.html).toContain("Send Priya the deck");
    expect(mail.html).not.toContain("<script");
  });
  it("memory provider records, resend provider posts", async () => {
    const mem = new MemoryProvider();
    await mem.send(buildMeetingMail("a@b.c", "u", m));
    expect(mem.sent).toHaveLength(1);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = new ResendProvider("key", "dayMarkable <x@y.z>", fake);
    const res = await r.send(buildMeetingMail("a@b.c", "u", m));
    expect(res).toEqual({ status: "sent", providerId: "re_123", error: null });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe("meeting:u:abc:2026-09-02");
  });
});

describe("delivery mail", () => {
  const pdf = (n: number) => new Uint8Array([37, 80, 68, 70, n]);
  const docs = [
    { name: "Planner", pdf: pdf(1), pageCount: 6 },
    { name: "Action List", pdf: pdf(2), pageCount: 3 },
    { name: "Meeting Notes", pdf: pdf(3), pageCount: 9 },
  ];

  it("attaches every document, named by kind and date", () => {
    const m = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 12, meetings: 2 });
    expect(m.to).toBe("them@example.com");
    expect(m.attachments?.map((a) => a.filename)).toEqual([
      "Planner-2026-09-06.pdf",
      "Action-List-2026-09-06.pdf",
      "Meeting-Notes-2026-09-06.pdf",
    ]);
    expect(m.attachments?.[0]!.content).toEqual(pdf(1));
  });

  it("is keyed per user, date and address so a retry cannot double-send", () => {
    const a = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    const b = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    const other = buildDeliveryMail("other@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(other.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it("summarises the run in both html and plain text", () => {
    const m = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 1 });
    expect(m.text).toContain("1 open actions, 1 meetings");
    expect(m.html).toContain("6 pages");
    expect(m.subject).toBe("dayMarkable — 2026-09-06");
  });

  it("the confirmation mail carries the link and no attachments", () => {
    const m = buildDeliveryVerificationMail("them@example.com", "u1", "https://app.daymarkable.com/settings/verify-delivery?token=abc");
    expect(m.attachments).toBeUndefined();
    expect(m.html).toContain("verify-delivery?token=abc");
    expect(m.text).toContain("verify-delivery?token=abc");
    // Says plainly what happens if the recipient was not expecting it.
    expect(m.text.toLowerCase()).toContain("ignore");
  });
});
