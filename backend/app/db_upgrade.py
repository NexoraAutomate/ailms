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


def upgrade_letter_qa_cache_schema(engine: Engine) -> None:
    """Create letter Q&A cache table for repeated-question LLM savings."""
    inspector = inspect(engine)
    if inspector.has_table("cms_letter_qa_cache"):
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE cms_letter_qa_cache (
                    id SERIAL PRIMARY KEY,
                    letter_id INTEGER NOT NULL
                        REFERENCES cms_letters(id) ON DELETE CASCADE,
                    question TEXT DEFAULT '',
                    question_normalized VARCHAR(500) DEFAULT '',
                    question_hash VARCHAR(64) NOT NULL,
                    answer TEXT DEFAULT '',
                    content_fingerprint VARCHAR(64) DEFAULT '',
                    model_id VARCHAR(120) DEFAULT '',
                    source VARCHAR(40) DEFAULT 'llm',
                    hit_count INTEGER DEFAULT 0,
                    asked_by VARCHAR(120) DEFAULT '',
                    asked_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_letter_qa_question UNIQUE (letter_id, question_hash)
                )
                """
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letter_qa_cache_letter_id "
                "ON cms_letter_qa_cache (letter_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letter_qa_cache_question_hash "
                "ON cms_letter_qa_cache (question_hash)"
            )
        )


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


def upgrade_user_auth_schema(engine: Engine) -> None:
    """Add password and lockout columns for authentication."""
    inspector = inspect(engine)
    if inspector.has_table("cms_users"):
        columns = {col["name"] for col in inspector.get_columns("cms_users")}
        statements = []
        if "password_hash" not in columns:
            statements.append("ALTER TABLE cms_users ADD COLUMN password_hash VARCHAR(255) DEFAULT ''")
        if "failed_login_attempts" not in columns:
            statements.append("ALTER TABLE cms_users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0")
        if "locked_until" not in columns:
            statements.append("ALTER TABLE cms_users ADD COLUMN locked_until TIMESTAMP NULL")
        if "avatar_key" not in columns:
            statements.append("ALTER TABLE cms_users ADD COLUMN avatar_key VARCHAR(512) DEFAULT ''")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))

    if inspector.has_table("cms_user_sessions"):
        columns = {col["name"] for col in inspector.get_columns("cms_user_sessions")}
        if "token_jti" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE cms_user_sessions ADD COLUMN token_jti VARCHAR(64) DEFAULT ''"))
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_user_sessions_token_jti "
                        "ON cms_user_sessions (token_jti)"
                    )
                )


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


def upgrade_letter_body_text_column(engine: Engine) -> None:
    if not inspect(engine).has_table("cms_letters"):
        return
    columns = {col["name"] for col in inspect(engine).get_columns("cms_letters")}
    if "body_text" in columns:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE cms_letters ADD COLUMN body_text TEXT DEFAULT ''"))


def ensure_pgvector_extension(engine: Engine) -> None:
    """Install pgvector extension (required before ORM create_all of LetterChunk)."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))


