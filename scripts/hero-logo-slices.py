"""Cut the ScriptumIQ lockup into the site's brand assets and measure its geometry.

The landing hero (apps/web/src/components/hero/HeroBuild.tsx) builds the logo in the middle of
the scene and then uses its emblem as the machine that converts pages: its compass points are cut
out and turned on their own. All the parts are cut from the one lockup, so they line up exactly the
way the lockup has them. The static brand images the rest of the site uses come out of the same
cut, so the emblem in the header and the one in the hero are the same pixels.

Everything is measured from the emblem's navy rim, which is a true circle. Its centre and radius
come from a least-squares fit to the rim's outer edge rather than a bounding box, because the
compass points stick out past it and the wordmark sits right under it.

THE POINTS ARE CUT BY SHAPE, NOT BY COLOUR. dayMarkable's points sat just outside the ring's own
gold, so "how gold is this pixel" separated them. ScriptumIQ's do not: each is a diamond whose
corners sit on the ring's gold band and whose inner tip reaches across the bands into the face,
and on the east side the face itself is gold. A colour key there would lift arcs of the band and
half the sunrise along with the points, and they would swing round visibly on every tick. So each
point is traced where its edge DOES contrast — against the page outside the ring, and against the
navy band inside it — and the two pairs of edge lines are extended to meet, which gives the
diamond's true outline straight through the region where colour cannot see it.

Writes (all under apps/web/public/brand/ unless noted):

    emblem-base.webp        the disc, with its four points erased — never moves
    emblem-points.webp      the four points alone — the layer that turns
    lockup-wordmark.webp    "ScriptumIQ" and its rule, transparent, emblem pixels excluded
    lockup-tagline.webp     the tagline, transparent
    emblem.png, emblem-96.png, emblem-256.png, emblem-512.png
                            the emblem at rest, transparent (Brand.tsx, the marketing pages)
    full-lockup.png         the whole lockup, transparent
    full-lockup-1200.jpg    the social preview (OpenGraph), 1200x630 on Parchment
    apps/web/src/components/hero/logo-geometry.ts
                            placement, in multiples of the ring radius

Run after the artwork in design/brand_scriptumiq/ changes:

    python scripts/hero-logo-slices.py

`BRAND_OUT` and `GEOMETRY_OUT` redirect the output, for trying a change without touching the site.
"""

import os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "design", "brand_scriptumiq", "lockup-stacked.png")
BRAND = os.environ.get("BRAND_OUT") or os.path.join(ROOT, "apps", "web", "public", "brand")
TS = os.environ.get("GEOMETRY_OUT") or os.path.join(ROOT, "apps", "web", "src", "components", "hero", "logo-geometry.ts")
os.makedirs(BRAND, exist_ok=True)

PARCHMENT = (0xF7, 0xF0, 0xE3)

# The emblem square is this many ring radii either side of the centre: past the points' tips
# (measured at about 1.075) and no further. Its side is odd so the ring centre is a pixel, which
# lets a point be turned into the other three places by whole right angles, with no resampling.
HALF = 1.10
# Radial ranges, in ring radii, where a point's edge can be seen against something that is not
# gold: outside the ring (the page and the navy rim), and inside it (the navy band). Between them
# lies the ring's gold band, where it cannot — that stretch is what the fitted lines are for.
OUTER_CLEAN = (0.962, 1.060)
INNER_CLEAN = (0.866, 0.906)
# Grow each original point this far (px) before erasing it from the disc. It has to cover more than
# the gold: the painted corners run a touch past the fitted ones, and each point throws a small dark
# shadow onto the face below its inner tip; at 3px both survived as a gold nick on the band and a
# dark V that stayed behind while the point turned. Shrink the copied point this far so it carries
# none of what it sat on.
ERASE_GROW = 6.0
POINT_TRIM = 0.7
# Summed RGB distance from the page below which a pixel is page, not ink (see cut()).
KEY_FLOOR = 10.0


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
lock = Image.open(ART).convert("RGB")
LW, LH = lock.size
px = np.array(lock).astype(np.int16)
bg = px[4, 4].copy()
ink = np.abs(px - bg).sum(-1) > 30
dark = ink & (px.mean(-1) < 110)

