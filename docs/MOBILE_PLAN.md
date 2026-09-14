# dayMarkable — Mobile application plan (Phase 1)

Source: *Claude Code Input: DayMarkable Mobile App*, v1.0, 2026-09-13, 15 requirements, plus the
scope call of 2026-09-13: **the app edits action lists, calendar and notes; after an edit the user
is prompted to update the documents on the tablet; the main requirement is ticking off actions and
seeing the calendar.**

Status: all eight steps of §12 are built. What remains is not code: Apple Developer and Google
Play enrolment, an EAS build, and SW-001's iOS half, which cannot be verified from Windows.

Four decisions were taken before this was written, and everything below follows from them:

1. **The spine is the action list and the calendar.** The app opens on the action list with the
   checkboxes; the calendar is one tap away. Everything else is built after those two are right.
2. **Hybrid shell.** Native Expo screens for the product — sign-in, actions, calendar, notes,
   editing, Sync now. WebViews for what the web already owns and would only rot in two places —
   first-time setup, settings, payment.
3. **Camera intake (SW-012, SW-013) is deferred.** It is not a client feature; it is a second way
   into the pipeline. §10 says what it would cost so the deferral stays a decision.
4. **Plan before code.** This document is the thing to argue with.

---

## 1. What is asked for against what already exists

`apps/web/src/server/router.ts` was written for this moment — its header says the mobile app consumes
it unchanged. That is true of viewing and ticking. It is **not** true of editing, which is the one
substantial piece of server work this scope adds (§5).

| Req | Asks for | Server today | Left to build |
| --- | --- | --- | --- |
| SW-006 | tick an action complete | `documents.decide` | optimistic toggle |
| — | see the calendar | `documents.registry` (events, recurrence expanded) | a calendar screen |
| SW-003 | actions/calendar interactive on a phone | `documents.registry` | native screens (§4) |
| SW-001 | iOS + Android native | — | the app |
| SW-002 | log into an existing account | `auth.requestLink`, `auth.me` | header-carried session (§3) |
| SW-004 | edit text from the nightly sync | `corrections.fix` — **text only, and it teaches the decoder** | field-level editing, separated from correcting (§5) |
| — | edit the calendar | nothing edits a date, time, location or recurrence | `items.update` (§5) |
| — | edit notes | nothing edits a meeting body; it is encrypted | unseal / patch / reseal (§5) |
| — | prompt to update the tablet after an edit | `pendingDelivery` + `documents.republish` — **already exactly this** | mirror the web's prompt (§6) |
| SW-005 | Sync now from the phone | `runs.syncNow({ via: "mobile" })` — quota already counts both clients (rule 11) | a button and the 429 copy |
| SW-007 | feedback and support in-app | `requests.submit`, `feedback.rate` | a form; support prose in a WebView |
| SW-008 | payment on a mobile web page | `/billing` on the public host | a link out (§9) |
| SW-009 | log in *and* first-time setup in-app | `/setup` + `account.*`, `calibration.*` | WebView (§7) |
| SW-010 | read notes | `documents.registry`, `/api/documents/:id` | reader screens |
| SW-011 | settings on a mobile web page | `/settings` | WebView |
| SW-012/013 | camera capture and analysis | nothing | deferred (§10) |
| UX-001 | same visual language as web | `design/design_handoff_daymarkable/` | a token module for RN (§8) |
| UX-002 | responsive HTML at 320–480px | the web app is already responsive | viewport tests (§11) |

---

## 2. Shape

One Expo app, in the monorepo as `apps/mobile`, typed by the server's own `AppRouter`.

