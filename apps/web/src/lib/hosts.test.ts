import { afterEach, describe, expect, it } from "vitest";
import { crossHostRedirect, isPublicPath, isServicePath, sessionCookieDomain } from "./hosts";

describe("session cookie scope", () => {
  const saved = { APP_URL: process.env.APP_URL, SERVICE_URL: process.env.SERVICE_URL };
  afterEach(() => {
    process.env.APP_URL = saved.APP_URL;
    process.env.SERVICE_URL = saved.SERVICE_URL;
  });

  it("is the common parent domain when the site and the service have their own hosts", () => {
    process.env.APP_URL = "https://daymarkable.com";
    process.env.SERVICE_URL = "https://app.daymarkable.com";
    expect(sessionCookieDomain()).toBe("daymarkable.com");
  });

  it("is host-only with a single host, or when the hosts share no registrable domain", () => {
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.SERVICE_URL;
    expect(sessionCookieDomain()).toBeUndefined();
    process.env.APP_URL = "http://www.localhost:3001";
    process.env.SERVICE_URL = "http://app.localhost:3001";
    expect(sessionCookieDomain()).toBeUndefined();
  });
});

const PUB = "https://daymarkable.com";
const SVC = "https://app.daymarkable.com";

describe("two-host routing", () => {
  it("classifies paths", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/pricing")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/today")).toBe(false);
    expect(isServicePath("/today")).toBe(true);
    expect(isServicePath("/settings/verify-delivery")).toBe(true);
    expect(isServicePath("/admin/users/abc")).toBe(true);
    expect(isServicePath("/api/documents/x")).toBe(true);
    expect(isServicePath("/api/trpc/auth.requestLink")).toBe(false);
    expect(isServicePath("/todayish")).toBe(false);
  });

  it("sends service paths on the public host to the service host, query intact", () => {
    expect(crossHostRedirect("daymarkable.com", "/today", "", PUB, SVC)).toBe("https://app.daymarkable.com/today");
    expect(crossHostRedirect("daymarkable.com", "/settings/verify-delivery", "?token=abc", PUB, SVC)).toBe("https://app.daymarkable.com/settings/verify-delivery?token=abc");
    expect(crossHostRedirect("daymarkable.com", "/account", "?delivery=confirmed", PUB, SVC)).toBe("https://app.daymarkable.com/account?delivery=confirmed");
  });

  it("sends public paths on the service host back to the public host", () => {
    expect(crossHostRedirect("app.daymarkable.com", "/pricing", "", PUB, SVC)).toBe("https://daymarkable.com/pricing");
    expect(crossHostRedirect("app.daymarkable.com", "/login", "?expired=1", PUB, SVC)).toBe("https://daymarkable.com/login?expired=1");
    expect(crossHostRedirect("app.daymarkable.com", "/", "", PUB, SVC)).toBe("https://app.daymarkable.com/today");
  });

  it("serves shared routes on either host", () => {
    expect(crossHostRedirect("daymarkable.com", "/auth/verify", "?token=t", PUB, SVC)).toBeNull();
    expect(crossHostRedirect("app.daymarkable.com", "/auth/logout", "", PUB, SVC)).toBeNull();
    expect(crossHostRedirect("app.daymarkable.com", "/api/trpc/documents.list", "", PUB, SVC)).toBeNull();
    expect(crossHostRedirect("daymarkable.com", "/pricing", "", PUB, SVC)).toBeNull();
    expect(crossHostRedirect("app.daymarkable.com", "/today", "", PUB, SVC)).toBeNull();
  });

  it("does nothing when both URLs share a host (local development)", () => {
    expect(crossHostRedirect("localhost:3000", "/today", "", "http://localhost:3000", "http://localhost:3000")).toBeNull();
    expect(crossHostRedirect("localhost:3000", "/", "", "http://localhost:3000", "http://localhost:3000")).toBeNull();
  });

  it("ignores unknown hosts (a stray IP or the container name)", () => {
    expect(crossHostRedirect("10.0.0.5:3000", "/today", "", PUB, SVC)).toBeNull();
  });
});
