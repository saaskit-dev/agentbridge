import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('daemon/sessions/cleanAttachments');

/**
 * Remove attachment files older than maxAgeDays from the given directory.
 * Called once at Daemon startup to clean up leftover files from previous runs.
 */
export async function cleanStaleAttachments(dir: string, maxAgeDays = 7): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory doesn't exist yet — nothing to clean
    return;
  }

  const cutoffMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;

  for (const name of entries) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > cutoffMs) {
        await fs.unlink(filePath);
        removed++;
      }
    } catch (err) {
      logger.warn('[cleanStaleAttachments] failed to check/remove file', {
        filePath,
        error: String(err),
      });
    }
  }

  if (removed > 0) {
    logger.info('[cleanStaleAttachments] removed stale attachments', { dir, removed });
  }
}
