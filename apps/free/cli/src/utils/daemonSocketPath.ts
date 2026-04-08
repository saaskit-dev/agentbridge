import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const MAX_UNIX_SOCKET_PATH_LENGTH = 103;

function createSocketId(freeHomeDir: string, variant: 'development' | 'production'): string {
  return createHash('sha256')
    .update(`${variant}:${freeHomeDir}`)
    .digest('hex')
    .slice(0, 12);
}

export function getDaemonSocketPath(
  freeHomeDir: string,
  variant: 'development' | 'production'
): string {
  if (process.env.FREE_DAEMON_SOCKET_PATH) {
    return process.env.FREE_DAEMON_SOCKET_PATH;
  }

  const socketId = createSocketId(freeHomeDir, variant);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\free-daemon-${socketId}`;
  }

  // Unix domain sockets have a strict path-length limit, especially on macOS.
  // Use a short stable path under /tmp instead of FREE_HOME_DIR, which may be deep.
  const socketPath = `/tmp/free-daemon-${socketId}.sock`;
  if (socketPath.length > MAX_UNIX_SOCKET_PATH_LENGTH) {
    throw new Error(
      `Daemon socket path too long: ${socketPath.length} (${basename(socketPath)})`
    );
  }

  return socketPath;
}
