#!/bin/bash

# Free App - 生产版发布
# 用法:
#   ./scripts/free-app-release-production.sh [ios|android]  构建 (默认全平台)
#   ./scripts/free-app-release-production.sh submit          提交 App Store 审核
#
# 注意: buildNumber 由 EAS 自动递增 (eas.json: autoIncrement + appVersionSource: remote)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 发布 Free App 生产版"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

case "${1:-}" in
    submit)
        echo "📋 提交 App Store 审核..."
        APP_ENV=production eas submit --profile production --platform ios --latest
        ;;
    ios)
        echo "🍎 构建 iOS → TestFlight..."
        eas build --profile production --platform ios --auto-submit-with-profile=production --no-wait --non-interactive
        ;;
    android)
        echo "🤖 构建 Android → Google Play..."
        eas build --profile production-android --platform android --no-wait --non-interactive
        ;;
    "")
        echo "🍎🤖 构建全平台 → TestFlight + Google Play..."
        eas build --profile production --platform ios --auto-submit-with-profile=production --no-wait --non-interactive
        eas build --profile production-android --platform android --no-wait --non-interactive
        ;;
    *)
        echo "用法: $0 [ios|android|submit]" >&2
        exit 1
        ;;
esac

echo ""
echo "✅ 完成!"
