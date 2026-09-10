"""Regenerate apps/web/src/components/hero/HeroBuild.tsx and the lockup slices from the Claude Design
handoff in design/design_handoff_hero_animation. Run after the handoff changes:

    python scripts/hero-build-gen.py
"""
import re, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(f"{ROOT}/design/design_handoff_hero_animation/hero.html", encoding="utf-8").read()
OUT = f"{ROOT}/apps/web/src/components/hero/HeroBuild.tsx"

# ---- lockup slices (emblem 0-640, wordmark 640-830, tagline 830-960 of 1536x1024)
lock = Image.open(f"{ROOT}/design/design_handoff_hero_animation/assets/logo-lockup.png").convert("RGB")
bg = lock.getpixel((10, 10))
print("lockup background", "#%02x%02x%02x" % bg)
for name, (y0, y1) in {"emblem": (0, 640), "wordmark": (640, 830), "tagline": (830, 960)}.items():
    lock.crop((0, y0, 1536, y1)).save(f"{ROOT}/apps/web/public/brand/lockup-{name}.webp", quality=92, method=6)

# ---- SVG → JSX
svg = SRC[SRC.index("<svg"): SRC.index("</svg>") + len("</svg>")]
ATTR = {"stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin", "clip-path": "clipPath", "clip-rule": "clipRule", "text-anchor": "textAnchor", "stroke-dasharray": "strokeDasharray"}
for k, v in ATTR.items():
    svg = svg.replace(f" {k}=", f" {v}=")
svg = svg.replace('href="assets/emblem.png"', 'href="/brand/emblem.png"')

def camel(p: str) -> str:
    return re.sub(r"-([a-z])", lambda m: m.group(1).upper(), p)

FONTS = {"'IBM Plex Mono', monospace": "var(--font-mono)", "'Source Serif 4', serif": "var(--font-display)"}

def style_obj(m: re.Match) -> str:
    decls = [d.strip() for d in m.group(1).split(";") if d.strip()]
    parts = []
    custom = False
    for d in decls:
        prop, val = [x.strip() for x in d.split(":", 1)]
        for a, b in FONTS.items():
            val = val.replace(a, b)
        if prop.startswith("--"):
            custom = True
            parts.append(f'"{prop}": "{val}"')
        else:
            parts.append(f'{camel(prop)}: "{val}"')
    body = "{ " + ", ".join(parts) + " }"
    return "style={" + body + (" as React.CSSProperties" if custom else "") + "}"

svg = re.sub(r'style="([^"]*)"', style_obj, svg)
svg = re.sub(r"<!-- (.*?) -->", r"{/*  */}", svg)
svg = svg.replace('<g style={{ animation: "dmPen 6s linear infinite" }}>', '<g className="hb-pen" style={{ animation: "dmPen 6s linear infinite" }}>')
svg = svg.replace('<circle cx="560" cy="230" r="34" fill="#c9973f" style=', '<circle className="hb-core" cx="560" cy="230" r="34" fill="#c9973f" style=')
svg = svg.replace('width="100%" style=', 'width="100%" style=')  # no-op; keep width attr
# indent
svg_lines = ["      " + l for l in svg.splitlines()]
svg_jsx = "\n".join(svg_lines)

tsx = f'''import Link from "next/link";
import "./hero-build.css";

/**
 * The top of the public site, from design/design_handoff_hero_animation/hero.html: the logo lockup
 * builds itself (emblem irises in, wordmark wipes, tagline rises) beside the product
 * description, then a looping scene shows a handwritten page leaving the tablet, entering the
 * compass "machine", and coming back as Tomorrow / Actions / Notes / Calendar pages on a pile.
 * Pure CSS keyframes on inline SVG; no JavaScript. The SVG below is generated verbatim from the
 * handoff (scripts/hero-build-gen.py); edit the handoff and regenerate rather than
 * hand-tuning coordinates here.
 */
export function HeroBuild() {{
  return (
    <header id="top" className="hb">
      <div className="hb-inner">
        <div className="hb-row">
          <div className="hb-logo" aria-label="dayMarkable — Your notes. Your next move." role="img">
            <div className="hb-emblem" />
            <div className="hb-word" />
            <div className="hb-tag" />
          </div>
          <div className="hb-text">
            <div className="hb-kicker">NOTE TO ACTION ORGANIZER · FOR reMARKABLE</div>
            <h1 className="hb-h1">Write it down today. Wake up to a plan.</h1>
            <p className="hb-p">dayMarkable reads the notebooks on your reMarkable overnight and hands back your day by morning: action items, meeting notes, and a schedule, loaded onto your tablet and, if you like, sent to your inbox.</p>
            <div className="hb-cta">
              <Link href="/start" className="hb-btn">Start free — 14 days</Link>
              <a href="#how" className="hb-link">See how it works →</a>
            </div>
            <div className="hb-foot">NO APP TO LEARN · YOUR PEN, YOUR PAPER, YOUR HANDWRITING</div>
          </div>
        </div>
        <div className="hb-scene">
{svg_jsx}
        </div>
      </div>
    </header>
  );
}}
'''
open(OUT, "w", encoding="utf-8").write(tsx)
print("wrote", OUT, len(tsx))

