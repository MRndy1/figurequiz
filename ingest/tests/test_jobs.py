"""An extract job end to end, with Storage and the database faked. A PDF needs no LibreOffice,
so this runs anywhere: download, read, store every render, hand the assets over, tell web."""

import json
import uuid
from pathlib import Path

import pymupdf
from pdfs import figure_png, ruled_table, slide

from app.contracts import (
    CLAIMED_JOB,
    RENDERS_BUCKET,
    UPLOADS_BUCKET,
    CompleteExtractArgs,
    ExtractJob,
    asset_image_key,
    page_render_key,
)
from app.extract import READERS, extract_deck, extract_pdf
from app.jobs import handle_extract

EXAMPLES = json.loads((Path(__file__).parents[2] / "contracts" / "examples.json").read_text())
PATHS = EXAMPLES["storage_paths"]


class FakeSupabase:
    def __init__(self, files: dict[tuple[str, str], bytes]) -> None:
        self.files = files
        self.uploads: dict[tuple[str, str], str] = {}
        self.completed: list[CompleteExtractArgs] = []

    def download(self, bucket: str, key: str) -> bytes:
        return self.files[(bucket, key)]

    def upload(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.uploads[(bucket, key)] = content_type

    def complete_extract(self, args: CompleteExtractArgs) -> bool:
        self.completed.append(args)
        return True


def _lecture_pdf() -> bytes:
    document = pymupdf.open()
    slide(document).insert_text((60, 80), "Cells", fontsize=32)
    page = slide(document)
    page.insert_text((60, 70), "Animal cell structure", fontsize=32)
    page.insert_image(pymupdf.Rect(300, 100, 660, 370), stream=figure_png())
    page.insert_text((440, 215), "Nucleus", fontsize=14)
    page.insert_text((200, 110), "Cell membrane", fontsize=14)
    return document.tobytes()


def test_uploads_are_read_by_the_extension_their_key_ends_in():
    assert READERS[Path(PATHS["upload"]["key"]).suffix] is extract_deck
    assert READERS[Path(PATHS["pdf_upload"]["key"]).suffix] is extract_pdf


def test_a_pdf_upload_becomes_renders_and_assets():
    row = EXAMPLES["claimed_jobs"][0]
    key = PATHS["pdf_upload"]["key"]
    job = CLAIMED_JOB.validate_python({**row, "message": {**row["message"], "storage_path": key}})
    assert isinstance(job, ExtractJob)
    supa = FakeSupabase({(UPLOADS_BUCKET, key): _lecture_pdf()})
    notified: list[uuid.UUID] = []

    handle_extract(supa, job, notified.append)

    user, document = job.message.user_id, job.message.document_id
    diagram_id = uuid.uuid5(document, "page-2/diagram-1")
    assert supa.uploads == {
        (RENDERS_BUCKET, page_render_key(user, document, 1)): "image/png",
        (RENDERS_BUCKET, page_render_key(user, document, 2)): "image/png",
        (RENDERS_BUCKET, asset_image_key(user, document, diagram_id)): "image/png",
    }
    [args] = supa.completed
    assert (args.msg_id, args.page_count) == (job.msg_id, 2)
    assert [(asset.id, asset.kind, asset.page, asset.tier) for asset in args.assets] == [
        (uuid.uuid5(document, "page-1/text"), "text_block", 1, 1),
        (uuid.uuid5(document, "page-2/text"), "text_block", 2, 1),
        (diagram_id, "labeled_diagram", 2, 1),
    ]
    assert args.assets[0].payload.title == "Cells"
    assert args.assets[2].image_path == asset_image_key(user, document, diagram_id)
    assert [label.text for label in args.assets[2].payload.labels] == ["Cell membrane", "Nucleus"]
    assert notified == [document]


def test_a_pdf_table_becomes_a_table_asset():
    document = pymupdf.open()
    page = slide(document)
    page.insert_text((60, 70), "The four lobes", fontsize=32)
    rows = [
        ["Lobe", "Location"],
        ["Frontal", "Front of the head"],
        ["Occipital", "Back of the brain"],
    ]
    ruled_table(page, (60, 120), rows)
    row = EXAMPLES["claimed_jobs"][0]
    key = PATHS["pdf_upload"]["key"]
    job = CLAIMED_JOB.validate_python({**row, "message": {**row["message"], "storage_path": key}})
    assert isinstance(job, ExtractJob)
    supa = FakeSupabase({(UPLOADS_BUCKET, key): document.tobytes()})

    handle_extract(supa, job, lambda _document: None)

    [args] = supa.completed
    table = args.assets[-1]
    assert (table.id, table.kind, table.page, table.tier, table.image_path) == (
        uuid.uuid5(job.message.document_id, "page-1/table-1"),
        "table",
        1,
        1,
        None,
    )
    assert table.payload.rows == rows
    assert table.payload.header_rows == 1
