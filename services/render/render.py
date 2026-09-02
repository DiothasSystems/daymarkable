"""dayMarkable render core: reMarkable `.rm` (lines v6) -> PNG, plus the PDF fallback.

Pure functions, no web framework, so they can be unit-tested and reused by the CLI.

Tall (scrolled) notebook pages are split into device-proportioned vertical segments so each
segment keeps full resolution at the 1568px long edge instead of being squeezed into a strip.
"""
from __future__ import annotations

import io
import logging
import math
from dataclasses import dataclass

import resvg_py
from PIL import Image
from rmc.exporters.svg import (
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    build_anchor_pos,
    draw_group,
    draw_text,
    get_bounding_box,
    xx,
    yy,
)
from rmscene import read_tree

log = logging.getLogger("daymarkable.render")

DEFAULT_LONG_EDGE = 1568  # Claude vision sweet spot (see ECONOMICS.md)
DEVICE_RATIO = SCREEN_HEIGHT / SCREEN_WIDTH  # 1.333
SEGMENT_OVERLAP_PX = 96  # a line of handwriting, so nothing is cut in half unseen


@dataclass
class Rendered:
    png: bytes
    width: int
    height: int
    renderer: str
    segment: int = 0
    segment_count: int = 1


class RenderError(Exception):
    """Typed failure: the caller decides whether to fall back."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _svg_from_rm(rm_bytes: bytes) -> tuple[str, float, float]:
    """Build an SVG string sized to at least the full device page (never crops the page)."""
    try:
        tree = read_tree(io.BytesIO(rm_bytes))
    except Exception as exc:  # rmscene raises many block-level errors on format bumps
        raise RenderError("parse", f"rmscene could not parse page: {exc}") from exc

    anchor_pos = build_anchor_pos(tree.root_text)
    x_min, x_max, y_min, y_max = get_bounding_box(tree.root, anchor_pos)
    # Always include the full nominal page so layouts stay comparable night to night.
    x_min = min(x_min, -SCREEN_WIDTH // 2)
    x_max = max(x_max, SCREEN_WIDTH // 2)
    y_min = min(y_min, 0)
    y_max = max(y_max, SCREEN_HEIGHT)
    width_pt = xx(x_max - x_min + 1)
    height_pt = yy(y_max - y_min + 1)

    out = io.StringIO()
    out.write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_pt}" height="{height_pt}" '
        f'viewBox="{xx(x_min)} {yy(y_min)} {width_pt} {height_pt}">\n'
        f'<rect x="{xx(x_min)}" y="{yy(y_min)}" width="{width_pt}" height="{height_pt}" fill="#ffffff"/>\n'
        '<g id="p1">\n'
    )
    if tree.root_text is not None:
        draw_text(tree.root_text, out)
    draw_group(tree.root, out, anchor_pos)
    out.write("</g>\n</svg>\n")
    return out.getvalue(), width_pt, height_pt


def _to_png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def segment_image(im: Image.Image, long_edge: int, renderer: str) -> list[Rendered]:
    """Split a tall image into device-ratio segments, each fitting the long edge."""
    w, h = im.size
    if h / w <= DEVICE_RATIO * 1.15:
        return [Rendered(_to_png(im), w, h, renderer)]
    seg_h = int(w * DEVICE_RATIO)
    step = seg_h - SEGMENT_OVERLAP_PX
    count = max(1, math.ceil((h - SEGMENT_OVERLAP_PX) / step))
    out: list[Rendered] = []
    for i in range(count):
        top = min(i * step, max(0, h - seg_h))
        crop = im.crop((0, top, w, min(top + seg_h, h)))
        out.append(Rendered(_to_png(crop), crop.width, crop.height, renderer, i, count))
    return out


def render_rm(rm_bytes: bytes, long_edge: int = DEFAULT_LONG_EDGE) -> list[Rendered]:
    svg, w, h = _svg_from_rm(rm_bytes)
    # Scale so a device-proportioned segment has the target long edge; tall pages get tiled.
    seg_h_pt = w * DEVICE_RATIO
    scale = long_edge / max(w, min(h, seg_h_pt))
    try:
        png = resvg_py.svg_to_bytes(svg_string=svg, zoom=scale, background="#ffffff")
    except Exception as exc:
        raise RenderError("rasterize", f"resvg failed: {exc}") from exc
    with Image.open(io.BytesIO(bytes(png))) as im:
        gray = im.convert("L")  # monochrome for token economy + legibility
        return segment_image(gray, long_edge, "rmscene")


def blank_page(long_edge: int = DEFAULT_LONG_EDGE) -> Rendered:
    scale = long_edge / SCREEN_HEIGHT
    w, h = int(SCREEN_WIDTH * scale), int(SCREEN_HEIGHT * scale)
    return Rendered(_to_png(Image.new("L", (w, h), 255)), w, h, "blank")


def render_pdf_pages(
    pdf_bytes: bytes, page_indexes: list[int] | None, long_edge: int
) -> list[tuple[int, Rendered]]:
    """Annotated-PDF fallback: rasterize a PDF (pypdfium2) at the target long edge."""
    import pypdfium2 as pdfium

    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise RenderError("pdf", f"pypdfium2 could not open PDF: {exc}") from exc
    out: list[tuple[int, Rendered]] = []
    indexes = page_indexes if page_indexes is not None else list(range(len(doc)))
    for i in indexes:
        if i < 0 or i >= len(doc):
            continue
        page = doc[i]
        w_pt, h_pt = page.get_size()
        scale = long_edge / max(w_pt, h_pt)
        bitmap = page.render(scale=scale, grayscale=True)
        im = bitmap.to_pil().convert("L")
        for seg in segment_image(im, long_edge, "pdf"):
            out.append((i, seg))
    return out
