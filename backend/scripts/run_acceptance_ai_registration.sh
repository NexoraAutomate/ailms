#!/usr/bin/env bash
# AI letter registration E2E acceptance (master plan step 14 / spec 12).
# Runs mocked CI suite by default. Pass --live to include Ollama live marker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
FIXTURE_SCRIPT="$ROOT/fixtures/ai-letter-registration/scripts/generate_fixtures.py"

if [[ -x "$BACKEND/venv/Scripts/python.exe" ]]; then
  PYTHON="$BACKEND/venv/Scripts/python.exe"
elif [[ -x "$BACKEND/venv/bin/python" ]]; then
  PYTHON="$BACKEND/venv/bin/python"
else
  PYTHON="${PYTHON:-python}"
fi

LIVE=0
for arg in "$@"; do
  case "$arg" in
    --live|-l) LIVE=1 ;;
    --help|-h)
      echo "Usage: $0 [--live]"
      echo "  (default) mocked LLM E2E + fixture check"
      echo "  --live    also run pytest -m live (requires Ollama)"
      exit 0
      ;;
  esac
done

echo "==> Checking / generating fixtures"
"$PYTHON" "$FIXTURE_SCRIPT"
"$PYTHON" "$FIXTURE_SCRIPT" --check

echo "==> Running mocked E2E acceptance"
cd "$BACKEND"
"$PYTHON" -m pytest tests/test_ai_registration_e2e.py -m "not live" -v --tb=short

if [[ "$LIVE" -eq 1 ]]; then
  echo "==> Running live E2E (Ollama)"
  "$PYTHON" -m pytest tests/test_ai_registration_e2e.py -m live -v --tb=short
fi

echo "OK: AI registration acceptance passed"
