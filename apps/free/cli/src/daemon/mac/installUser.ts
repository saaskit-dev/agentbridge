/**
 * User-level installation for Free daemon using macOS LaunchAgents
 *
 * This installs a LaunchAgent that:
 * 1. Starts automatically when user logs in (RunAtLoad)
 * 2. Restarts automatically if it crashes (KeepAlive)
 * 3. Does NOT require sudo (user-level service)
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { trimIdent } from '@/utils/trimIdent';

const PLIST_LABEL = 'com.free-cli.daemon';
const PLIST_FILE = `${homedir()}/Library/LaunchAgents/${PLIST_LABEL}.plist`;

export async function installUserAgent(): Promise<void> {
  try {
    // Ensure Library/LaunchAgents directory exists
    const launchAgentsDir = `${homedir()}/Library/LaunchAgents`;
    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
    }

    // Stop and unload if already installed
    if (existsSync(PLIST_FILE)) {
      logger.info('Unloading existing LaunchAgent...');
      try {
        execSync(`launchctl unload ${PLIST_FILE} 2>/dev/null`, { stdio: 'pipe' });
      } catch {
        // Ignore errors if not loaded
      }
    }

    // Get the path to free CLI
    // When installed globally, process.argv[1] points to the entry script
    const freePath = process.execPath; // Node.js executable
    const scriptPath = process.argv[1]; // free CLI script

    // Get log directory
    const logDir = `${configuration.freeHomeDir}/logs`;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Create plist content
    const plistContent = trimIdent(`
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
                <key>Label</key>
                <string>${PLIST_LABEL}</string>

                <key>ProgramArguments</key>
                <array>
                    <string>${freePath}</string>
                    <string>--no-warnings</string>
                    <string>--no-deprecation</string>
                    <string>${scriptPath}</string>
                    <string>daemon</string>
                    <string>start-sync</string>
                </array>

                <key>RunAtLoad</key>
                <true/>

                <key>KeepAlive</key>
                <dict>
                    <key>SuccessfulExit</key>
                    <false/>
                    <key>Crashed</key>
                    <true/>
                </dict>

                <key>ThrottleInterval</key>
                <integer>5</integer>

                <key>StandardErrorPath</key>
                <string>${logDir}/daemon.err</string>

                <key>StandardOutPath</key>
                <string>${logDir}/daemon.out</string>

                <key>WorkingDirectory</key>
                <string>${homedir()}</string>

                <key>ProcessType</key>
                <string>Interactive</string>

                <key>EnvironmentVariables</key>
                <dict>
                    <key>PATH</key>
                    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
                </dict>
            </dict>
            </plist>
        `);

    // Write plist file
    writeFileSync(PLIST_FILE, plistContent);

    logger.info(`Created LaunchAgent at ${PLIST_FILE}`);

    // Load the agent
    execSync(`launchctl load ${PLIST_FILE}`, { stdio: 'inherit' });

    logger.info('LaunchAgent installed and started successfully!');
    logger.info('');
    logger.info('Features enabled:');
    logger.info('  ✓ Auto-start on login');
    logger.info('  ✓ Auto-restart on crash');
    logger.info('');
    logger.info(`Logs: ${logDir}/`);
    logger.info('');
    logger.info('Commands:');
    logger.info('  View status: launchctl list | grep free-cli');
    logger.info('  Stop: launchctl unload ' + PLIST_FILE);
    logger.info('  Start: launchctl load ' + PLIST_FILE);
  } catch (error) {
    logger.debug('Failed to install LaunchAgent:', error);
    throw error;
  }
}

export async function uninstallUserAgent(): Promise<void> {
  try {
    if (existsSync(PLIST_FILE)) {
      logger.info('Unloading LaunchAgent...');
      try {
        execSync(`launchctl unload ${PLIST_FILE} 2>/dev/null`, { stdio: 'pipe' });
      } catch {
        // Ignore errors if not loaded
      }

      logger.info('Removing LaunchAgent plist...');
      unlinkSync(PLIST_FILE);
      logger.info('LaunchAgent uninstalled successfully');
    } else {
      logger.info('LaunchAgent is not installed');
    }
  } catch (error) {
    logger.debug('Failed to uninstall LaunchAgent:', error);
    throw error;
  }
}

export function isUserAgentInstalled(): boolean {
  return existsSync(PLIST_FILE);
}
