import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from './encryption';
import { randomBytes } from 'node:crypto';

// Test the dev-mode plaintext bypass and production encryption roundtrip.
// configuration.isDev is derived from process.env.APP_ENV at module load time,
// so we must set the env var BEFORE importing configuration.

describe('encrypt/decrypt', () => {
  const legacyKey = randomBytes(32);
  const dataKey = randomBytes(32);

  describe('production mode (APP_ENV unset)', () => {
    it('roundtrips with legacy variant', () => {
      const data = { hello: 'world', num: 42 };
      const encrypted = encrypt(legacyKey, 'legacy', data);
      const result = decrypt(legacyKey, 'legacy', encrypted);
      expect(result).toEqual(data);
    });

    it('roundtrips with dataKey variant', () => {
      const data = { nested: { arr: [1, 2, 3] }, flag: true };
      const encrypted = encrypt(dataKey, 'dataKey', data);
      const result = decrypt(dataKey, 'dataKey', encrypted);
      expect(result).toEqual(data);
    });

    it('returns null for wrong key (legacy)', () => {
      const data = { secret: 'value' };
      const encrypted = encrypt(legacyKey, 'legacy', data);
      const wrongKey = randomBytes(32);
      expect(decrypt(wrongKey, 'legacy', encrypted)).toBeNull();
    });

    it('returns null for wrong key (dataKey)', () => {
      const data = { secret: 'value' };
      const encrypted = encrypt(dataKey, 'dataKey', data);
      const wrongKey = randomBytes(32);
      expect(decrypt(wrongKey, 'dataKey', encrypted)).toBeNull();
    });

    it('encrypted output is not plain JSON', () => {
      const data = { visible: false };
      const encrypted = encrypt(legacyKey, 'legacy', data);
      // First byte should NOT be '{' in production mode
      expect(encrypted[0]).not.toBe(0x7b);
    });
  });

  describe('base64 roundtrip through encrypt → encodeBase64 → decodeBase64 → decrypt', () => {
    it('works end-to-end with legacy variant', () => {
      const data = { msg: 'hello from e2e' };
      const encrypted = encrypt(legacyKey, 'legacy', data);
      const b64 = encodeBase64(encrypted);
      const decoded = decodeBase64(b64);
      const result = decrypt(legacyKey, 'legacy', decoded);
      expect(result).toEqual(data);
    });

    it('works end-to-end with dataKey variant', () => {
      const data = { msg: 'hello from e2e', items: [1, 2] };
      const encrypted = encrypt(dataKey, 'dataKey', data);
      const b64 = encodeBase64(encrypted);
      const decoded = decodeBase64(b64);
      const result = decrypt(dataKey, 'dataKey', decoded);
      expect(result).toEqual(data);
    });
  });
});

describe('encrypt/decrypt dev mode', () => {
  // Dev mode is controlled by configuration.isDev which reads process.env.APP_ENV
  // at module init. We use vi.stubEnv to set the env var and re-import.
  let devEncrypt: typeof encrypt;
  let devDecrypt: typeof decrypt;
  let devEncodeBase64: typeof encodeBase64;
  let devDecodeBase64: typeof decodeBase64;

  beforeEach(async () => {
    vi.stubEnv('APP_ENV', 'development');
    // Force re-evaluation of configuration and encryption modules
    vi.resetModules();
    const mod = await import('./encryption');
    devEncrypt = mod.encrypt;
    devDecrypt = mod.decrypt;
    devEncodeBase64 = mod.encodeBase64;
    devDecodeBase64 = mod.decodeBase64;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const key = randomBytes(32);

  it('encrypt produces plain JSON bytes in dev mode', () => {
    const data = { dev: true, value: 123 };
    const encrypted = devEncrypt(key, 'legacy', data);
    // Should be parseable as JSON
    const text = Buffer.from(encrypted).toString('utf-8');
    expect(JSON.parse(text)).toEqual(data);
  });

  it('decrypt reads plain JSON in dev mode', () => {
    const data = { dev: true, nested: { x: 1 } };
    const encrypted = devEncrypt(key, 'dataKey', data);
    const result = devDecrypt(key, 'dataKey', encrypted);
    expect(result).toEqual(data);
  });

  it('roundtrips through base64 in dev mode', () => {
    const data = { session: 'abc', messages: [1, 2, 3] };
    const encrypted = devEncrypt(key, 'legacy', data);
    const b64 = devEncodeBase64(encrypted);
    const decoded = devDecodeBase64(b64);
    const result = devDecrypt(key, 'legacy', decoded);
    expect(result).toEqual(data);
  });

  it('first byte is 0x7b in dev mode', () => {
    const data = { check: 'first-byte' };
    const encrypted = devEncrypt(key, 'dataKey', data);
    expect(encrypted[0]).toBe(0x7b);
  });
});
