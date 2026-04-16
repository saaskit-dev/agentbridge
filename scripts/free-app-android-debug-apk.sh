#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

APP_ENV="${APP_ENV:-production}" ANDROID_BUILD_ARTIFACT=apk ANDROID_SIGNING_MODE=debug \
  "$ROOT_DIR/scripts/free-app-android-release.sh"
