from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine, ensure_database
from app.db_upgrade import (
    upgrade_ai_registration_schema,
    upgrade_letter_archive_columns,
    upgrade_notification_columns,
    upgrade_user_created_at,
)
import app.models  # noqa: F401 — register all ORM tables with Base.metadata
from app.administration_service import ensure_administration_seed, touch_session
from app.routers.administration import router as administration_router
from app.routers.ai import router as ai_router
from app.routers.ai_registration import router as ai_registration_router
from app.routers.dashboard import router as dashboard_router
from app.routers.letters import router as letters_router
from app.routers.workflow import router as workflow_router
from app.routers.approvals import router as approvals_router
from app.routers.escalations import router as escalations_router
from app.routers.reminders import router as reminders_router
from app.routers.documents import router as documents_router
from app.routers.meetings import router as meetings_router
from app.routers.correspondence import router as correspondence_router
from app.routers.data_operations import (
    archive_router,
    bulk_router,
    export_router,
    import_router,
)
from app.storage_service import ensure_storage_dirs
from app.jobs import run_reminder_cycle, start_background_workers
from app.routers.management import (
    audit_router,
    departments_router,
    master_router,
    notifications_router,
    organizations_router,
    settings_router,
    users_router,
)
from app.seed import (
    ensure_master_document_types,
    ensure_master_statuses,
    ensure_phase4b_samples,
    ensure_phase4d_samples,
    seed_if_empty,
)
from app.database import SessionLocal

settings = get_settings()
app = FastAPI(
    title="AILMS Correspondence API",
    description="Backend for the AI-based Correspondence Management System.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(letters_router, prefix="/api")
app.include_router(departments_router, prefix="/api")
app.include_router(organizations_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(master_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(workflow_router, prefix="/api")
app.include_router(approvals_router, prefix="/api")
app.include_router(escalations_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(meetings_router, prefix="/api")
app.include_router(correspondence_router, prefix="/api")
app.include_router(import_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(bulk_router, prefix="/api")
app.include_router(archive_router, prefix="/api")
app.include_router(administration_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(ai_registration_router, prefix="/api")


@app.on_event("startup")
def on_startup() -> None:
    ensure_database()
    ensure_storage_dirs()
    Base.metadata.create_all(bind=engine)
    upgrade_ai_registration_schema(engine)
    upgrade_notification_columns(engine)
    upgrade_letter_archive_columns(engine)
    upgrade_user_created_at(engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
        ensure_administration_seed(db)
        ensure_master_statuses(db)
        ensure_master_document_types(db)
        ensure_phase4b_samples(db)
        ensure_phase4d_samples(db)
        from app.notification_service import backfill_notification_metadata

        backfill_notification_metadata(db)
        touch_session(db, username="admin", display="Administrator")
        db.commit()
        run_reminder_cycle()
    finally:
        db.close()
    start_background_workers()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "ailms-api", "database": settings.postgres_db}
