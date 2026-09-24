"""Structured LLM extraction for AI letter registration (master plan step 7 / spec 05)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.ai.extraction_schema import (
    DEFAULT_REQUIRED_REVIEW,
    FIELD_MAX_LENGTHS,
    FIELD_NAMES,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    LetterExtractionResult,
)
from app.ai.job_service import transition_job
from app.ai.job_states import JobStatus
from app.ai.llm_provider import LlmProvider, get_llm_provider
from app.ai.ocr_normalize import load_normalized_artifact, truncate_combined_text
from app.config import get_settings
from app.document_service import DOCUMENT_TYPES
from app.llm_client import LlmNotConfiguredError
from app.models import AiRegistrationJob, AiRun, Department, MasterValue
from app.seed import MASTER_DATA
from app.services import add_audit
from app.storage_service import build_job_artifact_key, resolve_storage_path

logger = logging.getLogger(__name__)

EXTRACTION_ARTIFACT = "extraction-result.json"
_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "registration_v1.txt"

_INJECTION_RE = re.compile(
    r"(?i)\b(system\s*:|ignore\s+all\s+rules|ignore\s+previous\s+instructions|"
    r"disregard\s+(all|the)\s+(rules|instructions)|set\s+priority\s+to\s+urgent|"
    r"letter\s+number\s+to\s+hack)\b"
)

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ExtractionError(Exception):
    """Extraction failure with a stable error_code for job FAILED transitions."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_prompt_template(prompt_version: str = PROMPT_VERSION) -> str:
    """Load versioned system prompt template from disk."""
    if prompt_version != PROMPT_VERSION:
        raise ExtractionError(
            "PROMPT_VERSION_UNKNOWN",
            f"Unsupported prompt version: {prompt_version}",
        )
    if not _PROMPT_PATH.is_file():
        raise ExtractionError(
            "PROMPT_MISSING",
            f"Prompt template not found: {_PROMPT_PATH}",
        )
    return _PROMPT_PATH.read_text(encoding="utf-8")


def default_master_hints() -> dict[str, list[str]]:
    """Fallback master-data hints when DB is unavailable."""
    return {
        "letterTypes": list(MASTER_DATA.get("Letter Types", [])),
        "priorities": list(MASTER_DATA.get("Priorities", [])),
        "confidentiality": list(MASTER_DATA.get("Confidentiality Levels", [])),
        "documentCategories": sorted(DOCUMENT_TYPES),
        "departments": [],
    }


def load_master_hints(db: Session | None) -> dict[str, list[str]]:
    """Load department / priority / type hints server-side (never from the document)."""
    hints = default_master_hints()
    if db is None:
        return hints

    def _values(category: str) -> list[str]:
        rows = (
            db.query(MasterValue.value)
            .filter(MasterValue.category == category, MasterValue.status == "Active")
            .order_by(MasterValue.id)
            .all()
        )
        return [r[0] for r in rows if r and r[0]]

    try:
        letter_types = _values("Letter Types")
        priorities = _values("Priorities")
        confidentiality = _values("Confidentiality Levels")
        doc_types = _values("Document Types")
        departments = [
            name
            for (name,) in db.query(Department.name)
            .filter(Department.status == "Active")
            .order_by(Department.name)
            .all()
        ]
        if letter_types:
            hints["letterTypes"] = letter_types
        if priorities:
            hints["priorities"] = priorities
        if confidentiality:
            hints["confidentiality"] = confidentiality
        if doc_types:
            hints["documentCategories"] = doc_types
        if departments:
            hints["departments"] = departments
    except Exception:
        logger.exception("Failed loading master hints; using defaults")
    return hints


def format_master_hints(hints: dict[str, list[str]]) -> str:
    lines = [
        "ALLOWED VALUE HINTS (prefer these when the document supports them):",
        f"- Letter types: {', '.join(hints.get('letterTypes') or [])}",
        f"- Priorities: {', '.join(hints.get('priorities') or [])}",
        f"- Confidentiality: {', '.join(hints.get('confidentiality') or [])}",
        f"- Document categories: {', '.join(hints.get('documentCategories') or [])}",
    ]
    depts = hints.get("departments") or []
    if depts:
        lines.append(f"- Departments: {', '.join(depts)}")
    else:
        lines.append("- Departments: (none loaded; leave null if unsure)")
    return "\n".join(lines)


def build_system_prompt(
    *,
    hints: dict[str, list[str]] | None = None,
    prompt_version: str = PROMPT_VERSION,
) -> str:
    template = load_prompt_template(prompt_version)
    master = format_master_hints(hints or default_master_hints())
    if "{{MASTER_HINTS}}" in template:
        return template.replace("{{MASTER_HINTS}}", master)
    return f"{template.rstrip()}\n\n{master}\n"


