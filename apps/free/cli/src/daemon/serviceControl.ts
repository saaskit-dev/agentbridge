/**
 * System service control for daemon
 * Maps start/stop commands to launchctl (macOS) or systemctl (Linux)
 */

import { execSync } from 'child_process';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('daemon/serviceControl');

const MAC_PLIST_FILE = `${process.env.HOME}/Library/LaunchAgents/app.saaskit.free.daemon.plist`;
const LINUX_SERVICE_NAME = 'free-daemon';

function isMacOS(): boolean {
  return process.platform === 'darwin';
}

function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Start the daemon via system service manager
 */
export async function startDaemonService(): Promise<{ success: boolean; message: string }> {
  try {
    if (isMacOS()) {
      logger.debug('[SERVICE] Starting daemon via launchctl...');
      execSync(`launchctl load ${MAC_PLIST_FILE}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon started via LaunchAgent' };
    }

    if (isLinux()) {
      logger.debug('[SERVICE] Starting daemon via systemctl...');
      execSync(`systemctl --user start ${LINUX_SERVICE_NAME}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon started via systemd' };
    }

    return { success: false, message: `Unsupported platform: ${process.platform}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('[SERVICE] Failed to start daemon service:', error);
    return { success: false, message: `Failed to start daemon: ${message}` };
  }
}

/**
 * Stop the daemon via system service manager
 */
export async function stopDaemonService(): Promise<{ success: boolean; message: string }> {
  try {
    if (isMacOS()) {
      logger.debug('[SERVICE] Stopping daemon via launchctl...');
      execSync(`launchctl unload ${MAC_PLIST_FILE}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon stopped via LaunchAgent' };
    }

    if (isLinux()) {
      logger.debug('[SERVICE] Stopping daemon via systemctl...');
      execSync(`systemctl --user stop ${LINUX_SERVICE_NAME}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon stopped via systemd' };
    }

    return { success: false, message: `Unsupported platform: ${process.platform}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('[SERVICE] Failed to stop daemon service:', error);
    return { success: false, message: `Failed to stop daemon: ${message}` };
  }
}

/**
 * Check if the daemon service is installed
 */
export function isDaemonServiceInstalled(): boolean {
  try {
    if (isMacOS()) {
      const { existsSync } = require('fs');
      return existsSync(MAC_PLIST_FILE);
    }

    if (isLinux()) {
      const { existsSync } = require('fs');
      const serviceFile = `${process.env.HOME}/.config/systemd/user/${LINUX_SERVICE_NAME}.service`;
      return existsSync(serviceFile);
    }

    return false;
  } catch {
    return false;
  }
}
