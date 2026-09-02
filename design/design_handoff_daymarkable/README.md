# Handoff: DayMarkable — Brand, Landing Page, Tablet Pages & Email

## Overview
DayMarkable is a web service that reads a user's reMarkable tablet notebooks nightly and returns, by morning: a meeting-notes summary email, plus daily / weekly / monthly / yearly planner pages downloaded onto the tablet, with actions extracted from the user's handwriting. Tagline: **"Note to Action Organizer"** / "Today's Notes → Tomorrow's Actions". Target user: an old-school tech person who prefers handwritten notes.

This package covers: brand style guide, marketing landing page (with animated hero), and prototypes of the generated tablet pages and digest email.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (React, Vue, etc.) using its established patterns and libraries — or, if no environment exists yet, choose an appropriate framework and implement the designs there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final-intent. Recreate pixel-perfectly using your stack's conventions.

## Files
- `DayMarkable Style Guide.dc.html` — brand guidelines (logo, color, type, icons, web UI, app icon)
- `Landing Page.dc.html` — marketing landing page with animated hero
- `Tablet Pages and Email.dc.html` — 5 prototypes: digest email + 4 tablet planner pages
- `assets/emblem.png` — circular emblem logo (transparent-safe crop)
- `assets/full-lockup.png` — full logo lockup graphic (emblem + wordmark + tagline)

Note: the `.dc.html` files use inline styles inside an `<x-dc>` template wrapper; read the markup for exact values. `support.js` is a preview runtime — ignore it.

## Brand

