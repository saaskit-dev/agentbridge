/**
 * ClaudeAcpSession — AgentSession subclass for Claude with ACP backend.
 *
 * Mode = EnhancedMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { EnhancedMode } from '@/claude/sessionTypes';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { ClaudeAcpBackend } from '@/backends/claude-acp/ClaudeAcpBackend';

export class ClaudeAcpSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'claude-acp' as const;

  createBackend(): AgentBackend {
    return new ClaudeAcpBackend();
  }
}
