#!/bin/bash
# EAS 构建前注入 Firebase 配置文件
# GOOGLE_SERVICES_PLIST / GOOGLE_SERVICES_JSON 是 EAS file secret：
# EAS 将文件写入临时路径并将该路径设置为环境变量，直接 cp 即可。

set -e

APP_DIR="$EAS_BUILD_WORKINGDIR/apps/free/app"

if [ -n "$GOOGLE_SERVICES_PLIST" ]; then
  echo "📦 Copying GoogleService-Info.plist from EAS secret"
  cp "$GOOGLE_SERVICES_PLIST" "$APP_DIR/ios/Freedev/GoogleService-Info.plist"
else
  echo "⚠️  GOOGLE_SERVICES_PLIST not set, skipping"
fi

if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📦 Copying google-services.json from EAS secret"
  cp "$GOOGLE_SERVICES_JSON" "$APP_DIR/android/app/google-services.json"
else
  echo "⚠️  GOOGLE_SERVICES_JSON not set, skipping"
fi
