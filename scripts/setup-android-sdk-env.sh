#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/free/app"

SDK_CANDIDATES=()

add_candidate() {
  local candidate="$1"
  if [ -n "$candidate" ]; then
    SDK_CANDIDATES+=("$candidate")
  fi
}

add_candidate "${ANDROID_HOME:-}"
add_candidate "${ANDROID_SDK_ROOT:-}"
add_candidate "$HOME/Library/Android/sdk"
add_candidate "/Users/dev/Library/Android/sdk"
add_candidate "/opt/homebrew/share/android-commandlinetools"
add_candidate "/usr/local/share/android-commandlinetools"

ANDROID_SDK_DIR=""
for candidate in "${SDK_CANDIDATES[@]}"; do
  if [ -d "$candidate/platforms" ]; then
    ANDROID_SDK_DIR="$candidate"
    break
  fi
done

if [ -z "$ANDROID_SDK_DIR" ]; then
  echo "Unable to locate Android SDK. Checked:" >&2
  printf '  %s\n' "${SDK_CANDIDATES[@]}" >&2
  exit 1
fi

mkdir -p "$APP_DIR/android"
ESCAPED_SDK_DIR="${ANDROID_SDK_DIR//\\/\\\\}"
printf 'sdk.dir=%s\n' "$ESCAPED_SDK_DIR" > "$APP_DIR/android/local.properties"

echo "Configured Android SDK at $ANDROID_SDK_DIR" >&2
echo "ANDROID_HOME=$ANDROID_SDK_DIR"
echo "ANDROID_SDK_ROOT=$ANDROID_SDK_DIR"
