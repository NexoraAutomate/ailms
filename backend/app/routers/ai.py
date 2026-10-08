from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai_analysis_store import (
    ANALYSIS_KINDS,
    get_cached_payload,
    get_or_generate,
    list_letter_analyses,
    save_client_analysis,
    save_decisions,
)
from app.ai_service import (
    ai_status,
    analyze_correspondence,
    assistant_chat,
    classify,
    draft_response,
    extract_fields,
    letter_qa,
    management_insights,
    natural_search,
    recommend_actions,
    summarize,
    urgency,
)
from app.database import get_db
from app.ai.llm_provider import get_llm_provider
from app.llm_client import LlmNotConfiguredError, llm_is_configured
from app.services import add_audit, current_user_name, resolve_user_role
from app.enterprise_workflow_service import can_use_llm_analysis

router = APIRouter(prefix="/ai", tags=["ai"])


def _require_llm_role(db: Session) -> None:
    """Further LLM analysis is Management-level only; lower ranks use OCR registration."""
    actor = current_user_name(db)
    role = resolve_user_role(db, actor)
    if not can_use_llm_analysis(role):
        raise HTTPException(
            status_code=403,
            detail="LLM analysis is restricted to Management. Use OCR registration for letter intake.",
        )


class LetterRef(BaseModel):
    letter_id: int = Field(alias="letterId")
    variant: int = 0
    style: str = "default"
    force: bool = False

    model_config = {"populate_by_name": True}


class SearchIn(BaseModel):
    query: str


class ChatHistoryItem(BaseModel):
    role: str
    content: str = ""


class ChatIn(BaseModel):
    message: str
    history: list[ChatHistoryItem] = Field(default_factory=list)
    context_letter_ids: list[int] = Field(default_factory=list, alias="contextLetterIds")

    model_config = {"populate_by_name": True}


class LetterQaIn(BaseModel):
    letter_id: int = Field(alias="letterId")
    message: str
    history: list[ChatHistoryItem] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AnalysisSaveIn(BaseModel):
    payload: object
    decisions: dict | None = None
    meta: dict | None = None


class DecisionsIn(BaseModel):
    decisions: dict = Field(default_factory=dict)


def _guard_configured() -> None:
    if not llm_is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "LLM not configured. Set LLM_PROVIDER (ollama|runpod|vllm|openai) "
                "and fill that provider's profile keys in .env "
                "(e.g. LLM_OLLAMA_* or RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID)."
            ),
        )


@router.get("/status")
def get_ai_status() -> dict:
    return ai_status()


@router.get("/health/llm")
async def get_llm_health():
    """Probe the configured LLM backend (Ollama/OpenAI-compatible or Runpod)."""
    result = await get_llm_provider().health()
    if result.get("status") != "ok":
        return JSONResponse(status_code=503, content=result)
    return result


@router.get("/letters/{letter_id}/analysis")
def get_letter_analysis(letter_id: int, db: Session = Depends(get_db)) -> dict:
    return list_letter_analyses(db, letter_id)


@router.put("/letters/{letter_id}/analysis/{kind}")
def put_letter_analysis(
    letter_id: int,
    kind: str,
    body: AnalysisSaveIn,
    db: Session = Depends(get_db),
) -> dict:
    if kind not in ANALYSIS_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown analysis kind: {kind}")
    result = save_client_analysis(
        db,
        letter_id,
        kind,
        body.payload,
        decisions=body.decisions,
        meta=body.meta,
    )
    add_audit(
        db,
        user=current_user_name(db),
        module="AI",
        action="Store analysis",
        record=str(letter_id),
        description=f"Stored AI Intelligence result ({kind})",
    )
    db.commit()
    return result


@router.patch("/letters/{letter_id}/analysis/{kind}/decisions")
def patch_letter_analysis_decisions(
    letter_id: int,
    kind: str,
    body: DecisionsIn,
    db: Session = Depends(get_db),
) -> dict:
    if kind not in ANALYSIS_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown analysis kind: {kind}")
    result = save_decisions(db, letter_id, kind, body.decisions)
    db.commit()
    return result


