"""Validation layer for AI letter registration (master plan step 8 / spec 06).

Treats LLM extraction as untrusted: master-data checks, date parsing, length
limits, HTML stripping, and duplicate letter-number pre-check. Always advances
to NEEDS_REVIEW when extraction succeeded (human can fix field issues).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime
from html import unescape
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.extraction_schema import FIELD_MAX_LENGTHS, FIELD_NAMES, LetterExtractionResult
from app.ai.extraction_service import load_extraction_artifact, load_master_hints
from app.ai.job_service import transition_job
from app.ai.job_states import JobStatus
from app.document_service import DOCUMENT_TYPES
from app.import_service import _parse_date
from app.models import AiRegistrationJob, Department, Letter
from app.seed import MASTER_DATA
from app.services import add_audit
from app.storage_service import build_job_artifact_key, resolve_storage_path

logger = logging.getLogger(__name__)

VALIDATION_ARTIFACT = "validation-result.json"
SCHEMA_VERSION = 1

_HTML_TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
_SCRIPT_STYLE_RE = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Fields required before a human can reasonably approve (non-blocking at review).
_REQUIRED_FOR_REVIEW: frozenset[str] = frozenset(
    {"number", "letterDate", "subject", "type", "priority"}
)

# LetterCreate-aligned keys in the flat normalized proposal (API camelCase).
_PROPOSAL_KEYS: tuple[str, ...] = (
    "number",
    "letterDate",
    "receivedDate",
    "type",
    "subject",
    "from",
    "to",
    "department",
    "priority",
    "status",
    "dueDate",
    "assignedTo",
    "lastAction",
    "confidentiality",
    "actionRequired",
    "remarks",
    "summary",
    "documentCategory",
    "relatedLetterNumbers",
)


class ValidationError(Exception):
    """Unrecoverable validation failure (job → FAILED)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def strip_html(value: str) -> str:
    """Remove HTML tags / unescape entities for safe review UI display."""
    text = unescape(value or "")
    text = _SCRIPT_STYLE_RE.sub("", text)
    text = _HTML_TAG_RE.sub("", text)
    text = _CONTROL_CHARS_RE.sub("", text)
    return text.strip()


def _issue(code: str, message: str, *, raw_value: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"code": code, "message": message}
    if raw_value is not None:
        out["rawValue"] = str(raw_value)[:200]
    return out


def _field_value(fields: dict[str, Any], name: str) -> Any:
    entry = fields.get(name) or {}
    if isinstance(entry, dict):
        return entry.get("value")
    return entry


def _set_field_value(fields: dict[str, Any], name: str, value: Any, *, force_review: bool = False) -> None:
    entry = fields.get(name)
    if not isinstance(entry, dict):
        entry = {"value": None, "confidence": 0.0, "requiredReview": True}
    entry["value"] = value
    if force_review:
        entry["requiredReview"] = True
    if value in (None, "", []):
        entry["confidence"] = 0.0
    fields[name] = entry


def _canonicalize(
    value: str | None,
    allowed: list[str] | set[str],
) -> str | None:
    """Case-insensitive match against an allowed list; return canonical spelling."""
    if not value:
        return None
    lookup = {str(item).casefold(): str(item) for item in allowed}
    return lookup.get(value.casefold())


def _parse_iso_or_flexible(raw: Any) -> tuple[date | None, str | None]:
    """
    Parse a date value. Returns (date|None, error_code|None).
    Accepts ISO and common import formats; rejects impossible calendar dates.
    """
    if raw is None:
        return None, None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw, None
    text = str(raw).strip()
    if not text:
        return None, None

    # Strict ISO first.
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text[:26], fmt).date(), None
        except ValueError:
            continue

    parsed = _parse_date(text)
    if parsed is not None:
        return parsed, None

    # Catch obviously impossible numeric dates that strptime might not reject
    # when formats don't match (e.g. 2026-13-40).
    iso_guess = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if iso_guess:
        y, m, d = (int(iso_guess.group(1)), int(iso_guess.group(2)), int(iso_guess.group(3)))
        try:
            return date(y, m, d), None
        except ValueError:
            return None, "INVALID_DATE"

    return None, "INVALID_DATE"


