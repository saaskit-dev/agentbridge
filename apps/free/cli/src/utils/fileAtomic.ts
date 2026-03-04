/**
 * Atomic file write utility
 * Ensures file writes are atomic using temp file + rename pattern
 */

import { randomUUID } from 'crypto';
import { writeFile, rename, unlink } from 'fs/promises';

export async function atomicFileWrite(filePath: string, content: string): Promise<void> {
  const tmpFile = `${filePath}.${randomUUID()}.tmp`;

  try {
    // Write to temp file
    await writeFile(tmpFile, content);

    // Atomic rename (on POSIX systems)
    await rename(tmpFile, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tmpFile);
    } catch {}
    throw error;
  }
}
