/**
 * SecretBox Encryption (NaCl secretbox)
 *
 * Uses tweetnacl secretbox for symmetric encryption.
 * Layout: [ nonce(24) | ciphertext+tag ]
 */

import { createCrypto } from '../interfaces/crypto';
import type { Encryptor, Decryptor } from './types';

/**
 * SecretBox encryption using NaCl secretbox
 */
export class SecretBoxEncryption implements Encryptor, Decryptor {
  private readonly secretKey: Uint8Array;
  private readonly crypto: ReturnType<typeof createCrypto>;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error('Secret key must be 32 bytes');
    }
    this.secretKey = secretKey;
    this.crypto = createCrypto('node');
  }

  async decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
    const results: (unknown | null)[] = [];
    for (const item of data) {
      try {
        // Extract nonce (first 24 bytes) and ciphertext
        if (item.length < 24) {
          results.push(null);
          continue;
        }
        const nonce = item.slice(0, 24);
        const ciphertext = item.slice(24);

        const decrypted = this.crypto.secretboxOpen(ciphertext, nonce, this.secretKey);
        if (!decrypted) {
          results.push(null);
          continue;
        }

        // Parse JSON
        const text = new TextDecoder().decode(decrypted);
        results.push(JSON.parse(text));
      } catch {
        results.push(null);
      }
    }
    return results;
  }

  async encrypt(data: unknown[]): Promise<Uint8Array[]> {
    const results: Uint8Array[] = [];
    for (const item of data) {
      // Serialize to JSON
      const json = JSON.stringify(item);
      const plaintext = new TextEncoder().encode(json);

      // Generate nonce
      const nonce = this.crypto.getRandomBytes(24);

      // Encrypt
      const ciphertext = this.crypto.secretbox(plaintext, nonce, this.secretKey);

      // Combine: [ nonce | ciphertext ]
      const result = new Uint8Array(24 + ciphertext.length);
      result.set(nonce, 0);
      result.set(ciphertext, 24);

      results.push(result);
    }
    return results;
  }
}
