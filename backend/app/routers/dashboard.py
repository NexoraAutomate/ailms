from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Approval, AuditRecord, Department, Escalation, Letter, MasterValue, MonthlyTrend, Notification, Organization, User
from app.services import (
    CLOSED_STATUSES,
    PENDING_STATUSES,
    serialize_audit,
    serialize_department,
    serialize_letter,
    serialize_notification,
    serialize_organization,
    serialize_user,
    setting_map,
)

router = APIRouter(tags=["dashboard"])


def _user_notifications(db: Session, user_name: str) -> list:
    from app.notification_service import notifications_for_user_query

    rows = notifications_for_user_query(db, user_name).order_by(Notification.created_at.desc()).all()
    return [serialize_notification(row) for row in rows]


def _user_unread_count(db: Session, user_name: str) -> int:
    from app.notification_service import notifications_for_user_query

    return notifications_for_user_query(db, user_name).filter(Notification.read.is_(False)).count()


def _letters(db: Session) -> list:
    rows = db.query(Letter).filter(Letter.is_archived.is_(False)).order_by(Letter.id.desc()).all()
    return [serialize_letter(row) for row in rows]


def _operational_counts(db: Session) -> dict[str, int]:
    return {
        "approvalPending": db.query(Approval).filter(Approval.approval_status == "Pending").count(),
        "escalationsOpen": db.query(Escalation).filter(Escalation.status.in_(["Open", "In Progress"])).count(),
    }


def _metrics(items: list, db: Session | None = None) -> dict[str, str]:
    total = len(items)
    incoming = sum(1 for item in items if item.type == "Incoming")
    outgoing = total - incoming
    pending = sum(1 for item in items if item.status not in CLOSED_STATUSES)
    completed = sum(1 for item in items if item.status == "Completed")
    closed = sum(1 for item in items if item.status == "Closed")
    overdue = sum(1 for item in items if item.status == "Overdue")
    due_today = sum(1 for item in items if item.dueDate == date.today().isoformat() and item.status not in CLOSED_STATUSES)
    closed_or_done = completed + closed
    closure_rate = f"{round((closed_or_done / total) * 100)}%" if total else "0%"
    pending_days = [item.daysPending for item in items if item.status not in CLOSED_STATUSES]
    avg = f"{round(sum(pending_days) / len(pending_days), 1)}d" if pending_days else "0d"
    ops = _operational_counts(db) if db else {"approvalPending": 0, "escalationsOpen": 0}
    return {
        "Total Correspondence": str(total),
        "Total Letters": str(total),
        "Incoming": str(incoming),
        "Outgoing": str(outgoing),
        "Pending": str(pending),
        "Completed": str(closed_or_done),
        "Overdue": f"{overdue:02d}" if overdue < 10 else str(overdue),
        "Due Today": f"{due_today:02d}" if due_today < 10 else str(due_today),
        "Closed": str(closed),
        "Average Response Time": avg,
        "Closure Rate": closure_rate,
        "Approval Pending": str(ops["approvalPending"]),
        "Escalated": str(ops["escalationsOpen"]),
    }


def _dashboard_cards(metrics: dict[str, str]) -> list[dict]:
    return [
        {"label": "Total Letters", "value": metrics["Total Letters"], "icon": "inbox", "filter": "All Letters"},
        {"label": "Incoming", "value": metrics["Incoming"], "icon": "arrow-down-left", "filter": "Incoming"},
        {"label": "Outgoing", "value": metrics["Outgoing"], "icon": "arrow-up-right", "filter": "Outgoing"},
        {"label": "Pending", "value": metrics["Pending"], "icon": "clock-3", "filter": "Pending"},
        {"label": "Overdue", "value": metrics["Overdue"], "icon": "triangle-alert", "filter": "Overdue"},
        {"label": "Due Today", "value": metrics["Due Today"], "icon": "calendar-clock", "filter": "Pending"},
        {"label": "Closed", "value": metrics["Closed"], "icon": "circle-check", "filter": "Closed"},
    ]


def _trend(db: Session) -> list[dict]:
    return [
        {"month": row.month, "incoming": row.incoming, "outgoing": row.outgoing}
        for row in db.query(MonthlyTrend).order_by(MonthlyTrend.id).all()
    ]


def _alerts(items: list, db: Session | None = None) -> list[dict]:
    overdue = sum(1 for item in items if item.status == "Overdue")
    critical = sum(1 for item in items if item.priority == "Urgent" and item.status in PENDING_STATUSES)
    due_today = sum(1 for item in items if item.dueDate == date.today().isoformat() and item.status not in CLOSED_STATUSES)
    long_pending = sum(1 for item in items if item.daysPending >= 7 and item.status not in CLOSED_STATUSES)
    approval_pending = db.query(Approval).filter(Approval.approval_status == "Pending").count() if db else 0
    escalations_open = db.query(Escalation).filter(Escalation.status.in_(["Open", "In Progress"])).count() if db else 0
    return [
        {"title": "Overdue correspondence", "count": overdue, "tone": "red"},
        {"title": "Critical pending letters", "count": critical, "tone": "amber"},
        {"title": "Items due today", "count": due_today, "tone": "blue"},
        {"title": "Long-pending correspondence", "count": long_pending, "tone": "violet"},
        {"title": "Approval pending", "count": approval_pending, "tone": "amber"},
        {"title": "Open escalations", "count": escalations_open, "tone": "red"},
    ]


