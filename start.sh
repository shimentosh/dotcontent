#!/usr/bin/env bash
# Start Content OS on port 3333.
#
#   ./start.sh          dev server with hot reload
#   ./start.sh prod     production build, then serve it
#   PORT=4000 ./start.sh    use a different port

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3333}"
MODE="${1:-dev}"

if [ ! -d node_modules ]; then
  echo "→ installing dependencies"
  npm install
fi

# The database, before the app that needs it.
#
# Every screen reads through Postgres, so without it the app starts, serves a
# blank shell and 500s in a log nobody has open. Bringing it up here — or
# saying plainly that it cannot be — is the difference between a fix and ten
# minutes wondering what broke.
if ! docker compose ps --status running 2>/dev/null | grep -q contentos-postgres; then
  echo "→ starting Postgres"
  if ! docker compose up -d --wait 2>/dev/null; then
    echo
    echo "  Postgres could not be started."
    echo "  Start Docker Desktop, then run:  npm run db:up"
    echo
    echo "  Content OS will run without it, but every screen will be empty."
    echo
  fi
fi

# Whisper, if this machine has not got it.
#
# No tools are installed here any more.
#
# This used to pip-install openai-whisper, because whisper was the one thing
# standing between a source video and a transcript AND it ran in this process.
# Neither half is true now: transcription is a job, it runs on a worker's
# machine, and the server never needs whisper at all. Installing a gigabyte of
# torch to start a web app would be a gigabyte spent on nothing.
#
# The tools a WORKER needs — yt-dlp, ffmpeg, whisper.cpp and a model — come
# from `npm run worker:setup`, pinned and checksummed, into .data/tools. That
# is a different machine's concern even when it happens to be this one, and it
# is the only route somebody who is not a developer has.
#
# This script does NOT start a worker either. Nothing writes a section until
# one is running — see docs/DEVELOPING.md.

# The API is its own process now, on API_PORT (4000). It is started here so
# that one command still brings the whole thing up; stopping this script
# stops both.
API_PORT="${API_PORT:-4000}"
if [ ! -d api/node_modules ]; then
  echo "→ installing the API's dependencies"
  (cd api && npm install)
fi

case "$MODE" in
  dev)
    echo "→ Content OS API (dev) on http://localhost:$API_PORT/api"
    (cd api && PORT="$API_PORT" WEB_ORIGIN="http://localhost:$PORT" npm run dev) &
    API_PID=$!
    trap 'kill $API_PID 2>/dev/null' EXIT
    echo "→ Content OS (dev) on http://localhost:$PORT"
    NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run dev -- --port "$PORT"
    ;;
  prod | start)
    echo "→ building the API"
    (cd api && npm run build)
    echo "→ building Content OS"
    NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run build
    echo "→ Content OS API on http://localhost:$API_PORT/api"
    (cd api && PORT="$API_PORT" WEB_ORIGIN="http://localhost:$PORT" CONTENTOS_DATA_DIR=../.data npm run start) &
    API_PID=$!
    trap 'kill $API_PID 2>/dev/null' EXIT
    echo "→ Content OS (production) on http://localhost:$PORT"
    npm run start -- --port "$PORT"
    ;;
  *)
    echo "usage: ./start.sh [dev|prod]   (PORT overrides the default 3333)" >&2
    exit 1
    ;;
esac
