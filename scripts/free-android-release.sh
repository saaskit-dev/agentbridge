#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/free/app"
OUTPUT_ROOT="$APP_DIR/dist-android"
VERSION="$(node -p "require('$APP_DIR/package.json').version")"
RELEASE_DIR="$OUTPUT_ROOT/$VERSION"

if [ "$#" -eq 0 ]; then
  VARIANTS=(production development)
else
  VARIANTS=("$@")
fi

normalize_variant() {
  case "$1" in
    production|prod)
      printf '%s\n' "production"
      ;;
    development|dev)
      printf '%s\n' "development"
      ;;
    *)
      echo "Unsupported Android release variant: $1" >&2
      exit 1
      ;;
  esac
}

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

ANDROID_SIGNING_MODE="${ANDROID_SIGNING_MODE:-release}"

for raw_variant in "${VARIANTS[@]}"; do
  variant="$(normalize_variant "$raw_variant")"
  echo ">>> Building Android ${variant} ${ANDROID_SIGNING_MODE} APK"
  if [ "$ANDROID_SIGNING_MODE" = "debug" ]; then
    APP_ENV="$variant" "$ROOT/scripts/free-app-android-debug-apk.sh"
  else
    APP_ENV="$variant" "$ROOT/scripts/free-app-android-apk.sh"
  fi

  SOURCE_DIR="$APP_DIR/.artifacts/android/$variant"
  TARGET_DIR="$RELEASE_DIR/$variant"
  mkdir -p "$TARGET_DIR"
  cp "$SOURCE_DIR"/free-"$variant"-"$ANDROID_SIGNING_MODE"-*.apk "$TARGET_DIR/"
  cp "$SOURCE_DIR/build.env" "$TARGET_DIR/build-$variant.env"
done

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
echo "Android artifacts staged at:"
echo "  $RELEASE_DIR"
echo ""
echo "SHA256 checksums:"
cat "$RELEASE_DIR/SHA256SUMS.txt"
