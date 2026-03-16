/**
 * OpenCodeSession — AgentSession subclass for the OpenCode agent.
 *
 * Mode = OpenCodeMode (permissionMode only, no model override).
 * Overrides default mode handling because OpenCodeMode has no model field.
 */

import type { UserMessage, PermissionMode } from '@/api/types';
import type { OpenCodeMode } from '@/opencode/types';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import { OpenCodeBackend } from '@/backends/opencode/OpenCodeBackend';

export class OpenCodeSession extends AgentSession<OpenCodeMode> {
  readonly agentType = 'opencode' as const;

  createBackend(): AgentBackend {
    return new OpenCodeBackend();
  }

  override createModeHasher(): (mode: OpenCodeMode) => string {
    return (mode: OpenCodeMode) => mode.permissionMode;
  }

  override defaultMode(): OpenCodeMode {
    return {
      permissionMode: this.opts.permissionMode ?? 'read-only',
    };
  }

  protected override extractMode(message: UserMessage): OpenCodeMode {
    return {
      permissionMode:
        (message.meta?.permissionMode as PermissionMode | undefined) ??
        this.opts.permissionMode ??
        'read-only',
    };
  }
}
