import { describe, it, expect } from 'vitest';
import { mapGeminiRawToNormalized } from './mapGeminiRawToNormalized';
import type { AgentMessage } from '@/agent';

describe('mapGeminiRawToNormalized', () => {
  it('maps model-output textDelta to agent text', () => {
    const msg = { type: 'model-output', textDelta: 'hello' } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    expect(result?.role === 'agent' && result.content[0].type).toBe('text');
    expect(result?.role === 'agent' && (result.content[0] as { text: string }).text).toBe('hello');
  });

  it('returns null for model-output with empty text', () => {
    const msg = { type: 'model-output', textDelta: '' } as AgentMessage;
    expect(mapGeminiRawToNormalized(msg)).toBeNull();
  });

  it('maps status running to working event', () => {
    const msg = { type: 'status', status: 'running' } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('status');
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('working');
  });

  it('maps status idle to idle event', () => {
    const msg = { type: 'status', status: 'idle' } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('idle');
  });

  it('maps status error to error event', () => {
    const msg = { type: 'status', status: 'error', detail: 'something failed' } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('error');
    expect(result?.role === 'event' && (result.content as { message: string }).message).toBe('something failed');
  });

  it('maps tool-call to agent tool-call content', () => {
    const msg = {
      type: 'tool-call',
      toolName: 'read_file',
      callId: 'call-1',
      args: { path: '/tmp/foo' },
    } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('read_file');
  });

  it('maps tool-result to agent tool-result content', () => {
    const msg = {
      type: 'tool-result',
      toolName: 'read_file',
      callId: 'call-1',
      result: 'file contents',
    } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-result');
    expect((block as { is_error: boolean } | null)?.is_error).toBe(false);
  });

  it('maps event thinking to agent thinking content', () => {
    const msg = {
      type: 'event',
      name: 'thinking',
      payload: { text: 'reasoning here' },
    } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('thinking');
    expect((block as { thinking: string } | null)?.thinking).toBe('reasoning here');
  });

  it('maps token-count to token_count event', () => {
    const msg = { type: 'token-count', input_tokens: 100, output_tokens: 50 } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('token_count');
    const usage = result?.role === 'event' ? (result.content as { usage: { input_tokens: number } }).usage : null;
    expect(usage?.input_tokens).toBe(100);
  });

  it('returns null for unknown message types', () => {
    const msg = { type: 'unknown-type' } as unknown as AgentMessage;
    expect(mapGeminiRawToNormalized(msg)).toBeNull();
  });

  it('maps exec-approval-request to CodexBash tool-call', () => {
    const msg = { type: 'exec-approval-request', call_id: 'exec-1', command: 'ls' } as AgentMessage;
    const result = mapGeminiRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });
});
