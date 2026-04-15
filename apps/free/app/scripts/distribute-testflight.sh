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
TESTFLIGHT_RETRY_SECONDS="${TESTFLIGHT_RETRY_SECONDS:-30}"

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

duration_to_seconds() {
  local value="$1"
  case "$value" in
    *h) echo $(( ${value%h} * 3600 )) ;;
    *m) echo $(( ${value%m} * 60 )) ;;
    *s) echo $(( ${value%s} )) ;;
    *) echo "$value" ;;
  esac
}

publish_with_retry() {
  local build_arg="$1"
  local deadline elapsed=0
  local timeout_seconds
  timeout_seconds="$(duration_to_seconds "$TESTFLIGHT_PUBLISH_TIMEOUT")"

  if [ -z "$timeout_seconds" ] || ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]]; then
    echo "Invalid TESTFLIGHT_PUBLISH_TIMEOUT: $TESTFLIGHT_PUBLISH_TIMEOUT" >&2
    exit 1
  fi

  deadline="$timeout_seconds"

  while true; do
    local output_file
    output_file="$(mktemp "${TMPDIR:-/tmp}/testflight-publish.XXXXXX.log")"

    set +e
    asc publish testflight \
      --app "$APP_ID" \
      $build_arg \
      --group "$GROUP" \
      --wait \
      --poll-interval "$TESTFLIGHT_POLL_INTERVAL" \
      --timeout "$TESTFLIGHT_PUBLISH_TIMEOUT" \
      --output table >"$output_file" 2>&1
    local status=$?
    set -e

    cat "$output_file"
    if [ -n "$LOG_PATH" ]; then
      mkdir -p "$(dirname "$LOG_PATH")"
      cat "$output_file" >> "$LOG_PATH"
    fi

    if [ "$status" -eq 0 ]; then
      rm -f "$output_file"
      return
    fi

    if ! grep -q 'no build found for app' "$output_file"; then
      echo "TestFlight distribution failed. Full log: ${LOG_PATH:-$output_file}" >&2
      tail -n 120 "$output_file" >&2 || true
      rm -f "$output_file"
      exit "$status"
    fi

    rm -f "$output_file"

    if [ "$elapsed" -ge "$deadline" ]; then
      echo "Timed out waiting for App Store Connect to expose the uploaded build for TestFlight publish." >&2
      exit 1
    fi

    log_info "Build not publishable yet. Retrying TestFlight publish in ${TESTFLIGHT_RETRY_SECONDS}s... elapsed=${elapsed}s timeout=${timeout_seconds}s"
    sleep "$TESTFLIGHT_RETRY_SECONDS"
    elapsed=$((elapsed + TESTFLIGHT_RETRY_SECONDS))
  done
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

# --wait: once ASC can see the build, keep polling until processing finishes.
# If ASC has not exposed the build yet, retry the publish command in-place.
publish_with_retry "$BUILD_ARG"

echo "Done. Build distributed to '$GROUP' group (no notification sent)."
