#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/free/app"
APP_ENV="${APP_ENV:-production}"
ANDROID_BUILD_ARTIFACT="${ANDROID_BUILD_ARTIFACT:-aab}"
ANDROID_SIGNING_MODE="${ANDROID_SIGNING_MODE:-release}"
ARTIFACTS_DIR="$APP_DIR/.artifacts/android/$APP_ENV"
KEYSTORE_PATH="$ARTIFACTS_DIR/upload-keystore.jks"
GOOGLE_SERVICES_PATH="$ARTIFACTS_DIR/google-services.json"
AAB_PATH="$APP_DIR/android/app/build/outputs/bundle/release/app-release.aab"
APK_PATH="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"

cleanup() {
  if [ -f "$KEYSTORE_PATH" ]; then
    rm -f "$KEYSTORE_PATH"
  fi
}
trap cleanup EXIT

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_cmd node
require_cmd pnpm
require_cmd java
require_cmd base64

case "$ANDROID_SIGNING_MODE" in
  release)
    require_env ANDROID_UPLOAD_KEYSTORE_BASE64
    require_env ANDROID_UPLOAD_STORE_PASSWORD
    require_env ANDROID_UPLOAD_KEY_ALIAS
    require_env ANDROID_UPLOAD_KEY_PASSWORD
    ;;
  debug)
    ;;
  *)
    echo "Unsupported ANDROID_SIGNING_MODE: $ANDROID_SIGNING_MODE (expected: debug or release)" >&2
    exit 1
    ;;
esac

BUILD_NUMBER="${ANDROID_VERSION_CODE:-$(node "$ROOT_DIR/scripts/next-android-version-code.js")}"
VERSION="$(node -p "require('$APP_DIR/package.json').version")"

case "$ANDROID_BUILD_ARTIFACT" in
  aab)
    GRADLE_TASK="bundleRelease"
    SOURCE_ARTIFACT_PATH="$AAB_PATH"
    OUTPUT_EXTENSION="aab"
    ;;
  apk)
    GRADLE_TASK="assembleRelease"
    SOURCE_ARTIFACT_PATH="$APK_PATH"
    OUTPUT_EXTENSION="apk"
    ;;
  *)
    echo "Unsupported ANDROID_BUILD_ARTIFACT: $ANDROID_BUILD_ARTIFACT (expected: apk or aab)" >&2
    exit 1
    ;;
esac

OUTPUT_ARTIFACT_PATH="$ARTIFACTS_DIR/app-$ANDROID_SIGNING_MODE.$OUTPUT_EXTENSION"
VERSIONED_OUTPUT_PATH="$ARTIFACTS_DIR/free-$APP_ENV-$ANDROID_SIGNING_MODE-$VERSION-$BUILD_NUMBER.$OUTPUT_EXTENSION"

rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"

if [ "$ANDROID_SIGNING_MODE" = "release" ]; then
  printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
  chmod 600 "$KEYSTORE_PATH"
fi

cat > "$ARTIFACTS_DIR/build.env" <<EOF
APP_ENV=$APP_ENV
ANDROID_VERSION_CODE=$BUILD_NUMBER
ANDROID_BUILD_ARTIFACT=$ANDROID_BUILD_ARTIFACT
ANDROID_SIGNING_MODE=$ANDROID_SIGNING_MODE
EOF

if [ "$ANDROID_SIGNING_MODE" = "release" ]; then
  cat >> "$ARTIFACTS_DIR/build.env" <<EOF
FREE_UPLOAD_STORE_FILE=$KEYSTORE_PATH
EOF
fi

if [ -n "${GOOGLE_SERVICES_JSON:-}" ]; then
  printf '%s\n' "$GOOGLE_SERVICES_JSON" > "$GOOGLE_SERVICES_PATH"
fi

echo "==> Sync Expo config into native Android project"
(
  cd "$APP_DIR"
  APP_ENV="$APP_ENV" \
  ANDROID_VERSION_CODE="$BUILD_NUMBER" \
  GOOGLE_SERVICES_JSON_PATH="$GOOGLE_SERVICES_PATH" \
  npx expo prebuild --platform android --non-interactive
)

if [ -f "$GOOGLE_SERVICES_PATH" ]; then
  mkdir -p "$APP_DIR/android/app"
  cp "$GOOGLE_SERVICES_PATH" "$APP_DIR/android/app/google-services.json"
fi

echo "==> Build signed Android $ANDROID_BUILD_ARTIFACT"
(
  cd "$APP_DIR/android"
  if [ "$ANDROID_SIGNING_MODE" = "release" ]; then
    FREE_UPLOAD_STORE_FILE="$KEYSTORE_PATH" \
    FREE_UPLOAD_STORE_PASSWORD="$ANDROID_UPLOAD_STORE_PASSWORD" \
    FREE_UPLOAD_KEY_ALIAS="$ANDROID_UPLOAD_KEY_ALIAS" \
    FREE_UPLOAD_KEY_PASSWORD="$ANDROID_UPLOAD_KEY_PASSWORD" \
    ./gradlew "$GRADLE_TASK"
  else
    ./gradlew "$GRADLE_TASK"
  fi
)

if [ ! -f "$SOURCE_ARTIFACT_PATH" ]; then
  echo "Failed to find built artifact: $SOURCE_ARTIFACT_PATH" >&2
  exit 1
fi

cp "$SOURCE_ARTIFACT_PATH" "$OUTPUT_ARTIFACT_PATH"
cp "$SOURCE_ARTIFACT_PATH" "$VERSIONED_OUTPUT_PATH"

echo
echo "Variant: $APP_ENV"
echo "Signing: $ANDROID_SIGNING_MODE"
echo "Version: $VERSION"
echo "Version code: $BUILD_NUMBER"
echo "Artifact: $OUTPUT_ARTIFACT_PATH"
echo "Versioned artifact: $VERSIONED_OUTPUT_PATH"
