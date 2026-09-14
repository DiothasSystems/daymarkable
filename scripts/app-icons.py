"""
Generate the mobile app's icon and splash from the brand, not by hand.

  icon    the emblem, the circular part of the logo. Chosen by the founder over the compass
          rose: the rose is what the brand board nominates below 48px, but the emblem is what
          people recognise as this product, and a launcher icon is a recognition problem first.
  splash  the full lockup — emblem, wordmark, tagline. A splash is a held moment on a whole
          screen, so there is room for all three.

The rose geometry is copied from `apps/web/src/components/Brand.tsx`; the lockup is composed from
the transparent slices in `apps/web/public/brand/` using the measurements in
`apps/web/src/components/hero/logo-geometry.ts`, so the phone, the web header, the tablet page and
the email all carry the same artwork. Colours are the CLAUDE.md palette.

    python scripts/app-icons.py

Writes into apps/mobile/assets/. Re-run if the artwork or palette changes; never hand-edit the
output.
"""

from __future__ import annotations

import pathlib
import re

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "mobile" / "assets"
BRAND = ROOT / "apps" / "web" / "public" / "brand"
GEOMETRY = ROOT / "apps" / "web" / "src" / "components" / "hero" / "logo-geometry.ts"

MIDNIGHT = (30, 42, 68, 255)  # #1E2A44
GOLD = (201, 151, 63, 255)  # #C9973F
PARCHMENT = (247, 240, 227, 255)  # #F7F0E3
CLEAR = (0, 0, 0, 0)

# The rose in its own 72x72 space, exactly as Brand.tsx draws it.
VIEWBOX = 72.0
CIRCLE_CENTRE = (36.0, 36.0)
CIRCLE_RADIUS = 26.0
CIRCLE_STROKE = 5.0
POINTS = [
    [(36, 2), (41, 12), (36, 18), (31, 12)],
    [(36, 70), (41, 60), (36, 54), (31, 60)],
    [(2, 36), (12, 31), (18, 36), (12, 41)],
    [(70, 36), (60, 31), (54, 36), (60, 41)],
]

# Draw at 4x and downsample: PIL has no antialiasing of its own.
SS = 4


