/**
 * Node.js crypto implementation - based on free/cli actual implementation
 * 
 * Uses:
 * - node:crypto for AES-256-GCM
 * - tweetnacl for NaCl primitives (secretbox, box, sign)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import type { ICrypto, EncryptedData, KeyPair } from '../../interfaces/crypto';
import { registerCryptoFactory } from '../../interfaces/crypto';

/**
 * Node.js crypto implementation
 */
class NodeCrypto implements ICrypto {
  // === Random bytes ===

  getRandomBytes(size: number): Uint8Array {
    return new Uint8Array(randomBytes(size));
  }

  // === Legacy mode (tweetnacl) ===

  secretbox(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
    return tweetnacl.secretbox(plaintext, nonce, key);
  }

  secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null {
    return tweetnacl.secretbox.open(ciphertext, nonce, key);
  }

  boxKeyPair(): KeyPair {
    const pair = tweetnacl.box.keyPair();
    return {
      publicKey: new Uint8Array(pair.publicKey),
      secretKey: new Uint8Array(pair.secretKey),
    };
  }

  box(
    plaintext: Uint8Array,
    nonce: Uint8Array,
    peerPublicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array {
    return tweetnacl.box(plaintext, nonce, peerPublicKey, secretKey);
  }

  boxOpen(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    peerPublicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null {
    return tweetnacl.box.open(ciphertext, nonce, peerPublicKey, secretKey);
  }

  boxSeal(plaintext: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
    // Generate ephemeral keypair
    const ephemeralKeyPair = tweetnacl.box.keyPair();

    // Generate random nonce
    const nonce = this.getRandomBytes(tweetnacl.box.nonceLength);

    // Encrypt using box
    const encrypted = tweetnacl.box(plaintext, nonce, peerPublicKey, ephemeralKeyPair.secretKey);

    // Bundle: ephemeral public key (32) + nonce (24) + encrypted
    const result = new Uint8Array(
      ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length
    );
    result.set(ephemeralKeyPair.publicKey, 0);
    result.set(nonce, ephemeralKeyPair.publicKey.length);
    result.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

    return result;
  }

  boxSealOpen(
    ciphertext: Uint8Array,
    _publicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null {
    if (ciphertext.length < 32 + 24) {
      return null;
    }

    // Extract ephemeral public key and nonce
    const ephemeralPublicKey = ciphertext.slice(0, 32);
    const nonce = ciphertext.slice(32, 32 + 24);
    const encrypted = ciphertext.slice(32 + 24);

    return tweetnacl.box.open(encrypted, nonce, ephemeralPublicKey, secretKey);
  }

  // === DataKey mode (AES-256-GCM) ===
  // Binary format: [ version(1)=0 | nonce(12) | ciphertext | authTag(16) ]

  encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): EncryptedData {
    const nonce = this.getRandomBytes(12); // GCM uses 12-byte nonces
    const cipher = createCipheriv('aes-256-gcm', key, nonce);

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Pack into binary format
    const bundle = new Uint8Array(1 + 12 + encrypted.length + 16);
    bundle.set([0], 0); // version = 0
    bundle.set(nonce, 1);
    bundle.set(new Uint8Array(encrypted), 13);
    bundle.set(tag, 13 + encrypted.length);

    return {
      ciphertext: bundle,
      nonce: new Uint8Array(0), // nonce is embedded in bundle
      tag: new Uint8Array(0),   // tag is embedded in bundle
    };
  }

  decryptAesGcm(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null {
    const bundle = encrypted.ciphertext;
    
    // Validate bundle format
    if (bundle.length < 1 + 12 + 16 || bundle[0] !== 0) {
      return null;
    }

    const nonce = bundle.slice(1, 13);
    const authTag = bundle.slice(bundle.length - 16);
    const ciphertext = bundle.slice(13, bundle.length - 16);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return new Uint8Array(decrypted);
    } catch {
      return null;
    }
  }

  // === Ed25519 signatures ===

  signKeyPairFromSeed(seed: Uint8Array): KeyPair {
    // tweetnacl expects 32-byte seed for Ed25519
    // tweetnacl expects 32-byte seed for Ed25519
    const pair = tweetnacl.sign.keyPair.fromSeed(seed);
    return {
      publicKey: new Uint8Array(pair.publicKey),
      secretKey: new Uint8Array(pair.secretKey),
    };
  }

  signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return tweetnacl.sign.detached(message, secretKey);
  }

  verifyDetached(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    return tweetnacl.sign.detached.verify(message, signature, publicKey);
  }

  // === Authentication ===

  authChallenge(secret: Uint8Array): { challenge: Uint8Array; publicKey: Uint8Array; signature: Uint8Array } {
    const keypair = this.signKeyPairFromSeed(secret);
    const challenge = this.getRandomBytes(32);
    const signature = this.signDetached(challenge, keypair.secretKey);

    return {
      challenge,
      publicKey: keypair.publicKey,
      signature,
    };
  }
}

// Register factory
registerCryptoFactory('node', () => new NodeCrypto());

// Export for direct use
export { NodeCrypto };
