"""Administration: roles, permissions, security, alerts, statuses, sessions."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AppSetting, Role, StatusDefinition, User, UserSession

CMS_RESOURCES: list[dict[str, Any]] = [
    {"key": "letters", "label": "Letters", "other": []},
    {"key": "workflow", "label": "Workflow", "other": ["Execute transitions", "Approve / reject"]},
    {"key": "documents", "label": "Documents", "other": ["Upload versions"]},
    {"key": "meetings", "label": "Meetings", "other": ["Link correspondence"]},
    {
        "key": "ai_intelligence",
        "label": "AI Intelligence",
        "other": ["Regenerate analysis"],
    },
    {"key": "reports", "label": "Reports", "other": ["Export CSV"]},
    {"key": "departments", "label": "Departments", "other": []},
    {"key": "organizations", "label": "Organizations", "other": []},
    {"key": "users", "label": "Users", "other": ["Assign roles", "Remove roles"]},
    {"key": "notifications", "label": "Notifications", "other": []},
    {"key": "audit", "label": "Audit log", "other": []},
    {"key": "import_export", "label": "Import / export", "other": ["Bulk operations"]},
    {"key": "settings", "label": "Settings", "other": ["Security policy", "Backup"]},
]

DEFAULT_ROLES: list[dict[str, Any]] = [
    {"name": "Admin", "description": "Configure org, RBAC, templates, and system settings."},
    {"name": "Coordinator", "description": "Register, validate, classify, and route correspondence."},
    {"name": "Actionist", "description": "Accept actions, work items, draft and submit responses."},
    {"name": "Manager", "description": "Delegate within department, set due dates, approve own tier."},
    {"name": "Management", "description": "Top-tier routing and response approval; external dispatch."},
    {"name": "Viewer", "description": "Read-only access within authorized department scope."},
]

DEFAULT_STATUS_BADGES: list[dict[str, str]] = [
    {"category": "Correspondence", "name": "Registered", "description": "Newly registered in the system", "color": "#64748b"},
    {"category": "Correspondence", "name": "OCR Processed", "description": "OCR extraction completed", "color": "#64748b"},
    {"category": "Correspondence", "name": "LLM Analyzed", "description": "LLM analysis completed", "color": "#7c3aed"},
    {"category": "Correspondence", "name": "Validated", "description": "Coordinator validated metadata", "color": "#d97706"},
    {"category": "Correspondence", "name": "Classified", "description": "Information or Actionable", "color": "#2563eb"},
    {"category": "Correspondence", "name": "Pending Routing Approval", "description": "Awaiting secretariat routing", "color": "#ca8a04"},
    {"category": "Correspondence", "name": "Routed", "description": "Routed to department", "color": "#2563eb"},
    {"category": "Correspondence", "name": "Action Assigned", "description": "Action item assigned", "color": "#2563eb"},
    {"category": "Correspondence", "name": "In Progress", "description": "Work underway", "color": "#4f46e5"},
    {"category": "Correspondence", "name": "Response Drafted", "description": "Draft reply prepared", "color": "#4f46e5"},
    {"category": "Correspondence", "name": "Under Approval", "description": "Multi-tier approval in progress", "color": "#ca8a04"},
    {"category": "Correspondence", "name": "Approved for Dispatch", "description": "Ready to dispatch", "color": "#16a34a"},
    {"category": "Correspondence", "name": "Dispatched", "description": "Response dispatched", "color": "#7c3aed"},
    {"category": "Correspondence", "name": "Information Delivered", "description": "FYI closed", "color": "#16a34a"},
    {"category": "Correspondence", "name": "Under Review", "description": "Being reviewed by coordinator", "color": "#d97706"},
    {"category": "Correspondence", "name": "Assigned", "description": "Assigned to a responsible officer", "color": "#2563eb"},
    {"category": "Correspondence", "name": "Action in Progress", "description": "Response or action underway", "color": "#4f46e5"},
    {"category": "Correspondence", "name": "Approval Pending", "description": "Awaiting management approval", "color": "#ca8a04"},
    {"category": "Correspondence", "name": "Completed", "description": "Work completed successfully", "color": "#16a34a"},
    {"category": "Correspondence", "name": "Closed", "description": "File closed; no further action", "color": "#475569"},
    {"category": "Correspondence", "name": "Overdue", "description": "Past due date without closure", "color": "#dc2626"},
    {"category": "Correspondence", "name": "Archived", "description": "Logically archived record", "color": "#94a3b8"},
]

DEFAULT_SECURITY = {
    "minLength": 8,
    "expiryDays": 90,
    "inactiveAfterDays": 90,
    "historyLength": 5,
    "maxAttempts": 5,
    "lockoutMinutes": 30,
    "requireUpper": True,
    "requireLower": True,
    "requireNumbers": True,
    "requireSpecial": False,
    "twoFactorEnabled": False,
    "twoFactorRequiredAll": False,
    "twoFactorRequiredAdmin": True,
}

DEFAULT_ALERTS = {
    "email": {
        "newAssignment": True,
        "approvalPending": True,
        "escalation": True,
        "dueToday": True,
        "overdue": True,
        "weeklyDigest": True,
        "dailySummary": False,
    },
    "inApp": {
        "enabled": True,
        "desktop": False,
    },
}


def _full_permissions() -> dict[str, Any]:
    matrix: dict[str, Any] = {}
    for resource in CMS_RESOURCES:
        matrix[resource["key"]] = {
            "view": True,
            "create": True,
            "edit": True,
            "delete": True,
            "other": {opt: True for opt in resource["other"]},
        }
    return matrix


def _viewer_permissions() -> dict[str, Any]:
    matrix: dict[str, Any] = {}
    for resource in CMS_RESOURCES:
        matrix[resource["key"]] = {
            "view": True,
            "create": False,
            "edit": False,
            "delete": False,
            "other": {opt: False for opt in resource["other"]},
        }
    return matrix


def permission_count(matrix: dict[str, Any]) -> int:
    total = 0
    for entry in matrix.values():
        for key in ("view", "create", "edit", "delete"):
            if entry.get(key):
                total += 1
        for enabled in (entry.get("other") or {}).values():
            if enabled:
                total += 1
    return total


def _get_json_setting(db: Session, key: str, default: dict) -> dict:
    row = db.get(AppSetting, key)
    if not row or not row.value:
        return default
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return default


def _set_json_setting(db: Session, key: str, payload: dict) -> None:
    row = db.get(AppSetting, key)
    encoded = json.dumps(payload)
    if row:
        row.value = encoded
    else:
        db.add(AppSetting(key=key, value=encoded))


def _merge_resource_permissions(matrix: dict[str, Any], role_name: str) -> dict[str, Any]:
    """Ensure every CMS resource key exists on an existing role matrix."""
    updated = dict(matrix or {})
    for resource in CMS_RESOURCES:
        key = resource["key"]
        other_opts = list(resource.get("other") or [])
        if key not in updated:
            if role_name in {"Admin", "Administrator", "Manager", "Management"}:
                updated[key] = {
                    "view": True,
                    "create": True,
                    "edit": True,
                    "delete": role_name in {"Admin", "Administrator"} or key != "settings",
                    "other": {opt: True for opt in other_opts},
                }
            elif role_name in {"Coordinator", "Clerk"} and key == "ai_intelligence":
                updated[key] = {
                    "view": True,
                    "create": False,
                    "edit": True,
                    "delete": False,
                    "other": {opt: True for opt in other_opts},
                }
            else:
                updated[key] = {
                    "view": True,
                    "create": False,
                    "edit": False,
                    "delete": False,
                    "other": {opt: False for opt in other_opts},
                }
            continue
        entry = dict(updated[key] or {})
        other = dict(entry.get("other") or {})
        for opt in other_opts:
            if opt not in other:
                if role_name in {"Admin", "Administrator", "Manager", "Management"}:
                    other[opt] = True
                elif role_name in {"Coordinator", "Clerk"} and key == "ai_intelligence" and opt == "Regenerate analysis":
                    other[opt] = True
                else:
                    other[opt] = bool(entry.get("edit"))
        entry["other"] = other
        updated[key] = entry
    return updated


def ensure_administration_seed(db: Session) -> None:
    # Legacy role names that already satisfy a canonical DEFAULT_ROLES entry.
    legacy_aliases = {
        "Administrator": "Admin",
        "Correspondence Officer": "Coordinator",
        "Department/User": "Actionist",
        "Clerk": "Coordinator",
        "admin": "Admin",
    }

    if not db.query(Role).first():
        admin_matrix = _full_permissions()
        viewer_matrix = _viewer_permissions()
        for spec in DEFAULT_ROLES:
            matrix = admin_matrix if spec["name"] == "Admin" else viewer_matrix
            if spec["name"] in {"Manager", "Management", "Coordinator"}:
                matrix = _full_permissions()
                for key in matrix:
                    if key == "settings":
                        matrix[key] = {**matrix[key], "delete": False}
            if spec["name"] == "Actionist":
                matrix = _viewer_permissions()
                for key in ("letters", "workflow", "documents", "meetings", "notifications", "ai_intelligence"):
                    if key in matrix:
                        matrix[key]["create"] = key != "ai_intelligence"
                        matrix[key]["edit"] = True
                        if key == "ai_intelligence":
                            matrix[key]["other"] = {"Regenerate analysis": True}
            db.add(Role(name=spec["name"], description=spec["description"], permissions_json=json.dumps(matrix)))
    else:
        existing_names = {row.name for row in db.query(Role).all()}
        covered = set(existing_names)
        for legacy, canonical in legacy_aliases.items():
            if legacy in existing_names:
                covered.add(canonical)
        for spec in DEFAULT_ROLES:
            if spec["name"] in covered:
                continue
            matrix = _viewer_permissions()
            if spec["name"] == "Admin":
                matrix = _full_permissions()
            elif spec["name"] in {"Manager", "Management", "Coordinator"}:
                matrix = _full_permissions()
                for key in matrix:
                    if key == "settings":
                        matrix[key] = {**matrix[key], "delete": False}
            elif spec["name"] == "Actionist":
                matrix = _viewer_permissions()
                for key in ("letters", "workflow", "documents", "meetings", "notifications", "ai_intelligence"):
                    if key in matrix:
                        matrix[key]["create"] = key != "ai_intelligence"
                        matrix[key]["edit"] = True
                        if key == "ai_intelligence":
                            matrix[key]["other"] = {"Regenerate analysis": True}
            db.add(Role(name=spec["name"], description=spec["description"], permissions_json=json.dumps(matrix)))
            covered.add(spec["name"])
        for row in db.query(Role).all():
            try:
                matrix = json.loads(row.permissions_json or "{}")
            except json.JSONDecodeError:
                matrix = {}
            merged = _merge_resource_permissions(matrix, row.name)
            if merged != matrix:
                row.permissions_json = json.dumps(merged)

    if not db.query(StatusDefinition).first():
        for idx, item in enumerate(DEFAULT_STATUS_BADGES):
            db.add(
                StatusDefinition(
                    category=item["category"],
                    name=item["name"],
                    description=item["description"],
                    color=item["color"],
                    sort_order=idx,
                )
            )

    if not db.get(AppSetting, "admin_security"):
        _set_json_setting(db, "admin_security", DEFAULT_SECURITY)
    if not db.get(AppSetting, "admin_alerts"):
        _set_json_setting(db, "admin_alerts", DEFAULT_ALERTS)

    if not db.query(UserSession).first():
        now = datetime.now()
        db.add(
            UserSession(
                username="admin",
                user_display="Administrator",
                device="Desktop",
                browser="Edge",
                os_name="Windows",
                ip_address="127.0.0.1",
                login_time=now,
                last_activity=now,
                status="Active",
            )
        )


def get_security_settings(db: Session) -> dict:
    return _get_json_setting(db, "admin_security", DEFAULT_SECURITY)


def save_security_settings(db: Session, payload: dict) -> dict:
    current = get_security_settings(db)
    current.update(payload)
    _set_json_setting(db, "admin_security", current)
    return current


def get_alert_settings(db: Session) -> dict:
    return _get_json_setting(db, "admin_alerts", DEFAULT_ALERTS)


def save_alert_settings(db: Session, payload: dict) -> dict:
    current = get_alert_settings(db)
    if "email" in payload:
        current.setdefault("email", {}).update(payload["email"])
    if "inApp" in payload:
        current.setdefault("inApp", {}).update(payload["inApp"])
    _set_json_setting(db, "admin_alerts", current)
    return current


def user_admin_stats(db: Session) -> dict[str, int]:
    users = db.query(User).all()
    active = sum(1 for u in users if u.status == "Active")
    inactive = len(users) - active
    sessions = db.query(UserSession).filter(UserSession.status == "Active").count()
    return {
        "totalUsers": len(users),
        "activeUsers": active,
        "inactiveUsers": inactive,
        "loggedIn": sessions,
        "failedLoginsToday": 0,
    }


def touch_session(db: Session, *, username: str, display: str, ip: str = "127.0.0.1") -> None:
    row = (
        db.query(UserSession)
        .filter(UserSession.username == username, UserSession.status == "Active", UserSession.ip_address == ip)
        .first()
    )
    now = datetime.now()
    if row:
        row.last_activity = now
        return
    db.add(
        UserSession(
            username=username,
            user_display=display,
            device="Desktop",
            browser="Browser",
            os_name="Windows",
            ip_address=ip,
            login_time=now,
            last_activity=now,
            status="Active",
        )
    )
