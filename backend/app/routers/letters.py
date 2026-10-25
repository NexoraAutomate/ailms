from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.letter_access import (
    assert_letter_access,
    is_administrator,
    owned_letter_filter,
    resolve_user_role,
    user_can_access_letter,
)
from app.letter_create_service import create_letter_record
from app.models import Letter, LetterAction
from app.letter_delete_service import delete_letters, issue_delete_challenge, remove_letter_files
from app.schemas import (
    LetterActionCreate,
    LetterActionOut,
    LetterCreate,
    LetterDeleteChallengeIn,
    LetterDeleteChallengeOut,
    LetterDeleteIn,
    LetterDeleteOut,
    LetterOut,
    LetterStatusUpdate,
    LetterUpdate,
)
from app.services import (
    CLOSED_STATUSES,
    add_audit,
    current_user_name,
    serialize_letter,
)
from app.archive_service import assert_active_letter
from app.workflow_service import execute_transition

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
    scope: str = Query(default="owned", pattern="^(owned|catalog)$"),
    include_archived: bool = Query(default=False),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> list[LetterOut]:
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    admin = is_administrator(role)

    query = db.query(Letter)
    if view == "archived":
        query = query.filter(Letter.is_archived.is_(True))
    elif scope == "catalog":
        pass
    elif not include_archived:
        query = query.filter(Letter.is_archived.is_(False))

    if scope == "owned" and not admin:
        query = query.filter(owned_letter_filter(actor))

    rows = query.order_by(Letter.id.desc()).all()
    from app.marking_workflow_service import can_edit_letter_details, letter_ids_with_active_markings

    active_marked = letter_ids_with_active_markings(db, [row.id for row in rows])
    items = [
        serialize_letter(
            row,
            include_body=False,
            accessible=admin or user_can_access_letter(db, row, actor, role),
            can_edit_details=can_edit_letter_details(
                db, row, actor, has_active=row.id in active_marked
            ),
            has_active_markings=row.id in active_marked,
        )
        for row in rows
    ]

    if view == "inbox":
        from app.marking_workflow_service import (
            available_marking_actions,
            letter_ids_held_by_user,
            marked_by_for_holder,
        )
        from app.services import attach_inbox_holder_actions, attach_inbox_marked_by

        held = {str(i) for i in letter_ids_held_by_user(db, actor)}
        by_id = {str(row.id): row for row in rows}
        inbox_items: list = []
        for item in items:
            if item.id not in held:
                continue
            letter_row = by_id.get(item.id)
            actions = (
                available_marking_actions(db, letter_row, actor) if letter_row is not None else []
            )
            enriched = attach_inbox_marked_by(
                item, marked_by_for_holder(db, int(item.id), actor)
            )
            inbox_items.append(
                attach_inbox_holder_actions(
                    enriched,
                    can_assign="forward" in actions,
                    can_respond="respond" in actions,
                )
            )
        items = inbox_items
    elif view == "sent":
        # One row per outstanding Response Required the actor sent (not For Information).
        from app.marking_workflow_service import sent_markings_for_user
        from app.services import attach_sent_marking

        by_id = {item.id: item for item in items}
        sent_items: list = []
        for marking in sent_markings_for_user(db, actor):
            base = by_id.get(str(marking.letter_id))
            if base is None:
                continue
            sent_items.append(attach_sent_marking(base, marking))
        items = sent_items
    elif view == "incoming":
        items = [item for item in items if item.type == "Incoming"]
    elif view == "outgoing":
        items = [item for item in items if item.type == "Outgoing"]
    elif view == "pending":
        items = [item for item in items if item.status not in CLOSED_STATUSES]
    elif view == "overdue":
        items = [item for item in items if item.status == "Overdue"]
    elif view == "closed":
        items = [item for item in items if item.status == "Closed"]
    elif view == "archived":
        items = [item for item in items if item.isArchived]
    elif view == "mine":
        from app.enterprise_workflow_service import letter_ids_for_user_inbox

        owner = assigned_to or actor
        inbox_ids = letter_ids_for_user_inbox(db, owner)
        items = [
            item
            for item in items
            if item.assignedTo == owner or item.id in {str(i) for i in inbox_ids}
        ]

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


@router.post("/delete-challenge", response_model=LetterDeleteChallengeOut)
def create_delete_challenge(payload: LetterDeleteChallengeIn, db: Session = Depends(get_db)) -> LetterDeleteChallengeOut:
    code, ids, expires = issue_delete_challenge(db, payload.letterIds)
    return LetterDeleteChallengeOut(confirmationCode=code, letterIds=list(ids), expiresInSeconds=expires)


@router.post("/delete", response_model=LetterDeleteOut)
def remove_letters(payload: LetterDeleteIn, db: Session = Depends(get_db)) -> LetterDeleteOut:
    deleted_ids, storage_keys = delete_letters(db, payload.letterIds, payload.confirmationCode)
    db.commit()
    remove_letter_files(storage_keys)
    return LetterDeleteOut(deleted=len(deleted_ids), letterIds=deleted_ids)


