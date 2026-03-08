#!/bin/bash
# ============================================================================
# E2E Message Lifecycle 测试脚本
#
#   ./run test lifecycle
#
# 流程：
#   1. 构建 Core + CLI（可选，--skip-build 跳过）
#   2. 启动 Server（端口 3000，FREE_HOME_DIR=~/.free-dev-test）
#   3. 启动 Daemon（同上环境）
#   4. 运行集成测试
#   5. 打印本次测试日志（彩色，按时间排序）
#   6. 停止 Daemon + Server
#
# 前置条件（只需做一次）：
#   free auth login
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ─── 颜色 ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ─── 配置 ─────────────────────────────────────────────────────────────────────
SERVER_PORT=3000
FREE_HOME_DIR_TEST="${HOME}/.free-dev"
FREE_SERVER_URL="http://localhost:${SERVER_PORT}"
CLI_DIR="$PROJECT_ROOT/apps/free/cli"
SERVER_DIR="$PROJECT_ROOT/apps/free/server"
LOG_DIR="$PROJECT_ROOT/.dev-logs"
ENV_FILE="$CLI_DIR/.env.integration-test"

# ─── 工具 ─────────────────────────────────────────────────────────────────────
die()  { echo -e "${RED}[E2E] ✗ $*${NC}" >&2; exit 1; }
info() { echo -e "${BLUE}[E2E]${NC} $*"; }
ok()   { echo -e "${GREEN}[E2E] ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}[E2E] ⚠ $*${NC}"; }
section() {
    echo ""
    echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
    echo -e "${CYAN}  $*${NC}"
    echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
}

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
SKIP_BUILD=false
KEEP_RUNNING=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build|-q) SKIP_BUILD=true; shift ;;
        --keep)          KEEP_RUNNING=true; shift ;;
        *) die "未知参数: $1 (可用: --skip-build, --keep)" ;;
    esac
done

mkdir -p "$LOG_DIR"

# ─── Cleanup on exit ──────────────────────────────────────────────────────────
CLEANUP_DONE=false
_started_server=false
_started_daemon=false

cleanup() {
    [[ "$CLEANUP_DONE" == "true" ]] && return
    CLEANUP_DONE=true

    echo ""
    section "清理测试环境"

    if [[ "$_started_daemon" == "true" ]]; then
        info "停止 Daemon..."
        FREE_HOME_DIR="$FREE_HOME_DIR_TEST" \
        FREE_SERVER_URL="$FREE_SERVER_URL" \
            free daemon stop 2>/dev/null || true
    fi

    if [[ "$_started_server" == "true" ]]; then
        info "停止 Server (端口 $SERVER_PORT)..."
        lsof -Pi :$SERVER_PORT -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
    fi

    ok "清理完毕"
}

trap cleanup EXIT INT TERM

# ─── 标题 ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   E2E Message Lifecycle Test                                 ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}FREE_HOME_DIR : $FREE_HOME_DIR_TEST${NC}"
echo -e "  ${DIM}Server URL    : $FREE_SERVER_URL${NC}"
echo -e "  ${DIM}Log dir       : $FREE_HOME_DIR_TEST/logs${NC}"
echo ""

# ─── 检查 credentials ────────────────────────────────────────────────────────
section "检查前置条件"

CREDS_FILE="$FREE_HOME_DIR_TEST/access.key"
if [[ ! -f "$CREDS_FILE" ]]; then
    echo ""
    warn "未找到测试环境认证信息: $CREDS_FILE"
    echo ""
    echo -e "  请先登录（只需一次）："
    echo -e "  ${BOLD}  free auth login${NC}"
    echo ""
    die "缺少认证信息，退出"
fi
ok "credentials 存在"

# ─── 检查 Server 是否已在运行 ────────────────────────────────────────────────
SERVER_ALREADY_UP=false
if curl -s "${FREE_SERVER_URL}/health" --max-time 1 > /dev/null 2>&1; then
    ok "Server 已在运行 (${FREE_SERVER_URL})"
    SERVER_ALREADY_UP=true
fi

# ─── 构建 ──────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "false" ]]; then
    section "构建 Core + CLI"

    info "构建 @agentbridge/core..."
    cd "$PROJECT_ROOT/packages/core"
    pnpm build > "$LOG_DIR/build-core.log" 2>&1
    ok "Core 构建完成"

    info "构建 CLI..."
    cd "$CLI_DIR"
    pnpm build > "$LOG_DIR/build-cli.log" 2>&1
    ok "CLI 构建完成"

    cd "$PROJECT_ROOT"