def _date_to_iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _clip_string(value: Any, max_len: int) -> tuple[str | None, bool]:
    """Strip HTML and clip length. Returns (cleaned|None, was_truncated)."""
    if value is None:
        return None, False
    text = strip_html(str(value))
    if not text:
        return None, False
    if len(text) > max_len:
        return text[:max_len], True
    return text, False


def load_allowed_masters(db: Session | None) -> dict[str, list[str]]:
    """Master lists for type / priority / confidentiality / department / doc category."""
    hints = load_master_hints(db)
    # Ensure non-empty fallbacks even when DB returns empty categories.
    if not hints.get("letterTypes"):
        hints["letterTypes"] = list(MASTER_DATA.get("Letter Types", []))
    if not hints.get("priorities"):
        hints["priorities"] = list(MASTER_DATA.get("Priorities", []))
    if not hints.get("confidentiality"):
        hints["confidentiality"] = list(MASTER_DATA.get("Confidentiality Levels", []))
    if not hints.get("documentCategories"):
        hints["documentCategories"] = sorted(DOCUMENT_TYPES)
    if db is not None and not hints.get("departments"):
        try:
            hints["departments"] = [
                name
                for (name,) in db.query(Department.name)
                .filter(Department.status == "Active")
                .order_by(Department.name)
                .all()
            ]
        except Exception:
            logger.exception("Failed loading departments for validation")
    return hints


def check_duplicate_number(db: Session, number: str) -> bool:
    """Return True if `number` already exists on cms_letters (parameterized ORM)."""
    if not number:
        return False
    return db.query(Letter.id).filter(Letter.number == number).first() is not None


