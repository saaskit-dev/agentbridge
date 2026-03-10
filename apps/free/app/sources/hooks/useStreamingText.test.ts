/**
 * Tests for useStreamingText state machine reducers
 *
 * Tests the pure reducer functions (applyTextDelta / applyTextComplete)
 * that drive the streaming text hook, covering the scenarios that caused
 * the "处理中 stuck" bug:
 *
 * 1. text_complete received with no prior text_delta (non-streaming mode)
 * 2. text_complete received when previous turn's messageId is still in state
 * 3. Multiple text_complete events mid-turn (OpenCode's multi-idle scenario)
 * 4. Normal streaming: deltas accumulate then complete
 */

import { describe, it, expect } from 'vitest';
import {
  applyTextDelta,
  applyTextComplete,
  STREAMING_INITIAL_STATE,
  type StreamingTextState,
} from './streamingTextReducer';
import type { ApiEphemeralTextDelta, ApiEphemeralTextComplete } from '@/sync/apiTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delta(messageId: string, text: string): ApiEphemeralTextDelta {
  return { type: 'text_delta', sessionId: 'sess-1', messageId, delta: text, timestamp: 0 };
}

function complete(messageId: string, fullText: string): ApiEphemeralTextComplete {
  return { type: 'text_complete', sessionId: 'sess-1', messageId, fullText, timestamp: 0 };
}

// ---------------------------------------------------------------------------
// applyTextDelta
// ---------------------------------------------------------------------------

describe('applyTextDelta', () => {
  it('starts a new message from initial state', () => {
    const next = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Hello'));
    expect(next).toEqual<StreamingTextState>({
      messageId: 'msg-1',
      pendingText: 'Hello',
      isStreaming: true,
      isComplete: false,
      finalText: null,
    });
  });

  it('accumulates text for the same messageId', () => {
    const s0 = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Hello'));
    const s1 = applyTextDelta(s0, delta('msg-1', ' world'));
    expect(s1.pendingText).toBe('Hello world');
    expect(s1.isStreaming).toBe(true);
    expect(s1.isComplete).toBe(false);
  });

  it('resets state when a new messageId arrives mid-stream', () => {
    const s0 = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Old text'));
    const s1 = applyTextDelta(s0, delta('msg-2', 'New'));
    expect(s1.messageId).toBe('msg-2');
    expect(s1.pendingText).toBe('New');
    expect(s1.finalText).toBeNull();
  });

  it('resumes streaming (resets isComplete) when delta arrives after a premature text_complete', () => {
    // Simulates OpenCode's running→idle→running pattern where status:idle
    // used to fire text_complete prematurely, then new deltas arrive
    const s0 = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Part 1 '));
    // Premature text_complete (old Bug 2 behaviour, now only in finally block — but test the delta reset)
    const s1 = applyTextComplete(complete('msg-1', 'Part 1 '));
    expect(s1.isComplete).toBe(true);
    // New delta arrives for the same message (turn continues after tool call)
    const s2 = applyTextDelta(s1, delta('msg-1', 'Part 2'));
    expect(s2.isComplete).toBe(false);
    expect(s2.isStreaming).toBe(true);
    expect(s2.pendingText).toBe('Part 1 Part 2');
  });
});

// ---------------------------------------------------------------------------
// applyTextComplete
// ---------------------------------------------------------------------------

describe('applyTextComplete', () => {
  it('completes with full text from initial state (non-streaming mode — no prior deltas)', () => {
    // Bug 1 scenario: agent sends text_complete without any preceding text_delta
    const next = applyTextComplete(complete('msg-1', 'Full response'));
    expect(next).toEqual<StreamingTextState>({
      messageId: 'msg-1',
      pendingText: 'Full response',
      isStreaming: false,
      isComplete: true,
      finalText: 'Full response',
    });
  });

  it('always accepts text_complete even when previous turn messageId is in state', () => {
    // Bug 1 scenario: previous turn's messageId is still set (turn A done, no reset between turns)
    const prevTurnState: StreamingTextState = {
      messageId: 'msg-PREV',
      pendingText: 'Previous response',
      isStreaming: false,
      isComplete: true,
      finalText: 'Previous response',
    };
    const next = applyTextComplete(complete('msg-NEW', 'New response'));
    expect(next.messageId).toBe('msg-NEW');
    expect(next.finalText).toBe('New response');
    expect(next.isComplete).toBe(true);
    // Verify the old guard (messageId mismatch) is gone — state is accepted
    expect(next).not.toMatchObject({ messageId: 'msg-PREV' });
    // prevTurnState is unused but kept for documentation
    void prevTurnState;
  });

  it('handles multiple text_complete events for the same messageId (multi-idle scenario)', () => {
    // Old Bug 2: OpenCode went idle multiple times, sending text_complete each time.
    // Each call should simply update with the latest fullText.
    const s0 = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Part A '));
    const s1 = applyTextComplete(complete('msg-1', 'Part A '));
    const s2 = applyTextDelta(s1, delta('msg-1', 'Part B'));
    const s3 = applyTextComplete(complete('msg-1', 'Part A Part B'));
    expect(s3.finalText).toBe('Part A Part B');
    expect(s3.isComplete).toBe(true);
    expect(s3.isStreaming).toBe(false);
    // suppress unused warning
    void s0;
    void s2;
  });

  it('sets finalText equal to pendingText on completion', () => {
    const s0 = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Hello '));
    const s1 = applyTextDelta(s0, delta('msg-1', 'world'));
    const s2 = applyTextComplete(complete('msg-1', 'Hello world'));
    expect(s2.pendingText).toBe('Hello world');
    expect(s2.finalText).toBe('Hello world');
    expect(s2.isStreaming).toBe(false);
    expect(s2.isComplete).toBe(true);
  });

  it('works correctly for empty response (model produced no text)', () => {
    const next = applyTextComplete(complete('msg-1', ''));
    expect(next.finalText).toBe('');
    expect(next.pendingText).toBe('');
    expect(next.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-turn sequence
// ---------------------------------------------------------------------------

describe('multi-turn sequence', () => {
  it('correctly transitions through two consecutive turns', () => {
    // Turn 1
    let state = applyTextDelta(STREAMING_INITIAL_STATE, delta('msg-1', 'Turn 1'));
    state = applyTextComplete(complete('msg-1', 'Turn 1'));
    expect(state.finalText).toBe('Turn 1');

    // Turn 2 — text_complete arrives without prior delta (non-streaming mode)
    // This was Bug 1: the old guard would have dropped this text_complete
    state = applyTextComplete(complete('msg-2', 'Turn 2 no deltas'));
    expect(state.messageId).toBe('msg-2');
    expect(state.finalText).toBe('Turn 2 no deltas');
    expect(state.isComplete).toBe(true);
  });
});
