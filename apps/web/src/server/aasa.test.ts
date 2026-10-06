import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation } from "./aasa.js";

describe("apple-app-site-association", () => {
  it("says nothing until the Apple Team ID is set, rather than guess one", () => {
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("")).toBeNull();
    expect(appleAppSiteAssociation("not-a-team")).toBeNull();
  });

  it("claims only the app's own sign-in links, for this bundle", () => {
    expect(appleAppSiteAssociation("ABCDE12345")).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.diothassystems.daymarkable"], components: [{ "/": "/auth/app*", comment: "sign-in links asked for from the app" }] }] },
    });
  });
});
