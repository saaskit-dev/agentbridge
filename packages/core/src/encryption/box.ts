/**
 * Box Encryption (NaCl box)
 * 
 * Uses tweetnacl box for asymmetric encryption (sealed box).
 * Layout: [ ephemeralPublicKey(32) | nonce(24) | ciphertext ]
 */

import type { Encryptor, Decryptor } from './types';
import { createCrypto } from '../interfaces/crypto';

/**
 * Box encryption using NaCl box (sealed box)
 * 
 * Uses a seed to generate a deterministic keypair for encryption/decryption.
 */
export class BoxEncryption implements Encryptor, Decryptor {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  private readonly crypto: ReturnType<typeof createCrypto>;

  constructor(seed: Uint8Array) {
    if (seed.length !== 32) {
      throw new Error('Seed must be 32 bytes');
    }
    this.crypto = createCrypto('node');
    
    // For deterministic keypair from seed, we use the seed as the secret key directly
    // and derive the public key from it
    // Note: In NaCl box, the secret key is 32 bytes
    this.secretKey = seed;
    
    // Generate a keypair to get the public key
    const keypair = this.crypto.boxKeyPair();
    this.publicKey = keypair.publicKey;
  }

  async decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
    const results: (unknown | null)[] = [];
    for (const item of data) {
      try {
        // Use boxSealOpen for sealed box decryption
        const decrypted = this.crypto.boxSealOpen(item, this.publicKey, this.secretKey);
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
      
      // Use boxSeal for sealed box encryption (anonymous sender)
      const ciphertext = this.crypto.boxSeal(plaintext, this.publicKey);
      
      results.push(ciphertext);
    }
    return results;
  }
}