### Wordmark
`dayMarkable` — camelCase, reMarkable-style. Set in **Source Serif 4 Bold (700)**. "day" in Compass Gold (#B8862F on light / #C9973F on dark), "Markable" in Midnight (#1E2A44) on light or Parchment (#F7F0E3) on dark. Never set in another typeface; never swap the gold/navy split.

### Logo variants
- **Primary lockup** (`assets/full-lockup.png`): emblem above wordmark + tagline — marketing, covers, splash.
- **Horizontal lockup**: emblem left of wordmark — headers, docs.
- **Reversed (dark bg)**: a simplified **compass rose** SVG stands in for the emblem — a circle (stroke #C9973F, ~4px at 72px viewBox) with 4 diamond compass points at N/S/E/W. Exact paths are in the HTML files (search `viewBox="0 0 72 72"`).
- **Clearspace**: height of the wordmark "d" on all sides. **Min sizes**: emblem 48px/14mm (below that use compass rose); wordmark 120px wide; primary lockup never below 200px wide.
- **Don't**: recolor the emblem, add shadows/gradients, rotate the rose, place on busy photos.

### Color tokens
| Token | Hex | Use |
|---|---|---|
| Midnight | #1E2A44 | Ink, headings, dark UI, primary buttons |
| Compass Gold | #C9973F | Accents, active states, "day" on dark |
| Gold (text on light) | #B8862F | "day" in wordmark, links, labels |
| Parchment | #F7F0E3 | Page background |
| Notepaper | #FDFAF3 | Cards, surfaces |
| Sunrise | #F0DDA9 | Highlights, fills, charts |
| Border | #E3D9C2 | Hairline card borders |
| Border (strong) | #D9CDB4 | Section dividers |
| Body text muted | #4A5266 | Body copy |
| Meta | #8A7D5F | Mono metadata text |

Ratio: Parchment ~70%, Notepaper ~20%, Midnight ~8%, Gold ≤2% (punctuation, never a wall). Body text is always Midnight on Parchment/Notepaper (11.9:1). Gold text only ≥18px bold, or on Midnight.

Tablet e-ink pages use grayscale only: #FBFBF9 paper, #1A1A1A ink, #6E6E6E secondary, #9A9A9A tertiary, #D8D4C8 rules, #F1EFE7 shaded cells.

### Typography (Google Fonts)
- **Source Serif 4** 600–700 — wordmark, page titles, headlines
- **Public Sans** 400–700 — UI, body, buttons
- **IBM Plex Mono** 400–500 — timestamps, sync status, page refs, section labels (uppercase, letter-spacing 0.12–0.2em)

### Iconography
Line icons, 2px stroke, rounded caps/joins, 24px grid. Midnight default; gold only for active state or on dark. Set includes calendar, action (checkbox+tick), people, trends, notebook.

### UI components (web)
- Cards: Notepaper bg, 1px #E3D9C2 border, 6px radius, no heavy shadows ("sheets on a desk").
- Primary button: Midnight bg, Parchment text, 4px radius, 10–14px/20–28px padding, 600 weight.
- Secondary: transparent, 1.5px Midnight border. Tertiary: gold underlined text link.
- Source-reference quote: 3px gold left border, Parchment bg, italic, with mono page-ref line (e.g. `MEETING-NOTES · p.6 · 14:32`).
- Nav active state: gold text + 2px gold bottom border.

### App icon
Full emblem on Notepaper for stores (1024px); compass rose on Midnight at ≤80px and favicon. Notepaper or Midnight background only; no wordmark inside the icon.

## Screens / Views

### 1. Landing Page (`Landing Page.dc.html`)
Max-width 1080px, 48px side padding, Parchment bg.
- **Nav**: emblem 40px + wordmark left; links (How it works / Your pages / Pricing) + Midnight "Start free" button right.
- **Animated hero** (see Interactions): left column — mono kicker `NOTE TO ACTION ORGANIZER · FOR reMARKABLE`, H1 54px Source Serif "You write by hand. We turn it into tomorrow.", body para, CTA "Start free — 14 days" + text link, mono footnote. Right column — the animation stage.
- **How it works**: full-bleed Midnight band, 3 columns: 01 YOU WRITE / 02 WE READ · 02:14 / 03 YOU WAKE UP READY. Gold mono step labels, #CFC9BA body text.
- **Your pages**: 3 cards (Daily page, Week·Month·Year, Meeting-notes email) with line icons; below, a source-reference quote strip.
- **For whom**: Notepaper band, 2 columns — headline "Built for people who never stopped writing." + 4 gold-arrow bullets.
- **Pricing/CTA**: centered emblem 88px, headline, "$8/month after a 14-day free trial. One tablet, unlimited notebooks. Cancel anytime.", Midnight CTA, mono footnote `FIRST SUMMARY IN YOUR INBOX TOMORROW · 02:14`.
- **Footer**: small lockup, Privacy/Terms/Support, "© 2026 dayMarkable · Not affiliated with reMarkable AS".

### 2. Digest email (`Tablet Pages and Email.dc.html`, panel 1)
560px wide. White meta header (From/Subject) → Midnight brand bar (rose + wordmark + `SYNCED 02:14`) → Source Serif headline → one Notepaper card per meeting (title, mono time+page ref, summary para, ink-quote strip, gold-arrow action rows with due tags) → centered Midnight CTA "Open in dayMarkable" → mono footer `READ FROM 3 NOTEBOOKS · 11 PAGES · unsubscribe`.

### 3–6. Tablet pages (panels 2–5) — e-ink grayscale, 3:4 ratio (468×624 in mocks; target reMarkable 1404×1872)
Shared header: Source Serif title + mono subtitle (`dayMarkable DAILY · GENERATED 02:14`), monochrome compass rose right, 2px black rule below.
- **Daily**: 2 columns. Left: ACTIONS checkboxes, CARRIED OVER item, NOTES ruled lines (1px #D8D4C8) for handwriting. Right: SCHEDULE hourly rows 08–17, filled black chips = confirmed meetings, outlined chips = tentative.
- **Week**: left sidebar (118px) of open actions with due tags + blank ruled lines; right column one row per day (Mon–Sun), today shaded #F1EFE7, DUE items bold; WEEK GOALS checkboxes at bottom.
- **Month**: left sidebar (112px) OPEN ACTIONS with dates; right 7-col calendar grid, today outlined 1.5px black, weekends shaded, due-date labels in cells; MONTH FOCUS line at bottom.
- **Year**: 2×3 grid of period cards (past periods grayed, current outlined black, future with ▸ milestones); YEAR GOALS progress bars (outlined track, black fill, mono %).

## Interactions & Behavior

### Hero animation (12s CSS keyframe loop, linear)
Phase A (0–17%): emblem (230px) + wordmark fade/scale in (from scale .82, rotate −18°, ease-in-out), hold, fade out by 23%. Overlaid absolutely; `pointer-events: none`.
Phase B (17–24%): main scene fades in.
Phase C: mini tablet (210×280, 2px Midnight border, 10px radius) shows 6 handwriting SVG paths self-drawing via `pathLength="1"; stroke-dasharray: 1; stroke-dashoffset 1→0`, staggered 0.3s delays (22–46% of loop). Gold arrow fades in (48%). Three output cards slide in from −16px, staggered (54% / 61% / 68%): Meeting summary, Action item (gold tick self-draws at 66–72%), Week updated.
Phase D (88–100%): everything fades, dashoffsets reset, loop restarts.
Exact keyframes are in `Landing Page.dc.html` helmet `<style>` (`dmLogo`, `dmScene`, `dmDraw`, `dmArrow`, `dmCard1-3`, `dmTick`).

### Other
- Buttons: primary hover lightens to ~#2A3A5E.
- Links: #B8862F, hover #94691F.
- Nav anchors scroll to sections.
- No JS required anywhere; all animation is pure CSS.

## State Management
None — all pages are static presentational designs. The landing page needs no state; email and tablet pages are server-generated documents.

## Design Tokens (summary)
- Radii: 6px cards, 4px buttons, 2px tablet cells/chips, 10px mini-tablet, 20–32px app icons.
- Spacing: 48px page gutters, 72–80px section padding, 24px card gaps, 28px card padding.
- Shadows: `0 2px 8px rgba(30,42,68,0.08)` (cards/panels), `0 4px 14px rgba(30,42,68,0.12)` (hero tablet) — nothing heavier.
- Type scale (landing): 54/34/30 Source Serif headings; 15–18px body; 11–13px mono meta.

## Assets
- `assets/emblem.png` — circular emblem (user-supplied graphic, cropped). Source of truth for the logo.
- `assets/full-lockup.png` — full lockup with tagline (user-supplied).
- Compass rose SVG — inline in the HTML files; recreate as a shared component.
- Fonts via Google Fonts: Source Serif 4, Public Sans, IBM Plex Mono.
