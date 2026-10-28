"""Drawing the blanks over a diagram's labels.

Never mutates the original render (CLAUDE.md) — every call works on a copy. Boxes are 0-1
fractions of the image they are drawn on, the form a blank job's message carries
(`contracts.BlankBox`), so the worker and the CLI draw with the same code.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

from app.geometry import Box

#: Extra pixels around a blank. Label boxes are snapped to the drawn text, but antialiasing
#: and LibreOffice's slight drift still leave a fringe.
BLANK_PAD_PX = 3
FILL = (245, 245, 245)
OUTLINE = (120, 120, 120)
MARKER_FILL = (30, 30, 30)
MARKER_TEXT = (255, 255, 255)


@dataclass(frozen=True)
class Blank:
    """One numbered gap, and only where it sits: the answer never reaches the drawing code."""

    number: int
    box: Box  # 0-1 fractions of the image


def to_pixels(box: Box, size: tuple[int, int]) -> Box:
    """Map a box of 0-1 fractions onto an image of `size` (width, height)."""
    width, height = size
    return Box(box.x0 * width, box.y0 * height, box.x1 * width, box.y1 * height)


def _marker_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def draw_blanks(
    image: Image.Image,
    blanks: list[Blank],
    *,
    markers: bool = True,
) -> Image.Image:
    """Return a copy of `image` with each blank covered and numbered."""
    out = image.copy()
    draw = ImageDraw.Draw(out)

    for blank in blanks:
        pixels = to_pixels(blank.box, out.size)
        rect = (
            max(pixels.x0 - BLANK_PAD_PX, 0),
            max(pixels.y0 - BLANK_PAD_PX, 0),
            min(pixels.x1 + BLANK_PAD_PX, out.width),
            min(pixels.y1 + BLANK_PAD_PX, out.height),
        )
        draw.rectangle(rect, fill=FILL, outline=OUTLINE, width=2)

        if not markers:
            continue

        # A numbered disc on the left edge of the gap, keyed to the answer inputs.
        height = max(rect[3] - rect[1], 14)
        radius = max(min(height * 0.45, 18), 9)
        cx, cy = rect[0] + radius, (rect[1] + rect[3]) / 2
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=MARKER_FILL)
        draw.text(
            (cx, cy),
            str(blank.number),
            fill=MARKER_TEXT,
            font=_marker_font(int(radius * 1.3)),
            anchor="mm",
        )

    return out
