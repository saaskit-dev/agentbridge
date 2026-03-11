#!/bin/bash
# EAS 构建前注入 Firebase 配置文件
# 从 EAS secrets（base64 编码）解码写入对应路径

set -e

FIREBASE_DIR="$EAS_BUILD_WORKINGDIR/apps/free/app/firebase"
mkdir -p "$FIREBASE_DIR"

if [ -n "$GOOGLE_SERVICES_IOS_PRODUCTION" ]; then
  echo "📦 注入 GoogleService-Info.production.plist"
  echo "$GOOGLE_SERVICES_IOS_PRODUCTION" | base64 --decode > "$FIREBASE_DIR/GoogleService-Info.production.plist"
else
  echo "⚠️  GOOGLE_SERVICES_IOS_PRODUCTION 未设置，跳过"
fi

if [ -n "$GOOGLE_SERVICES_IOS_PREVIEW" ]; then
  echo "📦 注入 GoogleService-Info.preview.plist"
  echo "$GOOGLE_SERVICES_IOS_PREVIEW" | base64 --decode > "$FIREBASE_DIR/GoogleService-Info.preview.plist"
fi

if [ -n "$GOOGLE_SERVICES_IOS_DEVELOPMENT" ]; then
  echo "📦 注入 GoogleService-Info.development.plist"
  echo "$GOOGLE_SERVICES_IOS_DEVELOPMENT" | base64 --decode > "$FIREBASE_DIR/GoogleService-Info.development.plist"
fi

if [ -n "$GOOGLE_SERVICES_ANDROID" ]; then
  echo "📦 注入 google-services.json"
  echo "$GOOGLE_SERVICES_ANDROID" | base64 --decode > "$FIREBASE_DIR/google-services.json"
fi
