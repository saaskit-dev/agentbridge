#!/bin/bash
# ============================================================================
# npm 发包管理脚本
#
#   ./scripts/npm-publish.sh                查看当前状态
#   ./scripts/npm-publish.sh check          预检查（dry-run）
#   ./scripts/npm-publish.sh version patch  升版号（patch/minor/major）
#   ./scripts/npm-publish.sh publish        正式发布
# ============================================================================

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/packages/core"
CLI_DIR="$ROOT/apps/free/cli"
REGISTRY="https://registry.npmjs.org"

# ─── 颜色 ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

die()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }
info() { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

# ─── 版本读取 ──────────────────────────────────────────────────────────────

get_version() {
    node -p "require('$1/package.json').version"
}

get_name() {
    node -p "require('$1/package.json').name"
}

CORE_NAME=$(get_name "$CORE_DIR")
CLI_NAME=$(get_name "$CLI_DIR")

# ─── status ────────────────────────────────────────────────────────────────

cmd_status() {
    local core_ver=$(get_version "$CORE_DIR")
    local cli_ver=$(get_version "$CLI_DIR")

    echo ""
    echo -e "${BOLD}npm 包状态${NC}"
    echo ""
    echo -e "  ${CYAN}$CORE_NAME${NC}"
    echo -e "    本地版本:  ${BOLD}$core_ver${NC}"
    local remote_core=$(npm view "$CORE_NAME" version --registry "$REGISTRY" 2>/dev/null || echo "未发布")
    echo -e "    线上版本:  $remote_core"
    echo ""
    echo -e "  ${CYAN}$CLI_NAME${NC}"
    echo -e "    本地版本:  ${BOLD}$cli_ver${NC}"
    local remote_cli=$(npm view "$CLI_NAME" version --registry "$REGISTRY" 2>/dev/null || echo "未发布")
    echo -e "    线上版本:  $remote_cli"
    echo ""

    # 检查登录状态
    local whoami=$(npm whoami --registry "$REGISTRY" 2>/dev/null || echo "")
    if [ -n "$whoami" ]; then
        ok "npm 已登录: $whoami"
    else
        warn "npm 未登录，发布前需要 npm login --registry $REGISTRY"
    fi
    echo ""
}

# ─── version ───────────────────────────────────────────────────────────────

cmd_version() {
    local bump="${1:-}"
    if [ -z "$bump" ]; then
        echo "用法: $0 version <patch|minor|major|x.y.z>"
        echo ""
        echo "  同时更新 core 和 CLI 的版本号"
        return
    fi

    local core_ver=$(get_version "$CORE_DIR")

    # 计算新版本
    local new_ver
    if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        new_ver="$bump"
    else
        new_ver=$(node -e "
            const [major, minor, patch] = '$core_ver'.split('.').map(Number);
            const m = { patch: [major, minor, patch+1], minor: [major, minor+1, 0], major: [major+1, 0, 0] };
            const r = m['$bump'];
            if (!r) { console.error('无效: $bump'); process.exit(1); }
            console.log(r.join('.'));
        ")
    fi

    info "版本: $core_ver → $new_ver"
    echo ""

    # 更新 core
    cd "$CORE_DIR"
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        pkg.version = '$new_ver';
        fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    ok "$CORE_NAME → $new_ver"

    # 更新 CLI
    cd "$CLI_DIR"
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        pkg.version = '$new_ver';
        fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    ok "$CLI_NAME → $new_ver"

    echo ""
    info "版本号已更新，接下来可以运行:"
    echo -e "  ${DIM}$0 check     # 预检查${NC}"
    echo -e "  ${DIM}$0 publish   # 正式发布${NC}"
}

# ─── check (dry-run) ──────────────────────────────────────────────────────

cmd_check() {
    local core_ver=$(get_version "$CORE_DIR")
    local cli_ver=$(get_version "$CLI_DIR")

    echo ""
    echo -e "${BOLD}发布预检查${NC}"
    echo ""

    # 1. npm 登录
    info "检查 npm 登录状态..."
    local whoami=$(npm whoami --registry "$REGISTRY" 2>/dev/null || echo "")
    if [ -z "$whoami" ]; then
        die "npm 未登录，请先运行: npm login --registry $REGISTRY"
    fi
    ok "npm 已登录: $whoami"

    # 2. 工作区是否干净
    info "检查 git 工作区..."
    local git_status=$(cd "$ROOT" && git status --porcelain packages/core apps/free/cli 2>/dev/null | head -5)
    if [ -n "$git_status" ]; then
        warn "工作区有未提交的变更:"
        echo -e "${DIM}$git_status${NC}"
        echo ""
    else
        ok "工作区干净"
    fi

    # 3. 版本号是否已被占用
    info "检查版本号..."
    local remote_core=$(npm view "$CORE_NAME@$core_ver" version --registry "$REGISTRY" 2>/dev/null || echo "")
    if [ -n "$remote_core" ]; then
        die "$CORE_NAME@$core_ver 已存在于 registry，请先升版号"
    fi
    ok "$CORE_NAME@$core_ver 可用"

    local remote_cli=$(npm view "$CLI_NAME@$cli_ver" version --registry "$REGISTRY" 2>/dev/null || echo "")
    if [ -n "$remote_cli" ]; then
        die "$CLI_NAME@$cli_ver 已存在于 registry，请先升版号"
    fi
    ok "$CLI_NAME@$cli_ver 可用"

    # 4. 构建 core
    info "构建 $CORE_NAME..."
    cd "$CORE_DIR"
    pnpm build > /dev/null 2>&1
    ok "core 构建成功"

    # 5. 构建 CLI
    info "构建 $CLI_NAME..."
    cd "$CLI_DIR"
    pnpm build > /dev/null 2>&1
    ok "CLI 构建成功"

    # 6. dry-run pack
    info "打包预览 (dry-run)..."
    echo ""

    echo -e "  ${CYAN}$CORE_NAME@$core_ver${NC}"
    cd "$CORE_DIR"
    local core_size=$(npm pack --dry-run 2>&1 | grep "package size" | sed 's/npm notice /  /')
    local core_files=$(npm pack --dry-run 2>&1 | grep "total files" | sed 's/npm notice /  /')
    echo -e "  $core_size"
    echo -e "  $core_files"
    echo ""

    echo -e "  ${CYAN}$CLI_NAME@$cli_ver${NC}"
    cd "$CLI_DIR"
    local cli_size=$(npm pack --dry-run 2>&1 | grep "package size" | sed 's/npm notice /  /')
    local cli_files=$(npm pack --dry-run 2>&1 | grep "total files" | sed 's/npm notice /  /')
    echo -e "  $cli_size"
    echo -e "  $cli_files"
    echo ""

    # 7. 模拟安装验证
    info "模拟全局安装..."

    # 打包
    cd "$CORE_DIR"
    local core_tgz=$(pnpm pack 2>/dev/null | tail -1)
    cd "$CLI_DIR"
    local cli_tgz=$(pnpm pack 2>/dev/null | tail -1)

    # 记录当前全局已安装的状态，用于恢复
    local had_core=false
    local had_cli=false
    npm list -g "$CORE_NAME" --depth=0 --registry "$REGISTRY" > /dev/null 2>&1 && had_core=true
    npm list -g "$CLI_NAME" --depth=0 --registry "$REGISTRY" > /dev/null 2>&1 && had_cli=true

    # 安装
    local install_ok=true
    npm install -g "$CORE_DIR/$core_tgz" "$CLI_DIR/$cli_tgz" > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        install_ok=false
        warn "npm install -g 失败"
    fi

    if $install_ok; then
        # 验证 free --version
        local version_output
        version_output=$(free --version 2>&1)
        local exit_code=$?

        if [ $exit_code -eq 0 ] && echo "$version_output" | grep -q "free version:"; then
            ok "模拟安装成功: $version_output"
        else
            warn "free --version 异常 (exit=$exit_code):"
            echo -e "${DIM}  $version_output${NC}"
            install_ok=false
        fi

        # 验证 free --help 能正常启动
        local help_output
        help_output=$(free --help 2>&1 &
            local pid=$!
            sleep 3
            kill $pid 2>/dev/null
            wait $pid 2>/dev/null
        )
        if echo "$help_output" | grep -q "free -"; then
            ok "free --help 正常"
        else
            warn "free --help 异常"
            install_ok=false
        fi
    fi

    # 清理：卸载测试安装
    info "清理测试安装..."
    npm uninstall -g "$CLI_NAME" "$CORE_NAME" > /dev/null 2>&1

    # 删除 tgz
    rm -f "$CORE_DIR/$core_tgz" "$CLI_DIR/$cli_tgz"

    ok "清理完成"
    echo ""

    if $install_ok; then
        ok "预检查全部通过"
    else
        die "模拟安装验证失败，请修复后重试"
    fi

    echo ""
    info "准备好后运行:"
    echo -e "  ${DIM}$0 publish${NC}"
    echo ""
}

# ─── publish ───────────────────────────────────────────────────────────────

cmd_publish() {
    local core_ver=$(get_version "$CORE_DIR")
    local cli_ver=$(get_version "$CLI_DIR")

    echo ""
    echo -e "${BOLD}发布 npm 包${NC}"
    echo ""
    echo -e "  $CORE_NAME  →  ${BOLD}$core_ver${NC}"
    echo -e "  $CLI_NAME   →  ${BOLD}$cli_ver${NC}"
    echo ""

    # 确认
    read -p "$(echo -e "${YELLOW}确认发布到 npmjs.org? [y/N]:${NC} ")" yn
    case "$yn" in [yY]|[yY][eE][sS]) ;; *) echo "已取消"; exit 0 ;; esac

    # 1. 构建
    info "构建 core..."
    cd "$CORE_DIR" && pnpm build
    ok "core 构建完成"

    info "构建 CLI..."
    cd "$CLI_DIR" && pnpm build
    ok "CLI 构建完成"

    # 2. 发布 core（必须先发，CLI 依赖它）
    echo ""
    info "发布 $CORE_NAME@$core_ver..."
    cd "$CORE_DIR"
    pnpm publish --access public --no-git-checks --registry "$REGISTRY"
    ok "$CORE_NAME@$core_ver 发布成功"

    # 3. 等待 registry 同步
    info "等待 registry 同步..."
    local retries=0
    while [ $retries -lt 30 ]; do
        if npm view "$CORE_NAME@$core_ver" version --registry "$REGISTRY" > /dev/null 2>&1; then
            break
        fi
        sleep 2
        retries=$((retries + 1))
    done
    if [ $retries -ge 30 ]; then
        warn "registry 同步超时，但包可能已发布成功，继续发布 CLI..."
    else
        ok "core 已在 registry 可用"
    fi

    # 4. 发布 CLI
    info "发布 $CLI_NAME@$cli_ver..."
    cd "$CLI_DIR"
    pnpm publish --access public --no-git-checks --registry "$REGISTRY"
    ok "$CLI_NAME@$cli_ver 发布成功"

    # 5. 验证
    echo ""
    echo -e "${GREEN}${BOLD}发布完成!${NC}"
    echo ""
    echo -e "  npm install -g $CLI_NAME@$cli_ver"
    echo ""
    echo -e "  ${DIM}https://www.npmjs.com/package/$CORE_NAME${NC}"
    echo -e "  ${DIM}https://www.npmjs.com/package/$CLI_NAME${NC}"
    echo ""
}