@router.post("/summarize")
async def api_summarize(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _require_llm_role(db)
    try:
        had_cache = get_cached_payload(db, body.letter_id, "summarize") is not None and not body.force

        async def generate():
            _guard_configured()
            return await summarize(db, body.letter_id, body.variant)

        result = await get_or_generate(
            db,
            body.letter_id,
            "summarize",
            force=body.force,
            generate=generate,
            meta={"variant": body.variant, "source": "llm"},
        )
        if not had_cache:
            add_audit(
                db,
                user=current_user_name(db),
                module="AI",
                action="Summarize",
                record=str(body.letter_id),
                description="LLM summary regenerated" if body.force else "LLM summary generated",
            )
        db.commit()
        return result
    except LlmNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/extract")
async def api_extract(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _require_llm_role(db)
    async def generate():
        _guard_configured()
        return await extract_fields(db, body.letter_id)

    result = await get_or_generate(
        db,
        body.letter_id,
        "extract",
        force=body.force,
        generate=generate,
        to_response=lambda fields: {"fields": fields},
        meta={"source": "llm"},
    )
    db.commit()
    return result


@router.post("/classify")
async def api_classify(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _require_llm_role(db)
    async def generate():
        _guard_configured()
        return await classify(db, body.letter_id)

    result = await get_or_generate(
        db,
        body.letter_id,
        "classify",
        force=body.force,
        generate=generate,
        to_response=lambda suggestions: {"suggestions": suggestions},
        meta={"source": "llm"},
    )
    db.commit()
    return result


@router.post("/recommend-actions")
async def api_recommend(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _require_llm_role(db)
    async def generate():
        _guard_configured()
        return await recommend_actions(db, body.letter_id)

    result = await get_or_generate(
        db,
        body.letter_id,
        "recommend_actions",
        force=body.force,
        generate=generate,
        to_response=lambda actions: {"actions": actions},
        meta={"source": "llm"},
    )
    db.commit()
    return result


@router.post("/urgency")
async def api_urgency(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _require_llm_role(db)
    async def generate():
        _guard_configured()
        return await urgency(db, body.letter_id)

    result = await get_or_generate(
        db,
        body.letter_id,
        "urgency",
        force=body.force,
        generate=generate,
        meta={"source": "llm"},
    )
    db.commit()
    return result


@router.post("/draft-response")
async def api_draft(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    # Non-default styles rewrite the stored draft and need regenerate rights when overwriting.
    force = body.force or (body.style != "default" and get_cached_payload(db, body.letter_id, "draft_response") is not None)

    async def generate():
        _guard_configured()
        return await draft_response(db, body.letter_id, body.style)

    result = await get_or_generate(
        db,
        body.letter_id,
        "draft_response",
        force=force,
        generate=generate,
        meta={"style": body.style, "source": "llm"},
    )
    db.commit()
    return result


@router.post("/search")
async def api_search(body: SearchIn, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return await natural_search(db, body.query.strip())


@router.post("/analyze-correspondence")
async def api_analyze(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    async def generate():
        _guard_configured()
        return await analyze_correspondence(db, body.letter_id)

    result = await get_or_generate(
        db,
        body.letter_id,
        "analyze_correspondence",
        force=body.force,
        generate=generate,
        meta={"source": "llm"},
    )
    db.commit()
    return result


@router.post("/management-insights")
async def api_insights(db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return {"insights": await management_insights(db)}


@router.post("/chat")
async def api_chat(body: ChatIn, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message is required")
    history = [{"role": item.role, "content": item.content} for item in body.history]
    return await assistant_chat(
        db,
        body.message.strip(),
        history=history,
        context_letter_ids=list(body.context_letter_ids),
    )


@router.post("/letter-qa")
async def api_letter_qa(body: LetterQaIn, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message is required")
    history = [{"role": item.role, "content": item.content} for item in body.history]
    try:
        return await letter_qa(
            db,
            body.letter_id,
            body.message.strip(),
            history=history,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LlmNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
