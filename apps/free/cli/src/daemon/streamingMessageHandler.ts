/**
 * Streaming Message Handler
 *
 * Handles streaming text (typewriter effect) for agent messages.
 * Accumulates text deltas, throttles them, and sends to server.
 *
 * @module daemon/streamingMessageHandler
 */

import { EventEmitter } from 'node:events';
import { serverCapabilities } from '@/api/serverCapabilities';
import { Logger, type WireTrace } from '@saaskit-dev/agentbridge/telemetry';
import { getProcessTraceContext } from '@/telemetry';
const logger = new Logger('daemon/streamingMessageHandler');

/**
 * Streaming message state
 */
interface StreamingMessageState {
  /** Message ID being streamed */
  messageId: string;
  /** Session ID */
  sessionId: string;
  /** Accumulated text */
  accumulatedText: string;
  /** Last send timestamp */
  lastSentAt: number;
  /** Flush timeout handle */
  flushTimeout: NodeJS.Timeout | null;
  /** Trace context captured at stream start, propagated with every ephemeral event */
  trace: WireTrace | undefined;
  /** Stream start time (ms) for summary log (RFC §17.10) */
  startTime: number;
  /** Number of individual text_delta events flushed (RFC §17.10) */
  deltaCount: number;
  /** Total characters streamed (RFC §17.10) */
  totalChars: number;
}

/**
 * Options for StreamingMessageHandler
 */
export interface StreamingMessageHandlerOptions {
  /** Throttle interval in ms (default: 50ms) */
  throttleMs?: number;
  /** Maximum batch size before forcing flush (default: 100 chars) */
  maxBatchSize?: number;
  /** Callback to send ephemeral event to server */
  sendEphemeral: (event: StreamingEphemeralEvent) => void;
}

/**
 * Streaming ephemeral event types.
 * Each variant carries an optional _trace for end-to-end trace correlation (RFC §11.5).
 */
export type StreamingEphemeralEvent =
  | { type: 'text_delta'; sessionId: string; messageId: string; delta: string; timestamp: number; _trace?: WireTrace }
  | {
      type: 'text_complete';
      sessionId: string;
      messageId: string;
      fullText: string;
      timestamp: number;
      _trace?: WireTrace;
    }
  | {
      type: 'thinking_delta';
      sessionId: string;
      messageId: string;
      delta: string;
      timestamp: number;
      _trace?: WireTrace;
    };

/**
 * Streaming Message Handler
 *
 * Handles the streaming of text deltas for typewriter effect.
 *
 * Features:
 * - Throttling: Limits sends to every `throttleMs` milliseconds
 * - Batching: Accumulates small deltas into larger batches
 * - Adaptive: Falls back to non-streaming mode if server doesn't support it
 */
export class StreamingMessageHandler extends EventEmitter {
  private readonly throttleMs: number;
  private readonly maxBatchSize: number;
  private readonly sendEphemeral: (event: StreamingEphemeralEvent) => void;

  /** Current streaming state by session ID */
  private readonly streamingStates = new Map<string, StreamingMessageState>();

  /** Whether streaming is enabled (based on server capabilities) */
  private streamingEnabled = false;

  constructor(options: StreamingMessageHandlerOptions) {
    super();
    this.throttleMs = options.throttleMs ?? 50;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.sendEphemeral = options.sendEphemeral;
  }

  /**
   * Initialize the handler
   * Detects server capabilities and enables streaming if supported.
   */
  async init(): Promise<void> {
    await serverCapabilities.detect();
    this.streamingEnabled = serverCapabilities.supportsTextDelta();

    if (this.streamingEnabled) {
      logger.debug('[StreamingMessageHandler] Streaming enabled - typewriter effect active');
    } else {
      logger.debug(
        '[StreamingMessageHandler] Streaming disabled - server does not support textDelta'
      );
    }
  }

  /**
   * Check if streaming is enabled
   */
  isStreamingEnabled(): boolean {
    return this.streamingEnabled;
  }

  /**
   * Start streaming a new message
   */
  startStreaming(sessionId: string, messageId: string): void {
    if (!this.streamingEnabled) {
      return;
    }

    // Clear any existing state for this session
    this.endStreaming(sessionId);

    // Capture current turn's trace context at stream start (RFC §11.5)
    const ctx = getProcessTraceContext();
    const trace: WireTrace | undefined = ctx
      ? { tid: ctx.traceId, ses: ctx.sessionId, mid: ctx.machineId }
      : undefined;

    this.streamingStates.set(sessionId, {
      messageId,
      sessionId,
      accumulatedText: '',
      lastSentAt: 0,
      flushTimeout: null,
      trace,
      startTime: Date.now(),
      deltaCount: 0,
      totalChars: 0,
    });

    logger.debug(
      `[StreamingMessageHandler] Started streaming message ${messageId} for session ${sessionId}`
    );
  }