def _department_performance(db: Session, items: list) -> list[dict]:
    rows = []
    for department in db.query(Department).order_by(Department.id).all():
        scoped = [item for item in items if item.department == department.name]
        rows.append(
            {
                "name": department.name,
                "assigned": len(scoped),
                "pending": sum(1 for item in scoped if item.status not in CLOSED_STATUSES),
                "completed": sum(1 for item in scoped if item.status in CLOSED_STATUSES),
                "overdue": sum(1 for item in scoped if item.status == "Overdue"),
            }
        )
    return rows


def _status_distribution(items: list) -> list[dict]:
    mapping = [
        ("Registered", "slate"),
        ("Assigned", "blue"),
        ("Action in Progress", "indigo"),
        ("Awaiting Response", "violet"),
        ("Completed", "green"),
        ("Overdue", "red"),
    ]
    return [{"name": name, "value": sum(1 for item in items if item.status == name), "tone": tone} for name, tone in mapping]


def _priority_performance(items: list) -> list[dict]:
    closed = [item for item in items if item.status in CLOSED_STATUSES]
    on_time = 0
    delayed = 0
    for item in closed:
        if item.completionDate not in {"", "—"} and item.dueDate and item.completionDate <= item.dueDate:
            on_time += 1
        else:
            delayed += 1
    total_closed = max(len(closed), 1)
    return [
        {"label": "Urgent", "value": str(sum(1 for item in items if item.priority == "Urgent")), "tone": "red"},
        {"label": "Important", "value": str(sum(1 for item in items if item.priority == "Important")), "tone": "amber"},
        {"label": "Routine", "value": str(sum(1 for item in items if item.priority == "Routine")), "tone": "blue"},
        {"label": "On-time responses", "value": f"{round((on_time / total_closed) * 100)}%", "tone": "green"},
        {"label": "Delayed responses", "value": f"{round((delayed / total_closed) * 100)}%", "tone": "red"},
    ]


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)) -> dict:
    items = _letters(db)
    metrics = _metrics(items, db)
    return {
        "metrics": metrics,
        "dashboardMetrics": _dashboard_cards(metrics),
        "trend": _trend(db),
        "alerts": _alerts(items, db),
        "departmentPerformance": _department_performance(db, items)[:4],
        "recentActivity": [serialize_audit(row) for row in db.query(AuditRecord).order_by(AuditRecord.created_at.desc()).limit(4)],
    }


@router.get("/analytics")
def analytics(db: Session = Depends(get_db)) -> dict:
    items = _letters(db)
    metrics = _metrics(items, db)
    return {
        "metrics": metrics,
        "trend": _trend(db),
        "statusDistribution": _status_distribution(items),
        "departmentWorkload": _department_performance(db, items),
        "priorityPerformance": _priority_performance(items),
    }


@router.get("/reports")
def reports(kind: str = "Incoming Letters Report", db: Session = Depends(get_db)) -> dict:
    items = _letters(db)
    filtered = items
    if kind == "Incoming Letters Report":
        filtered = [item for item in items if item.type == "Incoming"]
    elif kind == "Outgoing Letters Report":
        filtered = [item for item in items if item.type == "Outgoing"]
    elif kind == "Pending Letters Report":
        filtered = [item for item in items if item.status not in CLOSED_STATUSES]
    elif kind == "Overdue Letters Report":
        filtered = [item for item in items if item.status == "Overdue"]
    elif kind == "Closed Letters Report":
        filtered = [item for item in items if item.status == "Closed"]
    return {"report": kind, "rows": filtered}


@router.get("/me")
def me(db: Session = Depends(get_db)) -> dict:
    settings = setting_map(db)
    user = db.query(User).filter(User.name == settings["currentUser"]).first()
    return {
        "name": settings["currentUser"],
        "role": user.role if user else "Administrator",
        "department": user.department if user else "",
        "initials": "".join(part[0] for part in settings["currentUser"].replace(".", "").split()[:2]).upper(),
    }


@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db)) -> dict:
    items = _letters(db)
    metrics = _metrics(items, db)
    ops = _operational_counts(db)
    master: dict[str, list[str]] = {}
    for row in db.query(MasterValue).filter(MasterValue.status == "Active").order_by(MasterValue.id).all():
        master.setdefault(row.category, []).append(row.value)
    settings = setting_map(db)
    user = db.query(User).filter(User.name == settings["currentUser"]).first()
    return {
        "letters": items,
        "departments": [serialize_department(db, row) for row in db.query(Department).order_by(Department.id).all()],
        "organizations": [serialize_organization(row) for row in db.query(Organization).order_by(Organization.id).all()],
        "users": [serialize_user(row) for row in db.query(User).order_by(User.id).all()],
        "notifications": _user_notifications(db, settings["currentUser"]),
        "auditRecords": [serialize_audit(row) for row in db.query(AuditRecord).order_by(AuditRecord.created_at.desc()).all()],
        "masterData": master,
        "trend": _trend(db),
        "metrics": metrics,
        "dashboardMetrics": _dashboard_cards(metrics),
        "alerts": _alerts(items, db),
        "departmentPerformance": _department_performance(db, items),
        "statusDistribution": _status_distribution(items),
        "priorityPerformance": _priority_performance(items),
        "settings": settings,
        "me": {
            "name": settings["currentUser"],
            "role": user.role if user else "Administrator",
            "department": user.department if user else "",
            "initials": "".join(part[0] for part in settings["currentUser"].replace(".", "").split()[:2]).upper(),
        },
        "unreadCount": _user_unread_count(db, settings["currentUser"]),
        "operational": {
            "approvalPending": ops["approvalPending"],
            "escalationsOpen": ops["escalationsOpen"],
        },
    }
