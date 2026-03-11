#!/bin/bash
# 注入 Firebase 配置文件（用于 EAS bare workflow）
# GOOGLE_SERVICES_PLIST / GOOGLE_SERVICES_JSON 是 EAS file secret 的路径。
# 此脚本作为 prebuildCommand 运行，替代完整的 expo prebuild，
# 保留 ios/ 原有状态（bundle ID 等），只注入 Firebase 文件。
set -e

if [ -n "$GOOGLE_SERVICES_PLIST" ]; then
  echo "📦 Copying GoogleService-Info.plist from EAS file secret"
  cp "$GOOGLE_SERVICES_PLIST" "ios/Freedev/GoogleService-Info.plist"
else
  echo "⚠️  GOOGLE_SERVICES_PLIST not set"
fi

if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📦 Copying google-services.json from EAS file secret"
  cp "$GOOGLE_SERVICES_JSON" "android/app/google-services.json"
else
  echo "⚠️  GOOGLE_SERVICES_JSON not set"
fi
