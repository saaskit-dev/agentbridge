import { describe, expect, it } from 'vitest';
import {
  mapSDKMessageToNormalized,
  createSDKMapperState,
  flushSDKOpenToolCalls,
} from './mapSDKMessageToNormalized';
import type {
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '@/claude/sdk/types';

describe('mapSDKMessageToNormalized', () => {
  it('ignores system init messages for app sync', () => {
    const message: SDKSystemMessage = {
      type: 'system',
      subtype: 'init',
      session_id: 'session-1',
      model: 'claude-opus-4-1',
      cwd: '/Users/dev/agentbridge',
      tools: ['Read', 'Edit'],
    };

    expect(mapSDKMessageToNormalized(message, createSDKMapperState())).toEqual([]);
  });

  it('maps assistant text and tool-use blocks', () => {
    const message: SDKAssistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '你好' },
          { type: 'tool_use', id: 'tool-1', name: 'ToolSearch', input: { query: 'test' } },
        ],
      },
    };

    const result = mapSDKMessageToNormalized(message, createSDKMapperState());

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('agent');
    expect(result[0]?.role === 'agent' && result[0].content[0]?.type).toBe('text');
    expect(
      result[1]?.role === 'agent' && result[1].content[0]?.type === 'tool-call'
        ? result[1].content[0].name
        : null
    ).toBe('ToolSearch');
  });

  it('assigns same traceId to all blocks from one assistant message', () => {
    const message: SDKAssistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm...' },
          { type: 'text', text: '结论' },
          { type: 'tool_use', id: 'tool-x', name: 'Bash', input: {} },
        ],
      },
    };

    const result = mapSDKMessageToNormalized(message, createSDKMapperState());

    expect(result).toHaveLength(3);
    const traceIds = result.map(m => m.traceId);
    // All blocks share the same traceId
    expect(traceIds[0]).toBeDefined();
    expect(traceIds[0]).toBe(traceIds[1]);
    expect(traceIds[1]).toBe(traceIds[2]);
  });

  it('assigns different traceIds to different assistant messages', () => {
    const state = createSDKMapperState();

    const msg1: SDKAssistantMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'turn 1' }] },
    };
    const msg2: SDKAssistantMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'turn 2' }] },
    };

    const r1 = mapSDKMessageToNormalized(msg1, state);
    const r2 = mapSDKMessageToNormalized(msg2, state);

    expect(r1[0]?.traceId).toBeDefined();
    expect(r2[0]?.traceId).toBeDefined();
    expect(r1[0]?.traceId).not.toBe(r2[0]?.traceId);
  });

  it('maps user tool_result blocks to tool-result content', () => {
    const message: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'done',
            is_error: false,
          },
        ],
      },
    };

    const result = mapSDKMessageToNormalized(message, createSDKMapperState());

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('agent');
    expect(
      result[0]?.role === 'agent' && result[0].content[0]?.type === 'tool-result'
        ? result[0].content[0].tool_use_id
        : null
    ).toBe('tool-1');
  });

  it('maps successful results to token_count and idle without terminal summary text', () => {
    const message: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      result: '你好！有什么可以帮你的吗？',
      num_turns: 2,
      usage: {
        input_tokens: 4,
        output_tokens: 100,
        cache_read_input_tokens: 10612,
        cache_creation_input_tokens: 10714,
      },
      total_cost_usd: 0.0748,
      duration_ms: 8161,
      duration_api_ms: 8000,
      is_error: false,
      session_id: 'session-1',
    };

    const result = mapSDKMessageToNormalized(message, createSDKMapperState());

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('event');
    expect(result[0]?.role === 'event' && result[0].content.type).toBe('token_count');
    expect(
      result[1]?.role === 'event' && result[1].content.type === 'status'
        ? result[1].content.state
        : null
    ).toBe('idle');
    expect(result.some(item => item.role === 'event' && item.content.type === 'message')).toBe(
      false
    );
  });

  it('maps execution errors to error events and idle status', () => {
    const message: SDKResultMessage = {
      type: 'result',
      subtype: 'error_during_execution',
      num_turns: 3,
      total_cost_usd: 0,
      duration_ms: 2000,
      duration_api_ms: 1500,
      is_error: true,
      session_id: 'session-2',
    };

    const result = mapSDKMessageToNormalized(message, createSDKMapperState());

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('event');
    expect(result[0]?.role === 'event' && result[0].content.type).toBe('error');
    expect(
      result[1]?.role === 'event' && result[1].content.type === 'status'
        ? result[1].content.state
        : null
    ).toBe('idle');
  });

  it('tracks open tool calls across messages and removes them when tool_result arrives', () => {
    const state = createSDKMapperState();

    // Assistant emits a tool call
    const assistantMsg: SDKAssistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-abc', name: 'Read', input: { path: '/tmp' } }],
      },
    };
    mapSDKMessageToNormalized(assistantMsg, state);
    expect(state.openToolCallIds.has('tool-abc')).toBe(true);

    // User message with tool_result closes it
    const userMsg: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-abc', content: 'ok', is_error: false }],
      },
    };
    mapSDKMessageToNormalized(userMsg, state);
    expect(state.openToolCallIds.has('tool-abc')).toBe(false);
  });

  it('result message auto-flushes open tool calls before idle', () => {
    const state = createSDKMapperState();

    // Assistant emits a tool call that never gets a tool_result
    const assistantMsg: SDKAssistantMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-orphan', name: 'Write', input: {} }],
      },
    };
    mapSDKMessageToNormalized(assistantMsg, state);
    expect(state.openToolCallIds.size).toBe(1);

    const resultMsg: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      result: '',
      num_turns: 1,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: 0,
      duration_ms: 100,
      duration_api_ms: 100,
      is_error: false,
      session_id: 'session-x',
    };
    const msgs = mapSDKMessageToNormalized(resultMsg, state);

    // Should have: synthetic tool-result (flush) + token_count + idle
    expect(msgs).toHaveLength(3);
    expect(
      msgs[0]?.role === 'agent' && msgs[0].content[0]?.type === 'tool-result'
        ? msgs[0].content[0].is_error
        : null
    ).toBe(true);
    expect(state.openToolCallIds.size).toBe(0);
  });
});

describe('flushSDKOpenToolCalls', () => {
  it('returns empty array when no open tool calls', () => {
    const state = createSDKMapperState();
    expect(flushSDKOpenToolCalls(state)).toEqual([]);
  });

  it('emits is_error tool-result for each open tool call and clears state', () => {
    const state = createSDKMapperState();
    state.openToolCallIds.add('call-1');
    state.openToolCallIds.add('call-2');

    const flushed = flushSDKOpenToolCalls(state);

    expect(flushed).toHaveLength(2);
    const toolUseIds = flushed.map(m =>
      m.role === 'agent' && m.content[0]?.type === 'tool-result' ? m.content[0].tool_use_id : null
    );
    expect(toolUseIds).toContain('call-1');
    expect(toolUseIds).toContain('call-2');
    flushed.forEach(m => {
      expect(
        m.role === 'agent' && m.content[0]?.type === 'tool-result' ? m.content[0].is_error : null
      ).toBe(true);
    });
    expect(state.openToolCallIds.size).toBe(0);
  });

  it('is idempotent — second call returns empty array', () => {
    const state = createSDKMapperState();
    state.openToolCallIds.add('call-1');
    flushSDKOpenToolCalls(state);
    expect(flushSDKOpenToolCalls(state)).toEqual([]);
  });
});
