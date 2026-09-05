# dayMarkable — Phased Build Plan (personal use → mobile → multi-tenant SaaS)

## Phase 0 — Personal use: pipeline + web configuration & account setup (2–4 weeks)

Everything needed for Jim to run dayMarkable daily on his own tablet, configured through a
real web app rather than config files.

**The pipeline (prove it first, as a spike inside this phase):**

1. Pair with the reMarkable account (one-time code from my.remarkable.com/device/browser/connect
   → device token), list the tree, download a notebook, render pages (Python `rmscene`,
   annotated-PDF fallback), extract with Claude (Sonnet 5), compose the Daily Sheet, upload
   to `/dayMarkable`. Exit criteria: a handwritten "call Steve Tuesday 2pm" comes back on the
   tablet, correctly placed.
2. Postgres schema (tasks, events, meetings, meeting_requests, pages, runs, run_costs, doc
   snapshots) + deterministic merge logic (dedupe, carry-over, checkbox updates).
3. Hash-based change detection: only files modified during the previous day are downloaded
   and analyzed.
4. Full output set: planner (Daily Sheet, Week, Month, Quarter, Year, Inbox), the living
   Action List notebook, Meeting Notes notebook + one email per meeting (subject = topic,
   date, time) via SES/Resend.
5. Ink conventions v1 (asterisk, underline, "TODO") wired through the extraction prompt.
6. **1-day rolling cache**: keep tonight's downloads, images, and outputs; delete the
   previous night's cache as the run's final step (24h max retention, logged).
7. **Token & cost metering (pricing gate)**: every run logs input/output tokens and dollar
   cost per model per stage into `run_costs`; compare models on real pages with
   `pnpm compare --days 7` and feed the measurement log in `daymarkable-cost-model.xlsx`.
   (Settled September 2026: Sonnet 5 baseline, Opus 5 escalation; Haiku 4.5 dropped.)
   Subscription pricing is not final until this data is in.

**The web app (single-user but real):**

8. Account setup flow: magic-link auth, pairing wizard, watch-folder picker, timezone,
   ink-conventions picker, email preferences.
9. Viewer: calendar files, meeting notes, and the action list, served from the 1-day cache
   and the Postgres registry.
10. **Sync now**: on-demand sync button running the same pipeline immediately (standard API,
    not Batch); server-enforced quota of 3 per rolling 24h; a completed on-demand sync
    satisfies that day's run so the 3AM automatic sync is skipped. Run history labels
    automatic vs. on-demand.
11. Nightly 3AM scheduler (single-user cron is fine here) honoring the skip rule.
12. **Conversion quality rating** on the account page (1–5 + comment per run) — start
    collecting during dogfood; it doubles as the model-comparison quality score for the
    pricing gate.
13. **Admin portal v1** at `/admin`: env-var login (`ADMIN_LOGIN_ID` +
    `ADMIN_PASSWORD_HASH`), users table with usage and token costs, feedback metrics, and
    the audit log. Revenue/trial panels ship dark until Stripe arrives in Phase 2.
14. Fully responsive layout — the web app is the mobile experience until Phase 1.
15. First deploy to **Hostinger** (Docker Compose: app + Postgres + render container),
    secrets in the host's env config — deploying in Phase 0 proves the 3AM cron and env-var
    handling on the real host before customers exist.

**Dogfood for 2+ weeks** while building Phase 1: tune extraction on real handwriting; build
the fixture library (rendered pages + expected JSON — the product's real IP, sanctioned
exception to the purge).

## Phase 1 — Mobile application (2–4 weeks)

- React Native/Expo app in the same monorepo, reusing the tRPC API types.
- Same login (magic link), same viewer: calendar files, meeting notes, action list.
- **Sync now** from the phone, sharing the server-side 3-per-24h quota with web.
- Push notification when a run completes ("Read 9 pages — 4 actions, 1 meeting, planner
  delivered").
- Deliberately NOT a note-taking or editing surface — viewer + trigger only.
- Ship via TestFlight / internal track for personal use; store listings wait for Phase 3.

## Phase 2 — Multi-tenant SaaS (4–8 weeks)

- Timezone-aware hourly scheduler + pg-boss job queue; idempotent per-(user, local-date)
  runs; catch-up sweep; on-demand quota enforcement at scale.
- Encrypted token storage, per-user data keys, per-user cache isolation.
- Stripe Billing on the web page only ($10/mo, $100/yr; card required at registration,
  14-day trial, billing starts automatically at trial end with a pre-charge reminder
  email), usage caps (40 pages/night).
- **Admin portal v2**: light up revenue (MRR/ARR from Stripe), customer counts, trial
  cohort + trial-cancellation tracking, and the per-user billing actions (cancel service,
  prorated refund via Stripe, delete account) — all audited with typed confirmation.
- **Calendar read integration**: Google Calendar + Microsoft Graph OAuth behind
  `CalendarProvider`; overlay existing meetings on the calendar pages.
- Canary account monitoring the unofficial cloud API; alerting (a silent 3AM failure is
  a churned customer).
- Marketing site with the **notes-in / outputs-out example gallery** (real curated pages
  side-by-side with the Daily Sheet, Action List, meeting-notes email, and drafted invite
  they produced) and the plain-language 24-hour-maximum-retention privacy promise, styled
  per the Claude Design brand board.
- Private beta: 20–50 users from r/RemarkableTablet; watch extraction accuracy across
  handwriting styles you've never seen.

## Phase 3 — Launch & grow

Public launch (reMarkable subreddit, eWritable, MyDeepGuide, Product Hunt); app-store
listings for the mobile app; **invite sending** — decoded meeting requests become draft
calendar invites with the confirm-by-checkbox flow, auto-send as an opt-in (write scopes and
the confirmation UX deserve their own phase: a misread name must never email a stranger);
Pro tier (Sonnet-everywhere, higher caps, multiple calendars, custom templates); then the
strategic move — abstract `TabletProvider` earns its keep: **Kindle Scribe and Supernote
versions** roughly triple TAM.

## Standing rules

Ship the fixture tests before tuning prompts; never process an unchanged page; retention
never exceeds 24 hours; every planner page is also an input form; pricing waits for the
measured token data.
