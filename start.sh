#!/usr/bin/env bash
#
# Nutrition Tracker — local HTTP server start script (macOS + Linux)
# Serves the current folder on port 8080 using Python 3's built-in http.server.
#
# Usage:
#   chmod +x start.sh    # one-time, to make the script executable
#   ./start.sh           # run from terminal in this folder
#
# To stop the server, press Ctrl+C in this terminal window.
#

set -e

PORT=8080
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

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
echo "     Logger:    http://localhost:$PORT/nutrition_logger.html"
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
    open "http://localhost:$PORT/nutrition_logger.html"
  elif command -v xdg-open >/dev/null 2>&1; then
    # Most Linux desktop environments
    xdg-open "http://localhost:$PORT/nutrition_logger.html"
  fi
) &

# Replace this shell with the Python server process so Ctrl+C goes
# directly to Python and shuts it down cleanly.
exec "$PY" -m http.server "$PORT"
