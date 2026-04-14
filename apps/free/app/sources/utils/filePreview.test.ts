import { describe, expect, it } from 'vitest';
import { detectImageMimeType, getPathExtension, getPreviewKind } from './filePreview';

describe('filePreview', () => {
  it('classifies png paths as image previews', () => {
    expect(getPreviewKind('/Users/dev/project/freeproxy-overview-running-after-click.png')).toBe(
      'image'
    );
  });

  it('detects png bytes even without an image extension', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageMimeType('/tmp/blob', pngHeader)).toBe('image/png');
  });

  it('detects webp bytes without relying on file extension', () => {
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageMimeType('/tmp/blob', webpHeader)).toBe('image/webp');
  });

  it('parses extension from file name only when parent directories contain dots', () => {
    expect(getPathExtension('/Users/dev/.config/project/foo')).toBeNull();
    expect(getPathExtension('/Users/dev/.config/project/config.yaml')).toBe('yaml');
  });

  it('handles dotfiles extension correctly', () => {
    expect(getPathExtension('/Users/dev/project/.easignore')).toBe('easignore');
  });
});
