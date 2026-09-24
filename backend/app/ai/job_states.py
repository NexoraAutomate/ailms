"""AI registration job status state machine (master plan step 4 / spec 10)."""

from __future__ import annotations

from enum import StrEnum


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    OCR_COMPLETE = "OCR_COMPLETE"
    EXTRACTION_COMPLETE = "EXTRACTION_COMPLETE"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    APPROVED = "APPROVED"
    REGISTERED = "REGISTERED"
    FAILED = "FAILED"
    REJECTED = "REJECTED"


# Allowed transitions: from → frozenset of next statuses.
# Terminal / review states that are not advanced by the worker are still listed
# for explicit API actions (approve, reject, retry).
ALLOWED_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    JobStatus.QUEUED: frozenset({JobStatus.PROCESSING, JobStatus.FAILED}),
    JobStatus.PROCESSING: frozenset(
        {
            JobStatus.OCR_COMPLETE,
            JobStatus.EXTRACTION_COMPLETE,
            JobStatus.NEEDS_REVIEW,
            JobStatus.FAILED,
        }
    ),
    JobStatus.OCR_COMPLETE: frozenset(
        {JobStatus.EXTRACTION_COMPLETE, JobStatus.PROCESSING, JobStatus.FAILED}
    ),
    JobStatus.EXTRACTION_COMPLETE: frozenset(
        {JobStatus.NEEDS_REVIEW, JobStatus.PROCESSING, JobStatus.FAILED}
    ),
    JobStatus.NEEDS_REVIEW: frozenset(
        {JobStatus.APPROVED, JobStatus.REJECTED, JobStatus.FAILED, JobStatus.QUEUED}
    ),
    JobStatus.APPROVED: frozenset({JobStatus.REGISTERED, JobStatus.FAILED}),
    JobStatus.REGISTERED: frozenset(),
    JobStatus.FAILED: frozenset({JobStatus.QUEUED}),
    JobStatus.REJECTED: frozenset({JobStatus.QUEUED}),
}

# External progress hint for polling clients (spec 10).
_STATUS_TO_STAGE: dict[JobStatus, str | None] = {
    JobStatus.QUEUED: None,
    JobStatus.PROCESSING: "ocr",
    JobStatus.OCR_COMPLETE: "llm",
    JobStatus.EXTRACTION_COMPLETE: "validation",
    JobStatus.NEEDS_REVIEW: None,
    JobStatus.APPROVED: None,
    JobStatus.REGISTERED: None,
    JobStatus.FAILED: None,
    JobStatus.REJECTED: None,
}

ACTIVE_PIPELINE_STATUSES = frozenset(
    {
        JobStatus.QUEUED,
        JobStatus.PROCESSING,
        JobStatus.OCR_COMPLETE,
        JobStatus.EXTRACTION_COMPLETE,
    }
)


def parse_status(value: str) -> JobStatus:
    try:
        return JobStatus(value)
    except ValueError as exc:
        raise ValueError(f"Unknown job status: {value!r}") from exc


def can_transition(current: JobStatus | str, nxt: JobStatus | str) -> bool:
    cur = parse_status(current) if isinstance(current, str) else current
    target = parse_status(nxt) if isinstance(nxt, str) else nxt
    return target in ALLOWED_TRANSITIONS.get(cur, frozenset())


def assert_transition(current: JobStatus | str, nxt: JobStatus | str) -> None:
    cur = parse_status(current) if isinstance(current, str) else current
    target = parse_status(nxt) if isinstance(nxt, str) else nxt
    if not can_transition(cur, target):
        raise ValueError(f"Invalid job status transition: {cur} → {target}")


def current_stage(status: JobStatus | str) -> str | None:
    """Map status to API progress hint: ocr | llm | validation | None."""
    st = parse_status(status) if isinstance(status, str) else status
    return _STATUS_TO_STAGE.get(st)


def is_retryable(status: JobStatus | str) -> bool:
    st = parse_status(status) if isinstance(status, str) else status
    return st in {JobStatus.FAILED, JobStatus.REJECTED}
