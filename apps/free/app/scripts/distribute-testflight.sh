#!/usr/bin/env bash
# Distribute the latest build to the "public" TestFlight group without notifications.
# Waits for ASC processing to complete before distributing.
#
# Usage: ./scripts/distribute-testflight.sh [build-number]
#   build-number  optional; defaults to the latest build
set -euo pipefail

APP_ID="6760917195"
GROUP="public"

if [ -n "${1:-}" ]; then
  BUILD_ARG="--build-number $1"
else
  # Find the latest build number
  LATEST=$(asc builds list --app "$APP_ID" --output json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['attributes']['version'])" 2>/dev/null || true)
  if [ -z "$LATEST" ]; then
    echo "Error: could not determine latest build number" >&2
    exit 1
  fi
  BUILD_ARG="--build-number $LATEST"
  echo "Using latest build: $LATEST"
fi

# --wait: poll until ASC finishes processing (VALID), then distribute
# --notify is off by default, so external testers won't get email
asc publish testflight \
  --app "$APP_ID" \
  $BUILD_ARG \
  --group "$GROUP" \
  --wait \
  --poll-interval 30s \
  --timeout 30m \
  --output table

echo "Done. Build distributed to '$GROUP' group (no notification sent)."
