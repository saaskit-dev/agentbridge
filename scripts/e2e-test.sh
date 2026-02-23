#!/bin/bash

# =============================================================================
# AgentBridge E2E Test Script
# =============================================================================
# This script starts the full AgentBridge stack and runs Playwright tests
#
# Usage:
#   ./scripts/e2e-test.sh              # Run all tests
#   ./scripts/e2e-test.sh --no-test    # Start servers only (no tests)
#   ./scripts/e2e-test.sh --cleanup    # Kill all running servers
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_PORT=3001
FRONTEND_PORT=8081
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.test-logs"
PID_FILE="$PROJECT_ROOT/.test-pids"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"

    if [ -f "$PID_FILE" ]; then
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                echo "  Killed process $pid"
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi

    # Kill any processes on our ports
    lsof -ti:$BACKEND_PORT 2>/dev/null | xargs kill 2>/dev/null || true
    lsof -ti:$FRONTEND_PORT 2>/dev/null | xargs kill 2>/dev/null || true

    echo -e "${GREEN}Cleanup complete.${NC}"
}

# Register cleanup on exit
trap cleanup EXIT

# Create log directory
mkdir -p "$LOG_DIR"

# Parse arguments
RUN_TESTS=true
TEST_PATTERN="auth-flow.spec.ts"  # Run auth flow test by default
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-test)
            RUN_TESTS=false
            shift
            ;;
        --quick)
            TEST_PATTERN="test-infinite-loop.spec.ts"
            shift
            ;;
        --cleanup)
            cleanup
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          AgentBridge E2E Test Runner                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Step 1: Start Backend Server
# =============================================================================
echo -e "${YELLOW}[1/3] Starting backend server on port $BACKEND_PORT...${NC}"

cd "$PROJECT_ROOT"

# Check if port is already in use
if lsof -i:$BACKEND_PORT >/dev/null 2>&1; then
    echo -e "${YELLOW}  Port $BACKEND_PORT is already in use. Killing existing process...${NC}"
    lsof -ti:$BACKEND_PORT | xargs kill 2>/dev/null || true
    sleep 2
fi

# Start backend server
cd "$PROJECT_ROOT/packages/free/server"
pnpm standalone serve > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID >> "$PID_FILE"
echo "  Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo -n "  Waiting for backend"
for i in {1..30}; do
    if curl -s "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Check if backend started
if ! curl -s "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
    echo -e "\n${RED}✗ Backend failed to start!${NC}"
    echo "  Check logs at: $LOG_DIR/backend.log"
    cat "$LOG_DIR/backend.log" | tail -20
    exit 1
fi

# =============================================================================
# Step 2: Start Frontend (Expo Web)
# =============================================================================
echo -e "${YELLOW}[2/3] Starting frontend on port $FRONTEND_PORT...${NC}"

# Check if port is already in use
if lsof -i:$FRONTEND_PORT >/dev/null 2>&1; then
    echo -e "${YELLOW}  Port $FRONTEND_PORT is already in use. Killing existing process...${NC}"
    lsof -ti:$FRONTEND_PORT | xargs kill 2>/dev/null || true
    sleep 2
fi

# Start Expo web
pnpm --filter @free/app web > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID >> "$PID_FILE"
echo "  Frontend PID: $FRONTEND_PID"

# Wait for frontend to be ready
echo -n "  Waiting for frontend"
for i in {1..60}; do
    if curl -s "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Check if frontend started
if ! curl -s "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1; then
    echo -e "\n${RED}✗ Frontend failed to start!${NC}"
    echo "  Check logs at: $LOG_DIR/frontend.log"
    cat "$LOG_DIR/frontend.log" | tail -20
    exit 1
fi

# Give Metro bundler a bit more time to fully compile
echo "  Waiting for bundle to compile..."
sleep 5

# =============================================================================
# Step 3: Run Tests (or keep servers running)
# =============================================================================
if [ "$RUN_TESTS" = true ]; then
    echo -e "${YELLOW}[3/3] Running Playwright tests ($TEST_PATTERN)...${NC}"
    echo ""

    cd "$PROJECT_ROOT"

    # Create test-results directory
    mkdir -p test-results

    # Run the test
    if pnpm exec playwright test "tests/$TEST_PATTERN" --headed; then
        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                  All Tests Passed!                       ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
        TEST_RESULT=0
    else
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║                  Tests Failed!                           ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
        TEST_RESULT=1
    fi
else
    echo -e "${YELLOW}[3/3] Servers running (no tests requested)${NC}"
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Servers are running!                        ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  Backend:   http://localhost:$BACKEND_PORT/api            ${NC}"
    echo -e "${GREEN}║  Frontend:  http://localhost:$FRONTEND_PORT               ${NC}"
    echo -e "${GREEN}║  Health:    http://localhost:$BACKEND_PORT/health         ${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  Press Ctrl+C to stop all servers                        ${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Keep script running to maintain servers
    wait
fi

exit ${TEST_RESULT:-0}
