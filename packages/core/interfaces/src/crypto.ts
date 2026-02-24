/**
 * @agentbridge/interfaces - Crypto Interface
 * Cryptographic primitives interface
 */

/**
 * Key pair for asymmetric encryption
 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Encrypted data with nonce
 */
export interface EncryptedData {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Encrypted data for recipient (sealed box)
 */
export interface EncryptedForRecipient extends EncryptedData {
  ephemeralPublicKey: Uint8Array;
}

/**
 * Session keys for encryption
 */
export interface SessionKeys {
  /** Data Encryption Key */
  dek: Uint8Array;
  /** Encrypted DEK (for storage/transmission) */
  encryptedDek: Uint8Array;
  /** Key ID */
  keyId: string;
}

/**
 * Encryption variant type
 */
export type EncryptionVariant = 'legacy' | 'dataKey';

// ============================================================================
// Crypto Interfaces
// ============================================================================

/**
 * IBox - Asymmetric encryption (X25519-XSalsa20-Poly1305)
 */
export interface IBox {
  /**
   * Generate a new key pair (random)
   */
  generateKeyPair(): KeyPair;

  /**
   * Generate a key pair from a seed (32 bytes)
   * Compatible with free/happy implementation
   */
  generateKeyPairFromSeed(seed: Uint8Array): KeyPair;

  /**
   * Derive public key from private key
   * Note: This expects the actual private key (not seed)
   */
  publicKeyFromSecretKey(privateKey: Uint8Array): Uint8Array;

  /**
   * Encrypt for recipient's public key
   */
  encrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;

  /**
   * Decrypt from sender using own secret key
   */
  decrypt(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array | null;
}

/**
 * ISecretBox - Symmetric encryption (XSalsa20-Poly1305)
 */
export interface ISecretBox {
  /**
   * Generate a new key
   */
  generateKey(): Uint8Array;

  /**
   * Encrypt with key (returns ciphertext and nonce separately)
   */
  encrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedData;

  /**
   * Decrypt with key
   */
  decrypt(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null;

  /**
   * Encrypt and return as bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  encryptToBundle?(plaintext: Uint8Array, key: Uint8Array): Uint8Array;

  /**
   * Decrypt from bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  decryptFromBundle?(bundle: Uint8Array, key: Uint8Array): Uint8Array | null;
}

/**
 * ISign - Digital signatures (Ed25519)
 */
export interface ISign {
  /**
   * Generate a new signing key pair
   */
  generateKeyPair(): KeyPair;

  /**
   * Sign a message
   */
  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array;

  /**
   * Verify a signature
   */
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

/**
 * IHash - Hashing functions
 */
export interface IHash {
  /**
   * SHA-256 hash
   */
  sha256(data: Uint8Array): Uint8Array;

  /**
   * SHA-512 hash
   */
  sha512(data: Uint8Array): Uint8Array;

  /**
   * BLAKE2b hash
   */
  blake2b(data: Uint8Array, length?: number): Uint8Array;
}

/**
 * IAES - AES encryption
 */
export interface IAES {
  /**
   * AES-GCM encrypt
   */
  encryptGCM(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;

  /**
   * AES-GCM decrypt
   */
  decryptGCM(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array | null;
}

/**
 * IKDF - Key derivation functions
 */
export interface IKDF {
  /**
   * HKDF derive key
   */
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;

  /**
   * PBKDF2 derive key
   */
  pbkdf2(password: string, salt: Uint8Array, iterations: number, length: number): Uint8Array;

  /**
   * HMAC-SHA512 based key derivation (for KeyTree)
   */
  hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array;
}

/**
 * ICrypto - Combined crypto interface
 */
export interface ICrypto extends ISign, IHash {
  /**
   * Get random bytes
   */
  getRandomBytes(size: number): Uint8Array;

  /**
   * Generate a new key pair for asymmetric encryption (random)
   */
  generateKeyPair(): KeyPair;

  /**
   * Generate a key pair from a seed (32 bytes)
   * Compatible with free/happy implementation
   */
  generateKeyPairFromSeed(seed: Uint8Array): KeyPair;

  /**
   * Derive public key from private key
   * Note: This expects the actual private key (not seed)
   */
  publicKeyFromSecretKey(privateKey: Uint8Array): Uint8Array;

  /**
   * Encrypt for recipient's public key
   */
  boxEncrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;

  /**
   * Decrypt from sender using own secret key
   */
  boxDecrypt(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array | null;

  /**
   * Generate a new symmetric key
   */
  generateSecretKey(): Uint8Array;

  /**
   * Encrypt with symmetric key
   */
  secretBoxEncrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedData;

  /**
   * Decrypt with symmetric key
   */
  secretBoxDecrypt(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null;

  /**
   * Encrypt with symmetric key and return bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  secretBoxEncryptToBundle(plaintext: Uint8Array, key: Uint8Array): Uint8Array;

  /**
   * Decrypt from bundled format: nonce(24) + ciphertext
   * Compatible with free/happy implementation
   */
  secretBoxDecryptFromBundle(bundle: Uint8Array, key: Uint8Array): Uint8Array | null;

  /**
   * Get KDF interface
   */
  getKDF(): IKDF;

  /**
   * Get AES interface
   */
  getAES(): IAES;
}
