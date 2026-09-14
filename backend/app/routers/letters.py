from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Letter, LetterAction
from app.schemas import LetterActionCreate, LetterActionOut, LetterCreate, LetterOut, LetterStatusUpdate, LetterUpdate
from app.services import (
    CLOSED_STATUSES,
    add_audit,
    add_notification,
    bump_trend,
    current_user_name,
    serialize_letter,
)

router = APIRouter(prefix="/letters", tags=["letters"])


def _get_letter(db: Session, letter_id: int) -> Letter:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    return letter


def _apply_status(letter: Letter, status: str) -> None:
    letter.status = status
    if status in CLOSED_STATUSES:
        letter.completion_date = letter.completion_date or date.today()
    else:
        letter.completion_date = None


@router.get("", response_model=list[LetterOut])
def list_letters(
    q: str | None = None,
    type: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    department: str | None = None,
    assigned_to: str | None = None,
    view: str | None = Query(default=None),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> list[LetterOut]:
    rows = db.query(Letter).order_by(Letter.id.desc()).all()
    items = [serialize_letter(row) for row in rows]

    if view == "incoming":
        items = [item for item in items if item.type == "Incoming"]
    elif view == "outgoing":
        items = [item for item in items if item.type == "Outgoing"]
    elif view == "pending":
        items = [item for item in items if item.status not in CLOSED_STATUSES]
    elif view == "overdue":
        items = [item for item in items if item.status == "Overdue"]
    elif view == "closed":
        items = [item for item in items if item.status == "Closed"]
    elif view == "mine":
        owner = assigned_to or current_user_name(db)
        items = [item for item in items if item.assignedTo == owner]

    if type:
        items = [item for item in items if item.type == type]
    if status:
        items = [item for item in items if item.status == status]
    if priority:
        items = [item for item in items if item.priority == priority]
    if department:
        items = [item for item in items if item.department == department]
    if assigned_to and view != "mine":
        items = [item for item in items if item.assignedTo == assigned_to]
    if date_from:
        items = [item for item in items if item.letterDate >= date_from.isoformat()]
    if date_to:
        items = [item for item in items if item.letterDate <= date_to.isoformat()]
    if q:
        needle = q.lower()
        items = [
            item
            for item in items
            if needle in " ".join(str(value) for value in item.model_dump(by_alias=True).values()).lower()
        ]
    return items


@router.get("/{letter_id}", response_model=LetterOut)
def get_letter(letter_id: int, db: Session = Depends(get_db)) -> LetterOut:
    return serialize_letter(_get_letter(db, letter_id))


@router.post("", response_model=LetterOut, status_code=201)
def create_letter(payload: LetterCreate, db: Session = Depends(get_db)) -> LetterOut:
    if db.query(Letter).filter(Letter.number == payload.number).first():
        raise HTTPException(status_code=409, detail="Letter number already exists")

    data = payload.model_dump(by_alias=False)
    letter = Letter(
        number=data["number"],
        letter_date=data["letterDate"],
        received_date=data["receivedDate"] or data["letterDate"],
        type=data["type"],
        subject=data["subject"],
        sender=data["from_"],
        recipient=data["to"],
        department=data["department"],
        priority=data["priority"],
        status=data["status"],
        due_date=data["dueDate"],
        assigned_to=data["assignedTo"],
        last_action=data["lastAction"] or "Registered",
        confidentiality=data["confidentiality"],
        action_required=data["actionRequired"],
        remarks=data["remarks"],
    )
    db.add(letter)
    db.flush()
    bump_trend(db, letter.type, letter.letter_date)
    user = current_user_name(db)
    add_audit(
        db,
        user=user,
        module="Letters",
        action="Letter Registered",
        record=letter.number,
        description=f"{letter.type} letter registered",
    )
    if letter.assigned_to:
        add_notification(
            db,
            title="New assignment",
            description=f"{letter.subject} assigned to {letter.assigned_to}.",
            priority="High" if letter.priority == "Urgent" else "Medium",
            letter_id=letter.id,
        )
    db.commit()
    db.refresh(letter)
    return serialize_letter(letter)


@router.patch("/{letter_id}", response_model=LetterOut)
def update_letter(letter_id: int, payload: LetterUpdate, db: Session = Depends(get_db)) -> LetterOut:
    letter = _get_letter(db, letter_id)
    data = payload.model_dump(exclude_unset=True, by_alias=False)
    mapping = {
        "letterDate": "letter_date",
        "receivedDate": "received_date",
        "from_": "sender",
        "to": "recipient",
        "dueDate": "due_date",
        "assignedTo": "assigned_to",
        "lastAction": "last_action",
        "actionRequired": "action_required",
    }
    if "status" in data:
        _apply_status(letter, data.pop("status"))
    for key, value in data.items():
        setattr(letter, mapping.get(key, key), value)
    add_audit(
        db,
        user=current_user_name(db),
        module="Letters",
        action="Letter Updated",
        record=letter.number,
        description="Correspondence details updated",
    )
    db.commit()
    db.refresh(letter)
    return serialize_letter(letter)


@router.patch("/{letter_id}/status", response_model=LetterOut)
def update_letter_status(letter_id: int, payload: LetterStatusUpdate, db: Session = Depends(get_db)) -> LetterOut:
    letter = _get_letter(db, letter_id)
    _apply_status(letter, payload.status)
    letter.last_action = f"Status changed to {payload.status}"
    add_audit(
        db,
        user=current_user_name(db),
        module="Letters",
        action="Status Changed",
        record=letter.number,
        description=f"Status changed to {payload.status}",
    )
    db.commit()
    db.refresh(letter)
    return serialize_letter(letter)


@router.get("/{letter_id}/actions", response_model=list[LetterActionOut])
def list_actions(letter_id: int, db: Session = Depends(get_db)) -> list[LetterActionOut]:
    _get_letter(db, letter_id)
    rows = db.query(LetterAction).filter(LetterAction.letter_id == letter_id).order_by(LetterAction.id.desc()).all()
    return [
        LetterActionOut(
            id=row.id,
            letterId=str(row.letter_id),
            action=row.action,
            remarks=row.remarks,
            createdBy=row.created_by,
            createdAt=row.created_at,
        )
        for row in rows
    ]


@router.post("/{letter_id}/actions", response_model=LetterActionOut, status_code=201)
def add_action(letter_id: int, payload: LetterActionCreate, db: Session = Depends(get_db)) -> LetterActionOut:
    letter = _get_letter(db, letter_id)
    action = LetterAction(
        letter_id=letter.id,
        action=payload.action,
        remarks=payload.remarks,
        created_by=payload.createdBy,
    )
    letter.last_action = payload.action
    if letter.status == "Registered":
        letter.status = "Action in Progress"
    db.add(action)
    add_audit(
        db,
        user=payload.createdBy,
        module="Letters",
        action="Action Assigned",
        record=letter.number,
        description=payload.action,
    )
    db.commit()
    db.refresh(action)
    return LetterActionOut(
        id=action.id,
        letterId=str(action.letter_id),
        action=action.action,
        remarks=action.remarks,
        createdBy=action.created_by,
        createdAt=action.created_at,
    )
