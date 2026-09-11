import Link from "next/link";
import { LOGO } from "./logo-geometry";
import "./hero-build.css";

/**
 * The top of the public site. The logo builds itself in the middle of the scene — the emblem
 * irises in, the wordmark wipes across, the tagline rises — and then becomes the machine: a
 * handwritten page lifts off the tablet on the left, is drawn into the emblem, the compass
 * points tick a quarter turn, and a finished page drops onto the pile on the right. Four
 * conversions to a loop. The headline and call to action sit in a full-width box underneath.
 *
 * The emblem arrives as two images: a disc with its compass points erased, which never moves,
 * and the points on their own, which are what turns. Nothing else may rotate — the ring is
 * shaded from one side, and the artwork's own points are not square to it — so the split is
 * what makes every stop of the dial look exactly like the logo.
 *
 * Pure CSS keyframes over inline SVG, no JavaScript, and a complete still frame under
 * prefers-reduced-motion. The artwork, and the geometry that lines the three logo parts up the
 * way the original lockup has them, come from design/design_handoff_hero_animation via
 * `python scripts/hero-logo-slices.py`.
 */

/** The scene, in viewBox units. The logo's ring centre anchors everything else. */
const W = 1060;
const H = 535;
const CX = 530;
const CY = 195;
/** Radius of the emblem's navy ring — the unit the whole lockup is measured in. */
const R = 128;

const at = (dx: number, dy: number) => ({ x: CX + dx * R, y: CY + dy * R });
const emblem = { ...at(LOGO.emblem.dx, LOGO.emblem.dy), size: LOGO.emblem.size * R };
const wordmark = { ...at(LOGO.wordmark.x, LOGO.wordmark.y), w: LOGO.wordmark.w * R, h: LOGO.wordmark.h * R };
const tagline = { ...at(LOGO.tagline.x, LOGO.tagline.y), w: LOGO.tagline.w * R, h: LOGO.tagline.h * R };

const TABLET = { x: 40, y: 65, w: 200, h: 260 };
const PAGE = { x: 52, y: 80, w: 176, h: 230 };
const PILE = { x: 890, y: 315 };
const CARD = { w: 140, h: 180 };
/** Top-left of each output page, and the tilt it settles at. */
const DOCS = [
  { x: 820, y: 120, r: -6 },
  { x: 832, y: 112, r: 4 },
  { x: 824, y: 104, r: -3 },
  { x: 838, y: 96, r: 6 },
] as const;

/** Every page flies out of the middle of the emblem, so its start is its own offset from it. */
function docStyle(i: number): React.CSSProperties {
  const d = DOCS[i]!;
  return {
    "--sx": `${CX - (d.x + CARD.w / 2)}px`,
    "--sy": `${CY - (d.y + CARD.h / 2)}px`,
    "--r": `${d.r}deg`,
    animation: `dmDoc${i} 24s cubic-bezier(0.3, 0.7, 0.3, 1) var(--loop) infinite both`,
  } as React.CSSProperties;
}

/** The written page travels the other way, from the tablet into the middle of the emblem. */
const pageStyle = {
  "--px": `${CX - (PAGE.x + PAGE.w / 2)}px`,
  "--py": `${CY - (PAGE.y + PAGE.h / 2)}px`,
} as React.CSSProperties;

