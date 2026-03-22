/**
 * AgentSessionFactory
 *
 * Registry-based factory for AgentSession subclasses.
 * Supports open-ended agent types: new agents register at daemon startup
 * without modifying this file.
 *
 * Usage in daemon/run.ts:
 *   AgentSessionFactory.register('claude', ClaudeSession);
 *   AgentSessionFactory.register('codex', CodexSession);
 *   ...
 *   const session = AgentSessionFactory.create('claude', opts);
 */

import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { AgentSession } from './AgentSession';
import type { AgentSessionOpts } from './AgentSession';
import type { AgentType } from './types';

const logger = new Logger('daemon/sessions/AgentSessionFactory');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentSessionConstructor = new (opts: AgentSessionOpts) => AgentSession<any>;

const registry = new Map<AgentType, AgentSessionConstructor>();

export const AgentSessionFactory = {
  register(agentType: AgentType, cls: AgentSessionConstructor): void {
    logger.debug('[AgentSessionFactory] registering agent type', { agentType });
    registry.set(agentType, cls);
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(agentType: AgentType, opts: AgentSessionOpts): AgentSession<any> {
    const Cls = registry.get(agentType);
    if (!Cls) {
      logger.error(
        '[AgentSessionFactory] unknown agent type',
        new Error(`Unknown agentType: "${agentType}"`),
        { agentType }
      );
      throw new Error(`Unknown agentType: "${agentType}". Did you forget to register it?`);
    }
    logger.debug('[AgentSessionFactory] creating session', {
      agentType,
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      model: opts.model,
      mode: opts.mode,
      startingMode: opts.startingMode,
    });
    return new Cls(opts);
  },

  isRegistered(agentType: AgentType): boolean {
    return registry.has(agentType);
  },

  listRegistered(): AgentType[] {
    return Array.from(registry.keys());
  },
};
