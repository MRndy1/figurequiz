"""What the worker does with each job it claims (build plan, Step 4).

Extract: download the deck or PDF, read it (`app.extract`), store every page render and diagram
crop in `renders`, hand the assets (text, diagrams and tables) to `complete_extract`, then tell
web. Blank: draw a diagram
question's gaps on its unblanked crop, store the copy, and mark the question ready.

Asset ids and object keys are deterministic, so a retried job overwrites what an earlier
attempt stored instead of adding to it. A `UserFacingError` means the job can't be done and
says why; anything else is the worker's to retry.
"""

from __future__ import annotations

import logging
import tempfile
import uuid
from collections.abc import Callable
from io import BytesIO
from pathlib import Path, PurePosixPath
from uuid import UUID

from PIL import Image

from app.blank import Blank, draw_blanks
from app.contracts import (
    RENDERS_BUCKET,
    UPLOADS_BUCKET,
    BlankJob,
    CompleteBlankArgs,
    CompleteExtractArgs,
    ExtractedAsset,
    ExtractJob,
    LabeledDiagramAsset,
    TableAsset,
    TextBlockAsset,
    asset_image_key,
    page_render_key,
    question_image_key,
)
from app.errors import UserFacingError
from app.extract import extract_upload
from app.geometry import Box
from app.supa import ObjectNotFound, Supabase

log = logging.getLogger(__name__)

PNG = "image/png"
MISSING_UPLOAD = "The uploaded file has gone missing. Upload the deck again."
MISSING_DIAGRAM = "This diagram's image has gone missing, so its blanks can't be drawn."


def asset_id(document_id: UUID, page: int, name: str) -> UUID:
    """The same asset of the same document always gets the same id: a UUIDv5 named under the
    document's own id."""
    return uuid.uuid5(document_id, f"page-{page}/{name}")


def handle_extract(supa: Supabase, job: ExtractJob, notify: Callable[[UUID], object]) -> None:
    message = job.message
    user, document = message.user_id, message.document_id

    with tempfile.TemporaryDirectory(prefix="extract-") as work:
        # The key's extension is the file's type: `.pptx` or `.pdf`.
        source = Path(work) / f"upload{PurePosixPath(message.storage_path).suffix}"
        source.write_bytes(_download(supa, UPLOADS_BUCKET, message.storage_path, MISSING_UPLOAD))
        extraction = extract_upload(source, Path(work))

        for page, path in enumerate(extraction.pages, start=1):
            key = page_render_key(user, document, page)
            supa.upload(RENDERS_BUCKET, key, path.read_bytes(), PNG)

        assets: list[ExtractedAsset] = [
            TextBlockAsset(
                id=asset_id(document, page, "text"),
                page=page,
                tier=text.tier,
                payload=text.payload,
            )
            for page, text in extraction.texts.items()
        ]
        for diagram in extraction.diagrams:
            id_ = asset_id(document, diagram.page, f"diagram-{diagram.order}")
            key = asset_image_key(user, document, id_)
            supa.upload(RENDERS_BUCKET, key, diagram.image_path.read_bytes(), PNG)
            assets.append(
                LabeledDiagramAsset(
                    id=id_,
                    page=diagram.page,
                    tier=diagram.tier,
                    payload=diagram.payload,
                    image_path=key,
                )
            )
        assets.extend(
            TableAsset(
                id=asset_id(document, table.page, f"table-{table.order}"),
                page=table.page,
                payload=table.payload,
            )
            for table in extraction.tables
        )

    done = supa.complete_extract(
        CompleteExtractArgs(msg_id=job.msg_id, page_count=extraction.page_count, assets=assets)
    )
    if not done:
        log.info("extract %s was already completed or failed; nothing changed", job.msg_id)
        return
    log.info(
        "document %s extracted: %d page(s), %d diagram(s), %d table(s)",
        document,
        extraction.page_count,
        len(extraction.diagrams),
        len(extraction.tables),
    )
    notify(document)


def handle_blank(supa: Supabase, job: BlankJob) -> None:
    message = job.message
    data = _download(supa, RENDERS_BUCKET, message.image_path, MISSING_DIAGRAM)
    blanks = [
        Blank(gap.number, Box.from_xywh(gap.x, gap.y, gap.w, gap.h)) for gap in message.blanks
    ]
    with Image.open(BytesIO(data)) as original:
        blanked = draw_blanks(original.convert("RGB"), blanks)

    buffer = BytesIO()
    blanked.save(buffer, format="PNG")
    key = question_image_key(message.user_id, message.document_id, message.question_id)
    supa.upload(RENDERS_BUCKET, key, buffer.getvalue(), PNG)

    if supa.complete_blank(CompleteBlankArgs(msg_id=job.msg_id, image_path=key)):
        log.info("question %s ready with %d blank(s)", message.question_id, len(blanks))
    else:
        log.info("blank %s was already completed or failed; nothing changed", job.msg_id)


def _download(supa: Supabase, bucket: str, key: str, missing: str) -> bytes:
    try:
        return supa.download(bucket, key)
    except ObjectNotFound as error:
        raise UserFacingError(missing) from error
