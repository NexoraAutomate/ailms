"""Raw OCR for AI registration jobs (master plan step 5 / spec 02).

Produces immutable `storage/ai/jobs/{job_id}/ocr-output.json` and advances the
job to OCR_COMPLETE (or FAILED / NEEDS_REVIEW on empty text).
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from PIL import Image
from sqlalchemy.orm import Session

from app.ai.job_service import transition_job
from app.ai.job_states import JobStatus
from app.config import get_settings
from app.models import AiRegistrationJob, AiRun, AiStagedDocument
from app.services import add_audit
from app.storage_service import build_job_artifact_key, resolve_storage_path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
OCR_ARTIFACT_NAME = "ocr-output.json"


class OcrError(Exception):
    """OCR failure with a stable error_code for job FAILED transitions."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    bbox: list[float]  # [x1, y1, x2, y2]


@dataclass
class OcrPageResult:
    page_number: int
    width: int
    height: int
    status: str  # ok | low_quality | error
    lines: list[OcrLine]
    full_text: str
    error: str | None = None


class OcrEngine(Protocol):
    name: str
    version: str

    def recognize_image(self, image: Image.Image) -> list[OcrLine]:
        """Run OCR on a raster page image."""

    def recognize_pdf_page(self, pdf_path: Path, page_index: int) -> list[OcrLine] | None:
        """
        Optional PDF-native path (e.g. text layer). Return None to fall back
        to rasterize + recognize_image.
        """


class PaddleOcrEngine:
    """PaddleOCR wrapper (2.x `.ocr` and 3.x `.predict` shapes)."""

    name = "paddleocr"

    def __init__(self, *, lang: str = "en") -> None:
        try:
            from paddleocr import PaddleOCR  # type: ignore[import-untyped]
        except ImportError as exc:
            raise OcrError(
                "OCR_ENGINE_ERROR",
                "paddleocr is not installed. pip install paddlepaddle paddleocr "
                "or set OCR_ENGINE=pymupdf_text",
            ) from exc

        self._ocr = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        self.version = getattr(PaddleOCR, "__module__", "paddleocr")
        try:
            import paddleocr as _pkg  # type: ignore[import-untyped]

            self.version = str(getattr(_pkg, "__version__", self.version))
        except Exception:
            pass

    def recognize_pdf_page(self, pdf_path: Path, page_index: int) -> list[OcrLine] | None:
        return None

    def recognize_image(self, image: Image.Image) -> list[OcrLine]:
        import numpy as np

        rgb = image.convert("RGB")
        arr = np.array(rgb)
        # Prefer classic API when present; else 3.x predict.
        if hasattr(self._ocr, "ocr"):
            raw = self._ocr.ocr(arr)
            return _parse_paddle_ocr_v2(raw)
        raw = self._ocr.predict(arr)
        return _parse_paddle_predict(raw)


class PyMuPdfTextEngine:
    """
    Fallback for typed PDFs: extract embedded text layer (not true OCR).
    Image-only pages return no lines (caller marks low_quality).
    """

    name = "pymupdf_text"
    version = "pymupdf"

    def __init__(self) -> None:
        import pymupdf  # noqa: F401 — validate import early

        self.version = str(getattr(pymupdf, "VersionBind", getattr(pymupdf, "__version__", "pymupdf")))

    def recognize_pdf_page(self, pdf_path: Path, page_index: int) -> list[OcrLine] | None:
        import pymupdf

        with pymupdf.open(pdf_path) as doc:
            page = doc[page_index]
            return _lines_from_pymupdf_dict(page.get_text("dict"))

    def recognize_image(self, image: Image.Image) -> list[OcrLine]:
        # No OCR model — scanned/image uploads need paddleocr.
        return []


def _parse_paddle_ocr_v2(raw: Any) -> list[OcrLine]:
    """Parse classic `ocr.ocr()` nested list result."""
    lines: list[OcrLine] = []
    if not raw:
        return lines
    page = raw[0] if isinstance(raw, list) and raw and isinstance(raw[0], list) else raw
    if not isinstance(page, list):
        return lines
    for item in page:
        if not item or len(item) < 2:
            continue
        box, rec = item[0], item[1]
        text = rec[0] if isinstance(rec, (list, tuple)) else str(rec)
        conf = float(rec[1]) if isinstance(rec, (list, tuple)) and len(rec) > 1 else 0.0
        bbox = _quad_to_bbox(box)
        lines.append(OcrLine(text=str(text), confidence=conf, bbox=bbox))
    return lines


