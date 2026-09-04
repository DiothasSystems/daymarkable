# CLAUDE.md — dayMarkable

dayMarkable reads a reMarkable user's handwritten notes nightly at 3AM local time (only files
modified during the previous day), decodes them with Claude vision using the user's
registered ink conventions, and writes back to the tablet: a planner
(day/week/month/quarter/year calendar templates, with the user's Outlook/Google calendar
overlaid when connected), a living Action List checkbox notebook (append-only, ordered by
date then priority), and a Meeting Notes notebook. Each decoded meeting is also emailed to
the user's registered address — one email per meeting, subject = topic, date, time. Decoded
meeting-setup actions become draft calendar invites in the user's selected calendar system.
Planner pages are hand-checkable; ticks and margin notes are read the next night (closed
loop). See README.md, ARCHITECTURE.md, ECONOMICS.md, BUILD_PLAN.md in /docs.

## Current phase

Phase 0: single-tenant personal use against the founder's own tablet — the full pipeline
PLUS a real (single-user) web app with the account setup flow, document viewer, and
on-demand sync. No billing, no mobile app (that's Phase 1), no multi-tenant scheduler
(Phase 2). Do not build multi-tenant abstractions early — but DO keep tablet access behind
the `TabletProvider` interface and design the API so the Phase 1 mobile app can reuse it
unchanged.

## Stack & conventions

- TypeScript (strict), Node 22, pnpm workspaces monorepo:
  - `packages/core` — domain logic: merge/dedupe/carry-over, planner assembly. Pure,
    deterministic, no I/O. This is where most tests live.
  - `packages/tablet` — `TabletProvider` interface + `RemarkableCloudProvider` built on
    `rmapi-js`. Nothing outside this package touches the reMarkable API.
  - `packages/decode` — Claude Batch API client, extraction prompt, zod schemas for the
    structured output. Nothing outside this package calls Anthropic.
  - `packages/compose` — PDF generation for all three notebooks (typst templates in
    `templates/`): planner, Action List, Meeting Notes.
  - `packages/calendar` — `CalendarProvider` interface + Google Calendar / Microsoft Graph
    implementations (read merge + draft invite creation). Nothing outside this package
    touches calendar APIs.
  - `packages/mail` — transactional email (SES/Resend): meeting-note emails (subject
    `"<topic> — <date> <time>"`), idempotency keys per (user, meeting, date).
  - `apps/runner` — the run pipeline (nightly AND on-demand — same job): sync → render →
    decode → merge → compose → upload → email → draft invites → rotate 1-day cache.
  - `apps/web` — Next.js, fully responsive (mobile HTML experience): account setup flow,
    settings, document viewer (calendar files, meeting notes, action list), Sync now, run
    history, conversion-quality rating, Stripe billing pages (web is the ONLY payment
    surface), and the `/admin` portal (operator-only; see rule 13).
  - `apps/mobile` — Phase 1: React Native/Expo viewer + Sync now, reusing the tRPC types.
  - `services/render` — Python container (`rmscene`) exposing `POST /render` (.rm → PNG).
- Postgres via Drizzle ORM; migrations in `packages/db`. Queue: pg-boss (Phase 2).
- Env vars in `.env` locally, in Hostinger's environment config in production (never
  committed): `RMAPI_DEVICE_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`,
  `RENDER_SERVICE_URL`, `EMAIL_API_KEY`, `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH` (bcrypt —
  never store the plaintext admin password), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
  (Phase 2), `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MS_GRAPH_CLIENT_ID/SECRET` (calendar vars
  unused until their phase). Production host is Hostinger (VPS/Docker Compose).
- Commands: `pnpm dev:run` (execute a nightly run now, against fixtures unless
  `--live`), `pnpm test`, `pnpm db:migrate`, `pnpm render:up` (docker compose for the
  render service).

## Domain rules (do not violate)

1. **LLM extracts, code organizes.** Claude turns page images into structured JSON
   (transcription, tasks[], events[], meeting_requests[], notes[], checkbox_updates[], each
   with confidence). All merging, deduping, carry-over, and prioritization is deterministic
   TypeScript in `packages/core`. Never ask the model to manage task state.
2. **Only changed pages are processed.** Document- and page-hash diffing against the last
   run's snapshot is correctness, not optimization — it's also the unit-economics lever.
