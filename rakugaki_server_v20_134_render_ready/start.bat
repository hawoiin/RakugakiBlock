@echo off
cd /d "%~dp0"

echo ========================================
echo  Rakugaki Block Server
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install from https://nodejs.org/
  goto END
)

if not exist "server.js" (
  echo [ERROR] server.js not found.
  goto END
)

if not exist "node_modules\ws" (
  echo Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    goto END
  )
  echo.
)

REM --- settings (edit here) ---
set PORT=3040
REM For admin access, set ADMIN_PASSWORD in the environment or in a local .env file.
REM set JOIN_PASSWORD=
REM set TRUST_PROXY=1

echo Port: %PORT%
echo Admin password: %ADMIN_PASSWORD%
echo.
echo Open in browser:
echo   http://localhost:%PORT%/
echo.
echo Stop: Ctrl+C
echo ========================================
echo.

node server.js
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo [ERROR] Server exited with code %EXITCODE%
) else (
  echo Server stopped.
)

:END
echo.
pause
