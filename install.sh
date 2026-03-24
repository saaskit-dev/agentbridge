#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Free CLI - One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/install.sh | bash
# ============================================================================

REPO_URL="https://github.com/saaskit-dev/agentbridge.git"
INSTALL_DIR="${FREE_INSTALL_DIR:-$HOME/.free/source}"
BIN_DIR="${FREE_BIN_DIR:-$HOME/.local/bin}"
BRANCH="${FREE_BRANCH:-main}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

# ── Prerequisite checks ─────────────────────────────────────────────────────

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        err "$1 is required but not found."
        echo "  $2"
        return 1
    fi
}

info "Checking prerequisites..."

missing=0
check_cmd "git"  "Install git: https://git-scm.com" || missing=1
check_cmd "node" "Install Node.js >= 20: https://nodejs.org" || missing=1

if [ "$missing" -eq 1 ]; then
    err "Please install the missing dependencies and try again."
    exit 1
fi

# Check Node.js version >= 20
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
    err "Node.js >= 20 is required (found v$(node -v))"
    exit 1
fi

# Install pnpm if missing
if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found, installing via corepack..."
    if command -v corepack &>/dev/null; then
        corepack enable
        corepack prepare pnpm@latest --activate
    else
        info "Installing pnpm via npm..."
        npm install -g pnpm
    fi
fi

ok "All prerequisites satisfied"

# ── Clone / Update ───────────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation at $INSTALL_DIR ..."
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH" --depth 1
    git reset --hard FETCH_HEAD
elif [ -d "$INSTALL_DIR" ]; then
    # Directory exists but isn't a git repo - backup and re-clone
    warn "Directory $INSTALL_DIR exists but is not a git repository"
    BACKUP_DIR="$INSTALL_DIR.backup.$(date +%Y%m%d%H%M%S)"
    info "Backing up to $BACKUP_DIR and re-cloning..."
    mv "$INSTALL_DIR" "$BACKUP_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
else
    info "Cloning repository to $INSTALL_DIR ..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ── Install dependencies ────────────────────────────────────────────────────

info "Installing dependencies..."
pnpm install --frozen-lockfile --filter @saaskit-dev/agentbridge --filter @saaskit-dev/free 2>/dev/null || \
pnpm install --filter @saaskit-dev/agentbridge --filter @saaskit-dev/free

# ── Build ────────────────────────────────────────────────────────────────────

info "Building @saaskit-dev/agentbridge..."
pnpm --filter @saaskit-dev/agentbridge run build

info "Building @saaskit-dev/free..."
pnpm --filter @saaskit-dev/free run build

ok "Build complete"

# ── Create symlinks ──────────────────────────────────────────────────────────

CLI_DIST="$INSTALL_DIR/apps/free/cli/dist"

if [ ! -f "$CLI_DIST/cli.mjs" ]; then
    err "Build artifact not found at $CLI_DIST/cli.mjs"
    exit 1
fi

mkdir -p "$BIN_DIR"

# Create wrapper scripts (more portable than symlinks for .mjs files)
cat > "$BIN_DIR/free" << 'WRAPPER'
#!/usr/bin/env bash
exec node "INSTALL_DIR_PLACEHOLDER/apps/free/cli/dist/cli.mjs" "$@"
WRAPPER
sed -i.bak "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" "$BIN_DIR/free" && rm -f "$BIN_DIR/free.bak"
chmod +x "$BIN_DIR/free"

cat > "$BIN_DIR/free-mcp" << 'WRAPPER'
#!/usr/bin/env bash
exec node "INSTALL_DIR_PLACEHOLDER/apps/free/cli/dist/mcp-bridge.mjs" "$@"
WRAPPER
sed -i.bak "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" "$BIN_DIR/free-mcp" && rm -f "$BIN_DIR/free-mcp.bak"
chmod +x "$BIN_DIR/free-mcp"

ok "Installed 'free' and 'free-mcp' to $BIN_DIR"

# ── PATH check ───────────────────────────────────────────────────────────────

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    warn "$BIN_DIR is not in your PATH."
    echo ""
    echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo -e "    ${BOLD}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
    echo ""
    echo "  Then reload your shell:"
    echo ""
    echo -e "    ${BOLD}source ~/.zshrc${NC}  # or ~/.bashrc"
    echo ""
fi

# ── Restart daemon ──────────────────────────────────────────────────────────

# Stop any running daemon so the LaunchAgent/systemd starts the new binary
FREE_HOME="${FREE_HOME_DIR:-$HOME/.free}"
DAEMON_STATE="$FREE_HOME/daemon.state.json"
if [ -f "$DAEMON_STATE" ]; then
    OLD_PID=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$DAEMON_STATE','utf-8')).pid)}catch{}" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        info "Stopping old daemon (pid $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        # Wait briefly for graceful shutdown
        for i in $(seq 1 20); do
            kill -0 "$OLD_PID" 2>/dev/null || break
            sleep 0.25
        done
    fi
fi

info "Installing daemon as background service..."
if "$BIN_DIR/free" daemon install 2>/dev/null; then
    ok "Daemon installed and started"
else
    warn "Could not auto-install daemon service. Run 'free daemon install' manually after restarting your shell."
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}✓ Free CLI installed successfully!${NC}"
echo ""
echo "  Source:   $INSTALL_DIR"
echo "  Binaries: $BIN_DIR/free, $BIN_DIR/free-mcp"
echo ""
echo "  Get started:"
echo -e "    ${BOLD}free auth${NC}        # Authenticate"
echo -e "    ${BOLD}free${NC}             # Start Claude Code session"
echo -e "    ${BOLD}free gemini${NC}      # Start Gemini session"
echo ""
echo "  To update later:"
echo -e "    ${BOLD}curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/install.sh | bash${NC}"
echo ""
