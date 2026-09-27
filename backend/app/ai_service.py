"""Correspondence intelligence powered by an external LLM."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.llm_client import chat_completion, chat_json, llm_is_configured
from app.models import Letter
from app.services import CLOSED_STATUSES, days_pending, effective_status, serialize_letter

# Function words and correspondence boilerplate stripped before keyword matching.
_SEARCH_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "am",
        "do",
        "does",
        "did",
        "have",
        "has",
        "had",
        "will",
        "would",
        "could",
        "should",
        "can",
        "may",
        "might",
        "must",
        "shall",
        "i",
        "me",
        "my",
        "we",
        "our",
        "you",
        "your",
        "he",
        "she",
        "it",
        "they",
        "them",
        "their",
        "this",
        "that",
        "these",
        "those",
        "what",
        "which",
        "who",
        "whom",
        "where",
        "when",
        "why",
        "how",
        "about",
        "above",
        "after",
        "against",
        "along",
        "among",
        "around",
        "as",
        "at",
        "before",
        "behind",
        "below",
        "beside",
        "between",
        "by",
        "down",
        "during",
        "for",
        "from",
        "in",
        "into",
        "near",
        "of",
        "on",
        "onto",
        "over",
        "through",
        "to",
        "toward",
        "under",
        "up",
        "with",
        "without",
        "and",
        "but",
        "or",
        "nor",
        "not",
        "no",
        "yes",
        "if",
        "then",
        "than",
        "so",
        "any",
        "all",
        "some",
        "there",
        "here",
        "please",
        "show",
        "find",
        "list",
        "get",
        "give",
        "tell",
        "search",
        "look",
        "see",
        "related",
        "regarding",
        "concerning",
        "letter",
        "letters",
        "correspondence",
        "file",
        "files",
        "document",
        "documents",
        "query",
        "question",
        "summary",
        "summarize",
        "summarise",
        "sentence",
        "sentences",
        "word",
        "words",
        "single",
        "detail",
        "details",
        "explain",
        "describe",
        "brief",
        "short",
        "concise",
        "overview",
        "more",
        "only",
        "just",
        "one",
        "two",
        "three",
        "pertaining",
        "relating",
        "relate",
        "relates",
        "related",
        "involve",
        "involves",
        "involving",
        "concern",
        "concerns",
        "mention",
        "mentions",
        "mentioned",
        "containing",
        "include",
        "includes",
        "including",
        "associated",
        "regarding",
        "concerning",
        "towards",
        "toward",
        "onto",
        "into",
        "within",
        "among",
        "across",
        "around",
        "against",
        "whether",
        "exist",
        "exists",
        "available",
    }
)

_FOLLOWUP_RE = re.compile(
    r"\b(?:that|this|the|those|these|same|previous|above)\s+"
    r"(?:letter|letters|one|ones|file|files|correspondence|document|documents)\b"
    r"|\b(?:it|them|its)\b",
    re.IGNORECASE,
)

# Keep prompts bounded while still giving the model enough letter body context.
_BODY_PROMPT_CHARS = 12_000
_BODY_SNAPSHOT_CHARS = 1_500


def _truncate_text(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n…[truncated]"


def _search_keywords(query: str) -> list[str]:
    """Extract meaningful tokens from a natural-language register query."""
    tokens = re.findall(r"[a-z0-9][a-z0-9./_-]*", query.lower())
    seen: set[str] = set()
    keywords: list[str] = []
    for token in tokens:
        if token in _SEARCH_STOPWORDS or len(token) < 2 or token in seen:
            continue
        seen.add(token)
        keywords.append(token)
    return keywords


def _letter_search_blob(row: Letter) -> str:
    return " ".join(
        str(v)
        for v in (
            row.number,
            row.subject,
            row.sender,
            row.department,
            row.status,
            row.remarks or "",
            getattr(row, "body_text", "") or "",
        )
    ).lower()


def _text_match_letters(db: Session, query: str, limit: int = 50) -> list[Letter]:
    """Match letters by phrase or keyword tokens (not the raw question string)."""
    q = query.lower().strip()
    if not q:
        return []

    rows = db.query(Letter).filter(Letter.is_archived.is_(False)).all()
    keywords = _search_keywords(query)

    # Short queries (e.g. "pension increase") can match as a phrase first.
    phrase_hits = [row for row in rows if q in _letter_search_blob(row)]
    if phrase_hits and (len(keywords) <= 1 or len(q.split()) <= 4):
        return phrase_hits[:limit]

    if not keywords:
        return phrase_hits[:limit]

    scored: list[tuple[int, Letter]] = []
    for row in rows:
        blob = _letter_search_blob(row)
        hit_count = sum(1 for token in keywords if token in blob)
        if hit_count:
            scored.append((hit_count, row))

    # Prefer letters that match every keyword; otherwise keep partial topic hits
    # so filler words like "pertaining" do not wipe out a real subject match.
    full = [row for hit_count, row in scored if hit_count == len(keywords)]
    if full:
        return full[:limit]
    scored.sort(key=lambda item: (-item[0], -item[1].id))
    return [row for _, row in scored[:limit]]


def _is_followup_question(message: str) -> bool:
    """True when the question refers to prior results rather than naming a new topic."""
    if _FOLLOWUP_RE.search(message):
        return True
    return len(_search_keywords(message)) == 0


def _letters_by_ids(db: Session, letter_ids: list[int]) -> list[dict[str, Any]]:
    if not letter_ids:
        return []
    rows = (
        db.query(Letter)
        .filter(Letter.id.in_(letter_ids), Letter.is_archived.is_(False))
        .all()
    )
    by_id = {row.id: row for row in rows}
    ordered = [by_id[i] for i in letter_ids if i in by_id]
    return [serialize_letter(row).model_dump(by_alias=True) for row in ordered]


def _brief_letters_for_prompt(letters: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    briefs: list[dict[str, Any]] = []
    for row in letters[:limit]:
        briefs.append(
            {
                "id": row.get("id"),
                "number": row.get("number"),
                "subject": row.get("subject"),
                "from": row.get("from"),
                "to": row.get("to"),
                "department": row.get("department"),
                "status": row.get("status"),
                "priority": row.get("priority"),
                "letterDate": row.get("letterDate"),
                "actionRequired": row.get("actionRequired"),
                "remarks": row.get("remarks"),
                "bodyText": _truncate_text(str(row.get("bodyText") or ""), _BODY_PROMPT_CHARS),
            }
        )
    return briefs


def ai_status() -> dict[str, Any]:
    settings = __import__("app.config", fromlist=["get_settings"]).get_settings()
    return {
        "enabled": llm_is_configured(),
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "baseUrl": settings.llm_base_url,
    }


def _letter_payload(letter: Letter) -> dict[str, Any]:
    row = serialize_letter(letter).model_dump(by_alias=True)
    row["bodyText"] = _truncate_text(str(row.get("bodyText") or ""), _BODY_PROMPT_CHARS)
    return row


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
                "bodyExcerpt": _truncate_text(getattr(row, "body_text", "") or "", _BODY_SNAPSHOT_CHARS),
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
    keywords = _search_keywords(query)
    system = (
        "You interpret natural-language queries over a correspondence register. "
        "Return JSON: filters (object of string keys to string values), summary (string explaining interpretation), "
        "letterIds (array of id strings from the provided register that match). "
        "Only use letter ids present in the register snapshot. "
        "Treat full-sentence questions as topic searches: extract subject keywords "
        "(e.g. 'pension' from 'is there a letter about pension?') and match on subject, "
        "sender, department, and number. Prefer precision over returning every letter."
    )
    user = (
        f"Query: {query}\n"
        f"Extracted keywords: {keywords or '(none)'}\n\n"
        f"Register snapshot ({len(register)} letters):\n{register}"
    )
    data = await chat_json(system=system, user=user)
    raw_ids = data.get("letterIds") or []
    numeric_ids = [int(i) for i in raw_ids if str(i).isdigit()]
    letters: list[dict[str, Any]] = []
    if numeric_ids:
        rows = db.query(Letter).filter(Letter.id.in_(numeric_ids)).all()
        letters = [serialize_letter(row).model_dump(by_alias=True) for row in rows]
    if not letters:
        matched = _text_match_letters(db, query)
        letters = [serialize_letter(row).model_dump(by_alias=True) for row in matched]
        filters = dict(data.get("filters") or {})
        if keywords and letters:
            filters.setdefault("Keywords", ", ".join(keywords))
        summary = data.get("summary") or (
            f"Matched {len(letters)} letter(s) using keywords: {', '.join(keywords)}."
            if keywords and letters
            else "No matching letters found for this query."
        )
        return {
            "query": query,
            "filters": filters,
            "summary": summary,
            "letters": letters,
        }
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


async def assistant_chat(
    db: Session,
    message: str,
    *,
    history: list[dict[str, str]] | None = None,
    context_letter_ids: list[int] | None = None,
) -> dict[str, Any]:
    context_ids = [int(i) for i in (context_letter_ids or []) if str(i).isdigit() or isinstance(i, int)]
    followup = _is_followup_question(message)

    if followup and context_ids:
        letters = _letters_by_ids(db, context_ids)
        search: dict[str, Any] = {
            "query": message,
            "filters": {"Context": "previous conversation"},
            "summary": "Using letter(s) from the prior conversation turn.",
            "letters": letters,
        }
    else:
        search = await natural_search(db, message)
        letters = list(search.get("letters") or [])
        # If the new search found nothing but the user still has prior context, keep it.
        if not letters and context_ids and (followup or _is_followup_question(message)):
            letters = _letters_by_ids(db, context_ids)
            search = {
                **search,
                "filters": {**(search.get("filters") or {}), "Context": "previous conversation"},
                "summary": search.get("summary") or "Using letter(s) from the prior conversation turn.",
                "letters": letters,
            }

    history_lines: list[str] = []
    for item in (history or [])[-6:]:
        role = str(item.get("role") or "user").strip().lower()
        content = str(item.get("content") or item.get("text") or "").strip()
        if content:
            history_lines.append(f"{role}: {content}")
    history_block = ("Conversation so far:\n" + "\n".join(history_lines) + "\n\n") if history_lines else ""

    system = (
        "You are the AILMS AI assistant for a correspondence register. "
        "Answer using only the provided letter records and conversation context. "
        "When the user refers to 'that letter' or similar, use the matching/context letters below. "
        "Use bodyText / remarks when answering questions about letter contents. "
        "Follow the user's formatting instructions precisely (length, sentence count, word limits). "
        "If no formatting constraint is given, answer in plain professional English in 2-4 sentences. "
        "Do not invent facts that are not present in the letter data."
    )
    user = (
        f"{history_block}"
        f"User question: {message}\n\n"
        f"Search interpretation: {search.get('summary')}\n"
        f"Filters: {search.get('filters')}\n"
        f"Matching letters ({len(letters)}):\n{_brief_letters_for_prompt(letters)}"
    )
    text = await chat_completion(system=system, user=user, temperature=0.3)
    return {"text": text.strip(), "result": search}
