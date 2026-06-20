@echo off
REM ===================================================================
REM  Nutrition Tracker — local HTTP server start script (Windows)
REM  Serves the current folder on port 8080 via server.py
REM  (a small wrapper around Python's http.server that suppresses harmless
REM  connection-reset noise on macOS / Python 3.14, also useful on Windows).
REM
REM  Usage:
REM     Double-click this file, or run from Command Prompt / PowerShell.
REM     Press Ctrl+C in the window to stop the server.
REM ===================================================================

setlocal
set PORT=8080
set SCRIPT_DIR=%~dp0
set APP_PAGE=nutrition_logger_v6.html
set PY=

REM ---------- Find Python 3 (try py launcher, then python, then python3) ----------

REM 1) Python Launcher for Windows (preferred — installed by python.org installer)
py -3 --version >nul 2>&1
if not errorlevel 1 (
    set PY=py -3
    goto :found_python
)

REM 2) Plain "python" — verify it's Python 3, not Python 2
python --version >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)" >nul 2>&1
    if not errorlevel 1 (
        set PY=python
        goto :found_python
    )
)

REM 3) "python3" — less common on Windows but try anyway
python3 --version >nul 2>&1
if not errorlevel 1 (
    set PY=python3
    goto :found_python
)

REM ---------- Python not found ----------
echo.
echo  ERROR: Python 3 is not installed, or it is not on your PATH.
echo.
echo  How to install:
echo     1. Go to https://www.python.org/downloads/
echo     2. Download the latest Python 3 installer for Windows
echo     3. Run the installer
echo     4. IMPORTANT: Check the box "Add Python to PATH" on the first screen
echo     5. Click "Install Now"
echo     6. After install completes, double-click this file again
echo.
pause
exit /b 1


:found_python
REM ---------- Verify the wrapper exists ----------
if not exist "%SCRIPT_DIR%server.py" (
    echo.
    echo  ERROR: server.py not found in this folder.
    echo         Make sure server.py is alongside start.bat.
    echo.
    pause
    exit /b 1
)

REM ---------- Report and serve ----------
echo.
echo  --------------------------------------------------------------
echo    Nutrition Tracker -- local server
echo  --------------------------------------------------------------
for /f "tokens=*" %%i in ('%PY% --version 2^>^&1') do echo    %%i
echo    Folder: %SCRIPT_DIR%
echo    Port:   %PORT%
echo.
echo    Open in your browser:
echo       Logger:    http://localhost:%PORT%/%APP_PAGE%
echo       Reference: http://localhost:%PORT%/nutrition_guide.html
echo.
echo    Press Ctrl+C to stop the server.
echo  --------------------------------------------------------------
echo.

cd /d "%SCRIPT_DIR%"

REM Auto-open the logger in the default browser.
start "" "http://localhost:%PORT%/%APP_PAGE%"

REM Run the wrapper (blocks until Ctrl+C).
%PY% server.py %PORT%

endlocal
