#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Free CLI - Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/uninstall.sh | bash
# ============================================================================

INSTALL_DIR="${FREE_INSTALL_DIR:-$HOME/.free/source}"
BIN_DIR="${FREE_BIN_DIR:-$HOME/.local/bin}"
FREE_HOME="${FREE_HOME:-$HOME/.free}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }

echo ""
echo -e "${BOLD}Free CLI Uninstaller${NC}"
echo ""

removed=0

# ── Step 1: Stop and uninstall daemon service ───────────────────────────────

if [ -f "$BIN_DIR/free" ]; then
    info "Stopping daemon service..."
    if "$BIN_DIR/free" daemon stop 2>/dev/null; then
        ok "Daemon stopped"
    fi

    info "Uninstalling daemon service..."
    if "$BIN_DIR/free" daemon uninstall 2>/dev/null; then
        ok "Daemon service uninstalled"
    else
        warn "Could not uninstall daemon service (may need sudo or not installed)"
    fi
fi

# ── Step 2: Remove binaries ───────────────────────────────────────────────────

for bin in free free-mcp; do
    if [ -f "$BIN_DIR/$bin" ]; then
        rm "$BIN_DIR/$bin"
        ok "Removed $BIN_DIR/$bin"
        removed=1
    fi
done

# ── Step 3: Remove source code ────────────────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed $INSTALL_DIR"
    removed=1
fi

# ── Step 4: Remove logs ───────────────────────────────────────────────────────

LOG_DIR="$FREE_HOME/logs"
if [ -d "$LOG_DIR" ]; then
    rm -rf "$LOG_DIR"
    ok "Removed logs: $LOG_DIR"
    removed=1
fi

# ── Step 5: Remove daemon state files ─────────────────────────────────────────

DAEMON_STATE="$FREE_HOME/daemon.state.json"
DAEMON_LOCK="$FREE_HOME/daemon.state.json.lock"
if [ -f "$DAEMON_STATE" ]; then
    rm "$DAEMON_STATE"
    ok "Removed daemon state"
fi
if [ -f "$DAEMON_LOCK" ]; then
    rm "$DAEMON_LOCK"
    ok "Removed daemon lock"
fi

# ── Step 6: Ask about authentication data ───────────────────────────────────

AUTH_DIR="$FREE_HOME"
if [ -d "$AUTH_DIR" ] && [ -f "$AUTH_DIR/access.key" ]; then
    echo ""
    echo -e "${YELLOW}Authentication data found at $AUTH_DIR${NC}"
    echo -e "${YELLOW}This includes your login credentials and encryption keys.${NC}"
    echo ""
    echo "  [1] Remove everything (complete uninstall)"
    echo "  [2] Keep authentication data (you can re-install later without re-login)"
    echo ""
    read -p "Choose [1/2] (default: 2): " -r response
    case "$response" in
        1)
            rm -rf "$AUTH_DIR"
            ok "Removed all data: $AUTH_DIR"
            removed=1
            ;;
        *)
            info "Keeping authentication data at $AUTH_DIR"
            info "To remove manually: rm -rf $AUTH_DIR"
            ;;
    esac
fi

# ── Step 7: Clean up empty parent dir ───────────────────────────────────────

if [ -d "$FREE_HOME" ] && [ -z "$(ls -A "$FREE_HOME" 2>/dev/null)" ]; then
    rmdir "$FREE_HOME"
    ok "Removed empty $FREE_HOME"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

if [ "$removed" -eq 0 ]; then
    warn "Nothing to uninstall — Free CLI was not found."
else
    echo ""
    echo -e "${GREEN}${BOLD}✓ Free CLI has been uninstalled.${NC}"
fi
echo ""
