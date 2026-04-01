@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo RESTART FOOD PRINT AGENT (WINDOWS MODE)
echo ========================================

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9393 ^| findstr LISTENING') do (
  echo Killing process on port 9393: %%a
  taskkill /PID %%a /F >nul 2>&1
)

set PRINT_MODE=windows
set LISTEN_HOST=0.0.0.0
set LISTEN_PORT=9393
set LINE_WIDTH=42

echo Starting agent...
start "Food Print Agent" cmd /k node agent.js

echo Done.
endlocal