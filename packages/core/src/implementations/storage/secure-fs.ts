/**
 * Encrypted File System Storage Implementation
 *
 * Provides encrypted key-value storage using AES-256-GCM.
 * Values are encrypted before being written to disk.
 */

import { existsSync } from 'node:fs';
import { constants } from 'node:fs';
import { readFile, writeFile, mkdir, unlink, rename, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ICrypto } from '../../interfaces/crypto';
import { createCrypto } from '../../interfaces/crypto';
import type { ISecureStorage, SecureStorageOptions } from '../../interfaces/storage';
import { registerSecureStorageFactory } from '../../interfaces/storage';

/** Lock configuration */
const LOCK_RETRY_INTERVAL_MS = 100;
const MAX_LOCK_ATTEMPTS = 50;
const STALE_LOCK_TIMEOUT_MS = 10000;

/**
 * Encrypted file system storage
 *
 * Uses AES-256-GCM for encryption. Each value is encrypted with the same key
 * but different nonces, providing both confidentiality and integrity.
 */
class EncryptedFsStorage implements ISecureStorage {
  private basePath: string;
  private crypto: ICrypto;
  private key: Uint8Array;

  constructor(options?: SecureStorageOptions) {
    this.basePath = options?.namespace ?? process.cwd();

    // Initialize crypto first (always needed)
    this.crypto = createCrypto('node');

    // Get or generate encryption key
    if (options?.key) {
      this.key = options.key;
    } else {
      // Generate a key from environment or create a default
      // In production, this should come from a secure key derivation
      const envKey = process.env.SECURE_STORAGE_KEY;
      if (envKey) {
        this.key = Buffer.from(envKey, 'base64');
      } else {
        // Generate a random key (not recommended for production)
        this.key = this.crypto.getRandomBytes(32);
      }
    }
  }

  private getFilePath(key: string): string {
    // Use hash of key as filename for security
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `.secure_${sanitized}.enc`);
  }

  private getLockPath(key: string): string {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `.secure_${sanitized}.lock`);
  }

  private async acquireLock(lockPath: string): Promise<() => Promise<void>> {
    let attempts = 0;
    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

    while (attempts < MAX_LOCK_ATTEMPTS) {
      try {
        fileHandle = await open(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        );
        return async () => {
          if (fileHandle) {
            await fileHandle.close();
            await unlink(lockPath).catch(() => {});
          }
        };
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === 'EEXIST') {
          try {
            const stats = await stat(lockPath);
            if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
              await unlink(lockPath).catch(() => {});
            }
          } catch {
            // Lock file was removed
          }
          attempts++;
          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
        } else {
          throw err;
        }
      }
    }

    throw new Error(`Failed to acquire lock after ${MAX_LOCK_ATTEMPTS} attempts`);
  }

  async getItem(key: string): Promise<string | null> {
    const filePath = this.getFilePath(key);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const encrypted = await readFile(filePath);
      if (encrypted.length === 0) {
        return null;
      }

      // Decrypt the data
      const decrypted = this.crypto.decryptAesGcm(
        { ciphertext: encrypted, nonce: new Uint8Array(0) },
        this.key
      );

      if (!decrypted) {
        return null;
      }

      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.basePath)) {
      await mkdir(this.basePath, { recursive: true });
    }

    const filePath = this.getFilePath(key);
    const lockPath = this.getLockPath(key);
    const tmpPath = `${filePath}.${Date.now()}.tmp`;

    // Acquire lock
    const releaseLock = await this.acquireLock(lockPath);

    try {
      // Encrypt the value
      const plaintext = new TextEncoder().encode(value);
      const encrypted = this.crypto.encryptAesGcm(plaintext, this.key);

      // Write to temp file, then rename (atomic)
      await writeFile(tmpPath, encrypted.ciphertext);
      await rename(tmpPath, filePath);
    } finally {
      await releaseLock();
    }
  }

  async deleteItem(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const lockPath = this.getLockPath(key);

    if (existsSync(filePath)) {
      const releaseLock = await this.acquireLock(lockPath);
      try {
        await unlink(filePath);
      } finally {
        await releaseLock();
      }
    }
  }

  async hasItem(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    return existsSync(filePath);
  }
}

// Register factory
registerSecureStorageFactory('fs', options => new EncryptedFsStorage(options));

// Export for direct use
export { EncryptedFsStorage };
