/**
 * TransportHandler interface
 *
 * ACP (Agent Client Protocol) specific abstraction layer
 * for handling different agent behaviors.
 */

import type { AgentMessage } from './agent';

/** Tool name pattern for extraction from toolCallId */
export interface ToolPattern {
  /** Canonical tool name */
  name: string;
  /** Patterns to match in toolCallId (case-insensitive) */
  patterns: string[];
}

/** Context passed to stderr handler */
export interface StderrContext {
  /** Currently active tool calls */
  activeToolCalls: Set<string>;
  /** Whether any active tool is an investigation tool */
  hasActiveInvestigation: boolean;
}

/** Context for tool name detection heuristics */
export interface ToolNameContext {
  /** Whether the recent prompt contained change_title instruction */
  recentPromptHadChangeTitle: boolean;
  /** Number of tool calls since last prompt */
  toolCallCountSincePrompt: number;
}

/** Result of stderr processing */
export interface StderrResult {
  /** Message to emit (null = don't emit anything) */
  message: AgentMessage | null;
  /** Whether to suppress this stderr line from logs */
  suppress?: boolean;
}

/**
 * Transport handler interface for ACP backends.
 *
 * Different agents have different behaviors for:
 * - Initialization timeouts (Gemini: 120s, Codex: 30s, Claude: 10s)
 * - Output filtering (debug output removal)
 * - Error handling (rate limits, auth failures)
 * - Tool name extraction (from toolCallId patterns)
 */
export interface ITransportHandler {
  /** Agent identifier for logging */
  readonly agentName: string;

  /**
   * Get initialization timeout in milliseconds.
   * - Gemini CLI: 120s (slow on first start, downloads models)
   * - Codex: ~30s
   * - Claude: ~10s
   */
  getInitTimeout(): number;

  /**
   * Get idle detection timeout in milliseconds.
   * After no chunks arrive for this duration, emits 'idle' status.
   * Default: 500ms
   */
  getIdleTimeout?(): number;

  /**
   * Get timeout for a specific tool call.
   * Investigation tools need longer timeouts (10+ minutes).
   */
  getToolCallTimeout?(toolCallId: string, toolKind?: string): number;

  /**
   * Filter a line from stdout before ACP parsing.
   * Return null to drop the line, or the (possibly modified) line to keep it.
   */
  filterStdoutLine?(line: string): string | null;

  /**
   * Handle stderr output from the agent process.
   * Used to detect errors (rate limits, auth failures, etc.)
   */
  handleStderr?(text: string, context: StderrContext): StderrResult;

  /**
   * Get tool name patterns for this agent.
   * Used to extract real tool names from toolCallId.
   */
  getToolPatterns(): ToolPattern[];

  /**
   * Check if a tool is an "investigation" tool that needs longer timeout.
   */
  isInvestigationTool?(toolCallId: string, toolKind?: string): boolean;

  /**
   * Extract tool name from toolCallId.
   * Tool IDs often contain the tool name as a prefix.
   */
  extractToolNameFromId?(toolCallId: string): string | null;

  /**
   * Determine the real tool name from various sources.
   * When the agent sends "other" or "Unknown tool", tries to determine the real name.
   */
  determineToolName?(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ToolNameContext
  ): string;
}

/** Transport handler factory type */
export type TransportHandlerFactory = () => ITransportHandler;

// Factory registry
const transportHandlers = new Map<string, TransportHandlerFactory>();

/** Register a transport handler factory */
export function registerTransportHandler(agentName: string, factory: TransportHandlerFactory): void {
  transportHandlers.set(agentName, factory);
}

/** Create a transport handler instance */
export function createTransportHandler(agentName: string): ITransportHandler {
  const factory = transportHandlers.get(agentName);
  if (!factory) {
    throw new Error(`Transport handler not found: ${agentName}. Available: ${[...transportHandlers.keys()].join(', ')}`);
  }
  return factory();
}

/** Check if a transport handler exists */
export function hasTransportHandler(agentName: string): boolean {
  return transportHandlers.has(agentName);
}
