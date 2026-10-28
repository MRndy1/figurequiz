"""Telling web a document is extracted: the contract's body and header, and when to retry."""

import json
from uuid import UUID

import httpx
import pytest

from app import callback
from app.callback import Callback

URL = "https://figurequiz.online/api/ingest/callback"
DOCUMENT = UUID("0b7e3c1a-2d4f-4e6a-9b8c-7d6e5f4a3b2c")


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(callback, "RETRY_DELAY_S", 0)


def _notify(*answers: httpx.Response | Exception) -> tuple[bool, list[httpx.Request]]:
    seen: list[httpx.Request] = []
    replies = iter(answers)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        reply = next(replies)
        if isinstance(reply, Exception):
            raise reply
        return reply

    hook = Callback(URL, "callback-secret", transport=httpx.MockTransport(handler))
    return hook.notify(DOCUMENT), seen


def test_posts_the_document_id_with_the_shared_secret():
    accepted, [request] = _notify(httpx.Response(202))
    assert accepted
    assert (request.method, str(request.url)) == ("POST", URL)
    assert request.headers["authorization"] == "Bearer callback-secret"
    assert json.loads(request.content) == {"document_id": str(DOCUMENT)}


def test_a_cold_start_or_network_error_is_retried():
    refused = httpx.ConnectError("connection refused")
    accepted, seen = _notify(refused, httpx.Response(503), httpx.Response(202))
    assert accepted
    assert len(seen) == 3


def test_a_refusal_is_not_retried_and_never_raises():
    accepted, seen = _notify(httpx.Response(401))
    assert not accepted
    assert len(seen) == 1
