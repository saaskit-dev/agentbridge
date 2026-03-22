/**
 * Agent Backend Factories
 *
 * Factory functions for creating agent backends with proper configuration.
 * Each factory includes the appropriate transport handler for the agent.
 */

import type { IAgentBackend } from '../../interfaces/agent';
import { registerAgentFactory } from '../../interfaces/agent';
import type { ITransportHandler } from '../../interfaces/transport';
import type { McpServerConfig, AcpAgentConfig, AcpPermissionHandler } from '../../types/agent';
import {
  GeminiTransport,
  CodexTransport,
  ClaudeAcpTransport,
  DefaultTransport,
} from '../transport/default';

const CODEX_ACP_VERSION = '0.9.5';

function getCodexAcpPlatformPackage(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') {
    return '@zed-industries/codex-acp-darwin-arm64';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return '@zed-industries/codex-acp-darwin-x64';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return '@zed-industries/codex-acp-linux-arm64';
  }
  if (platform === 'linux' && arch === 'x64') {
    return '@zed-industries/codex-acp-linux-x64';
  }
  if (platform === 'win32' && arch === 'arm64') {
    return '@zed-industries/codex-acp-win32-arm64';
  }
  if (platform === 'win32' && arch === 'x64') {
    return '@zed-industries/codex-acp-win32-x64';
  }

  return null;
}

function getCodexAcpCommandArgs(): string[] {
  const mainPackage = `@zed-industries/codex-acp@${CODEX_ACP_VERSION}`;
  const platformPackage = getCodexAcpPlatformPackage();

  if (!platformPackage) {
    return ['-y', mainPackage, 'codex-acp'];
  }

  return ['-y', '-p', mainPackage, '-p', `${platformPackage}@${CODEX_ACP_VERSION}`, 'codex-acp'];
}

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
 * import { createGeminiBackend } from '@saaskit-dev/agentbridge';
 * const backend = createGeminiBackend({ cwd: '/path/to/project' });
 *
 * // Over this:
 * import { createAcpBackend } from '@saaskit-dev/agentbridge';
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
 * Uses the official Zed ACP adapter for Codex.
 */
export function createCodexBackend(options: CodexBackendOptions): IAgentBackend {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'codex',
    transport: 'acp',
    command: 'npx',
    // Work around upstream Zed release/install issues by explicitly installing
    // both the launcher package and the current platform binary package.
    args: getCodexAcpCommandArgs(),
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
// Claude Backend Factory (ACP)
// ============================================================================

/**
 * Options for creating a Claude backend (ACP)
 */
export interface ClaudeBackendOptions {
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
 * Uses the official Zed ACP adapter for Claude Agent SDK.
 */
export function createClaudeBackend(options: ClaudeBackendOptions): IAgentBackend {
  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'claude',
    transport: 'acp',
    command: 'npx',
    args: ['-y', '@zed-industries/claude-agent-acp'],
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
registerAgentFactory('gemini', config =>
  createGeminiBackend({
    cwd: config.cwd,
    env: config.env,
    mcpServers: config.mcpServers,
  })
);

registerAgentFactory('codex', config =>
  createCodexBackend({
    cwd: config.cwd,
    env: config.env,
    mcpServers: config.mcpServers,
  })
);

registerAgentFactory('claude', config =>
  createClaudeBackend({
    cwd: config.cwd,
    env: config.env,
    mcpServers: config.mcpServers,
  })
);

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

// Import transports
import { OpenCodeTransport, CursorTransport } from '../transport/default';
import { AcpBackend } from './acp';

// Register OpenCode factory
registerAgentFactory('opencode', config =>
  createOpenCodeBackend({
    cwd: config.cwd,
    env: config.env,
    mcpServers: config.mcpServers,
  })
);

// ============================================================================
// Cursor Backend Factory
// ============================================================================

/**
 * Options for creating a Cursor backend
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
 *
 * Cursor agent specifics:
 * - Handles file I/O and terminal execution internally
 * - Only uses requestPermission for tool approval
 * - Supports 26+ models (GPT-5.x, Claude 4.x, Gemini 3.x, Grok, Kimi)
 * - Three modes: agent, plan, ask
 */
export function createCursorBackend(options: CursorBackendOptions): IAgentBackend {
  const config: AcpAgentConfig = {
    cwd: options.cwd,
    agentName: 'cursor',
    transport: 'acp',
    command: 'cursor-agent',
    args: ['acp'],
    env: options.env,
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: new CursorTransport(),
  };

  return new AcpBackend(config);
}

// Register Cursor factory
registerAgentFactory('cursor', config =>
  createCursorBackend({
    cwd: config.cwd,
    env: config.env,
    mcpServers: config.mcpServers,
  })
);
