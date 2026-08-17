@echo off
REM ============================================================
REM  Dental OS - Session Sync  v1.2  (launcher)
REM
REM  Double-click this. It runs _session-sync.ps1, which must be
REM  sitting in the same folder. All the logic lives there; this
REM  file only finds it, runs it, and keeps the window open.
REM
REM  Note on version numbers, because there are two of them:
REM  this file and _session-sync.ps1 carry their own versions,
REM  and the pack the script writes carries a separate format
REM  version on its first line. They are unrelated. A pack that
REM  says SOURCE PACK v6 or later contains both sync scripts.
REM
REM  Changelog:
REM    v1    First cut.
REM    v1.1  No behaviour change. Version bumped so the launcher and
REM          the script it launches can be told apart in a pack, now
REM          that both are carried in one.
REM    v1.2  No behaviour change. Dropped the line naming the two
REM          scripts this one replaced - they are long gone, and the
REM          v4 in one of those filenames read as a pack format
REM          version. Added the note above so it cannot again.
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
