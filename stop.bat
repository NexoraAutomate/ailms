@echo off
setlocal enabledelayedexpansion

echo Stopping AILMS servers...

call :KillPort 8000
call :KillPort 3000

echo Done.
endlocal
exit /b 0

:KillPort
set "PORT=%~1"
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":%PORT%" ^| findstr LISTENING') do (
    taskkill /F /PID %%p >nul 2>&1
    if !errorlevel! equ 0 echo Stopped process on port %PORT% ^(PID %%p^)
)
exit /b 0
