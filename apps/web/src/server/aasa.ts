/**
 * iOS's half of "the sign-in link opens the app" (Universal Links): the apple-app-site-association
 * file, served at /.well-known/apple-app-site-association (next.config rewrites it here). It is the
 * iPhone twin of public/.well-known/assetlinks.json.
 *
 * It names the app by Apple Team ID + bundle id, and the Team ID is the Apple Developer account's,
 * not something this repo can know — so it comes from APPLE_TEAM_ID on the host. Unset, there is
 * nothing true to say, and the file is a 404 rather than a guess: iOS then simply opens the link in
 * Safari, which still signs the waiting app in. Only /auth/app is claimed, for the same reason as on
 * Android: a web sign-in must stay in the browser.
 */
export const IOS_BUNDLE_ID = "com.diothassystems.daymarkable";

export function appleAppSiteAssociation(teamId: string | undefined): object | null {
  const team = teamId?.trim();
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) return null;
  return {
    applinks: {
      details: [{ appIDs: [`${team}.${IOS_BUNDLE_ID}`], components: [{ "/": "/auth/app*", comment: "sign-in links asked for from the app" }] }],
    },
  };
}