def upgrade_letter_chunks_schema(engine: Engine, *, dimensions: int | None = None) -> None:
    """Create pgvector extension + cms_letter_chunks for hybrid RAG.

    When EMBEDDING_DIMENSIONS changes (demo OpenAI 1536 → on-prem 768), the
    table is dropped and recreated so vectors stay consistent; run reindex after.
    """
    from app.config import get_settings

    dims = int(dimensions if dimensions is not None else get_settings().embedding_dimensions)
    if dims < 8 or dims > 8192:
        dims = 1536

    ensure_pgvector_extension(engine)

    inspector = inspect(engine)
    if not inspector.has_table("cms_letters"):
        return

    if inspector.has_table("cms_letter_chunks"):
        # Detect existing vector(N); recreate if dimension mismatch.
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT format_type(a.atttypid, a.atttypmod) AS typ
                    FROM pg_attribute a
                    JOIN pg_class c ON a.attrelid = c.oid
                    JOIN pg_namespace n ON c.relnamespace = n.oid
                    WHERE c.relname = 'cms_letter_chunks'
                      AND a.attname = 'embedding'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                    """
                )
            ).first()
        typ = (row[0] if row else "") or ""
        expected = f"vector({dims})"
        if typ == expected:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_letter_chunks_letter_id "
                        "ON cms_letter_chunks (letter_id)"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_letter_chunks_embedding_model "
                        "ON cms_letter_chunks (embedding_model)"
                    )
                )
                # HNSW may already exist; IF NOT EXISTS supported on PG 9.5+ for indexes.
                conn.execute(
                    text(
                        """
                        DO $$
                        BEGIN
                          IF NOT EXISTS (
                            SELECT 1 FROM pg_class WHERE relname = 'ix_cms_letter_chunks_embedding_hnsw'
                          ) THEN
                            CREATE INDEX ix_cms_letter_chunks_embedding_hnsw
                              ON cms_letter_chunks
                              USING hnsw (embedding vector_cosine_ops);
                          END IF;
                        END $$;
                        """
                    )
                )
            return
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS cms_letter_chunks CASCADE"))

    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                CREATE TABLE cms_letter_chunks (
                    id SERIAL PRIMARY KEY,
                    letter_id INTEGER NOT NULL
                        REFERENCES cms_letters(id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL DEFAULT 0,
                    content TEXT NOT NULL DEFAULT '',
                    embedding vector({dims}),
                    content_hash VARCHAR(64) NOT NULL DEFAULT '',
                    embedding_model VARCHAR(120) NOT NULL DEFAULT '',
                    updated_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_letter_chunk_index UNIQUE (letter_id, chunk_index)
                )
                """
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letter_chunks_letter_id "
                "ON cms_letter_chunks (letter_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letter_chunks_embedding_model "
                "ON cms_letter_chunks (embedding_model)"
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX ix_cms_letter_chunks_embedding_hnsw
                  ON cms_letter_chunks
                  USING hnsw (embedding vector_cosine_ops)
                """
            )
        )


def upgrade_letter_ownership_columns(engine: Engine) -> None:
    """Add created_by / assigned_by for per-user letter visibility."""
    if not inspect(engine).has_table("cms_letters"):
        return
    columns = {col["name"] for col in inspect(engine).get_columns("cms_letters")}
    statements = []
    if "created_by" not in columns:
        statements.append("ALTER TABLE cms_letters ADD COLUMN created_by VARCHAR(120) DEFAULT ''")
    if "assigned_by" not in columns:
        statements.append("ALTER TABLE cms_letters ADD COLUMN assigned_by VARCHAR(120) DEFAULT ''")
    if not statements:
        return
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letters_created_by ON cms_letters (created_by)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_cms_letters_assigned_by ON cms_letters (assigned_by)"
            )
        )


def backfill_letter_ownership(db) -> None:
    """Best-effort fill created_by / assigned_by from audit and workflow history."""
    from app.models import AuditRecord, Letter, WorkflowTransition

    # created_by from Letter Registered audits
    audits = (
        db.query(AuditRecord)
        .filter(AuditRecord.action == "Letter Registered", AuditRecord.record != "")
        .order_by(AuditRecord.id.asc())
        .all()
    )
    number_to_creator: dict[str, str] = {}
    for row in audits:
        if row.record and row.user and row.record not in number_to_creator:
            number_to_creator[row.record] = row.user

    if number_to_creator:
        letters = db.query(Letter).filter(Letter.created_by == "").all()
        for letter in letters:
            creator = number_to_creator.get(letter.number)
            if creator:
                letter.created_by = creator

    # assigned_by from latest assign/reassign transition
    transitions = (
        db.query(WorkflowTransition)
        .filter(WorkflowTransition.action.in_(["assign", "reassign"]))
        .order_by(WorkflowTransition.id.desc())
        .all()
    )
    letter_assigner: dict[int, str] = {}
    for row in transitions:
        if row.letter_id not in letter_assigner and row.performed_by:
            letter_assigner[row.letter_id] = row.performed_by

    if letter_assigner:
        letters = db.query(Letter).filter(Letter.assigned_by == "", Letter.id.in_(list(letter_assigner.keys()))).all()
        for letter in letters:
            assigner = letter_assigner.get(letter.id)
            if assigner:
                letter.assigned_by = assigner

    # If still blank but has assignee, treat creator as assigner when known
    for letter in db.query(Letter).filter(Letter.assigned_by == "", Letter.assigned_to != "").all():
        if letter.created_by:
            letter.assigned_by = letter.created_by



def upgrade_department_org_schema(engine: Engine) -> None:
    """Add org-chart columns and coordination links for departments."""
    inspector = inspect(engine)
    if not inspector.has_table("cms_departments"):
        return

    columns = {col["name"] for col in inspector.get_columns("cms_departments")}
    statements = []
    if "parent_id" not in columns:
        statements.append(
            "ALTER TABLE cms_departments ADD COLUMN parent_id INTEGER "
            "REFERENCES cms_departments(id) ON DELETE SET NULL"
        )
    if "pos_x" not in columns:
        statements.append("ALTER TABLE cms_departments ADD COLUMN pos_x DOUBLE PRECISION DEFAULT 0")
    if "pos_y" not in columns:
        statements.append("ALTER TABLE cms_departments ADD COLUMN pos_y DOUBLE PRECISION DEFAULT 0")

    if statements:
        with engine.begin() as conn:
            for stmt in statements:
                conn.execute(text(stmt))
            if "parent_id" not in columns:
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_departments_parent_id "
                        "ON cms_departments (parent_id)"
                    )
                )

    if not inspector.has_table("cms_department_links"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_department_links (
                        id SERIAL PRIMARY KEY,
                        source_id INTEGER NOT NULL
                            REFERENCES cms_departments(id) ON DELETE CASCADE,
                        target_id INTEGER NOT NULL
                            REFERENCES cms_departments(id) ON DELETE CASCADE,
                        kind VARCHAR(40) DEFAULT 'coordinates',
                        CONSTRAINT uq_dept_link_pair UNIQUE (source_id, target_id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_department_links_source_id "
                    "ON cms_department_links (source_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_department_links_target_id "
                    "ON cms_department_links (target_id)"
                )
            )


def upgrade_enterprise_workflow_schema(engine: Engine) -> None:
    """Enterprise RouteStep / ActionItem / ResponseVersion / ApprovalStep / Dispatch."""
    inspector = inspect(engine)

    if inspector.has_table("cms_departments"):
        columns = {col["name"] for col in inspector.get_columns("cms_departments")}
        if "tier" not in columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE cms_departments ADD COLUMN tier VARCHAR(40) DEFAULT 'Division'")
                )

    if inspector.has_table("cms_letters"):
        columns = {col["name"] for col in inspector.get_columns("cms_letters")}
        statements: list[str] = []
        if "correspondence_category" not in columns:
            statements.append(
                "ALTER TABLE cms_letters ADD COLUMN correspondence_category VARCHAR(40) DEFAULT ''"
            )
        if "close_reason" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN close_reason VARCHAR(60) DEFAULT ''")
        if "department_id" not in columns:
            statements.append(
                "ALTER TABLE cms_letters ADD COLUMN department_id INTEGER "
                "REFERENCES cms_departments(id) ON DELETE SET NULL"
            )
        if "validated_at" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN validated_at TIMESTAMP NULL")
        if "classified_at" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN classified_at TIMESTAMP NULL")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "department_id" not in columns:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_cms_letters_department_id "
                            "ON cms_letters (department_id)"
                        )
                    )

    if not inspector.has_table("cms_route_steps"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_route_steps (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL
                            REFERENCES cms_letters(id) ON DELETE CASCADE,
                        step_type VARCHAR(40) DEFAULT 'ROUTE',
                        from_department_id INTEGER
                            REFERENCES cms_departments(id) ON DELETE SET NULL,
                        to_department_id INTEGER
                            REFERENCES cms_departments(id) ON DELETE SET NULL,
                        from_user VARCHAR(120) DEFAULT '',
                        to_user VARCHAR(120) DEFAULT '',
                        instructions TEXT DEFAULT '',
                        due_date DATE NULL,
                        priority VARCHAR(40) DEFAULT '',
                        active BOOLEAN DEFAULT TRUE,
                        acknowledged_at TIMESTAMP NULL,
                        created_by VARCHAR(120) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_route_steps_letter_id ON cms_route_steps (letter_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_route_steps_step_type ON cms_route_steps (step_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_route_steps_to_user ON cms_route_steps (to_user)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_route_steps_active ON cms_route_steps (active)"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_route_steps_to_department_id "
                    "ON cms_route_steps (to_department_id)"
                )
            )

    if not inspector.has_table("cms_action_items"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_action_items (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL
                            REFERENCES cms_letters(id) ON DELETE CASCADE,
                        parent_action_id INTEGER
                            REFERENCES cms_action_items(id) ON DELETE SET NULL,
                        department_id INTEGER
                            REFERENCES cms_departments(id) ON DELETE SET NULL,
                        assignee VARCHAR(120) DEFAULT '',
                        status VARCHAR(40) DEFAULT 'Open',
                        instructions TEXT DEFAULT '',
                        due_date DATE NULL,
                        blocked_reason TEXT DEFAULT '',
                        created_by VARCHAR(120) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        completed_at TIMESTAMP NULL
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_action_items_letter_id ON cms_action_items (letter_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_action_items_assignee ON cms_action_items (assignee)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cms_action_items_status ON cms_action_items (status)"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_action_items_department_id "
                    "ON cms_action_items (department_id)"
                )
            )

    if not inspector.has_table("cms_response_versions"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_response_versions (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL
                            REFERENCES cms_letters(id) ON DELETE CASCADE,
                        version INTEGER DEFAULT 1,
                        body_text TEXT DEFAULT '',
                        status VARCHAR(40) DEFAULT 'Draft',
                        prepared_by VARCHAR(120) DEFAULT '',
                        document_id INTEGER
                            REFERENCES cms_documents(id) ON DELETE SET NULL,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_response_versions_letter_id "
                    "ON cms_response_versions (letter_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_response_versions_status "
                    "ON cms_response_versions (status)"
                )
            )

    if not inspector.has_table("cms_approval_steps"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_approval_steps (
                        id SERIAL PRIMARY KEY,
                        response_version_id INTEGER NOT NULL
                            REFERENCES cms_response_versions(id) ON DELETE CASCADE,
                        tier_order INTEGER DEFAULT 1,
                        department_id INTEGER
                            REFERENCES cms_departments(id) ON DELETE SET NULL,
                        reviewer VARCHAR(120) DEFAULT '',
                        status VARCHAR(40) DEFAULT 'Pending',
                        remarks TEXT DEFAULT '',
                        reviewed_at TIMESTAMP NULL,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_approval_steps_response_version_id "
                    "ON cms_approval_steps (response_version_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_approval_steps_reviewer "
                    "ON cms_approval_steps (reviewer)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_approval_steps_status "
                    "ON cms_approval_steps (status)"
                )
            )

    if not inspector.has_table("cms_dispatches"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_dispatches (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL
                            REFERENCES cms_letters(id) ON DELETE CASCADE,
                        response_version_id INTEGER
                            REFERENCES cms_response_versions(id) ON DELETE SET NULL,
                        channel VARCHAR(40) DEFAULT 'Internal',
                        dispatched_by VARCHAR(120) DEFAULT '',
                        recipients TEXT DEFAULT '',
                        notes TEXT DEFAULT '',
                        dispatched_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_cms_dispatches_letter_id ON cms_dispatches (letter_id)")
            )


def migrate_enterprise_roles(db) -> None:
    """Map legacy role strings to drawio canonical roles without unique collisions."""
    from app.models import Role, User

    mapping = {
        "Administrator": "Admin",
        "Correspondence Officer": "Coordinator",
        "Department/User": "Actionist",
        "Clerk": "Coordinator",
        "admin": "Admin",
    }
    for old, new in mapping.items():
        db.query(User).filter(User.role == old).update({User.role: new}, synchronize_session=False)

        old_role = db.query(Role).filter(Role.name == old).one_or_none()
        if not old_role:
            continue
        new_role = db.query(Role).filter(Role.name == new).one_or_none()
        if new_role is None:
            old_role.name = new
        elif new_role.id != old_role.id:
            # Canonical role already exists — drop the legacy duplicate row.
            db.delete(old_role)
    db.flush()
    db.expire_all()


def backfill_enterprise_route_actions(db) -> None:
    """Create RouteStep + ActionItem for open letters that only have assigned_to."""
    from app.models import ActionItem, Department, Letter, RouteStep

    closed = {"Closed", "Completed", "Archived", "Rejected", "Information Delivered", "Dispatched"}
    letters = (
        db.query(Letter)
        .filter(Letter.assigned_to != "", Letter.is_archived.is_(False))
        .filter(~Letter.status.in_(closed))
        .all()
    )
    dept_by_name = {d.name: d.id for d in db.query(Department).all()}

    for letter in letters:
        existing = db.query(ActionItem).filter(ActionItem.letter_id == letter.id).first()
        if existing:
            continue
        dept_id = letter.department_id or dept_by_name.get(letter.department)
        db.add(
            RouteStep(
                letter_id=letter.id,
                step_type="ROUTE",
                to_department_id=dept_id,
                to_user=letter.assigned_to,
                from_user=letter.assigned_by or letter.created_by or "",
                instructions=letter.action_required or "",
                due_date=letter.due_date,
                priority=letter.priority or "",
                active=True,
                created_by=letter.assigned_by or letter.created_by or "system",
            )
        )
        db.add(
            ActionItem(
                letter_id=letter.id,
                department_id=dept_id,
                assignee=letter.assigned_to,
                status="Open",
                instructions=letter.action_required or "",
                due_date=letter.due_date,
                created_by=letter.assigned_by or letter.created_by or "system",
            )
        )


def infer_department_tiers(db) -> None:
    """Infer Department.tier from tree depth when still default/empty."""
    from app.models import Department

    depts = db.query(Department).all()
    by_id = {d.id: d for d in depts}
    depth_cache: dict[int, int] = {}

    def depth(dept_id: int | None) -> int:
        if dept_id is None:
            return 0
        if dept_id in depth_cache:
            return depth_cache[dept_id]
        d = by_id.get(dept_id)
        if not d or d.parent_id is None:
            depth_cache[dept_id] = 0
            return 0
        depth_cache[dept_id] = depth(d.parent_id) + 1
        return depth_cache[dept_id]

    tier_by_depth = {
        0: "Secretariat",
        1: "Wing",
        2: "Division",
        3: "Section",
    }
    for d in depts:
        if d.tier and d.tier not in {"", "Division"}:
            continue
        # Only overwrite blank or generic Division when parent chain exists
        if d.tier == "Division" and d.parent_id is None and not any(
            x.parent_id == d.id for x in depts
        ):
            continue
        d.tier = tier_by_depth.get(depth(d.id), "Group")


def upgrade_simple_marking_schema(engine: Engine) -> None:
    """Simple marking workflow tables + letter close/initiator columns (spec 01 / 08)."""
    inspector = inspect(engine)

    if inspector.has_table("cms_letters"):
        columns = {col["name"] for col in inspector.get_columns("cms_letters")}
        statements: list[str] = []
        if "initiator_user_id" not in columns:
            statements.append(
                "ALTER TABLE cms_letters ADD COLUMN initiator_user_id INTEGER "
                "REFERENCES cms_users(id) ON DELETE SET NULL"
            )
        if "closed_at" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN closed_at TIMESTAMP NULL")
        if "closed_by" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN closed_by VARCHAR(120) DEFAULT ''")
        if "close_ip" not in columns:
            statements.append("ALTER TABLE cms_letters ADD COLUMN close_ip VARCHAR(80) DEFAULT ''")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))
                if "initiator_user_id" not in columns:
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_cms_letters_initiator_user_id "
                            "ON cms_letters (initiator_user_id)"
                        )
                    )
        # Widen assigned_to for multi-holder comma-separated lists (UI truncates + popup).
        assigned_col = next(
            (col for col in inspector.get_columns("cms_letters") if col["name"] == "assigned_to"),
            None,
        )
        if assigned_col is not None:
            col_type = str(assigned_col.get("type") or "").upper()
            if "500" not in col_type and "TEXT" not in col_type:
                dialect = engine.dialect.name
                with engine.begin() as conn:
                    if dialect == "postgresql":
                        conn.execute(
                            text("ALTER TABLE cms_letters ALTER COLUMN assigned_to TYPE VARCHAR(500)")
                        )
                    elif dialect == "sqlite":
                        # SQLite ignores length; no-op for type widen.
                        pass

    if not inspector.has_table("cms_marking_batches"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_marking_batches (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        from_user VARCHAR(120) DEFAULT '',
                        from_user_id INTEGER REFERENCES cms_users(id) ON DELETE SET NULL,
                        remarks TEXT DEFAULT '',
                        pathway_notify BOOLEAN DEFAULT FALSE,
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_marking_batches_letter_id "
                    "ON cms_marking_batches (letter_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_marking_batches_from_user "
                    "ON cms_marking_batches (from_user)"
                )
            )

    inspector = inspect(engine)
    if not inspector.has_table("cms_markings"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_markings (
                        id SERIAL PRIMARY KEY,
                        batch_id INTEGER NOT NULL REFERENCES cms_marking_batches(id) ON DELETE CASCADE,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        parent_marking_id INTEGER REFERENCES cms_markings(id) ON DELETE SET NULL,
                        path_id VARCHAR(36) DEFAULT '',
                        direction VARCHAR(20) DEFAULT 'forward',
                        from_user VARCHAR(120) DEFAULT '',
                        to_user VARCHAR(120) DEFAULT '',
                        action VARCHAR(40) DEFAULT 'forward',
                        response_type VARCHAR(40) DEFAULT '',
                        response_type_other VARCHAR(200) DEFAULT '',
                        instructions TEXT DEFAULT '',
                        due_at DATE NULL,
                        priority VARCHAR(40) DEFAULT 'Routine',
                        track BOOLEAN DEFAULT TRUE,
                        reminders_enabled BOOLEAN DEFAULT FALSE,
                        status VARCHAR(40) DEFAULT 'active',
                        acceptance_status VARCHAR(20) DEFAULT '',
                        accepted_at TIMESTAMP NULL,
                        rejected_at TIMESTAMP NULL,
                        rejection_reason TEXT DEFAULT '',
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW(),
                        revoked_at TIMESTAMP NULL,
                        revoked_by VARCHAR(120) DEFAULT '',
                        revoke_ip VARCHAR(80) DEFAULT '',
                        responded_at TIMESTAMP NULL,
                        response_note_id INTEGER NULL
                    )
                    """
                )
            )
            for idx in (
                "letter_id",
                "batch_id",
                "parent_marking_id",
                "path_id",
                "direction",
                "from_user",
                "to_user",
                "action",
                "status",
                "acceptance_status",
                "track",
            ):
                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_cms_markings_{idx} ON cms_markings ({idx})"
                    )
                )

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_notes"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_notes (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        marking_id INTEGER REFERENCES cms_markings(id) ON DELETE SET NULL,
                        author_user VARCHAR(120) DEFAULT '',
                        body_text TEXT DEFAULT '',
                        audience VARCHAR(20) DEFAULT 'recipient',
                        is_response BOOLEAN DEFAULT FALSE,
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_notes_letter_id "
                    "ON cms_correspondence_notes (letter_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_notes_audience "
                    "ON cms_correspondence_notes (audience)"
                )
            )

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_attachments"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_attachments (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL
                            REFERENCES cms_letters(id) ON DELETE CASCADE,
                        marking_id INTEGER
                            REFERENCES cms_markings(id) ON DELETE SET NULL,
                        note_id INTEGER
                            REFERENCES cms_correspondence_notes(id) ON DELETE SET NULL,
                        created_by VARCHAR(120) DEFAULT '',
                        document_id INTEGER REFERENCES cms_documents(id) ON DELETE SET NULL,
                        attachment_kind VARCHAR(60) DEFAULT 'Other',
                        audience VARCHAR(20) DEFAULT 'recipient',
                        storage_key VARCHAR(500) DEFAULT '',
                        original_filename VARCHAR(255) DEFAULT '',
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_letter_id "
                    "ON cms_correspondence_attachments (letter_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_marking_id "
                    "ON cms_correspondence_attachments (marking_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_note_id "
                    "ON cms_correspondence_attachments (note_id)"
                )
            )
    else:
        columns = {col["name"] for col in inspector.get_columns("cms_correspondence_attachments")}
        with engine.begin() as conn:
            if "letter_id" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN letter_id INTEGER REFERENCES cms_letters(id) ON DELETE CASCADE"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_letter_id "
                        "ON cms_correspondence_attachments (letter_id)"
                    )
                )
            if "marking_id" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN marking_id INTEGER REFERENCES cms_markings(id) ON DELETE SET NULL"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_marking_id "
                        "ON cms_correspondence_attachments (marking_id)"
                    )
                )
            if "created_by" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN created_by VARCHAR(120) DEFAULT ''"
                    )
                )
            # Allow note_id to be null (attachments are marking-scoped).
            conn.execute(
                text(
                    "ALTER TABLE cms_correspondence_attachments "
                    "ALTER COLUMN note_id DROP NOT NULL"
                )
            )
            # Backfill letter_id / marking_id / created_by from legacy note links.
            conn.execute(
                text(
                    """
                    UPDATE cms_correspondence_attachments AS a
                    SET
                        letter_id = COALESCE(a.letter_id, n.letter_id),
                        marking_id = COALESCE(a.marking_id, n.marking_id),
                        created_by = CASE
                            WHEN COALESCE(a.created_by, '') = '' THEN COALESCE(n.author_user, '')
                            ELSE a.created_by
                        END
                    FROM cms_correspondence_notes AS n
                    WHERE a.note_id = n.id
                    """
                )
            )

    inspector = inspect(engine)
    if not inspector.has_table("cms_marking_subscriptions"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_marking_subscriptions (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        batch_id INTEGER REFERENCES cms_marking_batches(id) ON DELETE CASCADE,
                        user_name VARCHAR(120) DEFAULT '',
                        active BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_marking_subscriptions_letter_id "
                    "ON cms_marking_subscriptions (letter_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_marking_subscriptions_user_name "
                    "ON cms_marking_subscriptions (user_name)"
                )
            )

    inspector = inspect(engine)
    if not inspector.has_table("cms_marking_reminder_log"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_marking_reminder_log (
                        id SERIAL PRIMARY KEY,
                        marking_id INTEGER NOT NULL REFERENCES cms_markings(id) ON DELETE CASCADE,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        reminder_key VARCHAR(40) NOT NULL,
                        anchor_date DATE NOT NULL,
                        created_at TIMESTAMP DEFAULT NOW(),
                        CONSTRAINT uq_cms_marking_reminder_dedup
                            UNIQUE (marking_id, reminder_key, anchor_date)
                    )
                    """
                )
            )

    inspector = inspect(engine)
    if inspector.has_table("cms_markings"):
        columns = {c["name"] for c in inspector.get_columns("cms_markings")}
        with engine.begin() as conn:
            if "path_id" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_markings "
                        "ADD COLUMN path_id VARCHAR(36) DEFAULT ''"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_markings_path_id "
                        "ON cms_markings (path_id)"
                    )
                )
            if "direction" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_markings "
                        "ADD COLUMN direction VARCHAR(20) DEFAULT 'forward'"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_markings_direction "
                        "ON cms_markings (direction)"
                    )
                )
            acceptance_added = False
            if "acceptance_status" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_markings "
                        "ADD COLUMN acceptance_status VARCHAR(20) DEFAULT ''"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_markings_acceptance_status "
                        "ON cms_markings (acceptance_status)"
                    )
                )
                acceptance_added = True
            if "accepted_at" not in columns:
                conn.execute(
                    text("ALTER TABLE cms_markings ADD COLUMN accepted_at TIMESTAMP NULL")
                )
            if "rejected_at" not in columns:
                conn.execute(
                    text("ALTER TABLE cms_markings ADD COLUMN rejected_at TIMESTAMP NULL")
                )
            if "rejection_reason" not in columns:
                conn.execute(
                    text(
                        "ALTER TABLE cms_markings "
                        "ADD COLUMN rejection_reason TEXT DEFAULT ''"
                    )
                )
            # One-time: existing active holds were already in progress — treat as accepted
            # so only newly marked letters require Accept / Reject.
            if acceptance_added:
                conn.execute(
                    text(
                        """
                        UPDATE cms_markings
                        SET acceptance_status = 'accepted',
                            accepted_at = COALESCE(created_at, NOW())
                        WHERE status = 'active'
                          AND (acceptance_status IS NULL OR acceptance_status = '')
                        """
                    )
                )
        _backfill_marking_path_ids(engine)

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_draft_notes"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_draft_notes (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        author_user VARCHAR(120) DEFAULT '',
                        target_user VARCHAR(120) DEFAULT '',
                        intent VARCHAR(20) DEFAULT 'forward',
                        body_text TEXT DEFAULT '',
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            for idx in ("letter_id", "author_user", "target_user", "intent"):
                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_cms_correspondence_draft_notes_{idx} "
                        f"ON cms_correspondence_draft_notes ({idx})"
                    )
                )

    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_draft_notes"):
        note_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_draft_notes")}
        if "intent" not in note_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_draft_notes "
                        "ADD COLUMN intent VARCHAR(20) DEFAULT 'forward'"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_draft_notes_intent "
                        "ON cms_correspondence_draft_notes (intent)"
                    )
                )

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_draft_attachments"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_draft_attachments (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        created_by VARCHAR(120) DEFAULT '',
                        target_user VARCHAR(120) DEFAULT '',
                        intent VARCHAR(20) DEFAULT 'forward',
                        document_id INTEGER REFERENCES cms_documents(id) ON DELETE SET NULL,
                        attachment_kind VARCHAR(60) DEFAULT 'Other',
                        storage_key VARCHAR(500) DEFAULT '',
                        original_filename VARCHAR(255) DEFAULT '',
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            for idx in ("letter_id", "created_by", "target_user", "intent"):
                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_cms_correspondence_draft_attachments_{idx} "
                        f"ON cms_correspondence_draft_attachments ({idx})"
                    )
                )

    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_draft_attachments"):
        att_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_draft_attachments")}
        if "intent" not in att_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_draft_attachments "
                        "ADD COLUMN intent VARCHAR(20) DEFAULT 'forward'"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_draft_attachments_intent "
                        "ON cms_correspondence_draft_attachments (intent)"
                    )
                )

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_draft_recipients"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_draft_recipients (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        author_user VARCHAR(120) DEFAULT '',
                        to_user VARCHAR(120) DEFAULT '',
                        role VARCHAR(20) DEFAULT 'to',
                        action VARCHAR(40) DEFAULT 'forward',
                        response_type VARCHAR(40) DEFAULT '',
                        response_type_other VARCHAR(255) DEFAULT '',
                        instructions TEXT DEFAULT '',
                        due_at DATE NULL,
                        priority VARCHAR(40) DEFAULT '',
                        track BOOLEAN DEFAULT TRUE,
                        reminders_enabled BOOLEAN DEFAULT TRUE,
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW(),
                        CONSTRAINT uq_cms_draft_recipient_letter_author_user
                            UNIQUE (letter_id, author_user, to_user)
                    )
                    """
                )
            )
            for idx in ("letter_id", "author_user", "to_user", "role"):
                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_cms_correspondence_draft_recipients_{idx} "
                        f"ON cms_correspondence_draft_recipients ({idx})"
                    )
                )

    inspector = inspect(engine)
    if not inspector.has_table("cms_outbound_emails"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_outbound_emails (
                        id SERIAL PRIMARY KEY,
                        to_address VARCHAR(255) DEFAULT '',
                        subject VARCHAR(255) DEFAULT '',
                        body_text TEXT DEFAULT '',
                        status VARCHAR(40) DEFAULT 'pending',
                        letter_id INTEGER REFERENCES cms_letters(id) ON DELETE SET NULL,
                        notification_type VARCHAR(60) DEFAULT '',
                        error_message TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW(),
                        sent_at TIMESTAMP NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_cms_outbound_emails_status "
                    "ON cms_outbound_emails (status)"
                )
            )

    # Soft-delete + version pointer on correspondence attachments.
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_attachments"):
        att_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_attachments")}
        with engine.begin() as conn:
            if "deleted_at" not in att_cols:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN deleted_at TIMESTAMP NULL"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_deleted_at "
                        "ON cms_correspondence_attachments (deleted_at)"
                    )
                )
            if "deleted_by" not in att_cols:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN deleted_by VARCHAR(120) DEFAULT ''"
                    )
                )
            if "current_version_id" not in att_cols:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN current_version_id INTEGER NULL"
                    )
                )

    inspector = inspect(engine)
    if not inspector.has_table("cms_correspondence_attachment_events"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE cms_correspondence_attachment_events (
                        id SERIAL PRIMARY KEY,
                        letter_id INTEGER NOT NULL REFERENCES cms_letters(id) ON DELETE CASCADE,
                        marking_id INTEGER REFERENCES cms_markings(id) ON DELETE SET NULL,
                        attachment_id INTEGER REFERENCES cms_correspondence_attachments(id) ON DELETE SET NULL,
                        event_type VARCHAR(20) DEFAULT 'added',
                        actor_user VARCHAR(120) DEFAULT '',
                        document_id INTEGER NULL,
                        version_id INTEGER NULL,
                        original_filename VARCHAR(255) DEFAULT '',
                        storage_key VARCHAR(500) DEFAULT '',
                        attachment_kind VARCHAR(60) DEFAULT 'Other',
                        client_ip VARCHAR(80) DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                    """
                )
            )
            for idx in ("letter_id", "marking_id", "attachment_id", "event_type", "actor_user", "created_at"):
                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachment_events_{idx} "
                        f"ON cms_correspondence_attachment_events ({idx})"
                    )
                )

    # Audience: all (pathway-shared) vs recipient (hop-private).
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_notes"):
        note_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_notes")}
        if "audience" not in note_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_notes "
                        "ADD COLUMN audience VARCHAR(20) DEFAULT 'recipient'"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_notes_audience "
                        "ON cms_correspondence_notes (audience)"
                    )
                )
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_attachments"):
        att_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_attachments")}
        if "audience" not in att_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN audience VARCHAR(20) DEFAULT 'recipient'"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_audience "
                        "ON cms_correspondence_attachments (audience)"
                    )
                )

    # for_user: empty = common section; set = "For {name}" in batch comment cards.
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_notes"):
        note_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_notes")}
        if "for_user" not in note_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_notes "
                        "ADD COLUMN for_user VARCHAR(120) DEFAULT ''"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_notes_for_user "
                        "ON cms_correspondence_notes (for_user)"
                    )
                )
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_attachments"):
        att_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_attachments")}
        if "for_user" not in att_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_attachments "
                        "ADD COLUMN for_user VARCHAR(120) DEFAULT ''"
                    )
                )
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_cms_correspondence_attachments_for_user "
                        "ON cms_correspondence_attachments (for_user)"
                    )
                )

    # Draft Send Privately flag (default off = visible to all mark recipients).
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_draft_notes"):
        note_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_draft_notes")}
        if "send_privately" not in note_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_draft_notes "
                        "ADD COLUMN send_privately BOOLEAN DEFAULT FALSE"
                    )
                )
    inspector = inspect(engine)
    if inspector.has_table("cms_correspondence_draft_attachments"):
        att_cols = {c["name"] for c in inspector.get_columns("cms_correspondence_draft_attachments")}
        if "send_privately" not in att_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE cms_correspondence_draft_attachments "
                        "ADD COLUMN send_privately BOOLEAN DEFAULT FALSE"
                    )
                )


def _backfill_marking_path_ids(engine: Engine) -> None:
    """Assign path_id to legacy rows: fan-out batches get unique paths; single-child continues parent."""
    import uuid as _uuid

    inspector = inspect(engine)
    if not inspector.has_table("cms_markings"):
        return
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, batch_id, parent_marking_id, COALESCE(path_id, '') AS path_id
                FROM cms_markings
                ORDER BY id ASC
                """
            )
        ).mappings().all()
        if not rows:
            return
        if all((r["path_id"] or "").strip() for r in rows):
            return

        batch_sizes: dict[int, int] = {}
        for r in rows:
            bid = int(r["batch_id"])
            batch_sizes[bid] = batch_sizes.get(bid, 0) + 1

        path_by_id: dict[int, str] = {}
        for r in rows:
            mid = int(r["id"])
            existing = (r["path_id"] or "").strip()
            if existing:
                path_by_id[mid] = existing
                continue
            parent_id = r["parent_marking_id"]
            parent_path = path_by_id.get(int(parent_id)) if parent_id is not None else None
            fan_out = batch_sizes.get(int(r["batch_id"]), 0) > 1
            if fan_out or not parent_path:
                path_by_id[mid] = str(_uuid.uuid4())
            else:
                path_by_id[mid] = parent_path
            conn.execute(
                text("UPDATE cms_markings SET path_id = :pid WHERE id = :id"),
                {"pid": path_by_id[mid], "id": mid},
            )


def migrate_letters_to_simple_marking_statuses(db) -> int:
    """Map legacy/enterprise letter statuses to Open/Closed/Archived (spec 08)."""
    from app.models import Letter, User

    closed_old = {
        "Closed",
        "Completed",
        "Information Delivered",
        "Dispatched",
        "Rejected",
    }
    updated = 0
    users_by_name = {u.name: u.id for u in db.query(User).all()}
    for letter in db.query(Letter).all():
        changed = False
        if letter.status == "Archived" or letter.is_archived:
            if letter.status != "Archived":
                letter.status = "Archived"
                changed = True
        elif letter.status in closed_old:
            if letter.status != "Closed":
                letter.status = "Closed"
                changed = True
        elif letter.status != "Open":
            letter.status = "Open"
            changed = True
        if not letter.initiator_user_id and letter.created_by:
            uid = users_by_name.get(letter.created_by.strip())
            if uid:
                letter.initiator_user_id = uid
                changed = True
        if changed:
            updated += 1
    return updated

