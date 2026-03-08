#!/bin/bash

# Free Server - 构建并推送到 Docker Hub
# 用法: ./scripts/free-server-build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$ROOT_DIR/apps/free/server"
IMAGE_NAME="kilingzhang/free-server"

echo "🏗️  构建 Free Server"
echo "   Server 目录: $SERVER_DIR"
echo ""

cd "$SERVER_DIR"

# 1. Build bundle
echo "📦 Building bundle..."
pnpm build:bundle
pnpm db:generate

# 2. Copy pglite wasm files to dist
echo "📋 Copying pglite wasm files..."
PGLITE_DIR=$(find "$ROOT_DIR/node_modules/.pnpm" -path "*pglite/dist" -type d 2>/dev/null | head -1)
if [ -z "$PGLITE_DIR" ]; then
    echo "ERROR: Could not find pglite dist directory"
    exit 1
fi
cp "$PGLITE_DIR/pglite.wasm" dist/
cp "$PGLITE_DIR/pglite.data" dist/
echo "   Copied from: $PGLITE_DIR"

# 3. Build Docker image locally (native platform for dev)
echo "🐳 Building Docker image locally..."
docker build --build-arg BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") -t $IMAGE_NAME:latest .

# 4. Build and push for linux/amd64 (for VPS deployment)
echo "🚀 Building and pushing for linux/amd64..."
docker buildx build --platform linux/amd64 --build-arg BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") -t $IMAGE_NAME:latest --push .

echo ""
echo "✅ Done!"
echo "   Local image: $IMAGE_NAME:latest (native)"
echo "   Pushed image: $IMAGE_NAME:latest (linux/amd64)"
echo ""
echo "On your VPS, run: ./scripts/free-server-deploy.sh"
