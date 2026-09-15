from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.correspondence_service import RELATIONSHIP_TYPES, build_thread, create_relation, serialize_relation
from app.database import get_db
from app.models import LetterRelation
from app.schemas import CorrespondenceRelationCreateIn, CorrespondenceRelationOut, CorrespondenceThreadOut

router = APIRouter(prefix="/correspondence-relations", tags=["correspondence"])


@router.get("/types")
def relationship_types() -> dict:
    return {"types": sorted(RELATIONSHIP_TYPES)}


@router.get("", response_model=list[CorrespondenceRelationOut])
def list_relations(
    letter_id: int = Query(..., alias="letterId"),
    db: Session = Depends(get_db),
) -> list[CorrespondenceRelationOut]:
    rows = (
        db.query(LetterRelation)
        .filter(
            (LetterRelation.from_letter_id == letter_id) | (LetterRelation.to_letter_id == letter_id),
        )
        .order_by(LetterRelation.id.desc())
        .all()
    )
    return [CorrespondenceRelationOut(**serialize_relation(row)) for row in rows]


@router.post("", response_model=CorrespondenceRelationOut, status_code=201)
def add_relation(payload: CorrespondenceRelationCreateIn, db: Session = Depends(get_db)) -> CorrespondenceRelationOut:
    row = create_relation(
        db,
        from_letter_id=payload.fromLetterId,
        to_letter_id=payload.toLetterId,
        relationship_type=payload.relationshipType,
        remarks=payload.remarks,
    )
    db.commit()
    db.refresh(row)
    return CorrespondenceRelationOut(**serialize_relation(row))


@router.get("/letters/{letter_id}/thread", response_model=CorrespondenceThreadOut)
def letter_thread(letter_id: int, db: Session = Depends(get_db)) -> CorrespondenceThreadOut:
    payload = build_thread(db, letter_id)
    return CorrespondenceThreadOut(**payload)