  /**
   * Handle a text delta
   * Accumulates and throttles before sending.
   */
  onTextDelta(sessionId: string, delta: string): void {
    if (!this.streamingEnabled) {
      return;
    }

    const state = this.streamingStates.get(sessionId);
    if (!state) {
      // No active streaming for this session - ignore
      return;
    }

    // Accumulate delta
    state.accumulatedText += delta;

    // Check if we should flush
    const now = Date.now();
    const timeSinceLastSend = now - state.lastSentAt;

    if (state.accumulatedText.length >= this.maxBatchSize || timeSinceLastSend >= this.throttleMs) {
      // Flush immediately
      this.flush(sessionId);
    } else {
      // Schedule flush
      if (!state.flushTimeout) {
        const timeUntilFlush = this.throttleMs - timeSinceLastSend;
        state.flushTimeout = setTimeout(() => {
          this.flush(sessionId);
        }, timeUntilFlush);
      }
    }
  }

  /**
   * Handle a thinking delta
   */
  onThinkingDelta(sessionId: string, delta: string): void {
    if (!this.streamingEnabled || !serverCapabilities.supportsThinkingDelta()) {
      return;
    }

    const state = this.streamingStates.get(sessionId);
    if (!state) {
      return;
    }

    // Send thinking delta immediately (no throttling for thinking)
    this.sendEphemeral({
      type: 'thinking_delta',
      sessionId,
      messageId: state.messageId,
      delta,
      timestamp: Date.now(),
      _trace: state.trace,
    });
  }

  /**
   * End streaming for a session
   * Sends any remaining text and the text_complete event.
   */
  endStreaming(sessionId: string, fullText?: string): void {
    const state = this.streamingStates.get(sessionId);
    if (!state) {
      return;
    }

    // Clear timeout
    if (state.flushTimeout) {
      clearTimeout(state.flushTimeout);
    }

    // Flush any remaining text
    if (state.accumulatedText.length > 0) {
      state.deltaCount += 1;
      state.totalChars += state.accumulatedText.length;
      this.sendEphemeral({
        type: 'text_delta',
        sessionId,
        messageId: state.messageId,
        delta: state.accumulatedText,
        timestamp: Date.now(),
        _trace: state.trace,
      });
      state.accumulatedText = '';
    }

    // Send text_complete
    this.sendEphemeral({
      type: 'text_complete',
      sessionId,
      messageId: state.messageId,
      fullText: fullText ?? '',
      timestamp: Date.now(),
      _trace: state.trace,
    });

    // RFC §17.10: info-level summary so it appears in production (minLevel: 'info') logs
    const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
    logger.info(
      `Streaming completed: ${state.deltaCount} deltas, ${state.totalChars} chars, ${elapsed}s`,
      { sessionId, messageId: state.messageId }
    );

    // Remove state
    this.streamingStates.delete(sessionId);
  }

  /**
   * Flush accumulated text for a session
   */
  private flush(sessionId: string): void {
    const state = this.streamingStates.get(sessionId);
    if (!state || state.accumulatedText.length === 0) {
      return;
    }

    // Track stats for RFC §17.10 summary log
    state.deltaCount += 1;
    state.totalChars += state.accumulatedText.length;

    const deltaLen = state.accumulatedText.length;

    // Send delta
    this.sendEphemeral({
      type: 'text_delta',
      sessionId,
      messageId: state.messageId,
      delta: state.accumulatedText,
      timestamp: Date.now(),
      _trace: state.trace,
    });

    logger.debug('[streaming] delta sent', {
      sessionId,
      messageId: state.messageId,
      length: deltaLen,
      traceId: state.trace?.tid,
    });

    // Reset state
    state.accumulatedText = '';
    state.lastSentAt = Date.now();
    state.flushTimeout = null;
  }

  /**
   * Get current streaming state for debugging
   */
  getDebugState(): { sessionId: string; messageId: string; accumulatedLength: number }[] {
    return Array.from(this.streamingStates.values()).map(state => ({
      sessionId: state.sessionId,
      messageId: state.messageId,
      accumulatedLength: state.accumulatedText.length,
    }));
  }
}
