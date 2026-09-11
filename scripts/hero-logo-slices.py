"""Cut the dayMarkable lockup into hero animation assets and measure its geometry.

The landing hero (apps/web/src/components/hero/HeroBuild.tsx) builds the logo in the middle of
the scene and then uses its emblem as the machine that converts pages: its outer band is clipped
off and spun on its own. All three parts are cut from the lockup artwork, so they line up exactly
the way the original lockup has them.

The emblem comes from the lockup rather than from assets/emblem.png because that file is cropped
off centre — it clips the west and south compass points harder than the east and north ones, so
the band did not match itself after a quarter turn. Here the crop is centred on the ring to a
fraction of a pixel, which is what makes every resting position of the wheel identical.

Everything is measured from the emblem's navy ring, which is a true circle in both files. Its
centre and radius come from a least-squares circle fit rather than a bounding box, because the
ring runs off the left and bottom edges of emblem.png and a bounding box would be skewed.

Writes:

    apps/web/public/brand/emblem-base.webp         the disc, with its compass points erased
    apps/web/public/brand/emblem-points.webp       the four points alone — the layer that turns
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

# The emblem is split into two layers: a disc with its compass points erased, which never moves,
# and the points on their own, which do. Nothing else can rotate — the ring is shaded from one
# side, so turning any part of it would land on a different picture after a quarter turn.
POINT_IN = 0.955   # where a point's own gold starts, just outside the ring's own gold band
WEDGE = 16.0       # degrees either side of a cardinal that a point occupies


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
# A square centred on the ring, wide enough for the compass points and no wider. The side is odd
# so the ring centre sits on the middle pixel, which lets a point be rotated into the other three
# places by whole right angles, with no resampling and no drift.
HALF = 1.10
k = int(round(HALF * lr))
size = 2 * k + 1
box = lock.transform((size, size), Image.AFFINE, (1, 0, lcx - k, 0, 1, lcy - k), resample=Image.BICUBIC)
bpx = np.array(box).astype(np.float32)
gy, gx = np.mgrid[0:size, 0:size]
er_ = np.hypot(gx - k, gy - k) / lr
eang = (np.degrees(np.arctan2(gy - k, gx - k)) + 360) % 360


def sample(img: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Bilinear lookup, for reading the ring at an angle a little to the side of a point."""
    fx, fy = (sx - np.floor(sx))[..., None], (sy - np.floor(sy))[..., None]
    x0 = np.clip(np.floor(sx).astype(int), 0, size - 1)
    y0 = np.clip(np.floor(sy).astype(int), 0, size - 1)
    x1, y1 = np.clip(x0 + 1, 0, size - 1), np.clip(y0 + 1, 0, size - 1)
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy)
            + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


# The artwork's four points are not quite square to the ring: north sits on its axis, east and
# west ride about 6.5px low. A point copied round by a quarter turn therefore never lands on the
# one it replaced, which is what put the dial a few pixels out at the sides. So the disc keeps
# everything except the points, which are rubbed out by blending the ring across each wedge from
# the two angles just outside it.
base_rgb = bpx.copy()
for c in (0, 90, 180, 270):
    d = (eang - c + 180) % 360 - 180
    m = (er_ >= POINT_IN - 0.012) & (er_ <= 1.004) & (np.abs(d) <= WEDGE)
    ys, xs = np.where(m)
    rad = er_[m] * lr
    left, right = np.radians(c - WEDGE - 3), np.radians(c + WEDGE + 3)
    t = ((d[m] + WEDGE) / (2 * WEDGE))[..., None]
    base_rgb[ys, xs] = (sample(bpx, k + rad * np.cos(left), k + rad * np.sin(left)) * (1 - t)
                        + sample(bpx, k + rad * np.cos(right), k + rad * np.sin(right)) * t)

# Opaque out to the ring's edge. The disc is never keyed against the background, because the
# artwork inside it contains cream of its own that a key would eat.
base_a = np.clip((1.002 - er_) / 0.006, 0, 1)
Image.fromarray(np.dstack([base_rgb, base_a * 255]).astype(np.uint8), "RGBA").save(
    os.path.join(BRAND, "emblem-base.webp"), quality=90, method=6)

# The points, all four of them the north one turned into place. Gold reads clearly against both
# the navy ring and the cream page, so red minus blue separates a point from whatever it lies on.
goldness = np.clip((bpx[..., 0] - bpx[..., 2] - 30) / 60.0, 0, 1)
north = (er_ >= POINT_IN) & (er_ <= HALF - 0.01) & (np.abs((eang - 270 + 180) % 360 - 180) <= WEDGE)
rots_a = np.stack([np.rot90(np.where(north, goldness, 0.0), q) for q in range(4)])
rots_rgb = np.stack([np.rot90(bpx, q, axes=(0, 1)) for q in range(4)])
pts_a = rots_a.max(0)
pts_rgb = np.take_along_axis(rots_rgb, rots_a.argmax(0)[None, ..., None], axis=0)[0]
Image.fromarray(np.dstack([pts_rgb, pts_a * 255]).astype(np.uint8), "RGBA").save(
    os.path.join(BRAND, "emblem-points.webp"), quality=90, method=6)
print(f"emblem split into disc + points, {size}x{size} px, centred on the ring")

# ---------------------------------------------------------------- geometry
u = lambda v: round(float(v), 4)
rel = lambda b: f"{{ x: {u((b[0] - lcx) / lr)}, y: {u((b[1] - lcy) / lr)}, w: {u(b[2] / lr)}, h: {u(b[3] / lr)} }}"

with open(TS, "w", encoding="utf-8") as f:
    f.write(f"""// Generated by scripts/hero-logo-slices.py — do not edit.
// Lockup geometry in multiples of the emblem's navy ring radius, measured from the ring centre.
// Place the ring and the wordmark and tagline land exactly where the original lockup has them.
export const LOGO = {{
  /** The emblem file is this many ring radii wide, drawn at this offset from the ring centre. */
  emblem: {{ size: {u(2 * HALF)}, dx: {-HALF}, dy: {-HALF} }},
  wordmark: {rel(word)},
  tagline: {rel(tag)},
}} as const;
""")
print("wrote", TS)
for n in ("emblem-base.webp", "emblem-points.webp", "lockup-wordmark.webp", "lockup-tagline.webp"):
    print(f"  {n}: {os.path.getsize(os.path.join(BRAND, n)):,} bytes")
