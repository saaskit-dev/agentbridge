import { describe, expect, it } from 'vitest';

const { generateReleaseStamp, generateTimeVersion: generateReleaseTimeVersion } = require('./releaseTime.js') as {
  generateReleaseStamp: (date?: Date, timeZone?: string) => string;
  generateTimeVersion: (date?: Date, timeZone?: string) => string;
};

const { bumpVersion, extractExplicitVersion, resolveVersionCommand } = require('./version.js') as {
  bumpVersion: (version: string, type: 'patch' | 'minor' | 'major') => string;
  extractExplicitVersion: (input: string) => string | null;
  resolveVersionCommand: (
    args: string[]
  ) => { target: 'app' | 'desktop'; value: string | null; explicitTarget: boolean };
};

describe('scripts/version.js', () => {
  describe('resolveVersionCommand', () => {
    it('defaults bare commands to the app target', () => {
      expect(resolveVersionCommand(['patch'])).toEqual({
        target: 'app',
        value: 'patch',
        explicitTarget: false,
      });
      expect(resolveVersionCommand(['0.0.17'])).toEqual({
        target: 'app',
        value: '0.0.17',
        explicitTarget: false,
      });
    });

    it('keeps desktop commands isolated', () => {
      expect(resolveVersionCommand(['desktop', 'patch'])).toEqual({
        target: 'desktop',
        value: 'patch',
        explicitTarget: true,
      });
      expect(resolveVersionCommand(['desktop', '0.0.17'])).toEqual({
        target: 'desktop',
        value: '0.0.17',
        explicitTarget: true,
      });
    });
  });

  describe('extractExplicitVersion', () => {
    it('accepts a standalone semver', () => {
      expect(extractExplicitVersion('0.0.17')).toBe('0.0.17');
    });

    it('extracts semver from labeled release text', () => {
      expect(extractExplicitVersion('Version: 0.0.17')).toBe('0.0.17');
      expect(extractExplicitVersion('release version v0.0.17')).toBe('0.0.17');
      expect(extractExplicitVersion('android-v0.0.17')).toBe('0.0.17');
    });

    it('rejects invalid version text', () => {
      expect(extractExplicitVersion('Version: latest')).toBeNull();
      expect(extractExplicitVersion('0.0')).toBeNull();
    });
  });

  describe('bumpVersion', () => {
    it('increments patch, minor, and major versions', () => {
      expect(bumpVersion('0.0.17', 'patch')).toBe('0.0.18');
      expect(bumpVersion('0.0.17', 'minor')).toBe('0.1.0');
      expect(bumpVersion('0.0.17', 'major')).toBe('1.0.0');
    });
  });

  describe('time-based versions', () => {
    it('generates a semver-compatible release version from time', () => {
      const fixedDate = new Date('2026-04-17T01:23:45.000Z');
      expect(generateReleaseStamp(fixedDate, 'UTC')).toBe('20260417-012345');
      expect(generateReleaseStamp(fixedDate, 'Asia/Shanghai')).toBe('20260417-092345');
      expect(generateReleaseTimeVersion(fixedDate, 'UTC')).toBe('2026.4.17012345');
      expect(generateReleaseTimeVersion(fixedDate, 'Asia/Shanghai')).toBe('2026.4.17092345');
    });
  });
});
