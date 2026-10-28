"""The worker's models parse contracts/examples.json, the file web's Zod schemas parse too, and
write back exactly what they read: a shape can't change on one side only."""

import json
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.contracts import (
    CLAIMED_JOB,
    RENDERS_BUCKET,
    UPLOADS_BUCKET,
    BlankBox,
    CompleteBlankArgs,
    CompleteExtractArgs,
    DiagramLabel,
    ExtractMessage,
    IngestCallbackBody,
    LabeledDiagramAsset,
    TableAsset,
    TablePayload,
    TextBlockAsset,
    TextBlockPayload,
    asset_image_key,
    page_render_key,
    question_image_key,
)

EXAMPLES = json.loads((Path(__file__).parents[2] / "contracts" / "examples.json").read_text())


@pytest.mark.parametrize("row", EXAMPLES["claimed_jobs"], ids=lambda row: row["queue_name"])
def test_claimed_jobs_parse_and_write_back_unchanged(row):
    job = CLAIMED_JOB.validate_python(row)
    assert job.queue_name == row["queue_name"]
    assert CLAIMED_JOB.dump_python(job, mode="json") == row


def test_complete_extract_writes_back_unchanged():
    example = EXAMPLES["complete_extract"]
    args = CompleteExtractArgs.model_validate(example)
    assert [type(asset) for asset in args.assets] == [
        TextBlockAsset,
        LabeledDiagramAsset,
        TableAsset,
    ]
    # Tier 2 labels keep their confidence; a text block keeps its `image_path: null`.
    assert args.model_dump(mode="json") == example


def test_a_label_without_confidence_leaves_the_key_out():
    # Zod's `.optional()` accepts a missing key but not null.
    label = DiagramLabel(text="Nucleus", x=0.1, y=0.2, w=0.3, h=0.05)
    assert "confidence" not in label.model_dump(mode="json")


def test_complete_blank_and_the_callback_write_back_unchanged():
    blank = EXAMPLES["complete_blank"]
    assert CompleteBlankArgs.model_validate(blank).model_dump(mode="json") == blank
    body = EXAMPLES["ingest_callback"]["body"]
    assert IngestCallbackBody.model_validate(body).model_dump(mode="json") == body


def test_storage_keys_match_the_examples():
    paths = EXAMPLES["storage_paths"]
    user, document = UUID(paths["user_id"]), UUID(paths["document_id"])
    assert page_render_key(user, document, paths["page"]) == paths["page_render"]["key"]
    assert asset_image_key(user, document, UUID(paths["asset_id"])) == paths["asset_image"]["key"]
    question = UUID(paths["question_id"])
    assert question_image_key(user, document, question) == paths["question_image"]["key"]
    assert paths["upload"]["bucket"] == UPLOADS_BUCKET
    assert {paths[name]["bucket"] for name in ("page_render", "asset_image", "question_image")} == {
        RENDERS_BUCKET
    }


def test_asset_kinds_are_the_databases():
    models = (TextBlockAsset, LabeledDiagramAsset, TableAsset)
    kinds = {model.model_fields["kind"].default for model in models}
    assert kinds == set(EXAMPLES["enums"]["asset_kind"])


def test_unknown_keys_are_refused():
    message = {**EXAMPLES["claimed_jobs"][0]["message"], "filename": "lecture-04.pptx"}
    with pytest.raises(ValidationError):
        ExtractMessage.model_validate(message)


def test_a_box_must_lie_inside_its_image():
    with pytest.raises(ValidationError):
        BlankBox(number=1, x=0.9, y=0.1, w=0.2, h=0.1)
    # Rounding to 4 places may push an edge box just past 1.
    assert BlankBox(number=1, x=0.9, y=0.1, w=0.1001, h=0.1).w == 0.1001


def test_an_object_key_starts_with_the_owner_and_never_names_the_bucket():
    message = EXAMPLES["claimed_jobs"][0]["message"]
    with pytest.raises(ValidationError):
        ExtractMessage.model_validate({**message, "storage_path": f"uploads/{message['user_id']}"})


def test_a_title_cant_be_blank():
    with pytest.raises(ValidationError):
        TextBlockPayload(title="  ", text="")


def test_a_table_must_be_rectangular():
    with pytest.raises(ValidationError):
        TablePayload(rows=[["Lobe", "Location"], ["Frontal"]], header_rows=1)
    with pytest.raises(ValidationError):
        TablePayload(rows=[["Lobe", "Location"]], header_rows=1)