@router.get("/{letter_id}", response_model=LetterOut)
def get_letter(letter_id: int, db: Session = Depends(get_db)) -> LetterOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    assert_letter_access(db, letter, actor, role)
    return serialize_letter(letter, accessible=True, db=db, viewer=actor)


@router.post("", response_model=LetterOut, status_code=201)
def create_letter(payload: LetterCreate, db: Session = Depends(get_db)) -> LetterOut:
    letter = create_letter_record(db, payload)
    db.commit()
    db.refresh(letter)
    actor = current_user_name(db)
    return serialize_letter(letter, db=db, viewer=actor)


@router.patch("/{letter_id}", response_model=LetterOut)
def update_letter(letter_id: int, payload: LetterUpdate, db: Session = Depends(get_db)) -> LetterOut:
    from app.marking_workflow_service import assert_can_edit_letter_details

    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    assert_active_letter(letter)
    assert_can_edit_letter_details(db, letter, actor)
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
        "bodyText": "body_text",
    }
    from app.config import get_settings

    # Assigned To must go through marking Forward — a bare PATCH does not put the
    # recipient in Inbox and would leave the sender able to edit while "assigned".
    if get_settings().marking_workflow_enabled and "assignedTo" in data:
        next_assignee = (data.pop("assignedTo") or "").strip()
        current = (letter.assigned_to or "").strip()
        if next_assignee and next_assignee != current:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Use Assign or Forward (Workflow tab or row actions) to mark "
                    "correspondence to another user"
                ),
            )
    if "number" in data:
        next_number = (data["number"] or "").strip()
        if not next_number:
            raise HTTPException(status_code=422, detail="Letter number is required")
        data["number"] = next_number
        if next_number != letter.number:
            clash = (
                db.query(Letter.id)
                .filter(Letter.number == next_number, Letter.id != letter.id)
                .first()
            )
            if clash:
                raise HTTPException(status_code=409, detail="Letter number already exists")
    if "status" in data:
        _apply_status(letter, data.pop("status"))
    body_changed = "bodyText" in data or "subject" in data
    for key, value in data.items():
        attr = mapping.get(key, key)
        if attr == "assigned_to" and value is not None and value != letter.assigned_to:
            letter.assigned_by = actor
        setattr(letter, attr, value)
    if body_changed:
        from app.rag.indexer import try_index_letter

        try_index_letter(db, letter)
    add_audit(
        db,
        user=actor,
        module="Letters",
        action="Letter Updated",
        record=letter.number,
        description="Correspondence details updated",
    )
    db.commit()
    db.refresh(letter)
    return serialize_letter(letter, db=db, viewer=actor)


@router.patch("/{letter_id}/status", response_model=LetterOut)
def update_letter_status(letter_id: int, payload: LetterStatusUpdate, db: Session = Depends(get_db)) -> LetterOut:
    letter = _get_letter(db, letter_id)
    actor = current_user_name(db)
    assert_letter_access(db, letter, actor)
    assert_active_letter(letter)
    _apply_status(letter, payload.status)
    letter.last_action = f"Status changed to {payload.status}"
    add_audit(
        db,
        user=actor,
        module="Letters",
        action="Status Changed",
        record=letter.number,
        description=f"Status changed to {payload.status}",
    )
    db.commit()
    db.refresh(letter)
    return serialize_letter(letter, db=db, viewer=actor)


@router.get("/{letter_id}/actions", response_model=list[LetterActionOut])
def list_actions(letter_id: int, db: Session = Depends(get_db)) -> list[LetterActionOut]:
    letter = _get_letter(db, letter_id)
    assert_letter_access(db, letter, current_user_name(db))
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
    assert_letter_access(db, letter, current_user_name(db))
    assert_active_letter(letter)
    try:
        execute_transition(
            db,
            letter=letter,
            action="add_action",
            actor_name=payload.createdBy,
            remarks=payload.remarks,
            action_label=payload.action,
        )
    except HTTPException as exc:
        if exc.status_code == 400 and "Workflow transition not allowed" in str(exc.detail):
            action = LetterAction(
                letter_id=letter.id,
                action=payload.action,
                remarks=payload.remarks,
                created_by=payload.createdBy,
            )
            letter.last_action = payload.action
            db.add(action)
            add_audit(
                db,
                user=payload.createdBy,
                module="Letters",
                action="Action Assigned",
                record=letter.number,
                description=payload.action,
            )
        else:
            raise
    db.commit()
    action_row = (
        db.query(LetterAction)
        .filter(LetterAction.letter_id == letter_id)
        .order_by(LetterAction.id.desc())
        .first()
    )
    if not action_row:
        raise HTTPException(status_code=500, detail="Unable to record action")
    return LetterActionOut(
        id=action_row.id,
        letterId=str(action_row.letter_id),
        action=action_row.action,
        remarks=action_row.remarks,
        createdBy=action_row.created_by,
        createdAt=action_row.created_at,
    )
