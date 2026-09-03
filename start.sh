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
# The other tools are single binaries a person already has or does not need;
# whisper is a Python package, and it is the one thing standing between a
# source video and a transcript. Installing it here means a fresh clone can
# read a reel without first finding the Integrations page and being told to
# run something.
#
# It is a big download the first time — torch is most of a gigabyte — so it
# says so, and SKIP_WHISPER=1 turns it off for anyone who does not want it.
if [ "${SKIP_WHISPER:-0}" != "1" ] && ! command -v whisper >/dev/null 2>&1; then
  # The first Python that can actually install something.
  #
  # Not simply the first one on PATH: `python` is often a virtualenv with no
  # pip in it — this machine's is — and picking that one fails with "No module
  # named pip" while a perfectly good `py` sits next to it. `pip` itself is
  # frequently not on PATH at all, so the module form is what gets asked.
  PY=""
  for candidate in python python3 py; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -m pip --version >/dev/null 2>&1; then
      PY="$candidate"
      break
    fi
  done

  if [ -z "$PY" ]; then
    echo "  whisper needs Python with pip, which is not on PATH. Transcripts will be skipped."
  elif "$PY" -m whisper --help >/dev/null 2>&1; then
    : # Installed, just not as a command on PATH. The app finds it either way.
  else
    echo "→ installing whisper (one time, ~1GB — SKIP_WHISPER=1 to skip)"
    if ! "$PY" -m pip install -q -U openai-whisper; then
      echo "  whisper did not install. Transcripts will be skipped until it does:"
      echo "    $PY -m pip install -U openai-whisper"
    fi
  fi
fi

case "$MODE" in
  dev)
    echo "→ Content OS (dev) on http://localhost:$PORT"
    exec npm run dev -- --port "$PORT"
    ;;
  prod | start)
    echo "→ building Content OS"
    npm run build
    echo "→ Content OS (production) on http://localhost:$PORT"
    exec npm run start -- --port "$PORT"
    ;;
  *)
    echo "usage: ./start.sh [dev|prod]   (PORT overrides the default 3333)" >&2
    exit 1
    ;;
esac
