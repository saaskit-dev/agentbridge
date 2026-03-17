/**
 * Doctor command implementation
 *
 * Provides comprehensive diagnostics and troubleshooting information
 * for free CLI including configuration, daemon status, logs, and links
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import packageJson from '../../package.json';
import { configuration } from '@/configuration';
import { checkIfDaemonRunningAndCleanupStaleState } from '@/daemon/controlClient';
import { findRunawayFreeProcesses, findAllFreeProcesses } from '@/daemon/doctor';
import { readSettings, readCredentials } from '@/persistence';
import { readDaemonState } from '@/persistence';
import { projectPath } from '@/projectPath';

/**
 * Get relevant environment information for debugging
 */
export function getEnvironmentInfo(): Record<string, any> {
  return {
    PWD: process.env.PWD,
    FREE_HOME_DIR: process.env.FREE_HOME_DIR,
    FREE_SERVER_URL: process.env.FREE_SERVER_URL,
    FREE_PROJECT_ROOT: process.env.FREE_PROJECT_ROOT,
    NODE_ENV: process.env.NODE_ENV,
    workingDirectory: process.cwd(),
    processArgv: process.argv,
    freeDir: configuration?.freeHomeDir,
    serverUrl: configuration?.serverUrl,
    logsDir: configuration?.logsDir,
    processPid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    user: process.env.USER,
    home: process.env.HOME,
    shell: process.env.SHELL,
    terminal: process.env.TERM,
  };
}

function getLogFiles(logDir: string): { file: string; path: string; modified: Date }[] {
  if (!existsSync(logDir)) {
    return [];
  }

  try {
    return readdirSync(logDir)
      .filter(file => file.endsWith('.log') || file.endsWith('.jsonl'))
      .map(file => {
        const path = join(logDir, file);
        const stats = statSync(path);
        return { file, path, modified: stats.mtime };
      })
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  } catch {
    return [];
  }
}

/**
 * Run doctor command specifically for daemon diagnostics
 */
export async function runDoctorDaemon(): Promise<void> {
  return runDoctorCommand('daemon');
}

