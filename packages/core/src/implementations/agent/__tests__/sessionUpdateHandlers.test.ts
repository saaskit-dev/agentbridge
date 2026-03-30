import { describe, expect, it, vi } from 'vitest';
import type { ITransportHandler } from '../../../interfaces/transport.js';
import {
  failToolCall,
  handleToolCall,
  handleToolCallUpdate,
  handlePlanUpdate,
  type HandlerContext,
} from '../sessionUpdateHandlers.js';

function createContext() {
  const emitted: unknown[] = [];
  const cleared: unknown[] = [];
  const transport: ITransportHandler = {
    agentName: 'test',
    getInitTimeout: () => 1000,
    getToolPatterns: () => [],
  };
  const ctx: HandlerContext = {
    transport,
    activeToolCalls: new Set(['call-1']),
    toolCallStartTimes: new Map([['call-1', Date.now()]]),
    toolCallTimeouts: new Map(),
    toolCallIdToNameMap: new Map([['call-1', 'exec_command']]),
    idleTimeout: null,
    toolCallCountSincePrompt: 0,
    mcpServerNames: [],
    emit: msg => emitted.push(msg),
    emitIdleStatus: () => emitted.push({ type: 'idle' }),
    clearIdleTimeout: () => cleared.push('cleared'),
    setIdleTimeout: vi.fn(),
    resetResponseCompleteTimeout: vi.fn(),
  };
  return { ctx, emitted, cleared };
}

describe('sessionUpdateHandlers', () => {
  it('uses rawInput when tool_call has no content', () => {
    const { ctx, emitted } = createContext();
    ctx.activeToolCalls = new Set();
    ctx.toolCallStartTimes = new Map();
    ctx.toolCallIdToNameMap = new Map();

    handleToolCall(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-2',
        kind: 'exec_command',
        rawInput: {
          cmd: 'pwd',
          workdir: '/tmp',
        },
      },
      ctx
    );

    expect(emitted).toContainEqual({
      type: 'tool-call',
      toolName: 'exec_command',
      args: {
        cmd: 'pwd',
        workdir: '/tmp',
      },
      callId: 'call-2',
    });
  });

  it('uses rawOutput when completed tool_call_update has no content', () => {
    const { ctx, emitted } = createContext();

    handleToolCallUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        kind: 'exec_command',
        status: 'completed',
        rawOutput: {
          stdout: '/Users/dev/agentbridge\n',
          exitCode: 0,
        },
      },
      ctx
    );

    expect(emitted).toContainEqual({
      type: 'tool-result',
      toolName: 'exec_command',
      result: {
        stdout: '/Users/dev/agentbridge\n',
        exitCode: 0,
      },
      callId: 'call-1',
    });
  });

  it('falls back to rawOutput when failed tool_call_update has no content', () => {
    const { ctx, emitted } = createContext();

    handleToolCallUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        kind: 'exec',
        status: 'failed',
        rawOutput: {
          stderr: 'rg: /missing/file: No such file or directory',
          exit_code: 2,
        },
      },
      ctx
    );

    expect(emitted).toContainEqual({
      type: 'tool-result',
      toolName: 'exec_command',
      result: {
        error: 'rg: /missing/file: No such file or directory',
        status: 'failed',
      },
      callId: 'call-1',
    });
  });

  it('keeps generic fallback only when neither content nor rawOutput has details', () => {
    const { ctx, emitted } = createContext();

    failToolCall('call-1', 'failed', 'exec', undefined, ctx, undefined);

    expect(emitted).toContainEqual({
      type: 'tool-result',
      toolName: 'exec_command',
      result: {
        error: 'Tool call failed',
        status: 'failed',
      },
      callId: 'call-1',
    });
  });

  describe('handlePlanUpdate', () => {
    it('normalizes valid plan entries with content, priority, and status', () => {
      const { ctx, emitted } = createContext();

      handlePlanUpdate(
        {
          plan: [
            { content: 'Step 1', priority: 'high', status: 'completed' },
            { content: 'Step 2', priority: 'medium', status: 'in_progress' },
            { content: 'Step 3', priority: 'low', status: 'pending' },
          ],
        },
        ctx
      );

      expect(emitted).toEqual([
        {
          type: 'event',
          name: 'plan',
          payload: [
            { content: 'Step 1', priority: 'high', status: 'completed' },
            { content: 'Step 2', priority: 'medium', status: 'in_progress' },
            { content: 'Step 3', priority: 'low', status: 'pending' },
          ],
        },
      ]);
    });

    it('strips invalid priority and status values', () => {
      const { ctx, emitted } = createContext();

      handlePlanUpdate(
        {
          plan: [{ content: 'Do something', priority: 'urgent', status: 'blocked' }],
        },
        ctx
      );

      expect(emitted).toEqual([
        {
          type: 'event',
          name: 'plan',
          payload: [{ content: 'Do something' }],
        },
      ]);
    });

    it('filters out entries without content', () => {
      const { ctx, emitted } = createContext();

      handlePlanUpdate(
        {
          plan: [
            { content: 'Valid entry', priority: 'high' },
            { priority: 'low', status: 'pending' },
            null,
            42,
          ],
        },
        ctx
      );

      expect(emitted).toEqual([
        {
          type: 'event',
          name: 'plan',
          payload: [{ content: 'Valid entry', priority: 'high' }],
        },
      ]);
    });

    it('passes through non-array plan as-is for backward compatibility', () => {
      const { ctx, emitted } = createContext();
      const rawPlan = { description: 'some legacy format' };

      handlePlanUpdate({ plan: rawPlan }, ctx);

      expect(emitted).toEqual([{ type: 'event', name: 'plan', payload: rawPlan }]);
    });

    it('returns unhandled when plan is absent', () => {
      const { ctx, emitted } = createContext();

      const result = handlePlanUpdate({}, ctx);

      expect(result.handled).toBe(false);
      expect(emitted).toEqual([]);
    });
  });
});
