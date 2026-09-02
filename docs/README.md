# dayMarkable — Product Brief

*Write it down. Wake up organized.*

## What it is

dayMarkable is a subscription web service for reMarkable tablet owners. Every night at 3AM in the
user's local time, it reads the handwritten notes they made that day, decodes them with AI
vision, extracts tasks, events, deadlines, and ideas, and writes a beautifully typeset
**planner notebook back onto the tablet**: today's calendar and action list, plus rolling
weekly and monthly views. The user never leaves paper — they write by hand, and they wake up
to a plan in the same device.

The loop is the product: the planner pages have hand-checkable boxes and a margin for notes.
Whatever the user ticks, crosses out, or scribbles on the planner gets read on the *next*
nightly run — completed tasks roll off, new margin notes roll in. No app, no keyboard, no sync
buttons. Your pen is the UI.

## Who it's for

reMarkable has sold well over 2 million tablets to a self-selected audience: professionals who
pay $400–600 to get *away* from apps and notifications. They already journal, take meeting
notes, and keep to-do lists in ink — and today those notes go nowhere. reMarkable's built-in
text conversion is manual, page-at-a-time, and produces text, not organization. dayMarkable is the
missing "so what" layer: notes in, executive function out.

## Core features

1. **Nightly decode, changed pages only** — each night, only files modified during the previous
   day are downloaded and analyzed. AI vision reads each changed page (any handwriting,
   diagrams, arrows, half-finished lists) and extracts structured items: tasks, events with
   dates/times, meeting requests, people, projects, and free-form notes.
2. **Your ink conventions** — the user registers which markup means "this is an action or
   follow-up": an asterisk, underline, highlighter stroke, circled text, a boxed word, an
   exclamation mark, a star in the margin, or a keyword like "TODO" / "F/U". Each convention
   can carry its own meaning (action vs. follow-up vs. priority vs. "schedule this"), and the
   user selects which ones dayMarkable honors from a settings menu.
3. **The Daily Sheet** — one page: today's date, calendar block, prioritized action list with
   checkboxes, carried-over items marked with a subtle dot count showing how long they've rolled.
4. **Calendar templates: day / week / month / quarter / year** — a typeset calendar PDF that
   organizes the user's time at every horizon, independent of Outlook or any external calendar.
5. **External calendar merge** — with the user's permission (OAuth), dayMarkable reads their
   Outlook or Google calendar so the calendar pages on the tablet include all existing
   meetings alongside handwritten commitments.
