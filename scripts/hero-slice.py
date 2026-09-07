"""Slice design/design_handoff_daymarkable/assets/hero-scene.png into animation layers for the marketing hero.

Each element of the supplied artwork is cut out with a soft alpha mask and saved as its own
image; the background is inpainted where elements were removed so the scene can be built up
element by element and still end on the exact supplied composition.

    python scripts/hero-slice.py

Writes apps/web/public/hero/* and apps/web/src/components/hero/layers.ts.
"""
import json, os, sys
import numpy as np, cv2
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "design", "design_handoff_daymarkable", "assets", "hero-scene.png")
OUT = os.path.join(ROOT, "apps", "web", "public", "hero")
TS = os.path.join(ROOT, "apps", "web", "src", "components", "hero", "layers.ts")

src = Image.open(SRC).convert("RGB")
W, H = src.size
rgb = np.array(src).astype(np.float32)
lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

def blank(): return np.zeros((H, W), np.float32)
def rrect(x0, y0, x1, y1, r):
    im = Image.new("L", (W, H), 0); ImageDraw.Draw(im).rounded_rectangle((x0, y0, x1, y1), r, fill=255)
    return np.array(im).astype(np.float32) / 255
def rect(x0, y0, x1, y1): return rrect(x0, y0, x1, y1, 0)
def circle(cx, cy, r):
    im = Image.new("L", (W, H), 0); ImageDraw.Draw(im).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return np.array(im).astype(np.float32) / 255
def annulus(cx, cy, r0, r1): return np.clip(circle(cx, cy, r1) - circle(cx, cy, r0), 0, 1)
def key(lo, hi, l=None): return np.clip(((lum if l is None else l) - lo) / (hi - lo), 0, 1)
def feather(m, px): return cv2.GaussianBlur(m, (0, 0), px) if px else m
def union(*ms): return np.clip(np.maximum.reduce(ms), 0, 1)

# ---- element definitions: name, bbox (x0,y0,x1,y1), shape mask, optional luminance key, feather
L = []
def layer(name, bbox, shape, k=None, f=3): L.append(dict(name=name, bbox=bbox, shape=shape, key=k, f=f))

MX, MY = 480, 400  # mechanism centre
BX, BY = 478, 395  # brain centre
EX, EY = 285, 130  # emblem centre

# Environment items that stay in the background are not layers. The wordmark is re-set live in
# HTML (dayMarkable with a capital M) so it is only inpainted, never a layer.
WORDMARK = rect(392, 62, 930, 171)

# Emblem: ring + the four compass points.
layer("emblem", (190, 34, 380, 226), union(circle(EX, EY, 74), rect(276, 36, 294, 224), rect(192, 121, 378, 139)), None, 2.5)
layer("tagline", (426, 166, 900, 202), rect(428, 168, 898, 200), (70, 150), 2)

# Productivity icons (rounded tiles with their glow).
ICONS = {
    "icon_note": (55, 292, 145, 400),
    "icon_calendar": (187, 277, 260, 355),
    "icon_bulb_hi": (282, 332, 350, 405),
    "icon_bulb_mid": (195, 372, 260, 445),
    "icon_people": (107, 415, 195, 510),
    "icon_checklist": (235, 440, 305, 520),
    "icon_gear": (292, 407, 352, 470),
}
icon_mask = blank()
for n, (x0, y0, x1, y1) in ICONS.items():
    m = rrect(x0, y0, x1, y1, 14)
    icon_mask = union(icon_mask, m)
    layer(n, (x0 - 4, y0 - 4, x1 + 4, y1 + 4), m, None, 4)

# Light trails: the warm glow across the left half, with the icons inpainted out of it.
trail_rect = rect(30, 268, 400, 562)
trail_src = cv2.inpaint(cv2.cvtColor(np.array(src), cv2.COLOR_RGB2BGR), (cv2.dilate(icon_mask, np.ones((7, 7), np.uint8)) > 0.05).astype(np.uint8) * 255, 6, cv2.INPAINT_TELEA)
trail_rgb = cv2.cvtColor(trail_src, cv2.COLOR_BGR2RGB).astype(np.float32)
trail_lum = 0.299 * trail_rgb[..., 0] + 0.587 * trail_rgb[..., 1] + 0.114 * trail_rgb[..., 2]
trail_alpha = feather(trail_rect, 12) * key(25, 95, trail_lum)

