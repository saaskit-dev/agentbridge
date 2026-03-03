import type { AgentMessage } from '../../interfaces/agent';
import type { ITransportHandler } from '../../interfaces/transport';

export const DEFAULT_IDLE_TIMEOUT_MS = 500;
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000;

/** 3 minutes in milliseconds - Gemini CLI internal timeout */
const THREE_MINUTES_MS = 180_000;
/** Tolerance for timeout detection (5 seconds) */
const TIMEOUT_TOLERANCE_MS = 5_000;

export interface SessionUpdate {
  sessionUpdate?: string;
  toolCallId?: string;
  status?: string;
  kind?: string | unknown;
  content?:
    | {
        text?: string;
        error?: string | { message?: string };
        [key: string]: unknown;
      }
    | string
    | unknown;
  locations?: unknown[];
  messageChunk?: { textDelta?: string };
  plan?: unknown;
  thinking?: unknown;
  [key: string]: unknown;
}

export interface HandlerContext {
  transport: ITransportHandler;
  activeToolCalls: Set<string>;
  toolCallStartTimes: Map<string, number>;
  toolCallTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  toolCallIdToNameMap: Map<string, string>;
  idleTimeout: ReturnType<typeof setTimeout> | null;
  toolCallCountSincePrompt: number;
  emit: (msg: AgentMessage) => void;
  emitIdleStatus: () => void;
  clearIdleTimeout: () => void;
  setIdleTimeout: (callback: () => void, ms: number) => void;
}

export interface HandlerResult {
  handled: boolean;
  toolCallCountSincePrompt?: number;
}

// ============================================================================
// Helper Functions (exported for external use)
// ============================================================================

/**
 * Format duration in seconds
 */
