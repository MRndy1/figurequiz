"""PDF uploads (CLAUDE.md, PDF (Tier 1) and OCR routing), on PDFs built in the test.

Tesseract lives in the ingest image, not on every machine, so the OCR tests fake it at
`read_words` unless it is installed; the ones marked `needs_tesseract` run it for real.
"""

import io
import shutil
import zipfile

import pymupdf
import pytest
from pdfs import A4_H, A4_W, figure_png, ruled_table, save, scan_png, slide
from PIL import Image

from app import ocr
from app.blank import Blank, draw_blanks
from app.contracts import TextBlockPayload
from app.detect import PictureBox
from app.errors import UserFacingError
from app.extract import (
    MAX_PDF_PAGES,
    NOT_A_DECK,
    NOT_A_PDF,
    PDF_PASSWORD,
    UNKNOWN_TYPE,
    PageText,
    extract_pdf,
    extract_upload,
)
from app.geometry import Box
from app.ocr import OcrConfig, OcrText, text_from_data
from app.pdf import PageDetection, detect_page, page_box
from app.render import render_page

needs_tesseract = pytest.mark.skipif(
    shutil.which("tesseract") is None, reason="Tesseract is installed in the ingest image"
)

PICTURE = pymupdf.Rect(300, 100, 660, 370)


def _is_ink(pixel: tuple[int, int, int]) -> bool:
    """Text is drawn black; nothing in `figure_png` is this dark."""
    return max(pixel) < 80


def test_a_text_page_keeps_its_title_out_of_its_lines(tmp_path):
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 80), "What is the brain?", fontsize=32)
    page.insert_text((60, 160), "Together with the spinal cord, it forms the CNS.", fontsize=20)
    page.insert_text((60, 200), "It contains neurons and glial cells.", fontsize=20)
    page.insert_text((900, 520), "2", fontsize=10)

    extraction = extract_pdf(save(document, tmp_path / "lecture.pdf"), tmp_path / "work")

    assert extraction.page_count == 1
    assert extraction.texts == {
        1: PageText(
            TextBlockPayload(
                title="What is the brain?",
                text="Together with the spinal cord, it forms the CNS.\n"
                "It contains neurons and glial cells.\n2",
            ),
            tier=1,
        )
    }
    assert extraction.diagrams == ()
    with Image.open(extraction.pages[0]) as render:
        assert render.size == (1600, 900)


def test_text_labels_on_a_figure_make_a_tier_1_diagram(tmp_path):
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 70), "Animal cell structure", fontsize=32)
    page.insert_image(PICTURE, stream=figure_png())
    for text, point in {
        "Nucleus": (440, 215),
        "Cell membrane": (200, 110),
        "Cytoplasm": (210, 330),
    }.items():
        page.insert_text(point, text, fontsize=14)
    page.insert_text((680, 150), "Prefrontal\ncortex", fontsize=14)  # one label, wrapped

    extraction = extract_pdf(save(document, tmp_path / "cell.pdf"), tmp_path / "work")

    [diagram] = extraction.diagrams
    labels = diagram.payload.labels
    assert (diagram.page, diagram.order, diagram.tier) == (1, 1, 1)
    # Reading order, wrapped lines joined, and the title is no label.
    assert [label.text for label in labels] == [
        "Cell membrane",
        "Prefrontal cortex",
        "Nucleus",
        "Cytoplasm",
    ]
    assert all(label.confidence is None for label in labels)
    assert extraction.texts[1].payload.title == "Animal cell structure"

    with Image.open(diagram.image_path) as crop:
        assert crop.size == (diagram.payload.image_width, diagram.payload.image_height)
        image = crop.convert("RGB")
    assert any(_is_ink(pixel) for pixel in image.get_flattened_data())
    blanks = [
        Blank(number, Box.from_xywh(label.x, label.y, label.w, label.h))
        for number, label in enumerate(labels, start=1)
    ]
    blanked = draw_blanks(image, blanks, markers=False)
    # Every label's box covers its text, and the crop leaves the title out.
    assert not any(_is_ink(pixel) for pixel in blanked.get_flattened_data())


def test_a_title_and_one_label_make_no_false_diagram():
    page = slide(pymupdf.open())
    page.insert_text((300, 92), "Lobes of the brain", fontsize=28)  # just above the picture
    page.insert_image(PICTURE, stream=figure_png())
    page.insert_text((680, 360), "Figure 1", fontsize=12)

    detection = detect_page(page)

    assert detection.title == "Lobes of the brain"
    assert detection.diagrams == ()
    # Its labels may be baked into the pixels.
    assert detection.ocr_candidates == (PictureBox(Box(300, 100, 660, 370)),)


