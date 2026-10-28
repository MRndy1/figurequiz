"""The ingest worker: claims jobs from the `extract` and `blank` queues and runs them.

    python -m app.worker               # keep working, waiting whenever both queues are empty
    python -m app.worker --once        # exit once both queues are empty (a scheduled job)

`claim_next_job` hands out blank jobs before extract jobs: they are small, and a student may
be waiting on one. While both queues are empty the worker asks less and less often, down to
every 15 seconds.

A claimed job stays hidden from other workers for `--visibility` seconds. If this worker dies
mid-job, the job reappears after that with `read_ct` one higher, so a job claimed more than
three times is failed without another try: a deck that kills the worker can't loop forever.

SIGTERM or Ctrl-C lets the current job finish, then exits; a second one exits at once, and the
job reappears after its visibility timeout.

Settings come from the environment: see ingest/.env.example.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import ValidationError

from app.callback import Callback
from app.contracts import CLAIMED_JOB, ExtractJob
from app.errors import UserFacingError
from app.jobs import handle_blank, handle_extract
from app.supa import Supabase

log = logging.getLogger("app.worker")

#: `read_ct` counts claims, so a job claimed a fourth time has had its three attempts.
MAX_ATTEMPTS = 3
#: A job that broke unexpectedly waits this long times its attempts so far, then runs again.
RETRY_DELAY_S = 30
DEFAULT_VISIBILITY_S = 600
IDLE_WAITS_S = (1, 2, 4, 8, 15)

GAVE_UP = {
    "extract": (
        "We couldn't finish reading this deck after three tries. Upload it again, and if it "
        "keeps failing, split it into smaller decks."
    ),
    "blank": "We couldn't draw the blanks on this diagram after three tries.",
}
UNREADABLE_JOB = "Something went wrong on our side with this file. Upload it again."

#: Plain http is allowed only to these, for a Supabase or web running on this machine.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_secret_key: str
    #: Where to tell web an extraction finished. Unset, web doesn't hear about it.
    callback_url: str | None
    callback_secret: str | None

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read and check the settings. Raises ValueError saying what is wrong."""
        missing = [name for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY") if not env.get(name)]
        if missing:
            raise ValueError(f"{' and '.join(missing)} must be set (see ingest/.env.example)")
        callback_url = env.get("INGEST_CALLBACK_URL") or None
        callback_secret = env.get("INGEST_CALLBACK_SECRET") or None
        if callback_url is not None:
            _check_secure("INGEST_CALLBACK_URL", callback_url)
            if callback_secret is None:
                raise ValueError("INGEST_CALLBACK_SECRET must be set with INGEST_CALLBACK_URL")
        return cls(
            supabase_url=_check_secure("SUPABASE_URL", env["SUPABASE_URL"]),
            supabase_secret_key=env["SUPABASE_SECRET_KEY"],
            callback_url=callback_url,
            callback_secret=callback_secret,
        )


def _check_secure(name: str, url: str) -> str:
    """Both URLs receive a secret, so it must not cross a network in the clear."""
    parts = urlsplit(url)
    if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOCAL_HOSTS):
        return url
    raise ValueError(f"{name} must be an https:// URL (plain http only on this machine): {url}")


class Worker:
    def __init__(
        self,
        supa: Supabase,
        notify: Callable[[UUID], object],
        *,
        visibility_s: int,
        stop: threading.Event,
    ) -> None:
        self._supa = supa
        self._notify = notify
        self._visibility_s = visibility_s
        self._stop = stop

    def run(self, *, once: bool) -> int:
        """Work until stopped or, with `once`, until both queues are empty. Returns the exit
        status."""
        idle = 0
        while not self._stop.is_set():
            try:
                row = self._supa.claim_next_job(self._visibility_s)
            except Exception:
                log.exception("couldn't claim a job")
                if once:
                    return 1
                row = None

            if row is None:
                if once:
                    break
                self._stop.wait(IDLE_WAITS_S[min(idle, len(IDLE_WAITS_S) - 1)])
                idle += 1
                continue

            idle = 0
            try:
                self.process(row)
            except Exception:
                # Supabase unreachable mid-job, say: the job reappears after its visibility
                # timeout and is claimed again.
                log.exception("job %s %s stopped", row.get("queue_name"), row.get("msg_id"))
        return 0

    def process(self, row: dict[str, Any]) -> None:
        """Run one claimed job, and fail or reschedule it if it can't be done."""
        try:
            job = CLAIMED_JOB.validate_python(row)
        except ValidationError:
            log.exception("job %s %s isn't readable", row.get("queue_name"), row.get("msg_id"))
            self._supa.fail_job(row["queue_name"], row["msg_id"], UNREADABLE_JOB)
            return

        name = f"{job.queue_name} {job.msg_id}"
        if job.read_ct > MAX_ATTEMPTS:
            log.warning("%s: claimed %d times, giving up", name, job.read_ct)
            self._supa.fail_job(job.queue_name, job.msg_id, GAVE_UP[job.queue_name])
            return

        log.info("%s: attempt %d", name, job.read_ct)
        started = time.monotonic()
        try:
            if isinstance(job, ExtractJob):
                handle_extract(self._supa, job, self._notify)
            else:
                handle_blank(self._supa, job)
        except UserFacingError as error:
            log.info("%s failed: %s", name, error)
            self._supa.fail_job(job.queue_name, job.msg_id, str(error))
        except Exception:
            if job.read_ct >= MAX_ATTEMPTS:
                log.exception("%s broke on its last attempt", name)
                self._supa.fail_job(job.queue_name, job.msg_id, GAVE_UP[job.queue_name])
            else:
                delay = RETRY_DELAY_S * job.read_ct
                log.exception("%s broke; trying again in %d s", name, delay)
                self._supa.retry_job_later(job.queue_name, job.msg_id, delay)
        else:
            log.info("%s done in %.1f s", name, time.monotonic() - started)


def _stop_on_signals(stop: threading.Event) -> None:
    def handle(signum: int, _frame: object) -> None:
        if stop.is_set():
            raise SystemExit(128 + signum)
        log.info("%s: finishing the current job, then stopping", signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)


def _no_callback(document_id: UUID) -> None:
    log.warning("INGEST_CALLBACK_URL isn't set: web won't hear that %s is extracted", document_id)


def _visibility(text: str) -> int:
    seconds = int(text)
    if not 1 <= seconds <= 3600:
        raise argparse.ArgumentTypeError("must be between 1 and 3600 seconds")
    return seconds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="app.worker", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--once", action="store_true", help="exit once both queues are empty")
    parser.add_argument(
        "--visibility",
        type=_visibility,
        default=DEFAULT_VISIBILITY_S,
        metavar="SECONDS",
        help="how long a claimed job stays hidden from other workers, 1-3600 (default 600)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # httpx logs every request at INFO, which would be one line per idle poll.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    try:
        settings = Settings.from_env(os.environ)
    except ValueError as error:
        parser.error(str(error))

    stop = threading.Event()
    _stop_on_signals(stop)
    callback = (
        Callback(settings.callback_url, settings.callback_secret)
        if settings.callback_url and settings.callback_secret
        else None
    )
    try:
        with Supabase(settings.supabase_url, settings.supabase_secret_key) as supa:
            worker = Worker(
                supa,
                callback.notify if callback is not None else _no_callback,
                visibility_s=args.visibility,
                stop=stop,
            )
            log.info("working%s", " until both queues are empty" if args.once else "")
            status = worker.run(once=args.once)
    finally:
        if callback is not None:
            callback.close()
    log.info("stopped")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
