#!/usr/bin/env bash
# One-command beta release: build → submit → wait for ASC → distribute to public TestFlight group
# Usage: ./scripts/release-beta.sh [--android]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="ios"

if [ "${1:-}" = "--android" ]; then
  PLATFORM="android"
fi

echo "==> Building ($PLATFORM, beta profile)..."
eas build --profile beta --platform "$PLATFORM" --non-interactive

if [ "$PLATFORM" = "ios" ]; then
  # autoSubmit in eas.json handles upload to ASC automatically
  # Now wait for ASC processing and distribute to public group
  echo "==> Waiting for ASC processing & distributing to public TestFlight group..."
  "$SCRIPT_DIR/distribute-testflight.sh"
fi

echo "==> Beta release complete."
