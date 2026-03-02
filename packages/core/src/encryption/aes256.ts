import type { Encryptor, Decryptor } from './types';
import { createCrypto } from '../interfaces/crypto';

export class AES256Encryption implements Encryptor, Decryptor {
  private readonly secretKey: Uint8Array;
  private readonly crypto: ReturnType<typeof createCrypto>;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error('AES-256 key must be 32 bytes');
    }
    this.secretKey = secretKey;
    this.crypto = createCrypto('node');
  }

  async encrypt(data: unknown[]): Promise<Uint8Array[]> {
    const results: Uint8Array[] = [];
    for (const item of data) {
      const json = JSON.stringify(item);
      const plaintext = new TextEncoder().encode(json);
      const encrypted = this.crypto.encryptAesGcm(plaintext, this.secretKey);
      results.push(encrypted.ciphertext);
    }
    return results;
  }

  async decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
    const results: (unknown | null)[] = [];
    for (const item of data) {
      try {
        if (item.length < 1 || item[0] !== 0) {
          results.push(null);
          continue;
        }
        const decrypted = this.crypto.decryptAesGcm(
          { ciphertext: item, nonce: new Uint8Array(0) },
          this.secretKey
        );
        if (!decrypted) {
          results.push(null);
          continue;
        }
        const text = new TextDecoder().decode(decrypted);
        results.push(JSON.parse(text));
      } catch {
        results.push(null);
      }
    }
    return results;
  }
}