# The wordmark sits close under the emblem; above 0.6 of the height is emblem only (at 0.65 the
# fit starts taking in the wordmark and fails its own residual check).
lcx, lcy, lr = fit_ring(dark, int(LH * 0.6))
print(f"lockup {LW}x{LH}  bg #{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}  ring ({lcx:.1f}, {lcy:.1f}) r {lr:.1f}")


def is_gold(p: np.ndarray) -> np.ndarray:
    return (p[..., 0] - p[..., 2] > 40) & (p[..., 0] > 120)


# ---------------------------------------------------------------- the points, traced
def trace_edges(axis_deg: float, lo: float, hi: float) -> list[tuple[float, int, int]]:
    """Along the point's axis, the gold run that contains it, measured across the axis."""
    t = np.radians(axis_deg)
    ux, uy, vx, vy = np.cos(t), np.sin(t), -np.sin(t), np.cos(t)
    rows = []
    for s in np.arange(lo * lr, hi * lr, 0.5):
        def g(w: int) -> bool:
            x, y = lcx + s * ux + w * vx, lcy + s * uy + w * vy
            return bool(is_gold(px[int(round(y)), int(round(x))]))
        if not g(0):
            continue
        l = 0
        while l > -60 and g(l - 1):
            l -= 1
        r = 0
        while r < 60 and g(r + 1):
            r += 1
        rows.append((s, l, r))
    return rows


