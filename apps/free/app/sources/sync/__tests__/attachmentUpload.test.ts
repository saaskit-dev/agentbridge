import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockHasImageAsync = vi.fn<() => Promise<boolean>>();
const mockGetImageAsync = vi.fn<(opts: any) => Promise<{ data: string; size: { width: number; height: number } } | null>>();

vi.mock('expo-clipboard', () => ({
  hasImageAsync: () => mockHasImageAsync(),
  getImageAsync: (opts: any) => mockGetImageAsync(opts),
}));

// Default: web platform. Individual tests override via `mockPlatformOS`.
let currentPlatformOS = 'web';
vi.mock('react-native', () => ({
  Platform: new Proxy(
    {},
    { get: (_t, prop) => (prop === 'OS' ? currentPlatformOS : undefined) }
  ),
}));
function mockPlatformOS(os: string) {
  currentPlatformOS = os;
}

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
}));

vi.mock('expo-file-system', () => ({
  File: vi.fn(),
  Paths: { cache: '/cache' },
}));

vi.mock('../apiSocket', () => ({
  apiSocket: {
    getStatus: () => 'connected',
    emitWithAckTimeout: vi.fn(),
  },
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => {
  const noop = () => {};
  return {
    Logger: vi.fn().mockImplementation(() => ({
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    })),
    toError: (e: unknown) => e,
  };
});

import { hasClipboardImage, getClipboardImage } from '../attachmentUpload';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasClipboardImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformOS('web');
  });

  describe('web', () => {
    it('returns true when clipboard has an image', async () => {
      mockHasImageAsync.mockResolvedValue(true);
      expect(await hasClipboardImage()).toBe(true);
    });

    it('returns false when clipboard has no image', async () => {
      mockHasImageAsync.mockResolvedValue(false);
      expect(await hasClipboardImage()).toBe(false);
    });

    it('returns false when hasImageAsync throws', async () => {
      mockHasImageAsync.mockRejectedValue(new Error('permission denied'));
      expect(await hasClipboardImage()).toBe(false);
    });
  });

  describe('native (ios/android)', () => {
    it('always returns true on native — defers to getClipboardImage for actual check', async () => {
      mockPlatformOS('ios');
      // Even if hasImageAsync would return false, native always returns true
      mockHasImageAsync.mockResolvedValue(false);
      expect(await hasClipboardImage()).toBe(true);
      // hasImageAsync should NOT have been called
      expect(mockHasImageAsync).not.toHaveBeenCalled();
    });
  });
});

describe('getClipboardImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformOS('web');
  });

  it('returns ClipboardImageInput when clipboard has an image', async () => {
    mockGetImageAsync.mockResolvedValue({
      data: 'data:image/png;base64,iVBOR',
      size: { width: 800, height: 600 },
    });

    const result = await getClipboardImage();
    expect(result).toEqual({
      uri: 'data:image/png;base64,iVBOR',
      mimeType: 'image/png',
      width: 800,
      height: 600,
    });
    expect(mockGetImageAsync).toHaveBeenCalledWith({ format: 'png' });
  });

  it('returns null when getImageAsync returns null', async () => {
    mockGetImageAsync.mockResolvedValue(null);
    expect(await getClipboardImage()).toBeNull();
  });

  it('returns null when getImageAsync returns empty data', async () => {
    mockGetImageAsync.mockResolvedValue({
      data: '',
      size: { width: 0, height: 0 },
    });
    expect(await getClipboardImage()).toBeNull();
  });

  it('returns null when getImageAsync throws (no image in clipboard)', async () => {
    mockGetImageAsync.mockRejectedValue(new Error('no image in clipboard'));
    expect(await getClipboardImage()).toBeNull();
  });
});
