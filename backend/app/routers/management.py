from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth_deps import AdminUser
from app.auth_service import hash_password, validate_password_policy
from app.config import get_settings
from app.database import get_db
from app.models import AppSetting, AuditRecord, Department, DepartmentLink, Letter, MasterValue, Notification, Organization, User
from app.schemas import (
    AuditOut,
    DepartmentIn,
    DepartmentLinkIn,
    DepartmentLinkOut,
    DepartmentOut,
    DepartmentUpdateIn,
    MasterValueIn,
    MasterValueOut,
    MasterValueUpdateIn,
    NotificationOut,
    NotificationSummaryOut,
    OrganizationIn,
    OrganizationOut,
    OrganizationUpdateIn,
    SettingsIn,
    SettingsOut,
    UserIn,
    UserOut,
    UserUpdateIn,
)
from app.services import (
    add_audit,
    current_user_name,
    serialize_audit,
    serialize_department,
    serialize_department_link,
    serialize_notification,
    serialize_organization,
    serialize_user,
    setting_map,
)

departments_router = APIRouter(prefix="/departments", tags=["departments"])
department_links_router = APIRouter(prefix="/department-links", tags=["departments"])
organizations_router = APIRouter(prefix="/organizations", tags=["organizations"])
users_router = APIRouter(prefix="/users", tags=["users"])
notifications_router = APIRouter(prefix="/notifications", tags=["notifications"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])
master_router = APIRouter(prefix="/master-data", tags=["master-data"])
settings_router = APIRouter(prefix="/settings", tags=["settings"])


@departments_router.get("", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db)) -> list[DepartmentOut]:
    return [serialize_department(db, row) for row in db.query(Department).order_by(Department.id).all()]


@departments_router.post("", response_model=DepartmentOut, status_code=201)
def create_department(payload: DepartmentIn, db: Session = Depends(get_db)) -> DepartmentOut:
    if db.query(Department).filter((Department.code == payload.code) | (Department.name == payload.name)).first():
        raise HTTPException(status_code=409, detail="Department already exists")
    if payload.parentId is not None and not db.get(Department, payload.parentId):
        raise HTTPException(status_code=400, detail="Parent department not found")
    row = Department(
        code=payload.code,
        name=payload.name,
        head=payload.head,
        status=payload.status,
        parent_id=payload.parentId,
        pos_x=payload.posX,
        pos_y=payload.posY,
    )
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Departments", action="Department Created", record=payload.code, description=f"Created department {payload.name}")
    db.commit()
    db.refresh(row)
    return serialize_department(db, row)