def validate_extraction(
    extraction: LetterExtractionResult | dict[str, Any],
    *,
    db: Session | None = None,
    job_id: str | int | None = None,
    masters: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """
    Run field-level business validation and build validation-result.json body.

    Does not mutate job status — call `run_validation_stage` for that.
    Raises ValidationError only for unrecoverable input shape issues.
    """
    if isinstance(extraction, LetterExtractionResult):
        data = extraction.to_artifact_dict()
    elif isinstance(extraction, dict):
        try:
            data = LetterExtractionResult.model_validate(extraction).to_artifact_dict()
        except Exception as exc:
            raise ValidationError(
                "INVALID_EXTRACTION_ARTIFACT",
                f"Extraction artifact failed schema parse: {exc}",
            ) from exc
    else:
        raise ValidationError("INVALID_EXTRACTION_ARTIFACT", "Extraction must be an object")

    fields = dict(data.get("fields") or {})
    field_issues: dict[str, list[dict[str, Any]]] = {}
    blocking_errors: list[dict[str, Any]] = []
    masters = masters or load_allowed_masters(db)

    def add_issue(field: str, issue: dict[str, Any]) -> None:
        field_issues.setdefault(field, []).append(issue)

    # --- number ---
    number_raw = _field_value(fields, "number")
    number, number_trunc = _clip_string(number_raw, FIELD_MAX_LENGTHS["number"])
    if number_trunc:
        add_issue("number", _issue("VALUE_TRUNCATED", "Letter number truncated to max length", raw_value=number_raw))
    _set_field_value(fields, "number", number)
    if not number:
        add_issue("number", _issue("REQUIRED_EMPTY", "Letter number is required before registration"))
    else:
        if db is not None:
            try:
                if check_duplicate_number(db, number):
                    blocking_errors.append(
                        _issue(
                            "DUPLICATE_NUMBER",
                            f"Letter number already exists: {number}",
                            raw_value=number,
                        )
                    )
                    add_issue(
                        "number",
                        _issue(
                            "DUPLICATE_NUMBER",
                            "Duplicate letter number — blocking at approve unless overridden",
                            raw_value=number,
                        ),
                    )
            except SQLAlchemyError as exc:
                raise ValidationError(
                    "DB_UNAVAILABLE",
                    f"Duplicate number check failed: {exc}",
                ) from exc

    # --- dates ---
    for date_field in ("letterDate", "receivedDate", "dueDate"):
        raw = _field_value(fields, date_field)
        parsed, err = _parse_iso_or_flexible(raw)
        if err == "INVALID_DATE":
            add_issue(
                date_field,
                _issue("INVALID_DATE", f"Could not parse date: {raw!r}", raw_value=raw),
            )
            _set_field_value(fields, date_field, None, force_review=True)
        else:
            _set_field_value(fields, date_field, _date_to_iso(parsed))
            if date_field == "letterDate" and parsed is None:
                add_issue(
                    "letterDate",
                    _issue("REQUIRED_EMPTY", "Letter date is required before registration"),
                )

    # --- subject ---
    subject_raw = _field_value(fields, "subject")
    subject, subject_trunc = _clip_string(subject_raw, FIELD_MAX_LENGTHS["subject"])
    if subject_trunc:
        add_issue(
            "subject",
            _issue("SUBJECT_TOO_LONG", "Subject truncated to 400 characters", raw_value=subject_raw),
        )
    _set_field_value(fields, "subject", subject)
    if not subject:
        add_issue("subject", _issue("REQUIRED_EMPTY", "Subject is required before registration"))

    # --- string fields with HTML strip + length ---
    for name in (
        "from",
        "to",
        "actionRequired",
        "remarks",
        "summary",
        "department",
    ):
        raw = _field_value(fields, name)
        cleaned, truncated = _clip_string(raw, FIELD_MAX_LENGTHS.get(name, 400))
        if truncated:
            add_issue(
                name,
                _issue("VALUE_TRUNCATED", f"{name} truncated to max length", raw_value=raw),
            )
        # Also flag if HTML was present.
        if raw is not None and str(raw) != cleaned and "<" in str(raw):
            add_issue(
                name,
                _issue("HTML_STRIPPED", f"HTML removed from {name}"),
            )
        _set_field_value(fields, name, cleaned)

    # --- type / priority / confidentiality (must be in master lists) ---
    _master_field_codes = {
        "type": ("letterTypes", "Incoming", "UNKNOWN_TYPE"),
        "priority": ("priorities", "Routine", "UNKNOWN_PRIORITY"),
        "confidentiality": ("confidentiality", "Normal", "UNKNOWN_CONFIDENTIALITY"),
    }
    for field, (master_key, default, unknown_code) in _master_field_codes.items():
        raw = _field_value(fields, field)
        text, _ = _clip_string(raw, FIELD_MAX_LENGTHS.get(field, 40))
        allowed = masters.get(master_key) or []
        canonical = _canonicalize(text, allowed) if text else None
        if text and canonical is None:
            add_issue(
                field,
                _issue(
                    unknown_code,
                    f"{field} value not in master list: {text!r}",
                    raw_value=text,
                ),
            )
            # Leave blank — human must pick an allowed value (acceptance: SuperUrgent).
            _set_field_value(fields, field, None, force_review=True)
        elif canonical:
            _set_field_value(fields, field, canonical)
        else:
            if field in _REQUIRED_FOR_REVIEW:
                add_issue(
                    field,
                    _issue("REQUIRED_EMPTY", f"{field} is required before registration"),
                )
                _set_field_value(fields, field, None, force_review=True)
            else:
                _set_field_value(fields, field, default)

    # --- department (unknown → flag, keep value for human pick) ---
    dept_raw = _field_value(fields, "department")
    dept_text, _ = _clip_string(dept_raw, FIELD_MAX_LENGTHS["department"])
    dept_list = masters.get("departments") or []
    if dept_text:
        canonical_dept = _canonicalize(dept_text, dept_list) if dept_list else None
        if dept_list and canonical_dept is None:
            add_issue(
                "department",
                _issue(
                    "UNKNOWN_DEPARTMENT",
                    f"Department not in master list: {dept_text!r}",
                    raw_value=dept_text,
                ),
            )
            _set_field_value(fields, "department", dept_text, force_review=True)
        else:
            _set_field_value(fields, "department", canonical_dept or dept_text)
    else:
        _set_field_value(fields, "department", None)

    # --- documentCategory ---
    cat_raw = _field_value(fields, "documentCategory")
    cat_text, _ = _clip_string(cat_raw, FIELD_MAX_LENGTHS["documentCategory"])
    cat_allowed = masters.get("documentCategories") or sorted(DOCUMENT_TYPES)
    if cat_text:
        canonical_cat = _canonicalize(cat_text, cat_allowed)
        if canonical_cat is None:
            add_issue(
                "documentCategory",
                _issue(
                    "UNKNOWN_DOCUMENT_CATEGORY",
                    f"Document category not in master list: {cat_text!r}",
                    raw_value=cat_text,
                ),
            )
            _set_field_value(fields, "documentCategory", None, force_review=True)
        else:
            _set_field_value(fields, "documentCategory", canonical_cat)
    else:
        _set_field_value(fields, "documentCategory", None)

    # --- relatedLetterNumbers ---
    related_raw = _field_value(fields, "relatedLetterNumbers")
    related: list[str] = []
    if isinstance(related_raw, list):
        for item in related_raw:
            cleaned, _ = _clip_string(item, FIELD_MAX_LENGTHS["number"])
            if cleaned:
                related.append(cleaned)
    elif related_raw:
        cleaned, _ = _clip_string(related_raw, FIELD_MAX_LENGTHS["number"])
        if cleaned:
            related.append(cleaned)
    related = related[:20]
    _set_field_value(fields, "relatedLetterNumbers", related)

    # Build flat LetterCreate-compatible proposal (+ extensions).
    def v(name: str, default: Any = None) -> Any:
        val = _field_value(fields, name)
        return default if val is None else val

    # Soft defaults for proposal so the review form has selectable values.
    type_val = v("type") or "Incoming"
    priority_val = v("priority")  # may stay null when unknown
    conf_val = v("confidentiality") or "Normal"

    # If type was cleared due to unknown, don't silently re-default into proposal
    # without a field issue already recorded — leave empty string for form.
    if any(i.get("code") == "UNKNOWN_TYPE" for i in field_issues.get("type", [])):
        type_val = ""
    if any(i.get("code") == "UNKNOWN_PRIORITY" for i in field_issues.get("priority", [])):
        priority_val = ""
    if any(i.get("code") == "UNKNOWN_CONFIDENTIALITY" for i in field_issues.get("confidentiality", [])):
        conf_val = ""

    normalized_proposal: dict[str, Any] = {
        "number": v("number") or "",
        "letterDate": v("letterDate"),
        "receivedDate": v("receivedDate"),
        "type": type_val if type_val is not None else "",
        "subject": v("subject") or "",
        "from": v("from") or "",
        "to": v("to") or "",
        "department": v("department") or "",
        "priority": priority_val if priority_val is not None else "",
        "status": "Registered",
        "dueDate": v("dueDate"),
        "assignedTo": "",
        "lastAction": "Registered",
        "confidentiality": conf_val if conf_val is not None else "",
        "actionRequired": v("actionRequired") or "",
        "remarks": v("remarks") or "",
        "summary": v("summary") or "",
        "documentCategory": v("documentCategory") or "",
        "relatedLetterNumbers": list(v("relatedLetterNumbers") or []),
        "_meta": {
            "fieldConfidence": {
                name: float((fields.get(name) or {}).get("confidence") or 0)
                if isinstance(fields.get(name), dict)
                else 0.0
                for name in FIELD_NAMES
            },
            "requiredReview": [
                name
                for name in FIELD_NAMES
                if isinstance(fields.get(name), dict)
                and bool((fields.get(name) or {}).get("requiredReview"))
            ],
            "fieldIssues": {k: list(v) for k, v in field_issues.items()},
        },
    }

    # Ensure only expected keys (+ _meta).
    for key in list(normalized_proposal.keys()):
        if key != "_meta" and key not in _PROPOSAL_KEYS:
            del normalized_proposal[key]

    passed = len(blocking_errors) == 0 and len(field_issues) == 0

    return {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": str(job_id) if job_id is not None else "",
        "passed": passed,
        "blockingErrors": blocking_errors,
        "fieldIssues": field_issues,
        "normalizedProposal": normalized_proposal,
        "normalizedFields": fields,
    }


def _next_validation_key(job_id: int) -> str:
    base = build_job_artifact_key(job_id, VALIDATION_ARTIFACT)
    if not resolve_storage_path(base).exists():
        return base
    n = 2
    while True:
        key = build_job_artifact_key(job_id, f"validation-result.v{n}.json")
        if not resolve_storage_path(key).exists():
            return key
        n += 1


def write_validation_artifact(job_id: int, artifact: dict[str, Any]) -> str:
    key = _next_validation_key(job_id)
    path = resolve_storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return key


def load_validation_artifact(storage_key: str) -> dict[str, Any] | None:
    if not storage_key:
        return None
    path = resolve_storage_path(storage_key)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def run_validation_stage(
    db: Session,
    job: AiRegistrationJob,
    *,
    actor: str | None = None,
) -> AiRegistrationJob:
    """
    Validate extraction for a job in EXTRACTION_COMPLETE.

    Success (incl. field issues) → NEEDS_REVIEW with validation-result.json.
    Unrecoverable (missing/invalid artifact, DB down on duplicate check) → FAILED.
    """
    actor = actor or job.created_by or "system"

    if job.status != JobStatus.EXTRACTION_COMPLETE.value:
        raise ValidationError(
            "INVALID_JOB_STATUS",
            f"Validation requires EXTRACTION_COMPLETE (current={job.status})",
        )

    if not job.extraction_artifact_key:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="EXTRACTION_MISSING",
            error_message="Job has no extraction_artifact_key",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Validation Failed",
            record=str(job.id),
            description="EXTRACTION_MISSING",
        )
        db.flush()
        return job

    extraction = load_extraction_artifact(job.extraction_artifact_key)
    if extraction is None:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="INVALID_EXTRACTION_ARTIFACT",
            error_message=f"Extraction file missing: {job.extraction_artifact_key}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Validation Failed",
            record=str(job.id),
            description="INVALID_EXTRACTION_ARTIFACT: file missing",
        )
        db.flush()
        return job

    try:
        result = validate_extraction(extraction, db=db, job_id=job.id)
    except ValidationError as exc:
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
            action="Validation Failed",
            record=str(job.id),
            description=f"{exc.code}: {exc.message}",
        )
        db.flush()
        logger.warning("Validation stage failed job_id=%s code=%s", job.id, exc.code)
        return job
    except SQLAlchemyError as exc:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="DB_UNAVAILABLE",
            error_message=f"Validation DB error: {exc}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="Validation Failed",
            record=str(job.id),
            description=f"DB_UNAVAILABLE: {exc}",
        )
        db.flush()
        logger.exception("Validation DB error job_id=%s", job.id)
        return job

    artifact_key = write_validation_artifact(job.id, result)
    job.validation_artifact_key = artifact_key
    # Proposal for review = normalized flat LetterCreate-compatible dict.
    job.proposal_json = json.dumps(result["normalizedProposal"], ensure_ascii=False)
    job.updated_at = datetime.now(UTC).replace(tzinfo=None)

    # Spec decision: always NEEDS_REVIEW when extraction succeeded (human can fix).
    transition_job(db, job, new_status=JobStatus.NEEDS_REVIEW)

    issue_count = sum(len(v) for v in (result.get("fieldIssues") or {}).values())
    blocking_count = len(result.get("blockingErrors") or [])
    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Validation Complete",
        record=str(job.id),
        description=(
            f"validation passed={result.get('passed')} "
            f"fieldIssues={issue_count} blocking={blocking_count} "
            f"artifact={artifact_key}"
        ),
    )
    db.flush()
    logger.info(
        "Validation stage done job_id=%s passed=%s key=%s",
        job.id,
        result.get("passed"),
        artifact_key,
    )
    return job
