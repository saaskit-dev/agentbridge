/**
 * useStreamingText Hook
 *
 * Handles streaming text (typewriter effect) for agent messages.
 * Listens for text_delta and text_complete ephemeral events and
 * accumulates text in real-time for display.
 *
 * @module hooks/useStreamingText
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ApiEphemeralTextDelta,
  ApiEphemeralTextComplete,
  ApiEphemeralUpdate,
} from '@/sync/apiTypes';
import { sync } from '@/sync/sync';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { applyTextDelta, applyTextComplete, STREAMING_INITIAL_STATE } from './streamingTextReducer';
export {
  applyTextDelta,
  applyTextComplete,
  STREAMING_INITIAL_STATE,
  type StreamingTextState,
} from './streamingTextReducer';
import type { StreamingTextState } from './streamingTextReducer';
const logger = new Logger('app/hooks/useStreamingText');

/**
 * Options for useStreamingText hook
 */
export interface UseStreamingTextOptions {
  /** Session ID to filter events for */
  sessionId: string;
  /** Message ID to filter events for */
  messageId?: string | null;
  /** Callback when text delta is received */
  onTextDelta?: (messageId: string, delta: string) => void;
  /** Callback when text streaming completes */
  onTextComplete?: (messageId: string, fullText: string) => void;
}

/**
 * Hook return type
 */
export interface UseStreamingTextReturn {
  /** Current streaming state */
  state: StreamingTextState;
  /** Reset streaming state */
  reset: () => void;
  /** Manually append text (for testing) */
  appendText: (text: string) => void;
}

/**
 * Hook for handling streaming text (typewriter effect)
 *
 * @example
 * ```tsx
 * const { state, reset } = useStreamingText({
 *   sessionId: session.id,
 *   onTextComplete: (messageId, fullText) => {
 *     logger.debug('Streaming complete:', messageId, fullText);
 *   },
 * });
 *
 * // Display streaming text
 * <Text>{state.pendingText || state.finalText}</Text>
 * ```
 */
export function useStreamingText(options: UseStreamingTextOptions): UseStreamingTextReturn {
  const { sessionId, messageId, onTextDelta, onTextComplete } = options;

  // isMounted guard to prevent setState after unmount
  const isMountedRef = useRef(true);

  const [state, setState] = useState<StreamingTextState>(STREAMING_INITIAL_STATE);
  const lastLoggedMessageIdRef = useRef<string | null>(null);

  // Use refs for callbacks to avoid re-subscribing
  const onTextDeltaRef = useRef(onTextDelta);
  const onTextCompleteRef = useRef(onTextComplete);

  useEffect(() => {
    onTextDeltaRef.current = onTextDelta;
    onTextCompleteRef.current = onTextComplete;
  }, [onTextDelta, onTextComplete]);

  // Handle ephemeral updates
  useEffect(() => {
    isMountedRef.current = true;

    const handleEphemeral = (update: ApiEphemeralUpdate) => {
      if (!isMountedRef.current) return;

      // Streaming text can continue across reducer-level message merges and
      // chunk coalescing. Subscribing by session keeps the active row updating
      // even when the underlying chunk ids do not match a single UI message id.
      if ('sessionId' in update && update.sessionId !== sessionId) {
        return;
      }

      switch (update.type) {
        case 'text_delta': {
          const delta = update as ApiEphemeralTextDelta;
          setState(prev => applyTextDelta(prev, delta));
          if (!messageId || delta.messageId === messageId) {
            logger.debug('[stream] text delta received', {
              sessionId,
              messageId: delta.messageId,
              observerMessageId: messageId ?? null,
              deltaLength: delta.delta.length,
            });
            lastLoggedMessageIdRef.current = delta.messageId;
          }
          onTextDeltaRef.current?.(delta.messageId, delta.delta);
          break;
        }

        case 'text_complete': {
          const complete = update as ApiEphemeralTextComplete;
          setState(() => applyTextComplete(complete));
          if (!messageId || complete.messageId === messageId) {
            logger.debug('[stream] text complete received', {
              sessionId,
              messageId: complete.messageId,
              observerMessageId: messageId ?? null,
              fullTextLength: complete.fullText.length,
            });
            lastLoggedMessageIdRef.current = complete.messageId;
          }
          if (isMountedRef.current) {
            onTextCompleteRef.current?.(complete.messageId, complete.fullText);
          }
          break;
        }

        case 'thinking_delta': {
          // Thinking deltas are handled separately if needed
          // For now, we don't accumulate thinking text in the main stream
          break;
        }
      }
    };

    // Subscribe to ephemeral updates
    const unsubscribe = sync.onEphemeralUpdate?.(handleEphemeral as (update: unknown) => void, {
      sessionId,
    });

    return () => {
      if (lastLoggedMessageIdRef.current) {
        logger.debug('[stream] observer unmounted', {
          sessionId,
          observerMessageId: messageId ?? null,
          lastObservedMessageId: lastLoggedMessageIdRef.current,
        });
      }
      isMountedRef.current = false;
      unsubscribe?.();
    };
  }, [messageId, sessionId]);

  // Reset streaming state
  const reset = useCallback(() => {
    setState(STREAMING_INITIAL_STATE);
  }, []);

  // Manually append text (for testing or manual control)
  const appendText = useCallback((text: string) => {
    setState(prev => ({
      ...prev,
      pendingText: prev.pendingText + text,
    }));
  }, []);

  return { state, reset, appendText };
}

/**
 * Simplified hook for just getting the streaming text
 *
 * @example
 * ```tsx
 * const streamingText = useStreamingTextForSession(session.id);
 * <Text>{streamingText}</Text>
 * ```
 */
export function useStreamingTextForSession(sessionId: string): string {
  const { state } = useStreamingText({ sessionId });

  // Return final text if complete, otherwise pending text
  if (state.isComplete && state.finalText) {
    return state.finalText;
  }

  return state.pendingText;
}

/**
 * Hook to check if streaming is active for a session
 */
export function useIsStreaming(sessionId: string): boolean {
  const { state } = useStreamingText({ sessionId });
  return state.isStreaming;
}
