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

// SERVICE_NAME and SERVICE_FILE are derived from configuration at call time
// so that dev and production variants get separate systemd services

export async function installUserAgent(): Promise<void> {
  const SERVICE_NAME = configuration.daemonSystemdServiceName;
  const SERVICE_FILE = configuration.daemonSystemdFile;

  try {
    // Ensure systemd user directory exists
    const systemdDir = `${homedir()}/.config/systemd/user`;
    if (!existsSync(systemdDir)) {
      mkdirSync(systemdDir, { recursive: true });
    }

    // Get the path to free CLI
    const freePath = process.execPath; // Node.js executable
    const scriptPath = process.argv[1]; // free CLI script

    const logDir = configuration.logsDir;

    // Build environment block — capture current env so daemon inherits the correct variant
    const envLines = [
      `Environment="PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}"`,
    ];
    if (process.env.FREE_HOME_DIR)
      envLines.push(`Environment="FREE_HOME_DIR=${process.env.FREE_HOME_DIR}"`);
    envLines.push(`Environment="APP_ENV=${configuration.variant}"`);
    if (process.env.FREE_SERVER_URL)
      envLines.push(`Environment="FREE_SERVER_URL=${process.env.FREE_SERVER_URL}"`);
    if (process.env.FREE_WEBAPP_URL)
      envLines.push(`Environment="FREE_WEBAPP_URL=${process.env.FREE_WEBAPP_URL}"`);

    // Create systemd service file
    const serviceContent = `[Unit]
Description=Free CLI Daemon${configuration.variant === 'development' ? ' (dev)' : ''}
After=network.target

[Service]
Type=simple
ExecStart=${freePath} --no-warnings --no-deprecation ${scriptPath} --variant ${configuration.variant} daemon start-sync
WorkingDirectory=${homedir()}
Restart=always
RestartSec=5

# Logging
StandardOutput=append:${logDir}/daemon-stdout.log
StandardError=append:${logDir}/daemon-stderr.log

# Environment
${envLines.join('\n')}

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
    logger.info(`  View status: systemctl --user status ${SERVICE_NAME}`);
    logger.info(`  View logs: journalctl --user -u ${SERVICE_NAME} -f`);
    logger.info(`  Stop: systemctl --user stop ${SERVICE_NAME}`);
    logger.info(`  Start: systemctl --user start ${SERVICE_NAME}`);
    logger.info(`  Disable auto-start: systemctl --user disable ${SERVICE_NAME}`);
  } catch (error) {
    logger.debug('Failed to install systemd service:', error);
    throw error;
  }
}

export async function uninstallUserAgent(): Promise<void> {
  const SERVICE_NAME = configuration.daemonSystemdServiceName;
  const SERVICE_FILE = configuration.daemonSystemdFile;

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
  return existsSync(configuration.daemonSystemdFile);
}
