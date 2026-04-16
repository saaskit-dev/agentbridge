import { describe, expect, it } from 'vitest';
import { sanitizeSQLiteParams, serializeCachedContent } from './cacheContent';

describe('serializeCachedContent', () => {
  it('serializes undefined as JSON null', () => {
    expect(serializeCachedContent(undefined)).toBe('null');
  });

  it('serializes null as JSON null', () => {
    expect(serializeCachedContent(null)).toBe('null');
  });

  it('serializes objects unchanged', () => {
    expect(serializeCachedContent({ ok: true })).toBe('{"ok":true}');
  });

  it('sanitizes undefined sqlite params to null', () => {
    expect(sanitizeSQLiteParams(['x', undefined, 1, null])).toEqual(['x', null, 1, null]);
  });
});