else
    info "跳过构建 (--skip-build)"
fi

# ─── 启动 Server ──────────────────────────────────────────────────────────────
if [[ "$SERVER_ALREADY_UP" == "false" ]]; then
    section "启动 Server"

    # 确保端口空闲
    if lsof -Pi :$SERVER_PORT -sTCP:LISTEN -t > /dev/null 2>&1; then
        warn "端口 $SERVER_PORT 被占用，先清理..."
        lsof -Pi :$SERVER_PORT -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
        sleep 1
    fi

    # 生成 Prisma client
    cd "$SERVER_DIR"
    pnpm db:generate > /dev/null 2>&1 || true

    info "启动 Server (端口 ${SERVER_PORT})..."
    FREE_HOME_DIR="$FREE_HOME_DIR_TEST" \
        pnpm --filter @free/server standalone serve \
        > "$LOG_DIR/e2e-server.log" 2>&1 &
    SERVER_PID=$!
    _started_server=true
    echo $SERVER_PID > "$LOG_DIR/e2e-server.pid"

    # 等待健康检查
    info "等待 Server 就绪..."
    for i in $(seq 1 30); do
        if curl -s "${FREE_SERVER_URL}/health" --max-time 1 > /dev/null 2>&1; then
            ok "Server 已就绪 (PID: ${SERVER_PID})"
            break
        fi
        if [[ $i -eq 30 ]]; then
            echo ""
            warn "Server 启动日志："
            tail -20 "$LOG_DIR/e2e-server.log" || true
            die "Server 启动超时（30s）"
        fi
        sleep 1
    done

    cd "$PROJECT_ROOT"
fi

# ─── 启动 Daemon ──────────────────────────────────────────────────────────────
section "启动 Daemon"

# 先停止可能残留的 daemon
FREE_HOME_DIR="$FREE_HOME_DIR_TEST" \
FREE_SERVER_URL="$FREE_SERVER_URL" \
    free daemon stop 2>/dev/null || true
sleep 1

info "启动 free daemon..."
FREE_HOME_DIR="$FREE_HOME_DIR_TEST" \
FREE_SERVER_URL="$FREE_SERVER_URL" \
    free daemon start > "$LOG_DIR/e2e-daemon-start.log" 2>&1 || true
_started_daemon=true

# 等待 daemon 就绪
info "等待 Daemon 就绪..."
for i in $(seq 1 20); do
    STATUS=$(FREE_HOME_DIR="$FREE_HOME_DIR_TEST" free daemon status 2>/dev/null || echo "")
    if echo "$STATUS" | grep -q "running"; then
        ok "Daemon 已就绪"
        break
    fi
    if [[ $i -eq 20 ]]; then
        warn "Daemon 状态输出："
        echo "$STATUS"
        die "Daemon 启动超时（20s）"
    fi
    sleep 1
done

# ─── 记录测试开始时间 ─────────────────────────────────────────────────────────
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
START_EPOCH_MS=$(node -e "console.log(Date.now())")

# ─── 运行测试 ─────────────────────────────────────────────────────────────────
section "运行集成测试"

echo -e "  ${DIM}开始时间: ${START_ISO}${NC}"
echo ""

cd "$CLI_DIR"
TEST_EXIT=0
TEST_STDOUT_FILE="$LOG_DIR/e2e-test-stdout.tmp"
dotenv -e "$ENV_FILE" -- npx vitest run src/api/messageLifecycle.integration.test.ts \
    2>&1 | tee "$TEST_STDOUT_FILE" || TEST_EXIT=$?

# 从测试输出里抓 SESSION_ID 和 traceId，用于过滤日志
TEST_SESSION_ID=$(grep -o 'SESSION_ID=[^ ]*' "$TEST_STDOUT_FILE" | head -1 | cut -d= -f2 || true)
TEST_TRACE_ID=$(grep -o 'traceId=[^ ]*' "$TEST_STDOUT_FILE" | head -1 | cut -d= -f2 || true)

cd "$PROJECT_ROOT"

# ─── 日志展示 ─────────────────────────────────────────────────────────────────
FILTER_DESC="本次测试日志 (>= ${START_ISO}"
[[ -n "$TEST_SESSION_ID" ]] && FILTER_DESC="$FILTER_DESC  session=${TEST_SESSION_ID}"
[[ -n "$TEST_TRACE_ID"   ]] && FILTER_DESC="$FILTER_DESC  trace=${TEST_TRACE_ID}"
FILTER_DESC="$FILTER_DESC)"
section "$FILTER_DESC"

