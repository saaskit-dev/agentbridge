import { describe, it, expect } from 'vitest';
import { mapAcpMessageToNormalized } from './mapAcpMessageToNormalized';
import type { AgentMessage } from '@/agent';

describe('mapAcpMessageToNormalized', () => {
  // ---- model-output ----

  it('maps model-output textDelta to agent text', () => {
    const msg = { type: 'model-output', textDelta: 'hello' } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('agent');
    expect(result?.role === 'agent' && result.content[0].type).toBe('text');
    expect(result?.role === 'agent' && (result.content[0] as { text: string }).text).toBe('hello');
  });

  it('returns null for model-output with empty text', () => {
    const msg = { type: 'model-output', textDelta: '' } as AgentMessage;
    expect(mapAcpMessageToNormalized(msg)).toBeNull();
  });

  // ---- status ----

  it('maps status running to working event', () => {
    const msg = { type: 'status', status: 'running' } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe(
      'working'
    );
  });

  it('maps status idle to idle event', () => {
    const msg = { type: 'status', status: 'idle' } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('idle');
  });

  it('maps status error to error event', () => {
    const msg = { type: 'status', status: 'error', detail: 'bad thing' } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('error');
    expect(result?.role === 'event' && (result.content as { message: string }).message).toBe(
      'bad thing'
    );
  });

  // ---- tool-call / tool-result ----

  it('maps tool-call to agent tool-call content', () => {
    const msg = {
      type: 'tool-call',
      toolName: 'read_file',
      callId: 'call-1',
      args: { path: '/tmp/foo' },
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
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
    const result = mapAcpMessageToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-result');
    expect((block as { is_error: boolean } | null)?.is_error).toBe(false);
  });

  // ---- event (thinking) ----

  it('maps event thinking to agent thinking content', () => {
    const msg = {
      type: 'event',
      name: 'thinking',
      payload: { text: 'reasoning here' },
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('thinking');
    expect((block as { thinking: string } | null)?.thinking).toBe('reasoning here');
  });

  // ---- token-count ----

  it('maps token-count to token_count event', () => {
    const msg = { type: 'token-count', input_tokens: 100, output_tokens: 50 } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('token_count');
    const usage =
      result?.role === 'event'
        ? (result.content as { usage: { input_tokens: number } }).usage
        : null;
    expect(usage?.input_tokens).toBe(100);
  });

  // ---- fs-edit ----

  it('maps fs-edit with diff to [tool-call, tool-result] pair', () => {
    const msg = {
      type: 'fs-edit',
      description: 'Update config',
      diff: '- old\n+ new',
      path: '/src/config.ts',
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('agent');
    if (result?.role !== 'agent') return;

    expect(result.content).toHaveLength(2);

    const call = result.content[0];
    expect(call.type).toBe('tool-call');
    if (call.type !== 'tool-call') return;
    expect(call.name).toBe('FileEdit');
    expect(call.input).toEqual({ path: '/src/config.ts', description: 'Update config' });
    expect(call.description).toBe('Update config');

    const res = result.content[1];
    expect(res.type).toBe('tool-result');
    if (res.type !== 'tool-result') return;
    expect(res.tool_use_id).toBe(call.id);
    expect(res.content).toBe('- old\n+ new');
    expect(res.is_error).toBe(false);
  });

  it('maps fs-edit without diff to [tool-call, tool-result] with null content', () => {
    const msg = {
      type: 'fs-edit',
      description: 'Create file',
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('agent');
    if (result?.role !== 'agent') return;

    expect(result.content).toHaveLength(2);

    const call = result.content[0];
    expect(call.type).toBe('tool-call');
    if (call.type !== 'tool-call') return;
    expect(call.input).toEqual({ path: null, description: 'Create file' });

    const res = result.content[1];
    expect(res.type).toBe('tool-result');
    if (res.type !== 'tool-result') return;
    expect(res.tool_use_id).toBe(call.id);
    expect(res.content).toBeNull();
  });

  // ---- terminal-output ----

  it('maps terminal-output to [tool-call, tool-result] pair', () => {
    const msg = {
      type: 'terminal-output',
      data: 'total 24\ndrwxr-xr-x  5 user staff 160 Mar 28 22:00 .',
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    expect(result?.role).toBe('agent');
    if (result?.role !== 'agent') return;

    expect(result.content).toHaveLength(2);

    const call = result.content[0];
    expect(call.type).toBe('tool-call');
    if (call.type !== 'tool-call') return;
    expect(call.name).toBe('TerminalOutput');
    expect(call.input).toEqual({});

    const res = result.content[1];
    expect(res.type).toBe('tool-result');
    if (res.type !== 'tool-result') return;
    expect(res.tool_use_id).toBe(call.id);
    expect(res.content).toBe('total 24\ndrwxr-xr-x  5 user staff 160 Mar 28 22:00 .');
    expect(res.is_error).toBe(false);
  });

  // ---- exec-approval-request / patch ----

  it('maps exec-approval-request to CodexBash tool-call', () => {
    const msg = {
      type: 'exec-approval-request',
      call_id: 'exec-1',
      command: 'ls',
    } as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });

  it('maps patch-apply-begin to CodexPatch tool-call', () => {
    const msg = {
      type: 'patch-apply-begin',
      call_id: 'patch-1',
      changes: {},
    } as unknown as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexPatch');
  });

  it('maps patch-apply-end to tool-result', () => {
    const msg = {
      type: 'patch-apply-end',
      call_id: 'patch-1',
      success: true,
      stdout: 'ok',
      stderr: '',
    } as unknown as AgentMessage;
    const result = mapAcpMessageToNormalized(msg);
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-result');
    expect((block as { is_error: boolean } | null)?.is_error).toBe(false);
  });

  // ---- skipExecAndPatch option ----

  it('returns null for exec-approval-request when skipExecAndPatch is true', () => {
    const msg = {
      type: 'exec-approval-request',
      call_id: 'exec-1',
      command: 'ls',
    } as AgentMessage;
    expect(mapAcpMessageToNormalized(msg, { skipExecAndPatch: true })).toBeNull();
  });

  it('returns null for patch-apply-begin when skipExecAndPatch is true', () => {
    const msg = {
      type: 'patch-apply-begin',
      call_id: 'patch-1',
      changes: {},
    } as unknown as AgentMessage;
    expect(mapAcpMessageToNormalized(msg, { skipExecAndPatch: true })).toBeNull();
  });

  it('returns null for patch-apply-end when skipExecAndPatch is true', () => {
    const msg = {
      type: 'patch-apply-end',
      call_id: 'patch-1',
      success: true,
    } as unknown as AgentMessage;
    expect(mapAcpMessageToNormalized(msg, { skipExecAndPatch: true })).toBeNull();
  });

  // ---- unknown ----

  it('returns null for unknown message types', () => {
    const msg = { type: 'unknown-type' } as unknown as AgentMessage;
    expect(mapAcpMessageToNormalized(msg)).toBeNull();
  });
});
