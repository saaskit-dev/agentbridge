import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import { wireEncode, wireDecode, wireDecodeBatch } from '@saaskit-dev/agentbridge/encryption';
import { config } from '@/config';
import { ApiMessage } from '../apiTypes';
import {
  DecryptedMessage,
  Metadata,
  MetadataSchema,
  AgentState,
  AgentStateSchema,
} from '../storageTypes';
import { RawRecord } from '../typesRaw';
import { EncryptionCache } from './encryptionCache';
import { Decryptor, Encryptor } from './encryptor';
import { SessionCapabilities, SessionCapabilitiesSchema } from '../sessionCapabilities';

const logger = new Logger('app/sync/encryption/session');

export class SessionEncryption {
  private sessionId: string;
  private encryptor: Encryptor & Decryptor;
  private cache: EncryptionCache;

  constructor(sessionId: string, encryptor: Encryptor & Decryptor, cache: EncryptionCache) {
    this.sessionId = sessionId;
    this.encryptor = encryptor;
    this.cache = cache;
  }

  /**
   * Batch-first API for decrypting messages
   */
  async decryptMessages(messages: ApiMessage[]): Promise<(DecryptedMessage | null)[]> {
    logger.debug('decryptMessages start', { sessionId: this.sessionId, count: messages.length });
    // Check cache for all messages first
    const results: (DecryptedMessage | null)[] = new Array(messages.length);
    const toDecrypt: { index: number; message: ApiMessage }[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) {
        results[i] = null;
        continue;
      }

      // Check cache first
      const cached = this.cache.getCachedMessage(message.id);
      if (cached) {
        results[i] = cached;
      } else if (message.content.t === 'encrypted') {
        toDecrypt.push({ index: i, message });
      } else {
        // Not encrypted or invalid
        results[i] = {
          id: message.id,
          seq: message.seq,

          content: null,
          createdAt: message.createdAt,
        };
        this.cache.setCachedMessage(message.id, results[i]!);
      }
    }

    // Batch decrypt uncached messages
    if (toDecrypt.length > 0) {
      logger.debug('decryptMessages batch', {
        sessionId: this.sessionId,
        toDecrypt: toDecrypt.length,
        cached: messages.length - toDecrypt.length,
      });
      const wireStrs = toDecrypt.map(item => item.message.content.c);
      const decrypted = await wireDecodeBatch(wireStrs, this.encryptor);

      for (let i = 0; i < toDecrypt.length; i++) {
        const decryptedData = decrypted[i];
        const { message, index } = toDecrypt[i];

        const result: DecryptedMessage = {
          id: message.id,
          seq: message.seq,

          content: decryptedData ?? null,
          createdAt: message.createdAt,
          traceId: message.traceId ?? undefined,
        };
        this.cache.setCachedMessage(message.id, result);
        results[index] = result;
      }
    }

    logger.debug('decryptMessages done', { sessionId: this.sessionId, count: results.length });
    return results;
  }

  /**
   * Single message convenience method
   */
  async decryptMessage(message: ApiMessage | null | undefined): Promise<DecryptedMessage | null> {
    if (!message) {
      return null;
    }
    const results = await this.decryptMessages([message]);
    return results[0];
  }

  /**
   * Encrypt a raw record
   */
  async encryptRawRecord(record: RawRecord): Promise<string> {
    logger.debug('encryptRawRecord', { sessionId: this.sessionId });
    return wireEncode(record, this.encryptor, !!config.isDev);
  }

  /**
   * Encrypt raw data using session-specific encryption
   */
  async encryptRaw(data: any): Promise<string> {
    return wireEncode(data, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt raw data using session-specific encryption
   */
  async decryptRaw(encrypted: string): Promise<any | null> {
    try {
      return await wireDecode(encrypted, this.encryptor);
    } catch (error) {
      logger.error('decryptRaw failed', toError(error), { sessionId: this.sessionId });
      return null;
    }
  }

  /**
   * Encrypt metadata using session-specific encryption
   */
  async encryptMetadata(metadata: Metadata): Promise<string> {
    return wireEncode(metadata, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt metadata using session-specific encryption
   */
  async decryptMetadata(version: number, encrypted: string): Promise<Metadata | null> {
    // Check cache first
    const cached = this.cache.getCachedMetadata(this.sessionId, version);
    if (cached) {
      return cached;
    }

    const decrypted = await wireDecode(encrypted, this.encryptor);
    if (!decrypted) {
      return null;
    }
    const parsed = MetadataSchema.safeParse(decrypted);
    if (!parsed.success) {
      logger.error('decryptMetadata parse failed', undefined, {
        sessionId: this.sessionId,
        version,
      });
      return null;
    }

    // Cache the result
    this.cache.setCachedMetadata(this.sessionId, version, parsed.data);
    return parsed.data;
  }

  /**
   * Encrypt agent state using session-specific encryption
   */
  async encryptAgentState(state: AgentState): Promise<string> {
    return wireEncode(state, this.encryptor, !!config.isDev);
  }

  /**
   * Decrypt agent state using session-specific encryption
   */
  async decryptAgentState(
    version: number,
    encrypted: string | null | undefined
  ): Promise<AgentState> {
    if (!encrypted) {
      return {};
    }

    // Check cache first
    const cached = this.cache.getCachedAgentState(this.sessionId, version);
    if (cached) {
      return cached;
    }

    const decrypted = await wireDecode(encrypted, this.encryptor);
    if (!decrypted) {
      return {};
    }
    const parsed = AgentStateSchema.safeParse(decrypted);
    if (!parsed.success) {
      logger.error('decryptAgentState parse failed', undefined, {
        sessionId: this.sessionId,
        version,
      });
      return {};
    }

    // Cache the result
    this.cache.setCachedAgentState(this.sessionId, version, parsed.data);
    return parsed.data;
  }

  async decryptCapabilities(
    version: number,
    encrypted: string | null | undefined
  ): Promise<SessionCapabilities | null> {
    if (!encrypted) {
      return null;
    }

    const cached = this.cache.getCachedCapabilities(this.sessionId, version);
    if (cached) {
      return cached;
    }

    const decrypted = await wireDecode(encrypted, this.encryptor);
    if (!decrypted) {
      return null;
    }

    const parsed = SessionCapabilitiesSchema.safeParse(decrypted);
    if (!parsed.success) {
      logger.error('decryptCapabilities parse failed', undefined, {
        sessionId: this.sessionId,
        version,
      });
      return null;
    }

    this.cache.setCachedCapabilities(this.sessionId, version, parsed.data);
    return parsed.data;
  }
}