def build_user_message(combined_text: str) -> str:
    return (
        "DOCUMENT_CONTENT_START\n"
        f"{combined_text}\n"
        "DOCUMENT_CONTENT_END"
    )


def _strip_control(text: str) -> str:
    return _CONTROL_CHARS_RE.sub("", text)


def _sanitize_scalar(value: Any, *, max_len: int) -> Any:
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    text = _strip_control(str(value)).strip()
    if not text:
        return None
    if len(text) > max_len:
        text = text[:max_len]
    return text


def _sanitize_related(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        return []
    out: list[str] = []
    for item in items:
        cleaned = _sanitize_scalar(item, max_len=FIELD_MAX_LENGTHS["number"])
        if cleaned:
            out.append(str(cleaned))
    return out[:20]


def sanitize_extraction_result(result: LetterExtractionResult) -> LetterExtractionResult:
    """Clamp string lengths and normalize empty values before writing artifacts."""
    data = result.to_artifact_dict()
    fields = data.get("fields") or {}
    for name in FIELD_NAMES:
        entry = fields.get(name) or {}
        if not isinstance(entry, dict):
            entry = {"value": entry, "confidence": 0, "requiredReview": name in DEFAULT_REQUIRED_REVIEW}
        if name == "relatedLetterNumbers":
            entry["value"] = _sanitize_related(entry.get("value"))
        else:
            max_len = FIELD_MAX_LENGTHS.get(name, 400)
            entry["value"] = _sanitize_scalar(entry.get("value"), max_len=max_len)
        if entry.get("value") in (None, "", []):
            entry["confidence"] = 0.0
        fields[name] = entry
    data["fields"] = fields
    data["schemaVersion"] = SCHEMA_VERSION
    data["promptVersion"] = data.get("promptVersion") or PROMPT_VERSION
    return LetterExtractionResult.model_validate(data)


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


def apply_missing_field_warnings(result: LetterExtractionResult) -> LetterExtractionResult:
    """Ensure null/empty fields get confidence 0 and FIELD_NOT_FOUND warnings."""
    data = result.to_artifact_dict()
    warnings = list(data.get("warnings") or [])
    fields = data.get("fields") or {}
    added = False
    for name in FIELD_NAMES:
        entry = fields.get(name) or {}
        if _is_empty_value(entry.get("value")):
            entry["value"] = [] if name == "relatedLetterNumbers" else None
            entry["confidence"] = 0.0
            fields[name] = entry
            if name in {
                "number",
                "letterDate",
                "subject",
                "from",
                "to",
                "type",
                "department",
                "priority",
                "dueDate",
                "actionRequired",
                "documentCategory",
            }:
                added = True
    if added and "FIELD_NOT_FOUND" not in warnings:
        warnings.append("FIELD_NOT_FOUND")
    data["fields"] = fields
    data["warnings"] = warnings
    return LetterExtractionResult.model_validate(data)


def apply_injection_heuristics(
    result: LetterExtractionResult,
    combined_text: str,
) -> LetterExtractionResult:
    """
    Soft defense: if document contains injection language and elevated fields
    are only supported by that language, force review / clear unsafe values.
    """
    if not _INJECTION_RE.search(combined_text or ""):
        return result

    data = result.to_artifact_dict()
    warnings = list(data.get("warnings") or [])
    if "PROMPT_INJECTION_SUSPECTED" not in warnings:
        warnings.append("PROMPT_INJECTION_SUSPECTED")

    fields = data.get("fields") or {}
    priority = fields.get("priority") or {}
    priority_val = str(priority.get("value") or "").strip().lower()
    number_val = str((fields.get("number") or {}).get("value") or "").strip().upper()

    # Evidence snippets that look like attacker instructions are not corroboration.
    inj_evidence = [
        e
        for e in (data.get("evidence") or [])
        if isinstance(e, dict) and _INJECTION_RE.search(str(e.get("snippet") or ""))
    ]
    inj_fields = {str(e.get("field") or "") for e in inj_evidence}

    if priority_val == "urgent":
        # Clear Urgent when injection present unless non-injection letter content
        # clearly states urgency (simple heuristic: "urgent" outside injection lines).
        non_inj_text = _INJECTION_RE.sub(" ", combined_text)
        has_natural_urgent = bool(re.search(r"(?i)\burgent\b", non_inj_text))
        if not has_natural_urgent or "priority" in inj_fields:
            fields["priority"] = {
                "value": None,
                "confidence": 0.0,
                "requiredReview": True,
            }

    if number_val.startswith("HACK") or "HACK-999" in number_val:
        fields["number"] = {
            "value": None,
            "confidence": 0.0,
            "requiredReview": True,
        }

    # Force review on priority/number whenever injection language is present.
    for key in ("priority", "number"):
        entry = fields.get(key) or {"value": None, "confidence": 0.0}
        entry["requiredReview"] = True
        fields[key] = entry

    data["fields"] = fields
    data["warnings"] = warnings
    return LetterExtractionResult.model_validate(data)


def parse_extraction_payload(raw: dict[str, Any]) -> LetterExtractionResult:
    """Parse and sanitize LLM JSON into the versioned schema (extra keys dropped)."""
    if not isinstance(raw, dict):
        raise ExtractionError("LLM_INVALID_JSON", "LLM JSON root must be an object")
    try:
        result = LetterExtractionResult.model_validate(raw)
    except ValidationError as exc:
        raise ExtractionError("LLM_INVALID_JSON", f"Extraction schema validation failed: {exc}") from exc
    return sanitize_extraction_result(result)


def _next_extraction_key(job_id: int) -> str:
    base = build_job_artifact_key(job_id, EXTRACTION_ARTIFACT)
    if not resolve_storage_path(base).exists():
        return base
    n = 2
    while True:
        key = build_job_artifact_key(job_id, f"extraction-result.v{n}.json")
        if not resolve_storage_path(key).exists():
            return key
        n += 1


def write_extraction_artifact(job_id: int, artifact: dict[str, Any]) -> str:
    key = _next_extraction_key(job_id)
    path = resolve_storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return key


def load_extraction_artifact(storage_key: str) -> dict[str, Any] | None:
    if not storage_key:
        return None
    path = resolve_storage_path(storage_key)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def prepare_combined_text(
    llm_input: dict[str, Any],
    *,
    max_chars: int | None = None,
) -> tuple[str, bool]:
    settings = get_settings()
    budget = max_chars if max_chars is not None else settings.extraction_max_chars
    combined = str(llm_input.get("combinedText") or "")
    if not combined.strip():
        raise ExtractionError("LLM_INPUT_EMPTY", "Normalized artifact has empty combinedText")
    # Prefer already-truncated normalize output, then apply extraction budget.
    text, truncated = truncate_combined_text(combined, budget)
    truncated = truncated or bool(llm_input.get("truncated"))
    return text, truncated


def _run_coro(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Nested event loop (rare): run in a fresh thread.
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


async def _complete_json_with_schema_repair(
    provider: LlmProvider,
    *,
    system: str,
    user: str,
) -> dict[str, Any]:
    """Call complete_json; on schema ValidationError, one repair with quoted output."""
    try:
        raw = await provider.complete_json(system=system, user=user)
    except LlmNotConfiguredError as exc:
        raise ExtractionError("LLM_UNAVAILABLE", str(exc)) from exc
    except HTTPException as exc:
        detail = str(exc.detail)
        if "valid JSON" in detail.lower() or "json" in detail.lower():
            raise ExtractionError("LLM_INVALID_JSON", detail) from exc
        raise ExtractionError("LLM_UNAVAILABLE", detail) from exc
    except Exception as exc:
        raise ExtractionError("LLM_UNAVAILABLE", f"LLM request failed: {exc}") from exc

    if not isinstance(raw, dict):
        raise ExtractionError("LLM_INVALID_JSON", "LLM JSON response must be an object")

    try:
        parse_extraction_payload(raw)
        return raw
    except ExtractionError:
        repair_user = (
            "The previous JSON did not match the required extraction schema. "
            "Return a corrected single JSON object only.\n\n"
            f"PREVIOUS_OUTPUT:\n{json.dumps(raw, ensure_ascii=False)}"
        )
        try:
            repaired = await provider.complete_json(
                system=system,
                user=repair_user,
                temperature=0.0,
            )
        except Exception as exc:
            raise ExtractionError(
                "LLM_INVALID_JSON",
                f"Schema repair failed: {exc}",
            ) from exc
        if not isinstance(repaired, dict):
            raise ExtractionError("LLM_INVALID_JSON", "Repair response was not a JSON object")
        return repaired


def extract_from_combined_text(
    combined_text: str,
    *,
    hints: dict[str, list[str]] | None = None,
    provider: LlmProvider | None = None,
    truncated: bool = False,
) -> LetterExtractionResult:
    """
    Run LLM extraction against bounded document text (sync wrapper).

    Used by the job stage and unit/integration tests.
    """
    settings = get_settings()
    llm = provider or get_llm_provider(settings)
    system = build_system_prompt(hints=hints)
    user = build_user_message(combined_text)
    raw = _run_coro(_complete_json_with_schema_repair(llm, system=system, user=user))
    result = parse_extraction_payload(raw)
    if truncated:
        warnings = list(result.warnings)
        if "CONTEXT_TRUNCATED" not in warnings:
            warnings.append("CONTEXT_TRUNCATED")
        result = LetterExtractionResult.model_validate(
            {**result.to_artifact_dict(), "warnings": warnings}
        )
    result = apply_missing_field_warnings(result)
    result = apply_injection_heuristics(result, combined_text)
    return sanitize_extraction_result(result)


def run_extraction_stage(
    db: Session,
    job: AiRegistrationJob,
    *,
    actor: str | None = None,
    provider: LlmProvider | None = None,
    max_chars: int | None = None,
) -> AiRegistrationJob:
    """
    Extract structured fields from llm-input for a job in OCR_COMPLETE.

    Success → EXTRACTION_COMPLETE with extraction-result.json + proposal_json.
    Failure → FAILED with error_code (LLM_UNAVAILABLE / LLM_INVALID_JSON / …).
    """
    started = time.perf_counter()
    actor = actor or job.created_by or "system"
    settings = get_settings()

    if job.status != JobStatus.OCR_COMPLETE.value:
        raise ExtractionError(
            "INVALID_JOB_STATUS",
            f"Extraction requires OCR_COMPLETE (current={job.status})",
        )
    if not job.normalized_artifact_key:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="LLM_INPUT_MISSING",
            error_message="Job has no normalized_artifact_key",
        )
        return job

    llm_input = load_normalized_artifact(job.normalized_artifact_key)
    if llm_input is None:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="LLM_INPUT_MISSING",
            error_message=f"Normalized file missing: {job.normalized_artifact_key}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Extraction Failed",
            record=str(job.id),
            description="LLM_INPUT_MISSING",
        )
        db.flush()
        return job

    llm = provider or get_llm_provider(settings)
    run = AiRun(
        job_id=job.id,
        stage="extraction",
        model_id=llm.model_id,
        prompt_version=PROMPT_VERSION,
        input_artifact_key=job.normalized_artifact_key,
        output_artifact_key="",
        status="running",
        error_message="",
    )
    db.add(run)
    db.flush()

    try:
        combined, truncated = prepare_combined_text(llm_input, max_chars=max_chars)
        hints = load_master_hints(db)
        result = extract_from_combined_text(
            combined,
            hints=hints,
            provider=llm,
            truncated=truncated,
        )
        artifact = result.to_artifact_dict()
        artifact["jobId"] = str(job.id)
        artifact_key = write_extraction_artifact(job.id, artifact)

        job.extraction_artifact_key = artifact_key
        job.proposal_json = json.dumps(artifact, ensure_ascii=False)
        job.prompt_version = PROMPT_VERSION
        job.model_id = llm.model_id
        job.model_config_json = json.dumps(
            {
                "provider": llm.provider_name,
                "model": llm.model_id,
                "promptVersion": PROMPT_VERSION,
                "extractionMaxChars": max_chars
                if max_chars is not None
                else settings.extraction_max_chars,
                "temperature": 0.15,
            },
            ensure_ascii=False,
        )
        job.updated_at = datetime.now(UTC).replace(tzinfo=None)

        run.output_artifact_key = artifact_key
        run.status = "ok"
        run.latency_ms = int((time.perf_counter() - started) * 1000)

        transition_job(db, job, new_status=JobStatus.EXTRACTION_COMPLETE)

        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Extraction Complete",
            record=str(job.id),
            description=(
                f"extraction model={llm.model_id} prompt={PROMPT_VERSION} "
                f"artifact={artifact_key}"
            ),
        )
        db.flush()
        logger.info(
            "Extraction stage done job_id=%s key=%s model=%s",
            job.id,
            artifact_key,
            llm.model_id,
        )
        return job

    except ExtractionError as exc:
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
            action="Extraction Failed",
            record=str(job.id),
            description=f"{exc.code}: {exc.message}",
        )
        db.flush()
        logger.warning("Extraction stage failed job_id=%s code=%s", job.id, exc.code)
        return job
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="EXTRACTION_ERROR",
            error_message=f"Extraction crash: {exc}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Extraction Failed",
            record=str(job.id),
            description=f"EXTRACTION_ERROR: {exc}",
        )
        db.flush()
        logger.exception("Extraction stage crashed job_id=%s", job.id)
        return job
