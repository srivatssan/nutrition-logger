#!/usr/bin/env python3
"""
server.py — Nutrition Tracker local HTTP server

A thin wrapper around Python's built-in http.server that:
  - Reads the port from the first CLI argument (default 8080)
  - Serves files from the current working directory
  - Suppresses harmless connection-reset errors that macOS / Python 3.14
    log noisily when the browser opens probe connections (favicon checks,
    prefetch, etc.) and closes them before the server finishes reading.

These suppressed errors (Errno 32 BrokenPipe, 54 ConnectionReset,
57 Socket-not-connected) do NOT affect the running server. Without
this wrapper, you would see scary-looking stack traces in the terminal
that are actually harmless.

Usage:
    python3 server.py            # serves on port 8080
    python3 server.py 9000       # serves on port 9000
"""

import http.server
import os
import socketserver
import sys


DEFAULT_PORT = 8080


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Same as the default static-file handler, but quieter."""

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            # Browser closed before we finished — totally fine
            self.close_connection = True
        except OSError as e:
            # macOS: Errno 57 (Socket is not connected), 54 (Connection reset),
            # 32 (Broken pipe) all mean the same thing — the peer is gone.
            if e.errno in (32, 54, 57):
                self.close_connection = True
            else:
                raise

    def log_message(self, fmt, *args):
        # Single clean line, no double-printed datestamp
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))


class ReusableServer(socketserver.ThreadingTCPServer):
    """Allow rapid restart without 'address already in use'."""
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("ERROR: port must be an integer, got: %r" % sys.argv[1])
            sys.exit(1)

    cwd = os.getcwd()

    try:
        server = ReusableServer(("", port), QuietHandler)
    except OSError as e:
        if e.errno in (48, 98):  # Address already in use (macOS / Linux)
            print("\nERROR: port %d is already in use." % port)
            print("       Either close the other server, or pick a different port.")
            print("       Example:  python3 server.py 9000\n")
            sys.exit(1)
        raise

    print("Serving %s on port %d ..." % (cwd, port))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
