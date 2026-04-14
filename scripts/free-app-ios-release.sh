#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/free/app"
AUTH_KEY_DIR="$HOME/.appstoreconnect/private_keys"
AUTH_KEY_PATH=""
EXPORT_OPTIONS_PLIST=""

cleanup() {
  if [ -n "$AUTH_KEY_PATH" ] && [ -f "$AUTH_KEY_PATH" ]; then
    rm -f "$AUTH_KEY_PATH"
  fi
  if [ -n "$EXPORT_OPTIONS_PLIST" ] && [ -f "$EXPORT_OPTIONS_PLIST" ]; then
    rm -f "$EXPORT_OPTIONS_PLIST"
  fi
}
trap cleanup EXIT

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

require_cmd node
require_cmd xcodebuild
require_cmd xcrun
require_cmd pnpm
require_cmd asc

require_env APPLE_TEAM_ID
require_env ASC_APP_ID
require_env ASC_KEY_ID
require_env ASC_ISSUER_ID
require_env ASC_PRIVATE_KEY

RELEASE_LANE="${RELEASE_LANE:-beta}"
DISTRIBUTE_EXTERNAL="${DISTRIBUTE_EXTERNAL:-true}"
TESTFLIGHT_GROUP="${TESTFLIGHT_GROUP:-public}"

if [ "$RELEASE_LANE" != "beta" ] && [ "$RELEASE_LANE" != "production" ]; then
  echo "Unsupported RELEASE_LANE: $RELEASE_LANE" >&2
  exit 1
fi

mkdir -p "$AUTH_KEY_DIR"
AUTH_KEY_PATH="$AUTH_KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
printf '%s\n' "$ASC_PRIVATE_KEY" > "$AUTH_KEY_PATH"
chmod 600 "$AUTH_KEY_PATH"

# Force asc CLI to use CI-provided API key material instead of any runner-local
# keychain profile. Self-hosted runners may not have the expected stored profile.
export ASC_BYPASS_KEYCHAIN=1
export ASC_STRICT_AUTH=1
export ASC_PRIVATE_KEY_PATH="$AUTH_KEY_PATH"

BUILD_NUMBER="$(node "$ROOT_DIR/scripts/next-ios-build-number.js")"
VERSION="$(node -p "require('$APP_DIR/package.json').version")"
ARCHIVE_PATH="$APP_DIR/.artifacts/ios/Free.xcarchive"
EXPORT_PATH="$APP_DIR/.artifacts/ios/export"

rm -rf "$APP_DIR/.artifacts/ios"
mkdir -p "$EXPORT_PATH"

cat > "$APP_DIR/.artifacts/ios/build.env" <<EOF
APP_ENV=production
IOS_BUILD_NUMBER=$BUILD_NUMBER
EOF

if [ -n "${GOOGLE_SERVICES_PLIST:-}" ]; then
  printf '%s\n' "$GOOGLE_SERVICES_PLIST" > "$APP_DIR/ios/Freedev/GoogleService-Info.plist"
fi

if [ -n "${GOOGLE_SERVICES_JSON:-}" ]; then
  printf '%s\n' "$GOOGLE_SERVICES_JSON" > "$APP_DIR/android/app/google-services.json"
fi

EXPORT_OPTIONS_PLIST="$(mktemp "${TMPDIR:-/tmp}/free-ios-export-options.XXXXXX.plist")"
cat > "$EXPORT_OPTIONS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>destination</key>
  <string>export</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
EOF

echo "==> Sync Expo config into native iOS project"
(
  cd "$APP_DIR"
  APP_ENV=production IOS_BUILD_NUMBER="$BUILD_NUMBER" npx expo prebuild --platform ios --non-interactive
)

echo "==> Install CocoaPods"
(
  cd "$APP_DIR"
  pnpm exec pod-install ios
)

echo "==> Archive iOS app"
(
  cd "$APP_DIR"
  xcodebuild \
    -workspace ios/Freedev.xcworkspace \
    -scheme Freedev \
    -configuration Release \
    -destination generic/platform=iOS \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$AUTH_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    archive
)

echo "==> Export IPA"
(
  cd "$APP_DIR"
  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$AUTH_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

IPA_PATH="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' | head -n 1)"
if [ -z "$IPA_PATH" ]; then
  echo "Failed to find exported IPA" >&2
  exit 1
fi

echo "==> Upload IPA to App Store Connect"
xcrun altool \
  --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"

if [ "$DISTRIBUTE_EXTERNAL" = "true" ]; then
  echo "==> Distribute build to TestFlight group: $TESTFLIGHT_GROUP"
  "$APP_DIR/scripts/distribute-testflight.sh" "$BUILD_NUMBER" "$TESTFLIGHT_GROUP"
fi

echo
echo "Release lane: $RELEASE_LANE"
echo "Version: $VERSION"
echo "Build number: $BUILD_NUMBER"
echo "IPA: $IPA_PATH"
