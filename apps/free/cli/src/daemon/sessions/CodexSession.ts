/**
 * CodexSession — AgentSession subclass for the Codex (OpenAI) agent.
 *
 * Mode = EnhancedMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { EnhancedMode } from '@/claude/sessionTypes';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { CodexBackend } from '@/backends/codex/CodexBackend';

export class CodexSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'codex' as const;

  createBackend(): AgentBackend {
    return new CodexBackend();
  }
}
