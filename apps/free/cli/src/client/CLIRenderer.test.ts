import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIRenderer } from './CLIRenderer';
import type { NormalizedMessage } from '@/daemon/sessions/types';

// Intercept stdout and stderr writes
let stdoutChunks: string[];
let stderrChunks: string[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stdoutSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stderrSpy: any;

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function stdoutText(): string {
  return stdoutChunks.join('');
}

function stderrText(): string {
  return stderrChunks.join('');
}

function makeMsg(
  partial: Partial<NormalizedMessage> & Pick<NormalizedMessage, 'role' | 'content'>
): NormalizedMessage {
  return {
    id: 'test-id',
    createdAt: Date.now(),
    isSidechain: false,
    ...partial,
  } as NormalizedMessage;
}

describe('CLIRenderer', () => {
  describe('render() — user messages', () => {
    it('renders user text with > prefix', () => {
      const renderer = new CLIRenderer();
      renderer.render(makeMsg({ role: 'user', content: { type: 'text', text: 'hello world' } }));
      expect(stdoutText()).toContain('hello world');
      expect(stdoutText()).toContain('>');
    });
  });

  describe('render() — agent messages', () => {
    it('renders text content', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [{ type: 'text', text: 'agent response', uuid: 'u1', parentUUID: null }],
        })
      );
      expect(stdoutText()).toContain('agent response');
    });

    it('renders tool-call with name and input', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [
            {
              type: 'tool-call',
              id: 'tc-1',
              name: 'read_file',
              input: { path: '/tmp/foo' },
              description: null,
              uuid: 'u1',
              parentUUID: null,
            },
          ],
        })
      );
      const out = stdoutText();
      expect(out).toContain('read_file');
      expect(out).toContain('/tmp/foo');
    });

    it('renders tool-result error to stderr', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [
            {
              type: 'tool-result',
              tool_use_id: 'tc-1',
              content: 'file not found',
              is_error: true,
              uuid: 'u1',
              parentUUID: null,
            },
          ],
        })
      );
      expect(stderrText()).toContain('file not found');
    });

    it('renders tool-result success as dimmed preview', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [
            {
              type: 'tool-result',
              tool_use_id: 'tc-1',
              content: 'success output text',
              is_error: false,
              uuid: 'u1',
              parentUUID: null,
            },
          ],
        })
      );
      expect(stdoutText()).toContain('success output text');
    });

    it('hides thinking blocks by default', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [
            { type: 'thinking', thinking: 'secret reasoning', uuid: 'u1', parentUUID: null },
          ],
        })
      );
      expect(stdoutText()).not.toContain('secret reasoning');
    });

    it('shows thinking blocks when showThinking=true', () => {
      const renderer = new CLIRenderer({ showThinking: true });
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [
            { type: 'thinking', thinking: 'visible reasoning', uuid: 'u1', parentUUID: null },
          ],
        })
      );
      expect(stdoutText()).toContain('visible reasoning');
    });

    it('renders summary blocks', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [{ type: 'summary', summary: 'session summary text' }],
        })
      );
      expect(stdoutText()).toContain('session summary text');
    });

    it('renders sidechain blocks', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'agent',
          content: [{ type: 'sidechain', uuid: 'sc-1', prompt: 'sub-agent prompt text' }],
        })
      );
      expect(stdoutText()).toContain('sub-agent prompt text');
    });
  });

  describe('render() — event messages', () => {
    it('renders ready event', () => {
      const renderer = new CLIRenderer();
      renderer.render(makeMsg({ role: 'event', content: { type: 'ready' } }));
      expect(stdoutText()).toContain('ready');
    });

    it('renders switch event', () => {
      const renderer = new CLIRenderer();
      renderer.render(makeMsg({ role: 'event', content: { type: 'switch', mode: 'remote' } }));
      expect(stdoutText()).toContain('remote');
    });

    it('renders limit-reached to stderr', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({ role: 'event', content: { type: 'limit-reached', endsAt: Date.now() + 60000 } })
      );
      expect(stderrText()).toContain('rate limited');
    });

    it('renders message event', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({ role: 'event', content: { type: 'message', message: 'session ended' } })
      );
      expect(stdoutText()).toContain('session ended');
    });

    it('renders status working', () => {
      const renderer = new CLIRenderer();
      renderer.render(makeMsg({ role: 'event', content: { type: 'status', state: 'working' } }));
      expect(stdoutText()).toContain('working');
    });

    it('renders status idle', () => {
      const renderer = new CLIRenderer();
      renderer.render(makeMsg({ role: 'event', content: { type: 'status', state: 'idle' } }));
      expect(stdoutText()).toContain('idle');
    });

    it('hides token_count by default', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'event',
          content: { type: 'token_count', usage: { input_tokens: 100, output_tokens: 50 } },
        })
      );
      expect(stdoutText()).not.toContain('100');
    });

    it('shows token_count when showTokenCount=true', () => {
      const renderer = new CLIRenderer({ showTokenCount: true });
      renderer.render(
        makeMsg({
          role: 'event',
          content: { type: 'token_count', usage: { input_tokens: 100, output_tokens: 50 } },
        })
      );
      const out = stdoutText();
      expect(out).toContain('100');
      expect(out).toContain('50');
    });

    it('renders daemon-log event to stderr', () => {
      const renderer = new CLIRenderer();
      renderer.render(
        makeMsg({
          role: 'event',
          content: {
            type: 'daemon-log',
            level: 'error',
            component: 'test',
            message: 'something broke',
            error: 'something broke',
          },
        })
      );
      expect(stderrText()).toContain('something broke');
    });
  });

  describe('onHistory()', () => {
    it('renders all history messages', () => {
      const renderer = new CLIRenderer();
      const msgs: NormalizedMessage[] = [
        makeMsg({ role: 'user', content: { type: 'text', text: 'msg1' } }),
        makeMsg({
          role: 'agent',
          content: [{ type: 'text', text: 'msg2', uuid: 'u1', parentUUID: null }],
        }),
      ];
      renderer.onHistory(msgs);
      const out = stdoutText();
      expect(out).toContain('msg1');
      expect(out).toContain('msg2');
      expect(out).toContain('resuming');
    });

    it('does not show resuming banner for empty history', () => {
      const renderer = new CLIRenderer();
      renderer.onHistory([]);
      expect(stdoutText()).not.toContain('resuming');
    });
  });

  describe('writePtyData()', () => {
    it('decodes base64 and writes to stdout', () => {
      const renderer = new CLIRenderer();
      const original = 'hello PTY';
      renderer.writePtyData(Buffer.from(original).toString('base64'));
      // stdoutSpy captures the Buffer write; check the raw output
      expect(stdoutSpy).toHaveBeenCalled();
    });
  });
});
