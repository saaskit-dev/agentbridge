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
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('app/hooks/useStreamingText');

/**
 * Streaming text state for a message
 */
export interface StreamingTextState {
  /** Message ID being streamed */
  messageId: string | null;
  /** Accumulated text from deltas */
  pendingText: string;
  /** Whether streaming is in progress */
  isStreaming: boolean;
  /** Whether streaming has completed */
  isComplete: boolean;
  /** Final text after completion */
  finalText: string | null;
}

/**
 * Options for useStreamingText hook
 */
export interface UseStreamingTextOptions {
  /** Session ID to filter events for */
  sessionId: string;
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
  const { sessionId, onTextDelta, onTextComplete } = options;

  // isMounted guard to prevent setState after unmount
  const isMountedRef = useRef(true);

  const [state, setState] = useState<StreamingTextState>({
    messageId: null,
    pendingText: '',
    isStreaming: false,
    isComplete: false,
    finalText: null,
  });

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

      // Only process streaming events for our session
      if ('sessionId' in update && update.sessionId !== sessionId) {
        return;
      }

      switch (update.type) {
        case 'text_delta': {
          const delta = update as ApiEphemeralTextDelta;
          setState(prev => {
            // If this is a new message, reset state
            if (prev.messageId !== delta.messageId) {
              return {
                messageId: delta.messageId,
                pendingText: delta.delta,
                isStreaming: true,
                isComplete: false,
                finalText: null,
              };
            }
            // Otherwise, accumulate
            return {
              ...prev,
              pendingText: prev.pendingText + delta.delta,
            };
          });
          onTextDeltaRef.current?.(delta.messageId, delta.delta);
          break;
        }

        case 'text_complete': {
          const complete = update as ApiEphemeralTextComplete;
          setState(prev => {
            // Handle text_complete even if we didn't track this message
            // (e.g. missed deltas, reconnection scenarios)
            if (prev.messageId !== complete.messageId && prev.messageId !== null) {
              return prev;
            }
            return {
              messageId: complete.messageId,
              pendingText: complete.fullText,
              isStreaming: false,
              isComplete: true,
              finalText: complete.fullText,
            };
          });
          onTextCompleteRef.current?.(complete.messageId, complete.fullText);
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
    const unsubscribe = sync.onEphemeralUpdate?.(handleEphemeral as (update: unknown) => void);

    return () => {
      isMountedRef.current = false;
      unsubscribe?.();
    };
  }, [sessionId]);

  // Reset streaming state
  const reset = useCallback(() => {
    setState({
      messageId: null,
      pendingText: '',
      isStreaming: false,
      isComplete: false,
      finalText: null,
    });
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
