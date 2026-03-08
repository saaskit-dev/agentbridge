#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# E2E Message Lifecycle Integration Test — runner + log collector
#
# Usage (from apps/free/cli/):
#   pnpm run test:e2e-lifecycle
#   bash scripts/e2e-lifecycle-test.sh
#
# Prerequisites:
#   1. free auth login        (with FREE_HOME_DIR=~/.free-dev-test)
#   2. Server running at $FREE_SERVER_URL
#   3. free daemon start      (with FREE_HOME_DIR=~/.free-dev-test)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$CLI_DIR/.env.integration-test"

# ── ANSI colours ──────────────────────────────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
MAGENTA="\033[35m"
BLUE="\033[34m"
WHITE="\033[37m"

# ── Check env file ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "${RED}❌ 找不到 $ENV_FILE${RESET}"
  exit 1
fi

# ── Parse env file (expand ~ → $HOME) ────────────────────────────────────────
FREE_HOME_DIR_RAW=$(grep '^FREE_HOME_DIR=' "$ENV_FILE" | cut -d= -f2-)
FREE_HOME_DIR="${FREE_HOME_DIR_RAW/\~/$HOME}"
FREE_SERVER_URL=$(grep '^FREE_SERVER_URL=' "$ENV_FILE" | cut -d= -f2- || echo "http://localhost:3000")
LOGS_DIR="$FREE_HOME_DIR/logs"

# ── Header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   E2E Message Lifecycle Integration Test                 ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${DIM}FREE_HOME_DIR  :${RESET} $FREE_HOME_DIR"
echo -e "  ${DIM}FREE_SERVER_URL:${RESET} $FREE_SERVER_URL"
echo -e "  ${DIM}Logs dir       :${RESET} $LOGS_DIR"
echo ""

# ── Record start time (ISO8601, used to filter logs after the test) ───────────
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
START_EPOCH_MS=$(node -e "console.log(Date.now())")

echo -e "  ${DIM}Test started at: $START_ISO${RESET}"
echo ""
echo -e "${DIM}────────────────────────────────────────────────────────────${RESET}"
echo ""

# ── Run the test ───────────────────────────────────────────────────────────────
cd "$CLI_DIR"

# Use dotenv CLI if available, else fall back to exporting vars manually
if command -v dotenv &>/dev/null; then
  dotenv -e "$ENV_FILE" -- npx vitest run src/api/messageLifecycle.integration.test.ts
else
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ENV_FILE" | grep -v '^$')
  # Expand ~ in FREE_HOME_DIR for the child process
  export FREE_HOME_DIR="$FREE_HOME_DIR"
  set +a
  npx vitest run src/api/messageLifecycle.integration.test.ts
fi

TEST_EXIT=$?

# ── Log collection ─────────────────────────────────────────────────────────────
echo ""
echo -e "${DIM}────────────────────────────────────────────────────────────${RESET}"
echo ""
echo -e "${BOLD}${CYAN}📋 本次测试日志（>= $START_ISO）${RESET}"
echo ""

# Inline Node.js script to collect, sort and pretty-print JSONL logs
node --input-type=module << NODE_SCRIPT
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const logsDir = '${LOGS_DIR}';
const startEpochMs = ${START_EPOCH_MS};

// ANSI colour helpers
const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

function levelColor(level) {
  switch (level) {
    case 'error': return c.red;
    case 'warn':  return c.yellow;
    case 'info':  return c.cyan;
    default:      return c.gray;    // debug / unknown
  }
}

function layerColor(layer) {
  switch (layer) {
    case 'server':  return c.magenta;
    case 'daemon':  return c.green;
    case 'cli':     return c.blue;
    default:        return c.gray;
  }
}

function padEnd(s, n) {
  return String(s).padEnd(n);
}

function formatTs(iso) {
  // "2026-03-08T10:23:45.123Z" → "10:23:45.123"
  const m = iso.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
  return m ? m[1] : iso;
}

function formatEntry(e) {
  const ts    = formatTs(e.timestamp || '');
  const level = padEnd((e.level || 'debug').toUpperCase(), 5);
  const layer = padEnd(e.layer || 'unknown', 7);
  const comp  = padEnd(e.component || '', 36);
  const msg   = e.message || '';
  const lc    = levelColor(e.level);
  const lyc   = layerColor(e.layer);

  let line =
    c.dim + '[' + ts + ']' + c.reset + ' ' +
    lyc   + '[' + layer + ']' + c.reset + ' ' +
    lc    + '[' + level + ']' + c.reset + ' ' +
    c.bold + comp + c.reset + c.dim + '| ' + c.reset +
    msg;

  // Append non-trivial data inline (compact, skip _value noise)
  if (e.data && typeof e.data === 'object') {
    const skip = new Set(['_value']);
    const filtered = Object.fromEntries(
      Object.entries(e.data).filter(([k, v]) => !skip.has(k) && v !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      const serialized = JSON.stringify(filtered);
      // Only show if not too long
      if (serialized.length <= 200) {
        line += ' ' + c.dim + serialized + c.reset;
      }
    }
  }

  return line;
}

// Collect all log entries from JSONL files modified at or after start time
if (!existsSync(logsDir)) {
  console.log(\`  (logs dir not found: \${logsDir})\`);
  process.exit(0);
}

const files = readdirSync(logsDir)
  .filter(f => f.endsWith('.jsonl'))
  .map(f => ({ f, p: join(logsDir, f), mtime: statSync(join(logsDir, f)).mtimeMs }))
  // Only files touched around or after the test started (with 10s buffer for clock skew)
  .filter(({ mtime }) => mtime >= startEpochMs - 10_000)
  .sort((a, b) => a.mtime - b.mtime);

if (files.length === 0) {
  console.log('  (no log files found for this test run)');
  process.exit(0);
}

const allEntries = [];
for (const { p } of files) {
  try {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        if (ts >= startEpochMs) {
          allEntries.push(entry);
        }
      } catch {}
    }
  } catch {}
}

// Sort by timestamp ascending
allEntries.sort((a, b) => {
  const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  return ta - tb;
});

if (allEntries.length === 0) {
  console.log('  (no log entries found after ' + new Date(startEpochMs).toISOString() + ')');
  process.exit(0);
}

console.log('  ' + allEntries.length + ' entries from ' + files.length + ' log file(s):\n');

for (const entry of allEntries) {
  console.log(formatEntry(entry));
}
NODE_SCRIPT

echo ""
echo -e "${DIM}────────────────────────────────────────────────────────────${RESET}"
echo ""

if [[ $TEST_EXIT -eq 0 ]]; then
  echo -e "${BOLD}${GREEN}✅ 测试通过${RESET}"
else
  echo -e "${BOLD}${RED}❌ 测试失败 (exit $TEST_EXIT)${RESET}"
fi

echo ""
exit $TEST_EXIT
