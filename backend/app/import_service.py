"""CSV letter import validation and confirmed import."""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import Department, ImportError, ImportJob, Letter, MasterValue, User
from app.services import add_audit, bump_trend, current_user_name

REQUIRED_COLUMNS = {"number", "letterdate", "subject"}


def _normalize_header(name: str) -> str:
    return name.strip().lower().replace(" ", "").replace("_", "")


def _parse_date(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _master_values(db: Session, category: str) -> set[str]:
    return {row.value for row in db.query(MasterValue).filter(MasterValue.category == category).all()}


def _validate_row(db: Session, row_number: int, row: dict[str, str]) -> tuple[dict | None, list[ImportError]]:
    errors: list[ImportError] = []
    number = (row.get("number") or "").strip()
    subject = (row.get("subject") or "").strip()
    letter_date_raw = row.get("letterdate") or row.get("letter_date") or ""
    letter_date = _parse_date(letter_date_raw)

    if not number:
        errors.append(ImportError(row_number=row_number, field="number", message="Missing mandatory field", raw_value=letter_date_raw))
    if not subject:
        errors.append(ImportError(row_number=row_number, field="subject", message="Missing mandatory field", raw_value=subject))
    if not letter_date:
        errors.append(ImportError(row_number=row_number, field="letterDate", message="Invalid date", raw_value=letter_date_raw))

    letter_type = (row.get("type") or "Incoming").strip()
    priority = (row.get("priority") or "Routine").strip()
    status = (row.get("status") or "Registered").strip()
    department = (row.get("department") or "").strip()
    assigned_to = (row.get("assignedto") or row.get("assigned_to") or "").strip()

    valid_types = _master_values(db, "Letter Types") or {"Incoming", "Outgoing", "Internal Memo"}
    valid_priorities = _master_values(db, "Priorities") or {"Routine", "Important", "Urgent"}
    valid_statuses = _master_values(db, "Statuses") or {"Registered"}
    dept_names = {d.name for d in db.query(Department).all()}
    user_names = {u.name for u in db.query(User).all()}

    if letter_type and letter_type not in valid_types:
        errors.append(ImportError(row_number=row_number, field="type", message="Invalid letter type", raw_value=letter_type))
    if priority and priority not in valid_priorities:
        errors.append(ImportError(row_number=row_number, field="priority", message="Invalid priority", raw_value=priority))
    if status and status not in valid_statuses:
        errors.append(ImportError(row_number=row_number, field="status", message="Invalid status", raw_value=status))
    if department and dept_names and department not in dept_names:
        errors.append(ImportError(row_number=row_number, field="department", message="Invalid department", raw_value=department))
    if assigned_to and user_names and assigned_to not in user_names:
        errors.append(ImportError(row_number=row_number, field="assignedTo", message="Invalid user", raw_value=assigned_to))

    duplicate = db.query(Letter.id).filter(Letter.number == number).first() if number else None
    if duplicate:
        errors.append(ImportError(row_number=row_number, field="number", message="Duplicate letter number", raw_value=number))

    if errors:
        return None, errors

    received = _parse_date(row.get("receiveddate") or row.get("received_date") or "") or letter_date
    due = _parse_date(row.get("duedate") or row.get("due_date") or "")
    payload = {
        "number": number,
        "letter_date": letter_date,
        "received_date": received,
        "type": letter_type,
        "subject": subject,
        "sender": (row.get("from") or row.get("sender") or "").strip(),
        "recipient": (row.get("to") or row.get("recipient") or "").strip(),
        "department": department,
        "priority": priority,
        "status": status,
        "due_date": due,
        "assigned_to": assigned_to,
        "action_required": (row.get("actionrequired") or row.get("action_required") or "").strip(),
        "remarks": (row.get("remarks") or "").strip(),
    }
    return payload, errors


async def validate_letter_import(db: Session, upload: UploadFile, actor: str | None = None) -> ImportJob:
    actor = actor or current_user_name(db)
    content = (await upload.read()).decode("utf-8-sig", errors="replace")
    if not content.strip():
        raise HTTPException(status_code=422, detail="Validation failed: empty file")

    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="Validation failed: missing header row")

    header_map = {_normalize_header(h): h for h in reader.fieldnames}
    missing = REQUIRED_COLUMNS - set(header_map)
    if missing:
        raise HTTPException(status_code=422, detail=f"Validation failed: missing columns {', '.join(sorted(missing))}")

    job = ImportJob(
        entity_type="letters",
        filename=upload.filename or "import.csv",
        status="validated",
        created_by=actor,
    )
    db.add(job)
    db.flush()

    valid_payloads: list[dict] = []
    duplicate_rows = 0
    error_rows = 0
    total = 0

    for idx, raw in enumerate(reader, start=2):
        total += 1
        normalized = {_normalize_header(k): (v or "").strip() for k, v in raw.items() if k}
        if "number" not in normalized and "number" in header_map:
            normalized["number"] = raw.get(header_map["number"], "").strip()
        if "letterdate" not in normalized and "letterdate" in header_map:
            normalized["letterdate"] = raw.get(header_map["letterdate"], "").strip()
        if "subject" not in normalized and "subject" in header_map:
            normalized["subject"] = raw.get(header_map["subject"], "").strip()

        payload, errors = _validate_row(db, idx, normalized)
        if errors:
            for err in errors:
                err.import_job_id = job.id
                db.add(err)
            if any(e.message == "Duplicate letter number" for e in errors):
                duplicate_rows += 1
            error_rows += 1
            continue
        if payload:
            valid_payloads.append(payload)

    job.total_rows = total
    job.valid_rows = len(valid_payloads)
    job.rejected_rows = error_rows
    job.duplicate_rows = duplicate_rows
    job.error_rows = error_rows
    job.status = "ready" if valid_payloads else "failed"
    job.valid_rows_json = json.dumps(valid_payloads, default=str)
    db.flush()
    return job