export function formatDuration(startTime: number | undefined): string {
  if (!startTime) return 'unknown';
  return `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
}

/**
 * Format duration in minutes
 */
export function formatDurationMinutes(startTime: number | undefined): string {
  if (!startTime) return 'unknown';
  return `${((Date.now() - startTime) / 60000).toFixed(2)}min`;
}

/**
 * Parse arguments from content
 */
export function parseArgsFromContent(content: unknown): Record<string, unknown> {
  if (Array.isArray(content)) return { items: content };
  if (content && typeof content === 'object' && content !== null) {
    return content as Record<string, unknown>;
  }
  return {};
}

/**
 * Extract error detail from content
 */
export function extractErrorDetail(content: unknown): string | undefined {
  if (!content) return undefined;
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if (obj.error) {
      const error = obj.error;
      if (typeof error === 'string') return error;
      if (error && typeof error === 'object' && 'message' in error) {
        const errObj = error as { message?: unknown };
        if (typeof errObj.message === 'string') return errObj.message;
      }
      return JSON.stringify(error);
    }
    if (typeof obj.message === 'string') return obj.message;
    const status = typeof obj.status === 'string' ? obj.status : undefined;
    const reason = typeof obj.reason === 'string' ? obj.reason : undefined;
    return status || reason || JSON.stringify(obj).substring(0, 500);
  }
  return undefined;
}

// ============================================================================
// Session Update Handlers
// ============================================================================

export function handleAgentMessageChunk(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  const content = update.content;
  if (!content || typeof content !== 'object' || !('text' in content)) {
    return { handled: false };
  }
  const text = (content as { text?: string }).text;
  if (typeof text !== 'string') return { handled: false };

  const isThinking = /^\*\*[^*]+\*\*\n/.test(text);
  if (isThinking) {
    ctx.emit({ type: 'event', name: 'thinking', payload: { text } });
  } else {
    ctx.emit({ type: 'model-output', textDelta: text });
    ctx.clearIdleTimeout();
    const idleTimeoutMs = ctx.transport.getIdleTimeout?.() ?? DEFAULT_IDLE_TIMEOUT_MS;
    ctx.setIdleTimeout(() => {
      if (ctx.activeToolCalls.size === 0) ctx.emitIdleStatus();
    }, idleTimeoutMs);
  }
  return { handled: true };
}

export function handleAgentThoughtChunk(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  const content = update.content;
  if (!content || typeof content !== 'object' || !('text' in content)) {
    return { handled: false };
  }
  const text = (content as { text?: string }).text;
  if (typeof text !== 'string') return { handled: false };
  ctx.emit({ type: 'event', name: 'thinking', payload: { text } });
  return { handled: true };
}

/**
 * Start a tool call - exported for external use
 */
export function startToolCall(
  toolCallId: string,
  toolKind: string | unknown,
  update: SessionUpdate,
  ctx: HandlerContext
): void {
  const startTime = Date.now();
  const toolKindStr = typeof toolKind === 'string' ? toolKind : undefined;

  // Note: isInvestigationTool is called by getToolCallTimeout below to determine timeout

  const extractedName = ctx.transport.extractToolNameFromId?.(toolCallId);
  const realToolName = extractedName ?? (toolKindStr || 'unknown');
  ctx.toolCallIdToNameMap.set(toolCallId, realToolName);
  ctx.activeToolCalls.add(toolCallId);
  ctx.toolCallStartTimes.set(toolCallId, startTime);

  const timeoutMs =
    ctx.transport.getToolCallTimeout?.(toolCallId, toolKindStr) ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  if (!ctx.toolCallTimeouts.has(toolCallId)) {
    const timeout = setTimeout(() => {
      ctx.activeToolCalls.delete(toolCallId);
      ctx.toolCallStartTimes.delete(toolCallId);
      ctx.toolCallTimeouts.delete(toolCallId);
      if (ctx.activeToolCalls.size === 0) ctx.emitIdleStatus();
    }, timeoutMs);
    ctx.toolCallTimeouts.set(toolCallId, timeout);
  }

  ctx.clearIdleTimeout();
  ctx.emit({ type: 'status', status: 'running' });
  const args = parseArgsFromContent(update.content);
  if (update.locations && Array.isArray(update.locations)) args.locations = update.locations;

  // Use realToolName instead of toolKindStr for better identification
  ctx.emit({ type: 'tool-call', toolName: realToolName, args, callId: toolCallId });
}

/**
 * Complete a tool call - exported for external use
 */
export function completeToolCall(
  toolCallId: string,
  toolKind: string | unknown,
  content: unknown,
  ctx: HandlerContext
): void {
  const toolKindStr = typeof toolKind === 'string' ? toolKind : 'unknown';

  ctx.activeToolCalls.delete(toolCallId);
  ctx.toolCallStartTimes.delete(toolCallId);

  const timeout = ctx.toolCallTimeouts.get(toolCallId);
  if (timeout) {
    clearTimeout(timeout);
    ctx.toolCallTimeouts.delete(toolCallId);
  }

  // Get the real tool name from the map
  const realToolName = ctx.toolCallIdToNameMap.get(toolCallId) ?? toolKindStr;
  ctx.emit({ type: 'tool-result', toolName: realToolName, result: content, callId: toolCallId });

  if (ctx.activeToolCalls.size === 0) {
    ctx.clearIdleTimeout();
    ctx.emitIdleStatus();
  }
}

/**
 * Fail a tool call - exported for external use
 */
export function failToolCall(
  toolCallId: string,
  status: 'failed' | 'cancelled',
  toolKind: string | unknown,
  content: unknown,
  ctx: HandlerContext
): void {
  const toolKindStr = typeof toolKind === 'string' ? toolKind : 'unknown';
  const startTime = ctx.toolCallStartTimes.get(toolCallId);

  // Check if this was an investigation tool
  const isInvestigation = ctx.transport.isInvestigationTool?.(toolCallId, toolKindStr) ?? false;

  // For investigation tools, detect 3-minute timeout pattern (Gemini CLI internal timeout)
  if (isInvestigation && startTime) {
    const duration = Date.now() - startTime;
    if (Math.abs(duration - THREE_MINUTES_MS) < TIMEOUT_TOLERANCE_MS) {
      // This is likely a Gemini CLI internal timeout at ~3 minutes
      // We don't emit this as it's handled internally
    }
  }

  ctx.activeToolCalls.delete(toolCallId);
  ctx.toolCallStartTimes.delete(toolCallId);

  const timeout = ctx.toolCallTimeouts.get(toolCallId);
  if (timeout) {
    clearTimeout(timeout);
    ctx.toolCallTimeouts.delete(toolCallId);
  }

  const errorDetail = extractErrorDetail(content);

  // Get the real tool name from the map
  const realToolName = ctx.toolCallIdToNameMap.get(toolCallId) ?? toolKindStr;

  ctx.emit({
    type: 'tool-result',
    toolName: realToolName,
    result: errorDetail ? { error: errorDetail, status } : { error: `Tool call ${status}`, status },
    callId: toolCallId,
  });

  if (ctx.activeToolCalls.size === 0) {
    ctx.clearIdleTimeout();
    ctx.emitIdleStatus();
  }
}

export function handleToolCallUpdate(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  const status = update.status;
  const toolCallId = update.toolCallId;
  if (!toolCallId) return { handled: false };

  const toolKind = update.kind || 'unknown';
  let toolCallCountSincePrompt = ctx.toolCallCountSincePrompt;

  if (status === 'in_progress' || status === 'pending') {
    if (!ctx.activeToolCalls.has(toolCallId)) {
      toolCallCountSincePrompt++;
      startToolCall(toolCallId, toolKind, update, ctx);
    }
  } else if (status === 'completed') {
    completeToolCall(toolCallId, toolKind, update.content, ctx);
  } else if (status === 'failed' || status === 'cancelled') {
    failToolCall(toolCallId, status, toolKind, update.content, ctx);
  }
  return { handled: true, toolCallCountSincePrompt };
}

export function handleToolCall(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  const toolCallId = update.toolCallId;
  const status = update.status;
  const isInProgress = !status || status === 'in_progress' || status === 'pending';
  if (!toolCallId || !isInProgress) return { handled: false };
  if (ctx.activeToolCalls.has(toolCallId)) return { handled: true };
  startToolCall(toolCallId, update.kind, update, ctx);
  return { handled: true };
}

export function handleLegacyMessageChunk(
  update: SessionUpdate,
  ctx: HandlerContext
): HandlerResult {
  if (!update.messageChunk) return { handled: false };
  const chunk = update.messageChunk;
  if (chunk.textDelta) {
    ctx.emit({ type: 'model-output', textDelta: chunk.textDelta });
    return { handled: true };
  }
  return { handled: false };
}

export function handlePlanUpdate(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  if (!update.plan) return { handled: false };
  ctx.emit({ type: 'event', name: 'plan', payload: update.plan });
  return { handled: true };
}

export function handleThinkingUpdate(update: SessionUpdate, ctx: HandlerContext): HandlerResult {
  if (!update.thinking) return { handled: false };
  ctx.emit({ type: 'event', name: 'thinking', payload: update.thinking });
  return { handled: true };
}
