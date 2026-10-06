import { describe, expect, it } from "vitest";
import { appAvailable, appLinks, appMailDue } from "./app-links";
import { isPublicPath } from "./hosts";

const play = "https://play.google.com/store/apps/details?id=com.diothassystems.daymarkable";
const subscribed = { status: "trial", stripeSubscriptionId: "sub_1", appMailSentAt: null };

describe("the phone app's store links", () => {
  it("are read from the settings, https only, blank meaning not yet", () => {
    expect(appLinks({ ANDROID_APP_URL: ` ${play} `, IOS_APP_URL: "" })).toEqual({ android: play, ios: null });
    expect(appLinks({ ANDROID_APP_URL: "http://example.com", IOS_APP_URL: "not a url" })).toEqual({ android: null, ios: null });
    expect(appAvailable(appLinks({}))).toBe(false);
  });

  it("live on a public page", () => {
    expect(isPublicPath("/app")).toBe(true);
    expect(isPublicPath("/apple-app-site-association")).toBe(false);
  });
});

describe("who is told about the app", () => {
  const live = { android: play, ios: null };

  it("nobody, until a store carries it", () => {
    expect(appMailDue(subscribed, { android: null, ios: null })).toBe(false);
    expect(appMailDue(subscribed, live)).toBe(true);
  });

  it("only an account that went through checkout, and is in good standing", () => {
    // Every row starts as "trial": without a subscription it has not checked out.
    expect(appMailDue({ ...subscribed, stripeSubscriptionId: null }, live)).toBe(false);
    expect(appMailDue({ ...subscribed, status: "active" }, live)).toBe(true);
    expect(appMailDue({ ...subscribed, status: "past_due" }, live)).toBe(false);
    expect(appMailDue({ ...subscribed, status: "canceled" }, live)).toBe(false);
  });

  it("once", () => {
    expect(appMailDue({ ...subscribed, appMailSentAt: new Date() }, live)).toBe(false);
  });
});
