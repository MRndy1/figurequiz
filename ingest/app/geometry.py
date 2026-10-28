"""Rectangle maths and the unit conversions used across extraction.

Three coordinate systems meet in this service:

* **EMU** — what python-pptx reports for shape positions (914400 per inch).
* **Points** — what a PDF page uses (72 per inch). Everything in this package works in
  points, so shape boxes read from the XML and text boxes found in the rendered PDF are
  directly comparable.
* **Pixels** — only once a page has been rendered at a chosen zoom.

Normalized 0-1 coordinates are produced at the very end, when an asset payload is written,
relative to the cropped image (see CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import dataclass

EMU_PER_PT = 12700


def emu_to_pt(emu: float) -> float:
    return emu / EMU_PER_PT


@dataclass(frozen=True)
class Box:
    """An axis-aligned rectangle. Callers keep x0 <= x1 and y0 <= y1."""

    x0: float
    y0: float
    x1: float
    y1: float

    @classmethod
    def from_xywh(cls, x: float, y: float, width: float, height: float) -> Box:
        return cls(x, y, x + width, y + height)

    @classmethod
    def from_corners(cls, x0: float, y0: float, x1: float, y1: float) -> Box:
        """Build a box from two corners in any order."""
        return cls(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    def union(self, other: Box) -> Box:
        return Box(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )

    def intersection(self, other: Box) -> Box | None:
        x0, y0 = max(self.x0, other.x0), max(self.y0, other.y0)
        x1, y1 = min(self.x1, other.x1), min(self.y1, other.y1)
        if x0 >= x1 or y0 >= y1:
            return None
        return Box(x0, y0, x1, y1)

    def gap_to(self, other: Box) -> float:
        """Distance between the two rectangles, 0 when they touch or overlap.

        Measured as the larger of the horizontal and vertical gaps, so a label sitting
        diagonally away from a picture has to be close on both axes to count as nearby.
        """
        dx = max(self.x0 - other.x1, other.x0 - self.x1, 0.0)
        dy = max(self.y0 - other.y1, other.y0 - self.y1, 0.0)
        return max(dx, dy)

    def fraction_inside(self, other: Box) -> float:
        """How much of this box lies inside `other`, 0.0-1.0."""
        if self.area <= 0:
            return 0.0
        overlap = self.intersection(other)
        return 0.0 if overlap is None else overlap.area / self.area

    def expanded(self, pad: float) -> Box:
        return Box(self.x0 - pad, self.y0 - pad, self.x1 + pad, self.y1 + pad)

    def clipped_to(self, bounds: Box) -> Box:
        return Box(
            max(self.x0, bounds.x0),
            max(self.y0, bounds.y0),
            min(self.x1, bounds.x1),
            min(self.y1, bounds.y1),
        )

    def scaled(self, factor: float) -> Box:
        return Box(self.x0 * factor, self.y0 * factor, self.x1 * factor, self.y1 * factor)

    def normalized_within(self, frame: Box) -> Box:
        """Express this box as 0-1 fractions of `frame` — the form stored in payloads."""
        if frame.width <= 0 or frame.height <= 0:
            raise ValueError("frame has no area")
        return Box(
            (self.x0 - frame.x0) / frame.width,
            (self.y0 - frame.y0) / frame.height,
            (self.x1 - frame.x0) / frame.width,
            (self.y1 - frame.y0) / frame.height,
        )
