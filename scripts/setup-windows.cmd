@echo off
rem TransitLab HK - double-click to set up everything on Windows (runs setup-windows.ps1).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
echo.
pause