export async function runDoctorCommand(filter?: 'all' | 'daemon'): Promise<void> {
  // Default to 'all' if no filter specified
  if (!filter) {
    filter = 'all';
  }

  console.log(chalk.bold.cyan('\n🩺 Free CLI Doctor\n'));

  // For 'all' filter, show everything. For 'daemon', only show daemon-related info
  if (filter === 'all') {
    // Version and basic info
    const { readBuildMeta } = await import('@/utils/buildMeta');
    const buildMeta = readBuildMeta();
    console.log(chalk.bold('📋 Basic Information'));
    console.log(`Free CLI Version: ${chalk.green(packageJson.version)}`);
    if (buildMeta.hash) console.log(`Build Hash: ${chalk.green(buildMeta.hash.substring(0, 8))}`);
    if (buildMeta.time) console.log(`Build Time: ${chalk.green(buildMeta.time)}`);
    console.log(`Platform: ${chalk.green(process.platform)} ${process.arch}`);
    console.log(`Node.js Version: ${chalk.green(process.version)}`);
    console.log('');

    // Daemon spawn diagnostics
    console.log(chalk.bold('🔧 Daemon Spawn Diagnostics'));
    const projectRoot = projectPath();
    const cliEntrypoint = join(projectRoot, 'dist', 'cli.mjs');

    console.log(`Project Root: ${chalk.blue(projectRoot)}`);
    console.log(`CLI Entrypoint: ${chalk.blue(cliEntrypoint)}`);
    console.log(
      `CLI Exists: ${existsSync(cliEntrypoint) ? chalk.green('✓ Yes') : chalk.red('❌ No')}`
    );
    console.log('');

    // Configuration
    console.log(chalk.bold('⚙️  Configuration'));
    console.log(`Free Home: ${chalk.blue(configuration.freeHomeDir)}`);
    console.log(`Server URL: ${chalk.blue(configuration.serverUrl)}`);
    console.log(`Logs Dir: ${chalk.blue(configuration.logsDir)}`);

    // Environment
    console.log(chalk.bold('\n🌍 Environment Variables'));
    const env = getEnvironmentInfo();
    console.log(
      `FREE_HOME_DIR: ${env.FREE_HOME_DIR ? chalk.green(env.FREE_HOME_DIR) : chalk.gray('not set')}`
    );
    console.log(
      `FREE_SERVER_URL: ${env.FREE_SERVER_URL ? chalk.green(env.FREE_SERVER_URL) : chalk.gray('not set')}`
    );
    console.log(`NODE_ENV: ${env.NODE_ENV ? chalk.green(env.NODE_ENV) : chalk.gray('not set')}`);

    // Settings
    try {
      const settings = await readSettings();
      console.log(chalk.bold('\n📄 Settings (settings.json):'));
      console.log(chalk.gray(JSON.stringify(settings, null, 2)));
    } catch (error) {
      console.log(chalk.bold('\n📄 Settings:'));
      console.log(chalk.red('❌ Failed to read settings'));
    }

    // Authentication status
    console.log(chalk.bold('\n🔐 Authentication'));
    try {
      const credentials = await readCredentials();
      if (credentials) {
        console.log(chalk.green('✓ Authenticated (credentials found)'));
      } else {
        console.log(chalk.yellow('⚠️  Not authenticated (no credentials)'));
      }
    } catch (error) {
      console.log(chalk.red('❌ Error reading credentials'));
    }
  }

  // Daemon status - shown for both 'all' and 'daemon' filters
  console.log(chalk.bold('\n🤖 Daemon Status'));
  try {
    const daemonCheck = await checkIfDaemonRunningAndCleanupStaleState();

    if (daemonCheck.status === 'running') {
      console.log(chalk.green('✓ Daemon is running'));
      console.log(`  PID: ${daemonCheck.pid}`);
      console.log(`  Started: ${daemonCheck.startTime}`);
      console.log(`  CLI Version: ${daemonCheck.version}`);
      if (daemonCheck.buildHash) {
        console.log(`  Build Hash: ${daemonCheck.buildHash.substring(0, 8)}`);
      }
      if (daemonCheck.buildTime) {
        console.log(`  Build Time: ${daemonCheck.buildTime}`);
      }
      if (daemonCheck.httpPort) {
        console.log(`  HTTP Port: ${daemonCheck.httpPort}`);
      }
    } else if (daemonCheck.status === 'stale') {
      console.log(chalk.yellow(`⚠️  Daemon state exists but process ${daemonCheck.pid} not running (stale)`));
    } else {
      console.log(chalk.red('❌ Daemon is not running'));
    }

    // Show daemon state file for running or stale states
    if (daemonCheck.status !== 'not_running') {
      const state = await readDaemonState();
      if (state) {
        console.log(chalk.bold('\n📄 Daemon State:'));
        console.log(chalk.blue(`Location: ${configuration.daemonStateFile}`));
        console.log(chalk.gray(JSON.stringify(state, null, 2)));
      }
    }

    // All Free processes — scoped to the current variant so dev and production don't leak into each other
    const allProcesses = await findAllFreeProcesses();
    const isDev = configuration.variant === 'development';
    const filteredProcesses = allProcesses.filter(p => {
      if (p.type === 'current') return true; // always show self
      // Show dev-* types only when running as dev, non-dev types only when running as production
      return isDev ? p.type.startsWith('dev-') : !p.type.startsWith('dev-');
    });
    if (filteredProcesses.length > 0) {
      console.log(chalk.bold('\n🔍 All Free CLI Processes'));

      // Group by type
      const grouped = filteredProcesses.reduce(
        (groups, process) => {
          if (!groups[process.type]) groups[process.type] = [];
          groups[process.type].push(process);
          return groups;
        },
        {} as Record<string, typeof filteredProcesses>
      );

      // Display each group
      Object.entries(grouped).forEach(([type, processes]) => {
        const typeLabels: Record<string, string> = {
          current: '📍 Current Process',
          daemon: '🤖 Daemon',
          'daemon-version-check': '🔍 Daemon Version Check (stuck)',
          'daemon-spawned-session': '🔗 Daemon-Spawned Sessions',
          'user-session': '👤 User Sessions',
          'dev-daemon': '🛠️  Dev Daemon',
          'dev-daemon-version-check': '🛠️  Dev Daemon Version Check (stuck)',
          'dev-session': '🛠️  Dev Sessions',
          'dev-doctor': '🛠️  Dev Doctor',
          'dev-related': '🛠️  Dev Related',
          doctor: '🩺 Doctor',
          unknown: '❓ Unknown',
        };

        console.log(chalk.blue(`\n${typeLabels[type] || type}:`));
        processes.forEach(({ pid, command }) => {
          const color =
            type === 'current'
              ? chalk.green
              : type.startsWith('dev')
                ? chalk.cyan
                : type.includes('daemon')
                  ? chalk.blue
                  : chalk.gray;
          console.log(`  ${color(`PID ${pid}`)}: ${chalk.gray(command)}`);
        });
      });
    } else {
      console.log(chalk.red('❌ No free processes found'));
    }

    if (filter === 'all' && allProcesses.length > 1) {
      // More than just current process
      console.log(chalk.bold('\n💡 Process Management'));
      console.log(chalk.gray('To clean up runaway processes: free doctor clean'));
    }
  } catch (error) {
    console.log(chalk.red('❌ Error checking daemon status'));
  }

  // Log files - only show for 'all' filter
  if (filter === 'all') {
    console.log(chalk.bold('\n📝 Log Files'));

    // Get ALL log files
    const allLogs = getLogFiles(configuration.logsDir);

    if (allLogs.length > 0) {
      // Separate daemon and regular logs
      const daemonLogs = allLogs.filter(({ file }) => file.includes('daemon'));
      const regularLogs = allLogs.filter(({ file }) => !file.includes('daemon'));

      // Show regular logs (max 10)
      if (regularLogs.length > 0) {
        console.log(chalk.blue('\nRecent Logs:'));
        const logsToShow = regularLogs.slice(0, 10);
        logsToShow.forEach(({ file, path, modified }) => {
          console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
          console.log(chalk.gray(`    ${path}`));
        });
        if (regularLogs.length > 10) {
          console.log(chalk.gray(`  ... and ${regularLogs.length - 10} more log files`));
        }
      }

      // Show daemon logs (max 5)
      if (daemonLogs.length > 0) {
        console.log(chalk.blue('\nDaemon Logs:'));
        const daemonLogsToShow = daemonLogs.slice(0, 5);
        daemonLogsToShow.forEach(({ file, path, modified }) => {
          console.log(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
          console.log(chalk.gray(`    ${path}`));
        });
        if (daemonLogs.length > 5) {
          console.log(chalk.gray(`  ... and ${daemonLogs.length - 5} more daemon log files`));
        }
      } else {
        console.log(chalk.yellow('\nNo daemon log files found'));
      }
    } else {
      console.log(chalk.yellow('No log files found'));
    }

    // Support and bug reports
    console.log(chalk.bold('\n🐛 Support & Bug Reports'));
    console.log(
      `Report issues: ${chalk.blue('https://github.com/saaskit-dev/agentbridge/issues')}`
    );
    console.log(
      `Documentation: ${chalk.blue(configuration.webappUrl.replace(/^https?:\/\//, 'https://').replace(/\/$/, '') + '/')}`
    );
  }

  console.log(chalk.green('\n✅ Doctor diagnosis complete!\n'));
}