def rose(size: int, colour: tuple[int, int, int, int], scale: float) -> Image.Image:
    """The rose, centred on a transparent square of `size`, occupying `scale` of it."""
    big = size * SS
    img = Image.new("RGBA", (big, big), CLEAR)
    d = ImageDraw.Draw(img)
    unit = (big * scale) / VIEWBOX
    offset = (big - VIEWBOX * unit) / 2

    def at(x: float, y: float) -> tuple[float, float]:
        return (offset + x * unit, offset + y * unit)

    cx, cy = at(*CIRCLE_CENTRE)
    r = CIRCLE_RADIUS * unit
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=colour, width=max(1, round(CIRCLE_STROKE * unit)))
    for quad in POINTS:
        d.polygon([at(x, y) for x, y in quad], fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def on(ground: tuple[int, int, int, int], size: int, ink: tuple[int, int, int, int], scale: float) -> Image.Image:
    img = Image.new("RGBA", (size, size), ground)
    img.alpha_composite(rose(size, ink, scale))
    return img


def geometry() -> dict[str, dict[str, float]]:
    """
    The LOGO object out of the generated TypeScript, so the lockup has one source of truth.

    Read with a regex per field rather than by coercing the file into JSON: it is small, generated
    and fixed in shape, and a half-working translation fails in ways much harder to read than a
    named missing key.
    """
    text = GEOMETRY.read_text(encoding="utf-8")
    number = "(-?[0-9]+(?:[.][0-9]+)?)"

    def fields(name: str, keys: list[str]) -> dict[str, float]:
        block = re.search(name + r":\s*\{([^}]*)\}", text)
        if not block:
            raise SystemExit(f"{GEOMETRY} has no `{name}` — re-run scripts/hero-logo-slices.py")
        out: dict[str, float] = {}
        for key in keys:
            found = re.search(key + r":\s*" + number, block.group(1))
            if not found:
                raise SystemExit(f"{GEOMETRY}: `{name}` has no `{key}`")
            out[key] = float(found.group(1))
        return out

    return {
        "emblem": fields("emblem", ["size", "dx", "dy"]),
        "wordmark": fields("wordmark", ["x", "y", "w", "h"]),
        "tagline": fields("tagline", ["x", "y", "w", "h"]),
    }


def emblem(size: int, scale: float = 1.0) -> Image.Image:
    """
    The circular emblem on a transparent square, occupying `scale` of it.

    Two layers, because that is how hero-logo-slices.py cut them so the hero could move the
    points independently. Stacked at the same size they register exactly as the original.
    The gold points extend past the navy ring, so the pair is what defines the extent.
    """
    canvas = Image.new("RGBA", (size, size), CLEAR)
    side = max(1, round(size * scale))
    offset = (size - side) // 2
    for piece in ("emblem-base.webp", "emblem-points.webp"):
        img = Image.open(BRAND / piece).convert("RGBA").resize((side, side), Image.LANCZOS)
        canvas.alpha_composite(img, (offset, offset))
    return canvas


def over(ground: tuple[int, int, int, int], size: int, art: Image.Image) -> Image.Image:
    img = Image.new("RGBA", (size, size), ground)
    img.alpha_composite(art)
    return img


def lockup(size: int) -> Image.Image:
    """
    The full logo — emblem, wordmark, tagline — on a transparent square.

    Composed from the sliced pieces rather than cropped out of `design/.../full-lockup.png`: that
    file has a baked-in cream ground, and keying it out would punch holes in the notebook pages,
    which are very nearly the same colour.
    """
    g = geometry()
    e, w, t = g["emblem"], g["wordmark"], g["tagline"]

    # Everything is in ring radii from the ring centre. Find the extent, then fit it to the square.
    left = min(e["dx"], w["x"], t["x"])
    right = max(e["dx"] + e["size"], w["x"] + w["w"], t["x"] + t["w"])
    top = e["dy"]
    bottom = t["y"] + t["h"]
    scale = (size * 0.92) / max(right - left, bottom - top)

    canvas = Image.new("RGBA", (size, size), CLEAR)
    origin_x = size / 2 - ((left + right) / 2) * scale
    origin_y = size / 2 - ((top + bottom) / 2) * scale

    def place(path: pathlib.Path, x: float, y: float, width: float) -> None:
        img = Image.open(path).convert("RGBA")
        pw = max(1, round(width * scale))
        ph = max(1, round(pw * img.height / img.width))
        canvas.alpha_composite(
            img.resize((pw, ph), Image.LANCZOS),
            (round(origin_x + x * scale), round(origin_y + y * scale)),
        )

    # The emblem ships as two layers so the hero can move the points; here they simply stack.
    place(BRAND / "emblem-base.webp", e["dx"], e["dy"], e["size"])
    place(BRAND / "emblem-points.webp", e["dx"], e["dy"], e["size"])
    place(BRAND / "lockup-wordmark.webp", w["x"], w["y"], w["w"])
    place(BRAND / "lockup-tagline.webp", t["x"], t["y"], t["w"])
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # iOS and the generic icon: opaque, no transparency. The emblem is drawn nearly full-bleed
    # on Parchment, which is the ground the artwork was designed against; its own navy ring gives
    # it the edge definition a pale icon would otherwise lack on a pale wallpaper.
    over(PARCHMENT, 1024, emblem(1024, 0.96)).save(OUT / "icon.png")

    # Android adaptive icon: the launcher masks this to a circle, squircle or whatever the device
    # prefers, and animates it, so only the middle ~66% is safe. The emblem is already a circle,
    # so it sits inside that mask rather than being cropped by it.
    emblem(1024, 0.66).save(OUT / "adaptive-icon.png")

    # The NATIVE splash icon, and it has to be the emblem alone.
    #
    # Android 12 and later mask this to a circle - that is the platform's splash screen API, not a
    # choice Expo makes - so a wide lockup here is cropped to a horizontal band through its middle.
    # The emblem is already circular and survives the mask intact.
    emblem(1024, 0.92).save(OUT / "splash-icon.png")

    # The full lockup, shown by the app itself (app/_layout.tsx) over the same Parchment ground the
    # native splash uses, so the handover is invisible. This is the only way to show the whole logo
    # on Android 12+; the native layer cannot.
    lockup(1024).save(OUT / "splash-lockup.png")

    # Play Store listing icon (512x512, opaque, no alpha) — the same mark at the size Play wants.
    over(PARCHMENT, 512, emblem(512, 0.96)).convert("RGB").save(OUT / "play-store-icon.png")

    # The favicon stays the compass rose: at 16-48px in a browser tab the emblem's moon, pen and
    # four little glyphs genuinely do collapse, and this is the case the rose exists for.
    on(MIDNIGHT, 48, GOLD, 0.66).save(OUT / "favicon.png")

    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:24} {Image.open(f).size}")


if __name__ == "__main__":
    main()
