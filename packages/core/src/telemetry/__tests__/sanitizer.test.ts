import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../sanitizer.js';
import type { LogEntry } from '../types.js';

function makeEntry(data?: Record<string, unknown>, error?: LogEntry['error']): LogEntry {
  return {
    timestamp: '2026-03-06T14:00:00.000Z',
    level: 'info',
    layer: 'test',
    component: 'test',
    message: 'test message',
    data,
    error,
  };
}

describe('Sanitizer', () => {
  const sanitizer = new Sanitizer();

  describe('sensitive key redaction', () => {
    it('redacts known sensitive keys', () => {
      const result = sanitizer.process(
        makeEntry({
          token: 'abc123',
          apiKey: 'secret',
          password: 'hunter2',
          safe: 'visible',
        })
      );
      expect(result.data!.token).toBe('[REDACTED]');
      expect(result.data!.apiKey).toBe('[REDACTED]');
      expect(result.data!.password).toBe('[REDACTED]');
      expect(result.data!.safe).toBe('visible');
    });

    it('redacts case-insensitively via partial match', () => {
      const result = sanitizer.process(
        makeEntry({
          Authorization: 'Bearer xxx',
          mySecretValue: 'hidden',
          accessKeyId: 'AKIA...',
        })
      );
      expect(result.data!.Authorization).toBe('[REDACTED]');
      expect(result.data!.mySecretValue).toBe('[REDACTED]');
      expect(result.data!.accessKeyId).toBe('[REDACTED]');
    });

    it('redacts user content keys', () => {
      const result = sanitizer.process(
        makeEntry({
          content: 'user message',
          body: 'request body',
          prompt: 'system prompt',
          c: 'encrypted payload',
          message: 'encrypted user content',
        })
      );
      expect(result.data!.content).toBe('[REDACTED]');
      expect(result.data!.body).toBe('[REDACTED]');
      expect(result.data!.prompt).toBe('[REDACTED]');
      expect(result.data!.c).toBe('[REDACTED]');
      expect(result.data!.message).toBe('[REDACTED]');
    });

    it('does NOT over-redact keys that merely contain a single-char sensitive key (RFC §6.1)', () => {
      // 'c' is in the sensitive list but must only match the exact key 'c',
      // not any key that happens to contain the letter 'c'.
      const result = sanitizer.process(
        makeEntry({
          code: 'ERR_404',
          success: true,
          accepted: 1,
          localId: 'msg-abc',
          c: 'encrypted', // exact match — SHOULD be redacted
        })
      );
      expect(result.data!.code).toBe('ERR_404');
      expect(result.data!.success).toBe(true);
      expect(result.data!.accepted).toBe(1);
      expect(result.data!.localId).toBe('msg-abc');
      expect(result.data!.c).toBe('[REDACTED]');
    });
  });

  describe('string truncation', () => {
    it('truncates strings longer than 500 chars', () => {
      const longString = 'a'.repeat(600);
      const result = sanitizer.process(makeEntry({ value: longString }));
      const val = result.data!.value as string;
      expect(val.length).toBeLessThan(600);
      expect(val).toContain('...[truncated]');
    });

    it('preserves short strings', () => {
      const result = sanitizer.process(makeEntry({ value: 'short' }));
      expect(result.data!.value).toBe('short');
    });
  });

  describe('binary data', () => {
    it('replaces Uint8Array with placeholder', () => {
      const result = sanitizer.process(makeEntry({ buf: new Uint8Array(128) }));
      expect(result.data!.buf).toBe('[BINARY 128]');
    });
  });

  describe('nested objects', () => {
    it('recurses into nested objects', () => {
      const result = sanitizer.process(
        makeEntry({
          outer: { inner: { token: 'secret', safe: 'ok' } },
        })
      );
      const outer = result.data!.outer as Record<string, any>;
      expect(outer.inner.token).toBe('[REDACTED]');
      expect(outer.inner.safe).toBe('ok');
    });

    it('stops at max depth', () => {
      // Use keys that don't match sensitive patterns
      // redactObject depth: 0=data, 1=l1, 2=l2, 3=l3, 4=l4, 5=MAX_DEPTH
      const deep: any = { l1: { l2: { l3: { l4: { l5: { l6: 'deep' } } } } } };
      const result = sanitizer.process(makeEntry(deep));
      const d = result.data as any;
      expect(d.l1.l2.l3.l4.l5).toEqual({ _: '[DEEP_OBJECT]' });
    });
  });

  describe('arrays', () => {
    it('truncates arrays beyond 20 elements', () => {
      const arr = Array.from({ length: 25 }, (_, i) => i);
      const result = sanitizer.process(makeEntry({ items: arr }));
      const items = result.data!.items as unknown[];
      expect(items.length).toBe(21); // 20 elements + truncation message
      expect(items[20]).toBe('[...5 more]');
    });
  });

  describe('error sanitization', () => {
    it('preserves error stacks', () => {
      const result = sanitizer.process(
        makeEntry(undefined, {
          message: 'something failed',
          stack: 'Error: something failed\n    at foo.ts:10',
          code: 'ERR_FAIL',
        })
      );
      expect(result.error!.stack).toContain('foo.ts:10');
      expect(result.error!.code).toBe('ERR_FAIL');
    });

    it('truncates long error messages', () => {
      const result = sanitizer.process(
        makeEntry(undefined, {
          message: 'x'.repeat(600),
        })
      );
      expect(result.error!.message).toContain('...[truncated]');
    });

    it('redacts token=value patterns in error messages (RFC §6.2)', () => {
      const result = sanitizer.process(
        makeEntry(undefined, {
          message: 'Auth failed: token=abc123xyz for user',
        })
      );
      expect(result.error!.message).not.toContain('abc123xyz');
      expect(result.error!.message).toContain('token=[REDACTED]');
    });

    it('redacts key=value and password: value patterns in error messages', () => {
      const r1 = sanitizer.process(
        makeEntry(undefined, { message: 'invalid key=supersecret supplied' })
      );
      expect(r1.error!.message).not.toContain('supersecret');

      const r2 = sanitizer.process(
        makeEntry(undefined, { message: 'bad password: "hunter2" rejected' })
      );
      expect(r2.error!.message).not.toContain('hunter2');
    });

    it('preserves benign error messages unchanged', () => {
      const result = sanitizer.process(
        makeEntry(undefined, {
          message: 'File not found at /home/user/project/src/foo.ts:42',
        })
      );
      expect(result.error!.message).toContain('File not found');
      expect(result.error!.message).toContain('foo.ts:42');
    });
  });

  describe('custom sanitizer', () => {
    it('supports extra sensitive keys', () => {
      const custom = new Sanitizer({ extraSensitiveKeys: ['sessionId', 'machineId'] });
      const result = custom.process(makeEntry({ sessionId: 'abc', machineId: 'def', safe: 'ok' }));
      expect(result.data!.sessionId).toBe('[REDACTED]');
      expect(result.data!.machineId).toBe('[REDACTED]');
      expect(result.data!.safe).toBe('ok');
    });

    it('supports custom max string length', () => {
      const custom = new Sanitizer({ maxStringLength: 10 });
      const result = custom.process(makeEntry({ value: 'a'.repeat(20) }));
      const val = result.data!.value as string;
      expect(val).toBe('aaaaaaaaaa...[truncated]');
    });
  });

  it('does not mutate the original entry', () => {
    const original = makeEntry({ token: 'secret' });
    sanitizer.process(original);
    expect(original.data!.token).toBe('secret');
  });
});
