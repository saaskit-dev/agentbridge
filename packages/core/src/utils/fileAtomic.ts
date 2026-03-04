/**
 * Atomic file write utility
 *
 * Ensures file writes are atomic using temp file + rename pattern.
 */

import { randomUUID } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';

/**
 * Atomically write content to a file
 *
 * Uses temp file + rename pattern to ensure atomic writes on POSIX systems.
 * On Windows, rename is not guaranteed atomic but still safer than direct write.
 *
 * @param filePath - Target file path
 * @param content - Content to write
 */
export async function atomicFileWrite(
  filePath: string,
  content: string | Uint8Array
): Promise<void> {
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
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Atomically write JSON to a file
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as JSON
 * @param pretty - Whether to pretty-print (default: false)
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  pretty: boolean = false
): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await atomicFileWrite(filePath, content);
}
