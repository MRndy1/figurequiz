"""PDF pages: their text layer, title and pictures (CLAUDE.md, PDF (Tier 1) and OCR routing).

PyMuPDF gives each line of a page's text with its box and font size, and each picture drawn on
the page with its box, so the deck's rule carries over unchanged (`detect.build_diagrams`): a
picture with two or more short labels on or beside it is a labeled diagram (Tier 1), and a big
picture with fewer is an OCR candidate, its labels perhaps baked into the pixels (Tier 2).

Tables are PyMuPDF's to find: a ruled table drawn on the page, as LibreOffice exports a deck's
table shapes, comes back cell by cell.

What a PDF adds is what a deck keeps out of its slides' shapes. The backgrounds, banners and
logos of a slide master are pictures on every page here, so tiny pictures and pictures that
span the page are left out. And a scanned page is pictures with next to no text, so OCR reads
the whole of it.

Everything here works in points, in the frame of the rendered page. PyMuPDF reports text and
pictures in the unrotated page, so a rotated page's boxes are turned to match its render.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

from app.detect import (
    DetectConfig,
    Diagram,
    LabelBox,
    PictureBox,
    TableGrid,
    build_diagrams,
    table_grid,
)
from app.geometry import Box

#: The "dict" layout without the pictures' pixels, which it would otherwise carry.
_TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
#: A wrapped line starts at most this many line heights below the line before it. A line's box
#: spans its font's full height, so the lines of one paragraph nearly touch.
_WRAP_GAP = 0.5
#: Font sizes closer than this are one size: a transform can turn 28 pt into 27.96.
_SAME_SIZE_PT = 0.5
#: The column names PyMuPDF makes up for a table whose headings it found none of.
_MADE_UP_NAME = re.compile(r"Col\d+")


@dataclass(frozen=True)
class PageDetection:
    title: str | None
    #: Every other line of text, one per line, in the order the page draws them, which for an
    #: exported deck is the slide's own z-order.
    text: str
    diagrams: tuple[Diagram, ...]
    ocr_candidates: tuple[PictureBox, ...]
    #: Where the title sits, so crops can avoid slicing through it.
    title_box: Box | None
    #: Every line of the text layer.
    text_boxes: tuple[Box, ...]
    #: Next to no text, and mostly pictures: its text is in the pixels, so the page's text is
    #: OCR's to read, and the whole page is its one OCR candidate.
    scanned: bool
    #: The page's tables worth quizzing on, top to bottom. A scan has none: OCR reads it as text.
    tables: tuple[TableGrid, ...] = field(default_factory=tuple)

    def has_text_at(self, box: Box) -> bool:
        """Whether the text layer already covers most of `box`. OCR reading that text off the
        render again (a title over a banner, say) has found no label of the picture's own."""
        covered = sum(
            overlap.area
            for line in self.text_boxes
            if (overlap := box.intersection(line)) is not None
        )
        return covered >= 0.5 * box.area


@dataclass(frozen=True)
class _Line:
    text: str
    box: Box
    #: The largest font size in the line, in points.
    size: float
    #: PyMuPDF's block number: lines it put in one block were drawn together.
    block: int


@dataclass(frozen=True)
class _Group:
    """The lines of one wrapped label, title or paragraph, read as one."""

    lines: tuple[_Line, ...]
    text: str
    box: Box
    size: float

    @classmethod
    def of(cls, lines: list[_Line]) -> _Group:
        box = lines[0].box
        for line in lines[1:]:
            box = box.union(line.box)
        return cls(
            tuple(lines),
            " ".join(line.text for line in lines),
            box,
            max(line.size for line in lines),
        )


def page_box(page: pymupdf.Page) -> Box:
    """The rendered page in points: its crop box, rotated."""
    rect = page.rect
    return Box(rect.x0, rect.y0, rect.x1, rect.y1)


def detect_page(page: pymupdf.Page, config: DetectConfig | None = None) -> PageDetection:
    """Find a page's title, text, labeled diagrams and OCR candidates."""
    config = config or DetectConfig()
    bounds = page_box(page)
    lines = _lines(page, bounds)
    pictures = _pictures(page, bounds, config)
    text_boxes = tuple(line.box for line in lines)

    if _is_scanned(lines, pictures, bounds, config):
        return PageDetection(
            title=None,
            text="",
            diagrams=(),
            ocr_candidates=(PictureBox(bounds),),
            title_box=None,
            text_boxes=text_boxes,
            scanned=True,
        )

    groups = _groups(lines)
    title = _find_title(groups, bounds, config)
    rest = [group for group in groups if group is not title]
    labels = [
        LabelBox(group.text, group.box)
        for group in rest
        if len(group.text.split()) <= config.max_label_words
    ]
    figures = [PictureBox(box) for box in pictures if not _is_furniture(box, bounds, config)]
    diagrams, ocr_candidates = build_diagrams(figures, labels, bounds, config)

    return PageDetection(
        title=title.text if title is not None else None,
        text="\n".join(line.text for group in rest for line in group.lines),
        diagrams=diagrams,
        ocr_candidates=ocr_candidates,
        title_box=title.box if title is not None else None,
        text_boxes=text_boxes,
        scanned=False,
        tables=_tables(page, config),
    )


