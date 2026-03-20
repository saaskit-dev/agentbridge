#!/usr/bin/env node
/**
 * MCP STDIO Bridge entry point
 *
 * Self-handling Node flags to suppress warnings (which could interfere with MCP STDIO)
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check if we're already running with the flags
const hasNoWarnings = process.execArgv.includes('--no-warnings');
const hasNoDeprecation = process.execArgv.includes('--no-deprecation');

if (!hasNoWarnings || !hasNoDeprecation) {
  // Re-exec with the correct flags
  try {
    execFileSync(
      process.execPath,
      [
        '--no-warnings',
        '--no-deprecation',
        join(dirname(fileURLToPath(import.meta.url)), 'mcp-bridge.mjs'),
        ...process.argv.slice(2),
      ],
      {
        stdio: 'inherit',
        env: process.env,
      }
    );
  } catch (error: any) {
    process.exit(error.status || 1);
  }
} else {
  // We're running with the flags, import the actual MCP bridge
  await import('./mcp/freeMcpStdioBridge.js');
}
