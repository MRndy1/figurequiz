"""The HTTPS gateway: the secret key travels in `apikey` only, and Storage's answers are read
the way the local stack and the cloud give them."""

import json

import httpx
import pytest

from app.supa import ObjectNotFound, Supabase, SupabaseError

KEY = "sb_secret_test-only"


def _gateway(handler) -> tuple[Supabase, list[httpx.Request]]:  # noqa: ANN001
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    transport = httpx.MockTransport(record)
    return Supabase("https://project.supabase.co", KEY, transport=transport), seen


def test_requests_carry_the_key_in_apikey_and_nowhere_else():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/rpc/claim_next_job":
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"Key": "renders/u/d/pages/001.png"})

    supa, seen = _gateway(handler)
    assert supa.claim_next_job(600) is None
    supa.upload("renders", "u/d/pages/001.png", b"\x89PNG", "image/png")

    assert json.loads(seen[0].content) == {"visibility_seconds": 600}
    upload = seen[1]
    assert upload.method == "POST"
    assert upload.url.path == "/storage/v1/object/renders/u/d/pages/001.png"
    assert upload.headers["content-type"] == "image/png"
    assert upload.headers["x-upsert"] == "true"
    for request in seen:
        assert request.headers["apikey"] == KEY
        assert "authorization" not in request.headers
        assert KEY not in str(request.url)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"message": "Object not found"}),
        # The local stack's answer.
        httpx.Response(400, json={"statusCode": "404", "error": "not_found"}),
    ],
)
def test_a_missing_object_is_not_found(response):
    supa, _ = _gateway(lambda request: response)
    with pytest.raises(ObjectNotFound):
        supa.download("uploads", "u/d.pptx")


def test_a_job_function_returns_what_sql_does_and_errors_raise():
    answers = iter([httpx.Response(200, json=False), httpx.Response(400, json={"code": "22023"})])
    supa, _ = _gateway(lambda request: next(answers))
    assert supa.fail_job("extract", 41, "Couldn't read it.") is False
    with pytest.raises(SupabaseError) as error:
        supa.retry_job_later("nope", 41, 30)
    assert error.value.status_code == 400
