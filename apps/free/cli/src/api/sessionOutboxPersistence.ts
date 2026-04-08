import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { configuration } from '@/configuration';
import type { WireTrace } from './types';

const logger = new Logger('api/sessionOutboxPersistence');

export interface PendingOutboxMessage {
  id: string;
  content: string;
  _trace?: WireTrace;
}

function outboxDir(): string {
  return join(configuration.freeHomeDir, 'session-outbox');
}

function outboxFile(sessionId: string): string {
  return join(outboxDir(), `${sessionId}.json`);
}

async function ensureOutboxDir(): Promise<void> {
  await mkdir(outboxDir(), { recursive: true });
}

export async function loadPendingSessionOutbox(sessionId: string): Promise<PendingOutboxMessage[]> {
  try {
    const raw = await readFile(outboxFile(sessionId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn('[outbox] ignoring non-array persisted payload', { sessionId });
      return [];
    }
    const messages = parsed.filter(
      (value: unknown): value is PendingOutboxMessage =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as PendingOutboxMessage).id === 'string' &&
        typeof (value as PendingOutboxMessage).content === 'string'
    );
    if (messages.length !== parsed.length) {
      logger.warn('[outbox] ignored invalid persisted entries', {
        sessionId,
        persistedCount: parsed.length,
        validCount: messages.length,
      });
    }
    return messages;
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
  const tempFile = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(messages), 'utf-8');
  await chmod(tempFile, 0o600);
  await rename(tempFile, target);
}
