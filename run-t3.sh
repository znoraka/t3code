#!/usr/bin/env bash
# Launch T3 Code locally: ensure Node 24, start the server, open the paired URL.
set -euo pipefail

REPO_DIR="/home/noe/Downloads/claude/t3code"
cd "$REPO_DIR"

# Use Node 24.13.1 via nvm (the repo requires node ^24.13.1).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 24.13.1 >/dev/null

# If the server is already up, just reuse it; otherwise start it.
LOG="$(mktemp /tmp/t3code.XXXXXX.log)"
node apps/server/dist/bin.mjs start --no-browser >"$LOG" 2>&1 &
SERVER_PID=$!

# Wait for the one-time pairing URL to appear, then open it.
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'http://localhost:[0-9]+/pair#token=[A-Za-z0-9]+' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  # bail early if the server died (e.g. port already in use)
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.5
done

if [ -n "$URL" ]; then
  # Prefer Firefox (Gecko): this machine's Chromium GPU stack crashes (Arc B580 + kernel 7.0).
  if command -v firefox >/dev/null 2>&1; then
    firefox "$URL" >/dev/null 2>&1 &
  else
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
else
  echo "Could not find pairing URL. Server log:" >&2
  cat "$LOG" >&2
fi

# Keep the server in the foreground so closing the launcher stops it.
wait "$SERVER_PID"
