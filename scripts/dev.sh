#!/bin/bash

# ============================================================================
# Free 开发环境启动脚本
# 每次执行都会杀死历史进程，然后启动最新代码
# ============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 端口配置
SERVER_PORT=3000
WEB_PORT=8081

# 日志目录
LOG_DIR="$PROJECT_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# ============================================================================
# 辅助函数
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ============================================================================
# 清理函数
# ============================================================================

kill_port() {
    local port=$1
    local service_name=$2

    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        log_info "停止 $service_name (端口 $port)..."
        lsof -Pi :$port -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

cleanup_all() {
    log_section "清理历史进程"

    # 杀死端口进程
    kill_port $SERVER_PORT "Backend Server"
    kill_port $WEB_PORT "Web App"

    # 杀死所有 free 相关进程
    log_info "清理 free 相关进程..."
    pkill -f "free-server" 2>/dev/null || true
    pkill -f "free/app" 2>/dev/null || true
    pkill -f "expo" 2>/dev/null || true
    pkill -f "node.*standalone" 2>/dev/null || true

    # 停止 daemon
    log_info "停止 daemon..."
    free daemon stop 2>/dev/null || true

    # 清理 PGlite 锁文件（如果存在）
    if [ -d "$PROJECT_ROOT/apps/free/server/data/pglite" ]; then
        rm -f "$PROJECT_ROOT/apps/free/server/data/pglite/"*.lock 2>/dev/null || true
    fi

    # 清理所有中间构建文件
    log_info "清理中间构建文件..."
    rm -rf "$PROJECT_ROOT/packages/core/dist" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/apps/free/cli/dist" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/apps/free/server/.next" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/apps/free/app/.expo" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/apps/free/app/web-build" 2>/dev/null || true
    rm -rf "$PROJECT_ROOT/.turbo" 2>/dev/null || true

    # 清理 TypeScript 增量编译缓存
    find "$PROJECT_ROOT/packages" -name "*.tsbuildinfo" -delete 2>/dev/null || true

    log_success "清理完成"
}

# ============================================================================
# 构建函数
# ============================================================================

build_core() {
    log_section "构建 Core 包"

    log_info "构建 @agentbridge/core..."
    cd "$PROJECT_ROOT/packages/core"
    pnpm build 2>&1 | tee "$LOG_DIR/build-core.log"

    log_success "Core 包构建完成"
}

build_cli() {
    log_section "构建 CLI"

    cd "$PROJECT_ROOT/apps/free/cli"
    pnpm build 2>&1 | tee "$LOG_DIR/build-cli.log"

    log_success "CLI 构建完成"
}

link_cli() {
    log_section "安装 CLI 全局命令"

    cd "$PROJECT_ROOT/apps/free/cli"

    # 先移除旧的全局链接（如果存在）
    npm unlink -g @free/cli 2>/dev/null || true

    # 创建新的全局链接
    npm link 2>&1 | tee "$LOG_DIR/link-cli.log"

    # 验证
    if command -v free &> /dev/null; then
        CLI_VERSION=$(free --version 2>/dev/null | head -1 || echo "unknown")
        log_success "CLI 全局命令已安装: free ($CLI_VERSION)"
    else
        log_warn "CLI 全局命令安装失败，请手动执行: cd apps/free/cli && npm link"
    fi
}

# ============================================================================
# 启动函数
# ============================================================================

start_server() {
    log_section "启动后端服务器"

    cd "$PROJECT_ROOT/apps/free/server"

    # 检查 .env 文件
    if [ ! -f ".env" ]; then
        log_warn ".env 文件不存在，从 .env.example 复制..."
        cp .env.example .env 2>/dev/null || echo "NODE_ENV=development" > .env
    fi

    # 生成 Prisma Client
    log_info "生成 Prisma Client..."
    pnpm db:generate > /dev/null 2>&1

    log_info "启动 Server (端口 $SERVER_PORT)..."

    # 使用 standalone 模式（PGlite）
    pnpm --filter @free/server standalone serve 2>&1 | tee "$LOG_DIR/server.log" &
    SERVER_PID=$!

    echo $SERVER_PID > "$LOG_DIR/server.pid"

    # 等待服务器启动
    log_info "等待服务器启动..."
    for i in {1..30}; do
        if curl -s "http://localhost:$SERVER_PORT/health" > /dev/null 2>&1; then
            log_success "服务器已启动 (PID: $SERVER_PID)"
            log_info "Health: http://localhost:$SERVER_PORT/health"
            log_info "API: http://localhost:$SERVER_PORT/api"
            return 0
        fi
        sleep 1
    done

    log_error "服务器启动超时"
    return 1
}

start_daemon() {
    log_section "启动 Daemon"

    # 设置服务器 URL
    export FREE_SERVER_URL="http://localhost:$SERVER_PORT"

    log_info "启动 free daemon..."
    free daemon start 2>&1 | tee "$LOG_DIR/daemon.log" || true

    # 显示 daemon 状态
    sleep 2
    if free daemon status > /dev/null 2>&1; then
        log_success "Daemon 已启动"

        # 显示 machine id (从 settings 文件读取)
        if [ -f "$HOME/.free/settings.json" ]; then
            MACHINE_ID=$(cat "$HOME/.free/settings.json" 2>/dev/null | grep -o '"machineId":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
            if [ -n "$MACHINE_ID" ]; then
                log_info "Machine ID: $MACHINE_ID"
            fi
        fi
    else
        log_warn "Daemon 启动失败或未运行"
    fi
}

start_web() {
    log_section "启动 Web 应用"

    cd "$PROJECT_ROOT/apps/free/app"

    # 设置环境变量
    export EXPO_PUBLIC_FREE_SERVER_URL="http://localhost:$SERVER_PORT"

    log_info "启动 Expo (iOS/Android/Web)..."

    npx expo start 2>&1 | tee "$LOG_DIR/web.log" &
    WEB_PID=$!

    echo $WEB_PID > "$LOG_DIR/web.pid"

    # 等待 Web 启动
    log_info "等待 Web 应用启动..."
    sleep 5

    log_success "Web 应用已启动 (PID: $WEB_PID)"
    log_info "Web: http://localhost:$WEB_PORT"
}

# ============================================================================
# 健康检查
# ============================================================================

health_check() {
    log_section "健康检查"

    echo ""
    echo "服务状态:"
    echo "─────────────────────────────────────────────────────────────"

    # Server
    if curl -s "http://localhost:$SERVER_PORT/health" > /dev/null 2>&1; then
        echo -e "Backend Server:  ${GREEN}✓ Running${NC} (http://localhost:$SERVER_PORT)"
    else
        echo -e "Backend Server:  ${RED}✗ Not running${NC}"
    fi

    # Web
    if curl -s "http://localhost:$WEB_PORT" > /dev/null 2>&1; then
        echo -e "Web App:         ${GREEN}✓ Running${NC} (http://localhost:$WEB_PORT)"
    else
        echo -e "Web App:         ${RED}✗ Not running${NC}"
    fi

    # Metrics (now integrated into server on port 3001)
    if curl -s "http://localhost:$SERVER_PORT/metrics" > /dev/null 2>&1; then
        echo -e "Metrics:         ${GREEN}✓ Running${NC} (http://localhost:$SERVER_PORT/metrics)"
    else
        echo -e "Metrics:         ${YELLOW}○ Not running${NC}"
    fi

    echo "─────────────────────────────────────────────────────────────"
    echo ""
}

# ============================================================================
# 显示帮助
# ============================================================================

show_help() {
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --skip-build     跳过构建和 CLI 全局链接步骤"
    echo "  --server-only    只启动服务器"
    echo "  --web-only       只启动 Web"
    echo "  --no-clean       不清理历史进程"
    echo "  --help           显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0                    # 完整启动（清理 + 构建 + CLI链接 + 启动所有服务）"
    echo "  $0 --skip-build       # 跳过构建，只启动服务"
    echo "  $0 --server-only      # 只启动后端服务器"
    echo "  $0 --no-clean         # 不杀死历史进程"
    echo ""
    echo "全局命令:"
    echo "  构建后会自动执行 npm link，之后可以直接使用 'free' 命令"
    echo ""
    echo "日志目录: $LOG_DIR"
    echo ""
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    local skip_build=false
    local server_only=false
    local web_only=false
    local no_clean=false

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                skip_build=true
                shift
                ;;
            --server-only)
                server_only=true
                shift
                ;;
            --web-only)
                web_only=true
                shift
                ;;
            --no-clean)
                no_clean=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                exit 1
                ;;
        esac
    done

    log_section "Free 开发环境"

    # 清理
    if [ "$no_clean" = false ]; then
        cleanup_all
    fi

    # 构建
    if [ "$skip_build" = false ]; then
        build_core
        build_cli
        link_cli
    fi

    # 启动服务
    if [ "$web_only" = true ]; then
        start_web
    elif [ "$server_only" = true ]; then
        start_server
        start_daemon
    else
        start_server
        start_daemon
        start_web
    fi

    # 健康检查
    health_check

    log_success "所有服务已启动！"
    log_info "按 Ctrl+C 停止所有服务"
    log_info "查看日志: ls $LOG_DIR"
    echo ""

    # 等待中断信号
    trap 'log_info "正在停止..."; kill_port $SERVER_PORT "Server"; kill_port $WEB_PORT "Web"; exit 0' INT TERM

    # 保持脚本运行
    wait
}

main "$@"
