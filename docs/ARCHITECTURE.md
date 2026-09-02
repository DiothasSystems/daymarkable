# dayMarkable — System Architecture

## Design goals

Seamless for *every* reMarkable user means: no software installed on the tablet, no hacks that
void the warranty, works over the user's existing reMarkable cloud sync, one-time pairing, and
then zero interaction beyond writing with a pen. Everything below follows from that.

## The one-paragraph version

A Next.js web app handles signup, tablet pairing, and settings. A timezone-aware scheduler
wakes each user's pipeline at 3AM local. A worker syncs the user's changed notebooks from the
reMarkable cloud, renders changed pages to images, sends them to Claude (Batch API) for
transcription + structured extraction, merges the results into a per-user task/event store in
Postgres, composes planner PDFs typeset for e-ink, and uploads them back to a "dayMarkable" folder
on the tablet — which auto-syncs to the device before the user wakes up.

## Component diagram

```
┌────────────┐   pairing code    ┌──────────────────────────────────────────────┐
│  User's    │◄─── cloud sync ──►│              reMarkable Cloud                │
│ reMarkable │                   └───────▲──────────────────────────┬───────────┘
└────────────┘                           │ upload planner PDF       │ list/diff/download .rm
                                         │                          ▼
┌─────────────────┐  Stripe  ┌───────────┴───────────┐   ┌─────────────────────┐
│  Next.js app    │◄────────►│   API (tRPC/REST)     │   │  Sync worker        │
│  signup/pairing │          │   users, settings,    │──►│  (rmapi-js)         │
│  settings/logs  │          │   run history         │   └─────────┬───────────┘
└─────────────────┘          └───────────▲───────────┘             │ changed pages
                                         │                         ▼
┌─────────────────┐          ┌───────────┴───────────┐   ┌─────────────────────┐
│  Scheduler      │─enqueue─►│   Job queue           │──►│  Render service     │
│  (tz-aware,     │          │   (pg-boss on         │   │  .rm → PNG          │
│   hourly tick)  │          │    Postgres)          │   │  (Python rmscene,   │
└─────────────────┘          └───────────────────────┘   │   containerized)    │
                                                         └─────────┬───────────┘
┌─────────────────┐          ┌───────────────────────┐             ▼
│  Postgres       │◄────────►│  Decode worker        │◄──┌─────────────────────┐
│  users, tokens, │          │  Claude Batch API:    │   │  Object storage     │
│  doc snapshots, │          │  vision → structured  │   │  (page PNGs,        │
│  tasks, events, │          │  tasks/events JSON    │   │   ephemeral 24h)    │
│  run logs       │          └───────────┬───────────┘   └─────────────────────┘
└─────────────────┘                      ▼
                             ┌───────────────────────┐
                             │  Composer worker      │
                             │  planner PDF (day/    │──► upload via rmapi-js
                             │  week/month, e-ink    │
                             │  typography)          │
                             └───────────────────────┘
```

## 1. Tablet connectivity (the make-or-break layer)

There is **no official public reMarkable developer API**. The ecosystem standard is the
community cloud API, reverse-documented for years and used by dozens of tools:

- **Pairing:** the user visits `my.remarkable.com` → *Pair browser/device* → gets a one-time
  8-character code → enters it in dayMarkable's pairing wizard. dayMarkable exchanges it for a
  long-lived **device token**, then refreshes short-lived **user tokens** per session. This is
  exactly how reMarkable's own integrations pair, so users find it familiar. Store device
  tokens encrypted (KMS/libsodium sealed box); they grant full account access.
- **Client library:** `rmapi-js` (TypeScript, maintained) for list/download/upload against the
  current sync schema; `ddvk/rmapi` (Go CLI, actively maintained, last release May 2026) as the
  reference implementation and debugging tool.
- **Change detection (requirement, not optimization):** each night, only files modified
  during the previous day are downloaded and analyzed. The cloud exposes a
  generation/hash-tree per document: persist each document's hash per user per run, download
  only documents whose hash changed since the last run, and within them re-render only pages
  whose page-hash changed. This is also the #1 cost lever (see ECONOMICS.md).

**Risk containment for the unofficial API:** pin client versions; run a canary account that
exercises pair/list/download/upload hourly and alerts on schema drift; abstract the transport
behind a `TabletProvider` interface so a future official API, USB/local-network mode
(the tablet has a local web interface), or other e-ink brands (Kindle Scribe, Supernote) slot
in without touching business logic; review reMarkable's ToS with counsel before charging money.

