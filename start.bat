@echo off
cd /d "%~dp0"
start /B python -m http.server 8000
echo Server started at http://localhost:8000
echo Press Ctrl+C to stop the server
timeout /t 2 >nul
start http://localhost:8000