**How that type arrives** (settled in step 3, and not the obvious way). Importing
`apps/web/src/server/router.ts` directly drags the whole server graph — `next/headers`, drizzle,
the web's own `@/lib` alias — through React Native's compiler options, and it fails: colliding
path aliases, and DOM's `setTimeout` disagreeing with `NodeJS.Timeout` in `packages/tablet`. So
`apps/web` emits declarations (`pnpm --filter @daymarkable/web types` → `types-dist/`) and the app
maps `@daymarkable/api` to `types-dist/server/router.d.ts`. A `.d.ts` is inert: `skipLibCheck`
means anything the app cannot resolve degrades to `any` instead of breaking its build, and the
import is type-only, so Metro never sees it. The mobile typecheck runs that emit first.

```
apps/mobile/
  app/                       expo-router
    (auth)/sign-in.tsx       email → "check your mail" → poll → session
    (tabs)/actions.tsx       THE screen: the action list, checkboxes, inbox — SW-006
    (tabs)/calendar.tsx      month / week / day, events and meetings
    (tabs)/notes.tsx         meeting notes list, reader, editor — SW-010, SW-004
    (tabs)/more.tsx          documents, settings, payment, support, feedback
    item/[id].tsx            edit an action or event: text and fields — §5
    web/[route].tsx          the WebView host (setup, settings, billing, support)
  src/
    api.ts                   tRPC client, Bearer header, 401 → sign-out
    session.ts               expo-secure-store
    theme.ts                 brand tokens (§8)
    components/
      TabletBanner.tsx       "Send updated notebooks to your tablet" — §6
      Checkbox.tsx           44pt, optimistic
```

**Native, because this is the product:** sign-in, actions, calendar, notes, every editor, Sync now,
the feedback form.

**WebView, because the web already owns it and two copies would diverge:** `/setup`, `/settings`,
`/billing`, `/support`. These are forms and prose, they are already responsive, and — the part that
matters — they inherit `requireUser`'s guard chain for free (§7).

A note on SW-003's wording. It asks for "HTML pages … fully interactive when rendered on a mobile
device", and its acceptance criterion is that the user can tap, scroll and interact without layout
or touch errors. Native screens satisfy that criterion strictly better than a WebView would, and
UX-002 keeps the responsive HTML honest in its own right, tested at 320–480px. Given that ticking a
box must update immediately (SW-006) and that these screens are now editors, native is the only
sane reading.

---

## 3. Auth: two server changes

`getSessionUser()` reads the `dm_session` cookie through `next/headers`. `verifyMagicLink()` sets
that cookie and the verify route redirects a browser. Neither works for a native client. Two small,
additive changes fix it — and nothing about the web's behaviour changes.

**(a) Accept the session in a header.** Sessions are already an opaque random id in a `sessions`
row; a mobile session is the same row carried in `Authorization: Bearer <id>` instead of a cookie.

```ts
// server/auth.ts
export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  const bearer = req?.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const id = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
  ...
}
```

`api/trpc/[trpc]/route.ts` and `api/documents/[id]/route.ts` pass `req`; everything else keeps
calling it with no argument. Bearer is accepted only on those two routes — never on a page render,
where a cookie is the only credential and CSRF assumptions still hold.

**(b) Get a session onto the phone without deep links.** The magic link is very often opened on a
different device from the one signing in — laptop mail, phone app. A `daymarkable://` deep link
fails exactly there. Poll-and-claim does not:

1. App calls `auth.requestLink({ email, client: "mobile" })`. Server mints the login token as today
   **and** a `device_logins` row holding `pollSecretHash`, the token hash, and a 15-minute expiry.
   The plaintext `pollSecret` is returned to the app and to nobody else.
2. The user taps the link wherever their mail is. `/auth/verify` runs unchanged — verifies, creates
   the session, sets the cookie — and additionally writes `sessionId` onto the `device_logins` row
   for that token.
3. The app polls `auth.claim({ pollSecret })` every 2s. Until step 2 it returns `{ pending: true }`.
   Once `sessionId` is set it returns the session id, stamps `claimedAt`, and never returns it again.
4. The app puts it in `expo-secure-store` and sends it as Bearer from then on.

