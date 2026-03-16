#!/bin/bash
# Pull latest image and restart Free Server
# Run this on your VPS to update to the latest version
#
# Usage:
#   ./free-server-deploy.sh          # Deploy latest
#   ./free-server-deploy.sh rollback # Rollback to previous version

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

# Load .env file if it exists (supports PORT, DATA_DIR, NEW_RELIC_LICENSE_KEY, etc.)
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    echo "📄 Loaded env from $ENV_FILE"
fi

IMAGE_NAME="kilingzhang/free-server"
CONTAINER_NAME="free-server"
PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-./data}"
FREE_HOME="${FREE_HOME:-$HOME/.free}"
HASH_FILE="$DATA_DIR/.previous-image-hash"

mkdir -p "$DATA_DIR" "$FREE_HOME"

# Save current image hash for rollback
save_current_hash() {
    local current_hash=$(docker inspect --format='{{.Image}}' $CONTAINER_NAME 2>/dev/null || true)
    if [ -n "$current_hash" ]; then
        echo "$current_hash" > "$HASH_FILE"
        echo "💾 Saved current image hash: ${current_hash:0:12}"
    fi
}

# Get previous image hash
get_previous_hash() {
    if [ -f "$HASH_FILE" ]; then
        cat "$HASH_FILE"
    fi
}

# Handle rollback
if [ "$1" = "rollback" ]; then
    PREVIOUS_HASH=$(get_previous_hash)
    if [ -z "$PREVIOUS_HASH" ]; then
        echo "❌ No previous image hash found. Cannot rollback."
        exit 1
    fi
    
    echo "🔙 Rolling back to image: ${PREVIOUS_HASH:0:12}"
    
    # Stop and remove current container
    docker rm -f $CONTAINER_NAME 2>/dev/null || true
    
    # Handle FREE_MASTER_SECRET
    SECRET_FILE="$DATA_DIR/.secret"
    if [ -z "$FREE_MASTER_SECRET" ]; then
        if [ -f "$SECRET_FILE" ]; then
            FREE_MASTER_SECRET=$(cat "$SECRET_FILE")
            echo "📝 Using existing secret from $SECRET_FILE"
        else
            echo "❌ No secret found. Set FREE_MASTER_SECRET or ensure $SECRET_FILE exists."
            exit 1
        fi
    fi
    
    # Start container with previous image
    DOCKER_ARGS=(
        --name "$CONTAINER_NAME"
        --restart unless-stopped
        -p "$PORT:3000"
        -v "$DATA_DIR:/app/data"
        -v "$FREE_HOME:/root/.free"
        -e FREE_MASTER_SECRET="$FREE_MASTER_SECRET"
    )
    [ -f "$ENV_FILE" ] && DOCKER_ARGS+=(--env-file "$ENV_FILE")
    docker run -d "${DOCKER_ARGS[@]}" "$IMAGE_NAME@$PREVIOUS_HASH"
    
    echo "✅ Rollback complete!"
    echo ""
    echo "Container: $CONTAINER_NAME"
    echo "Image: ${PREVIOUS_HASH:0:12}"
    echo "Logs: docker logs -f $CONTAINER_NAME"
    exit 0
fi

# Normal deployment flow
echo "📥 Pulling latest image..."

# Save current hash before pulling new image
save_current_hash

docker pull $IMAGE_NAME:latest

echo "🔄 Restarting container..."

# Stop and remove old container if exists
docker rm -f $CONTAINER_NAME 2>/dev/null || true

# Handle FREE_MASTER_SECRET - generate once and persist
SECRET_FILE="$DATA_DIR/.secret"

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
DOCKER_ARGS=(
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    -p "$PORT:3000"
    -v "$DATA_DIR:/app/data"
    -v "$FREE_HOME:/root/.free"
    -e FREE_MASTER_SECRET="$FREE_MASTER_SECRET"
)
[ -f "$ENV_FILE" ] && DOCKER_ARGS+=(--env-file "$ENV_FILE")
docker run -d "${DOCKER_ARGS[@]}" "$IMAGE_NAME:latest"

echo "✅ Done!"
echo ""
echo "Container: $CONTAINER_NAME"
echo "Port: $PORT"
echo "Data: $DATA_DIR"
echo ""
echo "Logs: docker logs -f $CONTAINER_NAME"

# Show rollback instruction
PREVIOUS_HASH=$(get_previous_hash)
if [ -n "$PREVIOUS_HASH" ]; then
    echo ""
    echo "💡 To rollback to previous version:"
    echo "   ./free-server-deploy.sh rollback"
fi
