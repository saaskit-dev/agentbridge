import { describe, expect, it, vi, afterEach } from 'vitest';
import { getDaemonSocketPath } from './daemonSocketPath';

describe('getDaemonSocketPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a short stable unix socket path by default', () => {
    const socketPath = getDaemonSocketPath(
      '/very/long/path/that/would/overflow/a/unix/domain/socket/path/if/we/used/free-home-directly',
      'development'
    );

    expect(socketPath).toMatch(/^\/tmp\/free-daemon-[0-9a-f]{12}\.sock$/);
    expect(socketPath.length).toBeLessThanOrEqual(103);
  });

  it('honors explicit socket path overrides', () => {
    vi.stubEnv('FREE_DAEMON_SOCKET_PATH', '/tmp/custom-free.sock');

    expect(getDaemonSocketPath('/tmp/free', 'production')).toBe('/tmp/custom-free.sock');
  });
});
