import { describe, it, expect } from 'vitest';
import { MessageQueue, SimpleMessageQueue } from '../queue';

describe('MessageQueue', () => {
  describe('basic operations', () => {
    it('pushes and retrieves messages', async () => {
      interface Mode {
        permissionMode: string;
      }

      const queue = new MessageQueue<Mode>((mode) =>
        JSON.stringify({ permissionMode: mode.permissionMode })
      );

      queue.push('Hello', { permissionMode: 'default' });

      const result = await queue.waitForMessagesAndGetAsString();
      expect(result).not.toBeNull();
      expect(result?.message).toBe('Hello');
      expect(result?.mode.permissionMode).toBe('default');
    });

    it('returns queue size', () => {
      const queue = new MessageQueue<unknown>(() => '');
      expect(queue.size()).toBe(0);

      queue.push('msg1', {});
      expect(queue.size()).toBe(1);

      queue.push('msg2', {});
      expect(queue.size()).toBe(2);
    });

    it('checks if empty', () => {
      const queue = new MessageQueue<unknown>(() => '');
      expect(queue.isEmpty()).toBe(true);

      queue.push('msg', {});
      expect(queue.isEmpty()).toBe(false);
    });

    it('clears all messages', () => {
      const queue = new MessageQueue<unknown>(() => '');
      queue.push('msg1', {});
      queue.push('msg2', {});

      queue.clear();
      expect(queue.isEmpty()).toBe(true);
    });

    it('peeks at next message', () => {
      const queue = new MessageQueue<unknown>(() => '');
      queue.push('first', {});
      queue.push('second', {});

      const peeked = queue.peek();
      expect(peeked?.message).toBe('first');
      expect(queue.size()).toBe(2); // Not removed
    });
  });

  describe('mode isolation', () => {
    interface Mode {
      permissionMode: string;
      model?: string;
    }

    it('computes mode hash', () => {
      const queue = new MessageQueue<Mode>((mode) =>
        JSON.stringify({ permissionMode: mode.permissionMode, model: mode.model })
      );

      queue.push('msg1', { permissionMode: 'default' });
      const hash = queue.getCurrentModeHash();

      expect(hash).toBe('{"permissionMode":"default"}');
    });

    it('detects mode change', () => {
      const queue = new MessageQueue<Mode>((mode) =>
        JSON.stringify({ permissionMode: mode.permissionMode })
      );

      queue.push('msg1', { permissionMode: 'default' });

      expect(queue.wouldIsolate({ permissionMode: 'default' })).toBe(false);
      expect(queue.wouldIsolate({ permissionMode: 'yolo' })).toBe(true);
    });
  });

  describe('queue limits', () => {
    it('respects max size', () => {
      const queue = new MessageQueue<unknown>(() => '', { maxSize: 3 });

      queue.push('msg1', {});
      queue.push('msg2', {});
      queue.push('msg3', {});
      queue.push('msg4', {}); // Should drop oldest

      expect(queue.size()).toBe(3);
      expect(queue.peek()?.message).toBe('msg2');
    });
  });

  describe('abort functionality', () => {
    it('aborts pending wait', async () => {
      const queue = new MessageQueue<unknown>(() => '');

      queue.abort();

      const result = await queue.waitForMessagesAndGetAsString();
      expect(result).toBeNull();
    });

    it('marks queue as aborted', () => {
      const queue = new MessageQueue<unknown>(() => '');
      expect(queue.isAborted()).toBe(false);

      queue.abort();
      expect(queue.isAborted()).toBe(true);
    });

    it('rejects push when aborted', () => {
      const queue = new MessageQueue<unknown>(() => '');
      queue.abort();

      const pushed = queue.push('msg', {});
      expect(pushed).toBe(false);
    });

    it('can be reset after abort', () => {
      const queue = new MessageQueue<unknown>(() => '');
      queue.abort();

      queue.reset();
      expect(queue.isAborted()).toBe(false);

      const pushed = queue.push('msg', {});
      expect(pushed).toBe(true);
    });
  });

  describe('waiting with signal', () => {
    it('respects abort signal', async () => {
      const queue = new MessageQueue<unknown>(() => '');
      const controller = new AbortController();

      controller.abort();

      const result = await queue.waitForMessagesAndGetAsString(controller.signal);
      expect(result).toBeNull();
    });
  });
});

describe('SimpleMessageQueue', () => {
  it('pushes and waits for messages', async () => {
    const queue = new SimpleMessageQueue();

    queue.push('hello');
    const result = await queue.wait();

    expect(result).toBe('hello');
  });

  it('returns size', () => {
    const queue = new SimpleMessageQueue();
    expect(queue.size()).toBe(0);

    queue.push('msg');
    expect(queue.size()).toBe(1);
  });

  it('clears queue', () => {
    const queue = new SimpleMessageQueue();
    queue.push('msg');

    queue.clear();
    expect(queue.size()).toBe(0);
  });

  it('aborts queue', async () => {
    const queue = new SimpleMessageQueue();

    queue.abort();

    const result = await queue.wait();
    expect(result).toBeNull();
  });
});
