"""Simple correspondence marking workflow (specs 02–04)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    CorrespondenceAttachment,
    CorrespondenceAttachmentEvent,
    CorrespondenceDraftAttachment,
    CorrespondenceDraftNote,
    CorrespondenceDraftRecipient,
    CorrespondenceNote,
    DocumentVersion,
    Letter,
    Marking,
    MarkingBatch,
    MarkingSubscription,
    User,
)
from app.services import add_audit, add_notification, normalize_role, resolve_user_role
from app.storage_service import can_preview

MARKING_ACTIONS = frozenset({"forward", "for_info", "response_required"})
MARKING_DIRECTIONS = frozenset({"forward", "reply"})
RESPONSE_TYPES = frozenset(
    {"draft_letter", "presentation", "nominations", "comments", "other"}
)
ATTACHMENT_KINDS = frozenset(
    {"Presentation", "Draft Response", "Supporting Doc", "Nomination List", "Other"}
)
# all = visible to everyone on the pathway (propagates on remake);
# recipient = only the hop's participants (+ upstream auditors).
NOTE_AUDIENCES = frozenset({"all", "recipient"})
AUDIENCE_ALL = "all"
AUDIENCE_RECIPIENT = "recipient"


def normalize_audience(raw: Any, *, default: str = AUDIENCE_RECIPIENT) -> str:
    value = str(raw or "").strip().lower()
    if value in NOTE_AUDIENCES:
        return value
    return default if default in NOTE_AUDIENCES else AUDIENCE_RECIPIENT
ACTION_LABELS = {
    "forward": "Forward",
    "for_info": "For Information",
    "response_required": "Response Required",
}
OPEN_LETTER = "Open"
CLOSED_LETTER = "Closed"
ARCHIVED_LETTER = "Archived"


def new_path_id() -> str:
    return str(uuid.uuid4())


def assign_path_id(
    *,
    parent: Marking | None,
    fan_out: bool,
    direction: str,
) -> str:
    """
    Branch rules:
    - Fan-out (2+ recipients): each marking gets a new path_id.
    - Single-recipient forward/reply with a parent path: inherit that path_id.
    - Root / missing parent path: new path_id.
    """
    parent_path = (parent.path_id or "").strip() if parent else ""
    if direction == "reply":
        return parent_path or new_path_id()
    if fan_out:
        return new_path_id()
    if parent_path:
        return parent_path
    return new_path_id()


def _user_by_name(db: Session, name: str) -> User | None:
    return db.query(User).filter(User.name == name).one_or_none()


def _is_viewer(db: Session, actor_name: str) -> bool:
    return normalize_role(resolve_user_role(db, actor_name)) == "Viewer"


def _is_admin(db: Session, actor_name: str) -> bool:
    role = normalize_role(resolve_user_role(db, actor_name))
    return role in {"Admin", "Administrator"}


def initiator_name(letter: Letter) -> str:
    return (letter.created_by or "").strip()


def is_initiator(letter: Letter, actor_name: str) -> bool:
    return initiator_name(letter) == (actor_name or "").strip()


def has_active_markings(db: Session, letter_id: int) -> bool:
    return (
        db.query(Marking.id)
        .filter(Marking.letter_id == letter_id, Marking.status == "active")
        .first()
        is not None
    )


def _action_label(action: str) -> str:
    return ACTION_LABELS.get(action, (action or "").replace("_", " ").title())


def _pick_primary_marking(markings: list[Marking]) -> Marking | None:
    """Primary = first response_required, else most recently created."""
    if not markings:
        return None
    for row in markings:
        if row.action == "response_required":
            return row
    return max(markings, key=lambda m: m.id or 0)


def format_assigned_to_holders(names: list[str]) -> str:
    """Full comma-separated current holders (UI truncates preview + … popup)."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in names:
        name = (raw or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    if not out:
        return ""
    # cms_letters.assigned_to widened to VARCHAR(500)
    return ", ".join(out)[:500]


def active_leaf_markings(db: Session, letter_id: int) -> list[Marking]:
    """Active markings that have not been remade onward (current holders)."""
    actives = (
        db.query(Marking)
        .filter(Marking.letter_id == letter_id, Marking.status == "active")
        .order_by(Marking.id.asc())
        .all()
    )
    return [m for m in actives if not marking_has_children(db, m.id)]


def response_returned_markings(
    db: Session,
    letter_id: int,
    user_name: str | None = None,
) -> list[Marking]:
    """
    Response Required markings that were fulfilled and not yet remade onward.

    The original marker regains a hold on this path so the letter returns to
    their Inbox after the response is received.
    """
    q = db.query(Marking).filter(
        Marking.letter_id == letter_id,
        Marking.action == "response_required",
        Marking.status == "responded",
    )
    if user_name:
        q = q.filter(Marking.from_user == (user_name or "").strip())
    rows = q.order_by(Marking.id.asc()).all()
    return [m for m in rows if not marking_has_children(db, m.id)]


def current_holder_names(db: Session, letter_id: int) -> list[str]:
    """Display names of users who currently hold the letter."""
    names: list[str] = []
    for leaf in active_leaf_markings(db, letter_id):
        names.append(leaf.to_user)
    for returned in response_returned_markings(db, letter_id):
        names.append(returned.from_user)
    return names


def sync_letter_from_markings(
    db: Session,
    letter: Letter,
    *,
    last_action: str | None = None,
) -> None:
    """Keep legacy Assigned To / Last Action in sync with the marking tree."""
    leaves = active_leaf_markings(db, letter.id)
    returned = response_returned_markings(db, letter.id)
    holders = current_holder_names(db, letter.id)
    primary = _pick_primary_marking(leaves) or (returned[-1] if returned else None)
    if holders:
        letter.assigned_to = format_assigned_to_holders(holders)
        if primary:
            # For returned RR, assigned_by is the person who responded (to_user).
            if primary.status == "responded":
                letter.assigned_by = primary.to_user
            else:
                letter.assigned_by = primary.from_user
        else:
            letter.assigned_by = holders[0]
    else:
        holder = initiator_name(letter)
        letter.assigned_to = holder
        letter.assigned_by = holder
    if last_action is not None:
        letter.last_action = last_action


def _mark_last_action(marking: Marking) -> str:
    return f"Marked ({_action_label(marking.action)})"


def derive_last_action_from_markings(db: Session, letter: Letter) -> str | None:
    """Most recent marking event label for backfill / repair.

    Revoked markings are omitted entirely — revoke is not a workflow tracking
    event, and skipping them also avoids create/revoke clock skew resurfacing
    a mark after it was revoked.
    """
    events: list[tuple[datetime, int, str]] = []
    if letter.status == CLOSED_LETTER and letter.closed_at:
        events.append((letter.closed_at, letter.id or 0, "Closed"))
    rows = (
        db.query(Marking)
        .filter(Marking.letter_id == letter.id, Marking.status != "revoked")
        .all()
    )
    for row in rows:
        if row.status == "responded" and row.responded_at:
            events.append((row.responded_at, row.id or 0, "Responded"))
        elif row.created_at:
            events.append((row.created_at, row.id or 0, _mark_last_action(row)))
    if not events:
        return None
    events.sort(key=lambda item: (item[0], item[1]))
    return events[-1][2]


def repair_letter_assignment_from_markings(db: Session, letter: Letter) -> bool:
    """Recompute assigned_to / last_action from marking history. Returns True if changed."""
    before = (letter.assigned_to, letter.assigned_by, letter.last_action)
    derived = derive_last_action_from_markings(db, letter)
    sync_letter_from_markings(db, letter, last_action=derived)
    after = (letter.assigned_to, letter.assigned_by, letter.last_action)
    return before != after


def backfill_letter_assignments_from_markings(db: Session) -> int:
    """Repair legacy Assigned To / Last Action for all letters that have markings."""
    letter_ids = {row[0] for row in db.query(Marking.letter_id).distinct().all()}
    if not letter_ids:
        return 0
    updated = 0
    for letter in db.query(Letter).filter(Letter.id.in_(letter_ids)).all():
        if repair_letter_assignment_from_markings(db, letter):
            updated += 1
    return updated


def letter_ids_with_active_markings(db: Session, letter_ids: list[int]) -> set[int]:
    if not letter_ids:
        return set()
    rows = (
        db.query(Marking.letter_id)
        .filter(Marking.letter_id.in_(letter_ids), Marking.status == "active")
        .distinct()
        .all()
    )
    return {int(row[0]) for row in rows}


def can_edit_letter_details(
    db: Session,
    letter: Letter,
    actor_name: str,
    *,
    has_active: bool | None = None,
) -> bool:
    """
    Initiator may edit registration details only until the letter is marked onward.
    Revoking every active marking restores editability for the initiator.
    """
    if letter.is_archived or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
        return False
    if not is_initiator(letter, actor_name):
        return False
    active = has_active_markings(db, letter.id) if has_active is None else has_active
    return not active


def assert_can_edit_letter_details(db: Session, letter: Letter, actor_name: str) -> None:
    if can_edit_letter_details(db, letter, actor_name):
        return
    if not is_initiator(letter, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Only the user who registered this correspondence can edit its details",
        )
    if letter.is_archived or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
        raise HTTPException(status_code=400, detail="Closed or archived correspondence cannot be edited")
    raise HTTPException(
        status_code=403,
        detail="Correspondence details cannot be edited after the letter has been marked to another user",
    )


def marking_has_children(db: Session, marking_id: int) -> bool:
    """True if this marking was remade onward (has an active child).

    Revoked remakes do not count — after revoke, the parent leaf hold is restored.
    """
    return (
        db.query(Marking.id)
        .filter(
            Marking.parent_marking_id == marking_id,
            Marking.status == "active",
        )
        .first()
        is not None
    )


def marking_recipient_has_activity(db: Session, marking: Marking) -> bool:
    """True if the marked-to user has contributed on this marking.

    Counts notes, attachments (including soft-deleted), file replace versions they
    uploaded on linked documents, and archive events — so revoke stays blocked
    after the recipient acts even if a senior later removes/replaces files.
    """
    recipient = (marking.to_user or "").strip()
    if not recipient:
        return False
    if marking.status == "responded":
        return True
    has_note = (
        db.query(CorrespondenceNote.id)
        .filter(
            CorrespondenceNote.marking_id == marking.id,
            CorrespondenceNote.author_user == recipient,
        )
        .first()
        is not None
    )
    if has_note:
        return True
    has_attachment = (
        db.query(CorrespondenceAttachment.id)
        .filter(
            CorrespondenceAttachment.marking_id == marking.id,
            CorrespondenceAttachment.created_by == recipient,
        )
        .first()
        is not None
    )
    if has_attachment:
        return True
    has_event = (
        db.query(CorrespondenceAttachmentEvent.id)
        .filter(
            CorrespondenceAttachmentEvent.marking_id == marking.id,
            CorrespondenceAttachmentEvent.actor_user == recipient,
            CorrespondenceAttachmentEvent.event_type.in_(("added", "replaced", "removed")),
        )
        .first()
        is not None
    )
    if has_event:
        return True
    doc_ids = [
        int(row[0])
        for row in db.query(CorrespondenceAttachment.document_id)
        .filter(
            CorrespondenceAttachment.marking_id == marking.id,
            CorrespondenceAttachment.document_id.isnot(None),
        )
        .all()
        if row[0] is not None
    ]
    if not doc_ids:
        return False
    return (
        db.query(DocumentVersion.id)
        .filter(
            DocumentVersion.document_id.in_(doc_ids),
            DocumentVersion.uploaded_by == recipient,
        )
        .first()
        is not None
    )


def marking_is_revokable(db: Session, marking: Marking) -> bool:
    """Last marker may revoke only while recipient has not remade or contributed."""
    if marking.status != "active":
        return False
    if marking_has_children(db, marking.id):
        return False
    if marking_recipient_has_activity(db, marking):
        return False
    return True


def leaf_inbound_markings(db: Session, letter_id: int, user_name: str) -> list[Marking]:
    """Active markings to the user that have not been remade onward."""
    name = (user_name or "").strip()
    if not name:
        return []
    inbound = (
        db.query(Marking)
        .filter(
            Marking.letter_id == letter_id,
            Marking.to_user == name,
            Marking.status == "active",
        )
        .order_by(Marking.id.asc())
        .all()
    )
    return [m for m in inbound if not marking_has_children(db, m.id)]


def marked_by_for_holder(db: Session, letter_id: int, user_name: str) -> str:
    """
    Display name of the user who put this letter into the holder's Inbox.

    - Inbound leaf hold → marking.from_user
    - Returned Response Required → marking.to_user (who responded)
    - Initiator self-hold (nothing marked out) → empty
    """
    leaves = leaf_inbound_markings(db, letter_id, user_name)
    if leaves:
        names: list[str] = []
        for marking in leaves:
            name = (marking.from_user or "").strip()
            if name and name not in names:
                names.append(name)
        return ", ".join(names)
    returned = response_returned_markings(db, letter_id, user_name)
    if returned:
        names = []
        for marking in returned:
            name = (marking.to_user or "").strip()
            if name and name not in names:
                names.append(name)
        return ", ".join(names)
    return ""


def user_holds_letter(db: Session, letter: Letter, actor_name: str) -> bool:
    """
    Holder may mark / note / close.
    After marking onward, the marker is no longer a holder (revoke-only until remade
    or a Response Required they sent is fulfilled — then the letter returns to Inbox).
    """
    name = (actor_name or "").strip()
    if not name:
        return False
    if is_initiator(letter, name) and not has_active_markings(db, letter.id):
        return True
    if leaf_inbound_markings(db, letter.id, name):
        return True
    return bool(response_returned_markings(db, letter.id, name))


def assert_can_mutate(db: Session, letter: Letter, actor_name: str) -> None:
    if letter.is_archived or letter.status == ARCHIVED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is archived")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is closed")
    if letter.status not in {OPEN_LETTER, "Registered", "LLM Analyzed"} and letter.status != OPEN_LETTER:
        # Allow pre-migration statuses until migrate runs; treat non-closed as open-ish
        if letter.status in {CLOSED_LETTER, ARCHIVED_LETTER}:
            raise HTTPException(status_code=400, detail=f"Cannot mutate letter in status '{letter.status}'")
    if _is_viewer(db, actor_name):
        raise HTTPException(status_code=403, detail="Viewers cannot modify workflow")
    if not user_holds_letter(db, letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="You do not currently hold this correspondence")


