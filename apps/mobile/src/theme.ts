/**
 * The brand, transcribed for React Native.
 *
 * Source of truth is `design/design_handoff_daymarkable/` and the Brand section of CLAUDE.md;
 * these values are a copy of it, and `theme.test.ts` holds them to it. The web reads the same
 * numbers from CSS custom properties, which is why UX-001 ("the same visual design style as the
 * web UX") is a matter of keeping one list correct rather than of eyeballing two apps.
 *
 * Two deliberate departures, both toward the platform rather than away from the brand:
 *   - touch targets are 44pt, not the tablet templates' 28px. That rule is about a pen.
 *   - the type scale is a point smaller across the board; a phone is held closer than a page.
 */

export const color = {
  /** Ink, headings, primary buttons. */
  midnight: "#1E2A44",
  /** Accents and active states. Never more than a couple of percent of a screen. */
  gold: "#C9973F",
  /** Gold that has to pass as text. */
  goldText: "#B8862F",
  /** The page. */
  parchment: "#F7F0E3",
  /** Cards on the page. */
  notepaper: "#FDFAF3",
  /** Highlights. */
  sunrise: "#F0DDA9",
  border: "#E3D9C2",
  borderStrong: "#D9CDB4",
  /** Body text that is not a heading. */
  bodyMuted: "#4A5266",
  /** Timestamps, page refs, the quiet half of a row. */
  meta: "#8A7D5F",
  bad: "#9B2C2C",
} as const;

/** Font family names as registered with expo-font in app/_layout.tsx. */
export const font = {
  serif: "SourceSerif",
  serifBold: "SourceSerifBold",
  sans: "PublicSans",
  sansMedium: "PublicSansMedium",
  sansBold: "PublicSansBold",
  mono: "IBMPlexMono",
} as const;

export const type = {
  title: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, color: color.midnight },
  heading: { fontFamily: font.serifBold, fontSize: 18, lineHeight: 24, color: color.midnight },
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 22, color: color.midnight },
  bodyMuted: { fontFamily: font.sans, fontSize: 15, lineHeight: 22, color: color.bodyMuted },
  small: { fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: color.bodyMuted },
  /** Uppercase section labels and sync status, per the style guide's 0.12–0.2em tracking. */
  label: { fontFamily: font.mono, fontSize: 11, lineHeight: 16, letterSpacing: 1.3, color: color.meta },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { card: 6, button: 4 } as const;

/** The smallest thing a thumb should have to hit. */
export const TOUCH_TARGET = 44;

export const card = {
  backgroundColor: color.notepaper,
  borderColor: color.border,
  borderWidth: 1,
  borderRadius: radius.card,
  padding: space.lg,
} as const;

/** Nothing heavier than this — the style guide's one shadow. */
export const shadow = {
  shadowColor: "#1E2A44",
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
