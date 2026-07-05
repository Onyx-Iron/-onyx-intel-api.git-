@echo off
title Onyx Intel — Plan Reader ^& Takeoff
cd /d "%~dp0"

echo.
echo  =========================================
echo   ONYX INTEL ^| Onyx ^& Iron Construction
echo  =========================================
echo.

if not exist node_modules (
  echo  Installing dependencies — one-time setup, please wait...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed.
    echo  Make sure Node.js 18+ is installed: https://nodejs.org
    echo.
    pause
    exit /b 1
  )
  echo.
)

if not exist examples\sample-plans.pdf (
  echo  Generating sample plan set...
  call npm run sample 2>nul
  echo.
)

echo  Starting server...
echo.
echo  Open your browser to:  http://localhost:3100
echo.
echo  First time? Click the gear icon (top-left) to add your API key.
echo  Takeoffs work without an API key.
echo.
echo  Press Ctrl+C to stop the server.
echo  =========================================
echo.

node server.js
pause
