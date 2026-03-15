/**
 * CodexAcpSession — AgentSession subclass for Codex with ACP backend.
 *
 * Mode = EnhancedMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { EnhancedMode } from '@/claude/sessionTypes';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { CodexAcpBackend } from '@/backends/codex-acp/CodexAcpBackend';

export class CodexAcpSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'codex-acp' as const;

  createBackend(): AgentBackend {
    return new CodexAcpBackend();
  }
}
