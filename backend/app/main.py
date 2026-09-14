from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine, ensure_database
from app.routers.dashboard import router as dashboard_router
from app.routers.letters import router as letters_router
from app.routers.management import (
    audit_router,
    departments_router,
    master_router,
    notifications_router,
    organizations_router,
    settings_router,
    users_router,
)
from app.seed import seed_if_empty
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


@app.on_event("startup")
def on_startup() -> None:
    ensure_database()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
    finally:
        db.close()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "ailms-api", "database": settings.postgres_db}
