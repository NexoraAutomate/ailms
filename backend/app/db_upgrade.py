"""Lightweight PostgreSQL schema upgrades (no Alembic)."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def upgrade_ai_registration_schema(engine: Engine) -> None:
    """Create AI letter-registration tables and add any missing columns."""
    inspector = inspect(engine)

    if not inspector.has_table("cms_ai_staged_documents"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_ai_staged_documents (
                        id SERIAL PRIMARY KEY,
                        original_filename VARCHAR(255) NOT NULL,
                        mime_type VARCHAR(120) DEFAULT 'application/octet-stream',
                        file_size INTEGER DEFAULT 0,
                        checksum VARCHAR(64) DEFAULT '',
                        storage_key VARCHAR(512) NOT NULL,
                        uploaded_by VARCHAR(120) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_staged_documents_checksum "
                    "ON cms_ai_staged_documents (checksum)"
                )
            )

    if not inspector.has_table("cms_ai_registration_jobs"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_ai_registration_jobs (
                        id SERIAL PRIMARY KEY,
                        staged_document_id INTEGER NOT NULL
                            REFERENCES cms_ai_staged_documents(id) ON DELETE RESTRICT,
                        letter_id INTEGER NULL
                            REFERENCES cms_letters(id) ON DELETE SET NULL,
                        status VARCHAR(40) DEFAULT 'QUEUED',
                        error_code VARCHAR(80) DEFAULT '',
                        error_message TEXT DEFAULT '',
                        ocr_artifact_key VARCHAR(512) DEFAULT '',
                        normalized_artifact_key VARCHAR(512) DEFAULT '',
                        extraction_artifact_key VARCHAR(512) DEFAULT '',
                        validation_artifact_key VARCHAR(512) DEFAULT '',
                        proposal_json TEXT DEFAULT '',
                        prompt_version VARCHAR(40) DEFAULT '',
                        model_id VARCHAR(120) DEFAULT '',
                        model_config_json TEXT DEFAULT '',
                        created_by VARCHAR(120) DEFAULT '',
                        reviewed_by VARCHAR(120) DEFAULT '',
                        approved_by VARCHAR(120) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        started_at TIMESTAMP NULL,
                        ocr_completed_at TIMESTAMP NULL,
                        extraction_completed_at TIMESTAMP NULL,
                        review_ready_at TIMESTAMP NULL,
                        approved_at TIMESTAMP NULL,
                        completed_at TIMESTAMP NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_registration_jobs_status "
                    "ON cms_ai_registration_jobs (status)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_registration_jobs_staged_document_id "
                    "ON cms_ai_registration_jobs (staged_document_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_registration_jobs_letter_id "
                    "ON cms_ai_registration_jobs (letter_id)"
                )
            )

    if not inspector.has_table("cms_ai_runs"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_ai_runs (
                        id SERIAL PRIMARY KEY,
                        job_id INTEGER NOT NULL
                            REFERENCES cms_ai_registration_jobs(id) ON DELETE CASCADE,
                        stage VARCHAR(40) DEFAULT '',
                        model_id VARCHAR(120) DEFAULT '',
                        prompt_version VARCHAR(40) DEFAULT '',
                        input_artifact_key VARCHAR(512) DEFAULT '',
                        output_artifact_key VARCHAR(512) DEFAULT '',
                        latency_ms INTEGER NULL,
                        status VARCHAR(20) DEFAULT '',
                        error_message TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_runs_job_id "
                    "ON cms_ai_runs (job_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_runs_stage "
                    "ON cms_ai_runs (stage)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_ai_runs_status "
                    "ON cms_ai_runs (status)"
                )
            )

    # Additive column upgrades for existing deployments that already have the tables.
    inspector = inspect(engine)
    if inspector.has_table("cms_ai_registration_jobs"):
        columns = {col["name"] for col in inspector.get_columns("cms_ai_registration_jobs")}
        statements: list[str] = []
        expected = {
            "started_at": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN started_at TIMESTAMP NULL",
            "ocr_completed_at": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN ocr_completed_at TIMESTAMP NULL",
            "extraction_completed_at": (
                "ALTER TABLE cms_ai_registration_jobs ADD COLUMN extraction_completed_at TIMESTAMP NULL"
            ),
            "review_ready_at": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN review_ready_at TIMESTAMP NULL",
            "approved_at": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN approved_at TIMESTAMP NULL",
            "completed_at": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN completed_at TIMESTAMP NULL",
            "proposal_json": "ALTER TABLE cms_ai_registration_jobs ADD COLUMN proposal_json TEXT DEFAULT ''",
            "model_config_json": (
                "ALTER TABLE cms_ai_registration_jobs ADD COLUMN model_config_json TEXT DEFAULT ''"
            ),
            "normalized_artifact_key": (
                "ALTER TABLE cms_ai_registration_jobs ADD COLUMN normalized_artifact_key VARCHAR(512) DEFAULT ''"
            ),
            "validation_artifact_key": (
                "ALTER TABLE cms_ai_registration_jobs ADD COLUMN validation_artifact_key VARCHAR(512) DEFAULT ''"
            ),
        }
        for name, stmt in expected.items():
            if name not in columns:
                statements.append(stmt)
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))


def upgrade_notification_columns(engine: Engine) -> None:
    columns = {col["name"] for col in inspect(engine).get_columns("cms_notifications")} if inspect(engine).has_table("cms_notifications") else set()
    if not columns:
        return

    statements = []
    if "recipient_user_id" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN recipient_user_id INTEGER REFERENCES cms_users(id) ON DELETE SET NULL")
    if "recipient_name" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN recipient_name VARCHAR(120) DEFAULT ''")
    if "notification_type" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN notification_type VARCHAR(60) DEFAULT 'System Notification'")
    if "related_entity_type" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN related_entity_type VARCHAR(40) DEFAULT ''")
    if "related_entity_id" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN related_entity_id VARCHAR(80) DEFAULT ''")
    if "read_at" not in columns:
        statements.append("ALTER TABLE cms_notifications ADD COLUMN read_at TIMESTAMP NULL")

    if not statements:
        return

    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def upgrade_user_created_at(engine: Engine) -> None:
    if not inspect(engine).has_table("cms_users"):
        return
    columns = {col["name"] for col in inspect(engine).get_columns("cms_users")}
    if "created_at" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE cms_users ADD COLUMN created_at TIMESTAMP DEFAULT NOW()"))


def upgrade_letter_archive_columns(engine: Engine) -> None:
    if not inspect(engine).has_table("cms_letters"):
        return
    columns = {col["name"] for col in inspect(engine).get_columns("cms_letters")}
    statements = []
    if "is_archived" not in columns:
        statements.append("ALTER TABLE cms_letters ADD COLUMN is_archived BOOLEAN DEFAULT FALSE")
    if "archived_at" not in columns:
        statements.append("ALTER TABLE cms_letters ADD COLUMN archived_at TIMESTAMP NULL")
    if not statements:
        return
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
