from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Department(Base):
    __tablename__ = "cms_departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    head: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(20), default="Active")


class Organization(Base):
    __tablename__ = "cms_organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(180), unique=True)
    short_name: Mapped[str] = mapped_column(String(40), default="")
    type: Mapped[str] = mapped_column(String(80), default="Government")
    contact: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(180), default="")
    phone: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="Active")


class User(Base):
    __tablename__ = "cms_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    department: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(80), default="Department/User")
    email: Mapped[str] = mapped_column(String(180), default="")
    status: Mapped[str] = mapped_column(String(20), default="Active")
    last_activity: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WorkflowTransition(Base):
    __tablename__ = "cms_workflow_transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    from_status: Mapped[str] = mapped_column(String(60))
    to_status: Mapped[str] = mapped_column(String(60))
    performed_by: Mapped[str] = mapped_column(String(120))
    remarks: Mapped[str] = mapped_column(Text, default="")
    assigned_to: Mapped[str] = mapped_column(String(120), default="")
    department: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class Letter(Base):
    __tablename__ = "cms_letters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    letter_date: Mapped[date] = mapped_column(Date)
    received_date: Mapped[date] = mapped_column(Date)
    type: Mapped[str] = mapped_column(String(40), default="Incoming")
    subject: Mapped[str] = mapped_column(String(400))
    sender: Mapped[str] = mapped_column(String(180), default="")
    recipient: Mapped[str] = mapped_column(String(180), default="")
    department: Mapped[str] = mapped_column(String(120), default="")
    priority: Mapped[str] = mapped_column(String(40), default="Routine")
    status: Mapped[str] = mapped_column(String(40), default="Registered")
    due_date: Mapped[date | None] = mapped_column(Date)
    assigned_to: Mapped[str] = mapped_column(String(120), default="")
    last_action: Mapped[str] = mapped_column(String(200), default="Registered")
    confidentiality: Mapped[str] = mapped_column(String(40), default="Normal")
    action_required: Mapped[str] = mapped_column(String(200), default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    completion_date: Mapped[date | None] = mapped_column(Date)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    actions: Mapped[list["LetterAction"]] = relationship(back_populates="letter", cascade="all, delete-orphan")


class LetterAction(Base):
    __tablename__ = "cms_letter_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(200))
    remarks: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(120), default="A. Rahman")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    letter: Mapped[Letter] = relationship(back_populates="actions")


class Approval(Base):
    __tablename__ = "cms_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("cms_documents.id", ondelete="SET NULL"), nullable=True)
    prepared_by: Mapped[str] = mapped_column(String(120))
    reviewer: Mapped[str] = mapped_column(String(120), default="")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    approval_status: Mapped[str] = mapped_column(String(40), default="Pending", index=True)
    reviewer_remarks: Mapped[str] = mapped_column(Text, default="")
    revision_number: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Escalation(Base):
    __tablename__ = "cms_escalations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    action_id: Mapped[int | None] = mapped_column(ForeignKey("cms_letter_actions.id", ondelete="SET NULL"))
    escalation_level: Mapped[str] = mapped_column(String(40), default="Level 1", index=True)
    escalated_by: Mapped[str] = mapped_column(String(120))
    escalated_to: Mapped[str] = mapped_column(String(120), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    escalation_date: Mapped[date] = mapped_column(Date, index=True)
    target_resolution_date: Mapped[date | None] = mapped_column(Date)
    resolution_date: Mapped[date | None] = mapped_column(Date)
    remarks: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="Open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Document(Base):
    __tablename__ = "cms_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    document_type: Mapped[str] = mapped_column(String(80), default="Supporting Document", index=True)
    status: Mapped[str] = mapped_column(String(40), default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentVersion.id",
    )


class DocumentVersion(Base):
    __tablename__ = "cms_document_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("cms_documents.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[str] = mapped_column(String(20), default="1.0")
    parent_version_id: Mapped[int | None] = mapped_column(ForeignKey("cms_document_versions.id", ondelete="SET NULL"))
    filename: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(20), default="")
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    storage_key: Mapped[str] = mapped_column(String(512))
    uploaded_by: Mapped[str] = mapped_column(String(120))
    upload_date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    change_description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="Current")
    checksum: Mapped[str] = mapped_column(String(64), default="")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    document: Mapped[Document] = relationship(back_populates="versions")


