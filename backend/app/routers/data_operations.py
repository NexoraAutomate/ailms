from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.archive_service import archive_letters, restore_letters
from app.bulk_service import run_bulk_operation
from app.database import get_db
from app.export_service import (
    export_audit_csv,
    export_departments_csv,
    export_letters_csv,
    export_meetings_csv,
    export_notifications_csv,
    export_organizations_csv,
)
from app.import_service import confirm_letter_import, serialize_import_job, validate_letter_import
from app.services import current_user_name

import_router = APIRouter(prefix="/import", tags=["import"])
export_router = APIRouter(prefix="/export", tags=["export"])
bulk_router = APIRouter(prefix="/bulk", tags=["bulk"])
archive_router = APIRouter(prefix="/archive", tags=["archive"])


class BulkOperationIn(BaseModel):
    operation: str
    letter_ids: list[int] = Field(alias="letterIds")
    payload: dict | None = None

    model_config = {"populate_by_name": True}


class ArchiveLettersIn(BaseModel):
    letter_ids: list[int] = Field(alias="letterIds")

    model_config = {"populate_by_name": True}


@import_router.post("/letters/validate")
async def validate_letters_import(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    job = await validate_letter_import(db, file)
    db.commit()
    return serialize_import_job(db, job)


@import_router.post("/letters/{job_id}/confirm")
def confirm_letters_import(job_id: int, db: Session = Depends(get_db)) -> dict:
    job = confirm_letter_import(db, job_id)
    db.commit()
    return serialize_import_job(db, job)


@import_router.get("/letters/{job_id}")
def get_import_job(job_id: int, db: Session = Depends(get_db)) -> dict:
    from app.models import ImportJob

    job = db.get(ImportJob, job_id)
    if not job:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Import job not found")
    return serialize_import_job(db, job)


@export_router.get("/letters")
def export_letters(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    body = export_letters_csv(db, include_archived=include_archived)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="letters.csv"'})


@export_router.get("/departments")
def export_departments(db: Session = Depends(get_db)) -> PlainTextResponse:
    body = export_departments_csv(db)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="departments.csv"'})


@export_router.get("/organizations")
def export_organizations(db: Session = Depends(get_db)) -> PlainTextResponse:
    body = export_organizations_csv(db)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="organizations.csv"'})


@export_router.get("/audit")
def export_audit(db: Session = Depends(get_db)) -> PlainTextResponse:
    body = export_audit_csv(db)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="audit.csv"'})


@export_router.get("/meetings")
def export_meetings(db: Session = Depends(get_db)) -> PlainTextResponse:
    body = export_meetings_csv(db)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="meetings.csv"'})


@export_router.get("/notifications")
def export_notifications(db: Session = Depends(get_db)) -> PlainTextResponse:
    recipient = current_user_name(db)
    body = export_notifications_csv(db, recipient=recipient)
    return PlainTextResponse(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="notifications.csv"'})


@bulk_router.post("")
def bulk_operation(payload: BulkOperationIn, db: Session = Depends(get_db)) -> dict:
    result = run_bulk_operation(db, payload.operation, payload.letter_ids, payload.payload)
    db.commit()
    return result


@archive_router.post("/letters")
def archive_letters_endpoint(payload: ArchiveLettersIn, db: Session = Depends(get_db)) -> dict:
    ids = archive_letters(db, payload.letter_ids)
    db.commit()
    return {"archived": ids, "count": len(ids)}


@archive_router.post("/letters/restore")
def restore_letters_endpoint(payload: ArchiveLettersIn, db: Session = Depends(get_db)) -> dict:
    ids = restore_letters(db, payload.letter_ids)
    db.commit()
    return {"restored": ids, "count": len(ids)}
