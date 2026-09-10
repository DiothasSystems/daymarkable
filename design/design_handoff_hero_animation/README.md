# Handoff: dayMarkable Hero (logo build + note-to-page animation)

## Overview
The top section of the dayMarkable marketing site: an animated logo build with the product description beside it, followed by a looping illustration of the service (handwritten page → dayMarkable compass "machine" → generated pages piling up). dayMarkable reads reMarkable notebooks overnight and returns action items, notes, and schedules to the tablet and inbox.

## About the Design Files
`hero.html` is a **design reference created in HTML**, not production code. Recreate it in the target codebase's existing environment (React/Next, Vue, Astro, etc.) using its own patterns. If no environment exists, a static site with plain HTML/CSS is sufficient: the animation is pure CSS keyframes on inline SVG, no JavaScript.

## Fidelity
**High-fidelity.** Colors, type, spacing, timings, and SVG geometry are final. Recreate pixel-perfectly; the SVG in `hero.html` can be lifted verbatim.

## Screens / Views

### Hero (single view)
Wrapper: `<header>` background #FBF8F2, bottom border 1px #D9CDB4, overflow hidden. Inner container max-width 1240px, centered, padding 44px 24px 0, column flex, gap 28px.

**Row 1 — logo + description.** Flex row, wrap, align center, justify center, gap 24px (row) / 56px (column), padding-bottom 8px.

- *Logo column*: width min(600px, 86vw), flex 1 1 460px, max-width 600px, `container-type: inline-size` (for cqw units). Three stacked divs slice `assets/logo-lockup.png` (1536×1024) via background-position:
  - Emblem: aspect 1536/640, position 0 0. Animation `dmEmblem` 1.1s cubic-bezier(.2,.8,.2,1), delay 0.2s, both.
  - Wordmark: aspect 1536/190, position 0 calc(-640/1536 × 100cqw). Animation `dmWord` 0.9s cubic-bezier(.4,0,.2,1), delay 1.1s.
  - Tagline: aspect 1536/130, position 0 calc(-830/1536 × 100cqw). Animation `dmTag` 0.6s ease-out, delay 1.8s.
  (In production, prefer exporting the three slices as separate images.)
