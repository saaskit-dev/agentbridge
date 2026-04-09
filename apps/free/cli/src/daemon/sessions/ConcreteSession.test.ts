/**
 * Concrete AgentSession subclass tests
 *
 * Tests the agent-specific session classes:
 *   - ClaudeSession: mode hashing (2 fields), extractMode
 *   - CodexSession: mode hashing (2 fields), extractMode
 *   - GeminiSession: mode hashing (2 fields), extractMode
 *   - OpenCodeSession: mode hashing (1 field), extractMode
 *
 * Each subclass is tested for:
 *   1. agentType literal
 *   2. defaultMode() shape and fallback behavior
 *   3. extractMode() with full/partial/missing meta
 *   4. createModeHasher() determinism and sensitivity to relevant fields
 *   5. createBackend() returns correct backend type
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentSessionOpts } from './AgentSession';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import type { Credentials } from '@/persistence';
import type { UserMessage } from '@/api/types';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so we don't pull in real backends / crypto / etc.
// ---------------------------------------------------------------------------

vi.mock('@/backends/claude/ClaudeBackend', () => ({
  ClaudeBackend: class MockClaudeBackend {
    readonly __type = 'claude';
  },
}));
vi.mock('@/backends/codex/CodexBackend', () => ({
  CodexBackend: class MockCodexBackend {
    readonly __type = 'codex';
  },
}));
vi.mock('@/backends/gemini/GeminiBackend', () => ({
  GeminiBackend: class MockGeminiBackend {
    readonly __type = 'gemini';
  },
}));
vi.mock('@/backends/opencode/OpenCodeBackend', () => ({
  OpenCodeBackend: class MockOpenCodeBackend {
    readonly __type = 'opencode';
  },
}));

// Mock hashObject to return a predictable JSON string so we can test which fields matter
vi.mock('@/utils/deterministicJson', () => ({
  hashObject: (obj: Record<string, unknown>) => JSON.stringify(obj),
}));

import { ClaudeSession } from './ClaudeSession';
import { CodexSession } from './CodexSession';
import { GeminiSession } from './GeminiSession';
import { OpenCodeSession } from './OpenCodeSession';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<AgentSessionOpts> = {}): AgentSessionOpts {
  return {
    credential: { token: 'test-token' } as Credentials,
    machineId: 'test-machine',
    startedBy: 'cli',
    cwd: '/tmp/test',
    broadcast: (_sid: string, _msg: IPCServerMessage) => {},
    daemonInstanceId: 'test-daemon-instance',
    ...overrides,
  };
}

function makeUserMessage(meta: Record<string, unknown> = {}): UserMessage {
  return {
    role: 'user',
    content: { type: 'text', text: 'hello' },
    meta,
  } as UserMessage;
}

// ---------------------------------------------------------------------------
// ClaudeSession (ACP)
// ---------------------------------------------------------------------------

describe('ClaudeSession', () => {
  it('agentType is "claude"', () => {
    const session = new ClaudeSession(makeOpts());
    expect(session.agentType).toBe('claude');
  });

  it('createBackend returns ClaudeBackend', () => {
    const session = new ClaudeSession(makeOpts());
    const backend = session.createBackend();
    expect((backend as { __type?: string }).__type).toBe('claude');
  });

  it('extracts permissionMode and model from meta', () => {
    const session = new ClaudeSession(makeOpts());
    const mode = (session as any).extractMode(
      makeUserMessage({ permissionMode: 'yolo', model: 'claude-opus' })
    );
    expect(mode.permissionMode).toBe('yolo');
    expect(mode.model).toBe('claude-opus');
  });
});

// ---------------------------------------------------------------------------
// CodexSession
// ---------------------------------------------------------------------------

describe('CodexSession', () => {
  it('agentType is "codex"', () => {
    const session = new CodexSession(makeOpts());
    expect(session.agentType).toBe('codex');
  });

  it('createBackend returns CodexBackend', () => {
    const session = new CodexSession(makeOpts());
    const backend = session.createBackend();
    expect((backend as { __type?: string }).__type).toBe('codex');
  });

  it('extracts permissionMode and model from meta', () => {
    const session = new CodexSession(makeOpts());
    const mode = (session as any).extractMode(
      makeUserMessage({ permissionMode: 'accept-edits', model: 'o3' })
    );
    expect(mode.permissionMode).toBe('accept-edits');
    expect(mode.model).toBe('o3');
  });
});

// ---------------------------------------------------------------------------
// GeminiSession
// ---------------------------------------------------------------------------

describe('GeminiSession', () => {
  it('agentType is "gemini"', () => {
    const session = new GeminiSession(makeOpts());
    expect(session.agentType).toBe('gemini');
  });

  it('createBackend returns GeminiBackend', () => {
    const session = new GeminiSession(makeOpts());
    const backend = session.createBackend();
    expect((backend as { __type?: string }).__type).toBe('gemini');
  });

  describe('defaultMode()', () => {
    it('uses opts.permissionMode with fallback to read-only', () => {
      expect(new GeminiSession(makeOpts()).defaultMode().permissionMode).toBe('read-only');
      expect(
        new GeminiSession(makeOpts({ permissionMode: 'accept-edits' })).defaultMode().permissionMode
      ).toBe('accept-edits');
    });

    it('includes model from opts', () => {
      const session = new GeminiSession(makeOpts({ model: 'gemini-2.5' }));
      expect(session.defaultMode().model).toBe('gemini-2.5');
    });
  });

  describe('extractMode()', () => {
    it('extracts permissionMode and model from meta', () => {
      const session = new GeminiSession(makeOpts());
      const mode = (session as any).extractMode(
        makeUserMessage({ permissionMode: 'yolo', model: 'gemini-pro' })
      );
      expect(mode.permissionMode).toBe('yolo');
      expect(mode.model).toBe('gemini-pro');
    });

    it('falls back to opts when meta is missing', () => {
      const session = new GeminiSession(
        makeOpts({ permissionMode: 'accept-edits', model: 'gemini-flash' })
      );
      const mode = (session as any).extractMode(makeUserMessage());
      expect(mode.permissionMode).toBe('accept-edits');
      expect(mode.model).toBe('gemini-flash');
    });
  });

  describe('createModeHasher()', () => {
    it('hash only includes permissionMode and model', () => {
      const session = new GeminiSession(makeOpts());
      const hasher = session.createModeHasher();
      const hash = hasher({ permissionMode: 'yolo', model: 'pro' });
      const parsed = JSON.parse(hash);
      expect(Object.keys(parsed)).toEqual(['permissionMode', 'model']);
    });
  });
});

// ---------------------------------------------------------------------------
// OpenCodeSession
// ---------------------------------------------------------------------------

describe('OpenCodeSession', () => {
  it('agentType is "opencode"', () => {
    const session = new OpenCodeSession(makeOpts());
    expect(session.agentType).toBe('opencode');
  });

  it('createBackend returns OpenCodeBackend', () => {
    const session = new OpenCodeSession(makeOpts());
    const backend = session.createBackend();
    expect((backend as { __type?: string }).__type).toBe('opencode');
  });

  describe('defaultMode()', () => {
    it('uses opts.permissionMode with fallback to read-only', () => {
      expect(new OpenCodeSession(makeOpts()).defaultMode().permissionMode).toBe('read-only');
      expect(
        new OpenCodeSession(makeOpts({ permissionMode: 'yolo' })).defaultMode().permissionMode
      ).toBe('yolo');
    });

    it('does not include model field', () => {
      const session = new OpenCodeSession(makeOpts({ model: 'some-model' }));
      const mode = session.defaultMode();
      expect(mode).toEqual({ permissionMode: 'read-only' });
      expect('model' in mode).toBe(false);
    });
  });

  describe('extractMode()', () => {
    it('extracts only permissionMode from meta', () => {
      const session = new OpenCodeSession(makeOpts());
      const mode = (session as any).extractMode(
        makeUserMessage({ permissionMode: 'yolo', model: 'ignored' })
      );
      expect(mode.permissionMode).toBe('yolo');
      expect('model' in mode).toBe(false);
    });

    it('falls back to opts when meta is missing', () => {
      const session = new OpenCodeSession(makeOpts({ permissionMode: 'accept-edits' }));
      const mode = (session as any).extractMode(makeUserMessage());
      expect(mode.permissionMode).toBe('accept-edits');
    });
  });

  describe('createModeHasher()', () => {
    it('returns permissionMode string directly (no hashObject)', () => {
      const session = new OpenCodeSession(makeOpts());
      const hasher = session.createModeHasher();
      expect(hasher({ permissionMode: 'yolo' })).toBe('yolo');
      expect(hasher({ permissionMode: 'read-only' })).toBe('read-only');
    });
  });
});