def line(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """y = a + b x, least squares."""
    b, a = np.polyfit(xs, ys, 1)
    return float(a), float(b)


def meet(l1: tuple[float, float], l2: tuple[float, float]) -> tuple[float, float]:
    """Where w = a1 + b1 s meets w = a2 + b2 s, as (s, w)."""
    s = (l2[0] - l1[0]) / (l1[1] - l2[1])
    return s, l1[0] + l1[1] * s


def diamond(axis_deg: float, inner_from: float | None = None) -> dict:
    """The point on this axis as a quadrilateral: outer tip, two corners, inner tip.

    `inner_from`, when given, borrows the inner edges of another point's diamond (in its own axis
    frame) — for the east point, whose inner tip lies on the gold sunrise and cannot be traced.
    """
    outer = trace_edges(axis_deg, *OUTER_CLEAN)
    s_o = [r[0] for r in outer]
    left_o, right_o = line(s_o, [r[1] for r in outer]), line(s_o, [r[2] for r in outer])
    if inner_from is None:
        inner = trace_edges(axis_deg, *INNER_CLEAN)
        s_i = [r[0] for r in inner]
        left_i, right_i = line(s_i, [r[1] for r in inner]), line(s_i, [r[2] for r in inner])
    else:
        left_i, right_i = inner_from["left_i"], inner_from["right_i"]
    tip_o, tip_i = meet(left_o, right_o), meet(left_i, right_i)
    corner_l, corner_r = meet(left_o, left_i), meet(right_o, right_i)
    return {"axis": axis_deg, "left_i": left_i, "right_i": right_i,
            "quad_sw": [tip_o, corner_r, tip_i, corner_l]}


def to_xy(d: dict, cx: float, cy: float) -> list[tuple[float, float]]:
    """A diamond's corners in image pixels, around the given centre."""
    t = np.radians(d["axis"])
    ux, uy, vx, vy = np.cos(t), np.sin(t), -np.sin(t), np.cos(t)
    return [(cx + s * ux + w * vx, cy + s * uy + w * vy) for s, w in d["quad_sw"]]


# The artwork's points are not square to the ring: north and south sit on their axes, east and
# west ride about 1.7 degrees low. Each original is traced on its own axis so it is erased where it
# actually is.
north = diamond(270.0)
south = diamond(90.0)
west = diamond(178.3)
east = diamond(1.7, inner_from=north)
for name, d in (("north", north), ("south", south), ("east", east), ("west", west)):
    so, _ = d["quad_sw"][0]
    si, _ = d["quad_sw"][2]
    sc, wc = d["quad_sw"][1]
    print(f"  {name:5s} point: outer tip {so / lr:.3f}r  corners {sc / lr:.3f}r  inner tip {si / lr:.3f}r  "
          f"width {abs(d['quad_sw'][1][1] - d['quad_sw'][3][1]):.1f}px")


def polygon_mask(polys: list[list[tuple[float, float]]], size: tuple[int, int], grow: float) -> np.ndarray:
    """Anti-aliased coverage of the polygons, grown (or shrunk, if negative) by `grow` px."""
    ss = 4
    canvas = Image.new("L", (size[0] * ss, size[1] * ss), 0)
    draw = ImageDraw.Draw(canvas)
    for poly in polys:
        cxp = sum(p[0] for p in poly) / len(poly)
        cyp = sum(p[1] for p in poly) / len(poly)
        pts = []
        for x, y in poly:
            dx, dy = x - cxp, y - cyp
            d = float(np.hypot(dx, dy)) or 1.0
            k = (d + grow) / d
            pts.append(((cxp + dx * k) * ss, (cyp + dy * k) * ss))
        draw.polygon(pts, fill=255)
    return np.array(canvas.resize(size, Image.BOX), dtype=np.float32) / 255.0


# ---------------------------------------------------------------- the emblem square
k = int(round(HALF * lr))
size = 2 * k + 1
box = lock.transform((size, size), Image.AFFINE, (1, 0, lcx - k, 0, 1, lcy - k), resample=Image.BICUBIC)
bpx = np.array(box).astype(np.float32)
gy, gx = np.mgrid[0:size, 0:size]
er_ = np.hypot(gx - k, gy - k) / lr
eang = np.degrees(np.arctan2(gy - k, gx - k))


def sample(img: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Bilinear lookup, for reading the ring at an angle a little to the side of a point."""
    fx, fy = (sx - np.floor(sx))[..., None], (sy - np.floor(sy))[..., None]
    x0 = np.clip(np.floor(sx).astype(int), 0, size - 1)
    y0 = np.clip(np.floor(sy).astype(int), 0, size - 1)
    x1, y1 = np.clip(x0 + 1, 0, size - 1), np.clip(y0 + 1, 0, size - 1)
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy)
            + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


# The disc. Each original point is rubbed out by carrying the ring across it from either side: the
# bands are rotationally symmetric, so a band read a few degrees away is the band under the point.
# Only pixels inside the (grown) diamond are replaced; everything else is the artwork untouched.
#
# Two refinements, both learned from looking at a mid-tick frame. The ring is read over a short
# ARC rather than along one ray, because a tick mark lying on that ray would otherwise be copied
# across the whole patch. And at north and south the face's day/night seam runs straight down the
# axis, so there the two sides are joined with a clean step, as the artwork has them, rather than
# blended into a smear of dusk.
originals = [to_xy(d, k, k) for d in (north, south, east, west)]
erase = polygon_mask(originals, (size, size), ERASE_GROW)
SIDE = 7.0      # degrees either side of an axis where reading begins; wider than any grown point
FACE_EDGE = 0.89  # ring radii: inside this is the face (and its seam), outside it the bands
ARC = (0.0, 0.5, 1.0, 1.5, 2.0)  # and how far past that it reads, averaged
base_rgb = bpx.copy()
for d in (north, south, east, west):
    c = d["axis"]
    on_seam = d is north or d is south
    off = (eang - c + 180) % 360 - 180
    m = (erase > 0) & (np.abs(off) <= SIDE) & (er_ <= 1.004)
    ys, xs = np.where(m)
    rad = er_[m] * lr
    left = sum(sample(bpx, k + rad * np.cos(np.radians(c - SIDE - a)), k + rad * np.sin(np.radians(c - SIDE - a))) for a in ARC) / len(ARC)
    right = sum(sample(bpx, k + rad * np.cos(np.radians(c + SIDE + a)), k + rad * np.sin(np.radians(c + SIDE + a))) for a in ARC) / len(ARC)
    # The step only where the seam is — the face, inside the bands. The bands themselves are lit
    # from one side, so their left and right readings differ by a shade, and a step there draws a
    # hairline down the ring that the blend does not.
    linear = (off[m] + SIDE) / (2 * SIDE)
    t = np.where(on_seam & (er_[m] < FACE_EDGE), (off[m] > 0).astype(np.float32), linear)
    fill = left * (1 - t[..., None]) + right * t[..., None]
    wgt = erase[m][..., None]
    base_rgb[ys, xs] = fill * wgt + bpx[ys, xs] * (1 - wgt)

# Opaque out to the rim's edge and no further. The disc is never keyed against the page: the
# artwork inside it contains cream of its own that a key would eat. What lies just outside the rim
# is a warm drop shadow, which is dropped — it reads as a stain on a dark background.
base_a = np.clip((1.002 - er_) / 0.006, 0, 1)
base = np.dstack([base_rgb, base_a * 255]).astype(np.uint8)
Image.fromarray(base, "RGBA").save(os.path.join(BRAND, "emblem-base.webp"), quality=90, method=6)

# The points: the north one, cut by its shape (trimmed a hair so it carries none of what it sat
# on), then turned into the other three places by whole right angles. Every stop of the dial
# therefore shows four identical points square to the ring, which the artwork's own are not.
north_a = polygon_mask([to_xy(north, k, k)], (size, size), -POINT_TRIM)
rots_a = np.stack([np.rot90(north_a, q) for q in range(4)])
rots_rgb = np.stack([np.rot90(bpx, q, axes=(0, 1)) for q in range(4)])
pts_a = rots_a.max(0)
pts_rgb = np.take_along_axis(rots_rgb, rots_a.argmax(0)[None, ..., None], axis=0)[0]
points = np.dstack([pts_rgb, pts_a * 255]).astype(np.uint8)
Image.fromarray(points, "RGBA").save(os.path.join(BRAND, "emblem-points.webp"), quality=90, method=6)
print(f"emblem split into disc + points, {size}x{size} px, centred on the ring")

# The emblem at rest: the disc with the points laid over it.
emblem = Image.fromarray(base, "RGBA")
emblem.alpha_composite(Image.fromarray(points, "RGBA"))


def resized(img: Image.Image, side: int) -> Image.Image:
    """Resize with premultiplied alpha, so edges do not pick up a halo of the discarded colour."""
    return img.convert("RGBa").resize((side, side), Image.LANCZOS).convert("RGBA")


emblem.save(os.path.join(BRAND, "emblem.png"), optimize=True)
for side in (96, 256, 512):
    resized(emblem, side).save(os.path.join(BRAND, f"emblem-{side}.png"), optimize=True)

# ---------------------------------------------------------------- wordmark and tagline
# Pixels that belong to the emblem are excluded from both, in lockup coordinates: the disc and
# its shadow out to 1.06 radii, and each original point, grown. The south point hangs down level
# with the top of the wordmark; left in, a copy of it would sit still while the real one turns.
lgy, lgx = np.mgrid[0:LH, 0:LW]
not_emblem = np.hypot(lgx - lcx, lgy - lcy) > 1.06 * lr
not_emblem &= polygon_mask([to_xy(d, lcx, lcy) for d in (north, south, east, west)], (LW, LH), ERASE_GROW) <= 0
text_ink = ink & not_emblem

rows = text_ink.sum(1)
blocks: list[tuple[int, int]] = []
y = int(lcy + lr)
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


def cut(y0: int, y1: int, name: str | None, quality: int) -> tuple[tuple[int, int, int, int], np.ndarray]:
    """Crop rows y0..y1 tight, key the page out, save; return the box in lockup pixels and the RGBA."""
    sub = text_ink[y0:y1]
    cols, rws = np.where(sub.any(0))[0], np.where(sub.any(1))[0]
    x0, x1 = int(cols.min()), int(cols.max()) + 1
    ty0, ty1 = y0 + int(rws.min()), y0 + int(rws.max()) + 1
    crop = px[ty0:ty1, x0:x1].astype(np.float32)
    # The page is not perfectly flat: it wanders two or three levels per channel. Keyed from zero,
    # that noise becomes a haze of near-invisible alpha filling the whole crop — nothing on a light
    # background, and a visible box on a dark one. So the key starts above the noise.
    a = np.clip((np.abs(crop - bg).sum(-1) - KEY_FLOOR) / (60.0 - KEY_FLOOR), 0, 1) * not_emblem[ty0:ty1, x0:x1]
    # Un-premultiply so the edges stay clean on any background, not just the lockup's own.
    rgb = np.clip(bg + (crop - bg) / np.maximum(a, 0.02)[..., None], 0, 255)
    out = np.dstack([np.where(a[..., None] > 0.02, rgb, crop), a * 255]).astype(np.uint8)
    if name:
        Image.fromarray(out, "RGBA").save(os.path.join(BRAND, f"{name}.webp"), quality=quality, method=6)
    return (x0, ty0, x1 - x0, ty1 - ty0), out


word, word_img = cut(blocks[0][0], blocks[0][1], "lockup-wordmark", 82)
tag, tag_img = cut(blocks[1][0], blocks[-1][1], "lockup-tagline", 88)
print("wordmark box", word, "\ntagline box ", tag)

# ---------------------------------------------------------------- the whole lockup
# Re-assembled from the parts rather than keyed as one image, for the same reason the disc is never
# keyed: the emblem is full of cream of its own.
full = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
full.alpha_composite(emblem, (int(round(lcx)) - k, int(round(lcy)) - k))
full.alpha_composite(Image.fromarray(word_img, "RGBA"), (word[0], word[1]))
full.alpha_composite(Image.fromarray(tag_img, "RGBA"), (tag[0], tag[1]))
full = full.crop(full.getbbox())
full.save(os.path.join(BRAND, "full-lockup.png"), optimize=True)

# The social preview: the lockup on Parchment at the 1200x630 the big networks crop to.
OG_W, OG_H, PAD = 1200, 630, 44
scale = min((OG_W - 2 * PAD) / full.width, (OG_H - 2 * PAD) / full.height)
fit = full.convert("RGBa").resize((round(full.width * scale), round(full.height * scale)), Image.LANCZOS).convert("RGBA")
og = Image.new("RGBA", (OG_W, OG_H), PARCHMENT + (255,))
og.alpha_composite(fit, ((OG_W - fit.width) // 2, (OG_H - fit.height) // 2))
og.convert("RGB").save(os.path.join(BRAND, "full-lockup-1200.jpg"), quality=88, optimize=True, progressive=True)

# ---------------------------------------------------------------- geometry
u = lambda v: round(float(v), 4)
rel = lambda b: f"{{ x: {u((b[0] - lcx) / lr)}, y: {u((b[1] - lcy) / lr)}, w: {u(b[2] / lr)}, h: {u(b[3] / lr)} }}"

with open(TS, "w", encoding="utf-8", newline="\n") as f:
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
for n in ("emblem-base.webp", "emblem-points.webp", "lockup-wordmark.webp", "lockup-tagline.webp",
          "emblem.png", "emblem-96.png", "emblem-256.png", "emblem-512.png", "full-lockup.png", "full-lockup-1200.jpg"):
    print(f"  {n}: {os.path.getsize(os.path.join(BRAND, n)):,} bytes")
