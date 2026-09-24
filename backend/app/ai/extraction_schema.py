"""Pydantic schema for AI letter registration extraction (master plan step 7 / spec 05)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROMPT_VERSION = "registration_v1"
SCHEMA_VERSION = 1

# DB / LetterCreate-aligned max lengths (sanitize before persistence).
FIELD_MAX_LENGTHS: dict[str, int] = {
    "number": 80,
    "letterDate": 32,
    "receivedDate": 32,
    "type": 40,
    "subject": 400,
    "from": 180,
    "to": 180,
    "department": 120,
    "priority": 40,
    "dueDate": 32,
    "actionRequired": 200,
    "confidentiality": 40,
    "remarks": 4000,
    "summary": 2000,
    "documentCategory": 80,
}

# Fields that should be human-reviewed when present.
DEFAULT_REQUIRED_REVIEW: frozenset[str] = frozenset(
    {
        "number",
        "letterDate",
        "type",
        "subject",
        "from",
        "to",
        "department",
        "priority",
        "actionRequired",
        "confidentiality",
        "documentCategory",
        "relatedLetterNumbers",
    }
)

FIELD_NAMES: tuple[str, ...] = (
    "number",
    "letterDate",
    "receivedDate",
    "type",
    "subject",
    "from",
    "to",
    "department",
    "priority",
    "dueDate",
    "actionRequired",
    "confidentiality",
    "remarks",
    "summary",
    "documentCategory",
    "relatedLetterNumbers",
)


class ExtractedField(BaseModel):
    """Single extracted correspondence field with confidence metadata."""

    model_config = ConfigDict(extra="ignore")

    value: Any = None
    confidence: float = 0.0
    requiredReview: bool = False

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, value: object) -> float:
        if value is None or value == "":
            return 0.0
        try:
            conf = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0
        if conf > 1.0:
            conf = conf / 100.0
        return max(0.0, min(1.0, conf))


def _empty_extracted_field() -> ExtractedField:
    return ExtractedField(value=None, confidence=0.0, requiredReview=False)


class FieldEvidence(BaseModel):
    model_config = ConfigDict(extra="ignore")

    field: str
    page: int | None = None
    snippet: str = ""
    bbox: list[float] | None = None

    @field_validator("snippet", mode="before")
    @classmethod
    def _clip_snippet(cls, value: object) -> str:
        text = "" if value is None else str(value)
        return text[:500]

    @field_validator("bbox", mode="before")
    @classmethod
    def _normalize_bbox(cls, value: object) -> list[float] | None:
        if value is None or value == "":
            return None
        if not isinstance(value, (list, tuple)) or len(value) < 4:
            return None
        try:
            return [float(value[0]), float(value[1]), float(value[2]), float(value[3])]
        except (TypeError, ValueError):
            return None


class LetterExtractionFields(BaseModel):
    """Correspondence fields aligned with LetterCreate (+ summary / category / relations)."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    number: ExtractedField = Field(default_factory=_empty_extracted_field)
    letterDate: ExtractedField = Field(default_factory=_empty_extracted_field)
    receivedDate: ExtractedField = Field(default_factory=_empty_extracted_field)
    type: ExtractedField = Field(default_factory=_empty_extracted_field)
    subject: ExtractedField = Field(default_factory=_empty_extracted_field)
    from_: ExtractedField = Field(default_factory=_empty_extracted_field, alias="from")
    to: ExtractedField = Field(default_factory=_empty_extracted_field)
    department: ExtractedField = Field(default_factory=_empty_extracted_field)
    priority: ExtractedField = Field(default_factory=_empty_extracted_field)
    dueDate: ExtractedField = Field(default_factory=_empty_extracted_field)
    actionRequired: ExtractedField = Field(default_factory=_empty_extracted_field)
    confidentiality: ExtractedField = Field(default_factory=_empty_extracted_field)
    remarks: ExtractedField = Field(default_factory=_empty_extracted_field)
    summary: ExtractedField = Field(default_factory=_empty_extracted_field)
    documentCategory: ExtractedField = Field(default_factory=_empty_extracted_field)
    relatedLetterNumbers: ExtractedField = Field(default_factory=_empty_extracted_field)

    @model_validator(mode="before")
    @classmethod
    def _coerce_missing_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        # Accept sender/recipient aliases commonly produced by models.
        if "from" not in out and "sender" in out:
            out["from"] = out["sender"]
        if "to" not in out and "recipient" in out:
            out["to"] = out["recipient"]
        for name in FIELD_NAMES:
            key = name
            if key not in out and key == "from" and "from_" in out:
                continue
            if key not in out:
                out[key] = {
                    "value": None if key != "relatedLetterNumbers" else [],
                    "confidence": 0,
                    "requiredReview": key in DEFAULT_REQUIRED_REVIEW,
                }
            elif not isinstance(out[key], dict):
                out[key] = {
                    "value": out[key],
                    "confidence": 0,
                    "requiredReview": key in DEFAULT_REQUIRED_REVIEW,
                }
        return out


class LetterExtractionResult(BaseModel):
    """Versioned structured extraction artifact (untrusted until human review)."""

    model_config = ConfigDict(extra="ignore")

    schemaVersion: int = SCHEMA_VERSION
    promptVersion: str = PROMPT_VERSION
    fields: LetterExtractionFields = Field(default_factory=LetterExtractionFields)
    evidence: list[FieldEvidence] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @field_validator("warnings", mode="before")
    @classmethod
    def _coerce_warnings(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, list):
            return [str(item) for item in value if str(item).strip()]
        return []

    def to_artifact_dict(self) -> dict[str, Any]:
        """Serialize with API aliases (`from` not `from_`); drop unknown keys."""
        return self.model_dump(by_alias=True, mode="json")

    def field_map(self) -> dict[str, ExtractedField]:
        raw = self.fields.model_dump(by_alias=True)
        return {name: ExtractedField.model_validate(raw[name]) for name in FIELD_NAMES}