def serialize_marking(row: Marking, children: list[dict] | None = None) -> dict:
    return {
        "id": row.id,
        "batchId": row.batch_id,
        "letterId": str(row.letter_id),
        "parentMarkingId": row.parent_marking_id,
        "pathId": row.path_id or "",
        "direction": row.direction or "forward",
        "fromUser": row.from_user,
        "toUser": row.to_user,
        "action": row.action,
        "responseType": row.response_type,
        "responseTypeOther": row.response_type_other,
        "instructions": row.instructions,
        "dueAt": row.due_at.isoformat() if row.due_at else "",
        "priority": row.priority,
        "track": row.track,
        "remindersEnabled": row.reminders_enabled,
        "status": row.status,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "revokedAt": row.revoked_at.isoformat() if row.revoked_at else "",
        "revokedBy": row.revoked_by,
        "respondedAt": row.responded_at.isoformat() if row.responded_at else "",
        "responseNoteId": row.response_note_id,
        "children": children or [],
    }


def serialize_batch(row: MarkingBatch) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "fromUser": row.from_user,
        "remarks": row.remarks,
        "pathwayNotify": row.pathway_notify,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def path_ids_visible_to_user(db: Session, letter_id: int, actor_name: str) -> set[str] | None:
    """
    Path ids the actor may see on this letter.

    Returns None for Admin (unrestricted). A user sees a path if they appear as
    from_user or to_user on any non-revoked marking with that path_id.
    """
    name = (actor_name or "").strip()
    if not name:
        return set()
    if _is_admin(db, name):
        return None
    rows = (
        db.query(Marking.path_id)
        .filter(
            Marking.letter_id == letter_id,
            Marking.status != "revoked",
            (Marking.from_user == name) | (Marking.to_user == name),
        )
        .distinct()
        .all()
    )
    return {(row[0] or "").strip() for row in rows if (row[0] or "").strip()}


def marking_visible_on_paths(marking: Marking | None, visible_paths: set[str] | None) -> bool:
    """True if the marking's path is allowed (None visible_paths = all)."""
    if visible_paths is None:
        return True
    if marking is None:
        return False
    pid = (marking.path_id or "").strip()
    if not pid:
        # Legacy / missing path: only visible to direct participants.
        return False
    return pid in visible_paths


def actor_in_marking_batch(db: Session, batch_id: int | None, actor_name: str) -> bool:
    """True if actor is from_user or to_user on any non-revoked marking in the batch."""
    if batch_id is None:
        return False
    name = (actor_name or "").strip()
    if not name:
        return False
    row = (
        db.query(Marking.id)
        .filter(
            Marking.batch_id == int(batch_id),
            Marking.status != "revoked",
            (Marking.from_user == name) | (Marking.to_user == name),
        )
        .first()
    )
    return row is not None


def marking_content_visible_to_actor(
    db: Session,
    marking: Marking | None,
    actor_name: str,
    *,
    visible_paths: set[str] | None,
    audience: str = AUDIENCE_RECIPIENT,
) -> bool:
    """
    Whether notes/attachments on this marking may be shown to the actor.

    - audience=all: any user on the same pathway (including later remakes /
      juniors) may see the content — "for all" comments travel with the letter.
      Also visible to co-recipients on the same mark batch (Info / sibling To)
      so shared To-specific messages are readable by everyone in that mark.
    - audience=recipient: only direct hop participants (from_user / to_user)
      plus upstream participants on ancestor markings. Downstream juniors do
      not see recipient-only comments written for a senior hop.
    Admins (visible_paths is None) see everything.
    """
    if marking is None:
        return False
    if marking.status == "revoked":
        return False
    if visible_paths is None:
        return True

    name = (actor_name or "").strip()
    on_path = marking_visible_on_paths(marking, visible_paths)

    if normalize_audience(audience) == AUDIENCE_ALL:
        if on_path:
            return True
        # Shared (non-private) To content: visible to Info / sibling To in the batch.
        return actor_in_marking_batch(db, marking.batch_id, name)

    if not on_path:
        return False

    if not name:
        return False
    if marking.from_user == name or marking.to_user == name:
        return True

    parent_id = marking.parent_marking_id
    seen: set[int] = set()
    while parent_id is not None:
        pid = int(parent_id)
        if pid in seen:
            break
        seen.add(pid)
        parent = db.get(Marking, pid)
        if parent is None:
            break
        if parent.from_user == name or parent.to_user == name:
            return True
        parent_id = parent.parent_marking_id
    return False


def markings_for_pathway_view(
    rows: list[Marking],
    *,
    actor_name: str,
    is_admin: bool,
) -> list[Marking]:
    """
    Markings shown on the Workflow pathway / tree for a non-admin actor.

    Seed = hops where the actor is from_user or to_user.
    Include:
      - all ancestors of those seeds (so the chain back to the initiator is visible)
      - all descendants of those seeds (so remakes / fan-outs the actor made or holds
        continue to show, even when fan-out assigned new path_ids)

    Sibling privacy: descendants are taken only from seed markings, not from
    ancestors. A recipient on one fan-out branch therefore does not see the
    sibling branch under the same parent.
    """
    name = (actor_name or "").strip()
    if not name:
        return []
    if is_admin:
        return list(rows)

    by_id: dict[int, Marking] = {int(r.id): r for r in rows}
    children_of: dict[int, list[int]] = {}
    for row in rows:
        pid = row.parent_marking_id
        if pid is None:
            continue
        children_of.setdefault(int(pid), []).append(int(row.id))

    seed = {
        int(r.id)
        for r in rows
        if (r.from_user or "").strip() == name or (r.to_user or "").strip() == name
    }
    if not seed:
        return []

    visible: set[int] = set()

    # Walk up to initiator so the pathway is not a detached leaf.
    for sid in seed:
        cur: int | None = sid
        seen_up: set[int] = set()
        while cur is not None and cur not in seen_up:
            seen_up.add(cur)
            visible.add(cur)
            parent = by_id.get(cur)
            cur = int(parent.parent_marking_id) if parent and parent.parent_marking_id is not None else None

    # Walk down from seeds only (fan-out / remakes on the actor's holds).
    stack = list(seed)
    while stack:
        mid = stack.pop()
        for cid in children_of.get(mid, []):
            if cid in visible:
                continue
            visible.add(cid)
            stack.append(cid)

    return [r for r in rows if int(r.id) in visible]


def marking_tree(
    db: Session,
    letter_id: int,
    *,
    actor_name: str | None = None,
) -> list[dict]:
    # Revoked markings are omitted from Workflow history / pathway (not tracked).
    rows = (
        db.query(Marking)
        .filter(Marking.letter_id == letter_id, Marking.status != "revoked")
        .order_by(Marking.id.asc())
        .all()
    )
    if actor_name:
        name = (actor_name or "").strip()
        if name:
            # Pathway view: ancestors + seed descendants (fixes missing fan-out
            # children when remakes minted new path_ids). Admins see everything.
            rows = markings_for_pathway_view(
                rows,
                actor_name=name,
                is_admin=_is_admin(db, name),
            )

    visible_ids = {r.id for r in rows}
    by_parent: dict[int | None, list[Marking]] = {}
    for row in rows:
        parent_id = row.parent_marking_id
        # If the parent edge is on another path (filtered out), show this node as a root.
        if parent_id is not None and parent_id not in visible_ids:
            parent_id = None
        by_parent.setdefault(parent_id, []).append(row)

    def build(parent_id: int | None) -> list[dict]:
        return [serialize_marking(m, build(m.id)) for m in by_parent.get(parent_id, [])]

    return build(None)


