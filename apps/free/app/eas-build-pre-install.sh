#!/bin/bash
# EAS pre-install hook: inject Firebase config files before Xcode build
# This runs on EAS Build servers before dependencies are installed.
# GOOGLE_SERVICES_PLIST / GOOGLE_SERVICES_JSON are EAS file secrets
# injected as env vars pointing to the actual file paths.
set -e

if [ -n "$GOOGLE_SERVICES_PLIST" ]; then
  echo "📦 Copying GoogleService-Info.plist from EAS file secret"
  cp "$GOOGLE_SERVICES_PLIST" "ios/Freedev/GoogleService-Info.plist"
else
  echo "⚠️  GOOGLE_SERVICES_PLIST not set, skipping iOS Firebase config"
fi

if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📦 Copying google-services.json from EAS file secret"
  cp "$GOOGLE_SERVICES_JSON" "android/app/google-services.json"
else
  echo "⚠️  GOOGLE_SERVICES_JSON not set, skipping Android Firebase config"
fi
