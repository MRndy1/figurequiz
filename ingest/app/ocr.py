"""Tier 2 label extraction: OCR for labels baked into a picture's pixels (CLAUDE.md, Tier 2).

Tesseract reads each word with a pixel box. This module groups the words into labels and
returns them in the shape Tier 1 produces (`LabelBox`, slide points), so blanking and grading
never branch on tier.

Boxes come from OCR, not from a vision model: Tesseract's boxes are pixel-exact and a model's
are approximate, and a blank that misses its label shows the answer. The model only judges
which labels are worth testing.
"""

from __future__ import annotations

import itertools
import re
from collections.abc import Callable
from dataclasses import dataclass

import pymupdf
import pytesseract
from PIL import Image, ImageOps

from app.detect import DetectConfig, Diagram, LabelBox, PictureBox
from app.geometry import Box
from app.render import crop_image, render_page, zoom_for

#: Page segmentation mode 11, "sparse text": labels sit around a figure in no reading order,
#: and the default mode tries to read the picture as columns of prose.
TESSERACT_CONFIG = "--psm 11"
#: The default mode, 3, for the text of a scanned page: that is columns of prose.
PAGE_TESSERACT_CONFIG = "--psm 3"
#: Two letters in a row. Drops stray marks read off the artwork and single-character markers.
_LETTERS = re.compile(r"[^\W\d_]{2}")
#: Leader lines end at the label, so their tips get read as dashes stuck to the word.
_EDGE_PUNCTUATION = " -–—_|.,:;"


@dataclass(frozen=True)
class OcrConfig:
    """Thresholds worth tuning against real figures (see `app.cli ocr`)."""

    #: Tesseract's per-word confidence, 0-100. Texture inside a figure reads as junk words
    #: with low confidence.
    min_confidence: float = 60.0
    #: Words on one line join when the space between them is under this many text heights.
    max_word_gap: float = 1.0
    #: A line at most this many text heights under another, and overlapping it horizontally,
    #: continues the same label ("Prefrontal" over "cortex").
    max_line_gap: float = 1.0
    #: Longer text is a caption or a sentence, not a label: the same rule as Tier 1.
    max_label_words: int = DetectConfig().max_label_words


@dataclass(frozen=True)
class OcrText:
    """A run of text Tesseract read: a word, a line, or a whole label."""

    text: str
    box: Box  # pixels in the image that was read
    confidence: float  # the lowest of its words, 0-100

    def in_slide_space(self, crop: Box, zoom: float) -> LabelBox:
        """This text as a Tier 1-shaped label, given the crop (points) and zoom it was read at.

        Normalized within any crop that contains it, it lands back on these pixels.
        """
        return LabelBox(
            self.text,
            Box(
                crop.x0 + self.box.x0 / zoom,
                crop.y0 + self.box.y0 / zoom,
                crop.x0 + self.box.x1 / zoom,
                crop.y0 + self.box.y1 / zoom,
            ),
            self.confidence,
        )


def words_from_data(data: dict[str, list], config: OcrConfig) -> list[OcrText]:
    """The words worth keeping from `pytesseract.image_to_data(..., output_type=DICT)`."""
    words = []
    columns = (data[key] for key in ("text", "conf", "left", "top", "width", "height"))
    for text, conf, left, top, width, height in zip(*columns, strict=True):
        cleaned = str(text).strip(_EDGE_PUNCTUATION)
        if float(conf) < config.min_confidence or not _LETTERS.search(cleaned):
            continue
        words.append(OcrText(cleaned, Box.from_xywh(left, top, width, height), float(conf)))
    return words


def read_words(image: Image.Image, config: OcrConfig) -> list[OcrText]:
    data = pytesseract.image_to_data(
        ImageOps.grayscale(image), config=TESSERACT_CONFIG, output_type=pytesseract.Output.DICT
    )
    return words_from_data(data, config)


