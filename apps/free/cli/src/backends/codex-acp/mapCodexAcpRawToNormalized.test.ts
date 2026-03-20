import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@/agent';
import { mapCodexAcpRawToNormalized } from './mapCodexAcpRawToNormalized';

describe('mapCodexAcpRawToNormalized', () => {
  it('maps model-output textDelta to agent text', () => {
    const msg = { type: 'model-output', textDelta: 'hello' } as AgentMessage;
    const result = mapCodexAcpRawToNormalized(msg);
    expect(result?.role).toBe('agent');
    expect(result?.role === 'agent' && result.content[0].type).toBe('text');
  });

  it('maps status idle to idle event', () => {
    const msg = { type: 'status', status: 'idle' } as AgentMessage;
    const result = mapCodexAcpRawToNormalized(msg);
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('idle');
  });

  it('maps tool-call to agent tool-call content', () => {
    const msg = {
      type: 'tool-call',
      toolName: 'read_file',
      callId: 'call-1',
      args: { path: '/tmp/foo' },
    } as AgentMessage;
    const result = mapCodexAcpRawToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('read_file');
  });

  it('maps exec-approval-request to CodexBash tool-call', () => {
    const msg = { type: 'exec-approval-request', call_id: 'exec-1', command: 'ls' } as AgentMessage;
    const result = mapCodexAcpRawToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });

  it('returns null for unknown message types', () => {
    const msg = { type: 'unknown-type' } as unknown as AgentMessage;
    expect(mapCodexAcpRawToNormalized(msg)).toBeNull();
  });
});