def test_backgrounds_banners_and_logos_are_not_figures():
    page = slide(pymupdf.open())
    background, banner = page.rect, pymupdf.Rect(0, 0, 960, 60)
    page.insert_image(background, stream=figure_png(), keep_proportion=False)
    page.insert_image(banner, stream=figure_png(), keep_proportion=False)
    page.insert_image(pymupdf.Rect(900, 490, 940, 530), stream=figure_png())  # a logo
    page.insert_text((60, 45), "Week 4", fontsize=28)
    page.insert_text((200, 40), "BIO101", fontsize=14)
    page.insert_text((800, 515), "Dr Smith", fontsize=10)
    page.insert_text((820, 530), "Semester 2", fontsize=10)
    page.insert_text((60, 160), "Cells are the basic unit of life.", fontsize=20)

    detection = detect_page(page)

    assert not detection.scanned
    assert detection.diagrams == ()
    assert detection.ocr_candidates == ()


def test_a_rotated_page_s_boxes_land_on_its_render():
    page = pymupdf.open().new_page(width=600, height=400)
    page.insert_image(pymupdf.Rect(300, 150, 500, 300), stream=figure_png())
    page.set_rotation(90)

    detection = detect_page(page)

    # Turned a quarter clockwise, the 600 x 400 page renders 400 x 600, and a point (x, y) of
    # the unrotated page lands at (400 - y, x).
    assert page_box(page) == Box(0, 0, 400, 600)
    [candidate] = detection.ocr_candidates
    assert candidate.box == Box(100, 300, 250, 500)
    render = render_page(page, 1.0)
    assert render.getpixel((175, 400)) != (255, 255, 255)  # the picture
    assert render.getpixel((175, 250)) == (255, 255, 255)  # above it


def test_a_page_that_is_all_pixels_is_a_scan():
    page = pymupdf.open().new_page(width=A4_W, height=A4_H)
    page.insert_image(page.rect, stream=scan_png(["The nervous system"]))
    page.insert_text((290, 820), "12", fontsize=9)  # a page number, the only text

    detection = detect_page(page)

    assert detection.scanned
    assert detection.ocr_candidates == (PictureBox(page_box(page)),)
    assert (detection.title, detection.text, detection.diagrams) == (None, "", ())


def test_ocr_reading_the_text_layer_again_is_no_new_label():
    detection = PageDetection(
        title=None,
        text="",
        diagrams=(),
        ocr_candidates=(),
        title_box=None,
        text_boxes=(Box(100, 100, 300, 120), Box(100, 120, 300, 140)),
        scanned=False,
    )
    # A title in the text layer, over a banner, read off the render: two lines as one.
    assert detection.has_text_at(Box(110, 104, 280, 136))
    assert not detection.has_text_at(Box(110, 200, 200, 220))  # a label of the picture's own
    assert not detection.has_text_at(Box(250, 125, 400, 145))  # mostly beside the text


def test_labels_baked_into_a_figure_make_a_tier_2_diagram(tmp_path, monkeypatch):
    # Tesseract, faked: it reads two labels off whatever picture it is shown, plus the title
    # the text layer draws across that picture's top.
    def read_words(image: Image.Image, config: OcrConfig) -> list[OcrText]:
        w, h = image.size
        return [
            OcrText("Animal", Box(0.05 * w, 0.01 * h, 0.2 * w, 0.05 * h), 96.0),
            OcrText("Vacuole", Box(0.1 * w, 0.2 * h, 0.25 * w, 0.26 * h), 91.0),
            OcrText("Nucleus", Box(0.4 * w, 0.45 * h, 0.55 * w, 0.51 * h), 95.0),
        ]

    monkeypatch.setattr(ocr, "read_words", read_words)
    document = pymupdf.open()
    page = slide(document)
    page.insert_image(PICTURE, stream=figure_png())
    page.insert_text((318, 112), "Animal", fontsize=24)

    extraction = extract_pdf(save(document, tmp_path / "flat.pdf"), tmp_path / "work")

    [diagram] = extraction.diagrams
    assert diagram.tier == 2
    labels = [(label.text, label.confidence) for label in diagram.payload.labels]
    assert labels == [("Vacuole", 91), ("Nucleus", 95)]


def test_a_scanned_page_s_text_keeps_tesseract_s_lines_and_drops_unsure_words():
    data = {
        "text": ["", "Neurons", "carry", "signals", "~~", "Glia", "support", "them"],
        "conf": ["-1", 96.1, 95, 93, 21, 90, 88, 87],
        "block_num": [1, 1, 1, 1, 1, 2, 2, 2],
        "par_num": [1, 1, 1, 1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 1, 1, 1, 1, 2],
    }
    assert text_from_data(data, OcrConfig()) == "Neurons carry signals\nGlia support\nthem"


