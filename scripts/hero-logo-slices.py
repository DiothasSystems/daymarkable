"""Cut the dayMarkable lockup into hero animation assets and measure its geometry.

The landing hero (apps/web/src/components/hero/HeroBuild.tsx) builds the logo in the middle of
the scene and then uses its emblem as the machine that converts pages. To do that the emblem is
drawn from the standalone transparent file, so its outer ring can be clipped off and spun on its
own, while the wordmark and tagline come from the lockup artwork — and all three have to line up
exactly the way the original lockup has them.

Everything is measured from the emblem's navy ring, which is a true circle in both files. Its
centre and radius come from a least-squares circle fit rather than a bounding box, because the
ring runs off the left and bottom edges of emblem.png and a bounding box would be skewed.

Writes:

    apps/web/public/brand/emblem.webp              the emblem, transparent, for the machine
    apps/web/public/brand/lockup-wordmark.webp     "dayMarkable" + rule, transparent, tight crop
    apps/web/public/brand/lockup-tagline.webp      the tagline, same
    apps/web/src/components/hero/logo-geometry.ts  placement, in multiples of the ring radius

Run after the artwork in design/design_handoff_hero_animation/assets changes:

    python scripts/hero-logo-slices.py
"""

import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "design", "design_handoff_hero_animation", "assets")
BRAND = os.path.join(ROOT, "apps", "web", "public", "brand")
TS = os.path.join(ROOT, "apps", "web", "src", "components", "hero", "logo-geometry.ts")

# Where the handoff's emblem clips fall, as multiples of the ring radius. The static inner copy
# ends and the spinning outer copy begins inside the uniform navy ring (0.96–1.00), so the seam
# is invisible and what visibly sweeps is the four gold compass points (1.00–1.13).
WHEEL_INNER = 0.975
WHEEL_OUTER = 1.30


def fit_ring(mask: np.ndarray, rows: int) -> tuple[float, float, float]:
    """Least-squares circle through the outer boundary of `mask`, ignoring points on an edge."""
    h, w = mask.shape
    pts: list[tuple[int, int]] = []
    for y in range(min(rows, h)):
        xs = np.where(mask[y])[0]
        if xs.size < 2:
            continue
        if xs.min() > 1:
            pts.append((int(xs.min()), y))
        if xs.max() < w - 2:
            pts.append((int(xs.max()), y))
    p = np.array(pts, float)
    x, y = p[:, 0], p[:, 1]
    a, b, c = np.linalg.lstsq(np.c_[x, y, np.ones(len(p))], x**2 + y**2, rcond=None)[0]
    cx, cy = a / 2, b / 2
    r = float(np.sqrt(c + cx**2 + cy**2))
    worst = float(np.percentile(np.abs(np.hypot(x - cx, y - cy) - r), 95))
    assert worst < 6, f"ring fit is poor (95th percentile residual {worst:.1f}px)"
    return float(cx), float(cy), r


# ---------------------------------------------------------------- the lockup
lock = Image.open(os.path.join(ART, "logo-lockup.png")).convert("RGB")
LW, LH = lock.size
px = np.array(lock).astype(np.int16)
bg = px[4, 4].copy()
ink = np.abs(px - bg).sum(-1) > 30
dark = ink & (px.mean(-1) < 110)

# The wordmark sits close under the emblem, so fit the ring on the upper part of the image only.
lcx, lcy, lr = fit_ring(dark, int(LH * 0.625))
print(f"lockup {LW}x{LH}  bg #{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}  ring ({lcx:.1f}, {lcy:.1f}) r {lr:.1f}")

# Blocks below the emblem, found by the blank rows between them rather than fixed offsets.
rows = ink.sum(1)
blocks: list[tuple[int, int]] = []
y = int(lcy + lr) + 4
while y < LH:
    if rows[y] > 0:
        y0, gap = y, 0
        while y < LH and gap < 12:
            y += 1
            gap = gap + 1 if y < LH and rows[y] == 0 else 0
        blocks.append((y0, y - gap))
    y += 1
print("blocks below the emblem:", blocks)
assert len(blocks) >= 2, "expected a wordmark block and a tagline block"


def cut(y0: int, y1: int, name: str, quality: int) -> tuple[float, float, float, float]:
    """Crop rows y0..y1 tight, key the background out, save, return the box in lockup pixels."""
    sub = ink[y0:y1]
    cols, rws = np.where(sub.any(0))[0], np.where(sub.any(1))[0]
    x0, x1 = int(cols.min()), int(cols.max()) + 1
    ty0, ty1 = y0 + int(rws.min()), y0 + int(rws.max()) + 1
    crop = px[ty0:ty1, x0:x1].astype(np.float32)
    a = np.clip(np.abs(crop - bg).sum(-1) / 60.0, 0, 1)
    # Un-premultiply so the edges stay clean on any background, not just the lockup's own.
    rgb = np.clip(bg + (crop - bg) / np.maximum(a, 0.02)[..., None], 0, 255)
    out = np.dstack([np.where(a[..., None] > 0.02, rgb, crop), a * 255]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(os.path.join(BRAND, f"{name}.webp"), quality=quality, method=6)
    return (x0, ty0, x1 - x0, ty1 - ty0)


word = cut(blocks[0][0], blocks[0][1], "lockup-wordmark", 78)
tag = cut(blocks[1][0], blocks[-1][1], "lockup-tagline", 86)
print("wordmark box", word, "\ntagline box ", tag)

# ---------------------------------------------------------------- the emblem
emb = Image.open(os.path.join(ART, "emblem.png")).convert("RGBA")
ES = emb.size[0]
ea = np.array(emb).astype(np.int16)
ecx, ecy, er = fit_ring((ea[..., 3] > 200) & (ea[..., :3].mean(-1) < 110), ES)
print(f"emblem {emb.size}  ring ({ecx:.1f}, {ecy:.1f}) r {er:.1f}")
emb.save(os.path.join(BRAND, "emblem.webp"), quality=88, method=6)

# ---------------------------------------------------------------- geometry
u = lambda v: round(float(v), 4)
rel = lambda b: f"{{ x: {u((b[0] - lcx) / lr)}, y: {u((b[1] - lcy) / lr)}, w: {u(b[2] / lr)}, h: {u(b[3] / lr)} }}"

with open(TS, "w", encoding="utf-8") as f:
    f.write(f"""// Generated by scripts/hero-logo-slices.py — do not edit.
// Lockup geometry in multiples of the emblem's navy ring radius, measured from the ring centre.
// Place the ring and the wordmark and tagline land exactly where the original lockup has them.
export const LOGO = {{
  /** The emblem file is this many ring radii wide, drawn at this offset from the ring centre. */
  emblem: {{ size: {u(ES / er)}, dx: {u(-ecx / er)}, dy: {u(-ecy / er)} }},
  wordmark: {rel(word)},
  tagline: {rel(tag)},
  /** The spinning copy is clipped to this band; the static copy ends at its inner edge. */
  wheel: {{ inner: {WHEEL_INNER}, outer: {WHEEL_OUTER} }},
}} as const;
""")
print("wrote", TS)
for n in ("emblem.webp", "lockup-wordmark.webp", "lockup-tagline.webp"):
    print(f"  {n}: {os.path.getsize(os.path.join(BRAND, n)):,} bytes")
