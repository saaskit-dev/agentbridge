import { describe, expect, it, vi } from 'vitest';
import { buildMarkdownViewProps } from './markdownViewProps';

describe('buildMarkdownViewProps', () => {
  it('keeps sessionId on chat markdown so local images can load through session RPC', () => {
    const onOptionPress = vi.fn();

    expect(
      buildMarkdownViewProps(
        '![img](/Users/dev/project/docs/screenshot.png)',
        'session-123',
        onOptionPress
      )
    ).toMatchObject({
      markdown: '![img](/Users/dev/project/docs/screenshot.png)',
      sessionId: 'session-123',
      onOptionPress,
    });
  });
});

