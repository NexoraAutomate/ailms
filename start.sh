#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PYTHON="$BACKEND/venv/Scripts/python.exe"

if [[ ! -x "$PYTHON" && ! -f "$PYTHON" ]]; then
  # Unix-style venv layout (non-Windows)
  if [[ -x "$BACKEND/venv/bin/python" ]]; then
    PYTHON="$BACKEND/venv/bin/python"
  else
    echo "Virtual environment not found: $BACKEND/venv"
    echo "Create it with: python -m venv backend/venv"
    exit 1
  fi
fi

cleanup() {
  echo
  echo "Stopping servers..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting AILMS backend (uvicorn)..."
(
  cd "$BACKEND"
  if [[ "$PYTHON" == *"/Scripts/python.exe" ]]; then
    ./venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
  else
    "$PYTHON" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
  fi
) &
BACKEND_PID=$!

echo "Starting AILMS frontend..."
(
  cd "$FRONTEND"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm dev
  else
    npm run dev
  fi
) &
FRONTEND_PID=$!

echo
echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: http://localhost:3000"
echo "Press Ctrl+C to stop both servers."
echo

wait