@departments_router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(department_id: int, payload: DepartmentUpdateIn, db: Session = Depends(get_db)) -> DepartmentOut:
    row = db.get(Department, department_id)
    if not row:
        raise HTTPException(status_code=404, detail="Department not found")

    data = payload.model_dump(exclude_unset=True)
    if "parentId" in data:
        parent_id = data.pop("parentId")
        if parent_id == department_id:
            raise HTTPException(status_code=400, detail="Department cannot be its own parent")
        if parent_id is not None and not db.get(Department, parent_id):
            raise HTTPException(status_code=400, detail="Parent department not found")
        row.parent_id = parent_id
    if "posX" in data:
        row.pos_x = data.pop("posX")
    if "posY" in data:
        row.pos_y = data.pop("posY")

    old_name = row.name
    if "code" in data and data["code"] != row.code:
        conflict = db.query(Department).filter(Department.code == data["code"], Department.id != department_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Department code already exists")
        row.code = data["code"]
    if "name" in data and data["name"] != row.name:
        conflict = db.query(Department).filter(Department.name == data["name"], Department.id != department_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Department name already exists")
        row.name = data["name"]
    if "head" in data:
        row.head = data["head"]
    if "status" in data:
        row.status = data["status"]

    if row.name != old_name:
        db.query(User).filter(User.department == old_name).update({User.department: row.name})
        db.query(Letter).filter(Letter.department == old_name).update({Letter.department: row.name})

    add_audit(db, user=current_user_name(db), module="Departments", action="Department Updated", record=row.code, description=f"Updated department {row.name}")
    db.commit()
    db.refresh(row)
    return serialize_department(db, row)


@departments_router.delete("/{department_id}", status_code=204)
def delete_department(department_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(Department, department_id)
    if not row:
        raise HTTPException(status_code=404, detail="Department not found")
    users = db.query(func.count(User.id)).filter(User.department == row.name).scalar() or 0
    letters = db.query(func.count(Letter.id)).filter(Letter.department == row.name).scalar() or 0
    if users or letters:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete department in use ({users} users, {letters} letters)",
        )
    db.query(Department).filter(Department.parent_id == department_id).update({Department.parent_id: None})
    db.query(DepartmentLink).filter(
        (DepartmentLink.source_id == department_id) | (DepartmentLink.target_id == department_id)
    ).delete(synchronize_session=False)
    add_audit(db, user=current_user_name(db), module="Departments", action="Department Deleted", record=row.code, description=f"Deleted department {row.name}")
    db.delete(row)
    db.commit()


@department_links_router.get("", response_model=list[DepartmentLinkOut])
def list_department_links(db: Session = Depends(get_db)) -> list[DepartmentLinkOut]:
    return [serialize_department_link(row) for row in db.query(DepartmentLink).order_by(DepartmentLink.id).all()]


@department_links_router.post("", response_model=DepartmentLinkOut, status_code=201)
def create_department_link(payload: DepartmentLinkIn, db: Session = Depends(get_db)) -> DepartmentLinkOut:
    if payload.sourceId == payload.targetId:
        raise HTTPException(status_code=400, detail="Cannot link a department to itself")
    if not db.get(Department, payload.sourceId) or not db.get(Department, payload.targetId):
        raise HTTPException(status_code=404, detail="Department not found")
    existing = (
        db.query(DepartmentLink)
        .filter(
            ((DepartmentLink.source_id == payload.sourceId) & (DepartmentLink.target_id == payload.targetId))
            | ((DepartmentLink.source_id == payload.targetId) & (DepartmentLink.target_id == payload.sourceId))
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Coordination link already exists")
    row = DepartmentLink(source_id=payload.sourceId, target_id=payload.targetId, kind=payload.kind or "coordinates")
    db.add(row)
    add_audit(
        db,
        user=current_user_name(db),
        module="Departments",
        action="Coordination Link Created",
        record=f"{payload.sourceId}->{payload.targetId}",
        description="Created department coordination link",
    )
    db.commit()
    db.refresh(row)
    return serialize_department_link(row)


@department_links_router.delete("/{link_id}", status_code=204)
def delete_department_link(link_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(DepartmentLink, link_id)
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")
    add_audit(
        db,
        user=current_user_name(db),
        module="Departments",
        action="Coordination Link Deleted",
        record=f"{row.source_id}->{row.target_id}",
        description="Removed department coordination link",
    )
    db.delete(row)
    db.commit()


@organizations_router.get("", response_model=list[OrganizationOut])
def list_organizations(db: Session = Depends(get_db)) -> list[OrganizationOut]:
    return [serialize_organization(row) for row in db.query(Organization).order_by(Organization.id).all()]


@organizations_router.post("", response_model=OrganizationOut, status_code=201)
def create_organization(payload: OrganizationIn, db: Session = Depends(get_db)) -> OrganizationOut:
    if db.query(Organization).filter(Organization.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Organization already exists")
    row = Organization(
        name=payload.name,
        short_name=payload.short,
        type=payload.type,
        contact=payload.contact,
        email=payload.email,
        phone=payload.phone,
        status=payload.status,
    )
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Organizations", action="Organization Created", record=payload.short or payload.name, description=f"Created organization {payload.name}")
    db.commit()
    db.refresh(row)
    return serialize_organization(row)


@organizations_router.patch("/{organization_id}", response_model=OrganizationOut)
def update_organization(organization_id: int, payload: OrganizationUpdateIn, db: Session = Depends(get_db)) -> OrganizationOut:
    row = db.get(Organization, organization_id)
    if not row:
        raise HTTPException(status_code=404, detail="Organization not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != row.name:
        conflict = db.query(Organization).filter(Organization.name == data["name"], Organization.id != organization_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Organization already exists")
        row.name = data["name"]
    if "short" in data:
        row.short_name = data["short"]
    if "type" in data:
        row.type = data["type"]
    if "contact" in data:
        row.contact = data["contact"]
    if "email" in data:
        row.email = data["email"]
    if "phone" in data:
        row.phone = data["phone"]
    if "status" in data:
        row.status = data["status"]
    add_audit(db, user=current_user_name(db), module="Organizations", action="Organization Updated", record=row.short_name or row.name, description=f"Updated organization {row.name}")
    db.commit()
    db.refresh(row)
    return serialize_organization(row)


@organizations_router.delete("/{organization_id}", status_code=204)
def delete_organization(organization_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(Organization, organization_id)
    if not row:
        raise HTTPException(status_code=404, detail="Organization not found")
    add_audit(db, user=current_user_name(db), module="Organizations", action="Organization Deleted", record=row.short_name or row.name, description=f"Deleted organization {row.name}")
    db.delete(row)
    db.commit()


@users_router.get("", response_model=list[UserOut])
def list_users(_admin: AdminUser, db: Session = Depends(get_db)) -> list[UserOut]:
    return [serialize_user(row) for row in db.query(User).order_by(User.id).all()]


@users_router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserIn, _admin: AdminUser, db: Session = Depends(get_db)) -> UserOut:
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    data = payload.model_dump(exclude={"password"})
    password = payload.password or get_settings().default_user_password
    validate_password_policy(password, db)
    row = User(**data, password_hash=hash_password(password), last_activity=datetime.now())
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Users", action="User Created", record=payload.username, description=f"Created {payload.role} account")
    db.commit()
    db.refresh(row)
    return serialize_user(row)


@users_router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdateIn, _admin: AdminUser, db: Session = Depends(get_db)) -> UserOut:
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True, exclude={"password"})
    for key, value in data.items():
        setattr(row, key, value)
    if payload.password:
        validate_password_policy(payload.password, db)
        row.password_hash = hash_password(payload.password)
        row.last_activity = datetime.now()
    add_audit(db, user=current_user_name(db), module="Users", action="User Updated", record=row.username, description=f"Updated account {row.username}")
    db.commit()
    db.refresh(row)
    return serialize_user(row)


@users_router.delete("/{user_id}")
def delete_user(user_id: int, _admin: AdminUser, db: Session = Depends(get_db)) -> dict:
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row.username == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete primary administrator")
    db.delete(row)
    add_audit(db, user=current_user_name(db), module="Users", action="User Deleted", record=row.username, description=f"Deleted account {row.username}")
    db.commit()
    return {"deleted": user_id}


@notifications_router.get("/types")
def notification_types() -> dict:
    from app.notification_service import NOTIFICATION_TYPES

    return {"types": NOTIFICATION_TYPES}


@notifications_router.get("/summary", response_model=NotificationSummaryOut)
def notification_summary(db: Session = Depends(get_db)) -> NotificationSummaryOut:
    from app.notification_service import notifications_for_user_query

    rows = notifications_for_user_query(db, current_user_name(db)).all()
    by_type: dict[str, int] = {}
    unread = 0
    for row in rows:
        if row.read:
            continue
        unread += 1
        key = row.notification_type or "System Notification"
        by_type[key] = by_type.get(key, 0) + 1
    return NotificationSummaryOut(total=len(rows), unread=unread, byType=by_type)


@notifications_router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread: bool = False,
    notification_type: str | None = Query(default=None, alias="notificationType"),
    db: Session = Depends(get_db),
) -> list[NotificationOut]:
    from app.notification_service import notifications_for_user_query

    query = notifications_for_user_query(db, current_user_name(db)).order_by(Notification.created_at.desc())
    if unread:
        query = query.filter(Notification.read.is_(False))
    if notification_type:
        query = query.filter(Notification.notification_type == notification_type)
    return [serialize_notification(row) for row in query.all()]


@notifications_router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(notification_id: int, db: Session = Depends(get_db)) -> NotificationOut:
    row = db.get(Notification, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    from app.notification_service import mark_read

    mark_read(row)
    db.commit()
    db.refresh(row)
    return serialize_notification(row)


@notifications_router.post("/mark-all-read", response_model=list[NotificationOut])
def mark_all_read(db: Session = Depends(get_db)) -> list[NotificationOut]:
    from app.notification_service import mark_read, notifications_for_user_query

    rows = notifications_for_user_query(db, current_user_name(db)).filter(Notification.read.is_(False)).all()
    for row in rows:
        mark_read(row)
    db.commit()
    return [
        serialize_notification(row)
        for row in notifications_for_user_query(db, current_user_name(db)).order_by(Notification.created_at.desc()).all()
    ]


@audit_router.get("", response_model=list[AuditOut])
def list_audit(db: Session = Depends(get_db)) -> list[AuditOut]:
    return [serialize_audit(row) for row in db.query(AuditRecord).order_by(AuditRecord.created_at.desc()).all()]


@master_router.get("")
def list_master_data(db: Session = Depends(get_db)) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for row in db.query(MasterValue).filter(MasterValue.status == "Active").order_by(MasterValue.id).all():
        grouped.setdefault(row.category, []).append(row.value)
    return grouped


@master_router.get("/items", response_model=list[MasterValueOut])
def list_master_items(db: Session = Depends(get_db)) -> list[MasterValueOut]:
    return [
        MasterValueOut(id=row.id, category=row.category, value=row.value, status=row.status)
        for row in db.query(MasterValue).order_by(MasterValue.id).all()
    ]


@master_router.post("", response_model=MasterValueOut, status_code=201)
def create_master_value(payload: MasterValueIn, db: Session = Depends(get_db)) -> MasterValueOut:
    exists = db.query(MasterValue).filter(MasterValue.category == payload.category, MasterValue.value == payload.value).first()
    if exists:
        raise HTTPException(status_code=409, detail="Value already exists")
    row = MasterValue(**payload.model_dump())
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Master Data", action="Master Data Changed", record=f"{payload.category}:{payload.value}", description="Master data value added")
    db.commit()
    db.refresh(row)
    return MasterValueOut(id=row.id, category=row.category, value=row.value, status=row.status)


@master_router.patch("/{item_id}", response_model=MasterValueOut)
def update_master_value(item_id: int, payload: MasterValueUpdateIn, db: Session = Depends(get_db)) -> MasterValueOut:
    row = db.get(MasterValue, item_id)
    if not row:
        raise HTTPException(status_code=404, detail="Master value not found")
    data = payload.model_dump(exclude_unset=True)
    if "value" in data and data["value"] != row.value:
        conflict = (
            db.query(MasterValue)
            .filter(MasterValue.category == row.category, MasterValue.value == data["value"], MasterValue.id != item_id)
            .first()
        )
        if conflict:
            raise HTTPException(status_code=409, detail="Value already exists")
        row.value = data["value"]
    if "status" in data:
        if data["status"] not in ("Active", "Inactive"):
            raise HTTPException(status_code=400, detail="Status must be Active or Inactive")
        row.status = data["status"]
    add_audit(
        db,
        user=current_user_name(db),
        module="Master Data",
        action="Master Data Changed",
        record=f"{row.category}:{row.value}",
        description="Master data value updated",
    )
    db.commit()
    db.refresh(row)
    return MasterValueOut(id=row.id, category=row.category, value=row.value, status=row.status)


@master_router.delete("/{item_id}", status_code=204)
def delete_master_value(item_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(MasterValue, item_id)
    if not row:
        raise HTTPException(status_code=404, detail="Master value not found")
    add_audit(
        db,
        user=current_user_name(db),
        module="Master Data",
        action="Master Data Changed",
        record=f"{row.category}:{row.value}",
        description="Master data value deleted",
    )
    db.delete(row)
    db.commit()


@settings_router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)) -> SettingsOut:
    return SettingsOut(**setting_map(db))


@settings_router.put("", response_model=SettingsOut)
def update_settings(payload: SettingsIn, db: Session = Depends(get_db)) -> SettingsOut:
    values = payload.model_dump(exclude_none=True)
    for key, value in values.items():
        row = db.get(AppSetting, key)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
    add_audit(db, user=current_user_name(db), module="Settings", action="Settings Updated", record="system", description="Application settings updated")
    db.commit()
    return SettingsOut(**setting_map(db))
