/**
 * Session-specific encryption manager
 * 
 * Handles batch decryption/encryption of session messages and metadata.
 * Uses an encryption cache for performance.
 */

import type { Cipher } from './types';
import { encodeBase64, decodeBase64 } from '../utils/encoding';

/** Simple LRU cache for decrypted data */
/** Simple LRU cache for decrypted data */
class EncryptionCache {
  private messageCache = new Map<string, unknown>();
  private metadataCache = new Map<string, unknown>();
  private agentStateCache = new Map<string, unknown>();
  private maxSize = 1000;

  getCachedMessage(messageId: string): unknown | null {
    return this.messageCache.get(messageId) ?? null;
  }

  setCachedMessage(messageId: string, data: unknown): void {
    if (this.messageCache.size >= this.maxSize) {
      const firstKey = this.messageCache.keys().next().value;
      if (firstKey) this.messageCache.delete(firstKey);
    }
    this.messageCache.set(messageId, data);
  }

  getCachedMetadata(sessionId: string, version: number): unknown | null {
    const key = `${sessionId}:${version}`;
    return this.metadataCache.get(key) ?? null;
  }

  setCachedMetadata(sessionId: string, version: number, data: unknown): void {
    const key = `${sessionId}:${version}`;
    this.metadataCache.set(key, data);
  }

  getCachedAgentState(sessionId: string, version: number): unknown | null {
    const key = `${sessionId}:${version}`;
    return this.agentStateCache.get(key) ?? null;
  }

  setCachedAgentState(sessionId: string, version: number, data: unknown): void {
    const key = `${sessionId}:${version}`;
    this.agentStateCache.set(key, data);
  }

  clearSessionCache(sessionId: string): void {
    for (const key of this.metadataCache.keys()) {
      if (key.startsWith(sessionId)) {
        this.metadataCache.delete(key);
      }
    }
    for (const key of this.agentStateCache.keys()) {
      if (key.startsWith(sessionId)) {
        this.agentStateCache.delete(key);
      }
    }
  }
}

/** API message structure */
interface ApiMessage {
  id: string;
  seq: number;
  localId?: string;
  content: { t: string; c: string };
  createdAt: number;
}

/** Decrypted message result */
export interface DecryptedMessage {
  id: string;
  seq: number;
  localId: string | null;
  content: unknown | null;
  createdAt: number;
}

/**
 * Session encryption manager
 */
export class SessionEncryption {
  private sessionId: string;
  private cipher: Cipher;
  private cache: EncryptionCache;

  constructor(sessionId: string, cipher: Cipher, cache?: EncryptionCache) {
    this.sessionId = sessionId;
    this.cipher = cipher;
    this.cache = cache ?? new EncryptionCache();
  }

  async decryptMessages(messages: ApiMessage[]): Promise<(DecryptedMessage | null)[]> {
    const results: (DecryptedMessage | null)[] = new Array(messages.length);
    const toDecrypt: { index: number; message: ApiMessage }[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) {
        results[i] = null;
        continue;
      }

      const cached = this.cache.getCachedMessage(message.id);
      if (cached) {
        results[i] = cached as DecryptedMessage;
      } else if (message.content.t === 'encrypted') {
        toDecrypt.push({ index: i, message });
      } else {
        results[i] = {
          id: message.id,
          seq: message.seq,
          localId: message.localId ?? null,
          content: null,
          createdAt: message.createdAt,
        };
        this.cache.setCachedMessage(message.id, results[i]);
      }
    }

    if (toDecrypt.length > 0) {
      const encrypted = toDecrypt.map(item =>
        decodeBase64(item.message.content.c)
      );

      const decrypted = await this.cipher.decrypt(encrypted);

      for (let i = 0; i < toDecrypt.length; i++) {
        const decryptedData = decrypted[i];
        const { message, index } = toDecrypt[i];

        const result: DecryptedMessage = {
          id: message.id,
          seq: message.seq,
          localId: message.localId ?? null,
          content: decryptedData,
          createdAt: message.createdAt,
        };
        this.cache.setCachedMessage(message.id, result);
        results[index] = result;
      }
    }

    return results;
  }

  async decryptMessage(message: ApiMessage | null | undefined): Promise<DecryptedMessage | null> {
    if (!message) return null;
    const results = await this.decryptMessages([message]);
    return results[0];
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

  async encryptMetadata(metadata: unknown): Promise<string> {
    const encrypted = await this.cipher.encrypt([metadata]);
    return encodeBase64(encrypted[0]);
  }

  async decryptMetadata(version: number, encrypted: string): Promise<unknown | null> {
    const cached = this.cache.getCachedMetadata(this.sessionId, version);
    if (cached) return cached;

    const encryptedData = decodeBase64(encrypted);
    const decrypted = await this.cipher.decrypt([encryptedData]);
    if (!decrypted[0]) return null;

    this.cache.setCachedMetadata(this.sessionId, version, decrypted[0]);
    return decrypted[0];
  }

  async encryptAgentState(state: unknown): Promise<string> {
    const encrypted = await this.cipher.encrypt([state]);
    return encodeBase64(encrypted[0]);
  }

  async decryptAgentState(version: number, encrypted: string | null | undefined): Promise<unknown | null> {
    if (!encrypted) return null;

    const cached = this.cache.getCachedAgentState(this.sessionId, version);
    if (cached) return cached;

    const encryptedData = decodeBase64(encrypted);
    const decrypted = await this.cipher.decrypt([encryptedData]);
    if (!decrypted[0]) return null;

    this.cache.setCachedAgentState(this.sessionId, version, decrypted[0]);
    return decrypted[0];
  }
}

export { EncryptionCache };
