"""Small PDFs built in the test: real lecture files are copyrighted and stay out of git."""

from __future__ import annotations

from pathlib import Path

import pymupdf

#: A 16:9 slide as PowerPoint exports it: 13.333 x 7.5 inches, in points.
SLIDE_W, SLIDE_H = 960, 540
#: An A4 page in points, for scans.
A4_W, A4_H = 595, 842


def slide(document: pymupdf.Document) -> pymupdf.Page:
    return document.new_page(width=SLIDE_W, height=SLIDE_H)


def figure_png(labels: dict[str, tuple[float, float]] | None = None) -> bytes:
    """A crude cell figure at 1200 x 900 pixels. `labels` (text at points of its 600 x 450 pt
    frame) are drawn into its pixels, as on a flattened textbook figure."""
    figure = pymupdf.open()
    page = figure.new_page(width=600, height=450)
    page.draw_rect(page.rect, color=None, fill=(0.84, 0.92, 0.97))
    page.draw_oval(pymupdf.Rect(60, 45, 540, 405), color=(0.16, 0.5, 0.73), width=4)
    page.draw_oval(pymupdf.Rect(240, 170, 360, 280), color=(0.12, 0.38, 0.55), width=3)
    for text, point in (labels or {}).items():
        page.insert_text(point, text, fontsize=22)
    return page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")


def scan_png(lines: list[str]) -> bytes:
    """An A4 page of text, rasterized at 200 dpi as a scanner would."""
    page = pymupdf.open().new_page(width=A4_W, height=A4_H)
    for number, line in enumerate(lines):
        page.insert_text((72, 100 + 24 * number), line, fontsize=14)
    return page.get_pixmap(dpi=200).tobytes("png")


def ruled_table(page: pymupdf.Page, origin: tuple[float, float], rows: list[list[str]]) -> None:
    """A table with a ruled line around every cell, as LibreOffice exports a deck's table."""
    cell_w, cell_h = 200, 36
    x0, y0 = origin
    width, height = cell_w * len(rows[0]), cell_h * len(rows)
    for r in range(len(rows) + 1):
        page.draw_line((x0, y0 + r * cell_h), (x0 + width, y0 + r * cell_h), width=1)
    for c in range(len(rows[0]) + 1):
        page.draw_line((x0 + c * cell_w, y0), (x0 + c * cell_w, y0 + height), width=1)
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            page.insert_text((x0 + c * cell_w + 8, y0 + r * cell_h + 24), text, fontsize=14)


def save(document: pymupdf.Document, path: Path) -> Path:
    path.write_bytes(document.tobytes())
    return path
