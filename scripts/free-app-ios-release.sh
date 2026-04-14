#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/free/app"
AUTH_KEY_DIR="$HOME/.appstoreconnect/private_keys"
AUTH_KEY_PATH=""
EXPORT_OPTIONS_PLIST=""
GOOGLE_SERVICES_PLIST_PATH=""
IOS_WORKSPACE_PATH=""
IOS_SCHEME=""
IOS_APP_DIR=""
IOS_PROJECT_PATH=""
IOS_PROFILE_DIR=""
IOS_MAIN_PROFILE_NAME=""
IOS_MAIN_PROFILE_UUID=""
IOS_WIDGET_PROFILE_NAME=""
IOS_WIDGET_PROFILE_UUID=""

IOS_MAIN_BUNDLE_ID="app.saaskit.freecode"
IOS_MAIN_BUNDLE_RESOURCE_ID="6G58X7AWS8"
IOS_WIDGET_BUNDLE_ID="app.saaskit.freecode.focusaudio"
IOS_WIDGET_BUNDLE_RESOURCE_ID="855RUR6L94"

cleanup() {
  if [ -n "$AUTH_KEY_PATH" ] && [ -f "$AUTH_KEY_PATH" ]; then
    rm -f "$AUTH_KEY_PATH"
  fi
  if [ -n "$EXPORT_OPTIONS_PLIST" ] && [ -f "$EXPORT_OPTIONS_PLIST" ]; then
    rm -f "$EXPORT_OPTIONS_PLIST"
  fi
  if [ -n "$GOOGLE_SERVICES_PLIST_PATH" ] && [ -f "$GOOGLE_SERVICES_PLIST_PATH" ]; then
    rm -f "$GOOGLE_SERVICES_PLIST_PATH"
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

detect_ios_workspace() {
  local workspace
  workspace="$(find "$APP_DIR/ios" -maxdepth 1 -name '*.xcworkspace' -print | sort | head -n 1)"
  if [ -z "$workspace" ]; then
    echo "Failed to detect iOS workspace under $APP_DIR/ios" >&2
    exit 1
  fi
  IOS_WORKSPACE_PATH="$workspace"
}

detect_ios_project() {
  local project
  project="$(find "$APP_DIR/ios" -maxdepth 1 -name '*.xcodeproj' -print | sort | head -n 1)"
  if [ -z "$project" ]; then
    echo "Failed to detect iOS project under $APP_DIR/ios" >&2
    exit 1
  fi
  IOS_PROJECT_PATH="$project"
}

detect_ios_scheme() {
  IOS_SCHEME="$(find "$APP_DIR/ios" \
    -path '*/Pods/*' -prune -o \
    -path '*/xcshareddata/xcschemes/*.xcscheme' -print | sort | head -n 1 | xargs -I{} basename "{}" .xcscheme)"

  if [ -z "$IOS_SCHEME" ]; then
    local list_output
    list_output="$(cd "$APP_DIR" && xcodebuild -list -workspace "$IOS_WORKSPACE_PATH" 2>/dev/null || true)"
    IOS_SCHEME="$(printf '%s\n' "$list_output" | awk '
      $0 ~ /^Schemes:$/ { in_schemes = 1; next }
      in_schemes && $0 ~ /^[[:space:]]+[[:graph:]].*$/ {
        gsub(/^[[:space:]]+/, "", $0)
        print
        exit
      }
      in_schemes && $0 !~ /^[[:space:]]+/ { exit }
    ')"
  fi

  if [ -z "$IOS_SCHEME" ]; then
    echo "Failed to detect iOS scheme for workspace $IOS_WORKSPACE_PATH" >&2
    exit 1
  fi
}

detect_distribution_certificate_id() {
  local cert_pem serial certs_json cert_id

  cert_pem="$(security find-certificate -a -p -c 'iPhone Distribution' "$HOME/Library/Keychains/login.keychain-db" | awk '
    BEGIN { capture = 0 }
    /BEGIN CERTIFICATE/ { capture = 1 }
    capture { print }
    /END CERTIFICATE/ { exit }
  ')"

  if [ -z "$cert_pem" ]; then
    echo "Failed to find local iPhone Distribution certificate in login keychain" >&2
    exit 1
  fi

  serial="$(printf '%s\n' "$cert_pem" | openssl x509 -noout -serial | cut -d= -f2 | tr '[:upper:]' '[:lower:]')"
  certs_json="$(asc certificates list --certificate-type IOS_DISTRIBUTION --paginate --pretty)"
  cert_id="$(printf '%s\n' "$certs_json" | node -e '
    const fs = require("fs");
    const serial = (process.argv[1] || "").toLowerCase();
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const match = (payload.data || []).find(item => (item.attributes?.serialNumber || "").toLowerCase() === serial);
    if (match) process.stdout.write(match.id);
  ' "$serial")"

  if [ -z "$cert_id" ]; then
    echo "Failed to match local distribution certificate serial $serial to App Store Connect certificate id" >&2
    exit 1
  fi

  printf '%s\n' "$cert_id"
}

create_app_store_profile() {
  local bundle_resource_id="$1"
  local bundle_id="$2"
  local certificate_id="$3"
  local profile_json profile_id profile_name profile_uuid output_path

  profile_json="$(asc profiles create \
    --name "AgentBridge ${bundle_id} AppStore CI $(date +%Y%m%d%H%M%S)" \
    --profile-type IOS_APP_STORE \
    --bundle "$bundle_resource_id" \
    --certificate "$certificate_id" \
    --pretty)"

  profile_id="$(printf '%s\n' "$profile_json" | node -e 'const fs = require("fs"); const payload = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(payload.data.id);')"
  profile_name="$(printf '%s\n' "$profile_json" | node -e 'const fs = require("fs"); const payload = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(payload.data.attributes.name);')"
  profile_uuid="$(printf '%s\n' "$profile_json" | node -e 'const fs = require("fs"); const payload = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(payload.data.attributes.uuid);')"

  output_path="$IOS_PROFILE_DIR/${profile_uuid}.mobileprovision"
  asc profiles download --id "$profile_id" --output "$output_path" >/dev/null

  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  mkdir -p "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  cp "$output_path" "$HOME/Library/MobileDevice/Provisioning Profiles/${profile_uuid}.mobileprovision"
  cp "$output_path" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/${profile_uuid}.mobileprovision"

  printf '%s\n%s\n' "$profile_name" "$profile_uuid"
}

require_cmd node
require_cmd xcodebuild
require_cmd xcrun
require_cmd pnpm
require_cmd asc
require_cmd openssl
require_cmd ruby

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

if [ -n "${GOOGLE_SERVICES_PLIST:-}" ]; then
  GOOGLE_SERVICES_PLIST_PATH="$(mktemp "${TMPDIR:-/tmp}/free-google-services-ios.XXXXXX.plist")"
  printf '%s\n' "$GOOGLE_SERVICES_PLIST" > "$GOOGLE_SERVICES_PLIST_PATH"
  chmod 600 "$GOOGLE_SERVICES_PLIST_PATH"
fi

BUILD_NUMBER="$(node "$ROOT_DIR/scripts/next-ios-build-number.js")"
VERSION="$(node -p "require('$APP_DIR/package.json').version")"
ARCHIVE_PATH="$APP_DIR/.artifacts/ios/Free.xcarchive"
EXPORT_PATH="$APP_DIR/.artifacts/ios/export"
IOS_PROFILE_DIR="$APP_DIR/.artifacts/ios/profiles"

rm -rf "$APP_DIR/.artifacts/ios"
mkdir -p "$EXPORT_PATH"
mkdir -p "$IOS_PROFILE_DIR"

cat > "$APP_DIR/.artifacts/ios/build.env" <<EOF
APP_ENV=production
IOS_BUILD_NUMBER=$BUILD_NUMBER
EOF

echo "==> Sync Expo config into native iOS project"
(
  cd "$APP_DIR"
  APP_ENV=production \
  IOS_BUILD_NUMBER="$BUILD_NUMBER" \
  GOOGLE_SERVICES_PLIST="${GOOGLE_SERVICES_PLIST_PATH:-}" \
  CI=1 \
  npx expo prebuild --platform ios
)

if [ -n "${GOOGLE_SERVICES_PLIST:-}" ]; then
  IOS_APP_DIR="$(find "$APP_DIR/ios" -mindepth 1 -maxdepth 1 -type d ! -name Pods ! -name build ! -name '.symlinks' | sort | head -n 1)"
  if [ -n "$IOS_APP_DIR" ]; then
    printf '%s\n' "$GOOGLE_SERVICES_PLIST" > "$IOS_APP_DIR/GoogleService-Info.plist"
  fi
fi

detect_ios_project
detect_ios_workspace
detect_ios_scheme

echo "==> Prepare App Store signing profiles"
DISTRIBUTION_CERTIFICATE_ID="$(detect_distribution_certificate_id)"
mapfile -t IOS_MAIN_PROFILE_INFO < <(create_app_store_profile "$IOS_MAIN_BUNDLE_RESOURCE_ID" "$IOS_MAIN_BUNDLE_ID" "$DISTRIBUTION_CERTIFICATE_ID")
IOS_MAIN_PROFILE_NAME="${IOS_MAIN_PROFILE_INFO[0]}"
IOS_MAIN_PROFILE_UUID="${IOS_MAIN_PROFILE_INFO[1]}"
mapfile -t IOS_WIDGET_PROFILE_INFO < <(create_app_store_profile "$IOS_WIDGET_BUNDLE_RESOURCE_ID" "$IOS_WIDGET_BUNDLE_ID" "$DISTRIBUTION_CERTIFICATE_ID")
IOS_WIDGET_PROFILE_NAME="${IOS_WIDGET_PROFILE_INFO[0]}"
IOS_WIDGET_PROFILE_UUID="${IOS_WIDGET_PROFILE_INFO[1]}"

echo "==> Configure manual signing for Release archive"
XCODE_PROJECT_PATH="$IOS_PROJECT_PATH" \
APPLE_TEAM_ID="$APPLE_TEAM_ID" \
IOS_MAIN_BUNDLE_ID="$IOS_MAIN_BUNDLE_ID" \
IOS_MAIN_PROFILE_NAME="$IOS_MAIN_PROFILE_NAME" \
IOS_MAIN_PROFILE_UUID="$IOS_MAIN_PROFILE_UUID" \
IOS_WIDGET_BUNDLE_ID="$IOS_WIDGET_BUNDLE_ID" \
IOS_WIDGET_PROFILE_NAME="$IOS_WIDGET_PROFILE_NAME" \
IOS_WIDGET_PROFILE_UUID="$IOS_WIDGET_PROFILE_UUID" \
ruby "$ROOT_DIR/scripts/configure-ios-manual-signing.rb"

EXPORT_OPTIONS_PLIST="$(mktemp "${TMPDIR:-/tmp}/free-ios-export-options.XXXXXX.plist")"
cat > "$EXPORT_OPTIONS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>destination</key>
  <string>export</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
  <key>provisioningProfiles</key>
  <dict>
    <key>${IOS_MAIN_BUNDLE_ID}</key>
    <string>${IOS_MAIN_PROFILE_NAME}</string>
    <key>${IOS_WIDGET_BUNDLE_ID}</key>
    <string>${IOS_WIDGET_PROFILE_NAME}</string>
  </dict>
</dict>
</plist>
EOF

echo "==> Archive iOS app"
(
  cd "$APP_DIR"
  xcodebuild \
    -workspace "$IOS_WORKSPACE_PATH" \
    -scheme "$IOS_SCHEME" \
    -configuration Release \
    -destination generic/platform=iOS \
    -archivePath "$ARCHIVE_PATH" \
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
    -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"
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
