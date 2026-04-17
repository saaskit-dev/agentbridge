import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { configuration } from '@/configuration';
import type { WireTrace } from './types';

const logger = new Logger('api/sessionOutboxPersistence');
const MAX_PERSISTED_OUTBOX_MESSAGES = 200;
const MAX_PERSISTED_OUTBOX_CHARS = 2_000_000;
const NEWLINE_CHAR_COUNT = 1;

export interface PendingOutboxMessage {
  id: string;
  content: string;
  _trace?: WireTrace;
}

export interface PendingOutboxPlaceholder {
  type: 'persisted-outbox-placeholder';
  originalMessageId: string;
  reason: 'message_too_large' | 'serialization_failed';
  originalContentLength: number;
  createdAt: number;
  error?: string;
}

export type PendingOutboxEntry = PendingOutboxMessage | PendingOutboxPlaceholder;

type SerializedOutbox = {
  serialized: string;
  omittedCount: number;
};

function outboxDir(): string {
  return join(configuration.freeHomeDir, 'session-outbox');
}

function outboxFile(sessionId: string): string {
  return join(outboxDir(), `${sessionId}.json`);
}

async function ensureOutboxDir(): Promise<void> {
  await mkdir(outboxDir(), { recursive: true });
}

function isPendingOutboxMessage(value: unknown): value is PendingOutboxMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PendingOutboxMessage).id === 'string' &&
    typeof (value as PendingOutboxMessage).content === 'string'
  );
}

function isPendingOutboxPlaceholder(value: unknown): value is PendingOutboxPlaceholder {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PendingOutboxPlaceholder).type === 'persisted-outbox-placeholder' &&
    typeof (value as PendingOutboxPlaceholder).originalMessageId === 'string' &&
    ((value as PendingOutboxPlaceholder).reason === 'message_too_large' ||
      (value as PendingOutboxPlaceholder).reason === 'serialization_failed') &&
    typeof (value as PendingOutboxPlaceholder).originalContentLength === 'number' &&
    typeof (value as PendingOutboxPlaceholder).createdAt === 'number'
  );
}

function parseLegacyJsonArray(raw: string, sessionId: string): PendingOutboxEntry[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn('[outbox] ignoring non-array persisted payload', { sessionId });
      return [];
    }
    const messages = parsed.filter(isPendingOutboxMessage);
    if (messages.length !== parsed.length) {
      logger.warn('[outbox] ignored invalid persisted entries', {
        sessionId,
        persistedCount: parsed.length,
        validCount: messages.length,
      });
    }
    return messages;
  } catch {
    return null;
  }
}

function parseNdjson(raw: string, sessionId: string): PendingOutboxEntry[] {
  const messages: PendingOutboxEntry[] = [];
  const lines = raw.split('\n');
  let invalidCount = 0;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (isPendingOutboxMessage(parsed)) {
        messages.push(parsed);
      } else if (isPendingOutboxPlaceholder(parsed)) {
        messages.push(parsed);
      } else {
        invalidCount += 1;
      }
    } catch {
      invalidCount += 1;
    }
  }

  if (invalidCount > 0) {
    logger.warn('[outbox] ignored invalid persisted ndjson entries', {
      sessionId,
      invalidCount,
      validCount: messages.length,
    });
  }

  return messages;
}

function createPlaceholder(
  message: PendingOutboxMessage,
  reason: PendingOutboxPlaceholder['reason'],
  error?: string
): PendingOutboxPlaceholder {
  return {
    type: 'persisted-outbox-placeholder',
    originalMessageId: message.id,
    reason,
    originalContentLength: message.content.length,
    createdAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

function serializeForPersistence(messages: PendingOutboxMessage[], sessionId: string): SerializedOutbox | null {
  const candidate = messages.slice(-MAX_PERSISTED_OUTBOX_MESSAGES);
  const serializedLines: string[] = [];
  let serializedCharCount = 0;
  let placeholderCount = 0;
  let droppedCount = 0;

  for (const message of candidate.slice().reverse()) {
    let serializedMessage: string | null = null;
    try {
      serializedMessage = JSON.stringify(message);
    } catch (error) {
      logger.warn('[outbox] skipped message that could not be serialized', {
        sessionId,
        messageId: message.id,
        error: String(error),
      });
      serializedMessage = JSON.stringify(
        createPlaceholder(message, 'serialization_failed', String(error))
      );
      placeholderCount += 1;
    }

    const projectedCharCount =
      serializedCharCount +
      serializedMessage.length +
      (serializedLines.length > 0 ? NEWLINE_CHAR_COUNT : 0);
    if (projectedCharCount > MAX_PERSISTED_OUTBOX_CHARS) {
      const placeholderSerialized = JSON.stringify(createPlaceholder(message, 'message_too_large'));
      const placeholderProjectedCharCount =
        serializedCharCount +
        placeholderSerialized.length +
        (serializedLines.length > 0 ? NEWLINE_CHAR_COUNT : 0);
      if (placeholderProjectedCharCount > MAX_PERSISTED_OUTBOX_CHARS) {
        droppedCount += 1;
        continue;
      }
      serializedMessage = placeholderSerialized;
      placeholderCount += 1;
      serializedCharCount = placeholderProjectedCharCount;
      serializedLines.unshift(serializedMessage);
      continue;
    }

    serializedLines.unshift(serializedMessage);
    serializedCharCount = projectedCharCount;
  }

  if (serializedLines.length === 0) {
    logger.error('[outbox] skipped persistence because no queue entries fit within safety limits', undefined, {
      sessionId,
      originalCount: messages.length,
    });
    return null;
  }

  const omittedCount = messages.length - serializedLines.length;
  if (omittedCount > 0 || placeholderCount > 0 || droppedCount > 0) {
    logger.warn('[outbox] trimmed persisted queue to stay within safety limits', {
      sessionId,
      originalCount: messages.length,
      persistedCount: serializedLines.length,
      omittedCount,
      placeholderCount,
      droppedCount,
      serializedLength: serializedCharCount,
    });
  }

  return {
    serialized: serializedLines.join('\n'),
    omittedCount,
  };
}

export async function loadPendingSessionOutbox(sessionId: string): Promise<PendingOutboxEntry[]> {
  try {
    const raw = await readFile(outboxFile(sessionId), 'utf-8');
    const legacyMessages = parseLegacyJsonArray(raw, sessionId);
    if (legacyMessages) {
      return legacyMessages;
    }
    return parseNdjson(raw, sessionId);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    logger.error('[outbox] failed to load persisted queue', undefined, {
      sessionId,
      error: String(error),
    });
    return [];
  }
}

export async function persistPendingSessionOutbox(
  sessionId: string,
  messages: PendingOutboxMessage[]
): Promise<void> {
  const target = outboxFile(sessionId);
  if (messages.length === 0) {
    try {
      await unlink(target);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }

  await ensureOutboxDir();
  const serialized = serializeForPersistence(messages, sessionId);
  if (!serialized) {
    try {
      await unlink(target);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }
  const tempFile = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, serialized.serialized, 'utf-8');
  await chmod(tempFile, 0o600);
  await rename(tempFile, target);
}
