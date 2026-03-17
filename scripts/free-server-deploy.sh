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
    
    # Gracefully stop then remove current container
    docker stop --time 15 $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
    
    # Handle FREE_MASTER_SECRET — .secret file is the source of truth
    SECRET_FILE="$DATA_DIR/.secret"
    if [ -f "$SECRET_FILE" ]; then
        FREE_MASTER_SECRET=$(cat "$SECRET_FILE")
        echo "📝 Using existing secret from $SECRET_FILE"
    else
        echo "❌ No secret found. Ensure $SECRET_FILE exists (created by initial deploy)."
        exit 1
    fi
    
    # Start container with previous image
    DOCKER_ARGS=(
        --name "$CONTAINER_NAME"
        --restart unless-stopped
        -p "$PORT:3000"
        -v "$DATA_DIR:/app/data"
        -v "$FREE_HOME:/root/.free"
    )
    [ -f "$ENV_FILE" ] && DOCKER_ARGS+=(--env-file "$ENV_FILE")
    DOCKER_ARGS+=(
        -e FREE_MASTER_SECRET="$FREE_MASTER_SECRET"
        -e APP_ENV="${APP_ENV:-production}"
    )
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

# Gracefully stop old container (SIGTERM → wait → SIGKILL) so PGlite can flush WAL,
# then remove it. docker rm -f sends SIGKILL immediately and corrupts PGlite data.
docker stop --time 15 $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

# Handle FREE_MASTER_SECRET - the .secret file is the single source of truth.
# If .env also sets FREE_MASTER_SECRET, the .secret file takes precedence to
# prevent accidental token invalidation from env drift.
SECRET_FILE="$DATA_DIR/.secret"

if [ -f "$SECRET_FILE" ]; then
    # .secret file exists — always use it (overrides any value from .env)
    PERSISTED_SECRET=$(cat "$SECRET_FILE")
    if [ -n "$FREE_MASTER_SECRET" ] && [ "$FREE_MASTER_SECRET" != "$PERSISTED_SECRET" ]; then
        echo "⚠️  WARNING: FREE_MASTER_SECRET from .env differs from $SECRET_FILE"
        echo "   Using persisted secret from $SECRET_FILE to avoid token invalidation."
        echo "   To intentionally rotate the secret, delete $SECRET_FILE first."
    fi
    FREE_MASTER_SECRET="$PERSISTED_SECRET"
    echo "📝 Using existing secret from $SECRET_FILE"
elif [ -n "$FREE_MASTER_SECRET" ]; then
    # No .secret file but env/cli provided a secret — persist it
    echo "$FREE_MASTER_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "📝 Persisted provided secret to $SECRET_FILE"
else
    # First deploy ever — generate and persist
    FREE_MASTER_SECRET=$(openssl rand -hex 32)
    echo "$FREE_MASTER_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "🔑 Generated new secret and saved to $SECRET_FILE"
fi

# Start new container
# Note: -e takes precedence over --env-file for same-name vars in Docker.
# We put --env-file first and -e FREE_MASTER_SECRET last to make intent clear:
# the .secret file is always authoritative.
DOCKER_ARGS=(
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    -p "$PORT:3000"
    -v "$DATA_DIR:/app/data"
    -v "$FREE_HOME:/root/.free"
)
[ -f "$ENV_FILE" ] && DOCKER_ARGS+=(--env-file "$ENV_FILE")
DOCKER_ARGS+=(
    -e FREE_MASTER_SECRET="$FREE_MASTER_SECRET"
    -e APP_ENV="${APP_ENV:-production}"
)
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
