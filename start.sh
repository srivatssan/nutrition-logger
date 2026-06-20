#!/usr/bin/env bash
#
# Nutrition Tracker — local HTTP server start script (macOS + Linux)
# Serves the current folder on port 8080 via server.py
# (a small wrapper around Python's http.server that suppresses harmless
# connection-reset noise on macOS / Python 3.14).
#
# Usage:
#   chmod +x start.sh    # one-time, to make the script executable
#   ./start.sh           # run from terminal in this folder
#
# To stop the server, press Ctrl+C in this terminal window.
#

set -e

PORT=9090
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_PAGE="nutrition_logger_v6.html"

# ---------- Find Python 3 ----------
PY=""

if command -v python3 >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1; then
  # Some systems alias python to python3 — verify before trusting it
  if python -c "import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)" 2>/dev/null; then
    PY="python"
  fi
fi

if [ -z "$PY" ]; then
  echo ""
  echo "ERROR: Python 3 is not installed (or not on your PATH)."
  echo ""
  echo "Install it with one of:"
  echo "  macOS (Homebrew):       brew install python3"
  echo "  macOS (installer):      https://www.python.org/downloads/"
  echo "  Debian / Ubuntu:        sudo apt install python3"
  echo "  Fedora / RHEL:          sudo dnf install python3"
  echo "  Arch:                   sudo pacman -S python"
  echo ""
  exit 1
fi

# ---------- Verify the wrapper exists ----------
if [ ! -f "$SCRIPT_DIR/server.py" ]; then
  echo ""
  echo "ERROR: server.py not found in $SCRIPT_DIR"
  echo "       Make sure server.py is in the same folder as this script."
  echo ""
  exit 1
fi

# ---------- Report and serve ----------
PY_VERSION=$("$PY" --version 2>&1)

echo ""
echo "──────────────────────────────────────────────────────────────"
echo "  Nutrition Tracker — local server"
echo "──────────────────────────────────────────────────────────────"
echo "  $PY_VERSION"
echo "  Folder: $SCRIPT_DIR"
echo "  Port:   $PORT"
echo ""
echo "  Open in your browser:"
echo "     Logger:    http://localhost:$PORT/$APP_PAGE"
echo "     Reference: http://localhost:$PORT/nutrition_guide.html"
echo ""
echo "  Press Ctrl+C to stop the server."
echo "──────────────────────────────────────────────────────────────"
echo ""

cd "$SCRIPT_DIR"

# Best-effort: open the logger in the default browser after a short delay.
# Silently skips if no opener is available.
(
  sleep 1
  if command -v open >/dev/null 2>&1; then
    # macOS
    open "http://localhost:$PORT/$APP_PAGE"
  elif command -v xdg-open >/dev/null 2>&1; then
    # Most Linux desktop environments
    xdg-open "http://localhost:$PORT/$APP_PAGE"
  fi
) &

# Replace this shell with the Python server process so Ctrl+C goes
# directly to Python and shuts it down cleanly.
exec "$PY" server.py "$PORT"
