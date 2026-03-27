/**
 * DiscoveredAcpBackendBase.buildPrompt() unit tests
 *
 * Tests prompt block construction:
 *   - Text-only prompt
 *   - First message gets CHANGE_TITLE_INSTRUCTION appended
 *   - Subsequent messages do not
 *   - Attachment blocks come before text block
 *   - resource_link block has correct uri / mimeType / name fields
 *   - Mixed (attachments + text) produces correct block order
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy deps we don't need for buildPrompt
// ---------------------------------------------------------------------------

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

vi.mock('@saaskit-dev/agentbridge', () => ({
  safeStringify: (v: unknown) => String(v),
}));

vi.mock('@/telemetry', () => ({
  setAcpSessionId: vi.fn(),
}));

vi.mock('@/backends/acp/mapAcpSessionCapabilities', () => ({
  applyCapabilitySelection: vi.fn(),
  getModeConfigOptionId: vi.fn(),
  getModelConfigOptionId: vi.fn(),
  mapAcpSessionCapabilities: vi.fn(() => ({})),
  mergeAcpSessionCapabilities: vi.fn(() => ({})),
}));

vi.mock('@/backends/acp/createFreeMcpServerConfig', () => ({
  createFreeMcpServerConfig: vi.fn(() => ({ command: 'node', args: [] })),
}));

vi.mock('@/backends/acp/modelSelection', () => ({
  getDefaultDiscoveredModelId: vi.fn(() => null),
  hasDiscoveredModel: vi.fn(() => false),
}));

vi.mock('@/backends/acp/AcpPermissionHandler', () => ({
  AcpPermissionHandler: class {
    constructor() {}
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DiscoveredAcpBackendBase } from './DiscoveredAcpBackendBase';
import type { AgentMessage } from '@/agent';
import type { NormalizedMessage } from '@/daemon/sessions/types';
import type { LocalAttachment } from '@/daemon/sessions/AgentBackend';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing
// ---------------------------------------------------------------------------

class TestAcpBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'gemini' as const;

  protected createAcpBackend(): never {
    throw new Error('not used in tests');
  }

  protected mapRawMessage(_msg: AgentMessage): NormalizedMessage | null {
    return null;
  }

  /** Expose buildPrompt for direct testing */
  testBuildPrompt(text: string, attachments?: LocalAttachment[]) {
    return this.buildPrompt(text, attachments);
  }

  /** Expose isFirstMessage for test setup */
  setIsFirstMessage(value: boolean) {
    this.isFirstMessage = value;
  }
}

function makeBackend(): TestAcpBackend {
  return new TestAcpBackend(new Logger('test'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoveredAcpBackendBase.buildPrompt()', () => {
  it('returns a single text block when no attachments', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const blocks = backend.testBuildPrompt('hello world');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'hello world' });
  });

  it('appends CHANGE_TITLE_INSTRUCTION on first message', () => {
    const backend = makeBackend();
    // isFirstMessage defaults to true
    const blocks = backend.testBuildPrompt('initial prompt');

    const textBlock = blocks.find(b => b.type === 'text') as { type: 'text'; text: string };
    expect(textBlock.text).toContain('initial prompt');
    expect(textBlock.text).toContain('change_title');
  });

  it('does not append CHANGE_TITLE_INSTRUCTION on subsequent messages', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const blocks = backend.testBuildPrompt('follow-up');

    const textBlock = blocks.find(b => b.type === 'text') as { type: 'text'; text: string };
    expect(textBlock.text).toBe('follow-up');
    expect(textBlock.text).not.toContain('change_title');
  });

  it('places resource_link blocks before the text block', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const attachments: LocalAttachment[] = [
      { localPath: '/tmp/free/attachments/abc123.jpg', mimeType: 'image/jpeg' },
    ];
    const blocks = backend.testBuildPrompt('describe this image', attachments);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('resource_link');
    expect(blocks[1].type).toBe('text');
  });

  it('builds resource_link block with correct uri, mimeType, and name', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const attachments: LocalAttachment[] = [
      { localPath: '/home/user/.free/attachments/aabbccdd.png', mimeType: 'image/png' },
    ];
    const [block] = backend.testBuildPrompt('look', attachments);

    expect(block).toMatchObject({
      type: 'resource_link',
      uri: 'file:///home/user/.free/attachments/aabbccdd.png',
      mimeType: 'image/png',
      name: 'aabbccdd.png',
    });
  });

  it('produces one resource_link per attachment', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const attachments: LocalAttachment[] = [
      { localPath: '/tmp/a.jpg', mimeType: 'image/jpeg' },
      { localPath: '/tmp/b.png', mimeType: 'image/png' },
      { localPath: '/tmp/c.webp', mimeType: 'image/webp' },
    ];
    const blocks = backend.testBuildPrompt('three images', attachments);

    const resourceBlocks = blocks.filter(b => b.type === 'resource_link');
    expect(resourceBlocks).toHaveLength(3);
    expect(blocks[blocks.length - 1].type).toBe('text');
  });

  it('handles empty attachments array the same as no attachments', () => {
    const backend = makeBackend();
    backend.setIsFirstMessage(false);

    const blocksNone = backend.testBuildPrompt('text');
    const blocksEmpty = backend.testBuildPrompt('text', []);

    expect(blocksNone).toEqual(blocksEmpty);
  });
});
