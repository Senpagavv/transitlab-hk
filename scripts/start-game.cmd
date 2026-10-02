@echo off
rem TransitLab HK - double-click to play the demo: starts the engine (port 8000) and opens /game in the browser.
chcp 65001 >nul
cd /d "%~dp0.."
start "" /b cmd /c "timeout /t 6 >nul & start http://127.0.0.1:8000/game/"
uv run uvicorn backend.main:app --port 8000
pause
