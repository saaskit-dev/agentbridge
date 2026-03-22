/**
 * Utility functions for Claude Code SDK integration
 * Provides helper functions for path resolution and logging
 *
 * NOTE: getCleanEnv() was removed - it previously filtered local node_modules/.bin from PATH
 * to avoid accidentally spawning a local claude instead of global. This was deemed unnecessary
 * because: (1) findGlobalClaudePath() uses cwd: homedir() to detect global claude,
 * and falls back to `which claude` for absolute path on Unix; (2) users typically
 * don't run `free` from inside a project with node_modules/.bin/claude.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('claude/sdk/utils');

/**
 * Get the directory path of the current module
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

/**
 * Get version of globally installed claude
 */
function getGlobalClaudeVersion(): string | null {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: homedir(),
    }).trim();
    // Output format: "2.0.54 (Claude Code)" or similar
    const match = output.match(/(\d+\.\d+\.\d+)/);
    logger.debug('[Claude SDK] Global claude --version output:', { output });
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Try to find globally installed Claude CLI
 * Returns 'claude' if the command works globally (preferred method for reliability)
 * Falls back to which/where to get actual path on Unix systems
 */
function findGlobalClaudePath(): string | null {
  const homeDir = homedir();

  // PRIMARY: Check if 'claude' command works directly from home dir
  try {
    execSync('claude --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: homeDir,
    });
    logger.debug('[Claude SDK] Global claude command available');
    return 'claude';
  } catch {
    // claude command not available globally
  }

  // FALLBACK for Unix: try which to get actual path
  if (process.platform !== 'win32') {
    try {
      const result = execSync('which claude', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: homeDir,
      }).trim();
      if (result && existsSync(result)) {
        logger.debug('[Claude SDK] Found global claude path via which:', { result });
        return result;
      }
    } catch {
      // which didn't find it
    }
  }

  return null;
}

/**
 * Get default path to Claude Code executable
 * Compares global and bundled versions, uses the newer one
 *
 * Environment variables:
 * - FREE_CLAUDE_PATH: Force a specific path to claude executable
 * - FREE_USE_BUNDLED_CLAUDE=1: Force use of node_modules version (skip global search)
 * - FREE_USE_GLOBAL_CLAUDE=1: Force use of global version (if available)
 */
export function getDefaultClaudeCodePath(): string {
  const nodeModulesPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'cli.js'
  );

  // Allow explicit override via env var
  if (process.env.FREE_CLAUDE_PATH) {
    logger.debug('[Claude SDK] Using FREE_CLAUDE_PATH:', { path: process.env.FREE_CLAUDE_PATH });
    return process.env.FREE_CLAUDE_PATH;
  }

  // Force bundled version if requested
  if (process.env.FREE_USE_BUNDLED_CLAUDE === '1') {
    logger.debug('[Claude SDK] Forced bundled version:', { path: nodeModulesPath });
    return nodeModulesPath;
  }

  // Find global claude
  const globalPath = findGlobalClaudePath();

  // No global claude found - use bundled
  if (!globalPath) {
    logger.debug('[Claude SDK] No global claude found, using bundled:', { path: nodeModulesPath });
    return nodeModulesPath;
  }

  // Compare versions and use the newer one
  const globalVersion = getGlobalClaudeVersion();

  logger.debug('[Claude SDK] Global version:', { version: globalVersion || 'unknown' });

  // If we can't determine versions, prefer global (user's choice to install it)
  if (!globalVersion) {
    logger.debug('[Claude SDK] Cannot compare versions, using global:', { path: globalPath });
    return globalPath;
  }

  return globalPath;
}

/**
 * Stream async messages to stdin
 */
export async function streamToStdin(
  stream: AsyncIterable<unknown>,
  stdin: NodeJS.WritableStream,
  abort?: AbortSignal
): Promise<void> {
  for await (const message of stream) {
    if (abort?.aborted) break;
    stdin.write(JSON.stringify(message) + '\n');
  }
  stdin.end();
}