The link itself is unchanged and carries no new authority. The `pollSecret` never leaves the device
that asked for it, is single-use, and expires with the token. Rate-limit `claim` per secret;
`loginLocked` in `server/admin-core.ts` is the shape to copy. New migration: one table,
`device_logins`. `sessions` gains a nullable `client` column so a phone session can be revoked
separately later.

`auth.requestLink` stays deliberately incurious — same reply for an address that may sign in and one
that may not (rule 15) — so the app must show "check your mail" regardless, and time out quietly.

---

## 4. Screens

| Screen | Kind | Source | Reqs |
| --- | --- | --- | --- |
| Actions | native | `documents.registry` → `actions`, `inbox`, `doneRecently` | SW-003, SW-006 |
| Calendar | native | `documents.registry` → `events` (recurrence already expanded), `meetings` | SW-003 |
| Item editor | native | `items.update`, `corrections.fix` | SW-004 |
| Notes | native, read + edit | `registry.meetings`, `items.update` | SW-004, SW-010 |
| Documents | native list, system viewer for the PDF | `documents.list`, `/api/documents/:id` | SW-010 |
| Sign in | native | `auth.requestLink` → `auth.claim` | SW-002 |
| Sync now | native, in the header | `runs.syncNow`, `runs.quota` | SW-005 |
| Feedback | native form | `requests.submit`, `feedback.rate` | SW-007 |
| Setup wizard | WebView `/setup` | six steps, incl. tablet pairing | SW-009 |
| Support | WebView `/support` | one page, already frame-agnostic by design | SW-007 |
| Settings | WebView `/settings` | | SW-011 |
| Payment | WebView `/billing` on the public host | | SW-008 |

**Actions** mirrors `documents.registry`'s own grouping — open actions ordered by date then priority
(rule 8), then Inbox ("confirm these", rule 3), then what was finished in the last seven days — and
reuses `dueTag()`'s copy (TODAY / TOMORROW / THIS WEEK / OVERDUE) by porting the pure function, not
by re-inventing the labels.

**Calendar** reads the same registry call. `getRegistry` already resolves a repeating series to its
next occurrence, so the phone does no date arithmetic of its own beyond laying out the grid.

**A document can be gone.** `/api/documents/:id` returns 404 with *"This document has left the
1-day cache. Run Sync now or wait for tonight's run."* That is not an error state to paper over; it
is the privacy promise (rule 5) being kept, and the app should say so in those words.

---

## 5. Editing — the server work this scope adds

Today there are exactly two write paths into a decoded item: `documents.decide`
(complete / drop) and `corrections.fix` (replace the **text**, nothing else). "Edit action lists and
calendar and notes" needs four things beyond that.

### (a) Fields, not just text

A calendar edit that cannot move a date is not a calendar edit. The schema already carries
everything needed — nothing has to be invented, only exposed:

- `tasks` — `text`, `due`, `dueTime`, `priority`, `kind`, `project`, `people`
- `events` — `title`, `date`, `startTime`, `endTime`, `location`, `recurrence`
- `meetings` — `topic`, `date`, `time`, and the sealed body

```
items.update({ itemType, itemId, patch })   // patch is a zod union, typed per item type
items.create({ itemType, ... })             // an action or event born on the phone
```

Both go through `packages/core` for ordering and merge, not around it (rule 1: code organizes).

### (b) Notes are encrypted, and nothing edits them today

`meetings.bodyEnc` is sealed JSON `{ text, decisions, actions }` (`packages/db/src/crypto.ts`).
`corrections.fix` only ever touches `topic`. Editing a note means unseal → patch → reseal with the
same sealer, and the plaintext must never reach a log line or an error message (rule 5).

### (c) An item born on the phone has no run and no page

`createdRunId` is nullable and `confidence` is 1 for anything a human typed. `events.source` is an
enum of `["ink", "external"]` and needs a third value, `"app"` — one migration. This is worth doing
properly rather than defaulting to `"ink"`: a phone-born event must not claim it came off a page, or
the compare reports and the admin views quietly start counting typing as decoding.

