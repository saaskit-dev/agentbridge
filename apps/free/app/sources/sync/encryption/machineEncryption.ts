import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import { wireEncode, wireDecode } from '@saaskit-dev/agentbridge/encryption';
import { config } from '@/config';
import { MachineMetadata, MachineMetadataSchema } from '../storageTypes';
import { EncryptionCache } from './encryptionCache';
import { Decryptor, Encryptor } from './encryptor';

const logger = new Logger('app/sync/encryption/machine');

export class MachineEncryption {
  private machineId: string;
  private encryptor: Encryptor & Decryptor;
  private cache: EncryptionCache;

  constructor(machineId: string, encryptor: Encryptor & Decryptor, cache: EncryptionCache) {
    this.machineId = machineId;
    this.encryptor = encryptor;
    this.cache = cache;
  }

  /**
   * Encrypt machine metadata
   */
  async encryptMetadata(metadata: MachineMetadata): Promise<string> {
    return wireEncode(metadata, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt machine metadata with caching
   */
  async decryptMetadata(version: number, encrypted: string): Promise<MachineMetadata | null> {
    // Check cache first
    const cached = this.cache.getCachedMachineMetadata(this.machineId, version);
    if (cached) {
      return cached;
    }

    try {
      const decrypted = await wireDecode(encrypted, this.encryptor);
      if (!decrypted) {
        return null;
      }

      const parsed = MachineMetadataSchema.safeParse(decrypted);
      if (!parsed.success) {
        logger.error('Failed to parse machine metadata:', parsed.error);
        return null;
      }

      // Cache the result
      this.cache.setCachedMachineMetadata(this.machineId, version, parsed.data);
      return parsed.data;
    } catch (error) {
      logger.error('Failed to decrypt machine metadata:', toError(error));
      return null;
    }
  }

  /**
   * Encrypt daemon state
   */
  async encryptDaemonState(state: any): Promise<string> {
    return wireEncode(state, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt daemon state with caching
   */
  async decryptDaemonState(
    version: number,
    encrypted: string | null | undefined
  ): Promise<any | null> {
    if (!encrypted) {
      return null;
    }

    // Check cache first
    const cached = this.cache.getCachedDaemonState(this.machineId, version);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const result = await wireDecode(encrypted, this.encryptor);

      // Cache the result (including null values)
      this.cache.setCachedDaemonState(this.machineId, version, result);
      return result;
    } catch (error) {
      logger.error('Failed to decrypt daemon state:', toError(error));
      // Cache null result to avoid repeated decryption attempts
      this.cache.setCachedDaemonState(this.machineId, version, null);
      return null;
    }
  }

  /**
   * Encrypt raw data using machine-specific encryption
   */
  async encryptRaw(data: any): Promise<string> {
    return wireEncode(data, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt raw data using machine-specific encryption
   */
  async decryptRaw(encrypted: string): Promise<any | null> {
    try {
      return await wireDecode(encrypted, this.encryptor);
    } catch (error) {
      logger.error('Failed to decrypt raw data:', toError(error));
      return null;
    }
  }
}
