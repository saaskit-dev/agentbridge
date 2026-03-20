/**
 * Cursor Transport Handler
 *
 * Cursor agent uses standard ACP with no special quirks:
 * - No debug output on stdout (clean JSON-RPC)
 * - No special stderr error patterns
 * - No tool name extraction needed (Cursor sends proper tool names)
 * - Standard 60s init timeout is sufficient
 *
 * If Cursor-specific quirks emerge, override methods here.
 *
 * @module CursorTransport
 */

import { DefaultTransport } from '@saaskit-dev/agentbridge';
import type { StderrContext, StderrResult } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('agent/transport/handlers/CursorTransport');

/**
 * Cursor transport handler.
 *
 * Extends DefaultTransport. Cursor ACP is well-behaved and requires
 * no special handling — clean JSON-RPC over stdio with no stdout pollution.
 *
 * Overrides stderr to detect common auth errors.
 */
export class CursorTransport extends DefaultTransport {
  constructor() {
    super('cursor');
  }

  /**
   * Detect Cursor-specific stderr errors (auth failures).
   */
  override handleStderr(text: string, context: StderrContext): StderrResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { message: null, suppress: true };
    }

    // Auth error — user needs to run `cursor-agent login`
    if (
      trimmed.includes('Authentication required') ||
      trimmed.includes('not logged in') ||
      trimmed.includes('CURSOR_API_KEY')
    ) {
      logger.error('[Cursor] Authentication error detected', { stderr: trimmed });
      return {
        message: {
          type: 'status',
          status: 'error',
          detail: 'Cursor Agent 未登录。请先运行 `cursor-agent login` 或设置 CURSOR_API_KEY 环境变量。',
        },
      };
    }

    return { message: null };
  }
}

/** Singleton instance for reuse */
export const cursorTransport = new CursorTransport();
