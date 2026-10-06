/**
 * app.json, plus the one iOS setting that cannot be on by default.
 *
 * Universal Links — the iPhone opening its own sign-in links (/auth/app), as Android already does —
 * need the Associated Domains capability, and only a PAID Apple Developer account can sign an app
 * that asks for it: with a free personal team the build fails at signing. So it is switched on by
 * IOS_UNIVERSAL_LINKS=1 once the account is enrolled and APPLE_TEAM_ID is set on the server (which
 * is what makes /.well-known/apple-app-site-association answer). Until then the link opens in Safari
 * and the waiting app still signs in. See docs/IOS_HANDOFF.md.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.IOS_UNIVERSAL_LINKS !== "1") return base;
  return {
    ...base,
    ios: { ...base.ios, associatedDomains: ["applinks:scriptumiq.com", "applinks:app.scriptumiq.com"] },
  };
};
