#!/usr/bin/env python3
"""Cross-platform AI registration E2E acceptance (master plan step 14 / spec 12).

Usage (from repo root or backend/):
  python backend/scripts/run_acceptance_ai_registration.py
  python backend/scripts/run_acceptance_ai_registration.py --live
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FIXTURE_SCRIPT = ROOT / "fixtures" / "ai-letter-registration" / "scripts" / "generate_fixtures.py"


def _run(cmd: list[str], *, cwd: Path) -> None:
    print("->", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=str(cwd))


def main() -> int:
    parser = argparse.ArgumentParser(description="AI registration E2E acceptance")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Also run pytest -m live (requires healthy Ollama)",
    )
    args = parser.parse_args()
    py = sys.executable

    _run([py, str(FIXTURE_SCRIPT)], cwd=ROOT)
    _run([py, str(FIXTURE_SCRIPT), "--check"], cwd=ROOT)

    pytest_cmd = [
        py,
        "-m",
        "pytest",
        "tests/test_ai_registration_e2e.py",
        "-m",
        "not live",
        "-v",
        "--tb=short",
    ]
    _run(pytest_cmd, cwd=BACKEND)

    if args.live:
        live_cmd = [
            py,
            "-m",
            "pytest",
            "tests/test_ai_registration_e2e.py",
            "-m",
            "live",
            "-v",
            "--tb=short",
        ]
        _run(live_cmd, cwd=BACKEND)

    print("OK: AI registration acceptance passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode) from exc
