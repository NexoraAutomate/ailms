import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.administration_service import (
    CMS_RESOURCES,
    ensure_administration_seed,
    get_alert_settings,
    get_security_settings,
    permission_count,
    save_alert_settings,
    save_security_settings,
    user_admin_stats,
)
from app.database import get_db
from app.models import Role, StatusDefinition, UserSession
from app.schemas import (
    RoleIn,
    RoleOut,
    RolePermissionsIn,
    StatusDefinitionIn,
    StatusDefinitionOut,
)
from app.services import add_audit, current_user_name

router = APIRouter(prefix="/admin", tags=["administration"])


def _role_out(row: Role) -> RoleOut:
    try:
        matrix = json.loads(row.permissions_json or "{}")
    except json.JSONDecodeError:
        matrix = {}
    return RoleOut(id=row.id, name=row.name, description=row.description, permissionCount=permission_count(matrix))


@router.get("/resources")
def list_resources() -> dict:
    return {"resources": CMS_RESOURCES}


@router.get("/user-stats")
def admin_user_stats(db: Session = Depends(get_db)) -> dict:
    return user_admin_stats(db)


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)) -> list[RoleOut]:
    return [_role_out(row) for row in db.query(Role).order_by(Role.name).all()]


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleIn, db: Session = Depends(get_db)) -> RoleOut:
    if db.query(Role).filter(Role.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Role already exists")
    from app.administration_service import _viewer_permissions

    row = Role(name=payload.name, description=payload.description, permissions_json=json.dumps(_viewer_permissions()))
    db.add(row)
    db.commit()
    db.refresh(row)
    return _role_out(row)


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, payload: RoleIn, db: Session = Depends(get_db)) -> RoleOut:
    row = db.get(Role, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    row.name = payload.name
    row.description = payload.description
    db.commit()
    db.refresh(row)
    return _role_out(row)


@router.delete("/roles/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(Role, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    if row.name == "Administrator":
        raise HTTPException(status_code=400, detail="Cannot delete Administrator role")
    db.delete(row)
    db.commit()
    return {"deleted": role_id}


@router.get("/roles/{role_id}/permissions")
def get_role_permissions(role_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(Role, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    try:
        permissions = json.loads(row.permissions_json or "{}")
    except json.JSONDecodeError:
        permissions = {}
    from app.administration_service import permission_count

    full_matrix = {
        r["key"]: {"view": True, "create": True, "edit": True, "delete": True, "other": {o: True for o in r["other"]}}
        for r in CMS_RESOURCES
    }
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "permissions": permissions,
        "permissionCount": permission_count(permissions),
        "totalSlots": permission_count(full_matrix),
    }


@router.put("/roles/{role_id}/permissions")
def save_role_permissions(role_id: int, payload: RolePermissionsIn, db: Session = Depends(get_db)) -> dict:
    row = db.get(Role, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    if payload.description is not None:
        row.description = payload.description
    row.permissions_json = json.dumps(payload.permissions)
    add_audit(
        db,
        user=current_user_name(db),
        module="Role Access",
        action="Permissions Updated",
        record=row.name,
        description=f"Updated permissions for {row.name}",
    )
    db.commit()
    return get_role_permissions(role_id, db)


@router.get("/status-definitions", response_model=list[StatusDefinitionOut])
def list_status_definitions(db: Session = Depends(get_db)) -> list[StatusDefinitionOut]:
    rows = db.query(StatusDefinition).order_by(StatusDefinition.category, StatusDefinition.sort_order, StatusDefinition.name).all()
    return [
        StatusDefinitionOut(id=r.id, category=r.category, name=r.name, description=r.description, color=r.color)
        for r in rows
    ]


@router.post("/status-definitions", response_model=StatusDefinitionOut, status_code=201)
def create_status_definition(payload: StatusDefinitionIn, db: Session = Depends(get_db)) -> StatusDefinitionOut:
    row = StatusDefinition(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return StatusDefinitionOut(id=row.id, category=row.category, name=row.name, description=row.description, color=row.color)


@router.patch("/status-definitions/{item_id}", response_model=StatusDefinitionOut)
def update_status_definition(item_id: int, payload: StatusDefinitionIn, db: Session = Depends(get_db)) -> StatusDefinitionOut:
    row = db.get(StatusDefinition, item_id)
    if not row:
        raise HTTPException(status_code=404, detail="Status not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return StatusDefinitionOut(id=row.id, category=row.category, name=row.name, description=row.description, color=row.color)


@router.delete("/status-definitions/{item_id}")
def delete_status_definition(item_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(StatusDefinition, item_id)
    if not row:
        raise HTTPException(status_code=404, detail="Status not found")
    db.delete(row)
    db.commit()
    return {"deleted": item_id}


@router.get("/security")
def read_security(db: Session = Depends(get_db)) -> dict:
    return get_security_settings(db)


@router.put("/security")
def write_security(payload: dict, db: Session = Depends(get_db)) -> dict:
    saved = save_security_settings(db, payload)
    db.commit()
    return saved


@router.get("/alerts")
def read_alerts(db: Session = Depends(get_db)) -> dict:
    return get_alert_settings(db)


@router.put("/alerts")
def write_alerts(payload: dict, db: Session = Depends(get_db)) -> dict:
    saved = save_alert_settings(db, payload)
    db.commit()
    return saved


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(UserSession).order_by(UserSession.last_activity.desc()).all()
    return [
        {
            "id": r.id,
            "username": r.username,
            "userDisplay": r.user_display,
            "device": r.device,
            "browser": r.browser,
            "os": r.os_name,
            "ipAddress": r.ip_address,
            "loginTime": r.login_time.strftime("%d/%m/%Y, %I:%M:%S %p") if r.login_time else "",
            "lastActivity": r.last_activity.strftime("%d/%m/%Y, %I:%M:%S %p") if r.last_activity else "",
            "status": r.status,
        }
        for r in rows
    ]


@router.delete("/sessions/{session_id}")
def terminate_session(session_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(UserSession, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    row.status = "Terminated"
    db.commit()
    return {"terminated": session_id}


@router.post("/sessions/terminate-all")
def terminate_all_sessions(db: Session = Depends(get_db)) -> dict:
    rows = db.query(UserSession).filter(UserSession.status == "Active").all()
    for row in rows:
        row.status = "Terminated"
    db.commit()
    return {"terminated": len(rows)}


@router.post("/seed")
def seed_admin(db: Session = Depends(get_db)) -> dict:
    ensure_administration_seed(db)
    db.commit()
    return {"ok": True}