LOGS_DIR="$FREE_HOME_DIR_TEST/logs"

node --input-type=module << NODE_SCRIPT
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const logsDir = '${LOGS_DIR}';
const startEpochMs = ${START_EPOCH_MS};
const filterSessionId = '${TEST_SESSION_ID}';
const filterTraceId = '${TEST_TRACE_ID}';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
};

const levelColor = l =>
  l === 'error' ? c.red : l === 'warn' ? c.yellow : l === 'info' ? c.cyan : c.gray;

const layerColor = l =>
  l === 'server' ? c.magenta : l === 'daemon' ? c.green : l === 'cli' ? c.blue : c.gray;

const pad = (s, n) => String(s ?? '').padEnd(n);

const fmtTs = iso => {
  const m = String(iso).match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
  return m ? m[1] : String(iso).slice(0, 23);
};

const fmtEntry = e => {
  const ts    = fmtTs(e.timestamp);
  const level = pad((e.level ?? 'debug').toUpperCase(), 5);
  const layer = pad(e.layer ?? '?', 7);
  const comp  = pad(e.component ?? '', 34);
  const msg   = e.message ?? '';
  const lc    = levelColor(e.level);
  const lyc   = layerColor(e.layer);

  let line =
    c.dim + '[' + ts + ']' + c.reset +
    ' ' + lyc + '[' + layer + ']' + c.reset +
    ' ' + lc + '[' + level + ']' + c.reset +
    ' ' + c.bold + comp + c.reset +
    c.dim + '| ' + c.reset + msg;

  if (e.data && typeof e.data === 'object') {
    const skip = new Set(['_value', 'stack']);
    const filtered = Object.fromEntries(
      Object.entries(e.data).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null)
    );
    if (Object.keys(filtered).length > 0) {
      const s = JSON.stringify(filtered);
      if (s.length <= 180) line += ' ' + c.dim + s + c.reset;
    }
  }
  return line;
};

if (!existsSync(logsDir)) {
  console.log('  (logs dir not found: ' + logsDir + ')');
  process.exit(0);
}

const files = readdirSync(logsDir)
  .filter(f => f.endsWith('.jsonl'))
  .map(f => ({ f, p: join(logsDir, f), mtime: statSync(join(logsDir, f)).mtimeMs }))
  .filter(({ mtime }) => mtime >= startEpochMs - 10_000)
  .sort((a, b) => a.mtime - b.mtime);

if (!files.length) {
  console.log('  (no log files found for this test run)');
  process.exit(0);
}

// 判断一条日志是否属于本次测试（按 sessionId 或 traceId 关联）
function matchesTest(e) {
  if (!filterSessionId && !filterTraceId) return true;
  const raw = JSON.stringify(e);
  if (filterSessionId && raw.includes(filterSessionId)) return true;
  if (filterTraceId   && raw.includes(filterTraceId))   return true;
  return false;
}

const allEntries = [];
let totalSkipped = 0;
for (const { p } of files) {
  try {
    for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        const t = e.timestamp ? new Date(e.timestamp).getTime() : 0;
        if (t < startEpochMs) continue;
        if (matchesTest(e)) { allEntries.push(e); } else { totalSkipped++; }
      } catch {}
    }
  } catch {}
}

allEntries.sort((a, b) =>
  (a.timestamp ? new Date(a.timestamp).getTime() : 0) -
  (b.timestamp ? new Date(b.timestamp).getTime() : 0)
);

if (!allEntries.length) {
  console.log('  (no entries found after ' + new Date(startEpochMs).toISOString() + ')');
  process.exit(0);
}

const skipNote = totalSkipped > 0 ? '  (' + totalSkipped + ' daemon noise entries filtered out)' : '';
console.log('  ' + allEntries.length + ' entries from ' + files.length + ' file(s).' + (skipNote ? '\n' + skipNote : '') + '\n');
for (const e of allEntries) console.log(fmtEntry(e));
NODE_SCRIPT

# ─── 结果 ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
echo ""

if [[ $TEST_EXIT -eq 0 ]]; then
    echo -e "${BOLD}${GREEN}  ✅ 测试通过${NC}"
else
    echo -e "${BOLD}${RED}  ❌ 测试失败 (exit $TEST_EXIT)${NC}"
    echo -e "  ${DIM}Server 日志: $LOG_DIR/e2e-server.log${NC}"
fi
echo ""

# cleanup 会在 EXIT trap 里自动执行
exit $TEST_EXIT
