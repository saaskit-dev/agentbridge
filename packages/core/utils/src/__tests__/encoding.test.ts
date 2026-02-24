import { describe, it, expect } from 'vitest';
import {
  decodeBase64,
  encodeBase64,
  decodeHex,
  encodeHex,
  encodeUTF8,
  decodeUTF8,
  normalizeNFKD,
} from '../encoding';

describe('encoding utilities', () => {
  describe('Base64', () => {
    it('encodes and decodes correctly', () => {
      const input = new TextEncoder().encode('Hello, World!');
      const encoded = encodeBase64(input);
      const decoded = decodeBase64(encoded);

      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
      expect(decoded).toEqual(input);
    });

    it('encodes empty data', () => {
      const input = new Uint8Array(0);
      const encoded = encodeBase64(input);
      const decoded = decodeBase64(encoded);

      expect(encoded).toBe('');
      expect(decoded).toEqual(input);
    });

    it('handles binary data', () => {
      const input = new Uint8Array([0, 255, 128, 64, 32]);
      const encoded = encodeBase64(input);
      const decoded = decodeBase64(encoded);

      expect(decoded).toEqual(input);
    });

    describe('base64url variant', () => {
      it('replaces + with - and / with _', () => {
        // Data that would produce + and / in standard base64
        const input = new Uint8Array([0xfb, 0xff, 0xbf]);
        const encoded = encodeBase64(input, 'base64url');

        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).toContain('-');
        expect(encoded).toContain('_');
      });

      it('removes padding', () => {
        const input = new TextEncoder().encode('test');
        const encoded = encodeBase64(input, 'base64url');

        expect(encoded).not.toContain('=');
      });

      it('decodes base64url correctly', () => {
        const input = new TextEncoder().encode('Hello, World!');
        const encoded = encodeBase64(input, 'base64url');
        const decoded = decodeBase64(encoded, 'base64url');

        expect(decoded).toEqual(input);
      });

      it('decodes base64url without padding', () => {
        // "Hello, World!" in base64url without padding
        const decoded = decodeBase64('SGVsbG8sIFdvcmxkIQ', 'base64url');
        expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
      });
    });
  });

  describe('Hex', () => {
    it('encodes and decodes correctly', () => {
      const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const encoded = encodeHex(input);
      const decoded = decodeHex(encoded);

      expect(encoded).toBe('48656c6c6f');
      expect(decoded).toEqual(input);
    });

    it('handles uppercase and lowercase', () => {
      const decoded1 = decodeHex('48656C6C6F');
      const decoded2 = decodeHex('48656c6c6f');

      expect(decoded1).toEqual(decoded2);
    });

    it('ignores colons (MAC address format)', () => {
      const decoded = decodeHex('48:65:6c:6c:6f');
      expect(new TextDecoder().decode(decoded)).toBe('Hello');
    });

    it('ignores spaces', () => {
      const decoded = decodeHex('48 65 6c 6c 6f');
      expect(new TextDecoder().decode(decoded)).toBe('Hello');
    });

    describe('MAC format output', () => {
      it('formats with colons', () => {
        const input = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
        const encoded = encodeHex(input, 'mac');

        expect(encoded).toBe('aa:bb:cc:dd:ee:ff');
      });
    });
  });

  describe('UTF-8', () => {
    it('encodes string to UTF-8 bytes', () => {
      const encoded = encodeUTF8('Hello');
      expect(encoded).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it('decodes UTF-8 bytes to string', () => {
      const decoded = decodeUTF8(new Uint8Array([72, 101, 108, 108, 111]));
      expect(decoded).toBe('Hello');
    });

    it('handles Unicode characters', () => {
      const input = '你好世界 🌍';
      const encoded = encodeUTF8(input);
      const decoded = decodeUTF8(encoded);

      expect(decoded).toBe(input);
    });

    it('handles emoji', () => {
      const input = '😀🎉🚀';
      const encoded = encodeUTF8(input);
      const decoded = decodeUTF8(encoded);

      expect(decoded).toBe(input);
    });

    it('handles empty string', () => {
      const encoded = encodeUTF8('');
      const decoded = decodeUTF8(encoded);

      expect(encoded).toEqual(new Uint8Array(0));
      expect(decoded).toBe('');
    });
  });

  describe('Normalize NFKD', () => {
    it('normalizes composed characters', () => {
      // é can be represented as single character or e + combining accent
      const normalized = normalizeNFKD('é');
      expect(normalized).toBe('e\u0301');
    });

    it('normalizes fullwidth characters', () => {
      // Fullwidth ASCII to normal ASCII
      const normalized = normalizeNFKD('ＡＢＣ');
      expect(normalized).toBe('ABC');
    });
  });

  describe('Round-trip encoding', () => {
    it('can round-trip through base64', () => {
      const original = 'Test string with special chars: !@#$%^&*()';
      const encoded = encodeBase64(encodeUTF8(original));
      const decoded = decodeUTF8(decodeBase64(encoded));

      expect(decoded).toBe(original);
    });

    it('can round-trip through hex', () => {
      const original = 'Test string for hex';
      const encoded = encodeHex(encodeUTF8(original));
      const decoded = decodeUTF8(decodeHex(encoded));

      expect(decoded).toBe(original);
    });
  });
});