def _parse_paddle_predict(raw: Any) -> list[OcrLine]:
    """Best-effort parse of PaddleOCR 3.x predict results."""
    lines: list[OcrLine] = []
    if raw is None:
        return lines
    items = raw if isinstance(raw, list) else [raw]
    for res in items:
        data: dict[str, Any] = {}
        if hasattr(res, "json") and isinstance(res.json, dict):
            data = res.json.get("res", res.json) if isinstance(res.json, dict) else {}
        elif isinstance(res, dict):
            data = res.get("res", res)
        texts = data.get("rec_texts") or data.get("texts") or []
        scores = data.get("rec_scores") or data.get("scores") or []
        boxes = data.get("dt_polys") or data.get("rec_polys") or data.get("boxes") or []
        for i, text in enumerate(texts):
            conf = float(scores[i]) if i < len(scores) else 0.0
            box = boxes[i] if i < len(boxes) else [0, 0, 0, 0]
            lines.append(OcrLine(text=str(text), confidence=conf, bbox=_quad_to_bbox(box)))
    return lines


def _quad_to_bbox(box: Any) -> list[float]:
    """Convert polygon/quad points to axis-aligned [x1,y1,x2,y2]."""
    try:
        pts = list(box)
        if len(pts) == 4 and all(isinstance(v, (int, float)) for v in pts):
            x1, y1, x2, y2 = (float(v) for v in pts)
            return [min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)]
        xs: list[float] = []
        ys: list[float] = []
        for p in pts:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                xs.append(float(p[0]))
                ys.append(float(p[1]))
            elif hasattr(p, "__iter__"):
                seq = list(p)
                if len(seq) >= 2:
                    xs.append(float(seq[0]))
                    ys.append(float(seq[1]))
        if xs and ys:
            return [min(xs), min(ys), max(xs), max(ys)]
    except (TypeError, ValueError):
        pass
    return [0.0, 0.0, 0.0, 0.0]


def _lines_from_pymupdf_dict(td: dict[str, Any]) -> list[OcrLine]:
    lines: list[OcrLine] = []
    for block in td.get("blocks") or []:
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines") or []:
            spans = line.get("spans") or []
            text = "".join(str(s.get("text", "")) for s in spans).strip()
            if not text:
                continue
            bbox_raw = line.get("bbox") or block.get("bbox") or [0, 0, 0, 0]
            bbox = [float(v) for v in bbox_raw[:4]]
            while len(bbox) < 4:
                bbox.append(0.0)
            lines.append(OcrLine(text=text, confidence=1.0, bbox=bbox))
    return lines


def paddleocr_available() -> bool:
    try:
        import paddleocr  # noqa: F401

        return True
    except ImportError:
        return False


def get_ocr_engine(name: str | None = None) -> OcrEngine:
    settings = get_settings()
    choice = (name or settings.ocr_engine or "auto").strip().lower()
    if choice == "auto":
        if paddleocr_available():
            return PaddleOcrEngine(lang=settings.ocr_paddle_lang)
        return PyMuPdfTextEngine()
    if choice == "paddleocr":
        return PaddleOcrEngine(lang=settings.ocr_paddle_lang)
    if choice in {"pymupdf_text", "pymupdf", "text"}:
        return PyMuPdfTextEngine()
    raise OcrError("OCR_ENGINE_ERROR", f"Unknown OCR_ENGINE={choice!r}")


