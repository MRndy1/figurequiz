"""Blanks land on their fraction of the image, and never on the original."""

from PIL import Image

from app.blank import FILL, Blank, draw_blanks
from app.geometry import Box


def test_a_blank_covers_its_fraction_of_the_image_on_a_copy():
    image = Image.new("RGB", (200, 100), (0, 0, 0))

    out = draw_blanks(image, [Blank(1, Box(0.5, 0.2, 0.9, 0.6))], markers=False)

    assert out.getpixel((140, 40)) == FILL  # inside x 100-180, y 20-60
    assert out.getpixel((20, 80)) == (0, 0, 0)
    assert image.getpixel((140, 40)) == (0, 0, 0)
