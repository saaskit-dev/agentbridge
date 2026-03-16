import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import { wireEncode, wireDecode } from '@saaskit-dev/agentbridge/encryption';
import { config } from '@/config';
import * as Random from 'expo-crypto';
import { ArtifactHeader, ArtifactBody } from '../artifactTypes';
import { AES256Encryption } from './encryptor';

const logger = new Logger('app/sync/encryption/artifact');

export class ArtifactEncryption {
  private encryptor: AES256Encryption;

  constructor(dataEncryptionKey: Uint8Array) {
    this.encryptor = new AES256Encryption(dataEncryptionKey);
  }

  /**
   * Generate a new data encryption key for an artifact
   */
  static generateDataEncryptionKey(): Uint8Array {
    return Random.getRandomBytes(32); // 256 bits for AES-256
  }

  /**
   * Encrypt artifact header
   */
  async encryptHeader(header: ArtifactHeader): Promise<string> {
    return wireEncode(header, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt artifact header
   */
  async decryptHeader(encryptedHeader: string): Promise<ArtifactHeader | null> {
    try {
      const decrypted = await wireDecode(encryptedHeader, this.encryptor);
      if (!decrypted || typeof decrypted !== 'object') {
        return null;
      }
      const header = decrypted as any;
      return {
        title: typeof header.title === 'string' ? header.title : null,
      };
    } catch (error) {
      logger.error('Failed to decrypt artifact header:', toError(error));
      return null;
    }
  }

  /**
   * Encrypt artifact body
   */
  async encryptBody(body: ArtifactBody): Promise<string> {
    return wireEncode(body, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt artifact body
   */
  async decryptBody(encryptedBody: string): Promise<ArtifactBody | null> {
    try {
      const decrypted = await wireDecode(encryptedBody, this.encryptor);
      if (!decrypted || typeof decrypted !== 'object') {
        return null;
      }
      const body = decrypted as any;
      return {
        body: typeof body.body === 'string' ? body.body : null,
      };
    } catch (error) {
      logger.error('Failed to decrypt artifact body:', toError(error));
      return null;
    }
  }
}
