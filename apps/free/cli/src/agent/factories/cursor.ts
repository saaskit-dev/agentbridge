/**
 * Cursor ACP Backend Factory
 *
 * Creates a Cursor agent backend that communicates using the
 * Agent Client Protocol (ACP) via `cursor-agent acp`.
 *
 * Prerequisites:
 * - cursor-agent CLI installed (via `cursor agent` or https://cursor.com/install)
 * - Authentication: `cursor-agent login` or CURSOR_API_KEY env var
 *
 * Cursor agent specifics:
 * - Handles file I/O and terminal execution internally (no client-side FS/terminal)
 * - Only uses requestPermission for tool approval
 * - Supports 26+ models (GPT-5.x, Claude 4.x, Gemini 3.x, Grok, Kimi)
 * - Three modes: agent, plan, ask
 * - MCP servers via HTTP and SSE
 */

import {
  createAcpBackend,
  type AcpPermissionHandler,
  type CreateAcpBackendOptions,
} from '@saaskit-dev/agentbridge';
import type { AgentBackend, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { cursorTransport } from '../transport';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('agent/factories/cursor');

const CURSOR_AGENT_COMMAND = 'cursor-agent';

/**
 * Options for creating a Cursor ACP backend
 */
export interface CursorBackendOptions {
  /** Working directory for the agent */
  cwd: string;
  /** Environment variables to pass to the agent */
  env?: Record<string, string>;
  /** MCP servers to make available to the agent */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;
}

/**
 * Create a Cursor backend using ACP.
 *
 * Uses `cursor-agent acp` to launch the Cursor agent in ACP mode.
 * Requires prior authentication via `cursor-agent login` or CURSOR_API_KEY.
 */
export function createCursorBackend(options: CursorBackendOptions): AgentBackend {
  const backendOptions: CreateAcpBackendOptions = {
    agentName: 'cursor',
    cwd: options.cwd,
    command: CURSOR_AGENT_COMMAND,
    args: ['acp'],
    env: {
      ...options.env,
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: cursorTransport,
  };

  logger.debug('[Cursor] Creating ACP backend', {
    cwd: backendOptions.cwd,
    command: backendOptions.command,
    args: backendOptions.args,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return createAcpBackend(backendOptions);
}

/**
 * Register Cursor backend with the global agent registry.
 */
export function registerCursorAgent(): void {
  agentRegistry.register('cursor', opts => createCursorBackend(opts));
  logger.debug('[Cursor] Registered with agent registry');
}
