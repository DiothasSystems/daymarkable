import type { Meeting } from "@daymarkable/core";
import { describe, expect, it } from "vitest";
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
