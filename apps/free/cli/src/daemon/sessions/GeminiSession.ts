/**
 * GeminiSession — AgentSession subclass for the Gemini agent.
 *
 * Mode = GeminiMode (permissionMode + optional model override).
 * Uses AgentSession default mode handling.
 */

import type { GeminiMode } from '@/gemini/types';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { GeminiBackend } from '@/backends/gemini/GeminiBackend';

export class GeminiSession extends AgentSession<GeminiMode> {
  readonly agentType = 'gemini' as const;

  createBackend(): AgentBackend {
    return new GeminiBackend();
  }
}
