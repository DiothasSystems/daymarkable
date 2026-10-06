# iOS handoff — building ScriptumIQ for iPhone on the Mac mini

For Claude Code running on the Mac mini, in a clone of this same git repository. Read this whole
file, then `CLAUDE.md` (the project's rules — they apply here unchanged), then
`docs/MOBILE_PLAN.md` (how the app is built). The Windows machine builds and tests Android; this
Mac is where the iPhone half is built, signed and verified, because iOS cannot be built anywhere
else.

## Paste this as the first message to Claude Code on the Mac

> You are picking up the iOS build of the ScriptumIQ mobile app. Read `docs/IOS_HANDOFF.md`, then
> `CLAUDE.md` and `docs/MOBILE_PLAN.md`. Pull `main`, check the toolchain (§2), and get the app
> running in the iOS Simulator with `scripts/ios-build.sh` (§3). Report what works and what fails
> against the checklist in §6 before changing any code. Do not commit to `main` without asking;
> work on a branch named `ios/<topic>`.

---

## 1. Where things stand (October 2026)

- **The app** is `apps/mobile`: React Native 0.86 / Expo SDK 57 / Expo Router, TypeScript. It talks
  to the production server `https://app.scriptumiq.com` over tRPC with a bearer session kept in the
  keychain (`expo-secure-store`). Setup, settings and support are the website's own pages in a
  WebView (`app/web/[pane].tsx`), signed in by a one-time handoff ticket; billing is never in the
  app and always opens in the phone's browser.
- **Android** is built on Windows with `scripts/android-build.ps1` and installed over USB. It is
  current with `main` and in daily use. Android's sign-in links already open the app (App Links,
  verified on the founder's phone on 2026-10-06).
- **iOS** has never been built. Everything in `app.json` / `app.config.ts` that iOS needs is in place
  (bundle id `com.diothassystems.daymarkable`, display name ScriptumIQ, build number, export
  compliance, icon without alpha), and the code has iOS branches (keyboard handling, date pickers),
  but none of it has run on an iPhone.
- **Tests**: `pnpm --filter @daymarkable/mobile test` (Jest, 20 tests, no device needed) and
  `pnpm --filter @daymarkable/mobile typecheck`. Both must pass before any commit, as `pnpm test` at
  the root must (it does not touch the phone).

Names that look like the old brand are deliberate and must NOT be renamed: the bundle id, the Expo
slug `daymarkable`, the `@daymarkable/*` package scope, the `daymarkable` URL scheme kept beside
`scriptumiq`. A different bundle id is a different app in the store. See CLAUDE.md, "The rename".

## 2. One-time setup on the Mac

1. **Xcode** from the App Store (the current release). Open it once, accept the licence, install the
   iOS platform it offers, then: `sudo xcode-select -s /Applications/Xcode.app`.
2. **Homebrew**, then `brew install node@22 cocoapods watchman`. Node must be 22 (the repo is built
   and tested on it). `corepack enable` makes the pinned pnpm available — do not install pnpm
   globally at another version.
3. **The repo**: `git clone https://github.com/DiothasSystems/daymarkable.git` (the repository kept
   its old name), or `git pull` an existing clone. Keep it OUT of any iCloud-synced folder: a synced
   `node_modules` is slow and corrupts.
4. **Apple account in Xcode**: Xcode → Settings → Accounts → add the founder's Apple ID. A free
   personal team is enough to run on the Simulator and on the founder's own iPhone for 7 days at a
   time. TestFlight, the App Store and Universal Links (§5) need the **paid Apple Developer Program**
   ($99/year), under the team that will own the app.
5. **The iPhone**: plug it in, trust the Mac, and turn on Settings → Privacy & Security → Developer
   Mode (it appears after Xcode first sees the phone).

No `.env` is needed for the app: the only setting it reads is `EXPO_PUBLIC_API_URL`, which the build
script sets. Never copy the server's `.env` to the Mac.

## 3. Build and run

```bash
scripts/ios-build.sh                 # iOS Simulator, Debug build, against production
scripts/ios-build.sh --device        # the plugged-in iPhone, Release build (runs without Metro)
```

The script checks the toolchain, runs `pnpm install --frozen-lockfile`, regenerates
`apps/mobile/ios/` with `expo prebuild --platform ios --clean`, and builds with `expo run:ios`.
`ios/` is generated and git-ignored — never edit it by hand and never commit it; anything iOS needs
goes in `app.json`, `app.config.ts` or an Expo config plugin, as Android's needs do.

**Signing on the first device build**: if `expo run:ios --device` stops on signing, open
`apps/mobile/ios/ScriptumIQ.xcworkspace` in Xcode, select the ScriptumIQ target → Signing &
Capabilities, tick "Automatically manage signing" and choose the team, then re-run the script. Note
the team's **Team ID** (10 characters, shown under Membership on developer.apple.com) — §5 needs it.

**Signing in on the Simulator**: sign in with the founder's address and password; the emailed link
can be opened in the Mac's mail — the Simulator, still waiting on its sign-in screen, then signs
itself in (that is how the app's sign-in works everywhere; see CLAUDE.md rule 18).

## 4. Rules that matter most on iOS

- **Rule 14 — no payments in the app.** The app never processes a payment or shows a price, and
  every billing page opens in the phone's browser, never in the in-app WebView (§7, item 1).
- **Rule 18 — a session is created in exactly one place**, `/auth/verify`, from an emailed link. The
  app's link screen (`app/auth/app.tsx`) spends the link by requesting `/auth/verify`; never add a
  second way to mint a session for iOS.
- **Rule 5 — no user content in logs.** The notes screens hold decrypted note text; do not add crash
  reporting, analytics or logging that could capture it without scrubbing.
- **Keyboard**: on iOS the app relies on `KeyboardAvoidingView` (`behavior="padding"`), which works
  there; the Android-only padding in `src/keyboard.tsx` is skipped on iOS by design. Verify it.

## 5. Universal Links — the sign-in link opening the app on iPhone

Android's half is done (App Links). The iOS half is built but switched off, because it needs the
paid account:

- **Server**: `/.well-known/apple-app-site-association` is served from `APPLE_TEAM_ID`
  (`apps/web/src/server/aasa.ts`, wired through `next.config.ts` and `docker-compose.yml`). It
  returns 404 until that variable is set, and then claims only `/auth/app*`, so a web sign-in still
  opens in Safari.
- **App**: `app.config.ts` adds the Associated Domains entitlement
  (`applinks:scriptumiq.com`, `applinks:app.scriptumiq.com`) only when `IOS_UNIVERSAL_LINKS=1`,
  because a free team cannot sign an app that asks for it.

To switch it on, once the paid account exists:

1. The founder adds `APPLE_TEAM_ID=<TEAMID>` to `/root/daymarkable/.env` on the VPS and runs
   `cd /root/daymarkable && docker compose up -d app`. Check
   `https://scriptumiq.com/.well-known/apple-app-site-association` returns JSON naming
   `<TEAMID>.com.diothassystems.daymarkable`.
2. In the Apple Developer portal, the App ID `com.diothassystems.daymarkable` needs the Associated
   Domains capability (Xcode's automatic signing usually adds it).
3. Build with `IOS_UNIVERSAL_LINKS=1 scripts/ios-build.sh --device`.
4. Test: sign out in the app, sign in, tap the emailed link in the iPhone's Mail app — it should open
   ScriptumIQ and finish signing in. Apple caches the association file through its CDN; a fresh
   install after step 1 picks it up, sometimes after a few minutes.

Until then the link opens in Safari and the waiting app signs in anyway — nothing is broken.

## 6. Checklist for the first iPhone run

Report each as works / fails / not tested:

1. App launches; splash shows the lockup on Parchment, then the sign-in screen with the animated hero.
   "What is ScriptumIQ?" opens the tour: 14 animated storyboard scenes (one per swipe, the web's
   "See how it works" ported in `src/storyboard/`), then "What it never does". Only the scene on
   screen should move; check it stays smooth, and that Settings → Accessibility → Reduce Motion
   draws every scene still.
2. Sign in (password, then the emailed link); the app reaches Actions. Kill and relaunch: still signed in.
3. **Forgot password?** leads to the reset screen; the eye button shows and hides the password; the
   keyboard never covers the field being typed in.
4. Actions: groups (Overdue / Today / Next 3 days / Later / No date yet), each row's notebook and
   page; tick an item; open a row's date button and set Low / Medium / High and type a due date
   ("fri", "10/14"); Inbox Fix / Approve / Remove.
5. Notes tab: daily notes by day, newest first; Delete this day; meeting notes below.
6. Calendar tab and the item editor (date and time pickers display inline on iOS).
7. More tab: settings, support and setup WebViews load signed in; links to Stripe or reMarkable open
   in Safari, not in the frame; Subscription opens scriptumiq.com/billing in Safari and never in the app.
8. Sync now and "Send updated notebooks" work and respect the server's limits.
9. Dark mode does not wreck contrast (the app is `userInterfaceStyle: light`; confirm it stays light).
10. Rotation: the app is portrait-only.

Fix what fails on a branch, keep Android working (`apps/mobile` is shared — test both if the change
is not iOS-only), and add a Jest test where the behaviour is testable without a device.

## 7. Before TestFlight / the App Store — open questions for the founder

These are decisions, not code. Raise them; do not resolve them alone.

1. **Billing — decided: always the browser.** The founder's decision (October 2026): customers
   subscribe on the website before they install the app, and nothing about billing ever shows inside
   the app, on iOS or Android. The Subscription button, the tour, and any in-app web page that links
   or redirects to `/billing`, `/subscription` or `/pricing` open the phone's browser instead
   (`apps/mobile/src/webRouting.ts`, tested). If App Review objects even to the link out (outside the
   United States it can count as steering), the fallback is a plain "Manage your subscription at
   scriptumiq.com" with no link — ask the founder before changing it.
2. **Account deletion (guideline 5.1.1(v)).** Apple requires an app that lets people create an
   account to let them delete it in the app. Accounts are created on the website by invitation, but
   review may still ask; check that Settings in the app reaches account deletion.
3. **Review access.** Registration is closed (CLAUDE.md rule 15), so App Review needs a demo account
   with sample data and the sign-in link flow explained in the review notes.
4. **Privacy.** App Store privacy labels and the privacy manifest (Expo SDK 57 generates
   `PrivacyInfo.xcprivacy` for its own modules; add any required-reason API the app itself uses).
   The privacy policy URL is `https://scriptumiq.com/privacy`.
5. **Distribution signing.** A store build is signed by the team's distribution certificate (Xcode
   or EAS manages it). Unlike Android, nothing in the repo needs the certificate's fingerprint.
6. **EAS or Xcode.** Archiving in Xcode (Product → Archive → Distribute) is enough for TestFlight.
   EAS Build is configured in `apps/mobile/eas.json` but the EAS project is not linked yet
   (`eas init` would add a `projectId` to app.json) — only if the founder wants cloud builds.

7. **Telling subscribers the app is out.** Customers hear about the app by email after they
   subscribe — but only once it is in a store. The VPS `.env` has `IOS_APP_URL` and
   `ANDROID_APP_URL`; while both are empty nobody is told. When the App Store listing is live, the
   founder sets `IOS_APP_URL=https://apps.apple.com/app/id<APP_ID>` and restarts
   (`docker compose up -d app`): every subscriber not yet told is mailed once within 15 minutes, and
   scriptumiq.com/app shows the button (`apps/web/src/server/app-mail.ts`, `src/lib/app-links.ts`).
   Set it only for the public listing, never a TestFlight link: everyone who has paid gets the mail.

## 8. Working with the Windows machine

- Same repo, same `main`. Both machines pull before starting and push small commits. Do not
  reformat files you did not change: most files are CRLF on disk on Windows (git normalises them),
  so let git's settings decide line endings and never mass-convert.
- `scripts/android-build.ps1` and the Windows path workarounds in it are Windows-only; leave them be.
  `scripts/ios-build.sh` is the Mac's.
- The server (web app, database, nightly runs) is deployed from the VPS, not from either machine:
  the founder runs `cd /root/daymarkable && bash scripts/vps-upgrade.sh` after a push that changes
  the server. App-only changes need no deploy.
- Commit messages end with the project's usual co-author line; commit only when the founder asks.
