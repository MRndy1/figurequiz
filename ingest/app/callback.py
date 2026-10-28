"""Telling web that a document's extraction is done, so it can generate questions.

The document is already `extracted` in Postgres when this runs, so a callback that never
arrives loses no work: the document waits there for web to pick it up again (the build plan's
"Retry generation"). That is why a failed callback is logged, never raised.
"""

from __future__ import annotations

import logging
import time
from uuid import UUID

import httpx

from app.contracts import IngestCallbackBody

log = logging.getLogger(__name__)

ATTEMPTS = 3
RETRY_DELAY_S = 2.0


class Callback:
    def __init__(
        self, url: str, secret: str, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._url = url
        # Redirects are not followed: they would carry the secret to another address.
        self._http = httpx.Client(
            headers={"authorization": f"Bearer {secret}"},
            timeout=httpx.Timeout(30.0, connect=10.0),
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def notify(self, document_id: UUID) -> bool:
        """POST the document id to web. True once web accepts it (any 2xx).

        Network errors and 5xx (a cold start, a deploy) are retried a couple of times; any
        other answer means retrying can't help.
        """
        body = IngestCallbackBody(document_id=document_id).model_dump(mode="json")
        for attempt in range(1, ATTEMPTS + 1):
            try:
                response = self._http.post(self._url, json=body)
            except httpx.HTTPError as error:
                log.warning("callback for %s failed: %s", document_id, error)
            else:
                if response.is_success:
                    log.info("web accepted document %s", document_id)
                    return True
                log.warning(
                    "callback for %s got HTTP %s: %s",
                    document_id,
                    response.status_code,
                    response.text[:200],
                )
                if response.status_code < 500:
                    return False
            if attempt < ATTEMPTS:
                time.sleep(RETRY_DELAY_S * attempt)
        return False