def _normalize_staged_notes(raw_notes: Any) -> list[str]:
    bodies: list[str] = []
    if not raw_notes:
        return bodies
    for entry in raw_notes:
        if isinstance(entry, str):
            body = entry.strip()
        elif isinstance(entry, dict):
            body = str(entry.get("bodyText") or entry.get("body_text") or "").strip()
        else:
            body = ""
        if body:
            bodies.append(body)
    return bodies


def _normalize_staged_attachments(raw_atts: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not raw_atts:
        return out
    for att in raw_atts:
        if not isinstance(att, dict):
            continue
        kind = str(att.get("attachmentKind") or att.get("attachment_kind") or "Other")
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        out.append(
            {
                "attachment_kind": kind,
                "document_id": att.get("documentId") or att.get("document_id"),
                "storage_key": str(att.get("storageKey") or att.get("storage_key") or ""),
                "original_filename": str(
                    att.get("originalFilename") or att.get("original_filename") or ""
                ),
            }
        )
    return out


def _publish_staged_on_marking(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    marking: Marking,
    notes: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    client_ip: str = "",
) -> None:
    """Attach drafted comments/files to a newly created outbound marking."""
    for entry in notes:
        body = str(entry.get("body") or "").strip()
        if not body:
            continue
        db.add(
            CorrespondenceNote(
                letter_id=letter.id,
                marking_id=marking.id,
                author_user=actor_name,
                body_text=body,
                audience=normalize_audience(entry.get("audience")),
                for_user=str(entry.get("for_user") or "").strip(),
                is_response=False,
                client_ip=client_ip or "",
            )
        )
    for att in attachments:
        db.add(
            CorrespondenceAttachment(
                letter_id=letter.id,
                marking_id=marking.id,
                note_id=None,
                created_by=actor_name,
                document_id=att.get("document_id"),
                attachment_kind=att["attachment_kind"],
                audience=normalize_audience(att.get("audience")),
                for_user=str(att.get("for_user") or "").strip(),
                storage_key=att.get("storage_key") or "",
                original_filename=att.get("original_filename") or "",
                client_ip=client_ip or "",
            )
        )


_DRAFT_INTENTS = frozenset({"forward", "reply"})


def _normalize_draft_intent(raw: str | None) -> str:
    intent = (raw or "forward").strip().lower()
    if intent not in _DRAFT_INTENTS:
        raise HTTPException(status_code=400, detail="intent must be 'forward' or 'reply'")
    return intent


def serialize_draft_note(row: CorrespondenceDraftNote) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "authorUser": row.author_user,
        "targetUser": row.target_user or "",
        "intent": (row.intent or "forward").strip().lower() or "forward",
        "bodyText": row.body_text,
        "sendPrivately": bool(getattr(row, "send_privately", False)),
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def serialize_draft_attachment(row: CorrespondenceDraftAttachment) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "createdBy": row.created_by,
        "targetUser": row.target_user or "",
        "intent": (row.intent or "forward").strip().lower() or "forward",
        "documentId": row.document_id,
        "attachmentKind": row.attachment_kind,
        "storageKey": row.storage_key,
        "originalFilename": row.original_filename,
        "sendPrivately": bool(getattr(row, "send_privately", False)),
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def serialize_draft_recipient(row: CorrespondenceDraftRecipient) -> dict:
    return {
        "id": row.id,
        "letterId": str(row.letter_id),
        "authorUser": row.author_user,
        "toUser": row.to_user or "",
        "role": (row.role or "to").strip().lower() or "to",
        "action": (row.action or "forward").strip().lower() or "forward",
        "responseType": row.response_type or "",
        "responseTypeOther": row.response_type_other or "",
        "instructions": row.instructions or "",
        "dueAt": row.due_at.isoformat() if row.due_at else "",
        "priority": row.priority or "",
        "track": bool(row.track),
        "remindersEnabled": bool(row.reminders_enabled),
        "clientIp": row.client_ip or "",
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def list_drafts(db: Session, letter_id: int, actor_name: str) -> dict[str, Any]:
    """Draft comments/attachments/roster authored by the actor for Mark confirm."""
    name = (actor_name or "").strip()
    notes = (
        db.query(CorrespondenceDraftNote)
        .filter(
            CorrespondenceDraftNote.letter_id == letter_id,
            CorrespondenceDraftNote.author_user == name,
        )
        .order_by(CorrespondenceDraftNote.id.asc())
        .all()
    )
    atts = (
        db.query(CorrespondenceDraftAttachment)
        .filter(
            CorrespondenceDraftAttachment.letter_id == letter_id,
            CorrespondenceDraftAttachment.created_by == name,
        )
        .order_by(CorrespondenceDraftAttachment.id.asc())
        .all()
    )
    roster_rows = (
        db.query(CorrespondenceDraftRecipient)
        .filter(
            CorrespondenceDraftRecipient.letter_id == letter_id,
            CorrespondenceDraftRecipient.author_user == name,
        )
        .order_by(CorrespondenceDraftRecipient.id.asc())
        .all()
    )
    forward_targets: set[str] = set()
    reply_targets: set[str] = set()
    for n in notes:
        t = (n.target_user or "").strip()
        intent = (n.intent or "forward").strip().lower() or "forward"
        if t and intent == "reply":
            reply_targets.add(t)
        elif t:
            forward_targets.add(t)
    for a in atts:
        t = (a.target_user or "").strip()
        intent = (a.intent or "forward").strip().lower() or "forward"
        if t and intent == "reply":
            reply_targets.add(t)
        elif t:
            forward_targets.add(t)
    for r in roster_rows:
        t = (r.to_user or "").strip()
        if t:
            forward_targets.add(t)
    has_reply = any(
        ((n.intent or "forward").strip().lower() or "forward") == "reply" for n in notes
    ) or any(
        ((a.intent or "forward").strip().lower() or "forward") == "reply" for a in atts
    )
    has_forward = (
        bool(roster_rows)
        or any(
            ((n.intent or "forward").strip().lower() or "forward") == "forward" for n in notes
        )
        or any(
            ((a.intent or "forward").strip().lower() or "forward") == "forward" for a in atts
        )
    )
    targets = forward_targets | reply_targets
    return {
        "notes": [serialize_draft_note(n) for n in notes],
        "attachments": [serialize_draft_attachment(a) for a in atts],
        "roster": [serialize_draft_recipient(r) for r in roster_rows],
        "targetUsers": sorted(targets),
        "forwardTargetUsers": sorted(forward_targets),
        "replyTargetUsers": sorted(reply_targets),
        "hasForwardDrafts": has_forward,
        "hasReplyDrafts": has_reply,
        "commonNoteCount": sum(
            1
            for n in notes
            if not (n.target_user or "").strip()
            and ((n.intent or "forward").strip().lower() or "forward") == "forward"
        ),
        "commonAttachmentCount": sum(
            1
            for a in atts
            if not (a.target_user or "").strip()
            and ((a.intent or "forward").strip().lower() or "forward") == "forward"
        ),
    }


def replace_draft_roster(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    recipients: list[dict[str, Any]],
    client_ip: str = "",
) -> list[CorrespondenceDraftRecipient]:
    """Replace the actor's draft roster for a letter (To + Info)."""
    assert_can_mutate(db, letter, actor_name)
    name = (actor_name or "").strip()
    existing = list_drafts(db, letter.id, name)
    if existing["hasReplyDrafts"]:
        raise HTTPException(
            status_code=400,
            detail="Delete reply drafts before updating the mark roster",
        )

    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for raw in recipients:
        to_user = str(raw.get("toUser") or raw.get("to_user") or "").strip()
        if not to_user:
            raise HTTPException(status_code=400, detail="Each roster entry requires toUser")
        if to_user == name:
            raise HTTPException(status_code=400, detail="Cannot mark to yourself")
        if not _user_by_name(db, to_user):
            raise HTTPException(status_code=400, detail=f"Unknown user '{to_user}'")
        key = to_user.lower()
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate recipient '{to_user}'")
        seen.add(key)

        role = str(raw.get("role") or "to").strip().lower() or "to"
        if role not in {"to", "info"}:
            raise HTTPException(status_code=400, detail="role must be 'to' or 'info'")

        if role == "info":
            action = "for_info"
        else:
            action = str(raw.get("action") or "forward").strip().lower() or "forward"
            if action not in MARKING_ACTIONS:
                raise HTTPException(status_code=400, detail=f"Invalid action '{action}'")
            if action == "for_info":
                # Info-only users belong in the Info field, not To.
                role = "info"

        response_type = str(raw.get("responseType") or raw.get("response_type") or "").strip()
        response_type_other = str(
            raw.get("responseTypeOther") or raw.get("response_type_other") or ""
        ).strip()
        due_raw = raw.get("dueAt") if "dueAt" in raw else raw.get("due_at")
        due_at: date | None = None
        if due_raw:
            if isinstance(due_raw, date) and not isinstance(due_raw, datetime):
                due_at = due_raw
            else:
                try:
                    due_at = date.fromisoformat(str(due_raw)[:10])
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail="Invalid dueAt") from exc

        if action == "response_required" and not response_type:
            raise HTTPException(
                status_code=400,
                detail=f"responseType is required for Response Required ({to_user})",
            )

        normalized.append(
            {
                "to_user": to_user,
                "role": role,
                "action": action,
                "response_type": response_type,
                "response_type_other": response_type_other,
                "instructions": str(raw.get("instructions") or "").strip(),
                "due_at": due_at,
                "priority": str(raw.get("priority") or "").strip(),
                "track": bool(raw.get("track", True)),
                "reminders_enabled": bool(
                    raw.get("remindersEnabled", raw.get("reminders_enabled", True))
                ),
            }
        )

    db.query(CorrespondenceDraftRecipient).filter(
        CorrespondenceDraftRecipient.letter_id == letter.id,
        CorrespondenceDraftRecipient.author_user == name,
    ).delete(synchronize_session=False)

    created: list[CorrespondenceDraftRecipient] = []
    for item in normalized:
        row = CorrespondenceDraftRecipient(
            letter_id=letter.id,
            author_user=name,
            to_user=item["to_user"],
            role=item["role"],
            action=item["action"],
            response_type=item["response_type"],
            response_type_other=item["response_type_other"],
            instructions=item["instructions"],
            due_at=item["due_at"],
            priority=item["priority"],
            track=item["track"],
            reminders_enabled=item["reminders_enabled"],
            client_ip=client_ip or "",
        )
        db.add(row)
        created.append(row)
    db.flush()
    return created


def _draft_privacy_for_target(
    db: Session,
    *,
    letter_id: int,
    actor_name: str,
    target_user: str,
    fallback: bool = False,
) -> bool:
    """Reuse existing Send Privately flag for this To target, else fallback."""
    target = (target_user or "").strip()
    if not target:
        return False
    note = (
        db.query(CorrespondenceDraftNote)
        .filter(
            CorrespondenceDraftNote.letter_id == letter_id,
            CorrespondenceDraftNote.author_user == actor_name,
            CorrespondenceDraftNote.target_user == target,
        )
        .order_by(CorrespondenceDraftNote.id.desc())
        .first()
    )
    if note is not None:
        return bool(getattr(note, "send_privately", False))
    att = (
        db.query(CorrespondenceDraftAttachment)
        .filter(
            CorrespondenceDraftAttachment.letter_id == letter_id,
            CorrespondenceDraftAttachment.created_by == actor_name,
            CorrespondenceDraftAttachment.target_user == target,
        )
        .order_by(CorrespondenceDraftAttachment.id.desc())
        .first()
    )
    if att is not None:
        return bool(getattr(att, "send_privately", False))
    return bool(fallback)


def add_draft_note(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    body_text: str,
    target_user: str,
    intent: str = "forward",
    send_privately: bool | None = None,
    client_ip: str = "",
) -> CorrespondenceDraftNote:
    assert_can_mutate(db, letter, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")
    draft_intent = _normalize_draft_intent(intent)
    target = (target_user or "").strip()
    if draft_intent == "reply" and not target:
        raise HTTPException(status_code=400, detail="Reply drafts require a targetUser")
    if target and not _user_by_name(db, target):
        raise HTTPException(status_code=400, detail=f"Unknown user '{target}'")
    if target == actor_name:
        raise HTTPException(status_code=400, detail="Cannot draft for yourself")
    # Reply and forward drafts cannot be mixed for the same letter/author.
    existing = list_drafts(db, letter.id, actor_name)
    if draft_intent == "reply" and existing["hasForwardDrafts"]:
        raise HTTPException(
            status_code=400,
            detail="Delete forwarding drafts before adding a reply draft",
        )
    if draft_intent == "forward" and existing["hasReplyDrafts"]:
        raise HTTPException(
            status_code=400,
            detail="Delete reply drafts before adding a forwarding draft",
        )
    private = False
    if target:
        private = (
            bool(send_privately)
            if send_privately is not None
            else _draft_privacy_for_target(
                db, letter_id=letter.id, actor_name=actor_name, target_user=target
            )
        )
    row = CorrespondenceDraftNote(
        letter_id=letter.id,
        author_user=actor_name,
        target_user=target,
        intent=draft_intent,
        body_text=body,
        send_privately=private,
        client_ip=client_ip or "",
    )
    db.add(row)
    db.flush()
    return row


def add_draft_attachments(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    target_user: str,
    attachments: list[dict],
    intent: str = "forward",
    send_privately: bool | None = None,
    client_ip: str = "",
) -> list[CorrespondenceDraftAttachment]:
    assert_can_mutate(db, letter, actor_name)
    draft_intent = _normalize_draft_intent(intent)
    target = (target_user or "").strip()
    if draft_intent == "reply" and not target:
        raise HTTPException(status_code=400, detail="Reply drafts require a targetUser")
    if target and not _user_by_name(db, target):
        raise HTTPException(status_code=400, detail=f"Unknown user '{target}'")
    if target == actor_name:
        raise HTTPException(status_code=400, detail="Cannot draft for yourself")
    if not attachments:
        raise HTTPException(status_code=400, detail="At least one attachment is required")
    existing = list_drafts(db, letter.id, actor_name)
    if draft_intent == "reply" and existing["hasForwardDrafts"]:
        raise HTTPException(
            status_code=400,
            detail="Delete forwarding drafts before adding a reply draft",
        )
    if draft_intent == "forward" and existing["hasReplyDrafts"]:
        raise HTTPException(
            status_code=400,
            detail="Delete reply drafts before adding a forwarding draft",
        )
    private = False
    if target:
        private = (
            bool(send_privately)
            if send_privately is not None
            else _draft_privacy_for_target(
                db, letter_id=letter.id, actor_name=actor_name, target_user=target
            )
        )
    created: list[CorrespondenceDraftAttachment] = []
    for att in _normalize_staged_attachments(attachments):
        row = CorrespondenceDraftAttachment(
            letter_id=letter.id,
            created_by=actor_name,
            target_user=target,
            intent=draft_intent,
            document_id=att.get("document_id"),
            attachment_kind=att["attachment_kind"],
            storage_key=att.get("storage_key") or "",
            original_filename=att.get("original_filename") or "",
            send_privately=private,
            client_ip=client_ip or "",
        )
        db.add(row)
        created.append(row)
    db.flush()
    return created


def set_draft_target_privacy(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    target_user: str,
    send_privately: bool,
) -> None:
    """Set Send Privately on all To-targeted draft notes/attachments for this user."""
    assert_can_mutate(db, letter, actor_name)
    target = (target_user or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="targetUser is required")
    private = bool(send_privately)
    notes = (
        db.query(CorrespondenceDraftNote)
        .filter(
            CorrespondenceDraftNote.letter_id == letter.id,
            CorrespondenceDraftNote.author_user == actor_name,
            CorrespondenceDraftNote.target_user == target,
        )
        .all()
    )
    for n in notes:
        n.send_privately = private
    atts = (
        db.query(CorrespondenceDraftAttachment)
        .filter(
            CorrespondenceDraftAttachment.letter_id == letter.id,
            CorrespondenceDraftAttachment.created_by == actor_name,
            CorrespondenceDraftAttachment.target_user == target,
        )
        .all()
    )
    for a in atts:
        a.send_privately = private
    db.flush()


def update_draft_note(
    db: Session,
    *,
    note: CorrespondenceDraftNote,
    actor_name: str,
    body_text: str,
) -> CorrespondenceDraftNote:
    if note.author_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the author can edit this draft")
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")
    note.body_text = body
    db.flush()
    return note


def delete_draft_note(db: Session, *, note: CorrespondenceDraftNote, actor_name: str) -> None:
    if note.author_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the author can delete this draft")
    db.delete(note)
    db.flush()


def delete_draft_attachment(
    db: Session, *, attachment: CorrespondenceDraftAttachment, actor_name: str
) -> None:
    if attachment.created_by != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the author can delete this draft")
    db.delete(attachment)
    db.flush()


def create_mark_batch(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    recipients: list[dict[str, Any]],
    remarks: str = "",
    pathway_notify: bool = False,
    parent_marking_id: int | None = None,
    client_ip: str = "",
    direction: str = "forward",
    common_notes: list[Any] | None = None,
    common_attachments: list[Any] | None = None,
    consume_drafts: bool = False,
) -> MarkingBatch:
    assert_can_mutate(db, letter, actor_name)
    if letter.status not in {CLOSED_LETTER, ARCHIVED_LETTER} and letter.status != OPEN_LETTER:
        # Normalize in-place for new activity
        if letter.status not in {OPEN_LETTER}:
            letter.status = OPEN_LETTER

    direction = (direction or "forward").strip().lower()
    if direction not in MARKING_DIRECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid direction '{direction}'")

    if not recipients:
        raise HTTPException(status_code=400, detail="At least one recipient is required")

    parent: Marking | None = None
    if parent_marking_id is not None:
        parent = db.get(Marking, parent_marking_id)
        if not parent or parent.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid parentMarkingId")
        if marking_has_children(db, parent.id):
            raise HTTPException(status_code=400, detail="Parent marking was already remade onward")
        # Normal hold: active inbound addressed to actor.
        inbound_ok = parent.status == "active" and (
            parent.to_user == actor_name or _is_admin(db, actor_name)
        )
        # After RR response: marker remakes under their own responded marking.
        returned_ok = (
            parent.status == "responded"
            and parent.action == "response_required"
            and parent.from_user == actor_name
        )
        if not inbound_ok and not returned_ok:
            if parent.status not in {"active", "responded"}:
                raise HTTPException(status_code=400, detail="Parent marking is not active")
            raise HTTPException(status_code=403, detail="Parent marking is not addressed to you")
    else:
        # Auto-link to the sole hold (inbound leaf or returned RR).
        leaves = leaf_inbound_markings(db, letter.id, actor_name)
        returned = response_returned_markings(db, letter.id, actor_name)
        holds = [*leaves, *returned]
        if len(holds) == 1:
            parent = holds[0]
        elif len(holds) > 1:
            raise HTTPException(
                status_code=400,
                detail="parentMarkingId is required when you hold multiple active markings",
            )

    if direction == "reply":
        if not parent:
            raise HTTPException(
                status_code=400,
                detail="Reply requires an inbound marking; initiator root cannot reply",
            )
        if len(recipients) != 1:
            raise HTTPException(status_code=400, detail="Reply allows exactly one recipient")
        # Inbound hold → previous marker; returned RR → person who submitted the response.
        if parent.status == "responded" and parent.from_user == actor_name:
            reply_to = (parent.to_user or "").strip()
        else:
            reply_to = (parent.from_user or "").strip()
        if not reply_to:
            raise HTTPException(status_code=400, detail="Cannot determine reply recipient")
        forced = dict(recipients[0])
        forced["toUser"] = reply_to
        forced["to_user"] = reply_to
        recipients = [forced]

    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for raw in recipients:
        to_user = str(raw.get("toUser") or raw.get("to_user") or "").strip()
        action = str(raw.get("action") or "forward").strip()
        if not to_user:
            raise HTTPException(status_code=400, detail="toUser is required")
        if to_user == actor_name:
            raise HTTPException(status_code=400, detail="Cannot mark correspondence to yourself")
        if to_user in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate recipient '{to_user}' in batch")
        seen.add(to_user)
        if not _user_by_name(db, to_user):
            raise HTTPException(status_code=400, detail=f"Unknown user '{to_user}'")
        if action not in MARKING_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Invalid action '{action}'")

        response_type = str(raw.get("responseType") or raw.get("response_type") or "").strip()
        response_type_other = str(
            raw.get("responseTypeOther") or raw.get("response_type_other") or ""
        ).strip()
        if action == "response_required":
            if response_type not in RESPONSE_TYPES:
                raise HTTPException(status_code=400, detail="responseType required for Response Required")
            if response_type == "other" and not response_type_other:
                raise HTTPException(status_code=400, detail="responseTypeOther required when type is other")

        due_raw = raw.get("dueAt") or raw.get("due_at")
        due_at: date | None = None
        if due_raw:
            due_at = date.fromisoformat(str(due_raw)[:10])
        elif action == "response_required":
            due_at = None

        track = bool(raw.get("track", True))
        reminders_enabled = bool(
            raw.get("remindersEnabled", raw.get("reminders_enabled", action == "response_required" and track))
        )
        if action != "response_required":
            reminders_enabled = False
            response_type = ""
            response_type_other = ""

        # Outstanding leaf mark to this user: non-admin must revoke first;
        # admin may update action / response type in place (no duplicate row).
        outstanding = (
            db.query(Marking)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.to_user == to_user,
                Marking.status == "active",
            )
            .all()
        )
        existing_leaf = next(
            (m for m in outstanding if not marking_has_children(db, m.id)),
            None,
        )
        update_id: int | None = None
        if existing_leaf is not None:
            if not _is_admin(db, actor_name):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Active marking already exists from you to '{to_user}'. "
                        "Revoke it before forwarding again or changing action / response type."
                    ),
                )
            update_id = existing_leaf.id

        normalized.append(
            {
                "to_user": to_user,
                "action": action,
                "response_type": response_type,
                "response_type_other": response_type_other,
                "instructions": str(raw.get("instructions") or "").strip(),
                "due_at": due_at,
                "priority": str(raw.get("priority") or letter.priority or "Routine"),
                "track": track,
                "reminders_enabled": reminders_enabled,
                "notes": _normalize_staged_notes(raw.get("notes")),
                "attachments": _normalize_staged_attachments(raw.get("attachments")),
                "update_id": update_id,
            }
        )

    shared_notes = _normalize_staged_notes(common_notes)
    shared_attachments = _normalize_staged_attachments(common_attachments)

    draft_note_rows: list[CorrespondenceDraftNote] = []
    draft_att_rows: list[CorrespondenceDraftAttachment] = []
    # Target-specific drafts: {target: [{body/att fields, audience, for_user}, ...]}
    draft_notes_by_target: dict[str, list[dict[str, Any]]] = {}
    draft_atts_by_target: dict[str, list[dict[str, Any]]] = {}
    draft_common_notes: list[str] = []
    draft_common_atts: list[dict[str, Any]] = []
    if consume_drafts:
        draft_intent = "reply" if direction == "reply" else "forward"
        all_draft_notes = (
            db.query(CorrespondenceDraftNote)
            .filter(
                CorrespondenceDraftNote.letter_id == letter.id,
                CorrespondenceDraftNote.author_user == actor_name,
            )
            .order_by(CorrespondenceDraftNote.id.asc())
            .all()
        )
        all_draft_atts = (
            db.query(CorrespondenceDraftAttachment)
            .filter(
                CorrespondenceDraftAttachment.letter_id == letter.id,
                CorrespondenceDraftAttachment.created_by == actor_name,
            )
            .order_by(CorrespondenceDraftAttachment.id.asc())
            .all()
        )
        other_intent = "forward" if draft_intent == "reply" else "reply"
        if any(
            ((n.intent or "forward").strip().lower() or "forward") == other_intent
            for n in all_draft_notes
        ) or any(
            ((a.intent or "forward").strip().lower() or "forward") == other_intent
            for a in all_draft_atts
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot {draft_intent} while {other_intent} drafts exist. "
                    f"Delete all {other_intent} drafts first."
                ),
            )
        draft_note_rows = [
            n
            for n in all_draft_notes
            if ((n.intent or "forward").strip().lower() or "forward") == draft_intent
        ]
        draft_att_rows = [
            a
            for a in all_draft_atts
            if ((a.intent or "forward").strip().lower() or "forward") == draft_intent
        ]
        for n in draft_note_rows:
            body = (n.body_text or "").strip()
            if not body:
                continue
            target = (n.target_user or "").strip()
            if not target:
                if draft_intent == "forward":
                    draft_common_notes.append(body)
            else:
                private = bool(getattr(n, "send_privately", False))
                draft_notes_by_target.setdefault(target, []).append(
                    {
                        "body": body,
                        "audience": AUDIENCE_RECIPIENT if private else AUDIENCE_ALL,
                        "for_user": target,
                    }
                )
        for a in draft_att_rows:
            payload = {
                "attachment_kind": a.attachment_kind,
                "document_id": a.document_id,
                "storage_key": a.storage_key or "",
                "original_filename": a.original_filename or "",
            }
            target = (a.target_user or "").strip()
            if not target:
                if draft_intent == "forward":
                    draft_common_atts.append(payload)
            else:
                private = bool(getattr(a, "send_privately", False))
                draft_atts_by_target.setdefault(target, []).append(
                    {
                        **payload,
                        "audience": AUDIENCE_RECIPIENT if private else AUDIENCE_ALL,
                        "for_user": target,
                    }
                )

        # Composer may Mark with roster-only recipients (optional personal/common content).
        # Personal drafts are no longer required per recipient when consumeDrafts is set.

    to_create = [item for item in normalized if not item.get("update_id")]
    to_update = [item for item in normalized if item.get("update_id")]
    fan_out = len(to_create) > 1
    created: list[Marking] = []
    updated: list[Marking] = []

    for item in to_update:
        marking = db.get(Marking, int(item["update_id"]))
        if not marking or marking.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid marking to update")
        marking.action = item["action"]
        marking.response_type = item["response_type"]
        marking.response_type_other = item["response_type_other"]
        marking.instructions = item["instructions"]
        marking.due_at = item["due_at"]
        marking.priority = item["priority"]
        marking.track = item["track"]
        marking.reminders_enabled = item["reminders_enabled"]
        updated.append(marking)

    actor = _user_by_name(db, actor_name)
    batch: MarkingBatch | None = None
    if to_create:
        batch = MarkingBatch(
            letter_id=letter.id,
            from_user=actor_name,
            from_user_id=actor.id if actor else None,
            remarks=(remarks or "").strip(),
            pathway_notify=bool(pathway_notify),
            client_ip=client_ip or "",
        )
        db.add(batch)
        db.flush()
        if pathway_notify:
            db.add(
                MarkingSubscription(
                    letter_id=letter.id,
                    batch_id=batch.id,
                    user_name=actor_name,
                    active=True,
                )
            )
    elif updated:
        # Admin in-place edit: reuse the existing batch for the API response.
        batch = db.get(MarkingBatch, updated[0].batch_id)

    if batch is None:
        raise HTTPException(status_code=400, detail="No recipients to forward")

    for item in to_create:
        marking = Marking(
            batch_id=batch.id,
            letter_id=letter.id,
            parent_marking_id=parent.id if parent else None,
            path_id=assign_path_id(parent=parent, fan_out=fan_out, direction=direction),
            direction=direction,
            from_user=actor_name,
            to_user=item["to_user"],
            action=item["action"],
            response_type=item["response_type"],
            response_type_other=item["response_type_other"],
            instructions=item["instructions"],
            due_at=item["due_at"],
            priority=item["priority"],
            track=item["track"],
            reminders_enabled=item["reminders_enabled"],
            status="active",
            client_ip=client_ip or "",
        )
        db.add(marking)
        created.append(marking)
    db.flush()

    publish_pairs: list[tuple[Marking, dict[str, Any]]] = [
        *[(m, item) for m, item in zip(updated, to_update)],
        *[(m, item) for m, item in zip(created, to_create)],
    ]
    for marking, item in publish_pairs:
        target = marking.to_user
        _publish_staged_on_marking(
            db,
            letter=letter,
            actor_name=actor_name,
            marking=marking,
            notes=[
                *[
                    {"body": b, "audience": AUDIENCE_RECIPIENT, "for_user": target}
                    for b in item["notes"]
                ],
                *[{"body": b, "audience": AUDIENCE_ALL, "for_user": ""} for b in shared_notes],
                *draft_notes_by_target.get(target, []),
                *[
                    {"body": b, "audience": AUDIENCE_ALL, "for_user": ""}
                    for b in draft_common_notes
                ],
            ],
            attachments=[
                *[{**a, "audience": AUDIENCE_RECIPIENT, "for_user": target} for a in item["attachments"]],
                *[{**a, "audience": AUDIENCE_ALL, "for_user": ""} for a in shared_attachments],
                *draft_atts_by_target.get(target, []),
                *[{**a, "audience": AUDIENCE_ALL, "for_user": ""} for a in draft_common_atts],
            ],
            client_ip=client_ip or "",
        )

    affected = [*created, *updated]
    if consume_drafts and affected:
        consumed_targets = {m.to_user for m in affected}
        for n in draft_note_rows:
            target = (n.target_user or "").strip()
            if not target or target in consumed_targets:
                db.delete(n)
        for a in draft_att_rows:
            target = (a.target_user or "").strip()
            if not target or target in consumed_targets:
                db.delete(a)
        roster_rows = (
            db.query(CorrespondenceDraftRecipient)
            .filter(
                CorrespondenceDraftRecipient.letter_id == letter.id,
                CorrespondenceDraftRecipient.author_user == (actor_name or "").strip(),
            )
            .all()
        )
        for r in roster_rows:
            target = (r.to_user or "").strip()
            if not target or target in consumed_targets:
                db.delete(r)

    db.flush()

    if not affected:
        raise HTTPException(status_code=400, detail="No recipients to forward")

    primary = _pick_primary_marking(affected) or affected[0]
    letter.status = OPEN_LETTER
    sync_letter_from_markings(db, letter, last_action=_mark_last_action(primary))

    verb = "replied to you" if direction == "reply" else "marked to you"
    notif_type = "Correspondence Reply" if direction == "reply" else "Correspondence Marked"
    for marking in created:
        add_notification(
            db,
            title=notif_type,
            description=(
                f"{letter.number}: {verb} ({marking.action.replace('_', ' ')}) by {actor_name}."
            ),
            priority=marking.priority or "Medium",
            letter_id=letter.id,
            notification_type=notif_type,
            recipient_name=marking.to_user,
            related_entity_type="marking",
            related_entity_id=str(marking.id),
        )
    for marking in updated:
        add_notification(
            db,
            title="Marking Updated",
            description=(
                f"{letter.number}: marking updated to {marking.action.replace('_', ' ')} "
                f"by {actor_name}."
            ),
            priority=marking.priority or "Medium",
            letter_id=letter.id,
            notification_type="Marking Updated",
            recipient_name=marking.to_user,
            related_entity_type="marking",
            related_entity_id=str(marking.id),
        )

    if created:
        path_note = (
            f" ({len({m.path_id for m in created})} path(s))"
            if fan_out
            else f" (path {(created[0].path_id or '')[:8]})"
        )
        _notify_pathway(
            db,
            letter=letter,
            actor_name=actor_name,
            title="Pathway Update",
            description=(
                f"{letter.number}: {actor_name} "
                f"{'replied to' if direction == 'reply' else 'forwarded to'} "
                f"{len(created)} recipient(s){path_note}."
            ),
            skip_user=actor_name,
        )

    parts: list[str] = []
    if created:
        parts.append(
            f"{'Replied to' if direction == 'reply' else 'Forwarded to'} "
            f"{len(created)} recipient(s)"
        )
    if updated:
        parts.append(f"Updated {len(updated)} existing marking(s)")
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Reply" if direction == "reply" else ("Update Marking" if not created else "Forward"),
        record=letter.number,
        description="; ".join(parts),
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return batch


