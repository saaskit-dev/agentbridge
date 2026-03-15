import { describe, expect, it } from 'vitest';
import { mapSDKMessageToNormalized } from './mapSDKMessageToNormalized';
import type { SDKAssistantMessage, SDKResultMessage, SDKSystemMessage, SDKUserMessage } from '@/claude/sdk/types';

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

    expect(mapSDKMessageToNormalized(message)).toEqual([]);
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

    const result = mapSDKMessageToNormalized(message);

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('agent');
    expect(result[0]?.role === 'agent' && result[0].content[0]?.type).toBe('text');
    expect(
      result[1]?.role === 'agent' && result[1].content[0]?.type === 'tool-call'
        ? result[1].content[0].name
        : null
    ).toBe('ToolSearch');
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

    const result = mapSDKMessageToNormalized(message);

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

    const result = mapSDKMessageToNormalized(message);

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('event');
    expect(result[0]?.role === 'event' && result[0].content.type).toBe('token_count');
    expect(result[1]?.role === 'event' && result[1].content.type === 'status'
      ? result[1].content.state
      : null).toBe('idle');
    expect(
      result.some(
        item => item.role === 'event' && item.content.type === 'message'
      )
    ).toBe(false);
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

    const result = mapSDKMessageToNormalized(message);

    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('event');
    expect(result[0]?.role === 'event' && result[0].content.type).toBe('error');
    expect(result[1]?.role === 'event' && result[1].content.type === 'status'
      ? result[1].content.state
      : null).toBe('idle');
  });
});
