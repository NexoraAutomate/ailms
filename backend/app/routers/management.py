from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AppSetting, AuditRecord, Department, MasterValue, Notification, Organization, User
from app.schemas import (
    AuditOut,
    DepartmentIn,
    DepartmentOut,
    MasterValueIn,
    MasterValueOut,
    NotificationOut,
    OrganizationIn,
    OrganizationOut,
    SettingsIn,
    SettingsOut,
    UserIn,
    UserOut,
)
from app.services import (
    add_audit,
    current_user_name,
    serialize_audit,
    serialize_department,
    serialize_notification,
    serialize_organization,
    serialize_user,
    setting_map,
)

departments_router = APIRouter(prefix="/departments", tags=["departments"])
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
    row = Department(**payload.model_dump())
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Departments", action="Department Created", record=payload.code, description=f"Created department {payload.name}")
    db.commit()
    db.refresh(row)
    return serialize_department(db, row)


@departments_router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(department_id: int, payload: DepartmentIn, db: Session = Depends(get_db)) -> DepartmentOut:
    row = db.get(Department, department_id)
    if not row:
        raise HTTPException(status_code=404, detail="Department not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    add_audit(db, user=current_user_name(db), module="Departments", action="Department Updated", record=row.code, description=f"Updated department {row.name}")
    db.commit()
    db.refresh(row)
    return serialize_department(db, row)


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


@users_router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[UserOut]:
    return [serialize_user(row) for row in db.query(User).order_by(User.id).all()]


@users_router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserIn, db: Session = Depends(get_db)) -> UserOut:
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    row = User(**payload.model_dump(), last_activity=datetime.now())
    db.add(row)
    add_audit(db, user=current_user_name(db), module="Users", action="User Created", record=payload.username, description=f"Created {payload.role} account")
    db.commit()
    db.refresh(row)
    return serialize_user(row)


@notifications_router.get("", response_model=list[NotificationOut])
def list_notifications(unread: bool = False, db: Session = Depends(get_db)) -> list[NotificationOut]:
    query = db.query(Notification).order_by(Notification.created_at.desc())
    if unread:
        query = query.filter(Notification.read.is_(False))
    return [serialize_notification(row) for row in query.all()]


@notifications_router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(notification_id: int, db: Session = Depends(get_db)) -> NotificationOut:
    row = db.get(Notification, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.read = True
    db.commit()
    db.refresh(row)
    return serialize_notification(row)


@notifications_router.post("/mark-all-read", response_model=list[NotificationOut])
def mark_all_read(db: Session = Depends(get_db)) -> list[NotificationOut]:
    db.query(Notification).filter(Notification.read.is_(False)).update({"read": True})
    db.commit()
    return [serialize_notification(row) for row in db.query(Notification).order_by(Notification.created_at.desc()).all()]


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
