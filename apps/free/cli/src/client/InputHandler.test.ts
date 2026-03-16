/**
 * InputHandler unit tests
 *
 * Tests line mode forwarding, stop idempotency, and PTY mode Ctrl+C detection.
 * Uses a module-level shared state object so the hoisted vi.mock can reference it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPCClient } from '@/daemon/ipc/IPCClient';
import type { IPCClientMessage } from '@/daemon/ipc/protocol';

// ---------------------------------------------------------------------------
// Shared state for readline mock — vi.mock is hoisted, so we use a
// module-level object that survives hoisting and is reset in beforeEach.
// ---------------------------------------------------------------------------

const rlState: {
  lineCallback?: (line: string) => void;
  closeCallback?: () => void;
  closeFn: ReturnType<typeof vi.fn>;
} = {
  closeFn: vi.fn(),
};

vi.mock('node:readline', () => ({
  default: {
    createInterface: vi.fn(() => ({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'line') rlState.lineCallback = cb as (line: string) => void;
        if (event === 'close') rlState.closeCallback = cb as () => void;
      }),
      close: (...args: unknown[]) => rlState.closeFn(...args),
    })),
  },
}));

// Import after mock setup
import { InputHandler } from './InputHandler';

// ---------------------------------------------------------------------------
// Mock IPCClient
// ---------------------------------------------------------------------------

function makeMockClient(): IPCClient & { sentMessages: IPCClientMessage[] } {
  const sentMessages: IPCClientMessage[] = [];
  return {
    sentMessages,
    send: vi.fn((msg: IPCClientMessage) => sentMessages.push(msg)),
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IPCClient & { sentMessages: IPCClientMessage[] };
}

// ---------------------------------------------------------------------------
// Line mode tests
// ---------------------------------------------------------------------------

describe('InputHandler — line mode', () => {
  beforeEach(() => {
    rlState.lineCallback = undefined;
    rlState.closeCallback = undefined;
    rlState.closeFn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards non-empty lines as send_input', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    rlState.lineCallback?.('hello world');

    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]).toEqual({
      type: 'send_input',
      sessionId: 'sess-1',
      text: 'hello world',
    });
  });

  it('ignores empty/whitespace-only lines', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    rlState.lineCallback?.('');
    rlState.lineCallback?.('   ');

    expect(client.sentMessages).toHaveLength(0);
  });

  it('trims input before sending', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    rlState.lineCallback?.('  trimmed  ');

    expect(client.sentMessages[0]).toEqual({
      type: 'send_input',
      sessionId: 'sess-1',
      text: 'trimmed',
    });
  });

  it('does not forward lines after stop()', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    handler.stop();
    rlState.lineCallback?.('should be ignored');

    expect(client.sentMessages).toHaveLength(0);
  });

  it('stop() is idempotent', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    handler.stop();
    handler.stop(); // second call is no-op

    expect(rlState.closeFn).toHaveBeenCalledTimes(1);
  });

  it('readline close event triggers stop', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1');
    handler.start();

    rlState.closeCallback?.();

    // After close, further lines should be ignored
    rlState.lineCallback?.('ignored after close');
    expect(client.sentMessages).toHaveLength(0);
  });
});

describe('InputHandler — PTY mode fallback', () => {
  beforeEach(() => {
    rlState.lineCallback = undefined;
    rlState.closeCallback = undefined;
    rlState.closeFn = vi.fn();
  });

  it('isPtyMode=false falls back to line mode even without TTY', () => {
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1', { isPtyMode: false });
    expect(() => handler.start()).not.toThrow();
    handler.stop();
  });

  it('isPtyMode=true falls back to line mode when stdin is not TTY', () => {
    // In test environment, process.stdin.isTTY is falsy
    const client = makeMockClient();
    const handler = new InputHandler(client, 'sess-1', { isPtyMode: true });
    handler.start();

    // Should be in line mode — verify by sending a line
    rlState.lineCallback?.('test');
    expect(client.sentMessages[0]?.type).toBe('send_input');
    handler.stop();
  });
});