def revoke_marking(
    db: Session,
    *,
    marking: Marking,
    actor_name: str,
    remarks: str = "",
    client_ip: str = "",
) -> Marking:
    letter = db.get(Letter, marking.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is closed")
    if marking.from_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the marker can revoke")
    if marking.status == "responded":
        raise HTTPException(
            status_code=409,
            detail="Cannot revoke: recipient has already submitted a response",
        )
    if marking.status != "active":
        raise HTTPException(status_code=400, detail="Marking is not active")
    if marking_has_children(db, marking.id):
        raise HTTPException(
            status_code=409,
            detail="Cannot revoke: recipient has already marked this correspondence onward",
        )
    if marking_recipient_has_activity(db, marking):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot revoke: recipient has already added comments, attachments, "
                "or edited files on this marking"
            ),
        )

    marking.status = "revoked"
    marking.revoked_at = datetime.now()
    marking.revoked_by = actor_name
    marking.revoke_ip = client_ip or ""
    # Drop from Track / workflow history — revoke is not a logged tracking event.
    marking.track = False
    db.flush()

    # Restore assignment from remaining live markings; do not publish "Revoked …" as last_action.
    derived = derive_last_action_from_markings(db, letter)
    sync_letter_from_markings(db, letter, last_action=derived or "Registered")

    add_notification(
        db,
        title="Marking Revoked",
        description=f"{letter.number}: a marking to you was revoked by {actor_name}."
        + (f" {remarks}" if remarks else ""),
        priority="Medium",
        letter_id=letter.id,
        notification_type="Marking Revoked",
        recipient_name=marking.to_user,
        related_entity_type="marking",
        related_entity_id=str(marking.id),
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Revoke",
        record=letter.number,
        description=remarks or f"Revoked marking #{marking.id} to {marking.to_user}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return marking


def resolve_hold_marking_id(
    db: Session,
    letter: Letter,
    actor_name: str,
    marking_id: int | None = None,
) -> int | None:
    """Marking incident for the actor's current hold (None = initiator root)."""
    if marking_id is not None:
        marking = db.get(Marking, marking_id)
        if not marking or marking.letter_id != letter.id:
            raise HTTPException(status_code=400, detail="Invalid markingId")
        inbound_ok = marking.to_user == actor_name and marking.status == "active"
        returned_ok = (
            marking.from_user == actor_name
            and marking.action == "response_required"
            and marking.status == "responded"
        )
        if not inbound_ok and not returned_ok and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Marking is not addressed to you")
        if marking_has_children(db, marking.id) and not _is_admin(db, actor_name):
            raise HTTPException(status_code=400, detail="Marking was already remade onward")
        return marking.id
    leaves = leaf_inbound_markings(db, letter.id, actor_name)
    returned = response_returned_markings(db, letter.id, actor_name)
    holds = [*leaves, *returned]
    if len(holds) == 1:
        return holds[0].id
    if len(holds) > 1:
        raise HTTPException(
            status_code=400,
            detail="markingId is required when you hold multiple active markings",
        )
    if is_initiator(letter, actor_name) and not has_active_markings(db, letter.id):
        return None
    if _is_admin(db, actor_name):
        return None
    raise HTTPException(status_code=403, detail="You do not currently hold this correspondence")


def add_note(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    body_text: str,
    marking_id: int | None = None,
    is_response: bool = False,
    client_ip: str = "",
) -> CorrespondenceNote:
    assert_can_mutate(db, letter, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")

    resolved_marking_id = resolve_hold_marking_id(db, letter, actor_name, marking_id)
    marking = db.get(Marking, resolved_marking_id) if resolved_marking_id else None

    if is_response:
        if not marking:
            raise HTTPException(status_code=400, detail="markingId required when submitting a response")
        if marking.action != "response_required" or marking.status != "active":
            raise HTTPException(status_code=400, detail="Marking is not an open Response Required")
        if marking.to_user != actor_name and not _is_admin(db, actor_name):
            raise HTTPException(status_code=403, detail="Only the assignee can submit this response")

    note = CorrespondenceNote(
        letter_id=letter.id,
        marking_id=resolved_marking_id,
        author_user=actor_name,
        body_text=body,
        # Hold notes stay hop-private unless staged as Common drafts on Forward.
        audience=AUDIENCE_RECIPIENT,
        is_response=bool(is_response),
        client_ip=client_ip or "",
    )
    db.add(note)
    db.flush()

    if is_response and marking:
        marking.status = "responded"
        marking.responded_at = datetime.now()
        marking.response_note_id = note.id
        db.flush()
        sync_letter_from_markings(db, letter, last_action="Responded")
        add_notification(
            db,
            title="Response Received",
            description=f"{letter.number}: {actor_name} submitted a response.",
            priority="High",
            letter_id=letter.id,
            notification_type="Response Received",
            recipient_name=marking.from_user,
            related_entity_type="marking",
            related_entity_id=str(marking.id),
        )

    _notify_pathway(
        db,
        letter=letter,
        actor_name=actor_name,
        title="Pathway Update",
        description=f"{letter.number}: note added by {actor_name}.",
        skip_user=actor_name,
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Note" if not is_response else "Respond",
        record=letter.number,
        description=body[:200],
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return note


def _record_attachment_event(
    db: Session,
    *,
    letter_id: int,
    marking_id: int | None,
    attachment: CorrespondenceAttachment,
    event_type: str,
    actor_user: str,
    version_id: int | None = None,
    client_ip: str = "",
) -> CorrespondenceAttachmentEvent:
    event = CorrespondenceAttachmentEvent(
        letter_id=letter_id,
        marking_id=marking_id,
        attachment_id=attachment.id,
        event_type=event_type,
        actor_user=actor_user,
        document_id=attachment.document_id,
        version_id=version_id,
        original_filename=attachment.original_filename or "",
        storage_key=attachment.storage_key or "",
        attachment_kind=attachment.attachment_kind or "Other",
        client_ip=client_ip or "",
    )
    db.add(event)
    db.flush()
    return event


def _attachment_for_user(db: Session, row: CorrespondenceAttachment) -> str:
    for_user = (getattr(row, "for_user", None) or "").strip()
    if for_user:
        return for_user
    if normalize_audience(getattr(row, "audience", None)) == AUDIENCE_RECIPIENT and row.marking_id:
        marking = db.get(Marking, int(row.marking_id))
        if marking is not None:
            return (marking.to_user or "").strip()
    return ""


def serialize_attachment(db: Session, row: CorrespondenceAttachment, *, editable: bool = False) -> dict:
    version_id: int | None = getattr(row, "current_version_id", None)
    previewable = False
    mime_type = ""
    filename = row.original_filename or ""
    if row.document_id:
        current = (
            db.query(DocumentVersion)
            .filter(
                DocumentVersion.document_id == row.document_id,
                DocumentVersion.is_current.is_(True),
            )
            .order_by(DocumentVersion.id.desc())
            .first()
        )
        if not current:
            current = (
                db.query(DocumentVersion)
                .filter(DocumentVersion.document_id == row.document_id)
                .order_by(DocumentVersion.id.desc())
                .first()
            )
        if current:
            version_id = current.id
            previewable = can_preview(current.file_type or "")
            mime_type = current.mime_type or ""
            filename = filename or current.original_filename or ""
    batch_id: int | None = None
    if row.marking_id is not None:
        linked = db.get(Marking, int(row.marking_id))
        if linked is not None:
            batch_id = linked.batch_id
    return {
        "id": row.id,
        "letterId": str(row.letter_id) if row.letter_id else "",
        "markingId": row.marking_id,
        "batchId": batch_id,
        "createdBy": row.created_by,
        "documentId": row.document_id,
        "versionId": version_id,
        "previewable": previewable,
        "mimeType": mime_type,
        "attachmentKind": row.attachment_kind,
        "audience": normalize_audience(getattr(row, "audience", None)),
        "forUser": _attachment_for_user(db, row),
        "storageKey": row.storage_key,
        "originalFilename": filename,
        "clientIp": row.client_ip,
        "createdAt": row.created_at.isoformat() if row.created_at else "",
        "editable": editable,
        "deleted": bool(getattr(row, "deleted_at", None)),
        "deletedAt": row.deleted_at.isoformat() if getattr(row, "deleted_at", None) else "",
        "deletedBy": getattr(row, "deleted_by", "") or "",
    }


def _belongs_to_current_hold(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    marking_id: int | None,
) -> bool:
    """True if this note/attachment is on the actor's current leaf hold (not a prior mark)."""
    leaves = leaf_inbound_markings(db, letter.id, actor_name)
    leaf_ids = {m.id for m in leaves}
    if marking_id is not None:
        return marking_id in leaf_ids
    # Initiator root (no marking yet): only while initiator still holds with no active marks.
    return is_initiator(letter, actor_name) and not has_active_markings(db, letter.id)


def note_is_editable(db: Session, note: CorrespondenceNote, actor_name: str) -> bool:
    """Author may edit/delete only notes from their *current* marking hold.

    If the letter is marked to them again later, older notes from a previous hold stay locked.
    """
    if _is_viewer(db, actor_name):
        return False
    letter = db.get(Letter, note.letter_id)
    if not letter or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER} or letter.is_archived:
        return False
    if _is_admin(db, actor_name):
        return True
    if note.author_user != actor_name:
        return False
    return _belongs_to_current_hold(
        db, letter=letter, actor_name=actor_name, marking_id=note.marking_id
    )


def attachment_is_editable(
    db: Session, attachment: CorrespondenceAttachment, actor_name: str
) -> bool:
    """Current hold owner (or admin) may edit/delete attachments on that hold.

    Seniors can replace/remove a junior's file on the marking they currently hold;
    soft-delete + attachment events keep the junior's submission in the archive.
    """
    if _is_viewer(db, actor_name):
        return False
    letter = db.get(Letter, attachment.letter_id)
    if not letter or letter.status in {CLOSED_LETTER, ARCHIVED_LETTER} or letter.is_archived:
        return False
    if getattr(attachment, "deleted_at", None):
        return False
    if _is_admin(db, actor_name):
        return True
    return _belongs_to_current_hold(
        db, letter=letter, actor_name=actor_name, marking_id=attachment.marking_id
    )


def assert_note_editable(db: Session, note: CorrespondenceNote, actor_name: str) -> Letter:
    letter = db.get(Letter, note.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if not note_is_editable(db, note, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Only notes from your current hold can be edited or deleted",
        )
    return letter


def assert_attachment_editable(
    db: Session, attachment: CorrespondenceAttachment, actor_name: str
) -> Letter:
    letter = db.get(Letter, attachment.letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found")
    if not attachment_is_editable(db, attachment, actor_name):
        raise HTTPException(
            status_code=403,
            detail="Only attachments from your current hold can be edited or deleted",
        )
    return letter


def list_notes(db: Session, letter_id: int, actor_name: str | None = None) -> list[dict]:
    notes = (
        db.query(CorrespondenceNote)
        .filter(CorrespondenceNote.letter_id == letter_id)
        .order_by(CorrespondenceNote.id.desc())
        .all()
    )
    letter = db.get(Letter, letter_id)
    visible_paths: set[str] | None = None
    if actor_name:
        visible_paths = path_ids_visible_to_user(db, letter_id, actor_name)

    marking_cache: dict[int, Marking | None] = {}
    out: list[dict] = []
    for note in notes:
        if note.marking_id is not None:
            mid = int(note.marking_id)
            if mid not in marking_cache:
                marking_cache[mid] = db.get(Marking, mid)
            linked = marking_cache[mid]
            if linked is not None and linked.status == "revoked":
                continue
            if actor_name and not marking_content_visible_to_actor(
                db,
                linked,
                actor_name,
                visible_paths=visible_paths,
                audience=normalize_audience(getattr(note, "audience", None)),
            ):
                continue
        elif actor_name and visible_paths is not None:
            # Root / initiator-hold notes: author, initiator, or no path yet.
            if not (
                note.author_user == actor_name
                or (letter is not None and is_initiator(letter, actor_name or ""))
            ):
                continue
        editable = note_is_editable(db, note, actor_name) if actor_name else False
        linked = None
        if note.marking_id is not None:
            linked = marking_cache.get(int(note.marking_id))
        for_user = (getattr(note, "for_user", None) or "").strip()
        if not for_user and normalize_audience(getattr(note, "audience", None)) == AUDIENCE_RECIPIENT:
            # Legacy hop-private notes: treat as addressed to the marking recipient.
            if linked is not None:
                for_user = (linked.to_user or "").strip()
        out.append(
            {
                "id": note.id,
                "letterId": str(note.letter_id),
                "markingId": note.marking_id,
                "batchId": linked.batch_id if linked is not None else None,
                "authorUser": note.author_user,
                "bodyText": note.body_text,
                "audience": normalize_audience(getattr(note, "audience", None)),
                "forUser": for_user,
                "isResponse": note.is_response,
                "clientIp": note.client_ip,
                "createdAt": note.created_at.isoformat() if note.created_at else "",
                "editable": editable,
            }
        )
    return out


def list_attachments(
    db: Session,
    letter_id: int,
    actor_name: str | None = None,
    *,
    include_deleted: bool = False,
) -> list[dict]:
    query = db.query(CorrespondenceAttachment).filter(CorrespondenceAttachment.letter_id == letter_id)
    if not include_deleted:
        query = query.filter(CorrespondenceAttachment.deleted_at.is_(None))
    rows = query.order_by(CorrespondenceAttachment.id.desc()).all()
    letter = db.get(Letter, letter_id)
    visible_paths: set[str] | None = None
    if actor_name:
        visible_paths = path_ids_visible_to_user(db, letter_id, actor_name)

    marking_cache: dict[int, Marking | None] = {}
    visible_rows: list[CorrespondenceAttachment] = []
    for row in rows:
        if row.marking_id is not None:
            mid = int(row.marking_id)
            if mid not in marking_cache:
                marking_cache[mid] = db.get(Marking, mid)
            linked = marking_cache[mid]
            if linked is not None and linked.status == "revoked":
                continue
            if actor_name and not marking_content_visible_to_actor(
                db,
                linked,
                actor_name,
                visible_paths=visible_paths,
                audience=normalize_audience(getattr(row, "audience", None)),
            ):
                continue
        elif actor_name and visible_paths is not None:
            if not (
                row.created_by == actor_name
                or (letter is not None and is_initiator(letter, actor_name or ""))
            ):
                continue
        visible_rows.append(row)

    return [
        serialize_attachment(
            db,
            row,
            editable=attachment_is_editable(db, row, actor_name) if actor_name else False,
        )
        for row in visible_rows
    ]


def update_note(
    db: Session,
    *,
    note: CorrespondenceNote,
    actor_name: str,
    body_text: str,
    client_ip: str = "",
) -> CorrespondenceNote:
    letter = assert_note_editable(db, note, actor_name)
    body = (body_text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="bodyText is required")
    note.body_text = body
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Edit note",
        record=letter.number,
        description=body[:200],
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return note


def delete_note(
    db: Session,
    *,
    note: CorrespondenceNote,
    actor_name: str,
    client_ip: str = "",
) -> None:
    letter = assert_note_editable(db, note, actor_name)
    linked = (
        db.query(Marking)
        .filter(Marking.response_note_id == note.id)
        .all()
    )
    for marking in linked:
        marking.response_note_id = None
        if marking.status == "responded":
            marking.status = "active"
            marking.responded_at = None
    note_id = note.id
    db.delete(note)
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Delete note",
        record=letter.number,
        description=f"Deleted note #{note_id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()


def delete_attachment(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    client_ip: str = "",
) -> None:
    letter = assert_attachment_editable(db, attachment, actor_name)
    if attachment.deleted_at:
        return
    attachment.deleted_at = datetime.now()
    attachment.deleted_by = actor_name
    _record_attachment_event(
        db,
        letter_id=letter.id,
        marking_id=attachment.marking_id,
        attachment=attachment,
        event_type="removed",
        actor_user=actor_name,
        version_id=getattr(attachment, "current_version_id", None),
        client_ip=client_ip,
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Delete attachment",
        record=letter.number,
        description=attachment.original_filename or f"attachment #{attachment.id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()


def update_attachment_meta(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    attachment_kind: str | None = None,
    original_filename: str | None = None,
    client_ip: str = "",
) -> CorrespondenceAttachment:
    letter = assert_attachment_editable(db, attachment, actor_name)
    if attachment_kind is not None:
        kind = attachment_kind.strip()
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        attachment.attachment_kind = kind
    if original_filename is not None:
        attachment.original_filename = original_filename.strip()
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Update attachment",
        record=letter.number,
        description=f"attachment #{attachment.id}",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return attachment


def add_attachments_to_marking(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    attachments: list[dict],
    marking_id: int | None = None,
    client_ip: str = "",
) -> list[CorrespondenceAttachment]:
    assert_can_mutate(db, letter, actor_name)
    resolved = resolve_hold_marking_id(db, letter, actor_name, marking_id)
    created: list[CorrespondenceAttachment] = []
    for att in attachments:
        kind = str(att.get("attachmentKind") or att.get("attachment_kind") or "Other")
        if kind not in ATTACHMENT_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid attachmentKind '{kind}'")
        doc_id = att.get("documentId") or att.get("document_id")
        version_id = None
        if doc_id:
            current = (
                db.query(DocumentVersion)
                .filter(
                    DocumentVersion.document_id == int(doc_id),
                    DocumentVersion.is_current.is_(True),
                )
                .order_by(DocumentVersion.id.desc())
                .first()
            )
            if current:
                version_id = current.id
        row = CorrespondenceAttachment(
            letter_id=letter.id,
            marking_id=resolved,
            note_id=None,
            created_by=actor_name,
            document_id=doc_id,
            attachment_kind=kind,
            audience=normalize_audience(
                att.get("audience"), default=AUDIENCE_RECIPIENT
            ),
            storage_key=str(att.get("storageKey") or att.get("storage_key") or ""),
            original_filename=str(
                att.get("originalFilename") or att.get("original_filename") or ""
            ),
            client_ip=client_ip or "",
            current_version_id=version_id,
        )
        db.add(row)
        created.append(row)
    db.flush()
    for row in created:
        _record_attachment_event(
            db,
            letter_id=letter.id,
            marking_id=row.marking_id,
            attachment=row,
            event_type="added",
            actor_user=actor_name,
            version_id=row.current_version_id,
            client_ip=client_ip,
        )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Add attachments",
        record=letter.number,
        description=f"Added {len(created)} file(s) to marking incident",
        source=f"Web · {client_ip or 'unknown'}",
    )
    return created


def sync_attachment_after_replace(
    db: Session,
    *,
    attachment: CorrespondenceAttachment,
    actor_name: str,
    original_filename: str,
    client_ip: str = "",
) -> CorrespondenceAttachment:
    """Call after uploading a new document version for the same document_id.

    Same-user replace updates the live row and archives the prior version.
    Cross-user replace (senior over junior) soft-deletes the junior row so their
    submission stays queryable, then creates a new live attachment for the actor.
    """
    letter = assert_attachment_editable(db, attachment, actor_name)
    previous_version_id = getattr(attachment, "current_version_id", None)
    new_version_id = previous_version_id
    if attachment.document_id:
        current = (
            db.query(DocumentVersion)
            .filter(
                DocumentVersion.document_id == attachment.document_id,
                DocumentVersion.is_current.is_(True),
            )
            .order_by(DocumentVersion.id.desc())
            .first()
        )
        if current:
            new_version_id = current.id

    prior_owner = (attachment.created_by or "").strip()
    if prior_owner and prior_owner != actor_name.strip():
        # Preserve junior row + file pointer, then publish senior's replacement.
        attachment.deleted_at = datetime.now()
        attachment.deleted_by = actor_name
        _record_attachment_event(
            db,
            letter_id=letter.id,
            marking_id=attachment.marking_id,
            attachment=attachment,
            event_type="replaced",
            actor_user=actor_name,
            version_id=previous_version_id,
            client_ip=client_ip,
        )
        replacement = CorrespondenceAttachment(
            letter_id=letter.id,
            marking_id=attachment.marking_id,
            note_id=None,
            created_by=actor_name,
            document_id=attachment.document_id,
            attachment_kind=attachment.attachment_kind,
            storage_key=attachment.storage_key or "",
            original_filename=original_filename,
            client_ip=client_ip or "",
            current_version_id=new_version_id,
        )
        db.add(replacement)
        db.flush()
        _record_attachment_event(
            db,
            letter_id=letter.id,
            marking_id=replacement.marking_id,
            attachment=replacement,
            event_type="added",
            actor_user=actor_name,
            version_id=new_version_id,
            client_ip=client_ip,
        )
        add_audit(
            db,
            user=actor_name,
            module="Marking",
            action="Replace attachment",
            record=letter.number,
            description=original_filename,
            source=f"Web · {client_ip or 'unknown'}",
        )
        db.flush()
        return replacement

    attachment.original_filename = original_filename
    attachment.client_ip = client_ip or attachment.client_ip
    attachment.current_version_id = new_version_id
    _record_attachment_event(
        db,
        letter_id=letter.id,
        marking_id=attachment.marking_id,
        attachment=attachment,
        event_type="replaced",
        actor_user=actor_name,
        version_id=previous_version_id or new_version_id,
        client_ip=client_ip,
    )
    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Replace attachment",
        record=letter.number,
        description=original_filename,
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return attachment


def list_attachment_events(
    db: Session,
    letter_id: int,
    *,
    actor_name: str | None = None,
    marking_id: int | None = None,
    only_actor: str | None = None,
) -> list[dict]:
    """Archive trail of add/replace/remove — used for per-user node history."""
    query = db.query(CorrespondenceAttachmentEvent).filter(
        CorrespondenceAttachmentEvent.letter_id == letter_id
    )
    if marking_id is not None:
        query = query.filter(CorrespondenceAttachmentEvent.marking_id == marking_id)
    if only_actor:
        query = query.filter(CorrespondenceAttachmentEvent.actor_user == only_actor.strip())
    rows = query.order_by(CorrespondenceAttachmentEvent.id.desc()).all()
    if actor_name:
        visible_paths = path_ids_visible_to_user(db, letter_id, actor_name)
        if visible_paths is not None:
            marking_cache: dict[int, Marking | None] = {}
            att_audience_cache: dict[int, str] = {}
            filtered: list[CorrespondenceAttachmentEvent] = []
            for row in rows:
                # Own archive events stay visible even after revoke so senders/recipients
                # can still reference files they contributed.
                if only_actor and row.actor_user == only_actor.strip():
                    filtered.append(row)
                    continue
                if row.marking_id is None:
                    if row.actor_user == actor_name:
                        filtered.append(row)
                    continue
                mid = int(row.marking_id)
                if mid not in marking_cache:
                    marking_cache[mid] = db.get(Marking, mid)
                linked = marking_cache[mid]
                audience = AUDIENCE_RECIPIENT
                if row.attachment_id is not None:
                    aid = int(row.attachment_id)
                    if aid not in att_audience_cache:
                        att = db.get(CorrespondenceAttachment, aid)
                        att_audience_cache[aid] = normalize_audience(
                            getattr(att, "audience", None) if att else None
                        )
                    audience = att_audience_cache[aid]
                if marking_content_visible_to_actor(
                    db,
                    linked,
                    actor_name,
                    visible_paths=visible_paths,
                    audience=audience,
                ):
                    filtered.append(row)
            rows = filtered
    return [
        {
            "id": row.id,
            "letterId": str(row.letter_id),
            "markingId": row.marking_id,
            "attachmentId": row.attachment_id,
            "eventType": row.event_type,
            "actorUser": row.actor_user,
            "documentId": row.document_id,
            "versionId": row.version_id,
            "originalFilename": row.original_filename,
            "storageKey": row.storage_key,
            "attachmentKind": row.attachment_kind,
            "clientIp": row.client_ip,
            "createdAt": row.created_at.isoformat() if row.created_at else "",
        }
        for row in rows
    ]


def list_tracked(db: Session, actor_name: str) -> list[dict]:
    """For Information only — Forward / Response Required appear in Sent instead."""
    rows = (
        db.query(Marking)
        .filter(
            Marking.from_user == actor_name,
            Marking.track.is_(True),
            Marking.status == "active",
            Marking.action == "for_info",
        )
        .order_by(Marking.id.desc())
        .all()
    )
    return [serialize_marking(r) for r in rows]


def batch_tracker(db: Session, batch_id: int, actor_name: str) -> dict:
    batch = db.get(MarkingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.from_user != actor_name and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the marker can view this tracker")
    markings = (
        db.query(Marking)
        .filter(Marking.batch_id == batch_id, Marking.status != "revoked")
        .order_by(Marking.id.asc())
        .all()
    )
    pending = [m for m in markings if m.action == "response_required" and m.status == "active"]
    responded = [m for m in markings if m.action == "response_required" and m.status == "responded"]
    return {
        "batch": serialize_batch(batch),
        "markings": [serialize_marking(m) for m in markings],
        "pendingCount": len(pending),
        "respondedCount": len(responded),
        "allResponsesReceived": len(pending) == 0 and len(responded) >= 0 and (
            any(m.action == "response_required" for m in markings) and len(pending) == 0
            or not any(m.action == "response_required" for m in markings)
        ),
    }


def close_letter(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    remarks: str = "",
    force: bool = False,
    client_ip: str = "",
) -> Letter:
    if not is_initiator(letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Only the initiator can close this correspondence")
    if letter.status == CLOSED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is already closed")
    if letter.is_archived or letter.status == ARCHIVED_LETTER:
        raise HTTPException(status_code=400, detail="Letter is archived")
    if not user_holds_letter(db, letter, actor_name) and not _is_admin(db, actor_name):
        raise HTTPException(status_code=403, detail="Initiator must currently hold the correspondence to close")

    open_rr = (
        db.query(Marking)
        .filter(
            Marking.letter_id == letter.id,
            Marking.action == "response_required",
            Marking.status == "active",
        )
        .all()
    )
    if open_rr and not force:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "OPEN_RESPONSES",
                "message": "Open Response Required markings remain; pass force=true to close anyway",
                "pending": [serialize_marking(m) for m in open_rr],
            },
        )

    letter.status = CLOSED_LETTER
    letter.closed_at = datetime.now()
    letter.closed_by = actor_name
    letter.close_ip = client_ip or ""
    if remarks:
        letter.remarks = ((letter.remarks or "") + f"\n[Close] {remarks}").strip()

    actives = (
        db.query(Marking)
        .filter(Marking.letter_id == letter.id, Marking.status == "active")
        .all()
    )
    for m in actives:
        m.status = "superseded"
    db.flush()
    sync_letter_from_markings(db, letter, last_action="Closed")

    participants = {m.from_user for m in db.query(Marking).filter(Marking.letter_id == letter.id).all()}
    participants |= {m.to_user for m in db.query(Marking).filter(Marking.letter_id == letter.id).all()}
    participants.add(initiator_name(letter))
    for name in participants:
        if not name or name == actor_name:
            continue
        add_notification(
            db,
            title="Correspondence Closed",
            description=f"{letter.number}: closed by {actor_name}.",
            priority="Medium",
            letter_id=letter.id,
            notification_type="Correspondence Closed",
            recipient_name=name,
        )

    add_audit(
        db,
        user=actor_name,
        module="Marking",
        action="Close",
        record=letter.number,
        description=remarks or "Correspondence closed",
        source=f"Web · {client_ip or 'unknown'}",
    )
    db.flush()
    return letter


def available_marking_actions(db: Session, letter: Letter, actor_name: str) -> list[str]:
    if letter.is_archived or letter.status in {ARCHIVED_LETTER, CLOSED_LETTER}:
        actions: list[str] = []
    elif _is_viewer(db, actor_name):
        actions = []
    else:
        actions = []
        holds = user_holds_letter(db, letter, actor_name)
        # After marking onward, marker is revoke-only (Admin may still mutate).
        if holds or _is_admin(db, actor_name):
            # "forward" is the onward path (formerly "mark"); "reply" is back to previous marker.
            actions.extend(["forward", "add_note"])
            leaves = leaf_inbound_markings(db, letter.id, actor_name)
            returned = response_returned_markings(db, letter.id, actor_name)
            if leaves or returned:
                actions.append("reply")
            if any(m.action == "response_required" for m in leaves):
                actions.append("respond")
        if is_initiator(letter, actor_name) and holds:
            actions.append("close")
        # Revoke only while recipient has not remade onward or contributed.
        outbound = (
            db.query(Marking)
            .filter(
                Marking.letter_id == letter.id,
                Marking.from_user == actor_name,
                Marking.status == "active",
            )
            .all()
        )
        if any(marking_is_revokable(db, m) for m in outbound):
            actions.append("revoke")
    return actions


def marking_actions_payload(db: Session, letter: Letter, actor_name: str) -> dict[str, Any]:
    """Actions plus hold context for multi-recipient Workflow UI."""
    active_holds = leaf_inbound_markings(db, letter.id, actor_name)
    returned_holds = response_returned_markings(db, letter.id, actor_name)
    # Returned RR holds are selectable parents for Forward/Reply after a response.
    hold_rows = [*active_holds, *returned_holds]
    active_leaves = active_leaf_markings(db, letter.id)
    initiator_hold = is_initiator(letter, actor_name) and not has_active_markings(db, letter.id)
    return {
        "letterId": str(letter.id),
        "currentStatus": letter.status,
        "actions": available_marking_actions(db, letter, actor_name),
        "activeHolds": [serialize_marking(m) for m in hold_rows],
        "activeLeaves": [serialize_marking(m) for m in active_leaves],
        "initiatorHold": initiator_hold,
    }


def markings_for_path(db: Session, path_id: str) -> list[Marking]:
    pid = (path_id or "").strip()
    if not pid:
        return []
    return (
        db.query(Marking)
        .filter(Marking.path_id == pid)
        .order_by(Marking.id.asc())
        .all()
    )


def _notify_pathway(
    db: Session,
    *,
    letter: Letter,
    actor_name: str,
    title: str,
    description: str,
    skip_user: str,
) -> None:
    subs = (
        db.query(MarkingSubscription)
        .filter(
            MarkingSubscription.letter_id == letter.id,
            MarkingSubscription.active.is_(True),
        )
        .all()
    )
    seen: set[str] = set()
    for sub in subs:
        if sub.user_name in seen or sub.user_name == skip_user:
            continue
        seen.add(sub.user_name)
        add_notification(
            db,
            title=title,
            description=description,
            priority="Low",
            letter_id=letter.id,
            notification_type="Pathway Update",
            recipient_name=sub.user_name,
        )


def letter_ids_marked_to_user(db: Session, user_name: str) -> set[int]:
    """Letters currently held via an inbound marking (not remade onward)."""
    name = (user_name or "").strip()
    if not name:
        return set()
    inbound = (
        db.query(Marking)
        .filter(Marking.to_user == name, Marking.status == "active")
        .all()
    )
    if not inbound:
        return set()
    parent_ids = [m.id for m in inbound]
    remade = {
        int(row[0])
        for row in db.query(Marking.parent_marking_id)
        .filter(
            Marking.parent_marking_id.in_(parent_ids),
            Marking.status == "active",
        )
        .distinct()
        .all()
        if row[0] is not None
    }
    return {m.letter_id for m in inbound if m.id not in remade}


def letter_ids_held_by_user(db: Session, user_name: str) -> set[int]:
    """Inbox: leaf inbound holds, returned RR responses, or initiator with no active markings."""
    name = (user_name or "").strip()
    if not name:
        return set()
    held = set(letter_ids_marked_to_user(db, name))
    # Response Required fulfilled → letter returns to the marker's Inbox.
    returned_letter_ids = (
        db.query(Marking.letter_id, Marking.id)
        .filter(
            Marking.from_user == name,
            Marking.action == "response_required",
            Marking.status == "responded",
        )
        .all()
    )
    for letter_id, marking_id in returned_letter_ids:
        if not marking_has_children(db, int(marking_id)):
            held.add(int(letter_id))
    # Initiator hold while nothing is marked out (including after a full revoke).
    owned_ids = [
        int(row[0])
        for row in db.query(Letter.id)
        .filter(
            Letter.created_by == name,
            Letter.is_archived.is_(False),
            Letter.status.notin_([CLOSED_LETTER, ARCHIVED_LETTER]),
        )
        .all()
    ]
    if owned_ids:
        active_owned = {
            int(row[0])
            for row in db.query(Marking.letter_id)
            .filter(Marking.letter_id.in_(owned_ids), Marking.status == "active")
            .distinct()
            .all()
        }
        held.update(lid for lid in owned_ids if lid not in active_owned)
    return held


def sent_markings_for_user(db: Session, user_name: str) -> list[Marking]:
    """
    Sent items: one row per outstanding Forward or Response Required the user sent.

    - Response Required: stays while status=active (until the recipient responds).
    - Forward: stays while active and the recipient has not remade/replied onward.
    - For Information: Track only (never Sent).
    """
    name = (user_name or "").strip()
    if not name:
        return []
    rows = (
        db.query(Marking)
        .filter(
            Marking.from_user == name,
            Marking.status == "active",
            Marking.action.in_(("response_required", "forward")),
        )
        .order_by(Marking.id.desc())
        .all()
    )
    out: list[Marking] = []
    for marking in rows:
        if marking.action == "response_required":
            out.append(marking)
        elif marking.action == "forward" and not marking_has_children(db, marking.id):
            out.append(marking)
    return out


def letter_ids_marked_by_user(db: Session, user_name: str) -> set[int]:
    """Sent letter ids: letters with at least one outstanding Forward / RR from the user."""
    return {int(m.letter_id) for m in sent_markings_for_user(db, user_name)}


def user_on_marking(db: Session, letter_id: int, user_name: str) -> bool:
    """Delegate to letter_access — revoked markings do not count."""
    from app.letter_access import user_on_marking as _access_user_on_marking

    return _access_user_on_marking(db, letter_id, user_name)
