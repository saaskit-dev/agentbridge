# Free Server Dockerfile - Optimized for minimal size
# Multi-stage build to exclude build tools from final image

# ===== Stage 1: Build =====
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy prisma schema
COPY prisma ./prisma

# Install only what's needed for generate
RUN npm install @prisma/client@6.19.2 prisma@6.19.2 privacy-kit@0.0.25 --legacy-peer-deps \
    && npx prisma generate \
    # Remove prisma CLI after generate, keep only client
    && rm -rf node_modules/prisma node_modules/.bin \
    && npm cache clean --force

# ===== Stage 2: Runtime =====
FROM node:20-slim

WORKDIR /app

# Install only runtime dependencies (wget for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /var/cache/apt/*

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy bundled code
COPY dist/bundle.cjs ./bundle.cjs
COPY dist/pglite.wasm ./pglite.wasm
COPY dist/pglite.data ./pglite.data

# Copy prisma (generated client + migrations)
COPY prisma ./prisma

# Copy startup script
COPY start-free.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start-free.sh

# Create data directory
RUN mkdir -p /app/data

VOLUME /app/data
EXPOSE 3000

# No default secret - must be provided at runtime
ENV NODE_ENV=production \
    PORT=3000 \
    PGLITE_DIR=/app/data/pglite

ENTRYPOINT ["/usr/local/bin/start-free.sh"]
