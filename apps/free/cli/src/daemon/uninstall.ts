import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/uninstall');

/**
 * Uninstall the daemon service.
 * Only user-level LaunchAgent/systemd service is supported (no sudo required).
 */
export async function uninstall(): Promise<void> {
  if (process.platform === 'darwin') {
    const { uninstallUserAgent } = await import('./mac/installUser');
    await uninstallUserAgent();
  } else if (process.platform === 'linux') {
    const { uninstallUserAgent } = await import('./linux/installUser');
    await uninstallUserAgent();
  } else {
    throw new Error(
      `Daemon uninstallation is not supported on ${process.platform}. Supported platforms: macOS, Linux`
    );
  }
}
