/**
 * @agentbridge/interfaces - Encryption Interface
 * High-level encryption with key management
 */

import type { KeyPair, EncryptedData, EncryptedForRecipient, SessionKeys, EncryptionVariant } from './crypto';

/**
 * IEncryptionProvider - Low-level encryption operations
 */
export interface IEncryptionProvider {
  // Base64
  encodeBase64(buffer: Uint8Array, variant?: 'base64' | 'base64url'): string;
  decodeBase64(base64: string, variant?: 'base64' | 'base64url'): Uint8Array;

  // Random
  getRandomBytes(size: number): Uint8Array;

  // Symmetric encryption
  encrypt(key: Uint8Array, variant: EncryptionVariant, data: unknown): Uint8Array;
  decrypt(key: Uint8Array, variant: EncryptionVariant, data: Uint8Array): unknown | null;

  // Asymmetric encryption
  encryptForPublicKey(data: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;
  decryptFromPublicKey(bundle: Uint8Array, secretKey: Uint8Array): Uint8Array | null;

  // Key derivation
  publicKeyFromSecretKey(seed: Uint8Array): Uint8Array;
}

/**
 * IKeyDerivation - Key derivation interface
 */
export interface IKeyDerivation {
  /**
   * Derive a key from a path
   */
  derive(path: string[]): Uint8Array;

  /**
   * Derive a key pair from a path
   */
  deriveKeyPair(path: string[]): KeyPair;
}

/**
 * IEncryption - High-level encryption with key management
 *
 * Combines IEncryptionProvider and IKeyDerivation for complete encryption solution.
 */
export interface IEncryption {
  /**
   * Initialize with master secret
   */
  initialize(masterSecret: string | Uint8Array): Promise<void>;

  /**
   * Get the key derivation instance
   */
  getKeyDerivation(): IKeyDerivation | null;

  /**
   * Derive a key for a specific purpose
   */
  deriveKey(path: string[]): Uint8Array;

  /**
   * Get public key for key exchange
   */
  getPublicKey(): Uint8Array;

  /**
   * Generate session DEK
   */
  generateSessionDEK(sessionId?: string): Promise<SessionKeys>;

  /**
   * Decrypt DEK from encrypted form
   */
  decryptDEK(encryptedDek: Uint8Array, sessionId?: string): Promise<Uint8Array>;

  /**
   * Derive session-specific key
   */
  deriveSessionKey(sessionId: string): Uint8Array;

  /**
   * Derive machine-specific key
   */
  deriveMachineKey(machineId: string): Uint8Array;

  /**
   * Derive artifact-specific key
   */
  deriveArtifactKey(artifactId: string): Uint8Array;

  /**
   * Get anonymous ID for analytics
   */
  getAnonId(): string;

  /**
   * Encrypt data with DEK
   */
  encrypt(data: Uint8Array, dek: Uint8Array): Promise<EncryptedData>;

  /**
   * Decrypt data with DEK
   */
  decrypt(encrypted: EncryptedData, dek: Uint8Array): Promise<Uint8Array>;

  /**
   * Encrypt with derived key
   */
  encryptWithPath(data: Uint8Array, path: string[]): Promise<EncryptedData>;

  /**
   * Decrypt with derived key
   */
  decryptWithPath(encrypted: EncryptedData, path: string[]): Promise<Uint8Array>;

  /**
   * Encrypt for recipient
   */
  encryptForRecipient(data: Uint8Array, recipientPublicKey: Uint8Array): Promise<EncryptedForRecipient>;

  /**
   * Decrypt from sender
   */
  decryptFromSender(encrypted: EncryptedForRecipient): Promise<Uint8Array>;

  /**
   * Encrypt string (convenience)
   */
  encryptString(plaintext: string, dek: Uint8Array): Promise<string>;

  /**
   * Decrypt string (convenience)
   */
  decryptString(ciphertext: string, dek: Uint8Array): Promise<string>;

  /**
   * Secure cleanup
   */
  destroy(): void;
}

// ============================================================================
// Encryption Registry
// ============================================================================

const encryptionProviders = new Map<string, new () => IEncryption>();

/**
 * Register an encryption provider
 */
export function registerEncryptionProvider(type: string, provider: new () => IEncryption): void {
  encryptionProviders.set(type, provider);
}

/**
 * Create an encryption instance
 */
export function createEncryption(type = 'libsodium'): IEncryption {
  const Provider = encryptionProviders.get(type);
  if (!Provider) {
    throw new Error(`Unknown encryption provider: ${type}. Available: ${getRegisteredEncryptionProviders().join(', ')}`);
  }
  return new Provider();
}

/**
 * Get list of registered encryption providers
 */
export function getRegisteredEncryptionProviders(): string[] {
  return Array.from(encryptionProviders.keys());
}

/**
 * Clear all registered encryption providers (for testing)
 */
export function clearEncryptionProviders(): void {
  encryptionProviders.clear();
}
