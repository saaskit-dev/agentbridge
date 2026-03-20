/**
 * CursorSession — AgentSession subclass for the Cursor agent.
 *
 * Mode = EnhancedMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { EnhancedMode } from '@/claude/sessionTypes';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { CursorBackend } from '@/backends/cursor/CursorBackend';

export class CursorSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'cursor' as const;

  createBackend(): AgentBackend {
    return new CursorBackend();
  }
}
