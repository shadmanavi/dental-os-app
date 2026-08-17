@echo off
REM ============================================================
REM  Dental OS - Session Sync  v1.1  (launcher)
REM
REM  Double-click this. It runs _session-sync.ps1, which must be
REM  sitting in the same folder.
REM
REM  Replaces both _pack-frontend-v4.bat and
REM  _end-session-commit.bat. Delete those once this works.
REM
REM  Changelog:
REM    v1    First cut.
REM    v1.1  No behaviour change. Version bumped so the launcher and
REM          the script it launches can be told apart in a pack, now
REM          that both are carried in one.
REM ============================================================

setlocal

set "HERE=%~dp0"
set "PS1=%HERE%_session-sync.ps1"

if not exist "%PS1%" (
  echo.
  echo ============================================================
  echo   CANNOT START
  echo ============================================================
  echo   _session-sync.ps1 was not found next to this file.
  echo.
  echo   Looked for:
  echo   %PS1%
  echo.
  echo   Put both files in the same folder and try again.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

where powershell >nul 2>&1
if errorlevel 1 (
  echo.
  echo ============================================================
  echo   CANNOT START
  echo ============================================================
  echo   Windows PowerShell was not found on this machine.
  echo   Screenshot this and paste it into the chat.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%errorlevel%"

echo.
if "%RC%"=="0" (
  echo Finished cleanly. Press any key to close.
) else (
  echo Finished with a problem. Screenshot the window above
  echo before closing it.
)
pause
endlocal
exit /b %RC%
