#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/free/app"
TAURI_CONFIG="$APP_DIR/src-tauri/tauri.conf.json"
OUTPUT_ROOT="$APP_DIR/dist-desktop"
TAURI_UPDATER_CONFIG="$APP_DIR/src-tauri/tauri.updater.conf.json"

if DESKTOP_UPDATER_ENV="$(node "$ROOT/scripts/resolve-desktop-updater-env.js")" && [ -n "$DESKTOP_UPDATER_ENV" ]; then
  eval "$DESKTOP_UPDATER_ENV"
fi

cd "$ROOT"

VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version)" "$TAURI_CONFIG")"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
RELEASE_DIR="$OUTPUT_ROOT/${VERSION}/${PLATFORM}-${ARCH}"
TEMP_FILE_LIST="$(mktemp)"
TAURI_BUILD_CONFIG="src-tauri/tauri.conf.json"

if [ -n "${TAURI_UPDATER_PUBLIC_KEY:-}" ]; then
  TAURI_BUILD_CONFIG="src-tauri/tauri.updater.conf.json"
fi

echo ">>> Building desktop production bundle (version: $VERSION)"
cd "$APP_DIR"
if [ -n "${TAURI_UPDATER_PUBLIC_KEY:-}" ]; then
  cd "$ROOT"
  node ./scripts/prepare-desktop-updater-config.js --require-key
  cd "$APP_DIR"
else
  node "$ROOT/scripts/prepare-desktop-updater-config.js"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  pnpm exec tauri build --config "$TAURI_BUILD_CONFIG" --bundles app "$@"
else
  pnpm exec tauri build --config "$TAURI_BUILD_CONFIG" "$@"
fi

"$ROOT/scripts/repair-tauri-macos-app-signature.sh"

if [ "$(uname -s)" = "Darwin" ]; then
  APP_BUNDLE_PATH="$APP_DIR/src-tauri/target/release/bundle/macos/Free.app"
  DMG_PATH="$APP_DIR/src-tauri/target/release/bundle/dmg/Free_${VERSION}_${ARCH}.dmg"
  ZIP_PATH="$APP_DIR/src-tauri/target/release/bundle/macos/Free_${VERSION}_${ARCH}.zip"
  find "$APP_DIR/src-tauri/target/release/bundle/dmg" -maxdepth 1 -type f -name 'Free_*.dmg' -delete 2>/dev/null || true
  find "$APP_DIR/src-tauri/target/release/bundle/macos" -maxdepth 1 -type f -name 'Free_*_*.zip' -delete 2>/dev/null || true
  if [ -d "$APP_BUNDLE_PATH" ]; then
    mkdir -p "$(dirname "$DMG_PATH")"
    if ! bash "$ROOT/scripts/create-macos-dmg.sh" "$APP_BUNDLE_PATH" "$DMG_PATH"; then
      echo ">>> Warning: DMG creation failed, falling back to ZIP archive"
      rm -f "$ZIP_PATH"
      ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE_PATH" "$ZIP_PATH"
    fi
  fi
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
find "$APP_DIR/src-tauri/target/release/bundle" \
  \( -name "*.app" -o -name "*.dmg" -o -name "*.zip" -o -name "*.app.tar.gz" -o -name "*.sig" -o -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.msi" -o -name "*.exe" \) \
  -print0 > "$TEMP_FILE_LIST"

if [ ! -s "$TEMP_FILE_LIST" ]; then
  echo "No desktop artifacts found under src-tauri/target/release/bundle" >&2
  rm -f "$TEMP_FILE_LIST"
  exit 1
fi

while IFS= read -r -d '' artifact; do
  cp -R "$artifact" "$RELEASE_DIR/"
done < "$TEMP_FILE_LIST"

rm -f "$TEMP_FILE_LIST"
rm -f "$TAURI_UPDATER_CONFIG"

node - "$RELEASE_DIR" <<'EOF'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const output = path.join(root, 'SHA256SUMS.txt');
const lines = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'SHA256SUMS.txt') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    lines.push(`${hash} ${path.relative(root, fullPath)}`);
  }
}

walk(root);
fs.writeFileSync(output, lines.sort().join('\n') + '\n');
EOF

echo ""
echo "Desktop artifacts staged at:"
echo "  $RELEASE_DIR"
echo ""
echo "SHA256 checksums:"
cat "$RELEASE_DIR/SHA256SUMS.txt"
