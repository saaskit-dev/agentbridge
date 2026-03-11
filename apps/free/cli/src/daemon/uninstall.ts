import { uninstall as uninstallMac } from './mac/uninstall';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/uninstall');

export async function uninstall(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Daemon uninstallation is currently only supported on macOS');
  }

  if (process.getuid && process.getuid() !== 0) {
    throw new Error('Daemon uninstallation requires sudo privileges. Please run with sudo.');
  }

  logger.info('Uninstalling Free CLI daemon for macOS...');
  await uninstallMac();
}
