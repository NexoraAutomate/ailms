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


class Notification(Base):
    __tablename__ = "cms_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(40), default="Medium")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    letter_id: Mapped[int | None] = mapped_column(ForeignKey("cms_letters.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


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


class AppSetting(Base):
    __tablename__ = "cms_app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