## 2. Scheduling — "3AM local, every user"

Don't run one giant 3AM job — 3AM is a different UTC hour per user. The scheduler ticks
**hourly** (a single cron), selects users whose `timezone` currently reads 03:00 local
(DST-safe via IANA tz math, e.g. Luxon), and enqueues one `nightly-run` job per user with
jittered start times to smooth load. Every job is idempotent and keyed by `(user, local-date)`
so retries never double-produce a planner. A catch-up sweep re-enqueues any user whose last
successful run is >26h old (tablet was offline, cloud hiccup, etc.).

**On-demand sync.** Web and mobile expose a "Sync now" action that enqueues the *same*
pipeline job immediately (standard API, not Batch, so results land in minutes). Rules,
enforced server-side in one place: at most **3 on-demand syncs per rolling 24 hours** per
user, counted across web and mobile together (HTTP 429 with the next-available time when
exhausted); a completed on-demand sync **marks that user's next 3AM run as satisfied**, so
there is no overnight automatic sync that day — the scheduler's hourly tick simply skips any
user whose latest successful run already covers the current local date. On-demand jobs get
keys `(user, local-date, seq)` to stay idempotent alongside the nightly key. The run-history
screen labels each run "automatic" or "on-demand".

## 3. Ingest & render

The reMarkable native format is `.rm` (lines format, currently v6) — vector pen strokes, not
images. Two rendering paths:

- **Primary:** a small containerized **Python render service** using `rmscene`/`rmc` to
  rasterize changed pages to PNG at ~1568px long edge (the sweet spot for Claude vision token
  cost vs. legibility). Python owns this niche; don't fight it in JS.
- **Fallback:** download the cloud-rendered annotated PDF of a notebook and rasterize with
  `pdftoppm`. Slower and heavier, but survives lines-format version bumps until the Python lib
  catches up.

Page PNGs and the night's outputs land in object storage under a **1-day rolling cache**:
each run keeps its own downloads, rendered images, and generated outputs (planner, Action
List, Meeting Notes) until the next run replaces them, and the run's final step deletes the
*previous* night's cache. The economics are decisive — storing a user's ~10–20 MB working
set for a day costs a fraction of a cent per month, while re-downloading, re-rendering, and
re-decoding documents just to update the Action List or calendar registry costs real token
money every night (~$0.03+/run). Keeping yesterday's outputs and doc snapshots means the
service updates its own notebooks by diffing against what it already knows — it never
re-reads a document merely to update it. A 48-hour bucket lifecycle rule is the failsafe
for crashed runs.

## 4. Decode — Claude vision with structured output

One Batch API request per user per night containing all changed pages (batch = 50% off, and a
3AM service has zero latency pressure — results within an hour are fine).

- **Model:** Claude Haiku 4.5 for transcription+extraction (escalate a page to Sonnet only
  when Haiku self-reports low confidence — "smart escalation" keeps quality without 2× cost).
- **Prompt:** cached system prompt (extraction rules, JSON schema, planner-page semantics) +
  per-page image + light context (notebook name, page date, user's known projects/people) +
  the user's **registered ink conventions** — which markup (asterisk, underline, highlighter
  stroke, circled/boxed text, exclamation, margin star, keywords like "TODO"/"F/U") flags an
  action, a follow-up, a priority, or a "schedule this". Conventions are stored per user as a
  small config; the prompt builder injects only the active ones, so an underline means nothing
  to a user who didn't enable it.
