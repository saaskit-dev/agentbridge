#!/bin/bash

# Free App - Preview 版发布（内测）
# 用法: ./scripts/free-app-release-preview.sh [ios|android]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"
PLATFORM="${1:-all}"

echo "🚀 发布 Free App Preview 版 (platform: $PLATFORM)"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

# 同步原生项目配置
rm -rf android ios && npx expo prebuild

if [ "$PLATFORM" = "ios" ] || [ "$PLATFORM" = "all" ]; then
  eas build --profile preview --platform ios --no-wait
  eas build --profile preview-store --platform ios --auto-submit-with-profile=production --no-wait
fi

if [ "$PLATFORM" = "android" ] || [ "$PLATFORM" = "all" ]; then
  eas build --profile preview --platform android --no-wait
fi

echo ""
echo "✅ Preview 版发布完成!"
