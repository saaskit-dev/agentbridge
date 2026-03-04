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
import { logger } from '@/ui/logger';

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
 * Streaming ephemeral event types
 */
export type StreamingEphemeralEvent =
  | { type: 'text_delta'; sessionId: string; messageId: string; delta: string; timestamp: number }
  | {
      type: 'text_complete';
      sessionId: string;
      messageId: string;
      fullText: string;
      timestamp: number;
    }
  | {
      type: 'thinking_delta';
      sessionId: string;
      messageId: string;
      delta: string;
      timestamp: number;
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

    this.streamingStates.set(sessionId, {
      messageId,
      sessionId,
      accumulatedText: '',
      lastSentAt: 0,
      flushTimeout: null,
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
      this.sendEphemeral({
        type: 'text_delta',
        sessionId,
        messageId: state.messageId,
        delta: state.accumulatedText,
        timestamp: Date.now(),
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
    });

    // Remove state
    this.streamingStates.delete(sessionId);

    logger.debug(`[StreamingMessageHandler] Ended streaming for session ${sessionId}`);
  }

  /**
   * Flush accumulated text for a session
   */
  private flush(sessionId: string): void {
    const state = this.streamingStates.get(sessionId);
    if (!state || state.accumulatedText.length === 0) {
      return;
    }

    // Send delta
    this.sendEphemeral({
      type: 'text_delta',
      sessionId,
      messageId: state.messageId,
      delta: state.accumulatedText,
      timestamp: Date.now(),
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