- **Output schema (per page):** transcription, `tasks[]` (text, due, priority, project,
  confidence, source_convention), `events[]` (title, date/time, confidence),
  `meeting_requests[]` (topic, proposed date/time, duration, attendee names, confidence),
  `notes[]` with meeting/topic grouping, `checkbox_updates[]`
  (for dayMarkable's own planner pages — which boxes got ticked, what was written in margins).
- **Confidence handling:** items below threshold go to the planner's "Inbox — confirm these"
  section instead of the action list. The user confirms by ticking them — on paper. The loop
  closes itself.

## 5. Organize — the task/event store

Postgres tables: `tasks` (state machine: open → carried → done/dropped, with `carried_count`),
`events`, `meetings` (decoded meeting-note groupings), `meeting_requests` (state: drafted →
confirmed → sent), `pages`, `runs`. The nightly merge: apply `checkbox_updates` from planner
pages → ingest new tasks/events/meeting requests (dedupe by fuzzy match against open items —
"call dentist" written twice is one task) → age carried items → assemble today/week/month
views. The **Action List is a living list**: new items are appended to the one canonical list
(ordered by date, then priority), items persist until ticked or explicitly dropped, and the
regenerated Action List notebook always reflects the full open set — never a fresh page that
orphans older items. Deterministic TypeScript, not LLM: the LLM extracts, code organizes.
That keeps behavior testable and token costs flat.

## 6. Compose — the planner notebook

Generate PDFs typeset for the device (1872×1404 aspect ratio, high-contrast monochrome,
generous margins, real checkboxes sized for a pen tick, a margin column for notes — every page
is also an *input form*). Use `typst` (fast, programmable, beautiful) or `pdf-lib` if staying
pure-TS. The nightly document set, uploaded to the `/dayMarkable/` folder:

- **Planner** — Daily Sheet, Week Grid, Month Grid, **Quarter and Year views**, Inbox. The
  calendar pages stand alone (a complete day/week/month/quarter/year template independent of
  any external calendar) and, when the user has connected Outlook or Google, are overlaid
  with their existing meetings (§7).
- **Action List** — the living checkbox notebook (§5): every open item, organized by date and
  priority, regenerated in full each night so ticks roll items off and new ink adds items.
- **Meeting Notes** — one section per decoded meeting (topic, date/time, attendees, decisions,
  actions), appended chronologically; the same content each meeting's email carries (§8).

Replace yesterday's planner (keep 7 days of dated archives in `/dayMarkable/Archive/`). The
tablet pulls everything on its next cloud sync — before the user wakes.

## 7. Calendar integration — Outlook and Google

One `CalendarProvider` interface, two launch implementations: **Google Calendar API** and
**Microsoft Graph** (Outlook/Microsoft 365), connected per user via standard OAuth from the
settings page; refresh tokens stored with the same encryption regime as device tokens. Both
directions run through it:

- **Read (merge):** during the nightly run, fetch the next 90 days of events and overlay them
  on the Daily/Week/Month/Quarter pages, visually distinct from handwritten commitments
  (external events in regular weight, ink-derived ones bold with a dot). Free users without a
  connected calendar simply get the standalone templates.
- **Write (invites):** a decoded `meeting_request` becomes a **draft invite**: dayMarkable
  resolves attendee names against the user's contacts/directory where the API allows,
  proposes the time from the ink, and creates the event in the user's selected calendar
  system. Fallback when no calendar is connected: an `.ics` file emailed to the user to
  forward.
- **Invite safety (non-negotiable default):** misread handwriting must never email a meeting
  invite to another human. Drafts appear in the planner's "Confirm" section (and in the web
  app) and are sent only after the user ticks the confirm box — one pen stroke, closed the
  next night, or instantly from the web/email link. Users may opt into auto-send for
  high-confidence requests with no external attendees (self-blocks, reminders). Every sent
  invite is logged in run history.

## 8. Email delivery

A transactional email service (SES or Resend; SPF/DKIM/DMARC from day one) sends to the
user's registered account address only — dayMarkable never emails third parties except as an
explicit, confirmed invite through §7. Nightly sends: **one email per decoded meeting** with
subject `"<Meeting topic> — <date> <time>"` and the meeting notes as body (clean HTML +
plain-text part), plus optional run-summary and invite-confirmation emails (both
user-toggleable). Idempotency keys per (user, meeting, date) so retries never double-send.

## 9. Clients — web app and mobile app

**Web app** (Next.js App Router + tRPC + Postgres/Drizzle + Stripe Billing) carries account
setup and configuration: pairing wizard, watch-folder picker, timezone & schedule, **ink
conventions picker** (which markup means action/follow-up/priority/schedule), **calendar
connections** (Google/Outlook OAuth, invite auto-send opt-in), **email preferences**
(meeting-note emails, run summary), planner style, run history ("last night: read 9 pages,
found 4 tasks, 1 event, drafted 1 invite"), privacy controls (delete-everything button) —
plus the **viewer**: the logged-in user sees the account's current documents (calendar
files, meeting notes, action list) and the **Sync now** button. Auth via Auth.js (email
magic link — this audience hates passwords); the login email doubles as the registered
address meeting notes are sent to.

