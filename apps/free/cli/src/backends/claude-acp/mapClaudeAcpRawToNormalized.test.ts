import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@/agent';
import { mapClaudeAcpRawToNormalized } from './mapClaudeAcpRawToNormalized';

describe('mapClaudeAcpRawToNormalized', () => {
  it('maps model-output textDelta to agent text', () => {
    const msg = { type: 'model-output', textDelta: 'hello' } as AgentMessage;
    const result = mapClaudeAcpRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    expect(result?.role === 'agent' && result.content[0].type).toBe('text');
  });

  it('maps status running to working event', () => {
    const msg = { type: 'status', status: 'running' } as AgentMessage;
    const result = mapClaudeAcpRawToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('status');
  });

  it('maps thinking events to thinking content', () => {
    const msg = {
      type: 'event',
      name: 'thinking',
      payload: { text: 'reasoning here' },
    } as AgentMessage;
    const result = mapClaudeAcpRawToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('thinking');
  });

  it('maps exec-approval-request to CodexBash tool-call', () => {
    const msg = { type: 'exec-approval-request', call_id: 'exec-1', command: 'ls' } as AgentMessage;
    const result = mapClaudeAcpRawToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });

  it('returns null for unknown message types', () => {
    const msg = { type: 'unknown-type' } as unknown as AgentMessage;
    expect(mapClaudeAcpRawToNormalized(msg)).toBeNull();
  });
});
