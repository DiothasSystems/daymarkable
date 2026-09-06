"""Unit tests for the stroke-geometry pass. Stdlib only: `python -m unittest` in this folder,
no render container and no reMarkable file needed."""
from __future__ import annotations

import unittest

from layout import StrokeBox, indent_pattern, page_lines


def word(left: float, top: float, width: float = 0.08, height: float = 0.02) -> StrokeBox:
    """One word-sized stroke cluster at a position on the page."""
    return StrokeBox(left=left, top=top, right=left + width, bottom=top + height)


class GroupStrokes(unittest.TestCase):
    def test_no_strokes(self):
        self.assertEqual(page_lines([]), [])

    def test_words_on_one_row_become_one_line(self):
        boxes = [word(0.10, 0.20), word(0.20, 0.205), word(0.31, 0.198)]
        lines = page_lines(boxes)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].strokes, 3)
        self.assertAlmostEqual(lines[0].left, 0.10)

    def test_rows_far_apart_are_separate_lines(self):
        lines = page_lines([word(0.10, 0.20), word(0.10, 0.26), word(0.10, 0.32)])
        self.assertEqual(len(lines), 3)
        self.assertEqual([round(l.top, 3) for l in lines], [0.20, 0.26, 0.32])

    def test_ascenders_do_not_split_a_line(self):
        # A tall letter in the middle of a line still overlaps the band enough to join it.
        boxes = [word(0.10, 0.20), StrokeBox(0.20, 0.188, 0.24, 0.222), word(0.26, 0.202)]
        self.assertEqual(len(page_lines(boxes)), 1)

    def test_a_tall_stroke_does_not_swallow_the_page(self):
        # A bracket down the margin spans many lines; including it would merge them all.
        boxes = [StrokeBox(0.05, 0.10, 0.07, 0.60), word(0.10, 0.20), word(0.10, 0.30), word(0.10, 0.40)]
        self.assertEqual(len(page_lines(boxes)), 3)

    def test_lines_come_back_in_reading_order(self):
        lines = page_lines([word(0.10, 0.40), word(0.10, 0.20), word(0.10, 0.30)])
        self.assertEqual([round(l.top, 3) for l in lines], [0.20, 0.30, 0.40])


class Indents(unittest.TestCase):
    def test_flush_lines_are_all_depth_zero(self):
        lines = page_lines([word(0.10, 0.20), word(0.10, 0.26), word(0.10, 0.32)])
        self.assertEqual([l.indent for l in lines], [0, 0, 0])

    def test_indent_is_relative_to_the_pages_own_margin(self):
        # The whole page sits at 0.30; nothing is indented relative to itself.
        lines = page_lines([word(0.30, 0.20), word(0.30, 0.26)])
        self.assertEqual([l.indent for l in lines], [0, 0])

    def test_sub_items_step_in(self):
        boxes = [word(0.10, 0.20), word(0.145, 0.26), word(0.145, 0.32), word(0.10, 0.38)]
        self.assertEqual([l.indent for l in page_lines(boxes)], [0, 1, 1, 0])

    def test_two_levels(self):
        boxes = [word(0.10, 0.20), word(0.145, 0.26), word(0.18, 0.32)]
        self.assertEqual([l.indent for l in page_lines(boxes)], [0, 1, 2])

    def test_indent_is_capped(self):
        boxes = [word(0.10, 0.20), word(0.60, 0.26)]
        self.assertEqual(page_lines(boxes)[1].indent, 3)

    def test_pattern_is_compact_and_bounded(self):
        boxes = [word(0.10, 0.10 + i * 0.02) for i in range(10)]
        self.assertEqual(indent_pattern(page_lines(boxes)), "0,0,0,0,0,0,0,0,0,0")
        self.assertEqual(indent_pattern(page_lines(boxes), limit=3), "0,0,0")


class RealisticPage(unittest.TestCase):
    def test_a_page_written_as_a_nested_list(self):
        # "3 Parts / 1.) Harmony / - RRM / - Nightly Remap / b.) 80 -> 40"
        boxes = [
            word(0.10, 0.12),
            word(0.10, 0.18), word(0.22, 0.181),
            word(0.145, 0.24), word(0.24, 0.241),
            word(0.145, 0.30),
            word(0.10, 0.36),
        ]
        lines = page_lines(boxes)
        self.assertEqual(len(lines), 5)
        self.assertEqual([l.indent for l in lines], [0, 0, 1, 1, 0])
        self.assertEqual(indent_pattern(lines), "0,0,1,1,0")


if __name__ == "__main__":
    unittest.main()