# ─── unpublish ─────────────────────────────────────────────────────────────

cmd_unpublish() {
    local core_ver=$(get_version "$CORE_DIR")
    local cli_ver=$(get_version "$CLI_DIR")

    echo ""
    echo -e "${RED}${BOLD}撤回 npm 包${NC}"
    echo ""
    echo -e "  $CLI_NAME@$cli_ver"
    echo -e "  $CORE_NAME@$core_ver"
    echo ""
    warn "撤回后 24 小时内无法重新发布相同版本号"
    echo ""

    read -p "$(echo -e "${RED}确认撤回? [y/N]:${NC} ")" yn
    case "$yn" in [yY]|[yY][eE][sS]) ;; *) echo "已取消"; exit 0 ;; esac

    # CLI 先撤（依赖 core）
    info "撤回 $CLI_NAME@$cli_ver..."
    npm unpublish "$CLI_NAME@$cli_ver" --registry "$REGISTRY" 2>/dev/null && ok "CLI 已撤回" || warn "CLI 撤回失败（可能未发布）"

    info "撤回 $CORE_NAME@$core_ver..."
    npm unpublish "$CORE_NAME@$core_ver" --registry "$REGISTRY" 2>/dev/null && ok "core 已撤回" || warn "core 撤回失败（可能未发布）"

    echo ""
}

