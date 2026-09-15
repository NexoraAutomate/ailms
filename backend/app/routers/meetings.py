from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.meeting_service import (
    MEETING_STATUSES,
    create_meeting,
    create_meeting_action,
    get_meeting,
    link_letter_to_meeting,
    serialize_meeting,
    serialize_meeting_action,
    update_meeting_action,
)
from app.models import LetterMeetingLink, Meeting, MeetingAction
from app.schemas import MeetingActionCreateIn, MeetingActionOut, MeetingActionUpdateIn, MeetingCreateIn, MeetingOut, MeetingUpdateIn
from app.services import current_user_name

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingOut])
def list_meetings(
    status: str | None = None,
    letter_id: int | None = Query(default=None, alias="letterId"),
    db: Session = Depends(get_db),
) -> list[MeetingOut]:
    if letter_id is not None:
        meeting_ids = [
            row.meeting_id
            for row in db.query(LetterMeetingLink).filter(LetterMeetingLink.letter_id == letter_id).all()
        ]
        if not meeting_ids:
            return []
        query = db.query(Meeting).filter(Meeting.id.in_(meeting_ids))
    else:
        query = db.query(Meeting)
    if status:
        query = query.filter(Meeting.status == status)
    rows = query.order_by(Meeting.meeting_date.desc(), Meeting.id.desc()).all()
    return [MeetingOut(**serialize_meeting(db, row)) for row in rows]


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting_detail(meeting_id: int, db: Session = Depends(get_db)) -> MeetingOut:
    return MeetingOut(**serialize_meeting(db, get_meeting(db, meeting_id)))


@router.post("", response_model=MeetingOut, status_code=201)
def create_meeting_record(payload: MeetingCreateIn, db: Session = Depends(get_db)) -> MeetingOut:
    meeting = create_meeting(
        db,
        data={
            "title": payload.title,
            "meeting_date": payload.meetingDate,
            "start_time": payload.startTime,
            "end_time": payload.endTime,
            "location": payload.location,
            "chairperson": payload.chairperson,
            "agenda": payload.agenda,
            "minutes": payload.minutes,
            "status": payload.status,
            "participants": [{"name": p.name, "department": p.department} for p in payload.participants],
        },
    )
    db.commit()
    db.refresh(meeting)
    return MeetingOut(**serialize_meeting(db, meeting))


@router.patch("/{meeting_id}", response_model=MeetingOut)
def update_meeting_record(meeting_id: int, payload: MeetingUpdateIn, db: Session = Depends(get_db)) -> MeetingOut:
    meeting = get_meeting(db, meeting_id)
    data = payload.model_dump(exclude_unset=True)
    mapping = {
        "meetingDate": "meeting_date",
        "startTime": "start_time",
        "endTime": "end_time",
    }
    if "status" in data and data["status"] not in MEETING_STATUSES:
        raise HTTPException(status_code=422, detail="Validation failed: invalid meeting status")
    for key, value in data.items():
        if key == "participants":
            continue
        setattr(meeting, mapping.get(key, key), value)
    db.commit()
    db.refresh(meeting)
    return MeetingOut(**serialize_meeting(db, meeting))


@router.post("/{meeting_id}/letters/{letter_id}/link", status_code=201)
def link_letter(meeting_id: int, letter_id: int, db: Session = Depends(get_db)) -> dict:
    link = link_letter_to_meeting(db, meeting_id=meeting_id, letter_id=letter_id)
    db.commit()
    return {"id": link.id, "letterId": str(link.letter_id), "meetingId": str(link.meeting_id)}


@router.delete("/{meeting_id}/letters/{letter_id}/link", status_code=204)
def unlink_letter(meeting_id: int, letter_id: int, db: Session = Depends(get_db)) -> None:
    row = (
        db.query(LetterMeetingLink)
        .filter(LetterMeetingLink.meeting_id == meeting_id, LetterMeetingLink.letter_id == letter_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(row)
    db.commit()


@router.post("/{meeting_id}/actions", response_model=MeetingActionOut, status_code=201)
def add_meeting_action(
    meeting_id: int,
    payload: MeetingActionCreateIn,
    db: Session = Depends(get_db),
) -> MeetingActionOut:
    action = create_meeting_action(
        db,
        meeting_id=meeting_id,
        data={
            "action_description": payload.actionDescription,
            "responsible_person": payload.responsiblePerson,
            "department": payload.department,
            "priority": payload.priority,
            "due_date": payload.dueDate,
            "status": payload.status,
            "remarks": payload.remarks,
        },
    )
    db.commit()
    db.refresh(action)
    return MeetingActionOut(**serialize_meeting_action(action))


@router.patch("/meeting-actions/{action_id}", response_model=MeetingActionOut)
def patch_meeting_action(
    action_id: int,
    payload: MeetingActionUpdateIn,
    db: Session = Depends(get_db),
) -> MeetingActionOut:
    data = payload.model_dump(exclude_unset=True, by_alias=False)
    mapped = {
        "actionDescription": "action_description",
        "responsiblePerson": "responsible_person",
        "dueDate": "due_date",
    }
    normalized = {mapped.get(k, k): v for k, v in data.items()}
    action = update_meeting_action(db, action_id, data=normalized)
    db.commit()
    db.refresh(action)
    return MeetingActionOut(**serialize_meeting_action(action))
