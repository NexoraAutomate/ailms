"""Lightweight PostgreSQL schema upgrades (no Alembic)."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


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