# Mechanism.
layer("mech_pedestal", (362, 488, 606, 542), rrect(366, 492, 602, 538, 6), None, 4)
layer("mech_ring_outer", (352, 266, 608, 528), union(annulus(MX, MY, 76, 124), rect(466, 270, 494, 332)), None, 2.5)
layer("mech_ring_inner", (398, 318, 562, 482), annulus(MX, MY, 56, 80), None, 2)
layer("mech_left", (333, 416, 388, 512), rrect(336, 420, 385, 508, 10), None, 4)
layer("mech_right", (572, 392, 628, 508), rrect(576, 396, 624, 504, 10), None, 4)
layer("brain", (412, 330, 544, 462), circle(BX, BY, 62), None, 3)

# Task cards.
CARDS = {"card_today": (618, 275, 808, 400), "card_week": (825, 275, 1015, 400), "card_month": (618, 407, 808, 530), "card_quarter": (825, 407, 1015, 530)}
for n, (x0, y0, x1, y1) in CARDS.items():
    layer(n, (x0 - 12, y0 - 12, x1 + 12, y1 + 12), rrect(x0 - 5, y0 - 5, x1 + 5, y1 + 5, 14), None, 5)

# Bottom lockup.
layer("overnight", (450, 582, 638, 622), rect(452, 584, 636, 620), (60, 130), 2)
layer("line_left", (286, 590, 447, 610), rect(288, 592, 445, 608), (45, 120), 1.5)
layer("line_right", (656, 590, 824, 610), rect(658, 592, 822, 608), (45, 120), 1.5)
layer("ai_text", (381, 616, 714, 650), rect(383, 618, 712, 648), (70, 150), 2)
layer("star", (522, 639, 570, 684), rect(524, 641, 568, 682), (50, 130), 2)

# ---- build alphas
for l in L:
    a = l["shape"] if l["key"] is None else l["shape"] * key(*l["key"])
    l["alpha"] = feather(a, l["f"])

# ---- inpaint: base loses every element (and the trails); final loses only the wordmark
remove = union(WORDMARK, trail_alpha, *[l["alpha"] for l in L])
remove_bin = (cv2.dilate((remove > 0.04).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0).astype(np.uint8) * 255
bgr = cv2.cvtColor(np.array(src), cv2.COLOR_RGB2BGR)
base = cv2.inpaint(bgr, remove_bin, 9, cv2.INPAINT_TELEA)
soft = cv2.GaussianBlur(remove_bin.astype(np.float32) / 255, (0, 0), 6)[..., None]
base = np.clip(base.astype(np.float32) * (1 - 0.22 * soft), 0, 255).astype(np.uint8)
final = cv2.inpaint(bgr, (cv2.dilate((WORDMARK > 0.5).astype(np.uint8), np.ones((3, 3), np.uint8)) * 255).astype(np.uint8), 9, cv2.INPAINT_TELEA)

os.makedirs(os.path.join(OUT, "layers"), exist_ok=True)
Image.fromarray(cv2.cvtColor(base, cv2.COLOR_BGR2RGB)).save(os.path.join(OUT, "base.webp"), quality=90, method=6)
Image.fromarray(cv2.cvtColor(final, cv2.COLOR_BGR2RGB)).save(os.path.join(OUT, "final.webp"), quality=92, method=6)

def save_layer(name, bbox, rgb_full, alpha):
    x0, y0, x1, y1 = bbox
    crop = np.dstack([rgb_full[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).astype(np.uint8)
    Image.fromarray(crop, "RGBA").save(os.path.join(OUT, "layers", f"{name}.webp"), quality=92, method=6)
    return [x0, y0, x1 - x0, y1 - y0]

meta = {}
for l in L:
    meta[l["name"]] = save_layer(l["name"], l["bbox"], rgb, l["alpha"])
meta["trails"] = save_layer("trails", (20, 256, 410, 574), trail_rgb, trail_alpha)

with open(TS, "w", encoding="utf-8") as f:
    f.write("// Generated by scripts/hero-slice.py — do not edit. Positions are in source pixels.\n")
    f.write(f"export const HERO_W = {W};\nexport const HERO_H = {H};\n")
    f.write(f"export const WORDMARK_BOX = {json.dumps([396, 68, 529, 110])};\n")
    f.write("export const LAYERS = " + json.dumps(meta, indent=2) + " as const;\n")
    f.write("export type LayerName = keyof typeof LAYERS;\n")
print(f"wrote {len(meta)} layers")
for n in sorted(os.listdir(os.path.join(OUT, 'layers'))): print(n, os.path.getsize(os.path.join(OUT,'layers',n)))
print('base', os.path.getsize(os.path.join(OUT,'base.webp')), 'final', os.path.getsize(os.path.join(OUT,'final.webp')))