@needs_tesseract
def test_tesseract_reads_a_flattened_figure_and_a_scanned_page(tmp_path):
    document = pymupdf.open()
    page = slide(document)
    labels = {"Nucleus": (380, 205), "Mitochondrion": (160, 330), "Cell membrane": (70, 30)}
    page.insert_image(pymupdf.Rect(300, 60, 660, 330), stream=figure_png(labels))
    page.insert_text((60, 420), "A flattened textbook figure: its labels are pixels.", fontsize=16)
    scan = document.new_page(width=A4_W, height=A4_H)
    lines = [
        "The nervous system",
        "Neurons carry electrical signals around the body.",
        "Glial cells support and protect the neurons.",
    ]
    scan.insert_image(scan.rect, stream=scan_png(lines))

    extraction = extract_pdf(save(document, tmp_path / "scanned.pdf"), tmp_path / "work")

    [diagram] = extraction.diagrams
    assert (diagram.page, diagram.tier) == (1, 2)
    assert {label.text for label in diagram.payload.labels} == set(labels)
    assert all(label.confidence is not None for label in diagram.payload.labels)
    text = extraction.texts[2]
    assert (text.tier, text.payload.title) == (2, None)
    assert text.payload.text.splitlines() == lines


@pytest.mark.parametrize(
    "content",
    [b"Week 4 notes: the cerebrum has four lobes.", b"", "zip"],
    ids=["text", "empty", "zip"],
)
def test_a_file_that_isnt_a_pdf_fails_legibly(tmp_path, content):
    if content == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("ppt/presentation.xml", "<p:presentation/>")
        content = buffer.getvalue()
    source = tmp_path / "notes.pdf"
    source.write_bytes(content)

    with pytest.raises(UserFacingError) as error:
        extract_pdf(source, tmp_path / "work")
    assert str(error.value) == NOT_A_PDF


def test_a_password_protected_pdf_fails_legibly(tmp_path):
    document = pymupdf.open()
    slide(document).insert_text((60, 80), "Secret notes", fontsize=24)
    source = tmp_path / "locked.pdf"
    source.write_bytes(
        document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="owner")
    )

    with pytest.raises(UserFacingError) as error:
        extract_pdf(source, tmp_path / "work")
    assert str(error.value) == PDF_PASSWORD


def test_a_pdf_that_only_forbids_copying_is_read(tmp_path):
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 80), "Neurons", fontsize=32)
    page.insert_text((60, 160), "Neurons carry signals.", fontsize=20)
    source = tmp_path / "restricted.pdf"
    source.write_bytes(
        document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", permissions=0)
    )

    extraction = extract_pdf(source, tmp_path / "work")
    assert extraction.texts[1].payload.text == "Neurons carry signals."


def test_a_pdf_too_long_to_read_says_how_long(tmp_path):
    document = pymupdf.open()
    for _ in range(MAX_PDF_PAGES + 1):
        slide(document)

    with pytest.raises(UserFacingError) as error:
        extract_pdf(save(document, tmp_path / "textbook.pdf"), tmp_path / "work")
    assert f"has {MAX_PDF_PAGES + 1} pages, and up to {MAX_PDF_PAGES} can be read" in str(
        error.value
    )


@pytest.mark.parametrize(
    ("name", "message"),
    [("notes.docx", UNKNOWN_TYPE), ("deck.pptx", NOT_A_DECK), ("NOTES.PDF", NOT_A_PDF)],
)
def test_an_upload_is_read_as_its_extension_says(tmp_path, name, message):
    source = tmp_path / name
    source.write_text("Week 4 notes")

    with pytest.raises(UserFacingError) as error:
        extract_upload(source, tmp_path / "work")
    assert str(error.value) == message


def test_a_ruled_table_is_read_cell_by_cell():
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 70), "The four lobes", fontsize=32)
    rows = [
        ["Lobe", "Location"],
        ["Frontal", "Front of the head"],
        ["Occipital", "Back of the brain"],
    ]
    ruled_table(page, (60, 120), rows)

    detection = detect_page(page)

    [table] = detection.tables
    assert table.header_rows == 1
    assert [list(row) for row in table.rows] == rows
    # The cells are still text on the page, for text questions.
    assert "Front of the head" in detection.text


def test_a_page_without_ruled_tables_has_none():
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 70), "Lobe Location", fontsize=32)
    page.insert_text((60, 160), "Frontal: front of the head", fontsize=20)

    assert detect_page(page).tables == ()
