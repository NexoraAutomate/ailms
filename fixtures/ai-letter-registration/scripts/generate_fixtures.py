#!/usr/bin/env python3
"""Generate (or --check) AI letter registration PDF fixtures.

Usage (from repo root or this directory):
  python fixtures/ai-letter-registration/scripts/generate_fixtures.py
  python fixtures/ai-letter-registration/scripts/generate_fixtures.py --check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _write_sample_01(path: Path) -> None:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    for x, y, text in [
        (72, 72, "Ref: MOIT/2026/1234"),
        (72, 100, "Date: 15 March 2026"),
        (72, 140, "Subject: Request for quarterly progress update"),
        (72, 180, "From: Ministry of Information Technology"),
        (72, 208, "To: Planning Division"),
        (72, 250, "Dear Sir/Madam,"),
        (72, 280, "Please find attached the quarterly progress update for review."),
        (72, 310, "Action required: Acknowledge receipt by 30 March 2026."),
        (72, 360, "Yours sincerely,"),
        (72, 390, "A. Example"),
    ]:
        page.insert_text((x, y), text, fontsize=11)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    doc.close()


def _write_sample_06(path: Path) -> None:
    import pymupdf

    doc = pymupdf.open()
    p1 = doc.new_page(width=612, height=792)
    p1.insert_text((72, 72), "Ref: FIXTURE-MULTI-001", fontsize=12)
    p1.insert_text((72, 110), "Page 1 of 3 — cover", fontsize=11)
    p2 = doc.new_page(width=612, height=792)
    p2.insert_text((72, 72), "Page 2 body text for context.", fontsize=11)
    p3 = doc.new_page(width=612, height=792)
    p3.insert_text((72, 72), "Page 3 — Action: Submit reply within 7 days.", fontsize=11)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    doc.close()


FIXTURES = {
    "sample-01-typed-letter.pdf": _write_sample_01,
    "sample-06-multipage.pdf": _write_sample_06,
}


def generate() -> None:
    for name, writer in FIXTURES.items():
        writer(ROOT / name)
        print(f"wrote {ROOT / name}")


def check() -> int:
    missing = [name for name in FIXTURES if not (ROOT / name).is_file()]
    if missing:
        print(f"MISSING: {', '.join(missing)}", file=sys.stderr)
        return 1
    print("OK: required fixtures present")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        return check()
    generate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
