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
BUILD_DISCOVERY_TIMEOUT_SECONDS="${BUILD_DISCOVERY_TIMEOUT_SECONDS:-3600}"
BUILD_DISCOVERY_POLL_SECONDS="${BUILD_DISCOVERY_POLL_SECONDS:-30}"

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

build_exists() {
  local build_number="$1"

  asc builds list --app "$APP_ID" --output json 2>/dev/null \
    | python3 - "$build_number" <<'PY'
import json
import sys

target = sys.argv[1]
payload = json.load(sys.stdin)
for item in payload.get("data", []):
    attrs = item.get("attributes", {})
    candidates = [
        attrs.get("buildNumber"),
        attrs.get("uploadedBuildNumber"),
        attrs.get("version"),
    ]
    if any(str(value) == target for value in candidates if value is not None):
        sys.exit(0)
sys.exit(1)
PY
}

log_build_snapshot() {
  asc builds list --app "$APP_ID" --output json 2>/dev/null \
    | python3 <<'PY'
import json
import sys

payload = json.load(sys.stdin)
for item in payload.get("data", [])[:10]:
    attrs = item.get("attributes", {})
    print(
        "build candidate:",
        {
            "id": item.get("id"),
            "version": attrs.get("version"),
            "buildNumber": attrs.get("buildNumber"),
            "uploadedBuildNumber": attrs.get("uploadedBuildNumber"),
            "processingState": attrs.get("processingState"),
            "appStoreState": attrs.get("appStoreState"),
            "usesNonExemptEncryption": attrs.get("usesNonExemptEncryption"),
        },
    )
PY
}

wait_for_build() {
  local build_number="$1"
  local waited=0

  while ! build_exists "$build_number"; do
    if [ "$waited" -ge "$BUILD_DISCOVERY_TIMEOUT_SECONDS" ]; then
      log_info "Error: timed out waiting for build \"$build_number\" to appear in App Store Connect"
      log_build_snapshot >> "${LOG_PATH:-/dev/stdout}" 2>/dev/null || true
      exit 1
    fi

    log_info "Waiting for build \"$build_number\" to appear in App Store Connect... elapsed=${waited}s timeout=${BUILD_DISCOVERY_TIMEOUT_SECONDS}s"
    log_build_snapshot >> "${LOG_PATH:-/dev/stdout}" 2>/dev/null || true
    sleep "$BUILD_DISCOVERY_POLL_SECONDS"
    waited=$((waited + BUILD_DISCOVERY_POLL_SECONDS))
  done

  log_info "Build \"$build_number\" appeared in App Store Connect after ${waited}s"
  log_build_snapshot >> "${LOG_PATH:-/dev/stdout}" 2>/dev/null || true
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

wait_for_build "$BUILD_NUMBER"

# --wait: poll until ASC finishes processing (VALID), then distribute
# --notify is off by default, so external testers won't get email
run_with_log \
  asc publish testflight \
    --app "$APP_ID" \
    $BUILD_ARG \
    --group "$GROUP" \
    --wait \
    --poll-interval 30s \
    --timeout 30m \
    --output table

echo "Done. Build distributed to '$GROUP' group (no notification sent)."