6. **Meeting invites from ink** — when a decoded note contains a meeting-setup action ("set up
   30 min with Priya next Tue"), dayMarkable drafts a real calendar invite in the user's selected
   calendar system (Outlook, Google Calendar, or .ics by email). Drafts are held for one-tick
   confirmation on the planner by default; auto-send is an opt-in setting.
7. **Meeting notes, delivered twice** — dayMarkable turns each meeting's handwritten pages into
   clean meeting notes that land as a "Meeting Notes" notebook on the tablet AND as email to
   the user's registered address — one email per meeting, subject line = meeting topic, date,
   and time.
8. **The living Action List** — a dedicated checkbox notebook on the tablet. New action items
   are appended to the existing list, never a fresh page that orphans old ones; the list is
   organized by date and priority, and completed ticks roll items off on the next nightly run.
9. **Closed loop** — checkmarks and margin ink on dayMarkable's own pages are parsed the next
   night and update task state.
10. **Watch folders** — the user picks which reMarkable folders dayMarkable reads (default: all
    notebooks, excluding ebooks/PDFs).
11. **Viewer apps: mobile + web** — a mobile application and the web account page show the
    same views of the account's documents: calendar files, meeting notes, and the action
    list. The tablet stays the primary surface; the apps are for checking your day from a
    phone or desk.
12. **On-demand sync** — from web or mobile, the user can trigger an immediate sync of
    notebooks to outputs instead of waiting for 3AM. An on-demand sync **replaces that
    night's automatic sync** (no double runs), and the user may run up to **3 on-demand
    syncs per 24-hour period** across web and mobile combined.
13. **Conversion quality rating** — on their account page, users rate the quality of the
    note-taking conversion (per run or overall); ratings feed the admin portal's feedback
    metrics and the model-quality tuning loop.
14. **Admin portal** — an operator-only portal (credentials held in the web host's
    environment variables) for running the business: per-user account management, revenue
    and trial metrics, and feedback metrics. Details in ARCHITECTURE.md §10.

**Payment surfaces:** Stripe handles all payment processing **within the application web
page only**. The mobile application contains **no payment processing** (it is a pure
viewer/trigger — which also keeps it outside the app stores' in-app-purchase commissions).
The web service is fully responsive, supporting a **mobile HTML experience**, so phone
users can subscribe and manage billing through the browser.

Later: email digest mirror, shared/team planners, custom planner templates and typography,
other e-ink devices (Kindle Scribe, Supernote).

## Business model

Subscription for daily updates: **$10/month or $100/year** (2 months free on annual).
**14-day free trial — the user registers with a card up front and billing starts
automatically when the trial ends**, with a reminder email before the first charge. Token
costs run roughly $0.90–3.00 per active user per month depending on model choice, leaving
~77–81% gross margin at $10 (see ECONOMICS.md and the cost sensitivity workbook). Final
pricing is confirmed only after the personal-use phase measures real token/cost usage across
models. An ad-supported free tier was analyzed and rejected as a primary model — the math and
reasoning are in ECONOMICS.md.

## Marketing site requirements

The web service page sells the loop visually: **side-by-side examples of real handwritten
note pages on the tablet and the outputs dayMarkable produced from them** — a messy meeting
page next to its clean Daily Sheet, Action List entry, meeting-notes email, and drafted
invite. Use the founder's own (curated) pages or clearly staged samples, never customer
content. The privacy promise appears on the page in plain language: *your note pages and
outputs stay in our systems for at most 24 hours — each night's run replaces the previous
night's, and nothing is ever archived.* Logo and design style follow the Claude Design
brand guidelines (see Brand & design below).

## Brand & design

Logo and design style guidelines for all service elements are provided via Claude Design —
the "dayMarkable Brand" board (beacon-triangle mark, Paper/Ink/Beacon palette, Instrument
Serif + Public Sans + IBM Plex Mono, e-ink usage rules). Product name is always spelled
**dayMarkable** (lowercase d, capital M) in copy, code, and UI.

## The honest risks

- **No official API.** reMarkable publishes no public developer API; the entire third-party
  ecosystem (and this product) uses the community-documented cloud API via maintained clients
  (`ddvk/rmapi`, `rmapi-js`). It has been stable for years and reMarkable tolerates a large
  ecosystem built on it, but it can change without notice. Mitigations in ARCHITECTURE.md.
- **Handwriting is hard.** Modern vision models read most handwriting well, but the product
  must degrade gracefully: uncertain items appear in an "Inbox — did I read this right?"
  section rather than silently corrupting the plan.
- **Platform risk.** reMarkable could ship a native equivalent. Speed and craft are the moat;
  so is going cross-device later (Kindle Scribe, Boox, Supernote all have similar gaps).
- **Privacy is existential.** Handwritten notes are among the most personal data a user has.
  Note pages and outputs are retained **at most 24 hours** — a 1-day rolling cache kept so
  the service can update its notebooks without re-reading documents; each night's run
  replaces the last — plus encryption at rest for everything retained (cache, extracted
  tasks/events), no training on user data, and a plain-English privacy policy. Launch
  requirements, not nice-to-haves.

## Documents in this pack

- `NAMING.md` — name recommendation and shortlist
- `ARCHITECTURE.md` — full system architecture
- `ECONOMICS.md` — token costs, pricing, revenue targets, ad-support analysis
- `BUILD_PLAN.md` — phased plan from personal MVP to multi-tenant SaaS
- `CLAUDE.md` — drop into the repo root to start vibe coding with Claude Code
- `KICKOFF.md` — the prompt to hand Claude Code to start development
- `daymarkable-cost-model.xlsx` — subscription cost sensitivity model + token measurement log
