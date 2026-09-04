"""dayMarkable render service: POST /render (.rm -> PNG) and POST /render-pdf (fallback).

Privacy: this service is stateless. Nothing is written to disk; bytes come in and
PNG bytes go out. Logs carry counts and sizes only, never content (CLAUDE.md rule 5).

A page may come back as several vertical segments (tall scrolled pages); consumers send all
segments of a page to the decoder together, top to bottom. When a document is PDF-backed,
pass `pdf_b64` once and `pdf_page_index` per page and the ink is composited over the page.
"""
from __future__ import annotations

import base64
import logging

from fastapi import FastAPI
from pydantic import BaseModel, Field

from render import (
    DEFAULT_LONG_EDGE,
    RenderError,
    Rendered,
    blank_page,
    open_pdf,
    rasterize_pdf_page,
    render_pdf_pages,
    render_rm,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("daymarkable.render.api")

app = FastAPI(title="dayMarkable render", version="0.3.0")


class PageIn(BaseModel):
    page_id: str
    rm_b64: str | None = None  # None => blank page (or bare PDF page when pdf_page_index is set)
    pdf_page_index: int | None = None
    # Fraction of the page height to drop from the top before rendering; used by the handwriting
    # calibration sheet, whose printed reference text must not reach the decoder.
    crop_top: float | None = None


class RenderRequest(BaseModel):
    pages: list[PageIn]
    pdf_b64: str | None = None
    long_edge: int = Field(default=DEFAULT_LONG_EDGE, ge=512, le=4096)


class SegmentOut(BaseModel):
    page_id: str
    segment: int
    segment_count: int
    png_b64: str
    width: int
    height: int
    renderer: str


class PageError(BaseModel):
    page_id: str
    code: str
    message: str


class RenderResponse(BaseModel):
    segments: list[SegmentOut]
    errors: list[PageError]


def _seg(page_id: str, r: Rendered) -> SegmentOut:
    return SegmentOut(
        page_id=page_id,
        segment=r.segment,
        segment_count=r.segment_count,
        png_b64=base64.b64encode(r.png).decode(),
        width=r.width,
        height=r.height,
        renderer=r.renderer,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/render", response_model=RenderResponse)
def render(req: RenderRequest) -> RenderResponse:
    segments: list[SegmentOut] = []
    errors: list[PageError] = []
    ok = 0
    pdf = None
    if req.pdf_b64:
        try:
            pdf = open_pdf(base64.b64decode(req.pdf_b64))
        except RenderError as exc:
            log.warning("pdf background unusable: %s", exc.code)
    for p in req.pages:
        try:
            background = None
            if pdf is not None and p.pdf_page_index is not None:
                background = rasterize_pdf_page(pdf, p.pdf_page_index, req.long_edge)
            if p.rm_b64 is None:
                rendered = [blank_page(req.long_edge)] if background is None else [Rendered(_png(background), background.width, background.height, "pdf")]
            else:
                rendered = render_rm(base64.b64decode(p.rm_b64), req.long_edge, background, p.crop_top)
            segments.extend(_seg(p.page_id, r) for r in rendered)
            ok += 1
        except RenderError as exc:
            errors.append(PageError(page_id=p.page_id, code=exc.code, message=str(exc)))
        except Exception as exc:  # never let one page kill the batch
            errors.append(PageError(page_id=p.page_id, code="unknown", message=str(exc)))
    log.info("render pages=%d ok=%d segments=%d errors=%d long_edge=%d", len(req.pages), ok, len(segments), len(errors), req.long_edge)
    return RenderResponse(segments=segments, errors=errors)


def _png(im) -> bytes:
    import io

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


class RenderPdfRequest(BaseModel):
    pdf_b64: str
    page_indexes: list[int] | None = None
    long_edge: int = Field(default=DEFAULT_LONG_EDGE, ge=512, le=4096)


class PdfSegmentOut(BaseModel):
    index: int
    segment: int
    segment_count: int
    png_b64: str
    width: int
    height: int
    renderer: str


class RenderPdfResponse(BaseModel):
    segments: list[PdfSegmentOut]
    errors: list[PageError]


@app.post("/render-pdf", response_model=RenderPdfResponse)
def render_pdf(req: RenderPdfRequest) -> RenderPdfResponse:
    try:
        rendered = render_pdf_pages(base64.b64decode(req.pdf_b64), req.page_indexes, req.long_edge)
    except RenderError as exc:
        return RenderPdfResponse(segments=[], errors=[PageError(page_id="*", code=exc.code, message=str(exc))])
    log.info("render-pdf segments=%d long_edge=%d", len(rendered), req.long_edge)
    return RenderPdfResponse(
        segments=[
            PdfSegmentOut(
                index=i,
                segment=r.segment,
                segment_count=r.segment_count,
                png_b64=base64.b64encode(r.png).decode(),
                width=r.width,
                height=r.height,
                renderer=r.renderer,
            )
            for i, r in rendered
        ],
        errors=[],
    )
