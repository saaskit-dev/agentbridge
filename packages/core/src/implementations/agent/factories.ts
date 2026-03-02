/**
 * Agent Backend Factories
 *
 * Factory functions for creating agent backends with proper configuration.
 * Each factory includes the appropriate transport handler for the agent.
 */

import type { IAgentBackend } from '../../interfaces/agent';
import { registerAgentFactory } from '../../interfaces/agent';
import type { McpServerConfig, AcpAgentConfig, AcpPermissionHandler } from '../../types/agent';
import type { ITransportHandler } from '../../interfaces/transport';
import { AcpBackend } from './acp';
import { GeminiTransport, CodexTransport, ClaudeAcpTransport, DefaultTransport } from '../transport/default';

// ============================================================================
// Generic ACP Backend Factory
// ============================================================================

/**
 * Simplified options for creating an ACP backend
 */
export interface CreateAcpBackendOptions {
  /** Agent name for identification */
  agentName: string;

  /** Working directory for the agent */
  cwd: string;

  /** Command to spawn the ACP agent */
  command: string;

  /** Arguments for the agent command */
  args?: string[];

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** MCP servers to make available to the agent */
  mcpServers?: Record<string, McpServerConfig>;

  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;

  /** Optional transport handler for agent-specific behavior */
  transportHandler?: ITransportHandler;

  /** Optional callback to check if prompt has change_title instruction */
  hasChangeTitleInstruction?: (prompt: string) => boolean;
}

/**
 * Create a generic ACP backend.
 *
 * This is a low-level factory for creating ACP backends. For most use cases,
 * prefer the agent-specific factories that include proper transport handlers:
 *
 * ```typescript
 * // Prefer this:
 * import { createGeminiBackend } from '@agentbridge/core';
 * const backend = createGeminiBackend({ cwd: '/path/to/project' });
 *
 * // Over this:
 * import { createAcpBackend } from '@agentbridge/core';
 * const backend = createAcpBackend({
 *   agentName: 'gemini',
 *   cwd: '/path/to/project',
 *   command: 'gemini',
 *   args: ['--experimental-acp'],
 * });
 * ```
 *
 * @param options - Configuration options
 * @returns IAgentBackend instance
 */
export function createAcpBackend(options: CreateAcpBackendOptions): IAgentBackend {
  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: options.agentName as AcpAgentConfig['agentName'],
    transport: 'acp',
    command: options.command,
    args: options.args,
    env: options.env,
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: options.transportHandler ?? new DefaultTransport(options.agentName),
    hasChangeTitleInstruction: options.hasChangeTitleInstruction,
  };

  return new AcpBackend(config);
}

// ============================================================================
// Gemini Backend Factory
// ============================================================================

/**
 * Options for creating a Gemini backend
 */
export interface GeminiBackendOptions {
  /** Working directory for the agent */
  cwd: string;
  /** Environment variables to pass to the agent */
  env?: Record<string, string>;
  /** API key for Gemini (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;
  /** Model to use (defaults to GEMINI_MODEL env var or 'gemini-2.5-pro') */
  model?: string;
  /** MCP servers to make available to the agent */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;
}

/**
 * Create a Gemini backend using ACP.
 *
 * The Gemini CLI must be installed and available in PATH.
 * Uses the --experimental-acp flag to enable ACP mode.
 */
export function createGeminiBackend(options: GeminiBackendOptions): IAgentBackend {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-pro';

  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'gemini',
    transport: 'acp',
    command: 'gemini',
    args: ['--experimental-acp'],
    env: {
      ...options.env,
      ...(apiKey ? { GEMINI_API_KEY: apiKey, GOOGLE_API_KEY: apiKey } : {}),
      GEMINI_MODEL: model,
      NODE_ENV: 'production',
      DEBUG: '',
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: new GeminiTransport(),
  };

  return new AcpBackend(config);
}

// ============================================================================
// Codex Backend Factory
// ============================================================================

/**
 * Options for creating a Codex backend
 */
export interface CodexBackendOptions {
  /** Working directory for the agent */
  cwd: string;
  /** Environment variables to pass to the agent */
  env?: Record<string, string>;
  /** API key for OpenAI (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** MCP servers to make available to the agent */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;
}

/**
 * Create a Codex backend using ACP.
 *
 * The Codex CLI must be installed and available in PATH.
 */
export function createCodexBackend(options: CodexBackendOptions): IAgentBackend {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'codex-acp',
    transport: 'acp',
    command: 'codex',
    args: ['--experimental-acp'],
    env: {
      ...options.env,
      ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: new CodexTransport(),
  };

  return new AcpBackend(config);
}

// ============================================================================
// Claude ACP Backend Factory
// ============================================================================

/**
 * Options for creating a Claude ACP backend
 */
export interface ClaudeAcpBackendOptions {
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
 * Create a Claude backend using ACP.
 *
 * The Claude CLI must be installed and available in PATH.
 */
export function createClaudeAcpBackend(options: ClaudeAcpBackendOptions): IAgentBackend {
  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'claude-acp',
    transport: 'acp',
    command: 'claude',
    args: ['--experimental-acp'],
    env: options.env,
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: new ClaudeAcpTransport(),
  };

  return new AcpBackend(config);
}

// ============================================================================
// Factory Registration
// ============================================================================

// Register factories with agent registry
registerAgentFactory('gemini', (config) => createGeminiBackend({
  cwd: config.cwd,
  env: config.env,
  mcpServers: config.mcpServers,
}));

registerAgentFactory('codex-acp', (config) => createCodexBackend({
  cwd: config.cwd,
  env: config.env,
  mcpServers: config.mcpServers,
}));

registerAgentFactory('claude-acp', (config) => createClaudeAcpBackend({
  cwd: config.cwd,
  env: config.env,
  mcpServers: config.mcpServers,
}));

// ============================================================================
// OpenCode Backend Factory
// ============================================================================

/**
 * Options for creating an OpenCode backend
 */
export interface OpenCodeBackendOptions {
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
 * Create an OpenCode backend using ACP.
 *
 * OpenCode is an open source AI coding agent that supports ACP.
 * The OpenCode CLI must be installed and available in PATH.
 *
 * Features:
 * - 75+ LLM providers through Models.dev
 * - GitHub Copilot integration
 * - ChatGPT Plus/Pro integration
 * - Local models support
 *
 * @see https://opencode.ai/
 */
export function createOpenCodeBackend(options: OpenCodeBackendOptions): IAgentBackend {
  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'opencode',
    transport: 'acp',
    command: 'opencode',
    args: ['acp'],
    env: {
      ...options.env,
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: new OpenCodeTransport(),
  };

  return new AcpBackend(config);
}

// Import OpenCodeTransport
import { OpenCodeTransport } from '../transport/default';

// Register OpenCode factory
registerAgentFactory('opencode', (config) => createOpenCodeBackend({
  cwd: config.cwd,
  env: config.env,
  mcpServers: config.mcpServers,
}));
