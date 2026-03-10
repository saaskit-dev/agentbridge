/**
 * Pure reducer functions for the streaming text state machine.
 *
 * Extracted from useStreamingText so they can be unit-tested in the node
 * environment without pulling in React Native or sync dependencies.
 */

import type { ApiEphemeralTextDelta, ApiEphemeralTextComplete } from '@/sync/apiTypes';

/**
 * Streaming text state for a message.
 * Lives here (not in useStreamingText) so it can be imported by unit tests
 * without pulling in the React Native module graph.
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

/** Initial / reset state for the streaming state machine */
export const STREAMING_INITIAL_STATE: StreamingTextState = {
  messageId: null,
  pendingText: '',
  isStreaming: false,
  isComplete: false,
  finalText: null,
};

/**
 * Pure reducer: apply a text_delta event to the current streaming state.
 *
 * - New messageId → reset state and start fresh
 * - Same messageId → accumulate text; also reset isComplete in case a
 *   premature text_complete was sent while the turn paused for a tool call
 *   (OpenCode's running→idle→running pattern).
 */
export function applyTextDelta(
  prev: StreamingTextState,
  delta: ApiEphemeralTextDelta
): StreamingTextState {
  if (prev.messageId !== delta.messageId) {
    return {
      messageId: delta.messageId,
      pendingText: delta.delta,
      isStreaming: true,
      isComplete: false,
      finalText: null,
    };
  }
  return {
    ...prev,
    pendingText: prev.pendingText + delta.delta,
    isStreaming: true,
    isComplete: false,
  };
}

/**
 * Pure reducer: apply a text_complete event.
 *
 * Always replaces state unconditionally — there is no guard on the previous
 * messageId.  The old guard was the root cause of Bug 1 ("处理中 stuck"):
 * it silently dropped text_complete when the previous turn's messageId was
 * still set and the current turn had sent no text_delta events.
 */
export function applyTextComplete(complete: ApiEphemeralTextComplete): StreamingTextState {
  return {
    messageId: complete.messageId,
    pendingText: complete.fullText,
    isStreaming: false,
    isComplete: true,
    finalText: complete.fullText,
  };
}