class Meeting(Base):
    __tablename__ = "cms_meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    meeting_date: Mapped[date] = mapped_column(Date, index=True)
    start_time: Mapped[str] = mapped_column(String(8), default="09:00")
    end_time: Mapped[str] = mapped_column(String(8), default="10:00")
    location: Mapped[str] = mapped_column(String(200), default="")
    chairperson: Mapped[str] = mapped_column(String(120), default="")
    agenda: Mapped[str] = mapped_column(Text, default="")
    minutes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="Scheduled", index=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    participants: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
    )
    actions: Mapped[list["MeetingAction"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
    )
    letter_links: Mapped[list["LetterMeetingLink"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
    )


class MeetingParticipant(Base):
    __tablename__ = "cms_meeting_participants"
    __table_args__ = (UniqueConstraint("meeting_id", "participant_name", name="uq_cms_meeting_participant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("cms_meetings.id", ondelete="CASCADE"), index=True)
    participant_name: Mapped[str] = mapped_column(String(120))
    department: Mapped[str] = mapped_column(String(120), default="")

    meeting: Mapped[Meeting] = relationship(back_populates="participants")


class MeetingAction(Base):
    __tablename__ = "cms_meeting_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("cms_meetings.id", ondelete="CASCADE"), index=True)
    action_description: Mapped[str] = mapped_column(String(400))
    responsible_person: Mapped[str] = mapped_column(String(120), default="")
    department: Mapped[str] = mapped_column(String(120), default="")
    priority: Mapped[str] = mapped_column(String(40), default="Routine")
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(40), default="Open", index=True)
    remarks: Mapped[str] = mapped_column(Text, default="")
    completion_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    meeting: Mapped[Meeting] = relationship(back_populates="actions")


class LetterMeetingLink(Base):
    __tablename__ = "cms_letter_meeting_links"
    __table_args__ = (UniqueConstraint("letter_id", "meeting_id", name="uq_cms_letter_meeting"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("cms_meetings.id", ondelete="CASCADE"), index=True)
    linked_by: Mapped[str] = mapped_column(String(120), default="")
    linked_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    meeting: Mapped[Meeting] = relationship(back_populates="letter_links")


class LetterRelation(Base):
    __tablename__ = "cms_letter_relations"
    __table_args__ = (
        UniqueConstraint("from_letter_id", "to_letter_id", "relationship_type", name="uq_cms_letter_relation"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    to_letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    relationship_type: Mapped[str] = mapped_column(String(40), index=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ReminderLog(Base):
    __tablename__ = "cms_reminder_log"
    __table_args__ = (UniqueConstraint("letter_id", "reminder_key", "anchor_date", name="uq_cms_reminder_dedup"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    letter_id: Mapped[int] = mapped_column(ForeignKey("cms_letters.id", ondelete="CASCADE"), index=True)
    reminder_key: Mapped[str] = mapped_column(String(40), index=True)
    anchor_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ImportJob(Base):
    __tablename__ = "cms_import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(40), default="letters", index=True)
    filename: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(40), default="validated", index=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    rejected_rows: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    valid_rows_json: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ImportError(Base):
    __tablename__ = "cms_import_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    import_job_id: Mapped[int] = mapped_column(ForeignKey("cms_import_jobs.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(80), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    raw_value: Mapped[str] = mapped_column(String(400), default="")


class Notification(Base):
    __tablename__ = "cms_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_user_id: Mapped[int | None] = mapped_column(ForeignKey("cms_users.id", ondelete="SET NULL"), index=True)
    recipient_name: Mapped[str] = mapped_column(String(120), default="", index=True)
    notification_type: Mapped[str] = mapped_column(String(60), default="System Notification", index=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(40), default="Medium")
    related_entity_type: Mapped[str] = mapped_column(String(40), default="", index=True)
    related_entity_id: Mapped[str] = mapped_column(String(80), default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    letter_id: Mapped[int | None] = mapped_column(ForeignKey("cms_letters.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditRecord(Base):
    __tablename__ = "cms_audit_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped[str] = mapped_column(String(120))
    module: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(80))
    record: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(120), default="Web · 127.0.0.1")


class MasterValue(Base):
    __tablename__ = "cms_master_values"
    __table_args__ = (UniqueConstraint("category", "value", name="uq_cms_master_category_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="Active")


class MonthlyTrend(Base):
    __tablename__ = "cms_monthly_trends"
    __table_args__ = (UniqueConstraint("year", "month", name="uq_cms_trend_year_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[str] = mapped_column(String(12))
    incoming: Mapped[int] = mapped_column(Integer, default=0)
    outgoing: Mapped[int] = mapped_column(Integer, default=0)


class Role(Base):
    __tablename__ = "cms_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    permissions_json: Mapped[str] = mapped_column(Text, default="{}")


class StatusDefinition(Base):
    __tablename__ = "cms_status_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(20), default="#64748b")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class UserSession(Base):
    __tablename__ = "cms_user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), index=True)
    user_display: Mapped[str] = mapped_column(String(120), default="")
    device: Mapped[str] = mapped_column(String(40), default="Desktop")
    browser: Mapped[str] = mapped_column(String(80), default="")
    os_name: Mapped[str] = mapped_column(String(80), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    login_time: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_activity: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True)


class AppSetting(Base):
    __tablename__ = "cms_app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class AiStagedDocument(Base):
    """Uploaded file awaiting AI registration (no letter_id until approve)."""

    __tablename__ = "cms_ai_staged_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(64), default="", index=True)
    storage_key: Mapped[str] = mapped_column(String(512))
    uploaded_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    jobs: Mapped[list["AiRegistrationJob"]] = relationship(back_populates="staged_document")


class AiRegistrationJob(Base):
    """AI-assisted letter registration job (state machine + artifact keys)."""

    __tablename__ = "cms_ai_registration_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staged_document_id: Mapped[int] = mapped_column(
        ForeignKey("cms_ai_staged_documents.id", ondelete="RESTRICT"),
        index=True,
    )
    letter_id: Mapped[int | None] = mapped_column(
        ForeignKey("cms_letters.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(40), default="QUEUED", index=True)
    error_code: Mapped[str] = mapped_column(String(80), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    ocr_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    normalized_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    extraction_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    validation_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    proposal_json: Mapped[str] = mapped_column(Text, default="")
    prompt_version: Mapped[str] = mapped_column(String(40), default="")
    model_id: Mapped[str] = mapped_column(String(120), default="")
    model_config_json: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(120), default="")
    reviewed_by: Mapped[str] = mapped_column(String(120), default="")
    approved_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    ocr_completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    extraction_completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_ready_at: Mapped[datetime | None] = mapped_column(DateTime)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    staged_document: Mapped[AiStagedDocument] = relationship(back_populates="jobs")
    runs: Mapped[list["AiRun"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class AiRun(Base):
    """Per-stage / retry run record for AI registration jobs."""

    __tablename__ = "cms_ai_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("cms_ai_registration_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    stage: Mapped[str] = mapped_column(String(40), default="", index=True)
    model_id: Mapped[str] = mapped_column(String(120), default="")
    prompt_version: Mapped[str] = mapped_column(String(40), default="")
    input_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    output_artifact_key: Mapped[str] = mapped_column(String(512), default="")
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="", index=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    job: Mapped[AiRegistrationJob] = relationship(back_populates="runs")
