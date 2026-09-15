"""Bulk operations on correspondence records."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.archive_service import archive_letters, assert_active_letter
from app.export_service import export_letters_csv
from app.models import Letter
from app.services import add_audit, current_user_name, resolve_user_role


def run_bulk_operation(
    db: Session,
    operation: str,
    letter_ids: list[int],
    payload: dict | None = None,
    *,
    actor: str | None = None,
) -> dict:
    actor = actor or current_user_name(db)
    role = resolve_user_role(db, actor)
    if role not in {"Administrator", "Manager", "Clerk"}:
        raise HTTPException(status_code=403, detail="Bulk operations not permitted")

    payload = payload or {}
    results: list[dict] = []
    succeeded = 0
    failed = 0

    if operation in {"assign", "reassign"} and not (payload.get("assignedTo") or payload.get("assigned_to")):
        raise HTTPException(status_code=422, detail="assignedTo required")
    if operation == "change_department" and not (payload.get("department") or "").strip():
        raise HTTPException(status_code=422, detail="department required")
    if operation == "change_priority" and not (payload.get("priority") or "").strip():
        raise HTTPException(status_code=422, detail="priority required")
    if operation == "change_status" and not (payload.get("status") or "").strip():
        raise HTTPException(status_code=422, detail="status required")

    if operation == "export":
        csv_data = export_letters_csv(db, letter_ids)
        add_audit(db, user=actor, module="Bulk", action="Export", record=str(len(letter_ids)), description="Bulk export")
        return {"operation": operation, "succeeded": len(letter_ids), "failed": 0, "results": [], "csv": csv_data}

    if operation == "archive":
        archived = set(archive_letters(db, letter_ids, actor=actor))
        for lid in letter_ids:
            ok = lid in archived
            results.append({"letterId": lid, "success": ok, "message": "" if ok else "Already archived or not found"})
            if ok:
                succeeded += 1
            else:
                failed += 1
        add_audit(db, user=actor, module="Bulk", action="Archive", record=str(succeeded), description=f"Archived {succeeded} letters")
        return {"operation": operation, "succeeded": succeeded, "failed": failed, "results": results}

    for letter_id in letter_ids:
        letter = db.get(Letter, letter_id)
        if not letter:
            results.append({"letterId": letter_id, "success": False, "message": "Not found"})
            failed += 1
            continue
        try:
            assert_active_letter(letter)
            if operation in {"assign", "reassign"}:
                assignee = (payload.get("assignedTo") or payload.get("assigned_to") or "").strip()
                letter.assigned_to = assignee
                letter.last_action = "Bulk Assign"
            elif operation == "change_department":
                letter.department = (payload.get("department") or "").strip()
                letter.last_action = "Bulk Department Change"
            elif operation == "change_priority":
                letter.priority = (payload.get("priority") or "").strip()
                letter.last_action = "Bulk Priority Change"
            elif operation == "change_status":
                letter.status = (payload.get("status") or "").strip()
                letter.last_action = "Bulk Status Change"
            else:
                raise HTTPException(status_code=422, detail=f"Unknown operation: {operation}")
            results.append({"letterId": letter_id, "success": True, "message": ""})
            succeeded += 1
        except HTTPException as exc:
            results.append({"letterId": letter_id, "success": False, "message": str(exc.detail)})
            failed += 1

    add_audit(
        db,
        user=actor,
        module="Bulk",
        action=operation.replace("_", " ").title(),
        record=str(succeeded),
        description=f"Bulk {operation}: {succeeded} ok, {failed} failed",
    )
    db.flush()
    return {"operation": operation, "succeeded": succeeded, "failed": failed, "results": results}
