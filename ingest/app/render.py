"""Slide rendering: LibreOffice converts PPTX to PDF, PyMuPDF turns pages into images.

python-pptx cannot render (CLAUDE.md, Gotchas), so this is the only path to pixels. It is
also how label boxes get corrected: a text frame is usually much wider than the words in it,
so blanking the XML box would cover part of the diagram. Searching the rendered page for the
label's own text gives the drawn extent, and absorbs LibreOffice's slight drift from
PowerPoint at the same time.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import uuid
from pathlib import Path

import pymupdf
from PIL import Image

from app.errors import UserFacingError
from app.geometry import Box

log = logging.getLogger(__name__)

SOFFICE = os.environ.get("SOFFICE_BIN", "soffice")
CONVERT_TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "180"))
#: Pages are rendered at this zoom before cropping, so a diagram filling a third of a slide
#: still lands around 1300 px wide instead of an unreadable 600.
BASE_ZOOM = 2.0
MAX_CROP_PX = 1920


class RenderError(UserFacingError):
    """The slides couldn't be rendered. The message never names the file: the worker renders
    a temporary copy, and the student sees the message next to their own file's name."""


def convert_to_pdf(source: Path, out_dir: Path, timeout: int = CONVERT_TIMEOUT_S) -> Path:
    """Convert a PPTX to PDF with headless LibreOffice.

    Each run gets its own user profile so concurrent conversions cannot corrupt a shared one,
    and the whole process group is killed on timeout — LibreOffice leaves children behind.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    profile = out_dir / f"lo-profile-{uuid.uuid4().hex}"

    process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
        [
            SOFFICE,
            "--headless",
            "--norestore",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir),
            str(source),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        process.communicate()
        raise RenderError(
            f"Couldn't render the slides: it took longer than {timeout} seconds. "
            "Try splitting the deck into smaller ones."
        ) from None

    pdf_path = out_dir / f"{source.stem}.pdf"
    if process.returncode != 0 or not pdf_path.exists():
        detail = output.decode("utf-8", "replace").strip().splitlines()
        tail = detail[-1] if detail else f"exit code {process.returncode}"
        log.warning("LibreOffice couldn't convert %s: %s", source.name, tail)
        raise RenderError(
            "Couldn't render the slides. Open the deck in PowerPoint, save it again as .pptx, "
            "and upload that copy."
        )
    return pdf_path


def check_page_count(document: pymupdf.Document, expected: int) -> None:
    """Guard the slide-number-to-page mapping that every `source_ref` depends on."""
    if document.page_count != expected:
        raise RenderError(
            f"Couldn't line up the slides with their renders: {expected} visible slides but "
            f"{document.page_count} rendered pages."
        )


def zoom_for(crop: Box, base_zoom: float = BASE_ZOOM, max_px: int = MAX_CROP_PX) -> float:
    """Render zoom for a crop: `base_zoom`, lowered if that would exceed `max_px`."""
    longest = max(crop.width, crop.height)
    if longest <= 0:
        return base_zoom
    return min(base_zoom, max_px / longest)


def render_page(page: pymupdf.Page, zoom: float) -> Image.Image:
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def crop_image(image: Image.Image, crop: Box, zoom: float) -> Image.Image:
    """Cut `crop` (points) out of a page rendered at `zoom`."""
    pixels = crop.scaled(zoom)
    return image.crop(
        (
            max(int(pixels.x0), 0),
            max(int(pixels.y0), 0),
            min(int(pixels.x1), image.width),
            min(int(pixels.y1), image.height),
        )
    )


def snap_label_box(
    page: pymupdf.Page, text: str, around: Box, search_pad: float = 6.0
) -> Box | None:
    """Find where `text` is actually drawn near `around`, in points.

    Returns None when the text can't be found — the caller keeps the XML box, padded.
    """
    clip = pymupdf.Rect(*_as_tuple(around.expanded(search_pad)))
    candidates = [text, *(line.strip() for line in text.splitlines())]

    for needle in candidates:
        if not needle:
            continue
        hits = page.search_for(needle, clip=clip)
        if hits:
            found = Box(hits[0].x0, hits[0].y0, hits[0].x1, hits[0].y1)
            for hit in hits[1:]:
                found = found.union(Box(hit.x0, hit.y0, hit.x1, hit.y1))
            return found
    return None


def _as_tuple(box: Box) -> tuple[float, float, float, float]:
    return (box.x0, box.y0, box.x1, box.y1)
