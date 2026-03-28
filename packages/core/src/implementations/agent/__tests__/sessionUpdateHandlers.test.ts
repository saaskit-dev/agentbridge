import { describe, expect, it, vi } from 'vitest';
import type { ITransportHandler } from '../../../interfaces/transport.js';
import {
  failToolCall,
  handleToolCall,
  handleToolCallUpdate,
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
});
