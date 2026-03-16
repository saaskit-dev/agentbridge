import { describe, it, expect } from 'vitest';
import { mapCodexRawToNormalized } from './mapCodexRawToNormalized';

describe('mapCodexRawToNormalized', () => {
  it('maps task_started to working status event', () => {
    const result = mapCodexRawToNormalized({ type: 'task_started' });
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('status');
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('working');
  });

  it('maps task_complete to idle status event', () => {
    const result = mapCodexRawToNormalized({ type: 'task_complete' });
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('idle');
  });

  it('maps turn_aborted to idle status event', () => {
    const result = mapCodexRawToNormalized({ type: 'turn_aborted' });
    expect(result?.role === 'event' && (result.content as { state: string }).state).toBe('idle');
  });

  it('maps token_count to token_count event', () => {
    const result = mapCodexRawToNormalized({
      type: 'token_count',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(result?.role).toBe('event');
    expect(result?.role === 'event' && result.content.type).toBe('token_count');
    const usage = result?.role === 'event' ? (result.content as { usage: { input_tokens: number } }).usage : null;
    expect(usage?.input_tokens).toBe(100);
  });

  it('maps agent_message to agent text content', () => {
    const result = mapCodexRawToNormalized({ type: 'agent_message', message: 'hello world' });
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('text');
    expect((block as { text: string } | null)?.text).toBe('hello world');
  });

  it('returns null for agent_message with non-string message', () => {
    expect(mapCodexRawToNormalized({ type: 'agent_message', message: 42 })).toBeNull();
  });

  it('maps agent_reasoning to thinking content', () => {
    const result = mapCodexRawToNormalized({ type: 'agent_reasoning', text: 'thinking…' });
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('thinking');
    expect((block as { thinking: string } | null)?.thinking).toBe('thinking…');
  });

  it('maps agent_reasoning_delta to thinking content using delta field', () => {
    const result = mapCodexRawToNormalized({ type: 'agent_reasoning_delta', delta: 'chunk' });
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('thinking');
    expect((block as { thinking: string } | null)?.thinking).toBe('chunk');
  });

  it('maps exec_command_begin to CodexBash tool-call', () => {
    const result = mapCodexRawToNormalized({
      type: 'exec_command_begin',
      call_id: 'cmd-1',
      command: 'ls -la',
    });
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });

  it('maps exec_approval_request to CodexBash tool-call', () => {
    const result = mapCodexRawToNormalized({
      type: 'exec_approval_request',
      call_id: 'cmd-2',
      command: ['git', 'status'],
    });
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect((block as { name: string } | null)?.name).toBe('CodexBash');
  });

  it('maps patch_apply_begin to CodexPatch tool-call', () => {
    const result = mapCodexRawToNormalized({
      type: 'patch_apply_begin',
      call_id: 'patch-1',
      changes: { 'foo.ts': '...' },
    });
    expect(result?.role).toBe('agent');
    const block = result?.role === 'agent' ? result.content[0] : null;
    expect(block?.type).toBe('tool-call');
    expect((block as { name: string } | null)?.name).toBe('CodexPatch');
  });

  it('returns null for exec_command_end', () => {
    expect(mapCodexRawToNormalized({ type: 'exec_command_end' })).toBeNull();
  });

  it('returns null for unknown types', () => {
    expect(mapCodexRawToNormalized({ type: 'some_unknown_event' })).toBeNull();
  });
});
