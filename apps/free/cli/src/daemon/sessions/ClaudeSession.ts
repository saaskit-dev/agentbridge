/**
 * ClaudeSession — AgentSession subclass for Claude with ACP backend.
 *
 * Mode = EnhancedMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { EnhancedMode } from '@/claude/sessionTypes';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { ClaudeBackend } from '@/backends/claude/ClaudeBackend';

export class ClaudeSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'claude' as const;

  createBackend(): AgentBackend {
    return new ClaudeBackend();
  }
}
