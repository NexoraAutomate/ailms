@echo off
setlocal

set "BACKEND=C:\Project files\AILMS\backend"
set "FRONTEND=C:\Project files\AILMS\frontend"
set "VENV_ACTIVATE=%BACKEND%\.venv\Scripts\activate.bat"

if not exist "%VENV_ACTIVATE%" (
    echo Virtual environment not found: %VENV_ACTIVATE%
    exit /b 1
)

echo Starting AILMS backend (uvicorn)...
start "AILMS Backend" /D "%BACKEND%" cmd /k "call .venv\Scripts\activate.bat && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

echo Starting AILMS frontend (npm run dev)...
start "AILMS Frontend" /D "%FRONTEND%" cmd /k "npm run dev"

echo.
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://localhost:3000
echo Run stop.bat to shut down both servers.

endlocal
