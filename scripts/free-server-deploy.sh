#!/bin/bash
# Pull latest image and restart Free Server
# Run this on your VPS to update to the latest version

set -e

IMAGE_NAME="kilingzhang/free-server"
CONTAINER_NAME="free-server"
PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-./data}"

echo "📥 Pulling latest image..."
docker pull $IMAGE_NAME:latest

echo "🔄 Restarting container..."

# Stop and remove old container if exists
docker rm -f $CONTAINER_NAME 2>/dev/null || true

# Handle FREE_MASTER_SECRET - generate once and persist
SECRET_FILE="$DATA_DIR/.secret"
mkdir -p "$DATA_DIR"

if [ -z "$FREE_MASTER_SECRET" ]; then
    if [ -f "$SECRET_FILE" ]; then
        FREE_MASTER_SECRET=$(cat "$SECRET_FILE")
        echo "📝 Using existing secret from $SECRET_FILE"
    else
        FREE_MASTER_SECRET=$(openssl rand -hex 32)
        echo "$FREE_MASTER_SECRET" > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
        echo "🔑 Generated new secret and saved to $SECRET_FILE"
    fi
fi

# Start new container
docker run -d \
    --name $CONTAINER_NAME \
    --restart unless-stopped \
    -p $PORT:3000 \
    -v "$DATA_DIR:/app/data" \
    -e FREE_MASTER_SECRET="$FREE_MASTER_SECRET" \
    $IMAGE_NAME:latest

echo "✅ Done!"
echo ""
echo "Container: $CONTAINER_NAME"
echo "Port: $PORT"
echo "Data: $DATA_DIR"
echo ""
echo "Logs: docker logs -f $CONTAINER_NAME"
