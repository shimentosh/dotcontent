#!/usr/bin/env bash
# Start dotcontent on port 3333.
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
if ! docker compose ps --status running 2>/dev/null | grep -q dotcontent-postgres; then
  echo "→ starting Postgres"
  if ! docker compose up -d --wait 2>/dev/null; then
    echo
    echo "  Postgres could not be started."
    echo "  Start Docker Desktop, then run:  npm run db:up"
    echo
    echo "  dotcontent will run without it, but every screen will be empty."
    echo
  fi
fi

# No tools are installed here.
#
# This used to pip-install openai-whisper, because whisper was the one thing
# standing between a source video and a transcript AND it ran in this process.
# Neither half is true now: transcription is a job, it runs on a worker's
# machine, and the server never needs whisper at all. Installing a gigabyte of
# torch to start a web app would be a gigabyte spent on nothing.
#
# The tools a WORKER needs — yt-dlp, ffmpeg, whisper.cpp and a model — come
# from `npm run worker:setup`, pinned and checksummed, into .data/tools.

# Anything this machine has been told, the same way every other script here
# learns it. The worker's token is the only value start.sh needs that it
# cannot work out for itself.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  # The name the token had before the rename still works.
  DOTCONTENT_WORKER_TOKEN="${DOTCONTENT_WORKER_TOKEN:-${CONTENTOS_WORKER_TOKEN:-}}"
fi

# The API is its own process now, on API_PORT (4000). It is started here so
# that one command still brings the whole thing up; stopping this script
# stops both.
API_PORT="${API_PORT:-4000}"

# The origin the browser will be on, worked out BEFORE it is handed to
# anything.
#
# It used to be written inline as `PORT="$API_PORT" WEB_ORIGIN="http://localhost:$PORT"`,
# and bash performs command-prefix assignments left to right: PORT became
# 4000, and only then was $PORT expanded. So the API was told to allow its
# OWN origin, every browser call from :3333 was refused by CORS, and the page
# said "The API is not running" about an API that was running and answering
# curl perfectly. A variable that cannot be shadowed is the whole fix.
WEB_APP_ORIGIN="http://localhost:$PORT"

# The worker, which is the thing that actually writes.
#
# Without one, pressing Run queues a job and nothing ever claims it. The page
# says so — it names the machine it is waiting for — but a dev server that
# cannot write a section is not a dev server anybody can work against, so it
# starts here with the rest.
#
# It needs a token, and a token cannot be invented: it is minted once in
# Settings → Machines and only its sha256 is kept, so nothing here can look it
# up. Put it in .env as DOTCONTENT_WORKER_TOKEN. Without one this says how to
# get one and carries on, because a missing worker must not stop the console
# coming up — signing in is where you go to fix it.
#
# WORKER=0 ./start.sh skips it, for working on a screen that has no runs in it.
start_worker() {
  if [ "${WORKER:-1}" = "0" ]; then
    return
  fi
  if [ -z "${DOTCONTENT_WORKER_TOKEN:-}" ]; then
    echo "→ no worker: set DOTCONTENT_WORKER_TOKEN in .env (Settings → Machines mints one)"
    echo "  Runs will queue and wait. Everything else works."
    return
  fi
  echo "→ worker on this machine, claiming from http://localhost:$API_PORT"
  # No name is passed: the machine is named in Settings -> Machines when its
  # token is minted, and the worker is not allowed to rename it.
  DOTCONTENT_API_URL="http://localhost:$API_PORT" npm run worker &
  WORKER_PID=$!
}

# Everything this script started dies with it. A worker left behind would keep
# claiming jobs against a console that is no longer there, and the section it
# was three minutes into would be written by a process nobody can see.
stop_all() {
  kill ${API_PID:-} ${WORKER_PID:-} 2>/dev/null || true
}

if [ ! -d api/node_modules ]; then
  echo "→ installing the API's dependencies"
  (cd api && npm install)
fi

case "$MODE" in
  dev)
    echo "→ dotcontent API (dev) on http://localhost:$API_PORT/api"
    (cd api && PORT="$API_PORT" WEB_ORIGIN="$WEB_APP_ORIGIN" npm run dev) &
    API_PID=$!
    trap stop_all EXIT
    start_worker
    echo "→ dotcontent (dev) on http://localhost:$PORT"
    NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run dev -- --port "$PORT"
    ;;
  prod | start)
    echo "→ building the API"
    (cd api && npm run build)
    echo "→ building dotcontent"
    NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run build
    echo "→ dotcontent API on http://localhost:$API_PORT/api"
    (cd api && PORT="$API_PORT" WEB_ORIGIN="$WEB_APP_ORIGIN" DOTCONTENT_DATA_DIR=../.data npm run start) &
    API_PID=$!
    trap stop_all EXIT
    start_worker
    echo "→ dotcontent (production) on http://localhost:$PORT"
    npm run start -- --port "$PORT"
    ;;
  *)
    echo "usage: ./start.sh [dev|prod]   (PORT overrides the default 3333)" >&2
    exit 1
    ;;
esac
