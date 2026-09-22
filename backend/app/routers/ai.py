from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai_service import (
    ai_status,
    analyze_correspondence,
    assistant_chat,
    classify,
    draft_response,
    extract_fields,
    management_insights,
    natural_search,
    recommend_actions,
    summarize,
    urgency,
)
from app.database import get_db
from app.ai.llm_provider import get_llm_provider
from app.llm_client import LlmNotConfiguredError, llm_is_configured
from app.services import add_audit, current_user_name

router = APIRouter(prefix="/ai", tags=["ai"])


class LetterRef(BaseModel):
    letter_id: int = Field(alias="letterId")
    variant: int = 0
    style: str = "default"

    model_config = {"populate_by_name": True}


class SearchIn(BaseModel):
    query: str


class ChatIn(BaseModel):
    message: str


def _guard_configured() -> None:
    if not llm_is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "LLM not configured. For Ollama set LLM_PROVIDER=ollama, LLM_BASE_URL, "
                "and LLM_MODEL in backend .env (API key optional for local providers)."
            ),
        )


@router.get("/status")
def get_ai_status() -> dict:
    return ai_status()


@router.get("/health/llm")
async def get_llm_health():
    """Probe the configured OpenAI-compatible LLM (Ollama by default)."""
    result = await get_llm_provider().health()
    if result.get("status") != "ok":
        return JSONResponse(status_code=503, content=result)
    return result


@router.post("/summarize")
async def api_summarize(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    try:
        result = await summarize(db, body.letter_id, body.variant)
        add_audit(db, user=current_user_name(db), module="AI", action="Summarize", record=str(body.letter_id), description="LLM summary generated")
        db.commit()
        return result
    except LlmNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/extract")
async def api_extract(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    fields = await extract_fields(db, body.letter_id)
    return {"fields": fields}


@router.post("/classify")
async def api_classify(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return {"suggestions": await classify(db, body.letter_id)}


@router.post("/recommend-actions")
async def api_recommend(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return {"actions": await recommend_actions(db, body.letter_id)}


@router.post("/urgency")
async def api_urgency(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return await urgency(db, body.letter_id)


@router.post("/draft-response")
async def api_draft(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return await draft_response(db, body.letter_id, body.style)


@router.post("/search")
async def api_search(body: SearchIn, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return await natural_search(db, body.query.strip())


@router.post("/analyze-correspondence")
async def api_analyze(body: LetterRef, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return await analyze_correspondence(db, body.letter_id)


@router.post("/management-insights")
async def api_insights(db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    return {"insights": await management_insights(db)}


@router.post("/chat")
async def api_chat(body: ChatIn, db: Session = Depends(get_db)) -> dict:
    _guard_configured()
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="Message is required")
    return await assistant_chat(db, body.message.strip())
