#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Free CLI - Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/uninstall.sh | bash
# ============================================================================

INSTALL_DIR="${FREE_INSTALL_DIR:-$HOME/.free/source}"
BIN_DIR="${FREE_BIN_DIR:-$HOME/.local/bin}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }

echo ""
echo -e "${BOLD}Free CLI Uninstaller${NC}"
echo ""

removed=0

# Remove binaries
for bin in free free-mcp; do
    if [ -f "$BIN_DIR/$bin" ]; then
        rm "$BIN_DIR/$bin"
        ok "Removed $BIN_DIR/$bin"
        removed=1
    fi
done

# Remove source
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed $INSTALL_DIR"
    removed=1
fi

# Clean up empty parent dir
FREE_HOME="${INSTALL_DIR%/source}"
if [ -d "$FREE_HOME" ] && [ -z "$(ls -A "$FREE_HOME" 2>/dev/null)" ]; then
    rmdir "$FREE_HOME"
    ok "Removed empty $FREE_HOME"
fi

if [ "$removed" -eq 0 ]; then
    warn "Nothing to uninstall — Free CLI was not found."
else
    echo ""
    echo -e "${GREEN}${BOLD}✓ Free CLI has been uninstalled.${NC}"
fi
echo ""
