"""Meeting and meeting action management."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Letter, LetterMeetingLink, Meeting, MeetingAction, MeetingParticipant
from app.services import add_audit, add_notification, current_user_name, effective_status

MEETING_STATUSES = {"Scheduled", "In Progress", "Completed", "Cancelled"}
ACTION_STATUSES = {"Open", "In Progress", "Completed", "Overdue", "Cancelled"}


def effective_action_status(action: MeetingAction) -> str:
    if action.status in {"Completed", "Cancelled"}:
        return action.status
    if action.due_date and action.due_date < date.today():
        return "Overdue"
    return action.status


def serialize_participant(row: MeetingParticipant) -> dict:
    return {
        "id": row.id,
        "name": row.participant_name,
        "department": row.department,
    }


def serialize_meeting_action(row: MeetingAction) -> dict:
    status = effective_action_status(row)
    return {
        "id": row.id,
        "meetingId": str(row.meeting_id),
        "actionDescription": row.action_description,
        "responsiblePerson": row.responsible_person,
        "department": row.department,
        "priority": row.priority,
        "dueDate": row.due_date.isoformat() if row.due_date else "",
        "status": status,
        "remarks": row.remarks,
        "completionDate": row.completion_date.isoformat() if row.completion_date else "",
    }


def serialize_meeting(db: Session, meeting: Meeting) -> dict:
    participants = db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id == meeting.id).all()
    actions = db.query(MeetingAction).filter(MeetingAction.meeting_id == meeting.id).order_by(MeetingAction.id).all()
    letter_ids = [
        str(link.letter_id)
        for link in db.query(LetterMeetingLink).filter(LetterMeetingLink.meeting_id == meeting.id).all()
    ]
    return {
        "id": str(meeting.id),
        "title": meeting.title,
        "date": meeting.meeting_date.isoformat(),
        "startTime": meeting.start_time,
        "endTime": meeting.end_time,
        "location": meeting.location,
        "chairperson": meeting.chairperson,
        "agenda": meeting.agenda,
        "minutes": meeting.minutes,
        "status": meeting.status,
        "createdBy": meeting.created_by,
        "participants": [serialize_participant(p) for p in participants],
        "actions": [serialize_meeting_action(a) for a in actions],
        "letterIds": letter_ids,
        "createdAt": meeting.created_at.isoformat(),
        "updatedAt": meeting.updated_at.isoformat(),
    }


def get_meeting(db: Session, meeting_id: int) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def create_meeting(db: Session, *, data: dict, actor: str | None = None) -> Meeting:
    actor = actor or current_user_name(db)
    if data.get("status") not in MEETING_STATUSES:
        raise HTTPException(status_code=422, detail="Validation failed: invalid meeting status")
    meeting = Meeting(
        title=data["title"],
        meeting_date=data["meeting_date"],
        start_time=data.get("start_time", "09:00"),
        end_time=data.get("end_time", "10:00"),
        location=data.get("location", ""),
        chairperson=data.get("chairperson", ""),
        agenda=data.get("agenda", ""),
        minutes=data.get("minutes", ""),
        status=data.get("status", "Scheduled"),
        created_by=actor,
    )
    db.add(meeting)
    db.flush()
    for participant in data.get("participants", []):
        db.add(
            MeetingParticipant(
                meeting_id=meeting.id,
                participant_name=participant["name"],
                department=participant.get("department", ""),
            )
        )
    add_audit(db, user=actor, module="Meetings", action="Meeting Created", record=str(meeting.id), description=meeting.title)
    db.flush()
    return meeting


def link_letter_to_meeting(db: Session, *, meeting_id: int, letter_id: int, actor: str | None = None) -> LetterMeetingLink:
    actor = actor or current_user_name(db)
    if not db.get(Letter, letter_id):
        raise HTTPException(status_code=404, detail="Letter not found")
    existing = (
        db.query(LetterMeetingLink)
        .filter(LetterMeetingLink.meeting_id == meeting_id, LetterMeetingLink.letter_id == letter_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate record")
    meeting = get_meeting(db, meeting_id)
    link = LetterMeetingLink(meeting_id=meeting_id, letter_id=letter_id, linked_by=actor)
    db.add(link)
    letter = db.get(Letter, letter_id)
    add_audit(
        db,
        user=actor,
        module="Meetings",
        action="Letter Linked",
        record=letter.number if letter else str(letter_id),
        description=f"Linked to meeting {meeting_id}",
    )
    add_notification(
        db,
        title="Meeting Assigned",
        description=f"Letter linked to meeting: {meeting.title}",
        priority="Medium",
        letter_id=letter_id,
        notification_type="Meeting Assigned",
        recipient_name=letter.assigned_to if letter else "",
        related_entity_type="meeting",
        related_entity_id=str(meeting.id),
    )
    db.flush()
    return link


def create_meeting_action(db: Session, *, meeting_id: int, data: dict, actor: str | None = None) -> MeetingAction:
    actor = actor or current_user_name(db)
    meeting = get_meeting(db, meeting_id)
    action = MeetingAction(
        meeting_id=meeting.id,
        action_description=data["action_description"],
        responsible_person=data.get("responsible_person", ""),
        department=data.get("department", ""),
        priority=data.get("priority", "Routine"),
        due_date=data.get("due_date"),
        status=data.get("status", "Open"),
        remarks=data.get("remarks", ""),
    )
    db.add(action)
    add_audit(
        db,
        user=actor,
        module="Meetings",
        action="Meeting Action Created",
        record=str(meeting.id),
        description=action.action_description,
    )
    if action.responsible_person and action.due_date:
        add_notification(
            db,
            title="Meeting Action Due",
            description=f"{action.action_description} due {action.due_date.isoformat()}",
            priority="High" if action.priority == "Urgent" else "Medium",
            notification_type="Meeting Action Due",
            recipient_name=action.responsible_person,
            related_entity_type="meeting_action",
            related_entity_id=str(action.id),
        )
    db.flush()
    return action


def update_meeting_action(db: Session, action_id: int, *, data: dict, actor: str | None = None) -> MeetingAction:
    actor = actor or current_user_name(db)
    action = db.get(MeetingAction, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Meeting action not found")
    if "status" in data and data["status"] in ACTION_STATUSES:
        action.status = data["status"]
        if data["status"] == "Completed":
            action.completion_date = date.today()
    for field, attr in [
        ("action_description", "action_description"),
        ("responsible_person", "responsible_person"),
        ("department", "department"),
        ("priority", "priority"),
        ("due_date", "due_date"),
        ("remarks", "remarks"),
    ]:
        if field in data and data[field] is not None:
            setattr(action, attr, data[field])
    add_audit(
        db,
        user=actor,
        module="Meetings",
        action="Meeting Action Updated",
        record=str(action.meeting_id),
        description=action.action_description,
    )
    db.flush()
    return action
