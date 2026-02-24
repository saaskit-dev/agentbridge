/**
 * @agentbridge/crypto-node - libsodium-based Crypto Implementation
 *
 * Implements the ICrypto interface using libsodium-wrappers for Node.js
 *
 * Compatible with free's encryption implementation
 */

import sodium from 'libsodium-wrappers';
import type {
  ICrypto,
  IBox,
  ISecretBox,
  ISign,
  IHash,
  IAES,
  IKDF,
  KeyPair,
  EncryptedData,
} from '@agentbridge/interfaces';
import { getSingleton, getSingletonSync } from '@agentbridge/utils';

// Wait for sodium to be ready
let sodiumReady = false;
const sodiumPromise = sodium.ready.then(() => {
  sodiumReady = true;
});

/**
 * Ensure sodium is ready before use
 */
export async function waitForSodium(): Promise<void> {
  await sodiumPromise;
}

// ============================================================================
// Box Implementation (X25519-XSalsa20-Poly1305)
// ============================================================================

/**
 * Box implementation using NaCl crypto_box
 * Uses anonymous/sealed box pattern for simplified API
 */
export class BoxImpl implements IBox {
  generateKeyPair(): KeyPair {
    const kp = sodium.crypto_box_keypair();
    return {
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    };
  }

  /**
   * Generate a key pair from a seed (32 bytes)
   * Compatible with free/happy implementation
   */
  generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
    const kp = sodium.crypto_box_seed_keypair(seed);
    return {
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    };
  }

  /**
   * Derive public key from private key
   * Note: This expects the actual private key (not seed)
   */
  publicKeyFromSecretKey(privateKey: Uint8Array): Uint8Array {
    return sodium.crypto_scalarmult_base(privateKey);
  }

  /**
   * Encrypt using anonymous box (ephemeral keypair)
   * Format: ephemeralPublicKey (32 bytes) + nonce (24 bytes) + ciphertext
   */
  encrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
    const ephemeralKeyPair = sodium.crypto_box_keypair();
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const encrypted = sodium.crypto_box_easy(
      plaintext,
      nonce,
      recipientPublicKey,
      ephemeralKeyPair.privateKey
    );

    // Bundle: ephemeral public key + nonce + encrypted
    const result = new Uint8Array(
      ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length
    );
    result.set(ephemeralKeyPair.publicKey, 0);
    result.set(nonce, ephemeralKeyPair.publicKey.length);
    result.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

    return result;
  }

  /**
   * Decrypt anonymous box
   */
  decrypt(encryptedBundle: Uint8Array, secretKey: Uint8Array): Uint8Array | null {
    // Extract components
    const ephemeralPublicKey = encryptedBundle.slice(0, sodium.crypto_box_PUBLICKEYBYTES);
    const nonce = encryptedBundle.slice(
      sodium.crypto_box_PUBLICKEYBYTES,
      sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES
    );
    const encrypted = encryptedBundle.slice(
      sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES
    );

    // Derive public key from secret key
    const publicKey = this.publicKeyFromSecretKey(secretKey);

    try {
      return sodium.crypto_box_open_easy(encrypted, nonce, ephemeralPublicKey, secretKey);
    } catch {
      return null;
    }
  }
}

// ============================================================================
// SecretBox Implementation (XSalsa20-Poly1305)
// ============================================================================

/**
 * SecretBox implementation using NaCl crypto_secretbox
 */
export class SecretBoxImpl implements ISecretBox {
  generateKey(): Uint8Array {
    return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  }

  encrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedData {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
    return { ciphertext, nonce };
  }

