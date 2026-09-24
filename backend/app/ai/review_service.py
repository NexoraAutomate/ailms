"""Human review API for AI registration jobs (master plan step 10 / spec 07).

Fetch enriched proposal, patch fields with override tracking, reject, and
request re-run — without creating a letter (approve/commit is step 12).
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.ai.extraction_service import load_extraction_artifact
from app.ai.job_service import get_registration_job, serialize_job, transition_job
from app.ai.job_states import JobStatus
from app.ai.validation_service import strip_html
from app.models import AiRegistrationJob, AiStagedDocument
from app.services import add_audit, current_user_name, resolve_user_role
from app.storage_service import can_preview, resolve_storage_path

logger = logging.getLogger(__name__)

# Editable LetterCreate-aligned keys (excludes system defaults set at validation).
_EDITABLE_PROPOSAL_KEYS: frozenset[str] = frozenset(
    {
        "number",
        "letterDate",
        "receivedDate",
        "type",
        "subject",
        "from",
        "to",
        "department",
        "priority",
        "dueDate",
        "assignedTo",
        "confidentiality",
        "actionRequired",
        "remarks",
        "summary",
        "documentCategory",
        "relatedLetterNumbers",
    }
)

_ADMIN_ROLES: frozenset[str] = frozenset({"Administrator"})


def _iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_proposal(raw: str) -> dict[str, Any]:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def assert_job_access(
    db: Session,
    job: AiRegistrationJob,
    *,
    actor: str | None = None,
) -> str:
    """
    Enforce job ownership (R4): created_by must match current user unless Administrator.

    Returns the resolved actor name.
    """
    actor = actor or current_user_name(db)
    owner = (job.created_by or "").strip()
    if not owner or owner == actor:
        return actor
    role = resolve_user_role(db, actor)
    if role in _ADMIN_ROLES:
        return actor
    raise HTTPException(status_code=403, detail="Not allowed to access this job")


def assert_staged_document_access(
    db: Session,
    staged: AiStagedDocument,
    *,
    actor: str | None = None,
) -> str:
    """Preview access: uploader, job owner for this staged file, or Administrator."""
    actor = actor or current_user_name(db)
    if (staged.uploaded_by or "").strip() in {"", actor}:
        return actor
    role = resolve_user_role(db, actor)
    if role in _ADMIN_ROLES:
        return actor
    owns_job = (
        db.query(AiRegistrationJob.id)
        .filter(
            AiRegistrationJob.staged_document_id == staged.id,
            AiRegistrationJob.created_by == actor,
        )
        .first()
        is not None
    )
    if owns_job:
        return actor
    raise HTTPException(status_code=403, detail="Not allowed to access this staged document")


def _staged_document_payload(staged: AiStagedDocument | None) -> dict[str, Any] | None:
    if staged is None:
        return None
    return {
        "id": str(staged.id),
        "originalFilename": staged.original_filename,
        "mimeType": staged.mime_type,
        "previewUrl": f"/api/ai-registration/staged-documents/{staged.id}/preview",
    }


def _evidence_from_job(job: AiRegistrationJob) -> list[dict[str, Any]]:
    key = (job.extraction_artifact_key or "").strip()
    if not key:
        return []
    artifact = load_extraction_artifact(key)
    if not artifact or not isinstance(artifact, dict):
        return []
    evidence = artifact.get("evidence") or []
    if not isinstance(evidence, list):
        return []
    out: list[dict[str, Any]] = []
    for item in evidence:
        if isinstance(item, dict):
            out.append(dict(item))
    return out


def _ai_generated_fields(job: AiRegistrationJob, proposal: dict[str, Any]) -> list[str]:
    """Fields originally sourced from extraction (still AI-marked after human edit)."""
    key = (job.extraction_artifact_key or "").strip()
    if key:
        artifact = load_extraction_artifact(key)
        if artifact and isinstance(artifact, dict):
            fields = artifact.get("fields") or {}
            if isinstance(fields, dict):
                names: list[str] = []
                for name in fields:
                    if name not in _EDITABLE_PROPOSAL_KEYS:
                        continue
                    field = fields.get(name)
                    if isinstance(field, dict):
                        val = field.get("value")
                    else:
                        val = field
                    if val is None or val == "" or val == []:
                        continue
                    names.append(str(name))
                if names:
                    return names

    # Fallback: non-empty proposal values excluding meta / empty.
    names = []
    for name in _EDITABLE_PROPOSAL_KEYS:
        val = proposal.get(name)
        if val is None or val == "" or val == []:
            continue
        names.append(name)
    return names


def enrich_job_payload(db: Session, job: AiRegistrationJob) -> dict[str, Any]:
    """Extend serialize_job with review-facing stagedDocument / evidence / aiGenerated."""
    payload = serialize_job(job)
    staged = (
        db.query(AiStagedDocument)
        .filter(AiStagedDocument.id == job.staged_document_id)
        .one_or_none()
    )
    proposal = _parse_proposal(job.proposal_json or "")
    payload["stagedDocument"] = _staged_document_payload(staged)
    payload["evidence"] = _evidence_from_job(job)
    payload["aiGenerated"] = _ai_generated_fields(job, proposal)
    payload["userOverrides"] = proposal.get("userOverrides") if isinstance(proposal.get("userOverrides"), dict) else {}
    payload["reviewedBy"] = job.reviewed_by or None
    return payload


def _sanitize_patch_value(key: str, value: Any) -> Any:
    if key == "relatedLetterNumbers":
        if value is None:
            return []
        if isinstance(value, list):
            cleaned: list[str] = []
            for item in value[:20]:
                text = strip_html(str(item)).strip()[:80]
                if text:
                    cleaned.append(text)
            return cleaned
        text = strip_html(str(value)).strip()[:80]
        return [text] if text else []

    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return value
    text = strip_html(str(value)).strip()
    return text


def patch_proposal(
    db: Session,
    *,
    job_id: int,
    updates: dict[str, Any],
    actor: str | None = None,
) -> AiRegistrationJob:
    """
    Merge partial field updates into proposal_json while job is NEEDS_REVIEW.

    Tracks userOverrides; does not create a letter.
    """
    job = get_registration_job(db, job_id)
    actor = assert_job_access(db, job, actor=actor)

    if job.status != JobStatus.NEEDS_REVIEW.value:
        raise HTTPException(
            status_code=409,
            detail=f"Proposal can only be edited when NEEDS_REVIEW (current={job.status})",
        )

    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=422, detail="PATCH body must be a non-empty field map")

    unknown = [k for k in updates if k not in _EDITABLE_PROPOSAL_KEYS]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or non-editable fields: {', '.join(sorted(unknown))}",
        )

    proposal = _parse_proposal(job.proposal_json or "")
    overrides = proposal.get("userOverrides")
    if not isinstance(overrides, dict):
        overrides = {}

    changed: list[str] = []
    now = _iso_now()
    for key, raw_value in updates.items():
        new_value = _sanitize_patch_value(key, raw_value)
        old_value = proposal.get(key)
        if old_value == new_value:
            continue
        overrides[key] = {
            "from": old_value,
            "to": new_value,
            "at": now,
            "by": actor,
        }
        proposal[key] = new_value
        changed.append(key)

    if not changed:
        return job

    proposal["userOverrides"] = overrides
    # Drop accidental top-level meta pollution from empty-OCR proposals if present.
    job.proposal_json = json.dumps(proposal, ensure_ascii=False)
    job.reviewed_by = actor
    job.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.flush()

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Proposal Edited",
        record=str(job.id),
        description=f"Updated fields: {', '.join(changed)}",
    )
    db.flush()
    logger.info("AI registration proposal patched job_id=%s fields=%s", job.id, changed)
    return job


def reject_job(
    db: Session,
    *,
    job_id: int,
    reason: str = "",
    actor: str | None = None,
) -> AiRegistrationJob:
    """Mark job REJECTED; retain artifacts; no letter created."""
    job = get_registration_job(db, job_id)
    actor = assert_job_access(db, job, actor=actor)

    if job.status != JobStatus.NEEDS_REVIEW.value:
        raise HTTPException(
            status_code=409,
            detail=f"Only NEEDS_REVIEW jobs can be rejected (current={job.status})",
        )

    reason_clean = strip_html(reason or "").strip()[:2000]
    transition_job(db, job, new_status=JobStatus.REJECTED)
    job.reviewed_by = actor
    if reason_clean:
        job.error_code = job.error_code or "REJECTED"
        job.error_message = reason_clean

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Rejected",
        record=str(job.id),
        description=reason_clean or "Job rejected without reason",
    )
    db.flush()
    logger.info("AI registration job rejected id=%s", job.id)
    return job


def request_rerun(
    db: Session,
    *,
    job_id: int,
    actor: str | None = None,
) -> AiRegistrationJob:
    """Re-queue a NEEDS_REVIEW job for another OCR→LLM→validate pass."""
    job = get_registration_job(db, job_id)
    actor = assert_job_access(db, job, actor=actor)

    if job.status != JobStatus.NEEDS_REVIEW.value:
        raise HTTPException(
            status_code=409,
            detail=f"Only NEEDS_REVIEW jobs can request re-run (current={job.status})",
        )

    # Clear review-ready proposal so worker rebuilds; artifacts are versioned on write.
    job.proposal_json = ""
    job.reviewed_by = ""
    transition_job(db, job, new_status=JobStatus.QUEUED)

    add_audit(
        db,
        user=actor,
        module="AI Registration",
        action="Re-run Requested",
        record=str(job.id),
        description="Job re-queued from NEEDS_REVIEW for another analysis pass",
    )
    db.flush()
    logger.info("AI registration job re-run requested id=%s → QUEUED", job.id)
    return job


def get_staged_document_for_preview(
    db: Session,
    staged_id: int,
    *,
    actor: str | None = None,
) -> tuple[AiStagedDocument, Path]:
    """Resolve staged file path for inline preview after access check."""
    staged = (
        db.query(AiStagedDocument).filter(AiStagedDocument.id == staged_id).one_or_none()
    )
    if staged is None:
        raise HTTPException(status_code=404, detail="Staged document not found")

    assert_staged_document_access(db, staged, actor=actor)

    ext = Path(staged.original_filename or "").suffix.lower()
    if not can_preview(ext):
        raise HTTPException(status_code=415, detail="Preview not available for this file type")

    try:
        path = resolve_storage_path(staged.storage_key)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Staged file missing") from exc

    if not path.is_file():
        raise HTTPException(status_code=404, detail="Staged file missing")

    return staged, path
