"""Slide titles without a title placeholder (docs/prototype-questions.md, §4.6): found, and kept
out of a diagram's labels and the slide's body text."""

from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.util import Inches

from app.detect import DetectConfig, detect_presentation, table_grid
from app.sample_deck import build_sample_deck


def _figure(tmp_path: Path) -> Path:
    path = tmp_path / "figure.png"
    Image.new("RGB", (640, 480), (214, 234, 248)).save(path)
    return path


def _slide(tmp_path: Path, layout: int = 6):  # noqa: ANN202
    """A widescreen deck with one slide, by default of the blank layout: no title placeholder."""
    presentation = Presentation()
    presentation.slide_width, presentation.slide_height = Inches(13.333), Inches(7.5)
    slide = presentation.slides.add_slide(presentation.slide_layouts[layout])
    # Placed like slide 3 of the sample brain deck: a heading 0.3 in above the picture, close
    # enough to count as one of its labels.
    slide.shapes.add_picture(str(_figure(tmp_path)), Inches(3.3), Inches(1.5), Inches(6.4))
    return presentation, slide


def _text(slide, text: str, left: float, top: float, width: float = 1.8) -> None:  # noqa: ANN001
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(0.4))
    box.text_frame.text = text


def test_a_text_box_heading_is_the_title_and_not_a_label(tmp_path):
    presentation, slide = _slide(tmp_path)
    _text(slide, "Lobes of the Brain", 0.7, 0.8, width=8)
    _text(slide, "Frontal lobe", 1.6, 2.0)
    _text(slide, "Cerebellum", 9.8, 5.0)

    [detection] = detect_presentation(presentation)

    assert detection.title == "Lobes of the Brain"
    assert detection.title_box is not None
    assert [label.text for label in detection.diagrams[0].labels] == ["Frontal lobe", "Cerebellum"]
    assert detection.text == "Frontal lobe\nCerebellum"


def test_an_empty_title_placeholder_doesnt_hide_the_text_box_heading(tmp_path):
    presentation, slide = _slide(tmp_path, layout=5)  # "Title Only", its title left empty
    _text(slide, "Lobes of the Brain", 0.7, 0.8, width=8)
    _text(slide, "Frontal lobe", 1.6, 2.0)
    _text(slide, "Cerebellum", 9.8, 5.0)

    [detection] = detect_presentation(presentation)

    assert detection.title == "Lobes of the Brain"
    assert [label.text for label in detection.diagrams[0].labels] == ["Frontal lobe", "Cerebellum"]


def test_a_heading_and_one_label_make_no_false_diagram(tmp_path):
    presentation, slide = _slide(tmp_path)
    _text(slide, "Lobes of the Brain", 0.7, 0.8, width=8)
    _text(slide, "Figure 1", 9.8, 5.0)

    [detection] = detect_presentation(presentation)

    assert detection.diagrams == ()
    assert len(detection.ocr_candidates) == 1  # its labels may be baked into the pixels


def test_a_long_heading_is_no_title_and_steals_no_label(tmp_path):
    presentation, slide = _slide(tmp_path)
    _text(slide, "How the four lobes of each cerebral hemisphere divide up the work", 0.7, 0.2, 10)
    _text(slide, "Frontal lobe", 1.6, 1.2)
    _text(slide, "Cerebellum", 9.8, 5.0)

    [detection] = detect_presentation(presentation)

    assert detection.title is None
    assert [label.text for label in detection.diagrams[0].labels] == ["Frontal lobe", "Cerebellum"]


def test_the_sample_deck_keeps_its_titles_and_labels(tmp_path):
    presentation = Presentation(str(build_sample_deck(tmp_path / "sample.pptx")))

    detections = detect_presentation(presentation)

    # Slide 3 has no title, and its labels sit in a group, so none of them is taken for one.
    assert [d.title for d in detections] == [
        "Animal cell structure",
        "Scanned figure from the textbook",
        None,
    ]
    assert {label.text for label in detections[0].diagrams[0].labels} == {
        "Nucleus",
        "Cell membrane",
        "Mitochondrion",
        "Cytoplasm",
    }
    assert "Animal cell structure" not in detections[0].text
    assert [label.text for label in detections[2].diagrams[0].labels] == ["Vacuole", "Ribosome"]


def test_a_table_shape_is_read_cell_by_cell(tmp_path):
    presentation, slide = _slide(tmp_path)
    shape = slide.shapes.add_table(3, 2, Inches(0.5), Inches(0.5), Inches(6), Inches(2))
    for row, cells in enumerate(
        [["Lobe", "Location"], ["Frontal", "Front of\nthe head"], ["Occipital", ""]]
    ):
        for col, text in enumerate(cells):
            shape.table.cell(row, col).text = text

    [detection] = detect_presentation(presentation)

    [table] = detection.tables
    # PowerPoint's "Header Row" option is on for a new table; a wrapped cell reads as one line.
    assert table.header_rows == 1
    assert table.rows == (("Lobe", "Location"), ("Frontal", "Front of the head"), ("Occipital", ""))
    # Its text still reaches the slide's text, for text questions.
    assert "Frontal\tFront of\nthe head" in detection.text


def test_a_merged_cell_keeps_its_text_in_its_first_cell(tmp_path):
    presentation, slide = _slide(tmp_path)
    shape = slide.shapes.add_table(3, 2, Inches(0.5), Inches(0.5), Inches(6), Inches(2))
    shape.table.cell(0, 0).merge(shape.table.cell(0, 1))
    shape.table.cell(0, 0).text = "Lobes"
    for row, cells in enumerate([["Frontal", "Front"], ["Occipital", "Back"]], start=1):
        for col, text in enumerate(cells):
            shape.table.cell(row, col).text = text

    [detection] = detect_presentation(presentation)

    assert detection.tables[0].rows[0] == ("Lobes", "")


def test_tables_too_small_too_big_or_too_empty_are_left_out():
    config = DetectConfig(max_table_rows=4, max_table_cols=3)
    assert table_grid([["Lobe"], ["Frontal"]], 1, config) is None
    assert table_grid([["A", "B"]] * 5, 1, config) is None
    assert table_grid([["A", "B", "C", "D"]] * 3, 1, config) is None
    # Headings and one filled cell leave nothing worth two blanks.
    assert table_grid([["Lobe", "Location"], ["Frontal", ""], ["", ""]], 1, config) is None
    assert table_grid([["Lobe", "Location"], ["Frontal", "Front"]], 1, config) is not None
