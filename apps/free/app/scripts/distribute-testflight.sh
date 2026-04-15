#!/usr/bin/env bash
# Distribute the latest build to the "public" TestFlight group without notifications.
# Waits for ASC processing to complete before distributing.
#
# Usage: ./scripts/distribute-testflight.sh [build-number] [group]
#   build-number  optional; defaults to the latest build
#   group         optional; defaults to TESTFLIGHT_GROUP or "public"
set -euo pipefail

APP_ID="${ASC_APP_ID:-6760917195}"
GROUP="${2:-${TESTFLIGHT_GROUP:-public}}"
LOG_PATH="${TESTFLIGHT_LOG_PATH:-}"
TESTFLIGHT_PUBLISH_TIMEOUT="${TESTFLIGHT_PUBLISH_TIMEOUT:-50m}"
TESTFLIGHT_POLL_INTERVAL="${TESTFLIGHT_POLL_INTERVAL:-30s}"

log_info() {
  echo "$@"
  if [ -n "$LOG_PATH" ]; then
    mkdir -p "$(dirname "$LOG_PATH")"
    printf '%s\n' "$@" >> "$LOG_PATH"
  fi
}

run_with_log() {
  if [ -z "$LOG_PATH" ]; then
    "$@"
    return
  fi

  mkdir -p "$(dirname "$LOG_PATH")"

  set +e
  "$@" 2>&1 | tee "$LOG_PATH"
  local status="${PIPESTATUS[0]}"
  set -e

  if [ "$status" -ne 0 ]; then
    echo "TestFlight distribution failed. Full log: $LOG_PATH" >&2
    tail -n 120 "$LOG_PATH" >&2 || true
    exit "$status"
  fi
}

if [ -n "${1:-}" ]; then
  BUILD_NUMBER="$1"
  BUILD_ARG="--build-number $1"
else
  # Find the latest build number
  LATEST=$(asc builds list --app "$APP_ID" --output json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); attrs=d['data'][0]['attributes']; print(attrs.get('buildNumber') or attrs.get('uploadedBuildNumber') or attrs.get('version') or '')" 2>/dev/null || true)
  if [ -z "$LATEST" ]; then
    echo "Error: could not determine latest build number" >&2
    exit 1
  fi
  BUILD_NUMBER="$LATEST"
  BUILD_ARG="--build-number $LATEST"
  echo "Using latest build: $LATEST"
fi

log_info "Publishing TestFlight build \"$BUILD_NUMBER\" to group \"$GROUP\" with timeout=${TESTFLIGHT_PUBLISH_TIMEOUT}"

# --wait: poll until ASC finishes processing (VALID), then distribute
# --notify is off by default, so external testers won't get email
run_with_log \
  asc publish testflight \
    --app "$APP_ID" \
    $BUILD_ARG \
    --group "$GROUP" \
    --wait \
    --poll-interval "$TESTFLIGHT_POLL_INTERVAL" \
    --timeout "$TESTFLIGHT_PUBLISH_TIMEOUT" \
    --output table

echo "Done. Build distributed to '$GROUP' group (no notification sent)."
