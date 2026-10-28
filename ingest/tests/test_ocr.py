"""Tier 2 grouping, checked without Tesseract: its output is faked at the dict it returns."""

import pytest

from app.blank import to_pixels
from app.geometry import Box
from app.ocr import OcrConfig, OcrText, group_labels, words_from_data

CONFIG = OcrConfig()


def word(text: str, x0: float, y0: float, x1: float, y1: float) -> OcrText:
    return OcrText(text, Box(x0, y0, x1, y1), 95.0)


def texts(labels: list[OcrText]) -> list[str]:
    return [label.text for label in labels]


def test_keeps_confident_words_and_trims_leader_line_dashes():
    data = {
        "text": ["", "Amygdala-", "B", "Illl", "~~"],
        "conf": ["-1", 96.4, 93, 35, 88],
        "left": [0, 10, 200, 300, 400],
        "top": [0, 10, 10, 10, 10],
        "width": [0, 120, 9, 40, 12],
        "height": [0, 30, 12, 30, 6],
    }
    words = words_from_data(data, CONFIG)
    assert texts(words) == ["Amygdala"]
    assert words[0].box == Box(10, 10, 130, 40)


def test_words_on_one_line_join_into_a_label():
    words = [word("gland", 228, 202, 300, 236), word("Pituitary", 100, 200, 218, 236)]
    assert texts(group_labels(words, CONFIG)) == ["Pituitary gland"]


def test_labels_on_the_same_row_stay_apart():
    words = [
        word("Frontal", 100, 100, 190, 125),
        word("lobe", 198, 100, 245, 125),
        word("Parietal", 500, 100, 595, 125),
        word("lobe", 603, 100, 650, 125),
    ]
    assert texts(group_labels(words, CONFIG)) == ["Frontal lobe", "Parietal lobe"]


def test_a_wrapped_label_joins_its_second_line():
    words = [word("Prefrontal", 40, 280, 200, 301), word("cortex", 110, 319, 200, 337)]
    labels = group_labels(words, CONFIG)
    assert texts(labels) == ["Prefrontal cortex"]
    assert labels[0].box == Box(40, 280, 200, 337)


def test_stacked_labels_stay_apart():
    words = [
        word("Occipital", 830, 446, 925, 471),
        word("lobe", 933, 446, 980, 471),
        word("Cerebellum", 818, 540, 958, 565),
    ]
    assert texts(group_labels(words, CONFIG)) == ["Occipital lobe", "Cerebellum"]


def test_a_caption_is_too_long_to_be_a_label():
    words, x = [], 0.0
    for text in ["Each", "hemisphere", "has", "four", "lobes", "and", "a", "cerebellum"]:
        words.append(word(text, x, 600, x + 10 * len(text), 625))
        x += 10 * len(text) + 8
    assert group_labels(words, CONFIG) == []


def test_slide_space_round_trips_through_blanking():
    crop, zoom = Box(120.0, 80.0, 560.0, 420.0), 2.0
    label = OcrText("Cerebellum", Box(600, 300, 740, 330), 97.0)
    in_slide = label.in_slide_space(crop, zoom)
    # The stored crop is the same region at the same zoom: 880 x 680 pixels.
    drawn = to_pixels(in_slide.box.normalized_within(crop), (880, 680))
    assert (drawn.x0, drawn.y0, drawn.x1, drawn.y1) == pytest.approx((600, 300, 740, 330))
    assert in_slide.confidence == 97.0