def _tables(page: pymupdf.Page, config: DetectConfig) -> tuple[TableGrid, ...]:
    """The page's ruled tables. PyMuPDF takes the first row for headings unless it found them
    above the table (`external`), and then the headings it read go first."""
    grids = []
    for table in page.find_tables().tables:
        rows = [[cell or "" for cell in row] for row in table.extract()]
        names = [name or "" for name in table.header.names]
        if table.header.external and not all(_MADE_UP_NAME.fullmatch(name) for name in names):
            rows.insert(0, names)
        grid = table_grid(rows, 1, config)
        if grid is not None:
            grids.append(grid)
    return tuple(grids)


def _in_render(rect: pymupdf.Rect, page: pymupdf.Page, bounds: Box) -> Box | None:
    """`rect`, in the unrotated page, as a box of the rendered page; None if off the page."""
    turned = rect * page.rotation_matrix
    box = Box.from_corners(turned.x0, turned.y0, turned.x1, turned.y1).clipped_to(bounds)
    return box if box.width > 0 and box.height > 0 else None


def _lines(page: pymupdf.Page, bounds: Box) -> list[_Line]:
    lines = []
    for block in page.get_text("dict", flags=_TEXT_FLAGS)["blocks"]:
        for line in block.get("lines", ()):
            spans = line["spans"]
            text = " ".join("".join(span["text"] for span in spans).split())
            box = _in_render(pymupdf.Rect(line["bbox"]), page, bounds)
            if text and box is not None:
                size = max(span["size"] for span in spans)
                lines.append(_Line(text, box, size, block["number"]))
    return lines


def _groups(lines: list[_Line]) -> list[_Group]:
    """Join each line onto the line before when it wraps from it: drawn next in the same
    block, just under it, and overlapping it across. Two labels stacked tightly enough to share
    a block read as one, as two labels in one text box of a deck do."""
    groups: list[list[_Line]] = []
    for line in lines:
        if groups and _wraps_from(groups[-1][-1], line):
            groups[-1].append(line)
        else:
            groups.append([line])
    return [_Group.of(group) for group in groups]


def _wraps_from(previous: _Line, line: _Line) -> bool:
    if line.block != previous.block:
        return False
    above, below = previous.box, line.box
    across = min(above.x1, below.x1) > max(above.x0, below.x0)
    under = below.y0 > above.y0 and below.y0 - above.y1 <= _WRAP_GAP * above.height
    return across and under


def _find_title(groups: list[_Group], bounds: Box, config: DetectConfig) -> _Group | None:
    """The page's title: its largest text, when no other text is as large, it is short, and it
    starts near the top.

    A PDF has no title placeholder, and its topmost text is as often a running header as a
    title. Slides set the title larger than anything else on them, so size stands in for the
    placeholder, and a page whose largest text is shared, long or low down has no title — a
    title slide's two big lines, say, or a page of body text.
    """
    if not groups:
        return None
    largest = max(groups, key=lambda group: group.size)
    if any(group is not largest and group.size > largest.size - _SAME_SIZE_PT for group in groups):
        return None
    if len(largest.text.split()) > config.max_title_words:
        return None
    if largest.box.y0 > bounds.y0 + bounds.height * config.title_zone_frac:
        return None
    return largest


def _pictures(page: pymupdf.Page, bounds: Box, config: DetectConfig) -> list[Box]:
    """Where each picture big enough to be a figure is drawn, once per place. Inline images
    count too: PyMuPDF reports every image drawn, not only the shared ones."""
    boxes = []
    for info in page.get_image_info():
        box = _in_render(pymupdf.Rect(info["bbox"]), page, bounds)
        if box is not None and box.area >= bounds.area * config.min_picture_area_frac:
            boxes.append(box)
    return list(dict.fromkeys(boxes))


def _is_furniture(box: Box, bounds: Box, config: DetectConfig) -> bool:
    """A background, banner or side bar from the template, which every short text on the page
    would otherwise count as a label of."""
    return (
        box.width >= bounds.width * config.page_furniture_frac
        or box.height >= bounds.height * config.page_furniture_frac
    )


def _is_scanned(lines: list[_Line], pictures: list[Box], bounds: Box, config: DetectConfig) -> bool:
    characters = sum(len(line.text.replace(" ", "")) for line in lines)
    covered = sum(box.area for box in pictures)
    return (
        characters < config.scan_max_text_chars
        and covered >= bounds.area * config.scan_min_picture_frac
    )
