#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <app-bundle-path> <output-dmg-path>" >&2
  exit 1
fi

APP_BUNDLE_PATH="$1"
OUTPUT_DMG_PATH="$2"

if [ ! -d "$APP_BUNDLE_PATH" ]; then
  echo "App bundle not found: $APP_BUNDLE_PATH" >&2
  exit 1
fi

APP_BUNDLE_PATH="$(cd "$(dirname "$APP_BUNDLE_PATH")" && pwd)/$(basename "$APP_BUNDLE_PATH")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_DMG_PATH")" && pwd)"
OUTPUT_DMG_PATH="$OUTPUT_DIR/$(basename "$OUTPUT_DMG_PATH")"

VOLUME_NAME="$(basename "$APP_BUNDLE_PATH" .app)"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/free-dmg-stage.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

cp -R "$APP_BUNDLE_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

rm -f "$OUTPUT_DMG_PATH"

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG_PATH"

echo "Created DMG at $OUTPUT_DMG_PATH"
