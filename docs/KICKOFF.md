# dayMarkable — Claude Code Kickoff

How to start development: create an empty repo, copy `CLAUDE.md` to the repo root and the
rest of this pack into `/docs`, open Claude Code in the repo, and paste the prompt below.

---

## The kickoff prompt (paste into Claude Code)

> Read CLAUDE.md and everything in /docs, then build **Phase 0 from docs/BUILD_PLAN.md** —
> the personal-use system: the full pipeline plus a single-user web app with account setup.
> Build it in this order, and show me each milestone working before the next:
>
> **Milestone 1 — pipeline spike.** A script that (a) pairs with my reMarkable using a
> one-time code from https://my.remarkable.com/device/browser/connect via rmapi-js and
> saves the device token, (b) lists my document tree and downloads one notebook I name,
> (c) renders its pages to PNG (the Python rmscene render container from CLAUDE.md, with
> the annotated-PDF fallback), (d) extracts with Claude (Haiku 4.5) using the schema from
> docs/ARCHITECTURE.md §4 and starter ink conventions (asterisk = action, underline =
> follow-up, "TODO" = action), and (e) composes a Daily Sheet per the dayMarkable brand
> rules in CLAUDE.md and uploads it to /dayMarkable on my tablet.
>
> **Milestone 2 — the real pipeline.** Postgres schema + deterministic merge
> (docs/ARCHITECTURE.md §5), hash-based change detection (only files modified during the
> previous day), the full output set (planner day/week/month/quarter/year + Inbox, the
> living Action List notebook, Meeting Notes notebook + one email per meeting via
> SES/Resend, subject "topic — date time"), the 1-day rolling cache with previous-night
> purge as the final step (CLAUDE.md rule 5), token/cost metering into run_costs with the
> model as a config value (CLAUDE.md Model usage), and a 3AM nightly cron.
>
> **Milestone 3 — the web app.** Next.js (apps/web), fully responsive (it IS the mobile
> experience until Phase 1): magic-link auth, the account setup flow (pairing wizard,
> watch folders, timezone, ink conventions picker, email preferences), a viewer for my
> calendar files, meeting notes, and action list served from the 1-day cache and registry
> (CLAUDE.md rule 12 — viewers never regenerate), a **Sync now** button implementing
> CLAUDE.md rule 11 (server-side quota of 3 per rolling 24h; a completed on-demand sync
> replaces that night's 3AM run), run history labeling automatic vs. on-demand runs, and a
> **conversion quality rating** (1–5 + comment per run) on the account page.
>
> **Milestone 4 — admin portal v1 + deploy.** `/admin` gated per CLAUDE.md rule 13
> (ADMIN_LOGIN_ID + bcrypt ADMIN_PASSWORD_HASH from env vars, rate-limited, separate from
> user auth, append-only audit log): users table with account status, average daily usage,
> and token costs from run_costs; feedback metrics from the ratings; revenue and trial
> panels stubbed dark until Stripe (Phase 2). Then a Docker Compose deploy targeting a
> Hostinger VPS (app + Postgres + render container), with every secret read from the
> host's environment config.
>
> Respect all fourteen domain rules in CLAUDE.md. Ask me for the pairing code and the
> notebook name when you need them. Exit criteria: docs/BUILD_PLAN.md Phase 0.

---

## What Claude Code should NOT do yet

No mobile app (Phase 1 — but keep the tRPC API clean enough for Expo to consume), no
Stripe, no OAuth calendar work, no invite sending, no multi-tenant scheduler, no marketing
site — those are Phases 1–3.

## Secrets checklist before the first run

`.env` locally, Hostinger env config in production (never committed): `ANTHROPIC_API_KEY`,
`EMAIL_API_KEY`, `DATABASE_URL`, `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH` (bcrypt — generate
the hash, never store the plaintext). The reMarkable device token is created interactively
during pairing. Stripe and calendar vars wait for Phase 2.

## After Phase 0 works

Run it nightly for 2+ weeks, copying each run's token counts into the measurement log sheet
of `daymarkable-cost-model.xlsx`. Compare models on the same pages with
`pnpm compare --days 7 --with-calibration`. That comparison has since been run: **Sonnet 5 is
the baseline decoder and Opus 5 the escalation**, with the calibration sample always attached;
the brief above still says Haiku 4.5 because that is what it said at the time. Exercise Sync now against the quota. When the numbers hold
up, tell Claude Code to start Phase 1 (the mobile app) from docs/BUILD_PLAN.md.
