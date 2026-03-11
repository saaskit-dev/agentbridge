import { uninstall as uninstallMac } from './mac/installUser';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/uninstall');

/**
 * Uninstall the daemon service.
 * Note: This uninstalls the user-level LaunchAgent, not the system-level LaunchDaemon.
 */
export async function uninstall(): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`Daemon uninstallation is not supported on ${process.platform}. Supported platforms: macOS, Linux`);
  }

  logger.info('Uninstalling Free CLI daemon...');

  if (process.platform === 'darwin') {
    await uninstallMac();
  } else if (process.platform === 'linux') {
    const linux = await import('./linux/installUser');
    await linux.uninstallUserAgent();
  }
}
