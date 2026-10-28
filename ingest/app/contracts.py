"""The shapes the worker exchanges with web, and where its files live in Storage.

Postgres is where the two services meet: the worker claims queue messages and hands back
assets through the job functions (supabase/migrations/*_queues_and_jobs.sql). So these models
describe jsonb — snake_case keys, the database's own enum values — and each mirrors a Zod
schema in web/lib/contracts.ts. tests/test_contracts.py parses contracts/examples.json with
them, as web's test does with Zod: change a shape here, there and in that file together.

Models refuse unknown keys, like Zod's strict objects, so drift between the services fails
loudly instead of being dropped.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    StringConstraints,
    TypeAdapter,
    model_serializer,
    model_validator,
)


class _Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


#: Not blank.
Text = Annotated[str, StringConstraints(pattern=r"\S")]
#: A key inside a bucket: it starts with the owner's user id and never names the bucket.
ObjectKey = Annotated[
    str,
    StringConstraints(
        pattern=r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/\S+$"
    ),
]
#: 1-based, as people number slides.
PageNumber = Annotated[int, Field(ge=1)]
#: 1: native extraction from the slide XML. 2: OCR.
Tier = Literal[1, 2]

#: Payload coordinates are stored to this many decimal places...
COORDINATE_PLACES = 4
#: ...which can push a box touching the image's edge just past it.
EDGE_TOLERANCE = 1e-3


class _Box(_Contract):
    """A box as 0-1 fractions of the stored image it is drawn on — the crop, never the slide —
    so nothing downstream needs to know EMU, points or render zoom."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def _inside_image(self) -> Self:
        if self.x + self.w > 1 + EDGE_TOLERANCE or self.y + self.h > 1 + EDGE_TOLERANCE:
            raise ValueError("the box must lie inside the image")
        return self


# Asset payloads (`assets.payload`), written by the worker.


class DiagramLabel(_Box):
    text: Text
    #: Tesseract's 0-100 confidence, on Tier 2 labels only.
    confidence: float | None = Field(default=None, ge=0, le=100)

    @model_serializer(mode="wrap")
    def _omit_missing_confidence(self, handler: SerializerFunctionWrapHandler) -> dict:
        # Zod's `.optional()` takes a missing key, not null.
        data = handler(self)
        if self.confidence is None:
            del data["confidence"]
        return data


class LabeledDiagramPayload(_Contract):
    """Every label extraction found on one diagram. A label's index in `labels` is the
    `label_index` an answer key refers to, so the order never changes once written."""

    labels: list[DiagramLabel] = Field(min_length=1)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)


class TextBlockPayload(_Contract):
    """A slide's or PDF page's visible text. Speaker notes stay out: every question links back
    to its slide, so whatever it tests has to be checkable there."""

    title: Text | None
    #: One paragraph per line, in reading order.
    text: str


class TablePayload(_Contract):
    """A table's cells as text, row by row. A merged cell's text is in its first cell and the cells
    it covers are empty, so every row has the same number of cells. A cell's position is the `row`
    and `col` an answer key refers to, so the cells never move once written."""

    rows: list[Annotated[list[str], Field(min_length=2)]] = Field(min_length=2)
    #: One heading row or none. Heading cells are never blanked.
    header_rows: Literal[0, 1]

    @model_validator(mode="after")
    def _rectangular(self) -> Self:
        if any(len(row) != len(self.rows[0]) for row in self.rows):
            raise ValueError("every row must have the same number of cells")
        return self


class TextBlockAsset(_Contract):
    id: UUID
    page: PageNumber
    kind: Literal["text_block"] = "text_block"
    tier: Tier
    payload: TextBlockPayload
    image_path: None = None


class LabeledDiagramAsset(_Contract):
    id: UUID
    page: PageNumber
    kind: Literal["labeled_diagram"] = "labeled_diagram"
    tier: Tier
    payload: LabeledDiagramPayload
    #: The unblanked crop in `renders` that the payload's boxes are fractions of.
    image_path: ObjectKey


class TableAsset(_Contract):
    id: UUID
    page: PageNumber
    kind: Literal["table"] = "table"
    #: Read from the file's own structure: a table is never OCR'd.
    tier: Literal[1] = 1
    payload: TablePayload
    image_path: None = None


#: One asset as the worker hands it to `complete_extract`; owner and document come from the job.
ExtractedAsset = Annotated[
    TextBlockAsset | LabeledDiagramAsset | TableAsset, Field(discriminator="kind")
]


class CompleteExtractArgs(_Contract):
    msg_id: int
    page_count: int = Field(ge=0)
    assets: list[ExtractedAsset]


# Queue messages, built by the job functions and read by the worker.


class ExtractMessage(_Contract):
    """Built by `enqueue_extract`."""

    document_id: UUID
    user_id: UUID
    #: In `uploads`.
    storage_path: ObjectKey


class BlankBox(_Box):
    """One gap to draw: its marker number and the box of the label it covers."""

    number: int = Field(gt=0)


class BlankMessage(_Contract):
    """Built by `create_question` from a diagram question's answer key and its asset, so it
    holds exactly the blanks the key grades, at the boxes extraction found — and no label
    text."""

    question_id: UUID
    document_id: UUID
    user_id: UUID
    asset_id: UUID
    #: The unblanked crop to draw on, in `renders`. Never modified: the blanked copy is new.
    image_path: ObjectKey
    blanks: list[BlankBox] = Field(min_length=1)


class ExtractJob(_Contract):
    queue_name: Literal["extract"]
    msg_id: int
    read_ct: int = Field(gt=0)
    message: ExtractMessage


class BlankJob(_Contract):
    queue_name: Literal["blank"]
    msg_id: int
    read_ct: int = Field(gt=0)
    message: BlankMessage


#: A row of `claim_next_job`.
ClaimedJob = Annotated[ExtractJob | BlankJob, Field(discriminator="queue_name")]
CLAIMED_JOB: TypeAdapter[ExtractJob | BlankJob] = TypeAdapter(ClaimedJob)


class CompleteBlankArgs(_Contract):
    msg_id: int
    #: The blanked image the worker stored, in `renders`.
    image_path: ObjectKey


class IngestCallbackBody(_Contract):
    """POSTed to web's INGEST_CALLBACK_PATH after `complete_extract` succeeds, with
    `Authorization: Bearer <INGEST_CALLBACK_SECRET>`. Any 2xx response means accepted."""

    document_id: UUID


# Storage. Both buckets are private; the worker reads and writes them with its secret key.

UPLOADS_BUCKET = "uploads"
RENDERS_BUCKET = "renders"


def page_render_key(user_id: UUID, document_id: UUID, page: int) -> str:
    """A page's full render in `renders`: the source slide every question links back to."""
    if page < 1:
        raise ValueError(f"pages are 1-based, not {page}")
    return f"{user_id}/{document_id}/pages/{page:03d}.png"


def asset_image_key(user_id: UUID, document_id: UUID, asset_id: UUID) -> str:
    """A diagram's unblanked crop in `renders`."""
    return f"{user_id}/{document_id}/assets/{asset_id}.png"


def question_image_key(user_id: UUID, document_id: UUID, question_id: UUID) -> str:
    """A diagram question's blanked image in `renders`."""
    return f"{user_id}/{document_id}/questions/{question_id}.png"
