#!/usr/bin/env python3
"""Run a single AI registration job stage (debug CLI).

Usage (from backend/):
  python scripts/run_ai_job.py --job-id 7 --stage ocr
  python scripts/run_ai_job.py --job-id 7 --stage normalize
  python scripts/run_ai_job.py --job-id 7 --stage extract
  python scripts/run_ai_job.py --job-id 7 --stage validate
  python scripts/run_ai_job.py --job-id 7 --stage all

Stages:
  ocr — run OCR and write storage/ai/jobs/{id}/ocr-output.json
  normalize — build llm-input.json/.txt from OCR (requires OCR_COMPLETE)
  extract — LLM structured extraction → extraction-result.json (requires llm-input)
  validate — business validation → validation-result.json + NEEDS_REVIEW
  all — full pipeline (OCR → normalize → extract → validate)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.ai.extraction_service import load_extraction_artifact  # noqa: E402
from app.ai.job_worker import (  # noqa: E402
    run_extraction_for_job_id,
    run_normalize_for_job_id,
    run_ocr_for_job_id,
    run_pipeline_for_job_id,
    run_validation_for_job_id,
)
from app.ai.ocr_normalize import load_normalized_artifact  # noqa: E402
from app.ai.ocr_service import load_ocr_artifact  # noqa: E402
from app.ai.validation_service import load_validation_artifact  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.db_upgrade import upgrade_ai_registration_schema  # noqa: E402
from app.database import engine  # noqa: E402
from app.storage_service import ensure_storage_dirs  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AI registration job stage")
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument(
        "--stage",
        choices=("ocr", "normalize", "extract", "validate", "all"),
        default="ocr",
        help="Pipeline stage to run",
    )
    args = parser.parse_args()

    upgrade_ai_registration_schema(engine)
    ensure_storage_dirs()

    db = SessionLocal()
    try:
        if args.stage == "all":
            job = run_pipeline_for_job_id(db, args.job_id)
            db.commit()
            db.refresh(job)
            print(
                f"jobId={job.id} status={job.status} "
                f"ocr={job.ocr_artifact_key!r} "
                f"normalized={job.normalized_artifact_key!r} "
                f"extraction={job.extraction_artifact_key!r} "
                f"validation={job.validation_artifact_key!r}"
            )
            if job.error_code:
                print(f"errorCode={job.error_code} errorMessage={job.error_message}")
            return 0 if job.status == "NEEDS_REVIEW" else 1

        if args.stage == "ocr":
            job = run_ocr_for_job_id(db, args.job_id)
            db.commit()
            db.refresh(job)
            print(f"jobId={job.id} status={job.status} ocrArtifactKey={job.ocr_artifact_key}")
            if job.error_code:
                print(f"errorCode={job.error_code} errorMessage={job.error_message}")
            artifact = load_ocr_artifact(job.ocr_artifact_key)
            if artifact:
                pages = artifact.get("pages") or []
                print(f"pages={len(pages)} engine={artifact.get('engine')}")
                if pages:
                    preview = (pages[0].get("fullText") or "")[:200]
                    print(f"page1_fullText_preview={json.dumps(preview)}")
            return 0 if job.status in {"OCR_COMPLETE", "NEEDS_REVIEW"} else 1

        if args.stage == "normalize":
            job = run_normalize_for_job_id(db, args.job_id)
            db.commit()
            db.refresh(job)
            print(
                f"jobId={job.id} status={job.status} "
                f"normalizedArtifactKey={job.normalized_artifact_key}"
            )
            if job.error_code:
                print(f"errorCode={job.error_code} errorMessage={job.error_message}")
            artifact = load_normalized_artifact(job.normalized_artifact_key)
            if artifact:
                print(
                    f"pageCount={artifact.get('pageCount')} "
                    f"truncated={artifact.get('truncated')}"
                )
                preview = (artifact.get("combinedText") or "")[:300]
                print(f"combinedText_preview={json.dumps(preview)}")
            return 0 if job.status == "OCR_COMPLETE" and job.normalized_artifact_key else 1

        if args.stage == "extract":
            job = run_extraction_for_job_id(db, args.job_id)
            db.commit()
            db.refresh(job)
            print(
                f"jobId={job.id} status={job.status} "
                f"extractionArtifactKey={job.extraction_artifact_key} "
                f"promptVersion={job.prompt_version} modelId={job.model_id}"
            )
            if job.error_code:
                print(f"errorCode={job.error_code} errorMessage={job.error_message}")
            artifact = load_extraction_artifact(job.extraction_artifact_key)
            if artifact:
                fields = artifact.get("fields") or {}
                number = (fields.get("number") or {}).get("value")
                subject = (fields.get("subject") or {}).get("value")
                print(f"number={number!r} subject={subject!r}")
                print(f"warnings={artifact.get('warnings')}")
            return 0 if job.status == "EXTRACTION_COMPLETE" else 1

        if args.stage == "validate":
            job = run_validation_for_job_id(db, args.job_id)
            db.commit()
            db.refresh(job)
            print(
                f"jobId={job.id} status={job.status} "
                f"validationArtifactKey={job.validation_artifact_key}"
            )
            if job.error_code:
                print(f"errorCode={job.error_code} errorMessage={job.error_message}")
            artifact = load_validation_artifact(job.validation_artifact_key)
            if artifact:
                print(f"passed={artifact.get('passed')}")
                print(f"blockingErrors={artifact.get('blockingErrors')}")
                print(f"fieldIssues={json.dumps(artifact.get('fieldIssues') or {})}")
                proposal = artifact.get("normalizedProposal") or {}
                print(
                    f"proposal.number={proposal.get('number')!r} "
                    f"proposal.priority={proposal.get('priority')!r} "
                    f"proposal.department={proposal.get('department')!r}"
                )
            return 0 if job.status == "NEEDS_REVIEW" else 1

        print(f"Unknown stage: {args.stage}", file=sys.stderr)
        return 2
    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
