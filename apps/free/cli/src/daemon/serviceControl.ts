/**
 * System service control for daemon
 * Maps start/stop commands to launchctl (macOS) or systemctl (Linux)
 */

import { execSync } from 'child_process';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { configuration } from '@/configuration';

const logger = new Logger('daemon/serviceControl');

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
      execSync(`launchctl load ${configuration.daemonPlistFile}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon started via LaunchAgent' };
    }

    if (isLinux()) {
      logger.debug('[SERVICE] Starting daemon via systemctl...');
      execSync(`systemctl --user start ${configuration.daemonSystemdServiceName}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon started via systemd' };
    }

    return { success: false, message: `Unsupported platform: ${process.platform}` };
  } catch (error) {
    const message = safeStringify(error);
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
      execSync(`launchctl unload ${configuration.daemonPlistFile}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon stopped via LaunchAgent' };
    }

    if (isLinux()) {
      logger.debug('[SERVICE] Stopping daemon via systemctl...');
      execSync(`systemctl --user stop ${configuration.daemonSystemdServiceName}`, { stdio: 'pipe' });
      return { success: true, message: 'Daemon stopped via systemd' };
    }

    return { success: false, message: `Unsupported platform: ${process.platform}` };
  } catch (error) {
    const message = safeStringify(error);
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
      return existsSync(configuration.daemonPlistFile);
    }

    if (isLinux()) {
      const { existsSync } = require('fs');
      return existsSync(configuration.daemonSystemdFile);
    }

    return false;
  } catch {
    return false;
  }
}
