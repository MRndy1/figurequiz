"""Command line for the extraction pipeline.

    python -m app.cli sample  out/sample.pptx
    python -m app.cli inspect samples/lecture-04.pptx --out out/
    python -m app.cli blank   samples/lecture-04.pptx --out out/     # or a .pdf
    python -m app.cli ocr     samples/figure.png --out out/

`inspect` draws every detected box onto the rendered slide so the thresholds in
`DetectConfig` can be judged by eye against real decks. `blank` runs the worker's own
extraction (`app.extract`) on a deck or a PDF and blanks each diagram's first few labels, drawn
the way a blank job draws the labels Claude picks: Tier 1 diagrams from the slide XML or the
PDF's text layer, plus Tier 2 diagrams whose labels OCR found baked into a picture's pixels.
`ocr` runs Tier 2 alone on a plain image, so `OcrConfig` can be tuned against real figures.

The worker that runs this for uploads is `python -m app.worker`.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw
from pptx import Presentation

from app.blank import Blank, draw_blanks
from app.detect import DetectConfig, LabelBox, detect_presentation, visible_slides
from app.extract import diagram_payload, extract_upload, snapped_labels
from app.geometry import Box
from app.ocr import OcrConfig, group_labels, read_words
from app.render import check_page_count, convert_to_pdf, render_page

PICTURE_COLOR = (41, 128, 185)
LABEL_COLOR = (230, 126, 34)
SNAPPED_COLOR = (39, 174, 96)
CROP_COLOR = (142, 68, 173)
OCR_COLOR = (192, 57, 43)
TITLE_COLOR = (127, 140, 141)


def _outline(draw: ImageDraw.ImageDraw, box: Box, zoom: float, color, width: int = 3) -> None:  # noqa: ANN001
    pixels = box.scaled(zoom)
    draw.rectangle((pixels.x0, pixels.y0, pixels.x1, pixels.y1), outline=color, width=width)


def cmd_sample(args: argparse.Namespace) -> int:
    from app.sample_deck import build_sample_deck

    path = build_sample_deck(Path(args.path))
    print(f"wrote {path}")
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    source, out_dir = Path(args.source), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    config = DetectConfig(label_margin_frac=args.margin)

    presentation = Presentation(str(source))
    detections = detect_presentation(presentation, config)
    pdf_path = convert_to_pdf(source, out_dir)
    document = pymupdf.open(pdf_path)
    check_page_count(document, len(visible_slides(presentation)))

    summary = []
    for detection in detections:
        if not detection.diagrams and not detection.ocr_candidates:
            continue
        page = document[detection.index - 1]
        zoom = 1.5
        image = render_page(page, zoom)
        draw = ImageDraw.Draw(image)

        if detection.title_box is not None:
            _outline(draw, detection.title_box, zoom, TITLE_COLOR, 2)
        for diagram in detection.diagrams:
            _outline(draw, diagram.picture.box, zoom, PICTURE_COLOR)
            crop = diagram.crop(_slide_box(image, zoom), config, detection.title_box)
            _outline(draw, crop, zoom, CROP_COLOR, 2)
            for label, snapped in snapped_labels(page, diagram):
                _outline(draw, label.box, zoom, SNAPPED_COLOR if snapped else LABEL_COLOR, 2)
        for candidate in detection.ocr_candidates:
            _outline(draw, candidate.box, zoom, OCR_COLOR)

        target = out_dir / f"slide-{detection.index:02d}.png"
        image.save(target)
        summary.append(
            {
                "slide": detection.index,
                "title": detection.title,
                "diagrams": [
                    {"labels": [label.text for label in diagram.labels]}
                    for diagram in detection.diagrams
                ],
                "ocr_candidates": len(detection.ocr_candidates),
                "image": str(target),
            }
        )
        print(
            f"slide {detection.index:>3}  diagrams={len(detection.diagrams)}  "
            f"ocr={len(detection.ocr_candidates)}  {detection.title or ''}"
        )

    (out_dir / "inspect.json").write_text(json.dumps(summary, indent=2))
    print(f"\n{len(summary)} slide(s) with candidates -> {out_dir}")
    return 0


def cmd_blank(args: argparse.Namespace) -> int:
    source, out_dir = Path(args.source), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    extraction = extract_upload(source, out_dir, DetectConfig(label_margin_frac=args.margin))
    # As create_question cites it: a deck's pages are slides.
    page_name = "page" if source.suffix.lower() == ".pdf" else "slide"

    questions = []
    for diagram in extraction.diagrams:
        # Until Claude picks the labels, take the first few in reading order.
        chosen = diagram.payload.labels[: args.max_blanks]
        blanks = [
            Blank(number, Box.from_xywh(label.x, label.y, label.w, label.h))
            for number, label in enumerate(chosen, start=1)
        ]
        name = f"slide-{diagram.page:02d}-diagram-{diagram.order}"
        with Image.open(diagram.image_path) as original:
            draw_blanks(original, blanks).save(out_dir / f"{name}.png")

        text = extraction.texts.get(diagram.page)
        questions.append(
            {
                "id": name,
                "source_ref": f"{source.name}, {page_name} {diagram.page}",
                "title": text.payload.title if text is not None else None,
                "tier": diagram.tier,
                "image": f"{name}.png",
                "original": str(diagram.image_path.relative_to(out_dir)),
                "blanks": [
                    {
                        "number": blank.number,
                        "answer": label.text,
                        "box": {"x": label.x, "y": label.y, "w": label.w, "h": label.h},
                    }
                    for blank, label in zip(blanks, chosen, strict=True)
                ],
            }
        )
        print(f"{name} (tier {diagram.tier}): {[label.text for label in chosen]}")

    (out_dir / "questions.json").write_text(json.dumps(questions, indent=2))
    print(
        f"\n{extraction.page_count} page(s), {len(questions)} question(s) "
        f"-> {out_dir}/questions.json"
    )
    return 0


def cmd_ocr(args: argparse.Namespace) -> int:
    source, out_dir = Path(args.source), Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    config = OcrConfig()

    image = Image.open(source).convert("RGB")
    started = time.perf_counter()
    labels = group_labels(read_words(image, config), config)
    elapsed_ms = (time.perf_counter() - started) * 1000

    # A plain image is its own frame: boxes stay in its pixels.
    frame = Box(0.0, 0.0, float(image.width), float(image.height))
    payload = diagram_payload(
        [LabelBox(label.text, label.box, label.confidence) for label in labels], frame, image.size
    )
    entries = payload.labels if payload is not None else []
    blanks = [
        Blank(number, Box.from_xywh(entry.x, entry.y, entry.w, entry.h))
        for number, entry in enumerate(entries, start=1)
    ]
    draw_blanks(image, blanks).save(out_dir / f"{source.stem}-blanked.png")
    if payload is not None:
        labels_json = json.dumps(payload.model_dump(mode="json"), indent=2)
        (out_dir / f"{source.stem}-labels.json").write_text(labels_json)

    for number, entry in enumerate(entries, start=1):
        print(
            f"{number:>2}. {entry.text:<24} x={entry.x:.3f} y={entry.y:.3f} "
            f"w={entry.w:.3f} h={entry.h:.3f}  confidence={entry.confidence:.0f}"
        )
    print(f"\n{len(entries)} label(s) in {elapsed_ms:.0f} ms -> {out_dir}")
    return 0


def _slide_box(image, zoom: float) -> Box:  # noqa: ANN001
    return Box(0.0, 0.0, image.width / zoom, image.height / zoom)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sample = sub.add_parser("sample", help="write a synthetic deck for testing")
    sample.add_argument("path", nargs="?", default="out/sample.pptx")
    sample.set_defaults(func=cmd_sample)

    for name, func, help_text in (
        ("inspect", cmd_inspect, "draw detected boxes onto each candidate slide"),
        ("blank", cmd_blank, "write blanked question images and their answer key"),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("source")
        command.add_argument("--out", default="out")
        command.add_argument("--margin", type=float, default=DetectConfig().label_margin_frac)
        if name == "blank":
            command.add_argument("--max-blanks", type=int, default=3, dest="max_blanks")
        command.set_defaults(func=func)

    ocr = sub.add_parser("ocr", help="read the labels baked into an image and blank them")
    ocr.add_argument("source")
    ocr.add_argument("--out", default="out")
    ocr.set_defaults(func=cmd_ocr)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