The web app is **fully responsive (mobile HTML experience)** — a phone browser gets the
complete product, including signup and billing. The account page also carries the
**conversion quality rating**: after each run (and any time from the account page) the user
rates how well their handwriting was converted (1–5 plus optional comment), stored per
(user, run) in a `feedback` table that feeds the admin portal's metrics and flags
low-rated runs for prompt/model tuning.

**Payments: Stripe, web page only.** All payment processing (checkout, card update, plan
change, cancellation) happens inside the application web page via Stripe. The mobile app
contains **no payment processing, purchase links, or price display** — a deliberate rule
that both simplifies PCI scope and keeps the app a pure "reader" under Apple/Google
in-app-purchase policies (subscription management happens in the mobile browser instead).

**Mobile app** (React Native/Expo — stays in the TypeScript monorepo and reuses the tRPC
API types) is a viewer + trigger, deliberately not a note-taking or editing surface: sign in
with the same account, view the same calendar files, meeting notes, and action list the web
shows, tap **Sync now** (same server-side 3-per-24h quota), and optionally get a push
notification when a run completes. Both clients read from one `documents` API that serves
the current generated PDFs from the 1-day cache and the live action/event registry from
Postgres — the cache is what makes the viewers free: nothing is re-generated to display.
The tablet remains the product's primary surface; the apps exist to check your day and to
pull the trigger early.

## 10. Admin portal

An operator-only portal at `/admin` (or an `admin.` subdomain), **separate from user auth**:
the admin login ID and password live in the environment variables of the web host
(Hostinger). Implementation rule: store `ADMIN_LOGIN_ID` and `ADMIN_PASSWORD_HASH` (bcrypt
hash, never the plaintext password) in the host's env config; verify server-side with rate
limiting and a short-lived session cookie; log every admin action to an append-only
`admin_audit` table. Minimum screens — expected to grow as key operating metrics are
identified:

1. **Users** — every registered user: login email, account status (trial / active / past
   due / canceled / deleted), average daily usage (pages, runs, on-demand syncs), token
   costs to date and per month (from `run_costs`), and per-user actions: **cancel service**,
   **refund prorated subscription** (computed from unused days via the Stripe API), and
   **delete account** (full deletion per the privacy policy). Destructive actions require a
   typed confirmation and are audited.
2. **Revenue** — total MRR and ARR (derived from live Stripe subscriptions: monthly plans at
   face value, annual plans ÷ 12 for MRR; ARR = MRR × 12).
3. **Customers** — total customer count, with breakdown by status.
4. **Trials** — customers currently in the 14-day trial, trial→paid conversion rate, and
   how many cancel during the trial period.
5. **Feedback** — conversion-quality rating metrics from the user rating flow: average
   rating, distribution, trend over time, and the lowest-rated recent runs (rating +
   comment only — never the underlying note content, which is already purged).

## 11. Hosting

The web service deploys to **Hostinger** (VPS/cloud tier running the Node app and Postgres,
or Docker Compose for the app + render container), with the admin credentials, API keys,
and all secrets in the host's environment variable configuration. The render container and
worker run on the same box until scale demands separation; object storage stays S3-compatible
(external) so the 1-day cache survives redeploys.

## 12. Security & privacy (launch requirements)

**24-hour maximum retention is the headline guarantee:** note pages and generated outputs
live in the cloud for at most one day — each night's run replaces the previous night's
cache (kept solely so the service can update the Action List and calendar notebooks without
re-reading documents), the replacement purge is logged per run, and nothing is ever
archived. Beyond that: device
tokens and OAuth refresh tokens encrypted with per-user data keys; the retained working set
(extracted tasks, events, meeting notes) encrypted at rest; zero-retention API agreement
with the model provider; no training on user content; full account deletion actually
deletes; SOC 2 posture from day one even if certification comes later. The marketing page
states all of this plainly — for this audience, privacy *is* a feature.

## Suggested stack summary

TypeScript everywhere except the render container. Next.js + tRPC + Drizzle + Postgres +
pg-boss (queue — one database to operate, swap for SQS at scale) + S3-compatible object store
+ `rmapi-js` + Python `rmscene` render container + Claude Batch API + typst + Google Calendar
API / Microsoft Graph behind a `CalendarProvider` interface + SES or Resend for email +
Stripe (web page only) + **Hostinger** VPS/cloud hosting (Node app, Postgres, and the
render container via Docker Compose; secrets in the host's env config; move to AWS when
unit count demands).