def confirm_letter_import(db: Session, job_id: int, actor: str | None = None) -> ImportJob:
    actor = actor or current_user_name(db)
    job = db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    if job.status not in {"ready", "validated"}:
        raise HTTPException(status_code=400, detail="Import failed: job is not ready for confirmation")

    try:
        payloads: list[dict] = json.loads(job.valid_rows_json or "[]")
    except json.JSONDecodeError:
        payloads = []
    if not payloads:
        raise HTTPException(status_code=400, detail="Import failed: no valid rows to import")

    imported = 0
    for payload in payloads:
        if db.query(Letter.id).filter(Letter.number == payload["number"]).first():
            job.duplicate_rows += 1
            continue
        letter = Letter(
            number=payload["number"],
            letter_date=date.fromisoformat(str(payload["letter_date"])),
            received_date=date.fromisoformat(str(payload["received_date"])),
            type=payload["type"],
            subject=payload["subject"],
            sender=payload["sender"],
            recipient=payload["recipient"],
            department=payload["department"],
            priority=payload["priority"],
            status=payload["status"],
            due_date=date.fromisoformat(str(payload["due_date"])) if payload.get("due_date") else None,
            assigned_to=payload["assigned_to"],
            action_required=payload["action_required"],
            remarks=payload["remarks"],
            last_action="Imported",
        )
        db.add(letter)
        db.flush()
        bump_trend(db, letter.type, letter.letter_date)
        imported += 1
    job.imported_rows = imported
    job.status = "completed"
    job.completed_at = datetime.now()
    add_audit(
        db,
        user=actor,
        module="Import",
        action="Letters Imported",
        record=str(job.id),
        description=f"Imported {imported} of {job.total_rows} rows from {job.filename}",
    )
    db.flush()
    return job


def serialize_import_job(db: Session, job: ImportJob) -> dict:
    errors = db.query(ImportError).filter(ImportError.import_job_id == job.id).order_by(ImportError.row_number).all()
    return {
        "id": job.id,
        "entityType": job.entity_type,
        "filename": job.filename,
        "status": job.status,
        "totalRows": job.total_rows,
        "validRows": job.valid_rows,
        "importedRows": job.imported_rows,
        "rejectedRows": job.rejected_rows,
        "duplicateRows": job.duplicate_rows,
        "errorRows": job.error_rows,
        "createdBy": job.created_by,
        "createdAt": job.created_at.isoformat(),
        "completedAt": job.completed_at.isoformat() if job.completed_at else "",
        "errors": [
            {"rowNumber": e.row_number, "field": e.field, "message": e.message, "rawValue": e.raw_value}
            for e in errors
        ],
    }