def group_labels(words: list[OcrText], config: OcrConfig) -> list[OcrText]:
    """Join words into lines and wrapped lines into labels, in reading order."""
    lines = [
        _join(group, key=lambda word: word.box.x0)
        for group in _clusters(words, lambda a, b: _same_line(a.box, b.box, config))
    ]
    labels = [
        _join(group, key=lambda line: line.box.y0)
        for group in _clusters(lines, lambda a, b: _continues(a.box, b.box, config))
    ]
    kept = [label for label in labels if len(label.text.split()) <= config.max_label_words]
    return sorted(kept, key=lambda label: (label.box.y0, label.box.x0))


def ocr_picture(
    page: pymupdf.Page,
    picture: PictureBox,
    slide: Box,
    detect: DetectConfig,
    config: OcrConfig,
) -> Diagram | None:
    """Read the labels baked into a picture. A diagram only if it has enough of them."""
    region = picture.box.clipped_to(slide)
    zoom = zoom_for(region)
    image = crop_image(render_page(page, zoom), region, zoom)
    labels = group_labels(read_words(image, config), config)
    if len(labels) < detect.min_labels_per_diagram:
        return None
    return Diagram(picture, tuple(label.in_slide_space(region, zoom) for label in labels))


def text_from_data(data: dict[str, list], config: OcrConfig) -> str:
    """A scanned page's text from `pytesseract.image_to_data(..., output_type=DICT)`: one line
    per line, in Tesseract's reading order, leaving out the words it isn't confident of."""
    lines: dict[tuple[int, int, int], list[str]] = {}
    columns = (data[key] for key in ("text", "conf", "block_num", "par_num", "line_num"))
    for text, conf, block, paragraph, line in zip(*columns, strict=True):
        word = str(text).strip()
        if word and float(conf) >= config.min_confidence:
            lines.setdefault((block, paragraph, line), []).append(word)
    return "\n".join(" ".join(words) for words in lines.values())


def ocr_page_text(page: pymupdf.Page, bounds: Box, config: OcrConfig) -> str:
    """Read the text of a page whose text is all in its pixels: a scan."""
    zoom = zoom_for(bounds)
    data = pytesseract.image_to_data(
        ImageOps.grayscale(render_page(page, zoom)),
        config=PAGE_TESSERACT_CONFIG,
        output_type=pytesseract.Output.DICT,
    )
    return text_from_data(data, config)


def _same_line(a: Box, b: Box, config: OcrConfig) -> bool:
    """Side by side at the same height, no further apart than a generous word space."""
    overlap = min(a.y1, b.y1) - max(a.y0, b.y0)
    gap = max(a.x0 - b.x1, b.x0 - a.x1, 0.0)
    level = overlap >= 0.5 * min(a.height, b.height)
    return level and gap <= config.max_word_gap * max(a.height, b.height)


def _continues(a: Box, b: Box, config: OcrConfig) -> bool:
    """One line just under the other and overlapping it horizontally: a wrapped label."""
    upper, lower = (a, b) if a.y0 <= b.y0 else (b, a)
    overlaps = min(a.x1, b.x1) > max(a.x0, b.x0)
    return overlaps and lower.y0 - upper.y1 <= config.max_line_gap * max(a.height, b.height)


def _clusters(
    items: list[OcrText], joined: Callable[[OcrText, OcrText], bool]
) -> list[list[OcrText]]:
    """Connected groups of `items` under the pairwise `joined` test."""
    parent = list(range(len(items)))

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i, j in itertools.combinations(range(len(items)), 2):
        if joined(items[i], items[j]):
            parent[root(i)] = root(j)

    groups: dict[int, list[OcrText]] = {}
    for index, item in enumerate(items):
        groups.setdefault(root(index), []).append(item)
    return list(groups.values())


def _join(items: list[OcrText], key: Callable[[OcrText], float]) -> OcrText:
    ordered = sorted(items, key=key)
    box = ordered[0].box
    for item in ordered[1:]:
        box = box.union(item.box)
    return OcrText(
        " ".join(item.text for item in ordered), box, min(item.confidence for item in ordered)
    )
