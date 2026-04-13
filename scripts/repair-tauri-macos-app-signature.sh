#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="${1:-$ROOT/apps/free/app/src-tauri/target/release/bundle/macos}"

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ ! -d "$BUNDLE_DIR" ]; then
  exit 0
fi

found=0
while IFS= read -r -d '' app; do
  found=1
  echo ">>> Repairing macOS app signature: $app"
  codesign --force --deep --sign - "$app"
done < <(find "$BUNDLE_DIR" -maxdepth 1 -name "*.app" -print0)

if [ "$found" -eq 0 ]; then
  echo ">>> No macOS app bundles found under $BUNDLE_DIR"
fi