def _iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _checksum_label(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    return raw if raw.startswith("sha256:") else f"sha256:{raw}"


def _next_ocr_artifact_key(job_id: int) -> str:
    """Immutable artifact path; version suffix if ocr-output.json already exists."""
    base = build_job_artifact_key(job_id, OCR_ARTIFACT_NAME)
    path = resolve_storage_path(base)
    if not path.exists():
        return base
    n = 2
    while True:
        key = build_job_artifact_key(job_id, f"ocr-output.v{n}.json")
        if not resolve_storage_path(key).exists():
            return key
        n += 1


def write_ocr_artifact(job_id: int, artifact: dict[str, Any]) -> str:
    """Write OCR JSON to disk; returns storage_key."""
    key = _next_ocr_artifact_key(job_id)
    path = resolve_storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return key


def load_ocr_artifact(storage_key: str) -> dict[str, Any] | None:
    if not storage_key:
        return None
    path = resolve_storage_path(storage_key)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _render_pdf_page(pdf_path: Path, page_index: int, *, dpi: int) -> tuple[Image.Image, int, int]:
    import pymupdf

    with pymupdf.open(pdf_path) as doc:
        page = doc[page_index]
        zoom = dpi / 72.0
        mat = pymupdf.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        return img, pix.width, pix.height


def _pdf_page_count(pdf_path: Path) -> int:
    import pymupdf

    with pymupdf.open(pdf_path) as doc:
        if doc.is_encrypted:
            # Empty password attempt; still encrypted → fail.
            if not doc.authenticate(""):
                raise OcrError("PDF_ENCRYPTED", "PDF is encrypted and cannot be opened")
        return doc.page_count


def _page_result_from_lines(
    *,
    page_number: int,
    width: int,
    height: int,
    lines: list[OcrLine],
) -> OcrPageResult:
    full_text = "\n".join(ln.text for ln in lines if ln.text.strip())
    status = "ok" if full_text.strip() else "low_quality"
    return OcrPageResult(
        page_number=page_number,
        width=width,
        height=height,
        status=status,
        lines=lines,
        full_text=full_text,
    )


def ocr_document(
    source_path: Path,
    *,
    engine: OcrEngine | None = None,
    dpi: int | None = None,
    max_pages: int | None = None,
    max_pixels: int | None = None,
) -> tuple[list[OcrPageResult], list[str], OcrEngine]:
    """
    OCR a PDF or image file. Returns (pages, top-level errors, engine_used).
    """
    settings = get_settings()
    eng = engine or get_ocr_engine()
    dpi = dpi if dpi is not None else settings.ocr_dpi
    max_pages = max_pages if max_pages is not None else settings.ocr_max_pages
    max_pixels = max_pixels if max_pixels is not None else settings.ocr_max_image_pixels

    if not source_path.is_file():
        raise OcrError("SOURCE_FILE_MISSING", f"Source file not found: {source_path}")

    suffix = source_path.suffix.lower()
    pages: list[OcrPageResult] = []
    errors: list[str] = []

    if suffix == ".pdf":
        try:
            count = _pdf_page_count(source_path)
        except OcrError:
            raise
        except Exception as exc:
            raise OcrError("OCR_ENGINE_ERROR", f"Failed to open PDF: {exc}") from exc

        if count > max_pages:
            raise OcrError(
                "OCR_TOO_MANY_PAGES",
                f"PDF has {count} pages; max allowed is {max_pages}",
            )

        for i in range(count):
            page_number = i + 1
            try:
                native = eng.recognize_pdf_page(source_path, i)
                if native is not None:
                    import pymupdf

                    with pymupdf.open(source_path) as doc:
                        page = doc[i]
                        rect = page.rect
                        width, height = int(rect.width), int(rect.height)
                    pages.append(
                        _page_result_from_lines(
                            page_number=page_number,
                            width=width,
                            height=height,
                            lines=native,
                        )
                    )
                    continue

                image, width, height = _render_pdf_page(source_path, i, dpi=dpi)
                if width * height > max_pixels:
                    pages.append(
                        OcrPageResult(
                            page_number=page_number,
                            width=width,
                            height=height,
                            status="error",
                            lines=[],
                            full_text="",
                            error="page exceeds OCR_MAX_IMAGE_PIXELS",
                        )
                    )
                    errors.append(f"page {page_number}: pixel limit exceeded")
                    continue
                lines = eng.recognize_image(image)
                pages.append(
                    _page_result_from_lines(
                        page_number=page_number,
                        width=width,
                        height=height,
                        lines=lines,
                    )
                )
            except OcrError:
                raise
            except Exception as exc:
                logger.exception("OCR failed on PDF page %s", page_number)
                pages.append(
                    OcrPageResult(
                        page_number=page_number,
                        width=0,
                        height=0,
                        status="error",
                        lines=[],
                        full_text="",
                        error=str(exc),
                    )
                )
                errors.append(f"page {page_number}: {exc}")

    elif suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"}:
        try:
            image = Image.open(source_path)
            image.load()
            image = image.convert("RGB")
        except Exception as exc:
            raise OcrError("OCR_ENGINE_ERROR", f"Failed to open image: {exc}") from exc

        width, height = image.size
        if width * height > max_pixels:
            raise OcrError(
                "OCR_ENGINE_ERROR",
                f"Image {width}x{height} exceeds OCR_MAX_IMAGE_PIXELS ({max_pixels})",
            )
        try:
            lines = eng.recognize_image(image)
            pages.append(
                _page_result_from_lines(
                    page_number=1,
                    width=width,
                    height=height,
                    lines=lines,
                )
            )
        except OcrError:
            raise
        except Exception as exc:
            raise OcrError("OCR_ENGINE_ERROR", f"OCR engine crash: {exc}") from exc
    else:
        raise OcrError("UNSUPPORTED_FILE_TYPE", f"Unsupported OCR file type: {suffix}")

    return pages, errors, eng


def build_ocr_artifact(
    *,
    job_id: int,
    staged_document_id: int,
    source_checksum: str,
    pages: list[OcrPageResult],
    engine: OcrEngine,
    errors: list[str],
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "jobId": str(job_id),
        "stagedDocumentId": str(staged_document_id),
        "sourceChecksum": _checksum_label(source_checksum),
        "engine": engine.name,
        "engineVersion": engine.version,
        "processedAt": _iso_now(),
        "pages": [
            {
                "pageNumber": p.page_number,
                "width": p.width,
                "height": p.height,
                "status": p.status,
                "lines": [
                    {
                        "text": ln.text,
                        "confidence": ln.confidence,
                        "bbox": ln.bbox,
                    }
                    for ln in p.lines
                ],
                "fullText": p.full_text,
                **({"error": p.error} if p.error else {}),
            }
            for p in pages
        ],
        "errors": errors,
    }


def run_ocr_stage(
    db: Session,
    job: AiRegistrationJob,
    *,
    engine: OcrEngine | None = None,
    actor: str | None = None,
) -> AiRegistrationJob:
    """
    Run OCR for a job in QUEUED or PROCESSING, write ocr-output.json, update job.

    Success → OCR_COMPLETE (or NEEDS_REVIEW if all pages empty).
    Failure → FAILED with error_code.
    """
    started = time.perf_counter()
    actor = actor or job.created_by or "system"

    if job.status == JobStatus.QUEUED.value:
        transition_job(db, job, new_status=JobStatus.PROCESSING)
    elif job.status != JobStatus.PROCESSING.value:
        raise OcrError(
            "INVALID_JOB_STATUS",
            f"OCR requires QUEUED or PROCESSING (current={job.status})",
        )

    staged = (
        db.query(AiStagedDocument)
        .filter(AiStagedDocument.id == job.staged_document_id)
        .one_or_none()
    )
    if staged is None:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="SOURCE_FILE_MISSING",
            error_message="Staged document not found",
        )
        return job

    try:
        source_path = resolve_storage_path(staged.storage_key)
    except Exception as exc:
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="SOURCE_FILE_MISSING",
            error_message=str(exc),
        )
        return job

    run = AiRun(
        job_id=job.id,
        stage="ocr",
        model_id="",
        prompt_version="",
        input_artifact_key=staged.storage_key,
        output_artifact_key="",
        status="running",
        error_message="",
    )
    db.add(run)
    db.flush()

    try:
        pages, errors, eng = ocr_document(source_path, engine=engine)
        artifact = build_ocr_artifact(
            job_id=job.id,
            staged_document_id=staged.id,
            source_checksum=staged.checksum,
            pages=pages,
            engine=eng,
            errors=errors,
        )
        artifact_key = write_ocr_artifact(job.id, artifact)
        job.ocr_artifact_key = artifact_key
        run.output_artifact_key = artifact_key
        run.model_id = f"{eng.name}:{eng.version}"
        run.latency_ms = int((time.perf_counter() - started) * 1000)

        all_empty = not any((p.full_text or "").strip() for p in pages)
        if all_empty:
            # Spec decision: prefer NEEDS_REVIEW with empty proposal when OCR yields no text.
            job.proposal_json = json.dumps(
                {"schemaVersion": 1, "fields": {}, "warnings": ["EMPTY_OCR"]},
                ensure_ascii=False,
            )
            transition_job(db, job, new_status=JobStatus.NEEDS_REVIEW)
            run.status = "empty"
            run.error_message = "OCR produced no text on any page"
        else:
            transition_job(db, job, new_status=JobStatus.OCR_COMPLETE)
            run.status = "ok"

        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="OCR Complete",
            record=str(job.id),
            description=f"OCR {run.status} engine={eng.name} artifact={artifact_key}",
        )
        db.flush()
        logger.info(
            "OCR stage done job_id=%s status=%s engine=%s key=%s",
            job.id,
            job.status,
            eng.name,
            artifact_key,
        )
        return job

    except OcrError as exc:
        run.status = "failed"
        run.error_message = exc.message
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code=exc.code,
            error_message=exc.message,
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="OCR Failed",
            record=str(job.id),
            description=f"{exc.code}: {exc.message}",
        )
        db.flush()
        logger.warning("OCR stage failed job_id=%s code=%s", job.id, exc.code)
        return job
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        transition_job(
            db,
            job,
            new_status=JobStatus.FAILED,
            error_code="OCR_ENGINE_ERROR",
            error_message=f"OCR engine crash: {exc}",
        )
        add_audit(
            db,
            user=actor,
            module="AI Registration",
            action="OCR Failed",
            record=str(job.id),
            description=f"OCR_ENGINE_ERROR: {exc}",
        )
        db.flush()
        logger.exception("OCR stage crashed job_id=%s", job.id)
        return job
