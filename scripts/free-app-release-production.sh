#!/bin/bash

# Free App - 生产版发布
# 用法: ./scripts/free-app-release-production.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 发布 Free App 生产版"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

eas build --profile production --platform ios --auto-submit-with-profile=production --no-wait --non-interactive
eas build --profile production --platform android --auto-submit-with-profile=production --no-wait --non-interactive

echo ""
echo "✅ 生产版发布完成!"
