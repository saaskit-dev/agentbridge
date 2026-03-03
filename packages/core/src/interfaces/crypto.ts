/**
 * Crypto interface
 * Two encryption modes:
 * - legacy: tweetnacl (XSalsa20-Poly1305, X25519, Ed25519)
 * - dataKey: AES-256-GCM
 */

/**
 * Encrypted data bundle
 *
 * For AES-256-GCM (dataKey mode):
 * - ciphertext contains the full bundle: [ version(1)=0 | nonce(12) | ciphertext | authTag(16) ]
 * - nonce and tag are empty (embedded in ciphertext)
 *
 * For secretbox (legacy mode):
 * - Layout: [ nonce(24) | ciphertext+tag ]
 */
export interface EncryptedData {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  tag?: Uint8Array;
}

/** Key pair for asymmetric encryption */
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Crypto factory type */
export type CryptoFactory = () => ICrypto;

/** Crypto interface */
export interface ICrypto {
  /** Generate secure random bytes */
  getRandomBytes(size: number): Uint8Array;

  // === Legacy mode (tweetnacl) ===

  /** XSalsa20-Poly1305 symmetric encryption (secretbox) */
  secretbox(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;

  /** X25519 key pair for box encryption */
  boxKeyPair(): KeyPair;

  /** X25519 + XSalsa20-Poly1305 authenticated encryption (box) */
  box(
    plaintext: Uint8Array,
    nonce: Uint8Array,
    peerPublicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array;
  boxOpen(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    peerPublicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null;

  /**
   * Anonymous sealed box (ephemeral key + box)
   * Binary format: [ ephemeralPublicKey(32) | nonce(24) | ciphertext ]
   */
  boxSeal(plaintext: Uint8Array, peerPublicKey: Uint8Array): Uint8Array;
  boxSealOpen(
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    secretKey: Uint8Array
  ): Uint8Array | null;

  // === DataKey mode (AES-256-GCM) ===
  // Binary format: [ version(1)=0 | nonce(12) | ciphertext | authTag(16) ]
  // The returned EncryptedData.ciphertext contains the full packed bundle

  /** AES-256-GCM encryption, returns packed binary bundle */
  encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): EncryptedData;
  decryptAesGcm(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null;

  // === Ed25519 signatures ===

  /** Ed25519 signing key pair from seed */
  signKeyPairFromSeed(seed: Uint8Array): KeyPair;

  /** Ed25519 detached signature */
  signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verifyDetached(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;

  // === Authentication ===

  /** Generate authentication challenge response */
  authChallenge(secret: Uint8Array): {
    challenge: Uint8Array;
    publicKey: Uint8Array;
    signature: Uint8Array;
  };
}

// Factory registry
const cryptoFactories = new Map<string, CryptoFactory>();

/** Register a crypto factory */
export function registerCryptoFactory(type: string, factory: CryptoFactory): void {
  cryptoFactories.set(type, factory);
}

/** Create a crypto instance */
export function createCrypto(type: string): ICrypto {
  const factory = cryptoFactories.get(type);
  if (!factory) {
    throw new Error(
      `Crypto factory not found: ${type}. Available: ${[...cryptoFactories.keys()].join(', ')}`
    );
  }
  return factory();
}