### (d) Fixing a misread and changing your mind are different acts — and today they are one call

This is the part to get right. `corrections.fix` records a correction row **and promotes every
changed word into the user's lexicon**:

```ts
const learned = learnedTerms(original, text);
await repo.recordCorrection(...);
const added = await repo.addLexiconTerms(rt.db, userId, learned);
```

That is exactly right for *"it read Kolb, I wrote Cobb"* — that is the mechanism CLAUDE.md calls the
single largest lever on per-user accuracy. It is exactly wrong for *"move the dentist to Friday"*,
which would teach the decoder vocabulary that was never misread and never on a page. An app whose
whole purpose is editing would feed that lever noise all day.

So the two acts get two calls and two affordances:

| Act | Call | Effect |
| --- | --- | --- |
| "That is not what I wrote" | `corrections.fix` | correction row, lexicon promotion, confidence → 1, Inbox item promoted out of "confirm these" |
| "That is not what I want any more" | `items.update` | the field changes; no correction row, no lexicon |

In the UI: ordinary editing is ordinary editing, and *Fix what dayMarkable read* is a distinct,
deliberate action on the decoded text — the same distinction the web's `EditableItem` tooltip
already gestures at ("Click to fix what dayMarkable read"), made explicit now that editing is the
point of the client rather than a repair tool.

### (e) An editor opens the row, never a view of it

`getRegistry` resolves a repeating series to its *next* occurrence and `getCalendar` to the day
of the grid cell — both right for showing, both wrong for editing. An editor that loaded one of
those and saved it back would write an occurrence's date over the series anchor, quietly
rescheduling every future occurrence of a monthly meeting because someone fixed a typo in its
title. `items.get` returns the stored row, and a test in `edits.test.ts` holds it there.

### (f) What does not change

- **Rule 8 holds.** New items merge into the one canonical list; items still leave only by tick or
  explicit drop. Deleting from the phone is `decide → drop`, never a hard delete.
- **The closed loop holds.** A phone-born action printed on tonight's planner gets its
  `printed_items` row like any other, so ticking it on paper next night resolves the same way.
- **The web gets all of this free**, since it is server-side. Assumption stated plainly: the web
  should adopt the same editors rather than stay the weaker client. Say so if not.
- **`dueTag` is duplicated in the app**, not imported. Its home would be `packages/core`, but
  core reaches for `node:crypto` (`stableId`), which Metro cannot bundle — sharing it means
  splitting core, which is a bigger change than ten lines of copy rules deserve today.
  `apps/mobile/src/format.test.ts` pins the two together branch for branch. Revisit if a second
  helper follows it across.
- **Inbox items are not editable this way** — deliberately. An Inbox item sits there because the
  decoder was unsure (rule 3), so the act that resolves it is accepting, dropping, or correcting
  it, not amending it in place. `corrections.fix` already promotes one out of "confirm these"
  when the user says what it says. Add `items.update` for Inbox only if that turns out to be
  wrong in use.

---

## 6. The prompt to update the tablet

This already exists on the web and is precisely what was asked for; the phone mirrors it.

Every edit calls `rebuildAfterEdit`, which recomposes the notebooks with `deliver: false` and stamps
`settings.pendingDelivery`. `documents.list` returns that stamp. The app shows a persistent bar —

> **Your notebooks have changed.** Send them to your tablet.

— which calls `documents.republish`, uploads, clears the stamp, and reports in the web's own words:
*"Sent … to the tablet — N open actions, M meetings. Sync the reMarkable to see them."*

Three properties worth stating because they are what make the prompt safe to show often:

- **It costs nothing.** Composing calls no model. Republish does not touch the 3-per-24h on-demand
  quota, which governs decode runs (rule 11), so a user may send as often as they like.
