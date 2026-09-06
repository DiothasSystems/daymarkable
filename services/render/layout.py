"""Stroke geometry -> written lines and indent depth.

The decoder reads a page as pixels, so line breaks and indentation are things it infers. But
the .rm file already knows them exactly: every stroke carries its own coordinates, and a page
of handwriting is strokes clustered into horizontal bands. Computing those bands here turns
"how many lines were written, and how far in does each start" from a guess into a measurement,
which is then handed to the decoder as context.

Deliberately pure and stdlib-only: no rmscene, no PIL, no resvg. That keeps it unit-testable
without the render container, which is where the rest of this service can only be exercised.
"""
from __future__ import annotations

from dataclasses import dataclass

# A stroke taller than this fraction of the page is a bracket, box or arrow spanning several
# lines, not a letter — it would swallow every band it crosses, so it is left out of clustering.
TALL_STROKE_FRACTION = 0.10
# Two strokes belong to the same line when their vertical spans overlap by at least this much of
# the smaller one. Generous, because ascenders and descenders make bands ragged.
LINE_OVERLAP = 0.35
# Indent steps are quantised to this fraction of the page width (~1.5 characters at normal size).
INDENT_STEP = 0.035
MAX_INDENT = 3


@dataclass
class StrokeBox:
    """One stroke's bounding box, in fractions of the page (0..1, origin top-left)."""

    left: float
    top: float
    right: float
    bottom: float


@dataclass
class TextLine:
    top: float
    bottom: float
    left: float
    right: float
    strokes: int
    indent: int = 0

    @property
    def height(self) -> float:
        return self.bottom - self.top


def _overlaps(a: TextLine, b: StrokeBox) -> bool:
    span = min(a.bottom, b.bottom) - max(a.top, b.top)
    if span <= 0:
        return False
    smaller = min(a.height, b.bottom - b.top)
    if smaller <= 0:
        return True
    return span / smaller >= LINE_OVERLAP


def group_strokes_into_lines(boxes: list[StrokeBox]) -> list[TextLine]:
    """Cluster strokes into horizontal bands, top to bottom.

    Strokes are swept in reading order (top, then left) and merged into the open band they
    overlap vertically. A band that no longer overlaps is closed and a new one starts.
    """
    usable = [b for b in boxes if (b.bottom - b.top) <= TALL_STROKE_FRACTION and b.right > b.left]
    if not usable:
        return []
    usable.sort(key=lambda b: (round(b.top, 4), b.left))

    lines: list[TextLine] = []
    for b in usable:
        placed = False
        # Only the most recent few bands can still be open; a page is read top to bottom.
        for line in reversed(lines[-3:]):
            if _overlaps(line, b):
                line.top = min(line.top, b.top)
                line.bottom = max(line.bottom, b.bottom)
                line.left = min(line.left, b.left)
                line.right = max(line.right, b.right)
                line.strokes += 1
                placed = True
                break
        if not placed:
            lines.append(TextLine(top=b.top, bottom=b.bottom, left=b.left, right=b.right, strokes=1))
    lines.sort(key=lambda line: line.top)
    return lines


def assign_indents(lines: list[TextLine]) -> list[TextLine]:
    """Quantise each line's left edge into an indent depth relative to the page's own margin."""
    if not lines:
        return lines
    margin = min(line.left for line in lines)
    for line in lines:
        line.indent = min(MAX_INDENT, int(round((line.left - margin) / INDENT_STEP)))
    return lines


def page_lines(boxes: list[StrokeBox]) -> list[TextLine]:
    return assign_indents(group_strokes_into_lines(boxes))


def indent_pattern(lines: list[TextLine], limit: int = 80) -> str:
    """Compact per-line indent depths for the decoder hint: "0,0,1,1,0"."""
    return ",".join(str(line.indent) for line in lines[:limit])
