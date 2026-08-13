@echo off
REM ============================================================
REM  Dental OS - End of Session Commit  v1
REM  Stages everything, commits, and pushes to GitHub (main).
REM  Safe to run even if nothing changed.
REM ============================================================

setlocal

set "ROOT=C:\Users\shadm\dental-os-app\dental-os-app"

cd /d "%ROOT%" 2>nul
if errorlevel 1 (
  echo ERROR: Could not open "%ROOT%"
  echo Edit the ROOT line in this batch file.
  pause
  exit /b 1
)

if not exist "%ROOT%\.git" (
  echo ERROR: "%ROOT%" is not a Git repository.
  pause
  exit /b 1
)

git --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git is not available in this window.
  echo Close this window, open a NEW Command Prompt, and run this again.
  pause
  exit /b 1
)

echo ============================================================
echo  Files changed since your last commit:
echo ============================================================
git status --short
echo.

REM --- Stop early if there is nothing to commit ---
git diff --quiet
set "UNSTAGED=%errorlevel%"
git diff --cached --quiet
set "STAGED=%errorlevel%"
for /f %%U in ('git ls-files --others --exclude-standard ^| find /c /v ""') do set "UNTRACKED=%%U"

if "%UNSTAGED%"=="0" if "%STAGED%"=="0" if "%UNTRACKED%"=="0" (
  echo Nothing has changed. No commit needed.
  echo.
  pause
  exit /b 0
)

echo ============================================================
set /p MSG=Describe this session in a few words: 
if "%MSG%"=="" set "MSG=Session update"

echo.
echo Committing as: %MSG%
echo.

git add -A
if errorlevel 1 goto :failed

git commit -m "%MSG%"
if errorlevel 1 goto :failed

echo.
echo Pushing to GitHub...
git push
if errorlevel 1 goto :pushfailed

echo.
echo ============================================================
echo  Done. Committed and pushed.
echo  Vercel will redeploy automatically in a minute or two.
echo ============================================================
echo.
git log -1 --stat
echo.
pause
endlocal
exit /b 0

:failed
echo.
echo ============================================================
echo  Something went wrong before pushing.
echo  Nothing was sent to GitHub. Copy the message above and
echo  paste it into the chat.
echo ============================================================
echo.
pause
exit /b 1

:pushfailed
echo.
echo ============================================================
echo  The commit was saved locally but the push failed.
echo  Your work is NOT lost. Copy the message above and paste
echo  it into the chat.
echo ============================================================
echo.
pause
exit /b 1
