#!/usr/bin/env python3
"""
RFC-001 Telemetry Migration Script
Migrates cli/src from @/ui/logger and server/src from @/utils/log
to direct @agentbridge/core/telemetry usage.
"""
import re
import os
import sys

ROOT = "/Users/dev/agentbridge"
CLI_SRC = os.path.join(ROOT, "apps/free/cli/src")
SERVER_SRC = os.path.join(ROOT, "apps/free/server/src")


# ─── CLI Migration ───────────────────────────────────────────────────────────

def migrate_cli_file(path: str, content: str) -> str:
    """
    CLI files: import { createLogger } from '@/ui/logger' + const logger = createLogger('x')
    → import { Logger } from '@agentbridge/core/telemetry' + const logger = new Logger('x')
    Method names (debug/info/warn/error) stay identical.
    Special methods handled separately per-file.
    """
    # Replace import line variants
    content = re.sub(
        r"import \{ createLogger \} from '@/ui/logger'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ createLogger, type Logger \} from '@/ui/logger'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ type Logger, createLogger \} from '@/ui/logger'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ Logger, createLogger \} from '@/ui/logger'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ createLogger, Logger \} from '@/ui/logger'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    # Replace import of just Logger type
    content = re.sub(
        r"import type \{ Logger \} from '@/ui/logger'",
        "import type { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ type Logger \} from '@/ui/logger'",
        "import type { Logger } from '@agentbridge/core/telemetry'",
        content,
    )

    # Replace constructor: createLogger( → new Logger(
    content = re.sub(r"\bcreateLogger\(", "new Logger(", content)

    return content


# ─── Server Migration ─────────────────────────────────────────────────────────

def migrate_server_log_call(m: re.Match) -> str:
    """
    Convert single-line log({ ... level: 'X' ... }, 'msg') → log.X('msg')
    or log({ ... }, 'msg') → log.info('msg')
    or log('msg') → log.info('msg')
    """
    prefix = m.group(1)   # indentation
    obj_or_str = m.group(2).strip()
    # Check if it's already a string (simple call)
    if obj_or_str.startswith("'") or obj_or_str.startswith("`") or obj_or_str.startswith('"'):
        # log('msg') → log.info('msg')
        return f"{prefix}log.info({obj_or_str}"
    # Object-first: extract level
    level_m = re.search(r"level:\s*'(\w+)'", obj_or_str)
    level = level_m.group(1) if level_m else "info"
    if level not in ("debug", "info", "warn", "error"):
        level = "info"
    return f"{prefix}log.{level}("


def convert_server_log_calls(content: str) -> str:
    """
    Handle single-line log() calls with inline objects.
    Pattern: log({ ... level: 'xxx' ... }, 'message')
    → log.xxx('message')
    """
    # Single-line: log({ module: 'x', level: 'error' }, `msg`)
    content = re.sub(
        r"(\s+)log\(\s*\{\s*module:\s*'[^']*',\s*level:\s*'error'[^}]*\},\s*",
        r"\1log.error(",
        content,
    )
    content = re.sub(
        r"(\s+)log\(\s*\{\s*module:\s*'[^']*',\s*level:\s*'debug'[^}]*\},\s*",
        r"\1log.debug(",
        content,
    )
    content = re.sub(
        r"(\s+)log\(\s*\{\s*module:\s*'[^']*',\s*level:\s*'warn'[^}]*\},\s*",
        r"\1log.warn(",
        content,
    )
    # log({ module: 'x' }, 'msg') with no level → info
    content = re.sub(
        r"(\s+)log\(\s*\{\s*module:\s*'[^']*'\s*\},\s*",
        r"\1log.info(",
        content,
    )
    # Simple string calls: log('msg') → log.info('msg')
    # Be careful: only match when log is directly called with a string literal or template
    content = re.sub(
        r"(\s+)log\((`[^`]*`)\)",
        r"\1log.info(\2)",
        content,
    )
    content = re.sub(
        r"(\s+)log\(('[^']*')\)",
        r"\1log.info(\2)",
        content,
    )
    return content


def migrate_server_file(path: str, content: str) -> str:
    """
    Server files: various import patterns → import { Logger } from '@agentbridge/core/telemetry'
    const { log } = createLogger('x') → const log = new Logger('x')
    """
    basename = os.path.basename(path)

    # Replace createLogger imports
    content = re.sub(
        r"import \{ createLogger \} from '@/utils/log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ shutdownServerTelemetry, createLogger \} from '@/utils/log'",
        "import { Logger, getCollector, isCollectorReady } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ createLogger, shutdownServerTelemetry \} from '@/utils/log'",
        "import { Logger, getCollector, isCollectorReady } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ logger, createLogger \} from '@/utils/log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ createLogger, logger \} from '@/utils/log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ log \} from '\./log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ warn \} from '\./log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ log, warn \} from '\./log'",
        "import { Logger } from '@agentbridge/core/telemetry'",
        content,
    )
    content = re.sub(
        r"import \{ ComponentLogger \} from '@/utils/log'",
        "",
        content,
    )

    # Replace: const { log } = createLogger('x') → const log = new Logger('x')
    content = re.sub(
        r"const \{ log \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )
    content = re.sub(
        r"const \{ log, warn, error, debug \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )
    content = re.sub(
        r"const \{ log, warn, error \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )
    content = re.sub(
        r"const \{ log, warn \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )
    content = re.sub(
        r"const \{ log, debug \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )
    content = re.sub(
        r"const \{ warn \} = createLogger\(([^)]+)\)",
        r"const log = new Logger(\1)",
        content,
    )

    # Convert single-line object-first log calls
    content = convert_server_log_calls(content)

    # For delay.ts and backoff.ts: replace warn('msg') → log.warn('msg')
    if basename in ("delay.ts", "backoff.ts"):
        content = re.sub(r"\bwarn\(", "log.warn(", content)
        # Add logger instantiation after imports if not already present
        if "const log = new Logger" not in content:
            component = "utils/delay" if basename == "delay.ts" else "utils/backoff"
            content = re.sub(
                r"(import { Logger } from '@agentbridge/core/telemetry')\n",
                f"\\1\nconst log = new Logger('{component}');\n",
                content,
            )

    # For shutdown.ts: replace log('msg') → log.info('msg')
    if basename == "shutdown.ts":
        content = re.sub(r"\blog\('([^']+)'\)", r"log.info('\1')", content)
        content = re.sub(r'\blog\(`([^`]+)`\)', r'log.info(`\1`)', content)
        # Add logger instantiation if not already present
        if "const log = new Logger" not in content:
            content = re.sub(
                r"(import { Logger } from '@agentbridge/core/telemetry')\n",
                "\\1\nconst log = new Logger('utils/shutdown');\n",
                content,
            )

    # For api.ts: remove unused logger import reference (pino shim handled separately)
    if basename == "api.ts":
        content = content.replace("loggerInstance: logger,", "loggerInstance: createFastifyLogger(),")

    return content


def process_files(src_dir: str, skip_paths: list, migrator):
    """Process all .ts files in src_dir, skipping specified paths."""
    changed = 0
    for root, dirs, files in os.walk(src_dir):
        # Skip node_modules etc.
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".cache", "dist")]
        for fname in files:
            if not fname.endswith(".ts"):
                continue
            fpath = os.path.join(root, fname)
            # Skip if in skip list
            if any(fpath.endswith(skip) for skip in skip_paths):
                continue
            with open(fpath, "r", encoding="utf-8") as f:
                original = f.read()
            migrated = migrator(fpath, original)
            if migrated != original:
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(migrated)
                rel = os.path.relpath(fpath, ROOT)
                print(f"  ✓ {rel}")
                changed += 1
    return changed


def main():
    print("=== Phase 1: CLI Migration ===")
    skip_cli = [
        "apps/free/cli/src/ui/logger.ts",  # the shim itself
        "apps/free/cli/src/daemon/daemon.integration.test.ts",  # already migrated
    ]
    n = process_files(CLI_SRC, skip_cli, migrate_cli_file)
    print(f"  → {n} CLI files updated\n")

    print("=== Phase 2: Server Migration ===")
    skip_server = [
        "apps/free/server/src/utils/log.ts",  # the shim itself
    ]
    n = process_files(SERVER_SRC, skip_server, migrate_server_file)
    print(f"  → {n} server files updated\n")

    print("Done. Run `npx tsc --noEmit` to check for remaining issues.")


if __name__ == "__main__":
    main()
