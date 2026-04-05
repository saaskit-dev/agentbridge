import { describe, expect, it } from 'vitest';
import { normalizePosixPath } from './sessionFilePath';

describe('sessionFilePath', () => {
  describe('normalizePosixPath', () => {
    it('returns the root path when an absolute path collapses to empty', () => {
      expect(normalizePosixPath('/')).toBe('/');
      expect(normalizePosixPath('////')).toBe('/');
      expect(normalizePosixPath('/foo/..')).toBe('/');
    });

    it('normalizes absolute paths without changing non-root results', () => {
      expect(normalizePosixPath('/foo//bar/./baz')).toBe('/foo/bar/baz');
      expect(normalizePosixPath('/foo/bar/../baz')).toBe('/foo/baz');
    });
  });
});
