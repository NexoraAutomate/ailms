"""OCR → LLM-ready normalization (master plan step 6 / spec 03).

Reads immutable `ocr-output.json`, writes `llm-input.json` + `llm-input.txt`
with deterministic page markers. Does not modify the raw OCR artifact.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.ai.job_service import transition_job
from app.ai.job_states import JobStatus
from app.ai.ocr_service import load_ocr_artifact
from app.config import get_settings
from app.models import AiRegistrationJob, AiRun
from app.services import add_audit
from app.storage_service import build_job_artifact_key, resolve_storage_path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
LLM_INPUT_JSON = "llm-input.json"
LLM_INPUT_TXT = "llm-input.txt"
PAGE_HEADER_RE = re.compile(r"^=== PAGE (\d+) ===$", re.MULTILINE)
EMPTY_PAGE_PLACEHOLDER = "[no text detected]"
TRUNCATED_MARKER = "\n[TRUNCATED]"

# Vertical gap (relative to median line height) that starts a new paragraph.
DEFAULT_PARAGRAPH_GAP_RATIO = 1.5
# Fallback gap when line heights are unknown (page-height fraction).
DEFAULT_PARAGRAPH_GAP_PAGE_FRACTION = 0.02


class NormalizeError(Exception):
    """Normalization failure with a stable error_code for job FAILED transitions."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class _SortedLine:
    index: int
    text: str
    bbox: list[float]
    cy: float
    cx: float
    height: float


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _strip_control_chars(text: str) -> str:
    """Remove control characters except newline and tab."""
    return "".join(
        ch for ch in text if ch in "\n\t" or (ord(ch) >= 32 and ord(ch) != 127)
    )


