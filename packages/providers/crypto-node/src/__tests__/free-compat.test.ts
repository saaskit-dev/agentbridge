/**
 * Crypto Compatibility Tests
 *
 * Tests to verify SDK crypto implementation is compatible with free's libsodium.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { waitForSodium, CryptoNode, sodium } from '../index';

describe('Crypto - free compatibility', () => {
  let crypto: CryptoNode;

  beforeAll(async () => {
    await waitForSodium();
    crypto = new CryptoNode();
  });

  describe('Box encryption format', () => {
    it('should produce bundle format: ephemeralPublicKey(32) + nonce(24) + ciphertext', async () => {
      // Generate a key pair
      const keyPair = crypto.generateKeyPair();
      const plaintext = new TextEncoder().encode('Hello, World!');

      // Encrypt using SDK
      const encrypted = crypto.boxEncrypt(plaintext, keyPair.publicKey);

      // Verify bundle format
      // ephemeralPublicKey: 32 bytes
      // nonce: 24 bytes
      // ciphertext: variable (plaintext + 16 bytes MAC)
      expect(encrypted.length).toBe(32 + 24 + plaintext.length + 16);

      // Extract components
      const ephemeralPublicKey = encrypted.slice(0, 32);
      const nonce = encrypted.slice(32, 56);
      const ciphertext = encrypted.slice(56);

      expect(ephemeralPublicKey.length).toBe(32);
      expect(nonce.length).toBe(24);
      expect(ciphertext.length).toBe(plaintext.length + 16);
    });

    it('should decrypt what was encrypted (round-trip)', async () => {
      const keyPair = crypto.generateKeyPair();
      const plaintext = new TextEncoder().encode('Test message for round-trip');

      const encrypted = crypto.boxEncrypt(plaintext, keyPair.publicKey);
      const decrypted = crypto.boxDecrypt(encrypted, keyPair.privateKey);

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(plaintext);
    });

    it('should be compatible with libsodium direct call (using re-exported sodium)', async () => {
      const keyPair = crypto.generateKeyPair();
      const plaintext = new TextEncoder().encode('Compatibility test');

      // Encrypt using SDK (anonymous box)
      const encrypted = crypto.boxEncrypt(plaintext, keyPair.publicKey);

      // Extract components and decrypt using raw libsodium
      const ephemeralPublicKey = encrypted.slice(0, sodium.crypto_box_PUBLICKEYBYTES);
      const nonce = encrypted.slice(
        sodium.crypto_box_PUBLICKEYBYTES,
        sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES
      );
      const ciphertext = encrypted.slice(
        sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES
      );

      // Decrypt using raw libsodium
      const decrypted = sodium.crypto_box_open_easy(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        keyPair.privateKey
      );

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('SecretBox encryption format', () => {
    it('should produce format: nonce(24) + ciphertext', async () => {
      const key = crypto.generateSecretKey();
      const plaintext = new TextEncoder().encode('Secret message');

      const encrypted = crypto.secretBoxEncrypt(plaintext, key);

      // Verify format: nonce (24) + ciphertext (plaintext + 16 MAC)
      expect(encrypted.nonce.length).toBe(24);
      expect(encrypted.ciphertext.length).toBe(plaintext.length + 16);
    });

    it('should decrypt what was encrypted (round-trip)', async () => {
      const key = crypto.generateSecretKey();
      const plaintext = new TextEncoder().encode('Another secret message');

      const encrypted = crypto.secretBoxEncrypt(plaintext, key);
      const decrypted = crypto.secretBoxDecrypt(encrypted, key);

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(plaintext);
    });

    it('should produce bundle format: nonce(24) + ciphertext (free compatible)', async () => {
      const key = crypto.generateSecretKey();
      const plaintext = new TextEncoder().encode('Bundle format test');

      // Use bundle format (free/happy compatible)
      const bundle = crypto.secretBoxEncryptToBundle(plaintext, key);

      // Verify bundle format: nonce (24) + ciphertext (plaintext + 16 MAC)
      expect(bundle.length).toBe(24 + plaintext.length + 16);

      // Extract and verify components
      const nonce = bundle.slice(0, 24);
      const ciphertext = bundle.slice(24);
      expect(nonce.length).toBe(24);
      expect(ciphertext.length).toBe(plaintext.length + 16);
    });

    it('should decrypt from bundle format (free compatible)', async () => {
      const key = crypto.generateSecretKey();
      const plaintext = new TextEncoder().encode('Bundle decrypt test');

      const bundle = crypto.secretBoxEncryptToBundle(plaintext, key);
      const decrypted = crypto.secretBoxDecryptFromBundle(bundle, key);

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(plaintext);
    });

    it('should be compatible with raw libsodium secretbox', async () => {
      const key = crypto.generateSecretKey();
      const plaintext = new TextEncoder().encode('Raw libsodium test');

      // Encrypt using SDK bundle format
      const bundle = crypto.secretBoxEncryptToBundle(plaintext, key);

      // Extract components and decrypt using raw libsodium
      const nonce = bundle.slice(0, sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = bundle.slice(sodium.crypto_secretbox_NONCEBYTES);

      const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('Key derivation', () => {
    it('should derive consistent public key from secret key', async () => {
      const keyPair = crypto.generateKeyPair();

      // Derive public key from private key
      const derivedPublicKey = crypto.publicKeyFromSecretKey(keyPair.privateKey);

      expect(derivedPublicKey).toEqual(keyPair.publicKey);
    });
  });

  describe('Signatures', () => {
    it('should sign and verify correctly', async () => {
      // Sign uses Ed25519, box uses X25519 - different key types!
      // Use sodium directly to generate a sign keypair (like free does)
      const keyPair = sodium.crypto_sign_keypair();
      const message = new TextEncoder().encode('Message to sign');

      const signature = crypto.sign(message, keyPair.privateKey);
      const verified = crypto.verify(message, signature, keyPair.publicKey);

      expect(verified).toBe(true);
    });

    it('should fail verification for tampered message', async () => {
      const keyPair = sodium.crypto_sign_keypair();
      const message = new TextEncoder().encode('Original message');

      const signature = crypto.sign(message, keyPair.privateKey);

      const tamperedMessage = new TextEncoder().encode('Tampered message');
      const verified = crypto.verify(tamperedMessage, signature, keyPair.publicKey);

      expect(verified).toBe(false);
    });
  });

  describe('Hash functions', () => {
    it('should produce consistent SHA-256 hash', async () => {
      const data = new TextEncoder().encode('test data');

      const hash1 = crypto.sha256(data);
      const hash2 = crypto.sha256(data);

      expect(hash1.length).toBe(32); // 256 bits = 32 bytes
      expect(hash1).toEqual(hash2);
    });

    it('should produce consistent SHA-512 hash', async () => {
      const data = new TextEncoder().encode('test data');

      const hash1 = crypto.sha512(data);
      const hash2 = crypto.sha512(data);

      expect(hash1.length).toBe(64); // 512 bits = 64 bytes
      expect(hash1).toEqual(hash2);
    });
  });
});
