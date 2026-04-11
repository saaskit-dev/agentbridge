#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=8081
URL="http://localhost:$PORT"

cleanup() {
  if [ -n "${EXPO_PID:-}" ] && kill -0 "$EXPO_PID" 2>/dev/null; then
    kill "$EXPO_PID" 2>/dev/null || true
    wait "$EXPO_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cross-env APP_ENV=development expo start --web --port "$PORT" --host localhost &
EXPO_PID=$!

for _ in {1..120}; do
  if curl -sf "$URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -sf "$URL" >/dev/null 2>&1; then
  echo "Expo web dev server did not become ready at $URL" >&2
  exit 1
fi

wait "$EXPO_PID"