  decrypt(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null {
    try {
      return sodium.crypto_secretbox_open_easy(encrypted.ciphertext, encrypted.nonce, key);
    } catch {
      return null;
    }
  }

  /**
   * Encrypt and return as bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  encryptToBundle(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
    // Bundle format: nonce + ciphertext
    const result = new Uint8Array(nonce.length + ciphertext.length);
    result.set(nonce, 0);
    result.set(ciphertext, nonce.length);
    return result;
  }

  /**
   * Decrypt from bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  decryptFromBundle(bundle: Uint8Array, key: Uint8Array): Uint8Array | null {
    try {
      const nonce = bundle.slice(0, sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = bundle.slice(sodium.crypto_secretbox_NONCEBYTES);
      return sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Sign Implementation (Ed25519)
// ============================================================================

/**
 * Sign implementation using Ed25519
 */
export class SignImpl implements ISign {
  generateKeyPair(): KeyPair {
    const kp = sodium.crypto_sign_keypair();
    return {
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    };
  }

  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return sodium.crypto_sign_detached(message, secretKey);
  }

  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    try {
      return sodium.crypto_sign_verify_detached(signature, message, publicKey);
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Hash Implementation
// ============================================================================

/**
 * Hash implementation
 */
export class HashImpl implements IHash {
  private crypto = require('crypto');

  sha256(data: Uint8Array): Uint8Array {
    return this.crypto.createHash('sha256').update(data).digest();
  }

  sha512(data: Uint8Array): Uint8Array {
    return this.crypto.createHash('sha512').update(data).digest();
  }

  blake2b(data: Uint8Array, length?: number): Uint8Array {
    // Use sodium's generichash for blake2b
    return sodium.crypto_generichash(length || 32, data);
  }
}

// ============================================================================
// AES-256-GCM Implementation (using WebCrypto)
// ============================================================================

/**
 * AES-256-GCM implementation using Node.js crypto
 */
export class AESImpl implements IAES {
  encryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    const crypto = require('crypto');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Return ciphertext + tag
    return new Uint8Array(Buffer.concat([encrypted, tag]));
  }

  decryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array | null {
    try {
      const crypto = require('crypto');
      // Last 16 bytes are the tag
      const tag = ciphertext.slice(-16);
      const encrypted = ciphertext.slice(0, -16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(Buffer.from(tag));
      return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
    } catch {
      return null;
    }
  }
}

// ============================================================================
// KDF Implementation
// ============================================================================

/**
 * KDF implementation
 */
export class KDFImpl implements IKDF {
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    const crypto = require('crypto');
    return crypto.hkdfSync('sha512', ikm, salt, info, length);
  }

  pbkdf2(password: string, salt: Uint8Array, iterations: number, length: number): Uint8Array {
    const crypto = require('crypto');
    return crypto.pbkdf2Sync(password, salt, iterations, length, 'sha512');
  }

  hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha512', key);
    hmac.update(data);
    return new Uint8Array(hmac.digest());
  }
}

// ============================================================================
// Crypto Implementation
// ============================================================================

/**
 * Complete crypto implementation using libsodium
 */
export class CryptoNode implements ICrypto {
  private _box: BoxImpl;
  private _secretBox: SecretBoxImpl;
  private _sign: SignImpl;
  private _hash: HashImpl;
  private _aes: AESImpl;
  private _kdf: KDFImpl;

  constructor() {
    this._box = new BoxImpl();
    this._secretBox = new SecretBoxImpl();
    this._sign = new SignImpl();
    this._hash = new HashImpl();
    this._aes = new AESImpl();
    this._kdf = new KDFImpl();
  }

  // ICrypto methods

  getRandomBytes(size: number): Uint8Array {
    return sodium.randombytes_buf(size);
  }

  generateKeyPair(): KeyPair {
    return this._box.generateKeyPair();
  }

  generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
    return this._box.generateKeyPairFromSeed(seed);
  }

  publicKeyFromSecretKey(privateKey: Uint8Array): Uint8Array {
    return this._box.publicKeyFromSecretKey(privateKey);
  }

  boxEncrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
    return this._box.encrypt(plaintext, recipientPublicKey);
  }

  boxDecrypt(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array | null {
    return this._box.decrypt(ciphertext, secretKey);
  }

  generateSecretKey(): Uint8Array {
    return this._secretBox.generateKey();
  }

  secretBoxEncrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedData {
    return this._secretBox.encrypt(plaintext, key);
  }

  secretBoxDecrypt(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null {
    return this._secretBox.decrypt(encrypted, key);
  }

  secretBoxEncryptToBundle(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
    return this._secretBox.encryptToBundle(plaintext, key);
  }

  secretBoxDecryptFromBundle(bundle: Uint8Array, key: Uint8Array): Uint8Array | null {
    return this._secretBox.decryptFromBundle(bundle, key);
  }

  getKDF(): IKDF {
    return this._kdf;
  }

  getAES(): IAES {
    return this._aes;
  }

  // ISign methods

  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return this._sign.sign(message, secretKey);
  }

  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    return this._sign.verify(message, signature, publicKey);
  }

  // IHash methods

  sha256(data: Uint8Array): Uint8Array {
    return this._hash.sha256(data);
  }

  sha512(data: Uint8Array): Uint8Array {
    return this._hash.sha512(data);
  }

  blake2b(data: Uint8Array, length?: number): Uint8Array {
    return this._hash.blake2b(data, length);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new crypto instance
 */
export function createCrypto(): CryptoNode {
  if (!sodiumReady) {
    throw new Error('Sodium not ready. Call waitForSodium() first or use getCrypto()');
  }
  return new CryptoNode();
}

/**
 * Get or create a singleton crypto instance (for Edge cold start optimization)
 * Automatically waits for sodium to be ready
 */
export async function getCrypto(): Promise<CryptoNode> {
  await waitForSodium();
  return getSingleton<CryptoNode>('crypto-node', () => new CryptoNode());
}

/**
 * Get or create a singleton crypto instance synchronously
 * Will throw if sodium is not ready
 */
export function getCryptoSync(): CryptoNode {
  if (!sodiumReady) {
    throw new Error('Sodium not ready. Call waitForSodium() first');
  }
  return getSingletonSync('crypto-node', () => new CryptoNode());
}

// Re-export sodium for advanced use
export { sodium };
