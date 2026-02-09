@echo off
echo Starting HTTP server...
echo.
echo Open http://localhost:8000/index.html in your browser
echo Press Ctrl+C to stop the server
echo.
cd /d "%~dp0"
python server.py