3. **Low confidence → Inbox.** Items under the confidence threshold go to the planner's
   "Inbox — confirm these" section, never silently onto the action list.
4. **Idempotent runs.** A nightly run is keyed by (user, local-date); re-running it must
   produce the same planner, not duplicates.
5. **Privacy invariants: 1-day rolling cache, 24h max retention.** Each run KEEPS its own
   downloads, rendered images, and generated outputs so the next run can update the Action
   List and calendar notebooks without re-reading documents (re-decoding costs token money;
   a day of storage costs a fraction of a cent). The run's final step deletes the PREVIOUS
   night's cache and logs the deletion; a 48h storage lifecycle rule is the failsafe.
   Nothing is archived beyond one day. Cache encrypted at rest; device tokens encrypted at
   rest. No user content in logs — log counts and hashes, not text. (Fixtures from the
   founder's own pages are the sanctioned exception.)
6. **Every planner page is an input form.** When changing planner templates, keep checkboxes
   ≥ 28px, keep a ruled handwriting area on every page (NOTES lines, sidebar lines, goal
   lines), and update the decode prompt's description of the planner layout in the same PR —
   the decoder must always know what the composer draws.
7. **Invites never auto-send by default.** A decoded meeting_request becomes a DRAFT; it is
   sent only after explicit user confirmation (planner checkbox or web/email link). Auto-send
   is an opt-in setting and even then only for high-confidence requests with no external
   attendees. A misread name must never email a stranger.
8. **The Action List is append-only and canonical.** One list per user; new items merge into
   it (date, then priority); items leave only by tick or explicit drop. Never emit a fresh
   list that orphans open items.
9. **Ink conventions are per-user config.** The set of markups meaning
   action/follow-up/priority/schedule (asterisk, underline, highlight, circle, box,
   exclamation, margin star, keywords) lives in one config module and is injected into the
   extraction prompt; never hardcode a convention's meaning in `packages/core`.
10. **Email goes to the registered address only.** `packages/mail` sends solely to the
    account's login email; third parties are reached only via a confirmed calendar invite
    through `packages/calendar`.
11. **On-demand sync: 3 per rolling 24h, and it replaces the night's run.** The quota is
    enforced server-side in one module, counted across web and mobile together (429 with
    next-available time when exhausted). A completed on-demand sync satisfies
    (user, local-date), so the 3AM scheduler skips that user. On-demand jobs are keyed
    (user, local-date, seq) and run on the standard API (minutes matter); nightly runs stay
    on Batch. Never enforce the quota client-side only.
12. **Viewers read, they never regenerate.** Web and mobile serve documents from the 1-day
    cache and the Postgres registry; a view must never trigger rendering or decode work.
13. **Admin portal is env-var gated and fully audited.** Admin auth checks `ADMIN_LOGIN_ID`
    + bcrypt `ADMIN_PASSWORD_HASH` from the host's environment variables, server-side, with
    rate limiting and a short-lived session — completely separate from user auth. Every
    admin action (especially cancel service, prorated refund, delete account) writes to an
    append-only `admin_audit` table, and destructive actions require typed confirmation.
    The feedback screen shows ratings and comments only — never note content.
14. **Payments live on the web page only.** All Stripe processing (checkout, card update,
    plan change, cancel, refund) happens in `apps/web`. `apps/mobile` must contain no
    payment processing, purchase links, or price display — subscription management from a
    phone goes through the responsive web experience.

## Testing

- Fixture-first: `fixtures/pages/*.png` (rendered real pages) with `expected.json`
  extraction results; `packages/core` merge tests cover dedupe ("call dentist" twice = one
  task), carry-over aging, and checkbox application.
- `pnpm test` must pass without network or API keys (decode tests mock the Batch client;
  a separate `pnpm test:live` hits real APIs and is manual-only).
- Golden-file tests for composed PDFs (rasterize → perceptual diff).

## Model usage

**Claude Sonnet 5 is the baseline decoder**, escalating to **Opus 5** only on low-confidence
pages. (Measured on the founder's own handwriting in September 2026: Sonnet read most
accurately, Opus was close behind, Haiku 4.5 was clearly worst and is no longer used.)
Nightly runs go through the **Batch API** (50% discount; 3AM has no latency pressure);
on-demand syncs use the standard API. Prompt caching carries the system prompt, the user's
ink conventions, their lexicon, and their handwriting calibration sample. Images are rendered
at 1568px long edge. Keep the extraction schema in one place (`packages/decode/schema.ts`) —
zod-validated, versioned. **Model is a config value, not a constant** — every run records
input/output tokens and dollar cost per model per stage in `run_costs`, and
`pnpm compare --days 7` renders a side-by-side transcription report to re-check the choice as
models change.

## Per-user accuracy

Claude's vision models cannot be fine-tuned, so accuracy per writer comes from context, all of
it carried in the cached system prompt:

- **Calibration sample.** During onboarding the user writes a short generated passage, tailored
  to their job and industry, that deliberately exercises their own vocabulary, symbols, and
  digits. The captured page image plus its known text becomes a few-shot example: this is what
  this person's letterforms look like. Users may skip it and are told accuracy will suffer.
- **Lexicon.** Names, companies, acronyms, and project words the user writes often. Proper nouns
  are where misreads concentrate; the lexicon is the single largest lever.
- **Corrections.** When the user fixes a decoded item in the web UI, the (wrong → right) pair is
  stored; recurring corrections are promoted into the lexicon automatically.

## Brand

Product name is always spelled **dayMarkable** (lowercase d, capital M) — in copy, UI, code
identifiers where casing allows, and email subjects. The design source of truth is the brand
handoff in `design/design_handoff_daymarkable/` (style guide, tablet page + email mocks,
`assets/emblem.png`, `assets/full-lockup.png`); `README.md` there summarises every token.

- **Wordmark**: Source Serif 4 Bold, "day" in Gold (#B8862F on light / #C9973F on dark),
  "Markable" in Midnight (#1E2A44) on light or Parchment (#F7F0E3) on dark. Never another
  typeface; never swap the split. Below 48px or on dark, the compass rose SVG (circle + four
  diamond points, `viewBox 0 0 72 72`) stands in for the emblem.
- **Palette**: Midnight #1E2A44 (ink, headings, primary buttons), Compass Gold #C9973F
  (accents, active states), Gold text #B8862F, Parchment #F7F0E3 (page), Notepaper #FDFAF3
  (cards), Sunrise #F0DDA9 (highlights), Border #E3D9C2, Border-strong #D9CDB4, Body muted
  #4A5266, Meta #8A7D5F. Ratio ~70% Parchment / 20% Notepaper / 8% Midnight / ≤2% Gold.
- **Type**: Source Serif 4 600–700 (titles, headlines), Public Sans 400–700 (UI, body), IBM
  Plex Mono 400–500 (timestamps, sync status, page refs, uppercase section labels with
  0.12–0.2em tracking).
- **Web UI**: cards Notepaper, 1px #E3D9C2 border, 6px radius, shadow no heavier than
  `0 2px 8px rgba(30,42,68,.08)`; primary button Midnight/Parchment 4px radius; secondary
  1.5px Midnight outline; tertiary gold underlined link; nav active = gold text + 2px gold
  underline; header shows `SYNCED HH:MM` in mono.
- **Tablet pages (e-ink)**: grayscale only — paper #FBFBF9, ink #1A1A1A, secondary #6E6E6E,
  tertiary #9A9A9A, rules #D8D4C8, shaded cells #F1EFE7. Header = Source Serif title + mono
  subtitle (`dayMarkable DAILY · GENERATED 02:14`) + monochrome compass rose right + 2px rule.
  Layouts follow `Tablet Pages and Email.dc.html` (Daily two-column with SCHEDULE chips; Week
  and Month with an actions sidebar; Year period cards), scaled ×3 from the 468px mocks.
- **Email**: 560px Parchment container, Midnight brand bar (rose + wordmark + SYNCED), Source
  Serif headline, Notepaper card per meeting, gold-arrow action rows, Midnight CTA.

## Gotchas

- The reMarkable cloud API is unofficial; `rmapi-js` handles the current sync schema. If
  sync breaks, check `ddvk/rmapi` (Go) issues first — that community finds schema changes
  within days. All such breakage should surface as a typed `TabletProviderError`, alert, and
  skip the night's run gracefully (never write a broken planner).
- .rm lines format is currently v6; a device firmware update can bump it. The render
  service's PDF-rasterize fallback exists for exactly this window.
- 3AM local ≠ one cron: hourly tick, select users at 03:00 local via IANA tz (Luxon),
  DST-safe. Test the DST transition days explicitly.
