"""The one failure a student gets to read."""

from __future__ import annotations


class UserFacingError(Exception):
    """A job can't be done, for a reason the student can act on.

    The message is stored as the document's or question's `error` and shown as is, so it reads
    like "Couldn't render the slides: it took longer than 180 seconds", never a stack trace
    (CLAUDE.md, Conventions). The worker fails the job at once instead of retrying it.
    """