# ─── help ──────────────────────────────────────────────────────────────────

cmd_help() {
    echo ""
    echo -e "${BOLD}用法:${NC}  ./scripts/npm-publish.sh [命令]"
    echo ""
    echo -e "  ${GREEN}(无参数)${NC}       查看当前版本和发布状态"
    echo -e "  ${GREEN}version${NC} <bump> 升版号 (patch / minor / major / x.y.z)"
    echo -e "  ${GREEN}check${NC}          预检查: 登录状态、构建、打包预览"
    echo -e "  ${GREEN}publish${NC}        正式发布到 npmjs.org"
    echo -e "  ${GREEN}unpublish${NC}      从 npmjs.org 撤回当前版本"
    echo ""
    echo -e "${DIM}典型流程:${NC}"
    echo -e "  ${DIM}1. ./scripts/npm-publish.sh version patch   # 升版${NC}"
    echo -e "  ${DIM}2. ./scripts/npm-publish.sh check           # 预检${NC}"
    echo -e "  ${DIM}3. ./scripts/npm-publish.sh publish         # 发布${NC}"
    echo ""
}

# ─── 入口 ──────────────────────────────────────────────────────────────────

case "${1:-}" in
    "")             cmd_status ;;
    version)        shift; cmd_version "$@" ;;
    check)          cmd_check ;;
    publish)        cmd_publish ;;
    unpublish)      cmd_unpublish ;;
    help|-h|--help) cmd_help ;;
    *)              die "未知命令: $1\n运行 $0 help 查看帮助" ;;
esac
