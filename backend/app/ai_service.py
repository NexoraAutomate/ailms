"""Correspondence intelligence powered by an external LLM."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.llm_client import chat_completion, chat_json, llm_is_configured
from app.models import Letter
from app.services import CLOSED_STATUSES, days_pending, effective_status, serialize_letter


def ai_status() -> dict[str, Any]:
    settings = __import__("app.config", fromlist=["get_settings"]).get_settings()
    return {
        "enabled": llm_is_configured(),
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "baseUrl": settings.llm_base_url,
    }


def _letter_payload(letter: Letter) -> dict[str, Any]:
    row = serialize_letter(letter)
    return row.model_dump(by_alias=True)


def _register_snapshot(db: Session, limit: int = 100) -> list[dict[str, Any]]:
    rows = db.query(Letter).filter(Letter.is_archived.is_(False)).order_by(Letter.id.desc()).limit(limit).all()
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": str(row.id),
                "number": row.number,
                "subject": row.subject,
                "type": row.type,
                "status": effective_status(row),
                "priority": row.priority,
                "department": row.department,
                "from": row.sender,
                "assignedTo": row.assigned_to,
                "dueDate": row.due_date.isoformat() if row.due_date else "",
                "daysPending": days_pending(row),
            }
        )
    return out


async def summarize(db: Session, letter_id: int, variant: int = 0) -> dict[str, Any]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    payload = _letter_payload(letter)
    system = (
        "You are an expert correspondence management analyst for a government or enterprise letter tracking system. "
        "Analyze the letter metadata and produce structured JSON with keys: "
        "executiveSummary, purpose, keyPoints (array of strings), importantDates (array), organizations (array), "
        "requiredActions, currentStatus, potentialRisk, recommendedFollowUp. "
        "Be factual; do not invent organizations or dates not implied by the data."
    )
    user = f"Letter record (variant {variant}):\n{payload}"
    return await chat_json(system=system, user=user)


async def extract_fields(db: Session, letter_id: int) -> list[dict[str, Any]]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    system = (
        "Extract correspondence fields as JSON array under key 'fields'. Each item: "
        "key, label, value, confidence (0-100 integer), optional official (string if matches register)."
    )
    user = f"Letter:\n{_letter_payload(letter)}"
    data = await chat_json(system=system, user=user)
    return data.get("fields") if isinstance(data, dict) else data


async def classify(db: Session, letter_id: int) -> list[dict[str, Any]]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    system = (
        "Suggest classifications as JSON array under key 'suggestions'. Each item: "
        "field (one of category, subjectCategory, department, priority, confidentiality), "
        "label, value, confidence (0-100)."
    )
    user = f"Letter:\n{_letter_payload(letter)}"
    data = await chat_json(system=system, user=user)
    return data.get("suggestions", [])


async def recommend_actions(db: Session, letter_id: int) -> list[dict[str, Any]]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    system = (
        "Recommend 3-5 next official actions as JSON under key 'actions'. Each: "
        "id (string), action, department, person, dueDate (YYYY-MM-DD), reason."
    )
    user = f"Letter:\n{_letter_payload(letter)}"
    data = await chat_json(system=system, user=user)
    return data.get("actions", [])


async def urgency(db: Session, letter_id: int) -> dict[str, Any]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    system = (
        "Assess urgency as JSON: priority (Routine|Important|Urgent), urgency (Routine|High|Critical), "
        "confidence (0-100), reasons (array of strings), suggestedDeadline (YYYY-MM-DD)."
    )
    user = f"Letter:\n{_letter_payload(letter)}"
    return await chat_json(system=system, user=user)


async def draft_response(db: Session, letter_id: int, style: str = "default") -> dict[str, Any]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    system = (
        "Draft an official reply as JSON: text, tone, pointsAddressed (array), missingInformation (array). "
        f"Style requested: {style}."
    )
    user = f"Letter:\n{_letter_payload(letter)}"
    return await chat_json(system=system, user=user)


async def natural_search(db: Session, query: str) -> dict[str, Any]:
    register = _register_snapshot(db)
    system = (
        "You interpret natural-language queries over a correspondence register. "
        "Return JSON: filters (object of string keys to string values), summary (string explaining interpretation), "
        "letterIds (array of id strings from the provided register that match). "
        "Only use letter ids present in the register snapshot."
    )
    user = f"Query: {query}\n\nRegister snapshot ({len(register)} letters):\n{register}"
    data = await chat_json(system=system, user=user)
    raw_ids = data.get("letterIds") or []
    numeric_ids = [int(i) for i in raw_ids if str(i).isdigit()]
    letters: list[dict[str, Any]] = []
    if numeric_ids:
        rows = db.query(Letter).filter(Letter.id.in_(numeric_ids)).all()
        letters = [serialize_letter(row).model_dump(by_alias=True) for row in rows]
    if not letters:
        q = query.lower()
        rows = db.query(Letter).filter(Letter.is_archived.is_(False)).all()
        letters = [
            serialize_letter(row).model_dump(by_alias=True)
            for row in rows
            if q in " ".join(
                str(v) for v in (row.number, row.subject, row.sender, row.department, row.status)
            ).lower()
        ][:50]
    return {
        "query": query,
        "filters": data.get("filters") or {},
        "summary": data.get("summary") or "Query processed by LLM.",
        "letters": letters,
    }


async def analyze_correspondence(db: Session, letter_id: int) -> dict[str, Any]:
    letter = db.get(Letter, letter_id)
    if not letter:
        raise ValueError("Letter not found")
    related = (
        db.query(Letter)
        .filter(Letter.is_archived.is_(False), Letter.id != letter.id)
        .filter((Letter.sender == letter.sender) | (Letter.department == letter.department))
        .limit(20)
        .all()
    )
    system = (
        "Analyze correspondence thread context. Return JSON matching: relatedCount, original (letter number), "
        "replies, reminders, followUps (integers), currentStatus, durationDays, timeline (array of label, date, note, optional delay bool), "
        "chain (array of stage names), delays (array of strings)."
    )
    user = f"Primary letter:\n{_letter_payload(letter)}\n\nRelated letters:\n{[_letter_payload(r) for r in related]}"
    return await chat_json(system=system, user=user)


async def management_insights(db: Session) -> list[dict[str, Any]]:
    register = _register_snapshot(db, limit=150)
    pending = sum(1 for r in register if r["status"] not in CLOSED_STATUSES)
    overdue = sum(1 for r in register if r["status"] == "Overdue")
    system = (
        "Generate 5-8 management insights as JSON under key 'insights'. Each: id, title, group (Operational|Risk|Management), "
        "severity (Critical|High|Medium|Informational), explanation, recommendation, letterIds (array from register)."
    )
    user = f"Register stats: total={len(register)} pending={pending} overdue={overdue}\n\nSnapshot:\n{register}"
    data = await chat_json(system=system, user=user)
    return data.get("insights", [])


async def assistant_chat(db: Session, message: str) -> dict[str, Any]:
    search = await natural_search(db, message)
    system = (
        "You are the AILMS AI assistant. Answer in plain professional English in 2-4 sentences. "
        "Use the search interpretation and matching letters provided. Do not claim access to data outside the snapshot."
    )
    user = f"User question: {message}\n\nInterpretation: {search['summary']}\nFilters: {search['filters']}\nMatches: {len(search['letters'])} letters"
    text = await chat_completion(system=system, user=user, temperature=0.3)
    return {"text": text.strip(), "result": search}
