#!/bin/bash

# Free App - 生产版发布
# 用法:
#   ./scripts/free-app-release-production.sh ios
#   ./scripts/free-app-release-production.sh android
#
# 说明:
#   iOS 走本机 / self-hosted GitHub runner + App Store Connect。
#   Android 走本机 / self-hosted GitHub runner 构建 signed AAB，CI 再上传 Google Play。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 发布 Free App 生产版"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

case "${1:-}" in
    ios)
        echo "🍎 本机构建 iOS → App Store Connect / TestFlight..."
        APP_ENV=production "$ROOT_DIR/scripts/free-app-ios-release.sh"
        ;;
    android)
        echo "🤖 本机构建 Android AAB..."
        APP_ENV=production "$ROOT_DIR/scripts/free-app-android-release.sh"
        ;;
    "")
        echo "用法: $0 ios|android" >&2
        exit 1
        ;;
    *)
        echo "用法: $0 ios|android" >&2
        exit 1
        ;;
esac

echo ""
echo "✅ 完成!"