def _normalize_whitespace(text: str) -> str:
    """Collapse horizontal whitespace runs; preserve single newlines."""
    text = _strip_control_chars(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse spaces/tabs within each line; drop blank lines later at paragraph level.
    lines = []
    for line in text.split("\n"):
        collapsed = re.sub(r"[ \t]+", " ", line).strip()
        if collapsed:
            lines.append(collapsed)
    return "\n".join(lines)


def _bbox_center(bbox: list[float] | None) -> tuple[float, float, float]:
    """Return (cx, cy, height) from [x1,y1,x2,y2]."""
    if not bbox or len(bbox) < 4:
        return 0.0, 0.0, 0.0
    try:
        x1, y1, x2, y2 = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    except (TypeError, ValueError):
        return 0.0, 0.0, 0.0
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0, abs(y2 - y1)


def _sort_lines(raw_lines: list[dict[str, Any]]) -> list[_SortedLine]:
    """Sort lines top-to-bottom, then left-to-right using bbox centers."""
    sorted_lines: list[_SortedLine] = []
    for i, ln in enumerate(raw_lines):
        if not isinstance(ln, dict):
            continue
        text = str(ln.get("text") or "")
        bbox = ln.get("bbox")
        if not isinstance(bbox, list):
            bbox = [0.0, 0.0, 0.0, 0.0]
        cx, cy, height = _bbox_center([float(v) for v in bbox[:4]] if bbox else None)
        sorted_lines.append(
            _SortedLine(index=i, text=text, bbox=list(bbox[:4]) if bbox else [], cy=cy, cx=cx, height=height)
        )
    sorted_lines.sort(key=lambda s: (s.cy, s.cx, s.index))
    return sorted_lines


def _paragraph_gap_threshold(
    sorted_lines: list[_SortedLine],
    *,
    page_height: float,
    gap_ratio: float = DEFAULT_PARAGRAPH_GAP_RATIO,
) -> float:
    heights = [s.height for s in sorted_lines if s.height > 0]
    if heights:
        heights_sorted = sorted(heights)
        mid = heights_sorted[len(heights_sorted) // 2]
        return max(mid * gap_ratio, 1.0)
    if page_height > 0:
        return max(page_height * DEFAULT_PARAGRAPH_GAP_PAGE_FRACTION, 8.0)
    return 12.0


def _group_paragraphs(
    sorted_lines: list[_SortedLine],
    *,
    page_number: int,
    page_height: float,
    gap_ratio: float = DEFAULT_PARAGRAPH_GAP_RATIO,
) -> list[dict[str, Any]]:
    """Group reading-order lines into paragraphs; map sourceLineIndices."""
    if not sorted_lines:
        return []

    threshold = _paragraph_gap_threshold(
        sorted_lines, page_height=page_height, gap_ratio=gap_ratio
    )
    groups: list[list[_SortedLine]] = []
    current: list[_SortedLine] = [sorted_lines[0]]

    for prev, nxt in zip(sorted_lines, sorted_lines[1:]):
        gap = nxt.cy - prev.cy
        # Same visual line (small vertical delta) or continuation of paragraph.
        if gap > threshold:
            groups.append(current)
            current = [nxt]
        else:
            current.append(nxt)
    groups.append(current)

    paragraphs: list[dict[str, Any]] = []
    for group in groups:
        # Join same-line / close lines with space; keep order.
        joined = " ".join(_normalize_whitespace(s.text) for s in group if s.text.strip())
        joined = _normalize_whitespace(joined.replace("\n", " "))
        if not joined:
            continue
        paragraphs.append(
            {
                "text": joined,
                "sourcePage": page_number,
                "sourceLineIndices": [s.index for s in group],
            }
        )
    return paragraphs


def page_header(page_number: int) -> str:
    return f"=== PAGE {page_number} ==="


def build_combined_text(pages: list[dict[str, Any]]) -> str:
    """Deterministic plain-text view with page markers."""
    blocks: list[str] = []
    for page in pages:
        page_number = int(page["pageNumber"])
        paragraphs = page.get("paragraphs") or []
        header = page_header(page_number)
        if not paragraphs:
            blocks.append(f"{header}\n{EMPTY_PAGE_PLACEHOLDER}")
            continue
        body = "\n".join(str(p["text"]) for p in paragraphs)
        blocks.append(f"{header}\n{body}")
    return "\n".join(blocks)


def truncate_combined_text(text: str, max_chars: int) -> tuple[str, bool]:
    """Truncate to max_chars, appending [TRUNCATED] when clipped."""
    if max_chars <= 0 or len(text) <= max_chars:
        return text, False
    # Leave room for the marker.
    marker = TRUNCATED_MARKER
    keep = max(0, max_chars - len(marker))
    return text[:keep].rstrip() + marker, True


def normalize_ocr_dict(
    ocr: dict[str, Any],
    *,
    max_chars: int | None = None,
    gap_ratio: float = DEFAULT_PARAGRAPH_GAP_RATIO,
) -> dict[str, Any]:
    """
    Pure function: raw OCR JSON → llm-input payload.

    Raises NormalizeError on malformed input.
    """
    if not isinstance(ocr, dict):
        raise NormalizeError("OCR_PARSE_ERROR", "OCR artifact root must be an object")

    job_id = str(ocr.get("jobId") or "")
    raw_pages = ocr.get("pages")
    if not isinstance(raw_pages, list):
        raise NormalizeError("OCR_PARSE_ERROR", "OCR artifact missing pages array")

    settings = get_settings()
    budget = max_chars if max_chars is not None else settings.llm_input_max_chars

    out_pages: list[dict[str, Any]] = []
    for page in raw_pages:
        if not isinstance(page, dict):
            raise NormalizeError("OCR_PARSE_ERROR", "OCR page entry must be an object")
        try:
            page_number = int(page.get("pageNumber"))
        except (TypeError, ValueError) as exc:
            raise NormalizeError("OCR_PARSE_ERROR", "OCR page missing pageNumber") from exc

        try:
            page_height = float(page.get("height") or 0)
        except (TypeError, ValueError):
            page_height = 0.0

        raw_lines = page.get("lines")
        if raw_lines is None:
            raw_lines = []
        if not isinstance(raw_lines, list):
            raise NormalizeError(
                "OCR_PARSE_ERROR",
                f"OCR page {page_number} lines must be an array",
            )

        sorted_lines = _sort_lines(raw_lines)
        paragraphs = _group_paragraphs(
            sorted_lines,
            page_number=page_number,
            page_height=page_height,
            gap_ratio=gap_ratio,
        )
        out_pages.append({"pageNumber": page_number, "paragraphs": paragraphs})

    combined = build_combined_text(out_pages)
    combined, truncated = truncate_combined_text(combined, budget)
    if truncated:
        logger.warning(
            "Normalized OCR text truncated jobId=%s max_chars=%s",
            job_id,
            budget,
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": job_id,
        "pageCount": len(out_pages),
        "pages": out_pages,
        "combinedText": combined,
        "truncated": truncated,
        "processedAt": _iso_now(),
    }


def _next_normalized_keys(job_id: int) -> tuple[str, str]:
    """Return (json_key, txt_key); version suffix if llm-input.json already exists."""
    base_json = build_job_artifact_key(job_id, LLM_INPUT_JSON)
    path = resolve_storage_path(base_json)
    if not path.exists():
        return base_json, build_job_artifact_key(job_id, LLM_INPUT_TXT)
    n = 2
    while True:
        json_key = build_job_artifact_key(job_id, f"llm-input.v{n}.json")
        if not resolve_storage_path(json_key).exists():
            return json_key, build_job_artifact_key(job_id, f"llm-input.v{n}.txt")
        n += 1


def write_normalized_artifacts(job_id: int, artifact: dict[str, Any]) -> str:
    """Write llm-input.json + .txt; returns JSON storage_key."""
    json_key, txt_key = _next_normalized_keys(job_id)
    json_path = resolve_storage_path(json_key)
    txt_path = resolve_storage_path(txt_key)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    txt_path.write_text(str(artifact.get("combinedText") or ""), encoding="utf-8")
    return json_key


def load_normalized_artifact(storage_key: str) -> dict[str, Any] | None:
    if not storage_key:
        return None
    path = resolve_storage_path(storage_key)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def run_normalize_stage(
    db: Session,
    job: AiRegistrationJob,
    *,
    actor: str | None = None,
    max_chars: int | None = None,
) -> AiRegistrationJob:
    """
    Normalize OCR for a job in OCR_COMPLETE; write llm-input artifacts.

    Success → remains OCR_COMPLETE with normalized_artifact_key set.
    Failure → FAILED with error_code.
    """
    started = time.perf_counter()
    actor = actor or job.created_by or "system"

    if job.status != JobStatus.OCR_COMPLETE.value:
        raise NormalizeError(
            "INVALID_JOB_STATUS",
            f"Normalize requires OCR_COMPLETE (current={job.status})",
        )

    if not job.ocr_artifact_key:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="OCR_ARTIFACT_MISSING",
            error_message="Job has no ocr_artifact_key",
        )
        return job

    ocr_path = resolve_storage_path(job.ocr_artifact_key)
    if not ocr_path.is_file():
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="OCR_ARTIFACT_MISSING",
            error_message=f"OCR file missing: {job.ocr_artifact_key}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Normalize Failed",
            record=str(job.id),
            description="OCR_ARTIFACT_MISSING",
        )
        db.flush()
        return job

    # Capture mtime to prove immutability after write.
    ocr_mtime_before = ocr_path.stat().st_mtime_ns

    run = AiRun(
        job_id=job.id,
        stage="normalize",
        model_id="",
        prompt_version="",
        input_artifact_key=job.ocr_artifact_key,
        output_artifact_key="",
        status="running",
        error_message="",
    )
    db.add(run)
    db.flush()

    try:
        try:
            ocr = load_ocr_artifact(job.ocr_artifact_key)
        except json.JSONDecodeError as exc:
            raise NormalizeError("OCR_PARSE_ERROR", f"Malformed OCR JSON: {exc}") from exc
        if ocr is None:
            raise NormalizeError("OCR_ARTIFACT_MISSING", "OCR artifact could not be loaded")

        # Ensure jobId in artifact matches when present.
        if not ocr.get("jobId"):
            ocr = {**ocr, "jobId": str(job.id)}

        artifact = normalize_ocr_dict(ocr, max_chars=max_chars)
        artifact["jobId"] = str(job.id)
        artifact_key = write_normalized_artifacts(job.id, artifact)
        job.normalized_artifact_key = artifact_key
        job.updated_at = datetime.now(UTC).replace(tzinfo=None)

        run.output_artifact_key = artifact_key
        run.status = "ok"
        run.latency_ms = int((time.perf_counter() - started) * 1000)

        # Raw OCR must remain untouched.
        if ocr_path.stat().st_mtime_ns != ocr_mtime_before:
            logger.error("OCR artifact was modified during normalize job_id=%s", job.id)

        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Normalize Complete",
            record=str(job.id),
            description=(
                f"normalized pages={artifact.get('pageCount')} "
                f"truncated={artifact.get('truncated')} artifact={artifact_key}"
            ),
        )
        db.flush()
        logger.info(
            "Normalize stage done job_id=%s key=%s pages=%s truncated=%s",
            job.id,
            artifact_key,
            artifact.get("pageCount"),
            artifact.get("truncated"),
        )
        return job

    except NormalizeError as exc:
        run.status = "failed"
        run.error_message = exc.message
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code=exc.code,
            error_message=exc.message,
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Normalize Failed",
            record=str(job.id),
            description=f"{exc.code}: {exc.message}",
        )
        db.flush()
        logger.warning("Normalize stage failed job_id=%s code=%s", job.id, exc.code)
        return job
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="NORMALIZE_ERROR",
            error_message=f"Normalize crash: {exc}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Normalize Failed",
            record=str(job.id),
            description=f"NORMALIZE_ERROR: {exc}",
        )
        db.flush()
        logger.exception("Normalize stage crashed job_id=%s", job.id)
        return job
