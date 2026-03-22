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

/** Strip `--variant <value>` pairs injected by spawnFreeCLI for process identification. */
export function stripVariantArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--variant') {
      i++; // skip the value
    } else {
      out.push(argv[i]);
    }
  }
  return out;
}

class Configuration {
  public readonly serverUrl: string;
  public readonly webappUrl: string;
  public readonly isDaemonProcess: boolean;

  // Directories and paths — single source of truth for all freeHomeDir-derived paths
  public readonly freeHomeDir: string;
  public readonly logsDir: string;
  public readonly tmpDir: string;
  public readonly hooksDir: string;
  public readonly agentHomesDir: string;
  public readonly settingsFile: string;
  public readonly privateKeyFile: string;
  public readonly daemonStateFile: string;
  public readonly daemonLockFile: string;
  public readonly daemonSocketPath: string;
  public readonly currentCliVersion: string;

  public readonly isExperimentalEnabled: boolean;
  public readonly disableCaffeinate: boolean;
  public readonly isDev: boolean;

  /** Mirrors APP_ENV: 'development' or 'production' */
  public readonly variant: 'development' | 'production';
  /** macOS LaunchAgent label (variant-aware, e.g. app.saaskit.free.daemon-dev) */
  public readonly daemonServiceLabel: string;
  /** Linux systemd service unit name (variant-aware, e.g. free-daemon-dev) */
  public readonly daemonSystemdServiceName: string;
  /** macOS plist file path (variant-aware) */
  public readonly daemonPlistFile: string;
  /** Linux systemd service file path (variant-aware) */
  public readonly daemonSystemdFile: string;

  constructor() {
    const isDev = process.env.APP_ENV === 'development';

    // Server configuration - priority: environment > dev defaults > production defaults
    this.serverUrl = process.env.FREE_SERVER_URL || (isDev ? 'http://localhost:3000' : 'https://free-server.saaskit.app');
    this.webappUrl = process.env.FREE_WEBAPP_URL || (isDev ? 'http://localhost:8081' : 'https://free.saaskit.app');

    // Check if we're running as daemon based on process args
    const args = stripVariantArgs(process.argv.slice(2));
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
    this.tmpDir = join(this.freeHomeDir, 'tmp');
    this.hooksDir = join(this.tmpDir, 'hooks');
    this.agentHomesDir = join(this.freeHomeDir, 'agent-homes');
    this.settingsFile = join(this.freeHomeDir, 'settings.json');
    this.privateKeyFile = join(this.freeHomeDir, 'access.key');
    this.daemonStateFile = join(this.freeHomeDir, 'daemon.state.json');
    this.daemonLockFile = join(this.freeHomeDir, 'daemon.state.json.lock');
    this.daemonSocketPath = join(this.freeHomeDir, 'daemon.sock');

    this.isExperimentalEnabled = ['true', '1', 'yes'].includes(
      process.env.FREE_EXPERIMENTAL?.toLowerCase() || ''
    );
    this.disableCaffeinate = ['true', '1', 'yes'].includes(
      process.env.FREE_DISABLE_CAFFEINATE?.toLowerCase() || ''
    );
    this.isDev = process.env.APP_ENV === 'development';

    this.currentCliVersion = packageJson.version;

    // Variant detection — drives service label isolation so dev/production daemons can coexist
    this.variant = this.isDev ? 'development' : 'production';
    const variantSuffix = this.variant === 'development' ? '-dev' : '';
    this.daemonServiceLabel = `app.saaskit.free.daemon${variantSuffix}`;
    this.daemonSystemdServiceName = `free-daemon${variantSuffix}`;
    this.daemonPlistFile = join(
      homedir(),
      'Library',
      'LaunchAgents',
      `${this.daemonServiceLabel}.plist`
    );
    this.daemonSystemdFile = join(
      homedir(),
      '.config',
      'systemd',
      'user',
      `${this.daemonSystemdServiceName}.service`
    );

    // Validate variant configuration
    if (this.variant === 'development' && !this.freeHomeDir.includes('dev')) {
      console.warn('⚠️  WARNING: APP_ENV=development but FREE_HOME_DIR does not contain "dev"');
      console.warn(`   Current: ${this.freeHomeDir}`);
      console.warn(`   Expected: Should contain "dev" (e.g., ~/.free-dev)`);
    }

    // Visual indicator on CLI startup (only if not daemon process to avoid log clutter)
    // Also skip if --variant is missing — the bootstrap re-exec in index.ts will re-run us with it
    if (
      !this.isDaemonProcess &&
      this.variant === 'development' &&
      process.argv.includes('--variant')
    ) {
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
