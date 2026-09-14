"""
Generate the mobile app's icon and splash from the brand, not by hand.

Why the compass rose and not `assets/emblem.png`: the brand board says the rose stands in for the
emblem below 48px, and a launcher icon is rendered at 48dp on a home screen. The emblem is a
detailed scene — notebook, path, dawn, four small glyphs — and at that size it is mud. The rose is
the mark that survives being small, which is the whole reason the brand has one.

Geometry is copied from `apps/web/src/components/Brand.tsx` so the phone, the web header, the
tablet page and the email all draw the same shape. Colours are the CLAUDE.md palette.

    python scripts/app-icons.py

Writes into apps/mobile/assets/. Re-run if the palette or the rose changes; never hand-edit the
output.
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "apps" / "mobile" / "assets"

MIDNIGHT = (30, 42, 68, 255)  # #1E2A44
GOLD = (201, 151, 63, 255)  # #C9973F
PARCHMENT = (247, 240, 227, 255)  # #F7F0E3

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


def rose(size: int, colour: tuple[int, int, int, int], scale: float = 1.0) -> Image.Image:
    """The rose, centred on a transparent square of `size`, occupying `scale` of it."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
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


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # iOS and the generic icon: opaque, no transparency, gold on Midnight. Midnight rather than
    # Parchment because a pale icon disappears into a pale wallpaper, and the email's brand bar
    # already establishes gold-on-Midnight as the small-size pairing.
    on(MIDNIGHT, 1024, GOLD, 0.62).save(OUT / "icon.png")

    # Android adaptive icon: the launcher masks this to a circle, squircle or whatever the device
    # prefers, and animates it, so only the middle ~66% is safe. The rose is drawn smaller again to
    # sit inside that, and the background is a flat colour set in app.json.
    on((0, 0, 0, 0), 1024, GOLD, 0.44).save(OUT / "adaptive-icon.png")

    # Splash: the calm end of the palette, because it is a full screen for a moment rather than a
    # thumbnail. expo-splash-screen scales this WHOLE image to `imageWidth` (180dp) and centres it
    # on its own background colour — so the rose nearly fills its canvas. Sizing it small here, as
    # if the canvas were the screen, leaves a speck floating in the middle of a blank phone.
    on((0, 0, 0, 0), 1024, MIDNIGHT, 0.86).save(OUT / "splash-icon.png")

    # Play Store listing icon (512x512, opaque, no alpha) — the same mark at the size Play wants.
    on(MIDNIGHT, 512, GOLD, 0.62).convert("RGB").save(OUT / "play-store-icon.png")

    # The web's favicon lineage, kept here so the app and the browser tab agree.
    on(MIDNIGHT, 48, GOLD, 0.66).save(OUT / "favicon.png")

    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:24} {Image.open(f).size}")


if __name__ == "__main__":
    main()