- **It is never automatic.** Sending is theirs to ask for — the same principle as rule 7's drafts.
  Five edits produce one prompt and one send, not five uploads.
- **The tablet still has to sync.** The pages appear when the reMarkable next talks to the cloud,
  and the app must say that rather than implying the page is already there.

---

## 7. First-time setup on the phone (SW-009)

`/setup` is a six-step wizard — pair the tablet, pick watch folders, timezone, ink conventions,
calibration, done — and it is a WebView for three reasons. It is pure form. Rebuilding it natively
doubles the maintenance of the one flow most likely to change. And the pairing step sends the user
to my.remarkable.com for an eight-character one-time code, which is a browser errand anyway.

The part worth noticing: `requireUser` already sequences sign-in → billing → onboarding. Load
`/setup` in a WebView and an unpaid account is redirected to `/billing` by the server, with the app
none the wiser. SW-008 and SW-009 are satisfied by the same WebView and the app never learns what
anything costs — which is exactly what rule 14 wants.

**Getting the WebView signed in** (built in step 7). The app has a bearer; these pages read a
cookie. Three things that do not work: the session id as a query parameter (a credential in a URL
is a credential in a log and a Referer header); a `Cookie:` header on the WebView source (it
survives the first request and not the first in-page navigation, so `/settings` loads and the form
it posts to does not); and signing in again inside the frame (the user doing the same thing twice).
So `auth.webHandoff` mints a one-time ticket — 60 seconds, single redemption, hash at rest — and
`/auth/handoff` redeems it into the same session as a cookie. The ticket is a pointer at authority,
never authority itself: sign out on the phone and any outstanding ticket is worthless, which
`handoff.test.ts` asserts. Navigation inside the frame is held to the two dayMarkable hosts;
anything else — Stripe, my.remarkable.com during pairing — opens in the phone's own browser rather
than in something that looks like the app and is not.

Calibration needs the user to write on the tablet, so the phone's role is to trigger
`calibration.create`, then `calibration.calibrate` once the page is written. That works unchanged in
the WebView.

---

## 8. Looking like the web (UX-001)

`src/theme.ts` transcribes the brand tokens from `design/design_handoff_daymarkable/` — Midnight
`#1E2A44`, Compass Gold `#C9973F`, Parchment `#F7F0E3`, Notepaper `#FDFAF3`, Border `#E3D9C2`, Body
muted `#4A5266`, Meta `#8A7D5F` — with Source Serif 4, Public Sans and IBM Plex Mono loaded via
`expo-font` from the same vendored files the composer uses. Cards are Notepaper on a 1px `#E3D9C2`
border at 6px radius; the header carries `SYNCED HH:MM` in mono, from `lastSyncLabel()`.

