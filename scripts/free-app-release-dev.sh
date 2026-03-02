#!/bin/bash

# Free App - 开发版发布
# 用法: ./scripts/free-app-release-dev.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 发布 Free App 开发版"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

eas build --profile development --platform ios --no-wait --non-interactive
eas build --profile development --platform android --no-wait --non-interactive
eas build --profile preview --platform ios --no-wait --non-interactive
eas build --profile preview --platform android --no-wait --non-interactive
eas build --profile development-store --platform ios --auto-submit-with-profile=production --no-wait --non-interactive
eas build --profile preview-store --platform ios --auto-submit-with-profile=production --no-wait --non-interactive

echo ""
echo "✅ 开发版发布完成!"
