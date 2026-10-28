"""What the worker does with a claimed job: run it, fail it legibly, or try it again later."""

import copy
import json
import threading
from pathlib import Path

import pytest

from app import worker
from app.errors import UserFacingError
from app.extract import NOT_A_DECK
from app.worker import GAVE_UP, UNREADABLE_JOB, Settings, Worker

EXAMPLES = json.loads((Path(__file__).parents[2] / "contracts" / "examples.json").read_text())
EXTRACT, BLANK = EXAMPLES["claimed_jobs"]


def row(example: dict, read_ct: int = 1) -> dict:
    return {**copy.deepcopy(example), "read_ct": read_ct}


class FakeSupabase:
    """Hands out `rows` in order, then reports both queues empty."""

    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.failed: list[tuple[str, int, str]] = []
        self.retried: list[tuple[str, int, int]] = []

    def claim_next_job(self, visibility_seconds: int) -> dict | None:
        return self.rows.pop(0) if self.rows else None

    def fail_job(self, queue_name: str, msg_id: int, reason: str) -> bool:
        self.failed.append((queue_name, msg_id, reason))
        return True

    def retry_job_later(self, queue_name: str, msg_id: int, delay_seconds: int) -> bool:
        self.retried.append((queue_name, msg_id, delay_seconds))
        return True


class FakeHandlers:
    """Stands in for `handle_extract` and `handle_blank`: records each job it runs, calls
    `during` while running it, and raises what `raises` holds for its queue."""

    def __init__(self) -> None:
        self.ran: list[tuple[str, int]] = []
        self.raises: dict[str, Exception] = {}
        self.during = lambda: None

    def __call__(self, supa, job, *notify) -> None:  # noqa: ANN001, ANN002
        self.ran.append((job.queue_name, job.msg_id))
        self.during()
        if job.queue_name in self.raises:
            raise self.raises[job.queue_name]


@pytest.fixture
def jobs(monkeypatch) -> FakeHandlers:
    handlers = FakeHandlers()
    monkeypatch.setattr(worker, "handle_extract", handlers)
    monkeypatch.setattr(worker, "handle_blank", handlers)
    return handlers


def work(rows: list[dict], stop: threading.Event | None = None) -> FakeSupabase:
    supa = FakeSupabase(rows)
    stop = stop or threading.Event()
    assert Worker(supa, print, visibility_s=600, stop=stop).run(once=True) == 0
    return supa


def test_runs_each_job_then_exits_once_the_queues_are_empty(jobs):
    supa = work([row(BLANK), row(EXTRACT)])
    assert jobs.ran == [("blank", 7), ("extract", 41)]
    assert supa.failed == supa.retried == []


def test_a_job_claimed_a_fourth_time_fails_without_running(jobs):
    supa = work([row(EXTRACT, read_ct=4)])
    assert jobs.ran == []
    assert supa.failed == [("extract", 41, GAVE_UP["extract"])]


def test_a_user_facing_error_fails_the_job_with_its_message(jobs):
    jobs.raises["extract"] = UserFacingError(NOT_A_DECK)
    supa = work([row(EXTRACT)])
    assert supa.failed == [("extract", 41, NOT_A_DECK)]
    assert supa.retried == []


def test_an_unexpected_error_is_retried_later_until_the_last_attempt(jobs):
    jobs.raises["blank"] = OSError("disk full")
    supa = work([row(BLANK, read_ct=1), row(BLANK, read_ct=3)])
    assert supa.retried == [("blank", 7, worker.RETRY_DELAY_S)]
    assert supa.failed == [("blank", 7, GAVE_UP["blank"])]


def test_an_unreadable_job_fails_legibly(jobs):
    broken = row(BLANK)
    del broken["message"]["blanks"]
    supa = work([broken])
    assert jobs.ran == []
    assert supa.failed == [("blank", 7, UNREADABLE_JOB)]


def test_a_stop_lets_the_current_job_finish_and_claims_no_more(jobs):
    stop = threading.Event()
    jobs.during = stop.set  # SIGTERM arrives mid-job
    supa = work([row(BLANK), row(EXTRACT)], stop)
    assert jobs.ran == [("blank", 7)]
    assert supa.failed == supa.retried == []
    assert len(supa.rows) == 1  # the extract job was never claimed


def test_an_idle_worker_asks_less_and_less_often():
    waits: list[float] = []

    class Stop(threading.Event):
        def wait(self, timeout: float | None = None) -> bool:
            waits.append(timeout)
            if len(waits) == 7:
                self.set()
            return self.is_set()

    assert Worker(FakeSupabase([]), print, visibility_s=600, stop=Stop()).run(once=False) == 0
    assert waits == [1, 2, 4, 8, 15, 15, 15]


def test_settings_keep_secrets_off_plain_http():
    local = {"SUPABASE_URL": "http://host.docker.internal:54321", "SUPABASE_SECRET_KEY": "k"}
    assert Settings.from_env(local).callback_url is None

    with pytest.raises(ValueError, match="https"):
        Settings.from_env({**local, "SUPABASE_URL": "http://project.supabase.co"})
    with pytest.raises(ValueError, match="INGEST_CALLBACK_SECRET"):
        Settings.from_env({**local, "INGEST_CALLBACK_URL": "https://figurequiz.online/api/x"})
    with pytest.raises(ValueError, match="SUPABASE_SECRET_KEY"):
        Settings.from_env({"SUPABASE_URL": "https://project.supabase.co"})
