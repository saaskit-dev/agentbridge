/**
 * User-level installation for Free daemon using Linux systemd user services
 *
 * This installs a systemd user service that:
 * 1. Starts automatically when user logs in (enabled)
 * 2. Restarts automatically if it crashes (Restart=always)
 * 3. Does NOT require sudo (user-level service)
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/linux/installUser');

const SERVICE_NAME = 'free-daemon';
const SERVICE_FILE = `${homedir()}/.config/systemd/user/${SERVICE_NAME}.service`;

export async function installUserAgent(): Promise<void> {
  try {
    // Ensure systemd user directory exists
    const systemdDir = `${homedir()}/.config/systemd/user`;
    if (!existsSync(systemdDir)) {
      mkdirSync(systemdDir, { recursive: true });
    }

    // Get the path to free CLI
    const freePath = process.execPath; // Node.js executable
    const scriptPath = process.argv[1]; // free CLI script

    // Get log directory
    const logDir = `${configuration.freeHomeDir}/logs`;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Create systemd service file
    const serviceContent = `[Unit]
Description=Free CLI Daemon
After=network.target

[Service]
Type=simple
ExecStart=${freePath} --no-warnings --no-deprecation ${scriptPath} daemon start-sync
WorkingDirectory=${homedir()}
Restart=always
RestartSec=5

# Logging
StandardOutput=append:${logDir}/daemon.out
StandardError=append:${logDir}/daemon.err

# Environment
Environment="PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

[Install]
WantedBy=default.target
`;

    // Write service file
    writeFileSync(SERVICE_FILE, serviceContent);

    logger.info(`Created systemd service at ${SERVICE_FILE}`);

    // Reload systemd daemon
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });

    // Enable the service (auto-start on login)
    execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'inherit' });

    // Start the service
    execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'inherit' });

    logger.info('Systemd service installed and started successfully!');
    logger.info('');
    logger.info('Features enabled:');
    logger.info('  ✓ Auto-start on login');
    logger.info('  ✓ Auto-restart on crash (5s delay)');
    logger.info('');
    logger.info(`Logs: ${logDir}/`);
    logger.info('');
    logger.info('Commands:');
    logger.info('  View status: systemctl --user status free-daemon');
    logger.info('  View logs: journalctl --user -u free-daemon -f');
    logger.info('  Stop: systemctl --user stop free-daemon');
    logger.info('  Start: systemctl --user start free-daemon');
    logger.info('  Disable auto-start: systemctl --user disable free-daemon');
  } catch (error) {
    logger.debug('Failed to install systemd service:', error);
    throw error;
  }
}

export async function uninstallUserAgent(): Promise<void> {
  try {
    // Stop the service if running
    try {
      execSync(`systemctl --user stop ${SERVICE_NAME} 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // Ignore errors if not running
    }

    // Disable the service
    try {
      execSync(`systemctl --user disable ${SERVICE_NAME} 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // Ignore errors if not enabled
    }

    // Remove service file
    if (existsSync(SERVICE_FILE)) {
      logger.info('Removing systemd service file...');
      unlinkSync(SERVICE_FILE);
    }

    // Reload systemd daemon
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    } catch {
      // Ignore errors
    }

    logger.info('Systemd service uninstalled successfully');
  } catch (error) {
    logger.debug('Failed to uninstall systemd service:', error);
    throw error;
  }
}

export function isUserAgentInstalled(): boolean {
  return existsSync(SERVICE_FILE);
}
