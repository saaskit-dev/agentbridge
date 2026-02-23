#!/bin/bash
# Build and push Free Server to Docker Hub
# Run this locally to build and publish new version

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="kilingzhang/free-server"

cd "$SCRIPT_DIR"

echo "🏗️  Building Free Server..."

# 1. Build bundle
echo "Building bundle..."
pnpm build:bundle
pnpm db:generate

# 2. Build Docker image locally (native platform for dev)
echo "📦 Building Docker image locally..."
docker build -t $IMAGE_NAME:latest .

# 3. Build and push for linux/amd64 (for VPS deployment)
echo "🚀 Building and pushing for linux/amd64..."
docker buildx build --platform linux/amd64 -t $IMAGE_NAME:latest --push .

echo "✅ Done!"
echo ""
echo "Local image: $IMAGE_NAME:latest (native)"
echo "Pushed image: $IMAGE_NAME:latest (linux/amd64)"
echo ""
echo "On your VPS, run: ./deploy.sh"
