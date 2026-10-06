/**
 * Billing never loads inside the app, on Android or iOS (src/webRouting.ts, rule 14): however a
 * page inside the app reaches it, it goes to the phone's browser.
 */
jest.mock("@/api", () => ({ API_URL: "https://app.scriptumiq.com", siteUrl: () => "https://scriptumiq.com" }));

import { billingUrl, destinationFor } from "@/webRouting";

describe("where a page inside the app goes", () => {
  it("sends every billing and pricing page to the browser, on either host", () => {
    for (const url of [
      "https://app.scriptumiq.com/billing",
      "https://app.scriptumiq.com/billing?plan=annual",
      "https://scriptumiq.com/billing/success",
      "https://scriptumiq.com/pricing",
      "https://app.scriptumiq.com/subscription",
      "https://daymarkable.com/billing",
    ]) {
      expect(destinationFor(url)).toBe("billing");
    }
    expect(billingUrl()).toBe("https://scriptumiq.com/billing");
  });

  it("keeps the rest of our own pages in the app", () => {
    for (const url of ["https://app.scriptumiq.com/account", "https://app.scriptumiq.com/setup", "https://scriptumiq.com/support", "about:blank"]) {
      expect(destinationFor(url)).toBe("frame");
    }
    // A path that merely starts with the same letters is not billing.
    expect(destinationFor("https://app.scriptumiq.com/billingual")).toBe("frame");
  });

  it("hands the wider web to the browser", () => {
    expect(destinationFor("https://checkout.stripe.com/c/pay/cs_test")).toBe("browser");
    expect(destinationFor("https://my.remarkable.com/device/browser/connect")).toBe("browser");
    expect(destinationFor("not a url")).toBe("browser");
  });
});
