import { describe, expect, it } from 'vitest';
import { resolveLocalMarkdownImagePath } from './markdownImageSource';

describe('resolveLocalMarkdownImagePath', () => {
  it('resolves absolute local image paths without markdown file context', () => {
    expect(resolveLocalMarkdownImagePath('/Users/dev/project/docs/screenshot.png')).toBe(
      '/Users/dev/project/docs/screenshot.png'
    );
  });

  it('resolves relative image paths against markdown file path', () => {
    expect(
      resolveLocalMarkdownImagePath(
        './images/screenshot.png',
        '/Users/dev/project/docs/readme.md'
      )
    ).toBe('/Users/dev/project/docs/images/screenshot.png');
  });

  it('keeps file URLs as absolute local paths', () => {
    expect(resolveLocalMarkdownImagePath('file:///Users/dev/project/docs/screenshot.png')).toBe(
      '/Users/dev/project/docs/screenshot.png'
    );
  });

  it('returns null for relative paths without markdown file context', () => {
    expect(resolveLocalMarkdownImagePath('./images/screenshot.png')).toBeNull();
  });
});
