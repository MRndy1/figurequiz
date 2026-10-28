"""The worker's way to Supabase: HTTPS to PostgREST and Storage, and nothing else (build plan,
D-1).

No Postgres connection: port 443 works on any network, and there is no pooler or IPv6 to deal
with. The job functions (supabase/migrations/*_queues_and_jobs.sql) are the worker's whole
database API, called as PostgREST RPCs; Storage is a download and an upload. Every request
carries the worker's secret key in the `apikey` header — never in a URL, and never to any host
but SUPABASE_URL.
"""

from __future__ import annotations

from types import TracebackType
from typing import Any
from urllib.parse import quote

import httpx

from app.contracts import CompleteBlankArgs, CompleteExtractArgs


class SupabaseError(RuntimeError):
    """Supabase answered a request with an error."""

    def __init__(self, what: str, response: httpx.Response) -> None:
        super().__init__(f"{what}: HTTP {response.status_code} {response.text[:300]}")
        self.status_code = response.status_code


class ObjectNotFound(SupabaseError):
    """Storage has nothing at that key."""


class Supabase:
    def __init__(
        self, url: str, secret_key: str, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._http = httpx.Client(
            base_url=url,
            headers={"apikey": secret_key},
            # Generous: a page render is a few hundred kB, and a deck can be 50 MiB.
            timeout=httpx.Timeout(60.0, connect=10.0),
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Supabase:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    # The job functions. Each returns what the SQL function does.

    def claim_next_job(self, visibility_seconds: int) -> dict[str, Any] | None:
        """The next job, blank before extract, as the row `claim_next_job` returns; None when
        both queues are empty. It stays hidden from other workers for `visibility_seconds`."""
        rows = self._rpc("claim_next_job", {"visibility_seconds": visibility_seconds})
        return rows[0] if rows else None

    def complete_extract(self, args: CompleteExtractArgs) -> bool:
        return self._rpc("complete_extract", args.model_dump(mode="json")) is True

    def complete_blank(self, args: CompleteBlankArgs) -> bool:
        return self._rpc("complete_blank", args.model_dump(mode="json")) is True

    def fail_job(self, queue_name: str, msg_id: int, reason: str) -> bool:
        args = {"queue_name": queue_name, "msg_id": msg_id, "reason": reason}
        return self._rpc("fail_job", args) is True

    def retry_job_later(self, queue_name: str, msg_id: int, delay_seconds: int) -> bool:
        args = {"queue_name": queue_name, "msg_id": msg_id, "delay_seconds": delay_seconds}
        return self._rpc("retry_job_later", args) is True

    # Storage. Object keys never include the bucket.

    def download(self, bucket: str, key: str) -> bytes:
        response = self._http.get(f"/storage/v1/object/{bucket}/{quote(key)}")
        if _is_not_found(response):
            raise ObjectNotFound(f"download {bucket}/{key}", response)
        _check(response, f"download {bucket}/{key}")
        return response.content

    def upload(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        """Store `data` at `key`, replacing whatever is there: a retried job overwrites the
        objects an earlier attempt stored."""
        response = self._http.post(
            f"/storage/v1/object/{bucket}/{quote(key)}",
            content=data,
            headers={"content-type": content_type, "x-upsert": "true"},
        )
        _check(response, f"upload {bucket}/{key}")

    def _rpc(self, name: str, args: dict[str, Any]) -> Any:  # noqa: ANN401 - JSON
        response = self._http.post(f"/rest/v1/rpc/{name}", json=args)
        _check(response, f"rpc {name}")
        return response.json()


def _check(response: httpx.Response, what: str) -> None:
    if not response.is_success:
        raise SupabaseError(what, response)


def _is_not_found(response: httpx.Response) -> bool:
    """Storage reports a missing object as HTTP 404, or as HTTP 400 with `statusCode: "404"`
    in the body (the local stack does)."""
    if response.status_code == 404:
        return True
    if response.status_code != 400:
        return False
    try:
        return str(response.json().get("statusCode")) == "404"
    except (ValueError, AttributeError):
        return False
