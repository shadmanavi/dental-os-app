@echo off
REM ============================================================
REM  Dental OS - Source Packer  v4
REM  Scans app\, lib\, supabase\functions\, supabase\migrations\
REM  plus root config files.
REM  Never enters node_modules, so it finishes in seconds.
REM
REM  Changelog:
REM    v3  app\ and lib\ plus root config only.
REM    v4  Adds Edge Functions and migrations. The v3 pack was
REM        titled FRONTEND and behaved that way, which meant an
REM        Edge Function written in a session and never deployed
REM        was invisible to the next one. Masks are limited to
REM        .ts .tsx .js .jsx .css .sql .toml .json so .env and
REM        .env.local can never be picked up.
REM ============================================================

setlocal enabledelayedexpansion

set "ROOT=C:\Users\shadm\dental-os-app\dental-os-app"
set "OUT=%ROOT%\dental-os-pack.txt"
set "LIST=%ROOT%\_pack_filelist.tmp"

if not exist "%ROOT%\package.json" (
  echo ERROR: package.json not found in "%ROOT%"
  echo Edit the ROOT line in this batch file.
  pause
  exit /b 1
)

if exist "%OUT%" del "%OUT%"
if exist "%LIST%" del "%LIST%"

echo Building file tree...

>>"%OUT%" echo ===== DENTAL OS SOURCE PACK v4 =====
>>"%OUT%" echo ===== ROOT: %ROOT%
>>"%OUT%" echo.
>>"%OUT%" echo ===== ROOT FOLDER (top level only) =====
dir /b "%ROOT%" >>"%OUT%" 2>nul
>>"%OUT%" echo.
>>"%OUT%" echo ===== TREE: app =====
dir /s /b "%ROOT%\app" >>"%OUT%" 2>nul
>>"%OUT%" echo.
>>"%OUT%" echo ===== TREE: lib =====
dir /s /b "%ROOT%\lib" >>"%OUT%" 2>nul
>>"%OUT%" echo.
>>"%OUT%" echo ===== TREE: supabase\functions =====
dir /s /b "%ROOT%\supabase\functions" >>"%OUT%" 2>nul
>>"%OUT%" echo.
>>"%OUT%" echo ===== TREE: supabase\migrations =====
dir /s /b "%ROOT%\supabase\migrations" >>"%OUT%" 2>nul
>>"%OUT%" echo.

echo Collecting source files...

if exist "%ROOT%\app" dir /s /b /a-d "%ROOT%\app\*.ts" "%ROOT%\app\*.tsx" "%ROOT%\app\*.js" "%ROOT%\app\*.jsx" "%ROOT%\app\*.css" >> "%LIST%" 2>nul
if exist "%ROOT%\lib" dir /s /b /a-d "%ROOT%\lib\*.ts" "%ROOT%\lib\*.tsx" "%ROOT%\lib\*.js" "%ROOT%\lib\*.jsx" >> "%LIST%" 2>nul
if exist "%ROOT%\supabase\functions" dir /s /b /a-d "%ROOT%\supabase\functions\*.ts" "%ROOT%\supabase\functions\*.json" "%ROOT%\supabase\functions\*.jsonc" >> "%LIST%" 2>nul
if exist "%ROOT%\supabase\migrations" dir /s /b /a-d "%ROOT%\supabase\migrations\*.sql" >> "%LIST%" 2>nul
if exist "%ROOT%\supabase\config.toml" >>"%LIST%" echo %ROOT%\supabase\config.toml

for %%N in (package.json tsconfig.json middleware.ts next.config.js next.config.mjs next.config.ts tailwind.config.js tailwind.config.ts postcss.config.js postcss.config.mjs) do (
  if exist "%ROOT%\%%N" >>"%LIST%" echo %ROOT%\%%N
)

set /a COUNT=0
for /f "usebackq delims=" %%F in ("%LIST%") do (
  set /a COUNT+=1
  call :add "%%F"
)

if exist "%LIST%" del "%LIST%"

echo.
echo Done. !COUNT! files packed.
echo Output file: %OUT%
echo Upload that file to the chat.
echo.
pause
endlocal
exit /b 0

:add
set "F=%~1"
set "REL=!F:%ROOT%\=!"
echo   + !REL!
>>"%OUT%" echo.
>>"%OUT%" echo ============================================================
>>"%OUT%" echo ===== FILE: !REL!
>>"%OUT%" echo ============================================================
type "!F!" >>"%OUT%" 2>nul
>>"%OUT%" echo.
exit /b 0
