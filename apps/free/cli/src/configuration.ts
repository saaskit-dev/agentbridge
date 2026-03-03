/**
 * Global configuration for free CLI
 *
 * Centralizes all configuration including environment variables and paths
 * Environment files should be loaded using Node's --env-file flag
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import packageJson from '../package.json';

class Configuration {
  public readonly serverUrl: string;
  public readonly webappUrl: string;
  public readonly isDaemonProcess: boolean;

  // Directories and paths (from persistence)
  public readonly freeHomeDir: string;
  public readonly logsDir: string;
  public readonly settingsFile: string;
  public readonly privateKeyFile: string;
  public readonly daemonStateFile: string;
  public readonly daemonLockFile: string;
  public readonly currentCliVersion: string;

  public readonly isExperimentalEnabled: boolean;
  public readonly disableCaffeinate: boolean;

  constructor() {
    // Server configuration - priority: environment > default (localhost for development)
    this.serverUrl = process.env.FREE_SERVER_URL || 'http://localhost:3000';
    this.webappUrl = process.env.FREE_WEBAPP_URL || 'http://localhost:8081';

    // Check if we're running as daemon based on process args
    const args = process.argv.slice(2);
    this.isDaemonProcess = args.length >= 2 && args[0] === 'daemon' && args[1] === 'start-sync';

    // Directory configuration - Priority: FREE_HOME_DIR env > default home dir
    if (process.env.FREE_HOME_DIR) {
      // Expand ~ to home directory if present
      const expandedPath = process.env.FREE_HOME_DIR.replace(/^~/, homedir());
      this.freeHomeDir = expandedPath;
    } else {
      this.freeHomeDir = join(homedir(), '.free');
    }

    this.logsDir = join(this.freeHomeDir, 'logs');
    this.settingsFile = join(this.freeHomeDir, 'settings.json');
    this.privateKeyFile = join(this.freeHomeDir, 'access.key');
    this.daemonStateFile = join(this.freeHomeDir, 'daemon.state.json');
    this.daemonLockFile = join(this.freeHomeDir, 'daemon.state.json.lock');

    this.isExperimentalEnabled = ['true', '1', 'yes'].includes(
      process.env.FREE_EXPERIMENTAL?.toLowerCase() || ''
    );
    this.disableCaffeinate = ['true', '1', 'yes'].includes(
      process.env.FREE_DISABLE_CAFFEINATE?.toLowerCase() || ''
    );

    this.currentCliVersion = packageJson.version;

    // Validate variant configuration
    const variant = process.env.FREE_VARIANT || 'stable';
    if (variant === 'dev' && !this.freeHomeDir.includes('dev')) {
      console.warn('⚠️  WARNING: FREE_VARIANT=dev but FREE_HOME_DIR does not contain "dev"');
      console.warn(`   Current: ${this.freeHomeDir}`);
      console.warn(`   Expected: Should contain "dev" (e.g., ~/.free-dev)`);
    }

    // Visual indicator on CLI startup (only if not daemon process to avoid log clutter)
    if (!this.isDaemonProcess && variant === 'dev') {
      console.log('\x1b[33m🔧 DEV MODE\x1b[0m - Data: ' + this.freeHomeDir);
    }

    if (!existsSync(this.freeHomeDir)) {
      mkdirSync(this.freeHomeDir, { recursive: true });
    }
    // Ensure directories exist
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }
}

export const configuration: Configuration = new Configuration();
