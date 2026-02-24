import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { waitForSodium, CryptoNode } from '../index';

describe('Sodium key derivation - free compatibility', () => {
  let crypto: CryptoNode;

  beforeAll(async () => {
    await waitForSodium();
    crypto = new CryptoNode();
  });

  describe('seed vs privateKey - understanding the difference', () => {
    it('should show privateKey !== seed', async () => {
      const seed = sodium.randombytes_buf(32);
      const kp = sodium.crypto_box_seed_keypair(seed);

      // privateKey 是经过处理的，不等于原始 seed
      expect(sodium.memcmp(kp.privateKey, seed)).toBe(false);
    });

    it('should show scalarmult_base(privateKey) === keyPair.publicKey', async () => {
      const kp = sodium.crypto_box_keypair();
      const derivedPk = sodium.crypto_scalarmult_base(kp.privateKey);

      // 从 privateKey 派生的 publicKey 等于原 publicKey
      expect(sodium.memcmp(derivedPk, kp.publicKey)).toBe(true);
    });

    it('should show seed_keypair.publicKey !== scalarmult_base(seed)', async () => {
      const seed = sodium.randombytes_buf(32);
      const kp = sodium.crypto_box_seed_keypair(seed);
      const derivedFromSeed = sodium.crypto_scalarmult_base(seed);

      // seed_keypair 内部会先处理 seed，所以直接用 scalarmult_base(seed) 结果不同
      expect(sodium.memcmp(kp.publicKey, derivedFromSeed)).toBe(false);
    });
  });

  describe('generateKeyPairFromSeed - free compatibility', () => {
    it('should generate same keypair as free from seed', async () => {
      const seed = sodium.randombytes_buf(32);

      // SDK 的方式
      const sdkKp = crypto.generateKeyPairFromSeed(seed);

      // free 的方式
      const freeKp = sodium.crypto_box_seed_keypair(seed);

      expect(sodium.memcmp(sdkKp.publicKey, freeKp.publicKey)).toBe(true);
      expect(sodium.memcmp(sdkKp.privateKey, freeKp.privateKey)).toBe(true);
    });

    it('should be deterministic - same seed always produces same keypair', async () => {
      const seed = sodium.randombytes_buf(32);

      const kp1 = crypto.generateKeyPairFromSeed(seed);
      const kp2 = crypto.generateKeyPairFromSeed(seed);

      expect(sodium.memcmp(kp1.publicKey, kp2.publicKey)).toBe(true);
      expect(sodium.memcmp(kp1.privateKey, kp2.privateKey)).toBe(true);
    });

    it('should work with BoxEncryption pattern (free style)', async () => {
      const seed = sodium.randombytes_buf(32);
      const keypair = crypto.generateKeyPairFromSeed(seed);

      // 可以用生成的 keypair 加密解密
      const plaintext = new TextEncoder().encode('Test message');
      const encrypted = crypto.boxEncrypt(plaintext, keypair.publicKey);
      const decrypted = crypto.boxDecrypt(encrypted, keypair.privateKey);

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('publicKeyFromSecretKey - from privateKey (not seed)', () => {
    it('should derive publicKey from privateKey', async () => {
      const keyPair = crypto.generateKeyPair();
      const derivedPublicKey = crypto.publicKeyFromSecretKey(keyPair.privateKey);

      expect(derivedPublicKey).toEqual(keyPair.publicKey);
    });

    it('should NOT be used with seed (that would be wrong)', async () => {
      const seed = sodium.randombytes_buf(32);
      const correctKp = sodium.crypto_box_seed_keypair(seed);

      // 错误用法：把 seed 当作 privateKey
      const wrongPublicKey = crypto.publicKeyFromSecretKey(seed);

      // 结果会不同！
      expect(sodium.memcmp(wrongPublicKey, correctKp.publicKey)).toBe(false);
    });
  });
});