export function HeroBuild() {
  return (
    <header id="top" className="hb">
      <div className="hb-inner">
        <div className="hb-scene">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="You write on your reMarkable tablet; overnight dayMarkable reads the page and hands back Tomorrow, Actions, Notes and Calendar pages."
          >
            <defs>
              <radialGradient id="hbCore">
                <stop offset="0%" stopColor="#c9973f" stopOpacity="0.55" />
                <stop offset="55%" stopColor="#c9973f" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#c9973f" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* DAYTIME — the tablet you write on */}
            <g className="hb-tablet">
              <rect x={TABLET.x} y={TABLET.y} width={TABLET.w} height={TABLET.h} rx="14" fill="#fbfbf9" stroke="#1e2a44" strokeWidth="4" />
              <text x={TABLET.x + 22} y={TABLET.y + 26} style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "8px" }} fill="#9a9a9a">
                MEETING-NOTES · p.6
              </text>
              <g transform={`translate(${TABLET.x} ${TABLET.y})`} fill="none" stroke="#1a1a1a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path pathLength="1" style={{ strokeDasharray: "1", animation: "dmInk1 6s linear var(--loop) infinite both" }} d="M 22 70 C 40 60 52 78 72 68 C 90 60 104 76 124 67 C 140 60 152 70 168 66" />
                <path pathLength="1" style={{ strokeDasharray: "1", animation: "dmInk2 6s linear var(--loop) infinite both" }} d="M 22 105 L 36 105 M 46 101 C 64 93 78 109 100 100 C 118 92 134 107 156 99 C 164 96 170 100 176 98" />
                <path pathLength="1" style={{ strokeDasharray: "1", animation: "dmInk3 6s linear var(--loop) infinite both" }} d="M 22 140 C 42 130 56 148 78 138 C 96 130 110 146 130 137 C 144 132 152 138 162 135" />
                <path pathLength="1" style={{ strokeDasharray: "1", animation: "dmInk4 6s linear var(--loop) infinite both" }} d="M 22 175 L 36 175 M 46 171 C 62 163 74 179 96 170 C 114 162 130 177 150 169" />
                <path pathLength="1" style={{ strokeDasharray: "1", animation: "dmInk5 6s linear var(--loop) infinite both" }} d="M 22 210 C 36 202 46 216 62 208 C 78 200 92 214 110 206 M 128 208 C 142 200 154 214 172 206" />
                <g className="hb-pen" style={{ animation: "dmPen 6s linear var(--loop) infinite both" }}>
                  <line x1="0" y1="0" x2="26" y2="-66" stroke="#1e2a44" strokeWidth="7" />
                  <line x1="26" y1="-66" x2="31" y2="-80" stroke="#1e2a44" strokeWidth="4" />
                  <line x1="0" y1="0" x2="3" y2="-9" stroke="#c9973f" strokeWidth="3" />
                </g>
              </g>

              {/* the finished page, lifting off toward the emblem */}
              <g className="hb-page" style={pageStyle}>
                <rect x={PAGE.x} y={PAGE.y} width={PAGE.w} height={PAGE.h} rx="4" fill="#fbfbf9" stroke="#c9c4b6" strokeWidth="1" />
                <g transform={`translate(${TABLET.x} ${TABLET.y})`} fill="none" stroke="#1a1a1a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path pathLength="1" d="M 22 70 C 40 60 52 78 72 68 C 90 60 104 76 124 67 C 140 60 152 70 168 66" />
                <path pathLength="1" d="M 22 105 L 36 105 M 46 101 C 64 93 78 109 100 100 C 118 92 134 107 156 99 C 164 96 170 100 176 98" />
                <path pathLength="1" d="M 22 140 C 42 130 56 148 78 138 C 96 130 110 146 130 137 C 144 132 152 138 162 135" />
                <path pathLength="1" d="M 22 175 L 36 175 M 46 171 C 62 163 74 179 96 170 C 114 162 130 177 150 169" />
                <path pathLength="1" d="M 22 210 C 36 202 46 216 62 208 C 78 200 92 214 110 206 M 128 208 C 142 200 154 214 172 206" />
                </g>
              </g>
            </g>

            {/* OVERNIGHT — the logo, which is also the machine that reads the page */}
            <g className="hb-logo">
              <g className="hb-mark">
                <image href="/brand/emblem-base.webp" x={emblem.x} y={emblem.y} width={emblem.size} height={emblem.size} />
                <g className="hb-wheel" style={{ transformBox: "view-box", transformOrigin: `${CX}px ${CY}px`, animation: "dmTick 24s cubic-bezier(0.3, 0, 0.2, 1) var(--loop) infinite both" }}>
                  <image href="/brand/emblem-points.webp" x={emblem.x} y={emblem.y} width={emblem.size} height={emblem.size} />
                </g>
                <circle className="hb-core" cx={CX} cy={CY} r={R * 0.62} fill="url(#hbCore)" style={{ animation: "dmCore 6s ease-in-out var(--loop) infinite both" }} />
              </g>
              <image className="hb-word" href="/brand/lockup-wordmark.webp" x={wordmark.x} y={wordmark.y} width={wordmark.w} height={wordmark.h} />
              <image className="hb-tag" href="/brand/lockup-tagline.webp" x={tagline.x} y={tagline.y} width={tagline.w} height={tagline.h} />
            </g>

            {/* MORNING — the pages it hands back */}
            <ellipse className="hb-shadow" cx={PILE.x} cy={PILE.y} rx="96" ry="8" fill="#1e2a44" opacity="0.08" />
            <g transform={`translate(${DOCS[0].x} ${DOCS[0].y})`}>
              <g style={docStyle(0)}><rect width="140" height="180" rx="6" fill="#fbfbf9" stroke="#1e2a44" strokeWidth="1.5"></rect><text x="12" y="24" style={{ fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "14px" }} fill="#1a1a1a">Tomorrow</text><line x1="12" y1="32" x2="128" y2="32" stroke="#1a1a1a" strokeWidth="1.5"></line><text x="128" y="24" textAnchor="end" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "6px" }} fill="#6e6e6e">dayMarkable</text><rect x="12" y="48" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="53" x2="118" y2="53" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><rect x="12" y="66" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="71" x2="118" y2="71" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><rect x="12" y="84" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="89" x2="118" y2="89" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><text x="12" y="116" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "6.5px" }} fill="#6e6e6e">SCHEDULE</text><rect x="12" y="124" width="82" height="13" rx="2" fill="#1a1a1a"></rect><rect x="12" y="144" width="60" height="13" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.2"></rect><line x1="12" y1="170" x2="128" y2="170" stroke="#d8d4c8"></line></g>
            </g>
            <g transform={`translate(${DOCS[1].x} ${DOCS[1].y})`}>
              <g style={docStyle(1)}><rect width="140" height="180" rx="6" fill="#fbfbf9" stroke="#1e2a44" strokeWidth="1.5"></rect><text x="12" y="24" style={{ fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "14px" }} fill="#1a1a1a">Actions</text><line x1="12" y1="32" x2="128" y2="32" stroke="#1a1a1a" strokeWidth="1.5"></line><text x="128" y="24" textAnchor="end" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "6px" }} fill="#6e6e6e">dayMarkable</text><rect x="12" y="46" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><path d="M 14 51 L 17 54 L 21 48" fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round"></path><line x1="30" y1="51" x2="96" y2="51" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.45"></line><rect x="12" y="66" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><path d="M 14 71 L 17 74 L 21 68" fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round"></path><line x1="30" y1="71" x2="96" y2="71" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.45"></line><rect x="12" y="86" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="91" x2="118" y2="91" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><rect x="12" y="106" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="111" x2="118" y2="111" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><rect x="12" y="126" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="131" x2="118" y2="131" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line><rect x="12" y="146" width="10" height="10" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1.5"></rect><line x1="30" y1="151" x2="118" y2="151" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.85"></line></g>
            </g>
            <g transform={`translate(${DOCS[2].x} ${DOCS[2].y})`}>
              <g style={docStyle(2)}><rect width="140" height="180" rx="6" fill="#fbfbf9" stroke="#1e2a44" strokeWidth="1.5"></rect><text x="12" y="24" style={{ fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "14px" }} fill="#1a1a1a">Notes</text><line x1="12" y1="32" x2="128" y2="32" stroke="#1a1a1a" strokeWidth="1.5"></line><text x="128" y="24" textAnchor="end" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "6px" }} fill="#6e6e6e">dayMarkable</text><line x1="12" y1="46" x2="118" y2="46" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="60" x2="104" y2="60" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="74" x2="122" y2="74" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="88" x2="90" y2="88" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="102" x2="112" y2="102" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="116" x2="124" y2="116" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="130" x2="86" y2="130" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="144" x2="108" y2="144" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><line x1="12" y1="158" x2="70" y2="158" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" opacity="0.7"></line><rect x="8" y="82" width="2.5" height="24" fill="#c9973f"></rect></g>
            </g>
            <g transform={`translate(${DOCS[3].x} ${DOCS[3].y})`}>
              <g style={docStyle(3)}><rect width="140" height="180" rx="6" fill="#fbfbf9" stroke="#1e2a44" strokeWidth="1.5"></rect><text x="12" y="24" style={{ fontFamily: "var(--font-display)", fontWeight: "700", fontSize: "14px" }} fill="#1a1a1a">Calendar</text><line x1="12" y1="32" x2="128" y2="32" stroke="#1a1a1a" strokeWidth="1.5"></line><text x="128" y="24" textAnchor="end" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "6px" }} fill="#6e6e6e">dayMarkable</text><rect x="12" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="29" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="46" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="63" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="80" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="97" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="114" y="44" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="12" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="29" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="46" y="66" width="15" height="19" rx="2" fill="#1a1a1a" stroke="#1a1a1a" strokeWidth="1" opacity="1"></rect><rect x="63" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="80" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="97" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="114" y="66" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="12" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="29" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="46" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="63" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="80" y="88" width="15" height="19" rx="2" fill="#c9973f" stroke="#1a1a1a" strokeWidth="1" opacity="1"></rect><rect x="97" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="114" y="88" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="12" y="110" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="29" y="110" width="15" height="19" rx="2" fill="#1a1a1a" stroke="#1a1a1a" strokeWidth="1" opacity="1"></rect><rect x="46" y="110" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="63" y="110" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="80" y="110" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="97" y="110" width="15" height="19" rx="2" fill="#1a1a1a" stroke="#1a1a1a" strokeWidth="1" opacity="1"></rect><rect x="114" y="110" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="12" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="29" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="46" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="63" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="80" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="97" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect><rect x="114" y="132" width="15" height="19" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.55"></rect></g>
            </g>

            <g className="hb-caps" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.14em", fontSize: "16px" }}>
              <text x={TABLET.x + TABLET.w / 2} y={H - 30} textAnchor="middle" fill="#8a7d5f">DAYTIME · YOU WRITE</text>
              <text x={CX} y={H - 30} textAnchor="middle" fill="#b8862f">OVERNIGHT · WE READ</text>
              <text x={PILE.x} y={H - 30} textAnchor="middle" fill="#8a7d5f">MORNING · YOUR PAGES</text>
            </g>
          </svg>
        </div>

        <div className="hb-box">
          <h1 className="hb-h1">Write it down today. Wake up to a plan.</h1>
          <p className="hb-p">dayMarkable reads the notebooks on your reMarkable overnight and hands back your day by morning: action items, meeting notes, and a schedule, loaded onto your tablet and, if you like, sent to your inbox.</p>
          <div className="hb-cta">
            <Link href="/start" className="hb-btn">Start free — 14 days</Link>
            <a href="#how" className="hb-link">See how it works →</a>
          </div>
          <div className="hb-foot">NO APP TO LEARN · YOUR PEN, YOUR PAPER, YOUR HANDWRITING</div>
        </div>
      </div>
    </header>
  );
}
