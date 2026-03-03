/**
 * Machine-specific encryption manager
 *
 * Handles batch decryption/encryption of machine metadata and daemon state.
 */

import { encodeBase64, decodeBase64 } from '../utils/encoding';
import { EncryptionCache } from './sessionEncryption';
import type { Cipher } from './types';

/**
 * Machine encryption manager
 */
export class MachineEncryption {
  private machineId: string;
  private cipher: Cipher;
  private cache: EncryptionCache;

  constructor(machineId: string, cipher: Cipher, cache?: EncryptionCache) {
    this.machineId = machineId;
    this.cipher = cipher;
    this.cache = cache ?? new EncryptionCache();
  }

  async encryptMetadata(metadata: unknown): Promise<string> {
    const encrypted = await this.cipher.encrypt([metadata]);
    return encodeBase64(encrypted[0]);
  }

  async decryptMetadata(version: number, encrypted: string): Promise<unknown | null> {
    const cached = this.cache.getCachedMetadata(this.machineId, version);
    if (cached) return cached;

    const encryptedData = decodeBase64(encrypted);
    const decrypted = await this.cipher.decrypt([encryptedData]);
    if (!decrypted[0]) return null;

    this.cache.setCachedMetadata(this.machineId, version, decrypted[0]);
    return decrypted[0];
  }

  async encryptDaemonState(state: unknown): Promise<string> {
    const encrypted = await this.cipher.encrypt([state]);
    return encodeBase64(encrypted[0]);
  }

  async decryptDaemonState(
    version: number,
    encrypted: string | null | undefined
  ): Promise<unknown | null> {
    if (!encrypted) return null;

    const cached = this.cache.getCachedAgentState(this.machineId, version);
    if (cached) return cached;

    const encryptedData = decodeBase64(encrypted);
    const decrypted = await this.cipher.decrypt([encryptedData]);
    if (!decrypted[0]) return null;

    this.cache.setCachedAgentState(this.machineId, version, decrypted[0]);
    return decrypted[0];
  }

  async encryptRaw(data: unknown): Promise<string> {
    const encrypted = await this.cipher.encrypt([data]);
    return encodeBase64(encrypted[0]);
  }

  async decryptRaw(encrypted: string): Promise<unknown | null> {
    try {
      const encryptedData = decodeBase64(encrypted);
      const decrypted = await this.cipher.decrypt([encryptedData]);
      return decrypted[0] ?? null;
    } catch {
      return null;
    }
  }
}