- *Text column*: flex 1 1 380px, max-width 520px, column flex, gap 18px, animation `dmTag` 0.8s ease-out delay 2.2s.
  - Kicker: IBM Plex Mono 12px, letter-spacing 0.2em, #B8862F — "NOTE TO ACTION ORGANIZER · FOR reMARKABLE"
  - H1: Source Serif 4 700, clamp(34px, 3.8vw, 48px), line-height 1.08, letter-spacing -0.015em, #1E2A44 — "Write it down today. Wake up to a plan."
  - Paragraph: Public Sans 16px/1.65, #4A5266 — "dayMarkable reads the notebooks on your reMarkable overnight and hands back your day by morning: action items, meeting notes, and a schedule, loaded onto your tablet and, if you like, sent to your inbox."
  - CTA row (flex, gap 16px): primary button "Start free — 14 days" (#1E2A44 bg, #F7F0E3 text, radius 4px, padding 14px 28px, 15px/600, hover #2A3A5E) and text link "See how it works →" (15px/600, #B8862F, underline offset 3px).
  - Footnote: IBM Plex Mono 11px, letter-spacing 0.06em, #8A7D5F — "NO APP TO LEARN · YOUR PEN, YOUR PAPER, YOUR HANDWRITING"

**Row 2 — animated scene.** Full-width div, animation `dmScene` 2s cubic-bezier(.4,0,.2,1) delay 2.7s (wipes in left→right). Contains one responsive `<svg viewBox="0 0 1100 460" width="100%">`. All coordinates below are in viewBox units.

- *Tablet* (left): rect 90,100 200×260, rx 14, fill #FBFBF9, stroke #1E2A44 4px. Label "MEETING-NOTES · p.6" IBM Plex Mono 8px #9A9A9A at 112,126. Five handwriting paths (group translated 90,100; stroke #1A1A1A 2.2px round caps) with `pathLength="1"`, `stroke-dasharray: 1`, each animated by `dmInk1..5` (6s linear infinite). Pen: 3 lines (body #1E2A44 7px, cap 4px, gold tip #C9973F 3px) animated by `dmPen` 6s linear.
- *Lifted page*: a static copy of the completed page (rect 102,115 176×230 + the five paths), `transform-box: fill-box; transform-origin: center`, animation `dmPage` 6s cubic-bezier(.4,0,.6,1).
- *Machine* (center 560,230): `assets/emblem.png` drawn twice at x 434.97, y 97.1, 260×260 (offset so the ring's true center — 302,321 in the 628px file — lands on 560,230).
  - Static copy clipped to circle r 109 (the illustration).
  - Wheel copy clipped to an even-odd annulus r 109→135 (gold ring, ticks, diamonds), wrapped in a `<g>` with `transform-box: view-box; transform-origin: 560px 230px`, animation `dmTick` 24s cubic-bezier(.3,0,.2,1).
  - Core pulse: circle r 34 #C9973F, animation `dmCore` 6s ease-in-out.
- *Output pile* (right): shadow ellipse 910,352 rx 96 ry 8 #1E2A44 @ 8%. Four 140×180 page cards (rx 6, fill #FBFBF9, stroke #1E2A44 1.5px; title Source Serif 4 700 14px; header rule; "dayMarkable" mono 6px #6E6E6E top-right): **Tomorrow** (3 checkbox rows + SCHEDULE chips), **Actions** (6 rows, first two ticked), **Notes** (9 text lines + gold quote bar), **Calendar** (7×5 grid, 3 filled navy, 1 gold). Positions/rotations: (830,170,-6°), (842,162,4°), (834,154,-3°), (848,146,6°). Each animated by `dmDoc0..3` 24s cubic-bezier(.3,.7,.3,1) using CSS vars --sx/--sy (offset from machine center) and --r.
- *Captions* y 420, IBM Plex Mono 11px, letter-spacing .14em: "DAYTIME · YOU WRITE" (x190, #8A7D5F), "OVERNIGHT · WE READ" (x560, #B8862F), "MORNING · YOUR PAGES" (x910, #8A7D5F).

## Interactions & Behavior

### Entrance (once, on load)
0.2s emblem irises in (clip-path circle 0→75%, rotate -25°→0, scale .8→1) → 1.1s wordmark wipes left→right → 1.8s tagline fades up → 2.2s text column fades up → 2.7s scene wipes in with a brief brightness flash.

### Loop (24s master = 4 × 6s conversions)
Per 6s cycle (percentages of 6s):
- 0–3%: completed page rests on tablet; 2.1% tablet ink clears.
- 3–22%: page drifts right 335px, scales to .45, rotates -8°; 22–30% shrinks to nothing into the machine center.
- 20–34%: gold core pulses (opacity 0→.9→0, scale .6→1.1→.6).
- 55–95%: pen writes lines 1–5 (8% each); 97% pen exits.
Per 24s master:
- Wheel ticks 90° clockwise at 8.3→9.3%, 33.3→34.3%, 58.3→59.3%, 83.3→84.3% (immediately after each intake).
- Page k (0–3) emerges from machine center at 9/34/59/84%, lands on pile 5% later, holds, all fade at 97→100%; loop restarts.
Optional: honor `prefers-reduced-motion` by pausing all animations and showing the final state (pile full, page on tablet).

### Responsive
Row 1 wraps to a single column under ~900px (logo above text). SVG scales with width; keep `viewBox` and let height follow (aspect 1100:460).

## State Management
None. Pure CSS animation; no data.

## Design Tokens
Colors: Parchment #F7F0E3 (page), Hero ground #FBF8F2, Notepaper #FDFAF3, Card border #E3D9C2, Rule #D9CDB4, Midnight #1E2A44, Midnight hover #2A3A5E, Body text #4A5266, Meta #8A7D5F, Compass Gold #C9973F, Gold text #B8862F. E-ink: paper #FBFBF9, ink #1A1A1A, secondary #6E6E6E, rules #D8D4C8, label #9A9A9A.
Type: Source Serif 4 (display, 700), Public Sans (body 400/600), IBM Plex Mono (meta, uppercase, tracked). Google Fonts.
Radii: 4px buttons, 6px cards, 14px tablet. Spacing: 18/24/28/44/56px as noted.

## Assets
- `assets/logo-lockup.png` — full logo (emblem + wordmark + tagline), 1536×1024.
- `assets/emblem.png` — compass emblem, 628×628 transparent PNG. Ring center is at (302, 321), not the image center; keep the offset described above or re-export a centered emblem.

## Files
- `hero.html` — self-contained reference of the hero section (fonts via Google Fonts, assets relative).