Two deliberate departures from the web, both toward the platform: touch targets are 44pt minimum
(the tablet templates' ≥28px rule is a pen rule, not a thumb rule), and the WebView panes get no app
chrome of their own so the web's own header does not appear twice.

---

## 9. What the app must not do

- **No price, anywhere** (rule 14). Payment is a link to `/billing` on the public host. Note for
  submission: external purchase links are permitted but scrutinised, and the rules differ by store
  and region — worth confirming before the first build goes up, not after review.
- **No regeneration from a view** (rule 12). Viewing reads the cache and the registry. Editing may
  recompose — that is an edit, not a view — and only a republish uploads.
- **No addresses read off a page, no invite that sends itself** (rules 7 and 10). Meeting requests
  display as drafts and the app offers no send.
- **No note content in logs** (rule 5) — which now includes crash reporting and any editor
  autosave telemetry, since the app holds decrypted note bodies in memory.

---

## 10. Deferred: camera intake (SW-012, SW-013)

Every input today arrives through `TabletProvider`. A photographed page is a second doorway, and it
needs its own design pass covering, at minimum:

- an upload procedure and where the bytes live (the 1-day cache, under rule 5's retention, with the
  same deletion log as everything else);
- a decode path for a photograph rather than a `.rm` — `services/render` is not in this loop, the
  image goes straight to `packages/decode`, but perspective, shadow and resolution are nothing like
  a clean 1568px render, and the confidence thresholds that route to Inbox (rule 3) were tuned on
  rendered pages;
- cost and quota: a photo is a decode that no page-hash diff (rule 2) can skip;
- how a photographed page merges into a day that also has tablet pages — same run, or its own?
- and the CLAUDE.md amendment that says dayMarkable reads a tablet.

None of that is hard. All of it is product design, and it does not belong inside a client port.

---

## 11. Tests

Every requirement maps to at least one test, per the PRD's guideline 2. The rows in bold are the
ones that protect something subtle.

| Req | Test | Where |
| --- | --- | --- |
| SW-006 | tap toggles optimistically, reverts on failure, sends `decide` once | mobile |
| SW-006 | a ticked action leaves the open list and appears in the last-7-days group | existing core tests |
| — (calendar) | registry fixture renders in month/week/day; a weekly series shows at its next occurrence | mobile |
| **SW-004** | **`items.update` writes no correction row and adds no lexicon term** | `services` test |
| **SW-004** | **`corrections.fix` still promotes changed words** (guard against the two calls merging) | existing + extended |
| SW-004 | `items.update` moves an event's date/time/location; recurrence round-trips | `services` test |
| SW-004 | a note body edit reseals, and the decrypted text never appears in a log | `services` + crypto test |
| SW-004 | `items.create` yields `source: "app"`, `confidence: 1`, null `createdRunId` | `services` test |
| **§6** | **an edit sets `pendingDelivery`; `republish` uploads and clears it; five edits, one flag** | `services` test |
| §6 | the app shows the banner iff `pendingDelivery` is set | mobile |
| SW-002 | `requestLink` → `verify` → `claim` returns a session once and only once; an unclaimed secret expires | `auth.test.ts` |
| SW-002 | Bearer id authenticates; a bad, expired or revoked id does not | `auth.test.ts` |
| SW-003 | every registry group renders at 320px with no clipped rows | mobile |
| SW-005 | Sync now calls `syncNow({ via: "mobile" })`; the 4th in 24h surfaces the 429's next-available time | mobile + existing quota test |
| SW-007 | feedback form submits via `requests.submit` and confirms | mobile |
| SW-008 | the payment entry opens `/billing` on the public host, and no price string exists in the bundle | mobile + a grep assertion |
| SW-009 | an unonboarded session lands on `/setup`; an unpaid one on `/billing` | existing `guard` behaviour, asserted |
| SW-010 | notes reader shows the full body; a purged document shows the cache copy, not an error | mobile |
| SW-011 | settings entry opens `/settings` on the service host | mobile |
| UX-001 | the theme module's tokens equal the handoff values | mobile unit test |
| UX-002 | `/today`, `/documents`, `/settings`, `/setup`, `/billing` at 320, 375, 480 — no horizontal overflow | Playwright in `apps/web` |
| SW-001 | installs and launches on the two current majors | manual, per build |

`pnpm test` must stay green with no network and no keys; the mobile tests mock the tRPC client.

**Two runners.** Vitest runs everything that is plain TypeScript, including the app's pure modules
(`theme.test.ts`, `format.test.ts`). React Native screens need the RN preset's transforms, so they
run under `jest-expo` from `apps/mobile/jest.config.js` — `pnpm test` calls both, and `pnpm
test:mobile` calls just the second. Two things to know when writing a screen test: RNTL v14's
`render` is asynchronous and must be awaited, and the screens need the two providers
`app/_layout.tsx` mounts (`SafeAreaProvider` with fixed metrics, and `SessionProvider`).

**The live pass.** On 2026-09-14 the whole mobile API was driven over real HTTP against a running
server for the first time — sign-in through to sign-out, 22 groups of assertions. It found two
bugs that every unit test and typecheck had passed over; both are fixed and both now have tests.
The web's `pnpm db:dev` aborts on the installed PGlite data directory, so the run used a fresh
one; see §14.

**Verification limits on this machine.** This is Windows with no iOS toolchain: Android and Expo Go
I can drive, iOS I cannot. SW-001's iOS half needs a Mac or an EAS build, and I will report it as
untested rather than assumed.

---

## 12. Sequence

1. ~~**Server: auth**~~ — **done** (2026-09-13). Bearer, `device_logins`, `auth.claim`, migration
   `0010`, 11 tests. (§3)
2. ~~**Server: editing**~~ — **done** (2026-09-14). `items.update`, `items.create`, the note-body
   reseal, the `"app"` event source (migration `0011`), the separation from `corrections.fix`, 15
   tests. Available to the web on the same terms whenever it wants them. (§5)
3. ~~**Scaffold**~~ — **done** (2026-09-14). `apps/mobile` on Expo SDK 57, expo-router, the tRPC
   client over a bearer header, expo-secure-store, the brand theme and its test. Sign-in screen
   implements poll-and-claim; `index.tsx` reads `auth.me` with the bearer and signs out through
   the server. Verified by a real Metro bundle, not just a typecheck.
4. ~~**Actions and calendar**~~ — **done** (2026-09-14). The action list with 44pt checkboxes,
   the Inbox, done-this-week, and a month grid over `documents.calendar` (new procedure: a span
   of dates with recurrences expanded in `packages/core`, rule 1). The tablet banner came with
   it rather than waiting for step 5 — ticking is what makes the tablet stale, so the prompt
   belongs beside the tick. Month/week/day became month-plus-day: a week view over the same data
   adds a third layout without adding an answer the month and day do not already give.
5. ~~**Editing**~~ — **done** (2026-09-14). Editors for actions, calendar entries and note
   bodies, a new-item screen for both kinds, remove-by-drop, and `items.get` (new procedure: the
   stored row, never a view's projection of it — see below). The banner shipped in step 4. The
   two acts are two controls: Save is `items.update`, "Fix what dayMarkable read" is
   `corrections.fix`, and the screen says which is which in words.
6. ~~**Notes, documents, Sync now, feedback**~~ — **done** (2026-09-14). A Notes tab that reads
   and edits meeting notes, and a More tab holding Sync now with its quota, the night's three
   PDFs, the 1–5 rating, and the request form. Sync now went to More rather than the header (§4's
   table): it happens three times a day at most and belongs beside the documents it produces,
   and a second entry point would mean two copies of its run-polling state.
7. ~~**WebView panes**~~ — **done** (2026-09-14). Setup, settings, billing and support, each the
   web's own page in a WebView. The piece that was not obvious: the app carries a bearer and
   those pages read a cookie, so `auth.webHandoff` mints a one-time ticket (60s, single use,
   `web_handoffs`, migration `0012`) that `/auth/handoff` redeems into the same session as a
   cookie. The pane is a NAME, not a path — the URL mapping lives on the server, so the redirect
   is not something a caller can choose. An unonboarded account is routed straight into the setup
   pane on launch, which is what SW-009 asks for.
8. ~~**Polish, tests, the UX-002 viewport pass**~~ — **done** (2026-09-14) except the store
   builds, which need accounts rather than code. `@testing-library/react-native` + `jest-expo`
   are in (a second runner: vitest cannot render an RN tree, so `pnpm test` runs both), the
   viewport pass is done against a live server at 320/375/480, and the whole mobile API was
   driven over real HTTP for the first time — which found two bugs. See below.

Steps 1–2 are server work with no mobile risk; step 4 is the requirement that matters; the rest is
assembly.

---

## 13. Documents this contradicts

The scope call supersedes written decisions, and those documents should be edited rather than left
to disagree quietly:

- `docs/BUILD_PLAN.md:64` — "Deliberately NOT a note-taking or editing surface — viewer + trigger
  only." The app is now an editing surface for all three notebooks. This is the big one.
- `docs/ARCHITECTURE.md:235` — the mobile paragraph, same sentence, plus "native RN over tRPC"
  where we are now hybrid.
- `CLAUDE.md` — `apps/mobile` is described as "React Native/Expo viewer + Sync now"; it is now
  viewer, editor and trigger.
- `docs/BUILD_PLAN.md:62` — push notification on run completion is in Phase 1 but absent from the
  PRD. Not planned above. See §14.

---

## 13a. Getting a build onto a phone

**Expo Go** runs the app against a dev server and needs no build — it is how the app was first
verified on hardware (2026-09-14, a Pixel 8 Pro: poll-and-claim sign-in, ticking an action off,
the weekly series expanded on the calendar). It is not a way to ship.

```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=http://<your LAN ip>:3000 npx expo start
```

**A real build goes through EAS**, not Gradle on this machine. `eas.json` carries three profiles;
`preview` produces an installable APK pointing at production, `production` produces the AAB Play
wants. Both need one interactive login first:

```bash
cd apps/mobile && npx eas-cli login && npx eas-cli build -p android --profile preview
```

**Why not a local `assembleRelease`.** It was tried and it does not work here. Each native module
builds under `<module>/.cxx` and `<module>/build/intermediates/cxx`, and under pnpm `<module>` is a
hashed directory like `node_modules/.pnpm/react-native-screens@4.26.2_7c467fb.../node_modules/...`.
With the repo under `OneDrive/Documents` that is past Windows' 260-character limit before CMake
appends its own temp files, and clang reports that it "is not able to compile a simple test
program" — which reads like a broken NDK and is nothing of the kind. Relocating the `.cxx`
directory moves the failure to the next module rather than fixing it, and a junction at `C:\dm`
does not help because Gradle resolves module paths to their real location. The two real fixes are
`LongPathsEnabled=1` in the registry plus a reboot, or building somewhere without the limit —
which is what EAS is.

**Before the first Play upload**, still missing: an app icon and splash in `app.json` (Play wants a
512x512 icon and a feature graphic; the compass rose in the brand handoff is the source), and a
privacy policy URL — `/privacy` already exists on the public site.

## 14. Open questions

1. **Does "edit the calendar" include creating events and actions from the phone?** §5 assumes yes
   and specs `items.create` for it. If the phone should only change what came off a page, drop
   `items.create` and the `"app"` event source with it — that is the only part of §5 it touches.
2. **Should the web adopt the same editors?** §5(e) assumes yes.
3. **SW-009 cites "(308)" and "(316)"** — requirement IDs from a document not supplied. If they
   constrain login or setup beyond what §7 assumes, they change that section.
4. **Push notifications** — in BUILD_PLAN's Phase 1, not in the PRD. In or out?
5. **Store accounts** — Apple Developer and Google Play enrolment are lead times, not code, and
   they are now the critical path.
6. **`pnpm db:dev` will not start on this machine.** PGlite 0.5.8 aborts opening the existing
   data directory under `%LOCALAPPDATA%\dayMarkable\pgdata` (`RuntimeError: Aborted()`), twice,
   on a clean lock file. A fresh directory starts immediately, so the installed one is corrupt or
   predates the current PGlite rather than anything being wrong with the code. Nothing was
   deleted: moving that folder aside and re-running `pnpm db:migrate` should be enough, but it is
   the founder's own data and the call is theirs.
7. **`ensureDefaultUser` falls back to a hardcoded personal address** when `USER_EMAIL` is empty
   (`packages/pipeline/src/deps.ts`). It is deliberate for a single-tenant Phase 0, but it means
   an empty `USER_EMAIL` silently creates that account on any fresh database — which is how it
   turned up in a throwaway test one. Worth an explicit failure instead, before Phase 2.
