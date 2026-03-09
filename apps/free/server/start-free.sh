#!/bin/bash
# Startup script for Free Server

set -e

# Read version info with node (more reliable than grep/sed)
if [ -f /app/version.json ]; then
    VERSION=$(node -p "require('/app/version.json').version" 2>/dev/null || echo '')
    BUILD_TIME=$(node -p "require('/app/version.json').buildTime" 2>/dev/null || echo '')
fi

echo "=== Starting Free Server ==="
echo "VERSION: ${VERSION:-unknown}"
echo "BUILD_TIME: ${BUILD_TIME:-unknown}"
echo "NODE_VERSION: $(node --version 2>&1)"
echo "PWD: $(pwd)"
echo "PORT: $PORT"
echo "PGLITE_DIR: $PGLITE_DIR"
echo "NODE_ENV: $NODE_ENV"

# Check if FREE_MASTER_SECRET is set
if [ -z "$FREE_MASTER_SECRET" ]; then
    echo "ERROR: FREE_MASTER_SECRET environment variable is required"
    echo "Set it with: -e FREE_MASTER_SECRET=your-secret"
    exit 1
fi

# Create data directory if not exists
mkdir -p "${PGLITE_DIR:-/app/data/pglite}"

# Start the server
echo "Starting server..."
exec node --enable-source-maps bundle.cjs serve
